"""Shared signed-program lifecycle for Runner and CodeServer adapters."""
from __future__ import annotations

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


LAUNCHER_VERSION = '2026.10.29.2'


class ProgramLauncher:
    artifact_kind = 'runner'
    entry_module = 'runner_management.runner'
    version_directory = 'runner-versions'
    label = 'Runner'
    strict_cache = False

    def __init__(self, directory: Path, server: str, client):
        self.directory = directory.resolve()
        self.client = client
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

    def artifact_url(self, digest: str) -> str:
        return self.client.server + '/api/artifacts/' + digest

    def validate_manifest(self, manifest):
        if manifest.get('kind') != self.artifact_kind or manifest.get('entryModule') != self.entry_module:
            raise ValueError(self.label + ' 制品入口无效')
        return manifest

    def download(self, digest: str) -> tuple[Path, dict]:
        import re
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
            raise ValueError('制品摘要无效')
        target = self.directory / self.version_directory / digest.removeprefix("sha256:")
        manifest_path = target / "manifest.json"
        cached_zip = target.parent / f"{digest.removeprefix('sha256:')}.zip"
        cached_signature = target.parent / f"{digest.removeprefix('sha256:')}.sig"
        if cached_zip.is_file() and cached_signature.is_file():
            data = cached_zip.read_bytes()
            signature = cached_signature.read_text(encoding="ascii")
        else:
            request = Request(self.artifact_url(digest),
                              headers={"Authorization": f"Bearer {self.client.identity['token']}",
                                       **getattr(self.client, 'artifact_headers', {})})
            with urlopen(request, timeout=30) as response:
                data = response.read()
                signature = response.headers.get("X-Artifact-Signature", "")
        verify_artifact(data, digest, signature, self.client.identity["publicKey"])
        if manifest_path.is_file():
            return target, self.validate_manifest(verify_extracted(data, target, strict=self.strict_cache))
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix="incoming-", dir=target.parent))
        try:
            manifest = extract_verified(data, temporary)
            self.validate_manifest(manifest)
            os.replace(temporary, target)
            cached_zip.write_bytes(data)
            cached_signature.write_text(signature, encoding="ascii")
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
        return target, manifest

    def launch_spec(self, digest):
        raise NotImplementedError()

    @staticmethod
    def python_executable(stdlib_only=False):
        # Windows venv executables are redirectors, with a different PID from
        # the service. Stdlib-only adapters can safely bypass that redirector.
        if os.name == 'nt' and stdlib_only:
            return getattr(sys, '_base_executable', None) or sys.executable
        return sys.executable

    def create_capture(self, digest):
        raise NotImplementedError()

    def started(self, digest, child):
        pass

    def start(self, digest: str) -> subprocess.Popen:
        command, cwd, env = self.launch_spec(digest)
        env.update(PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1', PROGRAM_LAUNCHER_VERSION=LAUNCHER_VERSION)
        self.capture_id = uuid.uuid4().hex
        self.capture = self.create_capture(digest)
        try:
            child = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
            self.capture.attach(child.stdout)
        except Exception as exc:
            self.capture.close()
            self.client.logs.event(self.capture_id, 'failed', str(exc))
            raise
        self.started(digest, child)
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
            self.client.logs.event(self.capture_id, 'exited' if already_exited else 'stopped', self.label + ' 主进程退出', exitCode=child.returncode)
            self.client.logs.pump()

    @staticmethod
    def write_pointer(path: Path, digest: str) -> None:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"digest": digest}), encoding="utf-8")
        os.replace(temporary, path)

    health_timeout = 20

    def health_status(self, digest):
        status = self.client.get('/api/runners/me/status')
        ok = status.get('actualDigest') == digest and status.get('status') == 'online'
        return ok, f"平台版本={status.get('actualDigest')}，平台状态={status.get('status')}"

    def healthy(self, digest: str, timeout=None) -> bool:
        until = time.monotonic() + (self.health_timeout if timeout is None else timeout)
        reason = '尚未收到目标版本状态'
        while time.monotonic() < until:
            if self.process is None or self.process.poll() is not None:
                code = self.process.returncode if self.process else '未创建'
                self.client.logs.event(self.capture_id, 'stage', f'健康检查失败：服务进程已退出，退出码 {code}', stage='health-check', level='error')
                return False
            try:
                ok, reason = self.health_status(digest)
                if ok:
                    return True
            except Exception as exc:
                reason = f'状态请求失败：{type(exc).__name__}'
            time.sleep(0.5)
        self.client.logs.event(self.capture_id, 'stage', '健康检查超时：' + reason, stage='health-check', level='error')
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
        raise RuntimeError(self.label + " 新版本健康检查失败，已恢复上一版本")

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
                print(f"{self.label} 升级检查失败：{exc}", file=sys.stderr, flush=True)
            self.client.logs.pump()
            time.sleep(interval)
        self.stop()

