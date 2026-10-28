"""Stable launcher that upgrades one Runner instance from signed version directories."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from .artifacts import extract_verified, verify_artifact, verify_extracted
from .runner import Runner, announce_instance


class Bootstrapper:
    def __init__(self, directory: Path, server: str):
        self.directory = directory.resolve()
        self.client = Runner(directory, server)
        if not self.client.identity:
            raise ValueError("实例尚未登记")
        self.current_path = self.directory / "current.json"
        self.previous_path = self.directory / "previous.json"
        self.process: subprocess.Popen | None = None
        self.current_digest: str | None = None
        self.failed_digest: str | None = None
        self.running = True
        self.capture = None
        self.capture_id = ''

    def download(self, digest: str) -> tuple[Path, dict]:
        target = self.directory / "runner-versions" / digest.removeprefix("sha256:")
        manifest_path = target / "manifest.json"
        cached_zip = target.parent / f"{digest.removeprefix('sha256:')}.zip"
        cached_signature = target.parent / f"{digest.removeprefix('sha256:')}.sig"
        if cached_zip.is_file() and cached_signature.is_file():
            data = cached_zip.read_bytes()
            signature = cached_signature.read_text(encoding="ascii")
        else:
            request = Request(self.client.server + "/api/artifacts/" + digest,
                              headers={"Authorization": f"Bearer {self.client.identity['token']}"})
            with urlopen(request, timeout=30) as response:
                data = response.read()
                signature = response.headers.get("X-Artifact-Signature", "")
        verify_artifact(data, digest, signature, self.client.identity["publicKey"])
        if manifest_path.is_file():
            return target, verify_extracted(data, target)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix="incoming-", dir=target.parent))
        try:
            manifest = extract_verified(data, temporary)
            if manifest.get("kind") != "runner" or manifest.get("entryModule") != "runner_management.runner":
                raise ValueError("Runner 制品入口无效")
            os.replace(temporary, target)
            cached_zip.write_bytes(data)
            cached_signature.write_text(signature, encoding="ascii")
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
        return target, manifest

    def start(self, digest: str) -> subprocess.Popen:
        env = os.environ.copy()
        env["RUNNER_RELEASE_DIGEST"] = digest
        if digest == "source-local":
            target = Path(__file__).resolve().parent
            command = [sys.executable, str(target / "start.py"), "--worker", "--dir", str(self.directory),
                       "--server", self.client.server]
        else:
            target, manifest = self.download(digest)
            env["PYTHONPATH"] = str(target)
            command = [sys.executable, "-m", manifest["entryModule"], "--dir", str(self.directory),
                       "--server", self.client.server]
        from .runtime_logs import ConsoleCapture
        self.capture_id = uuid.uuid4().hex
        self.client.logs.event(self.capture_id, 'created', 'Runner 主进程启动', kind='runner', runnerVersion=digest)
        self.capture = ConsoleCapture(self.client.logs, 'runner', self.capture_id)
        try:
            env.update(PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            child = subprocess.Popen(command, cwd=target, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
            self.capture.attach(child.stdout)
        except Exception as exc:
            self.capture.close()
            self.client.logs.event(self.capture_id, 'failed', str(exc))
            raise
        announce_instance(self.client.identity['runnerId'], self.directory, digest)
        self.client.logs.pump()
        return child

    def stop(self, timeout: float = 35) -> None:
        child = self.process
        self.process = None
        if not child:
            return
        already_exited = child.poll() is not None
        try:
            if already_exited:
                return
            if os.name == "nt":
                child.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                child.terminate()
            child.wait(timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            child.kill()
            child.wait(timeout=5)
        finally:
            if self.capture:
                self.capture.close()
            self.client.logs.event(self.capture_id, 'exited' if already_exited else 'stopped', 'Runner 主进程退出', exitCode=child.returncode)
            self.client.logs.pump()

    @staticmethod
    def write_pointer(path: Path, digest: str) -> None:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"digest": digest}), encoding="utf-8")
        os.replace(temporary, path)

    def healthy(self, digest: str, timeout: float = 20) -> bool:
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            if self.process is None or self.process.poll() is not None:
                return False
            try:
                status = self.client.get("/api/runners/me/status")
                if status.get("actualDigest") == digest and status.get("status") == "online":
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def switch(self, digest: str) -> None:
        old = self.current_digest
        if self.capture_id:
            self.client.logs.event(self.capture_id, 'stage', '开始升级到 ' + digest, stage='upgrade')
        self.download(digest)
        self.stop()
        self.process = self.start(digest)
        if self.healthy(digest):
            if old:
                self.write_pointer(self.previous_path, old)
            self.write_pointer(self.current_path, digest)
            self.current_digest = digest
            self.failed_digest = None
            return
        self.stop()
        self.failed_digest = digest
        if old:
            self.process = self.start(old)
            self.current_digest = old
            self.client.logs.event(self.capture_id, 'stage', '新版本健康检查失败，已恢复上一版本 ' + old, stage='rollback', level='error')
        raise RuntimeError("Runner 新版本健康检查失败，已恢复上一版本")

    def serve(self, interval: float = 10) -> None:
        if self.current_path.exists():
            self.current_digest = json.loads(self.current_path.read_text(encoding="utf-8"))["digest"]
        else:
            self.current_digest = "source-local"
        self.process = self.start(self.current_digest)
        while self.running:
            try:
                desired = self.client.get("/api/runners/me/desired-runner").get("digest")
                if desired and desired != self.current_digest and desired != self.failed_digest:
                    self.switch(desired)
                elif self.current_digest and (not self.process or self.process.poll() is not None):
                    self.stop()
                    self.process = self.start(self.current_digest)
            except Exception as exc:
                if self.capture_id:
                    self.client.logs.event(self.capture_id, 'stage', str(exc), stage='upgrade-check', level='error')
                print(f"Runner 升级检查失败：{exc}", file=sys.stderr, flush=True)
            self.client.logs.pump()
            time.sleep(interval)
        self.stop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, required=True)
    parser.add_argument("--server", default="http://127.0.0.1:8092")
    parser.add_argument("--interval", type=float, default=10)
    args = parser.parse_args()
    bootstrapper = Bootstrapper(args.dir, args.server)
    signal.signal(signal.SIGTERM, lambda *_: setattr(bootstrapper, "running", False))
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, lambda *_: setattr(bootstrapper, "running", False))
    try:
        bootstrapper.serve(max(0.5, args.interval))
    except KeyboardInterrupt:
        bootstrapper.running = False
        bootstrapper.stop()


if __name__ == "__main__":
    main()
