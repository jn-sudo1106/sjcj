"""CodeServer adapter for the Runner signed-artifact supervisor."""
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import sys
import threading
import time
from urllib.request import Request, urlopen

try:
    from runner_management.program_launcher import ProgramLauncher
except ModuleNotFoundError:
    from backend.runner_management.program_launcher import ProgramLauncher

from .service import Service


class LauncherLogs:
    def __init__(self, root):
        self.logger = logging.getLogger('code-server-launcher.' + str(root))
        self.logger.setLevel(logging.INFO)
        (root / 'logs').mkdir(exist_ok=True)
        if not self.logger.handlers:
            handler = RotatingFileHandler(root / 'logs/launcher.log', maxBytes=2*1024*1024, backupCount=3, encoding='utf8')
            handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
            self.logger.addHandler(handler)

    def event(self, _id, _event, message, **_fields):
        self.logger.info(message)
        print(message, flush=True)

    def pump(self):
        pass


class WorkerOutput:
    """Bounded process output, closed after the supervised child exits."""
    def __init__(self, root):
        self.handler = RotatingFileHandler(root / 'logs/worker.log', maxBytes=2*1024*1024, backupCount=3, encoding='utf8')
        self.handler.setFormatter(logging.Formatter('%(message)s'))
        self.thread = None

    def attach(self, pipe):
        def read():
            try:
                while True:
                    line = pipe.readline(12000)
                    if not line:
                        break
                    self.handler.handle(logging.LogRecord('worker',logging.INFO,'',0,line.decode('utf8',errors='replace').rstrip('\r\n'),(),None))
            finally:
                pipe.close()
        self.thread = threading.Thread(target=read,name='code-server-output',daemon=True)
        self.thread.start()

    def close(self):
        if self.thread:
            self.thread.join(timeout=2)
        self.handler.close()


class CodeServerClient:
    def __init__(self, directory, config):
        self.directory = directory
        self.server = config['platform'].rstrip('/')
        self.service = Service(directory, config)
        self.logs = LauncherLogs(directory)
        self.request_id = None
        self.waiting_request = None
        self.on_request = lambda: None
        if not self.service.identity:
            registered = self.service.platform_request('/api/code-servers/enroll', {
                **self.service.report(), 'code': config.get('enrollCode', '')})
            self.service.identity = {**registered, 'fingerprint': self.service.fingerprint}
        self.identity = self.service.identity
        if not self.identity.get('publicKey'):
            self.identity['publicKey'] = self.call('/api/code-servers/me/status')['publicKey']
        temporary = directory / 'identity.tmp'
        temporary.write_text(json.dumps(self.identity, indent=2), encoding='utf8')
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        temporary.replace(directory / 'identity.json')
        self.artifact_headers = {'X-Code-Server-ID': self.identity['serverId']}
        # The parent only uses Service for identity/configuration. Let the worker
        # own service.log so Windows log rotation is not blocked by another handle.
        for handler in self.service.logger.handlers[:]:
            handler.close();self.service.logger.removeHandler(handler)

    def call(self, path, body=None):
        request = Request(self.server + path,
                          data=json.dumps(body).encode('utf8') if body is not None else None,
                          headers={'Authorization': 'Bearer ' + self.identity['token'],
                                   'X-Code-Server-ID': self.identity['serverId'], 'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read(65536))

    def get(self, path):
        if path.endswith('/desired-runner'):
            result = self.call('/api/code-servers/me/desired')
            if result.get('requestId') and result['requestId'] != self.request_id:
                self.request_id = result['requestId']
                self.on_request()
            if result.get('waiting') and self.waiting_request != self.request_id:
                self.report('waiting', '等待当前生成任务和 Git 归档完成')
                self.waiting_request = self.request_id
            elif not result.get('waiting'):
                self.waiting_request = None
            return result
        return self.call('/api/code-servers/me/status')

    def report(self, status, message=''):
        self.call('/api/code-servers/me/upgrade-result', {
            'requestId': self.request_id, 'status': status, 'message': message[:1500]})

    def control(self, action):
        config = self.service.config
        host = config.get('host', '0.0.0.0')
        if host in ('0.0.0.0', '::'):
            host = '127.0.0.1'
        if ':' in host:
            host = '[' + host + ']'
        request = Request(f'http://{host}:{config.get("port",8093)}/api/control',
                          data=json.dumps({'action': action}).encode('utf8'),
                          headers={'Authorization': 'Bearer ' + self.identity['token'], 'Content-Type': 'application/json'})
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read(65536))


class CodeServerBootstrapper(ProgramLauncher):
    artifact_kind = 'code-server'
    entry_module = 'code_generation_server.service'
    version_directory = 'code-server-versions'
    label = 'CodeServer'
    strict_cache = True

    def __init__(self, directory, config):
        client = CodeServerClient(directory.resolve(), config)
        super().__init__(directory, client.server, client=client)
        client.on_request = lambda: setattr(self, 'failed_digest', None)

    def artifact_url(self, digest):
        return self.client.server + '/api/code-servers/me/artifacts/' + digest

    def launch_spec(self, digest):
        env = dict(os.environ, CODESERVER_INSTANCE_DIR=str(self.directory),
                   CODESERVER_RELEASE_DIGEST=digest, CODESERVER_SUPERVISED='1',
                   PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
        worker_python = self.python_executable(stdlib_only=True)
        if digest == 'source-local':
            command = [worker_python, str(Path(__file__).with_name('service.py'))]
        else:
            target, _manifest = self.download(digest)
            env['PYTHONPATH'] = str(target)
            command = [worker_python, '-B', '-m', self.entry_module]
        return command, self.directory, env

    def create_capture(self, digest):
        return WorkerOutput(self.directory)

    def started(self, digest, child):
        instance = self.client.identity['serverId']
        if os.name == 'nt':
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW(f'CodeServer | {instance} | {digest} | {self.directory}')
        self.client.logs.event(self.capture_id, 'created', f'CodeServer 实例：{instance} · 版本：{digest} · PID：{child.pid}')

    health_timeout = 25

    def health_status(self, digest):
        remote = self.client.get('/api/runners/me/status')
        local = self.client.control('status')
        ok = (remote.get('actualDigest') == digest and remote.get('status') == 'online'
              and remote.get('pid') == self.process.pid and local.get('pid') == self.process.pid
              and local.get('actualDigest') == digest)
        reason = (f'启动 PID={self.process.pid}，平台 PID={remote.get("pid")}，本地 PID={local.get("pid")}；'
                  f'平台版本={remote.get("actualDigest")}，本地版本={local.get("actualDigest")}，平台状态={remote.get("status")}')
        return ok, reason

    def switch(self, digest):
        try:
            self.download(digest)
            self.client.report('waiting', '等待当前模型请求和文件操作完成')
            if self.process and self.process.poll() is None:
                status = self.client.control('drain')
                until = time.monotonic() + 1800
                while status['activeRequests'] or status['idleSeconds'] < 2:
                    if time.monotonic() >= until:
                        raise RuntimeError('等待服务空闲超时，当前版本继续运行')
                    time.sleep(0.5)
                    status = self.client.control('status')
            self.client.report('upgrading', '正在切换已校验的签名版本')
            super().switch(digest)
            self.client.report('succeeded', '升级成功，实例心跳和本地服务检查通过')
        except Exception as error:
            self.failed_digest = digest
            try:
                self.client.control('resume')
            except Exception:
                pass
            self.client.report('failed', str(error) or type(error).__name__)
            raise
