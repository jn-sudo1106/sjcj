"""One native-process Runner instance; install each instance in its own directory."""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import threading
import traceback
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse


def announce_instance(runner_id: str, directory: Path, version: str | None = None) -> None:
    """Identify the owning instance even when several consoles share a machine."""
    version = version or os.getenv('RUNNER_RELEASE_DIGEST', 'source-local')
    version_label = version[7:19] if version.startswith('sha256:') else version
    message = f'Runner 实例 ID：{runner_id}\nRunner 版本 ID：{version}\nRunner 目录：{directory}'
    if os.name == 'nt':
        import ctypes
        try:
            ctypes.windll.kernel32.SetConsoleTitleW(f'Runner | {runner_id} | 版本 {version_label} | {directory}')
        except OSError:
            pass  # A service without an attached console can still start.
        # The stable bootstrapper captures worker stdout into log files. Also
        # announce to its attached console, including when that wrapper is old.
        if not sys.stdout.isatty():
            try:
                with open('CONOUT$', 'w', encoding='utf-8') as console:
                    console.write(message + '\n')
            except OSError:
                pass
    print(message, flush=True)

from .artifacts import extract_verified, verify_artifact, verify_extracted


def machine_ip(server: str) -> str:
    """Choose the reachable physical LAN address, not a VPN or VM adapter."""
    override = os.getenv("RUNNER_ADVERTISE_IP", "").strip()
    if override:
        address = ipaddress.ip_address(override)
        if address.is_loopback or address.is_unspecified:
            raise ValueError("RUNNER_ADVERTISE_IP 必须是机器可访问的 IP")
        return str(address)
    host = urlparse(server).hostname or ""
    if host and host not in ("localhost", "127.0.0.1", "::1"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
                route.connect((host, 80))
                address = route.getsockname()[0]
                if not ipaddress.ip_address(address).is_loopback:
                    return address
        except (OSError, ValueError):
            pass
    if os.name == "nt":
        script = (
            "$rows = foreach ($c in Get-NetIPConfiguration -ErrorAction SilentlyContinue) { "
            "$a = Get-NetAdapter -InterfaceIndex $c.InterfaceIndex -ErrorAction SilentlyContinue; "
            "if ($a.HardwareInterface -and $a.Status -eq 'Up' -and $c.IPv4Address) { "
            "$m = Get-NetIPInterface -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue; "
            "foreach ($v in $c.IPv4Address) { if ($v.IPAddress -notlike '169.254.*') { "
            "[PSCustomObject]@{IP=$v.IPAddress;Gateway=[int][bool]$c.IPv4DefaultGateway;Metric=$m.InterfaceMetric} "
            "} } } }; "
            "$rows | Sort-Object @{Expression='Gateway';Descending=$true},Metric | "
            "Select-Object -First 1 -ExpandProperty IP"
        )
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                                    capture_output=True, text=True, timeout=8, check=False)
            address = result.stdout.strip()
            if result.returncode == 0 and address and ipaddress.ip_address(address).version == 4:
                return address
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
    return socket.gethostbyname(socket.gethostname())


