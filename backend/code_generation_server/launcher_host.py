"""Stable host for independently signed, versioned CodeServer launchers."""
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

try:
    from runner_management.program_launcher import ProgramLauncher
except ModuleNotFoundError:
    from backend.runner_management.program_launcher import ProgramLauncher
from .bootstrapper import CodeServerClient, LauncherLogs, WorkerOutput


class LauncherClient(CodeServerClient):
    def get(self, path):
        if path.endswith('/desired-runner'):
            result = self.call('/api/code-servers/me/launcher-desired')
            if result.get('requestId') != self.request_id:
                self.request_id = result.get('requestId')
                self.on_request()
            return result
        return self.call('/api/code-servers/me/status')

    def report(self, status, message=''):
        self.call('/api/code-servers/me/launcher-result', {
            'requestId': self.request_id, 'status': status, 'message': message[:1500]})


class LauncherHost(ProgramLauncher):
    artifact_kind = 'code-server-launcher'
    entry_module = 'code_generation_server.start'
    version_directory = 'code-server-launchers'
    label = 'CodeServer 启动器'
    strict_cache = True
    health_timeout = 70

    def __init__(self, directory, config):
        client = LauncherClient(directory.resolve(), config)
        # The host and the supervised launcher have independent rotating logs.
        for handler in client.logs.logger.handlers[:]:
            handler.close(); client.logs.logger.removeHandler(handler)
        client.logs = LauncherLogs(directory, 'launcher-host.log')
        super().__init__(directory, client.server, client)
        self.current_path = self.directory / 'launcher-current.json'
        self.previous_path = self.directory / 'launcher-previous.json'
        self.boot_id = ''
        self.host_id = uuid.uuid4().hex
        from .launcher_bridge import stamp
        (self.directory / '.launcher-host-state.json').write_text(json.dumps({
            'hostId': self.host_id, 'pid': os.getpid(), 'stamp': stamp(os.getpid())}))
        client.on_request = lambda: setattr(self, 'failed_digest', None)

    def artifact_url(self, digest):
        return self.client.server + '/api/code-servers/me/artifacts/' + digest

    def launch_spec(self, digest):
        self.boot_id = uuid.uuid4().hex
        env = dict(os.environ, CODESERVER_INSTANCE_DIR=str(self.directory),
                   CODESERVER_LAUNCHER_CHILD='1', CODESERVER_LAUNCHER_DIGEST=digest,
                   CODESERVER_LAUNCHER_BOOT_ID=self.boot_id)
        if digest == 'source-local':
            command = [sys.executable, '-B', str(self.directory / 'start.py')]
        else:
            target, _manifest = self.download(digest)
            env['PYTHONPATH'] = str(target)
            command = [sys.executable, '-B', '-m', self.entry_module]
        return command, self.directory, env

    def create_capture(self, digest):
        return WorkerOutput(self.directory, 'launcher-worker.log')

    def started(self, digest, child):
        self.client.logs.event(self.capture_id, 'created', f'启动器 {digest} · PID：{child.pid}')

    def health_status(self, digest):
        remote = self.client.get('/api/runners/me/status')
        local = self.client.control('status')
        ok = (remote.get('status') == 'online' and remote.get('launcherDigest') == digest
              and remote.get('launcherBootId') == self.boot_id and local.get('launcherBootId') == self.boot_id
              and remote.get('pid') == local.get('pid'))
        return ok, '等待目标启动器和服务程序的心跳及本地检查'

    def stop(self, timeout=45):
        if not self.process:
            return
        (self.directory / '.launcher-child-stop.json').write_text(json.dumps({'bootId': self.boot_id}))
        try:
            self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            # A hung supervisor must not leave its known worker behind on Windows.
            try:
                from .launcher_bridge import stamp, stop_exact
                status = self.client.control('status')
                if status.get('launcherBootId') == self.boot_id:
                    stop_exact(status['pid'], stamp(status['pid']))
            except (OSError, ValueError):
                pass
        super().stop(timeout=5)

    def switch(self, digest):
        try:
            self.download(digest)
            self.client.report('waiting', '等待当前生成任务和文件操作完成')
            if self.process and self.process.poll() is None:
                status = self.client.control('drain')
                until = time.monotonic() + 1800
                while status['activeRequests'] or status['idleSeconds'] < 2:
                    if time.monotonic() >= until:
                        raise RuntimeError('等待空闲超时，保持原启动器运行')
                    time.sleep(0.5)
                    status = self.client.control('status')
            self.client.report('upgrading', '自动切换签名启动器，保留配置、身份和工作空间')
            super().switch(digest)
            self.client.report('succeeded', '启动器自动更新成功')
            self.client.control('resume')
        except Exception as error:
            self.failed_digest = digest
            try:
                self.client.control('resume')
                self.client.report('failed', str(error) or type(error).__name__)
            except Exception:
                pass
            raise

    def serve(self, interval=10):
        self.current_digest = json.loads(self.current_path.read_text('utf8'))['digest'] if self.current_path.exists() else 'source-local'
        try:
            self.process = self.start(self.current_digest)
            if not self.healthy(self.current_digest):
                raise RuntimeError('启动器首次健康检查失败')
            self.client.control('resume')
            while self.running:
                stop_file = self.directory / '.launcher-host-stop.json'
                if stop_file.is_file() and json.loads(stop_file.read_text('utf8')).get('hostId') == self.host_id:
                    break
                try:
                    desired = self.client.get('/api/runners/me/desired-runner').get('digest')
                    if desired and desired != self.current_digest and desired != self.failed_digest:
                        self.switch(desired)
                    elif desired == self.current_digest and self.healthy(self.current_digest):
                        self.client.report('succeeded', '已通过目标启动器健康检查')
                    elif self.process.poll() is not None:
                        self.stop(); self.process = self.start(self.current_digest)
                        if self.healthy(self.current_digest):
                            self.client.control('resume')
                except Exception as error:
                    self.client.logs.event(self.capture_id, 'stage', str(error), stage='upgrade-check', level='error')
                until = time.monotonic() + interval
                while self.running and time.monotonic() < until:
                    time.sleep(min(0.25, max(0, until - time.monotonic())))
        finally:
            self.stop()