def json_request(base: str, path: str, token: str = "", payload: dict | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(base + path, data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers, method="POST" if payload is not None else "GET")
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as exc:
        try:
            message = json.load(exc).get("message", "请求失败")
        except ValueError:
            message = "请求失败"
        error = RuntimeError(f"{path}: {message}")
        error.http_status = exc.code
        raise error from exc


class Runner:
    def __init__(self, directory: Path, server: str, interval: float = 5):
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        from .program_dependencies import ensure_pip_settings
        ensure_pip_settings(self.directory)
        self.server = server.rstrip("/")
        self.ip_address = machine_ip(self.server)
        from .system_info import operating_system_info
        self.os_info = operating_system_info()
        self.interval = max(0.5, interval)
        self.identity_path = self.directory / "identity.json"
        self.identity = json.loads(self.identity_path.read_text(encoding="utf-8")) if self.identity_path.exists() else None
        self.processes: dict[str, tuple[str, subprocess.Popen, object]] = {}
        self.process_info: dict[str, dict] = {}
        self.last_error = ""
        self.running = True
        self.delivery_thread: threading.Thread | None = None
        from .runtime_logs import LogQueue
        self.logs = LogQueue(self.directory, self.post)
        self.run_info: dict[str, dict] = {}
        self.last_failed_run: dict[str, str] = {}
        self.log_session = uuid.uuid4().hex
        self.log_session_started = False
        self.retry_path = self.directory / 'retry-state.json'
        try:
            self.retries = json.loads(self.retry_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            self.retries = {}

    def enroll(self, code: str = "", ip: str = "") -> None:
        if self.identity:
            raise ValueError("该目录已经登记，不可覆盖实例身份")
        payload = {
            "code": code, "installDirectory": str(self.directory),
            "ipAddress": ip or self.ip_address,
            "platform": sys.platform, "capabilities": ["python", "deployment-entry", "retry-policy"],
            **self.os_info,
        }
        result = json_request(self.server, "/api/runners/enroll", payload=payload)
        result["installDirectory"] = str(self.directory)
        self.identity = result
        temporary = self.identity_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(result), encoding="utf-8")
        os.replace(temporary, self.identity_path)
        if os.name != "nt":
            self.identity_path.chmod(0o600)

    def identity_matches_directory(self) -> bool:
        """A copied identity must not claim tasks or report another instance's PID."""
        if not self.identity:
            return False
        registered = self.identity.get("installDirectory")
        if not registered:
            # Old identity files contain only credentials; resolve their owner
            # through the authenticated API before starting any child process.
            registered = self.get("/api/runners/me/status").get("installDirectory")
        if not registered:
            raise RuntimeError("管理服务未返回实例登记目录，请更新 Runner 管理服务")
        return os.path.normcase(str(Path(registered).resolve())) == os.path.normcase(str(self.directory))

    def get(self, path: str):
        if not self.identity:
            raise ValueError("Runner 尚未登记")
        return json_request(self.server, path, self.identity["token"])

    def post(self, path: str, payload: dict):
        if not self.identity:
            raise ValueError("Runner 尚未登记")
        return json_request(self.server, path, self.identity["token"], payload)

    def prepare(self, digest: str) -> tuple[Path, dict]:
        if not digest.startswith("sha256:"):
            raise ValueError("制品摘要无效")
        release_dir = self.directory / "versions" / digest[7:]
        manifest_file = release_dir / "manifest.json"
        cached_zip = release_dir.parent / f"{digest[7:]}.zip"
        cached_signature = release_dir.parent / f"{digest[7:]}.sig"
        if cached_zip.is_file() and cached_signature.is_file():
            data = cached_zip.read_bytes()
            signature = cached_signature.read_text(encoding="ascii")
        else:
            request = Request(self.server + "/api/artifacts/" + digest,
                              headers={"Authorization": f"Bearer {self.identity['token']}"})
            with urlopen(request, timeout=30) as response:
                data = response.read()
                signature = response.headers.get("X-Artifact-Signature", "")
        verify_artifact(data, digest, signature, self.identity["publicKey"])
        if manifest_file.is_file():
            return release_dir, verify_extracted(data, release_dir)
        release_dir.parent.mkdir(parents=True, exist_ok=True)
        temp_dir = Path(tempfile.mkdtemp(prefix="incoming-", dir=release_dir.parent))
        try:
            manifest = extract_verified(data, temp_dir)
            if manifest.get("kind") != "processor" or not manifest.get("entry"):
                raise ValueError("处理程序制品清单无效")
            if not (temp_dir / manifest["entry"]).is_file():
                raise ValueError("处理程序入口不存在")
            os.replace(temp_dir, release_dir)
            cached_zip.write_bytes(data)
            cached_signature.write_text(signature, encoding="ascii")
        except Exception:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise
        return release_dir, manifest

    def python_for(self, release_dir: Path) -> Path:
        env_dir = release_dir / ".venv"
        python = env_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not python.exists():
            command = [sys.executable, "-m", "venv"]
            if os.getenv("RUNNER_DEV_SYSTEM_PACKAGES") == "1":
                command.append("--system-site-packages")
            subprocess.run([*command, str(env_dir)], check=True, timeout=120)
        return python

    def start(self, assignment: dict, slot: int = 0) -> None:
        key = assignment['assignmentId'] if slot == 0 else f"{assignment['assignmentId']}:{slot}"
        identifier = uuid.uuid4().hex
        self.run_info[key] = {'runId': identifier, 'runtimeId': assignment.get('runtimeId', ''), 'assignment': assignment}
        self.logs.event(identifier, 'created', '开始检查启动文件和已下发代码', assignmentId=assignment['assignmentId'],
                        operationId=assignment.get('operationId', ''), releaseDigest=assignment['releaseDigest'], slot=slot,
                        retryPolicy=assignment.get('retryPolicy'))
        try:
            self._start(assignment, slot)
        except Exception as exc:
            info = self.run_info.pop(key, {})
            self.last_failed_run[key] = identifier
            self.logs.event(identifier, 'failed', str(exc) or type(exc).__name__, detail=traceback.format_exc(),
                            pid=info.get('pid'), entry=info.get('entry', ''), workingDirectory=info.get('workingDirectory', ''), exitCode=info.get('exitCode'))
            self.logs.pump()
            raise

    def _start(self, assignment: dict, slot: int = 0) -> None:
        assignment_id = assignment["assignmentId"] if slot == 0 else f"{assignment['assignmentId']}:{slot}"
        digest = assignment["releaseDigest"]
        release_dir, manifest = self.prepare(digest)
        if manifest.get("processorType") != assignment["processorType"]:
            raise ValueError("队列分配与处理程序类型不匹配")
        direct_entry = manifest.get('executionSchema') == 2
        working_dir = self.program_directory(release_dir, manifest) if direct_entry else release_dir
        info = self.run_info[assignment_id]
        if direct_entry:
            from .program_dependencies import dependency_python
            python = dependency_python(self, release_dir, working_dir, manifest, info)
            working_dir = self.program_directory(release_dir, manifest)
        else:
            python = self.python_for(release_dir)
        from .runtime_logs import ConsoleCapture
        log_file = ConsoleCapture(self.logs, assignment.get('runtimeId', ''), info['runId'])
        env = os.environ.copy()
        for secret in ("RUNNER_ADMIN_TOKEN", "RUNNER_DB_PASSWORD", "RUNNER_DB_HOST",
                       "RUNNER_DB_USER", "RUNNER_DB_NAME", "RUNNER_DB_PORT"):
            env.pop(secret, None)
        env["RUNNER_QUEUE"] = assignment["queue"]
        if manifest.get('executionSchema') == 2:
            env['RUNNER_CONFIG_ID'] = manifest.get('configId', '')
            env['RUNNER_DEPLOYMENT_ID'] = manifest['deploymentId']
            # Do not read potentially stale bytecode shipped in old deployments.
            # A unique, unwritten cache prefix makes imports compile verified
            # sources in memory, without racing other concurrent workers.
            env['PYTHONDONTWRITEBYTECODE'] = '1'
            env['PYTHONPYCACHEPREFIX'] = str(self.directory / '.runtime' / 'python-cache' / info['runId'])
        env["RUNNER_ENVIRONMENT"] = "prd" if assignment["environment"] == "production" else "test"
        if manifest.get('executionSchema') != 2:
            env["NEWS_NOURL_QUEUE"] = assignment["queue"]
        env["RUNNER_MANAGEMENT_URL"] = self.server
        env["RUNNER_WORKER_TOKEN"] = assignment.get("workerToken", "")
        env["RUNNER_PUBLIC_KEY"] = self.identity["publicKey"]
        env["RUNNER_SCRIPT_CACHE"] = str(self.directory / "code")
        env["RUNNER_INSTANCE_DIR"] = str(self.directory)
        env["PYTHONUNBUFFERED"] = "1"
        env['PYTHONIOENCODING'] = 'utf-8'
        if python != Path(sys.executable):
            env.pop('PYTHONHOME', None)
            env.pop('PYTHONPATH', None)
        try:
            child = subprocess.Popen([str(python), str(working_dir / manifest["entry"])], cwd=working_dir, env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        except Exception:
            log_file.close()
            raise
        info.update(pid=child.pid, entry=str(working_dir / manifest['entry']), workingDirectory=str(working_dir))
        log_file.attach(child.stdout)
        try:
            exit_code = child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        else:
            log_file.close()
            info['exitCode'] = exit_code
            raise RuntimeError(f"启动文件 {manifest['entry']} 启动后立即退出（代码 {exit_code}），请在运行日志查看程序输出")
        self.processes[assignment_id] = (digest, child, log_file)
        self.process_info[assignment_id] = {
            'assignmentId': assignment['assignmentId'], 'queue': assignment['queue'], 'slot': slot,
            'entry': str(working_dir / manifest['entry']), 'workingDirectory': str(working_dir),
        }
        self.logs.event(info['runId'], 'started', '程序已启动；进程存活不代表任务处理成功', pid=child.pid,
                        entry=str(working_dir / manifest['entry']), workingDirectory=str(working_dir), interpreter=str(python))
        self.logs.pump()

    def program_directory(self, release_dir: Path, manifest: dict) -> Path:
        """Execute delivered code in its configured directory, never a hidden shell."""
        from .bundle_install import safe_relative, linked, read_registry, code_key
        from .python_cache import is_python_cache
        root = manifest.get('directoryTemplate', '')
        if (not safe_relative(root) or '{' in root or '}' in root
                or root.split('/')[0].casefold() in {'code', 'logs', 'versions', 'runner-versions', '.runtime',
                                                    'identity.json', 'current.json', 'previous.json', 'instance.lock'}):
            raise ValueError('启动目录不能覆盖 Runner 程序或身份目录')
        target = self.directory / root
        for parent in (target, *target.parents):
            if parent == self.directory:
                break
            if linked(parent):
                raise ValueError('启动目录不能使用符号链接')
        if not target.resolve().is_relative_to(self.directory) or not target.is_dir():
            raise ValueError('启动目录不存在，请先下发代码')
        if code_key(manifest) not in read_registry(target)['current']:
            raise ValueError('此部署配置尚未下发到启动目录')
        for expected in release_dir.rglob('*'):
            relative = expected.relative_to(release_dir).as_posix()
            if relative == 'manifest.json' or relative.split('/')[0] == '.venv' or is_python_cache(relative) or not expected.is_file():
                continue
            actual = target / relative
            if any(linked(parent) for parent in (actual, *actual.parents) if parent != self.directory):
                raise ValueError('启动文件或依赖不能使用符号链接')
            if not actual.is_file() or actual.read_bytes() != expected.read_bytes():
                raise ValueError(f'启动文件或依赖与配置版本不一致，请重新下发：{relative}')
        return target

    def stop(self, assignment_id: str, timeout: float = 30, reason: str = 'stopped') -> None:
        info = self.run_info.get(assignment_id)
        item = self.processes.get(assignment_id)
        if not item:
            return
        _, child, log_file = item
        if child.poll() is None:
            try:
                if os.name == "nt":
                    child.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    child.terminate()
                child.wait(timeout=timeout)
            except (OSError, subprocess.TimeoutExpired):
                child.kill()
                child.wait(timeout=5)
        self.run_info.pop(assignment_id, None)
        self.process_info.pop(assignment_id, None)
        self.processes.pop(assignment_id, None)
        log_file.close()
        if info:
            self.logs.event(info['runId'], 'exited' if reason == 'exited' else 'stopped',
                            f"程序退出，退出码 {child.returncode}" if reason == 'exited' else '程序已停止', exitCode=child.returncode)
            self.logs.pump()

    def deliver_pending(self) -> None:
        from .directory_download import deliver_pending
        deliver_pending(self)

    def delivery_cycle(self) -> None:
        try:
            self.deliver_pending()
        except Exception as exc:
            self.last_error = ('目录下发：' + (str(exc) or type(exc).__name__))[:500]
            self.logs.event(self.log_session, 'stage', self.last_error, stage='delivery-sync', level='error', detail=traceback.format_exc())

    def heartbeat_payload(self) -> dict:
        workers = [
            {**self.process_info[key], 'pid': child.pid}
            for key, (_, child, _) in self.processes.items()
            if key in self.process_info and child.poll() is None
        ]
        return {
            'ipAddress': self.ip_address,
            **self.os_info,
            'runnerDigest': os.getenv('RUNNER_RELEASE_DIGEST', 'source-local'),
            'launcherVersion': os.getenv('PROGRAM_LAUNCHER_VERSION', ''),
            'runnerPid': os.getpid(), 'workerProcesses': workers, 'executionSchema': 2, 'logSchema': 1, 'retryPolicySchema': 1, 'processControlSchema': 2,
            'workerDigests': ','.join(sorted({digest for digest, child, _ in self.processes.values() if child.poll() is None})),
            'lastError': self.last_error,
        }

    def tick(self) -> None:
        if not self.log_session_started:
            self.logs.event(self.log_session, 'created', 'Runner 日志采集已启动', kind='runner', runnerVersion=os.getenv('RUNNER_RELEASE_DIGEST', 'source-local'))
            self.log_session_started = True
        assignments = self.get("/api/runners/me/assignments")
        from .process_control import apply_stops
        stopped = apply_stops(self, assignments)
        desired = {
            row["assignmentId"] if slot == 0 else f"{row['assignmentId']}:{slot}": (row, slot)
            for row in assignments for slot in range(int(row["concurrency"]))
            if (row['assignmentId'] if slot == 0 else f"{row['assignmentId']}:{slot}") not in stopped
        }
        for assignment_id, (digest, child, _log) in list(self.processes.items()):
            target = desired.get(assignment_id)
            if not target or target[0]["releaseDigest"] != digest or child.poll() is not None:
                info = self.run_info.get(assignment_id, {})
                exited = child.poll() is not None
                self.stop(assignment_id, reason='exited' if exited else 'stopped')
                if exited and target:
                    self.record_failure(assignment_id, target[0], info.get('runId', ''))
        for key in list(self.retries):
            if key not in desired:
                del self.retries[key]
        self.persist_retries()
        for assignment_id, (row, slot) in desired.items():
            if assignment_id not in self.processes:
                retry = self.retries.get(assignment_id, {})
                generation = row['releaseDigest'] + ':' + row.get('operationId', '')
                if retry.get('generation') != generation:
                    self.retries.pop(assignment_id, None); retry = {}
                if retry.get('failures'):
                    from .retry_policy import retry_policy
                    policy = retry_policy(row.get('retryPolicy'))
                    if not policy['enabled'] or len([v for v in retry['failures'] if v > time.time() - policy['windowSeconds']]) >= policy['maxAttempts']:
                        self.pause_retries(assignment_id, row, retry)
                if retry.get('paused') or retry.get('nextAt', 0) > time.time():
                    continue
                try:
                    self.start(row, slot)
                except Exception as exc:
                    # A broken queue worker must not block other queues,
                    # heartbeat reporting or manually requested code delivery.
                    self.last_error = (str(exc) or type(exc).__name__)[:500]
                    self.record_failure(assignment_id, row, '')
        self.post("/api/runners/me/heartbeat", self.heartbeat_payload())
        self.last_error = ""
        self.logs.pump()
        # File transfers must not delay the heartbeat or queue supervision.
        if self.delivery_thread is None or not self.delivery_thread.is_alive():
            self.delivery_thread = threading.Thread(target=self.delivery_cycle, daemon=True)
            self.delivery_thread.start()

    def persist_retries(self):
        temporary = self.retry_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.retries), encoding='utf-8'); os.replace(temporary, self.retry_path)

    def record_failure(self, key, assignment, run_id):
        from .retry_policy import retry_policy
        policy = retry_policy(assignment.get('retryPolicy'))
        retry = self.retries.setdefault(key, {'generation': assignment['releaseDigest'] + ':' + assignment.get('operationId', ''), 'failures': []})
        retry['failures'] = [value for value in retry['failures'] if value > time.time() - policy['windowSeconds']] + [time.time()]
        retry['nextAt'] = time.time() + policy['delaysSeconds'][min(len(retry['failures']) - 1, len(policy['delaysSeconds']) - 1)]
        retry['runId'] = run_id or self.last_failed_run.get(key, '')
        retry['paused'] = False
        if not policy['enabled'] or len(retry['failures']) >= policy['maxAttempts']:
            self.pause_retries(key, assignment, retry)
        self.persist_retries()

    def pause_retries(self, key, assignment, retry):
        if retry.get('paused'):
            return
        from .retry_policy import retry_policy
        policy = retry_policy(assignment.get('retryPolicy'))
        retry['paused'] = True
        identifier = retry.get('runId') or self.last_failed_run.get(key, '')
        message = (f"{policy['windowSeconds'] // 60} 分钟内失败 {len(retry['failures'])} 次，已达到 {policy['maxAttempts']} 次尝试上限"
                   if policy['enabled'] else '自动重试已关闭，本次启动失败或程序退出后不再自动启动')
        if identifier:
            self.logs.event(identifier, 'retry-paused', message + '，请处理后手动启动', retryPolicy=policy)
        self.persist_retries()

    def close(self):
        self.running = False
        if self.delivery_thread:
            self.delivery_thread.join(timeout=5)
        for key in list(self.processes):
            self.stop(key)
        if self.log_session_started:
            self.logs.event(self.log_session, 'stopped', 'Runner 主进程已停止', exitCode=0)
            self.log_session_started = False
        self.logs.pump()
        if self.logs.thread:
            self.logs.thread.join(timeout=5)

    def serve(self) -> None:
        if not self.identity:
            raise ValueError("请先使用 --enroll-code 登记该实例")
        with (self.directory / "instance.lock").open("a+b") as lock:
            try:
                if os.name == "nt":
                    import msvcrt
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise RuntimeError("此安装目录已有运行中的 Runner 实例") from exc
            announce_instance(self.identity['runnerId'], self.directory)
            try:
                while self.running:
                    try:
                        self.tick()
                    except (RuntimeError, URLError, OSError, ValueError) as exc:
                        self.last_error = str(exc)[:500]
                        self.logs.event(self.log_session, 'stage', self.last_error, stage='sync', level='error', detail=traceback.format_exc())
                        self.logs.pump()
                        print(f"Runner 同步失败：{self.last_error}", file=sys.stderr, flush=True)
                        try:
                            self.post("/api/runners/me/heartbeat", self.heartbeat_payload())
                        except (RuntimeError, URLError, OSError):
                            pass
                    time.sleep(self.interval)
            finally:
                self.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, required=True, help="本实例的独立安装目录")
    parser.add_argument("--server", default="http://127.0.0.1:8092")
    parser.add_argument("--enroll-code", default="")
    parser.add_argument("--ip", default="")
    parser.add_argument("--interval", type=float, default=5)
    args = parser.parse_args()
    runner = Runner(args.dir, args.server, args.interval)
    if runner.identity and not runner.identity_matches_directory():
        if not args.enroll_code:
            raise SystemExit("此目录使用了其他实例的身份，请在 Runner 文件夹内执行 python start.py 重新登记")
        runner.identity = None
    if args.enroll_code:
        runner.enroll(args.enroll_code, args.ip)
        print(f"已登记 Runner 实例：{runner.identity['runnerId']}")
        return
    signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "running", False))
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, lambda *_: setattr(runner, "running", False))
    try:
        runner.serve()
    except KeyboardInterrupt:
        runner.running = False
        for assignment_id in list(runner.processes):
            runner.stop(assignment_id)


if __name__ == "__main__":
    main()
