"""Portable code workspace service. Python 3.10+, standard library only.

Copy this folder, edit config.json, run python start.py. The platform owns tasks.
"""
from __future__ import annotations

import base64
import binascii
import csv
import errno
import getpass
import hashlib
import hmac
import io
import itertools
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile

VERSION = '2026.10.31.1'
MAX_FILE = 5 * 1024 * 1024
MAX_TOTAL = 10 * 1024 * 1024
MAX_JSON = 15 * 1024 * 1024
BLOCKED = {'.git', '__pycache__', '.venv', 'node_modules'}
RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}


class ServiceError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def current_account():
    if os.name != 'nt':
        return {'name': getpass.getuser(), 'sid': ''}
    command = str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'whoami.exe')
    try:
        result = subprocess.run([command, '/user', '/fo', 'csv', '/nh'], capture_output=True,
                                check=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        rows = list(csv.reader(result.stdout.decode('oem').splitlines()))
        if len(rows) != 1 or len(rows[0]) != 2 or not rows[0][1].startswith('S-1-'):
            raise ValueError('Invalid account response')
        return {'name': rows[0][0], 'sid': rows[0][1]}
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise ServiceError('无法确认 Windows 运行账户，请使用普通用户启动 CodeServer') from error


def require_user_account():
    account = current_account()
    if account['sid'] in ('S-1-5-18', 'S-1-5-19', 'S-1-5-20'):
        raise ServiceError('CodeServer 不允许使用 SYSTEM、LocalService 或 NetworkService 身份运行；请以普通用户登录后运行 start.cmd')
    return account['name']


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(NoRedirect())


class Workspace:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def path(self, value='', allow_root=False):
        if allow_root and value == '.':
            value = ''
        if not isinstance(value, str) or len(value) > 1000 or '\\' in value or ':' in value or '\x00' in value:
            raise ServiceError('工作空间相对路径无效')
        pure = PurePosixPath(value)
        if pure.is_absolute() or any(p in ('.', '..') or p.casefold() in BLOCKED or p.upper().split('.')[0] in RESERVED or p.endswith((' ', '.')) or any(ord(c) < 32 or c in '<>"|?*' for c in p) for p in value.split('/') if p):
            raise ServiceError('路径超出工作空间或包含受保护目录', 403)
        current = self.root
        for part in pure.parts:
            current = current / part
            if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
                raise ServiceError('不允许操作符号链接或目录联接', 403)
        resolved = current.resolve()
        if not resolved.is_relative_to(self.root) or (resolved == self.root and not allow_root):
            raise ServiceError('不能操作工作空间根目录或外部路径', 403)
        return resolved

    def info(self, file, include_data=False):
        stat = file.stat()
        result = {'name': file.name, 'path': file.relative_to(self.root).as_posix(), 'isDirectory': file.is_dir(),
                  'size': stat.st_size if file.is_file() else 0,
                  'modifiedAt': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec='seconds')}
        if file.is_file():
            if stat.st_size > MAX_FILE:
                result['sha256'] = None
                if include_data:
                    raise ServiceError('单个文件不能超过 5 MB', 413)
            else:
                data = file.read_bytes()
                result['sha256'] = hashlib.sha256(data).hexdigest()
                if include_data:
                    result['data'] = base64.b64encode(data).decode('ascii')
        return result

    def export(self, paths):
        if not isinstance(paths, list) or not 1 <= len(paths) <= 2000:
            raise ServiceError('请选择文件或目录')
        files = {}
        total = 0
        for raw in paths:
            selected = self.path(raw)
            if not selected.exists():
                raise ServiceError('文件或目录不存在', 404)
            candidates = selected.rglob('*') if selected.is_dir() else [selected]
            for item in candidates:
                relative = item.relative_to(self.root).as_posix()
                if any(part.casefold() in BLOCKED for part in item.relative_to(self.root).parts):
                    continue
                item = self.path(relative)
                if not item.is_file() or relative in files:
                    continue
                info = self.info(item, True)
                total += info['size']
                if total > MAX_TOTAL or len(files) >= 2000:
                    raise ServiceError('单次最多 2000 个文件、合计 10 MB，请缩小范围', 413)
                files[relative] = info
        return list(files.values())

    def operation(self, body):
        with self.lock:
            try:
                return self._operation(body)
            except PermissionError as error:
                path = body.get('path', '') or '工作空间'
                if error.filename:
                    try: path = Path(error.filename).relative_to(self.root).as_posix()
                    except ValueError: pass
                code = getattr(error, 'winerror', None) or error.errno
                raise ServiceError(f'无法访问 {path}：系统拒绝访问，请检查目录权限或文件占用（系统错误 {code}）', 403) from error

    def _operation(self, body):
        action = body.get('action')
        if action == 'list':
            folder = self.path(body.get('path', ''), True)
            if not folder.is_dir():
                raise ServiceError('目录不存在', 404)
            rows = []
            for item in folder.iterdir():
                if item.name.casefold() in BLOCKED or item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
                    continue
                relative = item.relative_to(self.root).as_posix()
                try:
                    rows.append(self.info(self.path(relative)))
                except FileNotFoundError:
                    continue  # A concurrent task may have removed this entry.
                except PermissionError:
                    # Do not present an inaccessible residual item as an empty
                    # directory or fail the complete directory listing.
                    try: is_directory = item.is_dir()
                    except PermissionError: is_directory = False
                    rows.append({'name': item.name, 'path': relative, 'isDirectory': is_directory,
                                 'size': None, 'modifiedAt': '', 'sha256': None,
                                 'accessError': '系统拒绝访问，可能权限不足或文件被占用'})
                if len(rows) > 2000:
                    raise ServiceError('目录项超过 2000，请按子目录管理', 413)
            return {'path': folder.relative_to(self.root).as_posix().removeprefix('.'),
                    'items': sorted(rows, key=lambda x: (not x['isDirectory'], x['name'].casefold()))}
        if action in ('export', 'download'):
            files = self.export(body.get('paths'))
            if action == 'export':
                return {'files': files}
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
                for item in files:
                    archive.writestr(item['path'], base64.b64decode(item['data']))
            return {'name': 'workspace-files.zip', 'data': base64.b64encode(output.getvalue()).decode('ascii')}
        if action == 'upload':
            files = body.get('files')
            if not isinstance(files, list) or not 1 <= len(files) <= 2000 or type(body.get('overwrite', False)) is not bool:
                raise ServiceError('上传文件参数无效')
            decoded, seen, total = [], set(), 0
            for item in files:
                target = self.path(item.get('path'))
                key = str(target).casefold()
                if key in seen or target.is_dir() or target.exists() and not body.get('overwrite', False):
                    raise ServiceError('上传路径重复或文件已存在，请确认覆盖', 409)
                seen.add(key)
                encoded = item.get('data')
                if not isinstance(encoded, str) or len(encoded) > (MAX_FILE + 2) // 3 * 4:
                    raise ServiceError('单个文件不能超过 5 MB', 413)
                try:
                    data = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    raise ServiceError('文件编码无效')
                total += len(data)
                if len(data) > MAX_FILE or total > MAX_TOTAL:
                    raise ServiceError('单文件最多 5 MB，单次最多 10 MB', 413)
                decoded.append((target, data))
            if any(str(parent).casefold() in seen or parent.is_file() for target, _ in decoded for parent in target.parents if parent.is_relative_to(self.root)):
                raise ServiceError('文件与目录路径冲突')
            for target, data in decoded:
                self.atomic_write(target, data)
            return {'ok': True, 'count': len(decoded)}
        target = self.path(body.get('path'))
        if action == 'read':
            if not target.is_file():
                raise ServiceError('文件不存在', 404)
            info = self.info(target, True)
            try:
                info['content'] = base64.b64decode(info.pop('data')).decode('utf-8-sig')
                if '\x00' in info['content']:
                    raise UnicodeError()
            except UnicodeError:
                raise ServiceError('该文件不是 UTF-8 文本，请下载查看')
            return info
        if action == 'write':
            content = body.get('content')
            if not isinstance(content, str) or len(content.encode('utf8')) > MAX_FILE:
                raise ServiceError('文本内容无效或超过 5 MB')
            if target.exists() and (not target.is_file() or body.get('expectedHash') != self.info(target).get('sha256')):
                raise ServiceError('文件已变化，请重新读取后保存', 409)
            self.atomic_write(target, content.encode('utf8'))
            return self.info(target)
        if action == 'mkdir':
            target.mkdir(parents=True, exist_ok=True)
            return {'ok': True}
        if action == 'delete':
            if not target.exists():
                raise ServiceError('文件不存在', 404)
            if target.is_dir():
                try:
                    # The OS checks emptiness atomically. Reading the directory
                    # first can fail even when deleting the empty directory is
                    # allowed, and also races with concurrent task writers.
                    target.rmdir()
                except OSError as error:
                    if error.errno not in (errno.ENOTEMPTY, errno.EEXIST) and getattr(error, 'winerror', None) != 145:
                        raise
                    try: remaining = list(itertools.islice(target.iterdir(), 4))
                    except PermissionError:
                        raise ServiceError(f'目录 {body["path"]} 仍有内容，但系统拒绝读取，请检查目录权限或文件占用', 409) from error
                    if not remaining:
                        raise ServiceError('目录内容刚刚发生变化，请刷新后重试删除', 409) from error
                    names = '、'.join(item.name for item in remaining[:3]) + ('等' if len(remaining) > 3 else '')
                    hidden = any(item.name.casefold() in BLOCKED or item.is_symlink()
                                 or (hasattr(item, 'is_junction') and item.is_junction()) for item in remaining)
                    note = '（包含受保护或链接项，列表可能未展示）' if hidden else ''
                    raise ServiceError(f'目录 {body["path"]} 仍有内容：{names}{note}。请刷新目录并处理残留项后再删除', 409)
            else:
                if body.get('expectedHash') != self.info(target).get('sha256'):
                    raise ServiceError('文件已变化，请刷新后再删除', 409)
                target.unlink()
            return {'ok': True}
        raise ServiceError('文件操作不存在', 404)

    def atomic_write(self, target, data):
        target.parent.mkdir(parents=True, exist_ok=True)
        handle, name = tempfile.mkstemp(prefix='.code-write-', dir=target.parent)
        try:
            with os.fdopen(handle, 'wb') as output:
                output.write(data)
            os.replace(name, target)
        finally:
            Path(name).unlink(missing_ok=True)


class Service:
    def __init__(self, directory, config):
        # Check before creating workspace/log directories. Workers and upgrades
        # keep their launcher's user token; no Windows account is created here.
        self.run_user = require_user_account()
        self.directory = Path(directory).resolve()
        self.config = config
        root = Path(config['workspace'])
        self.workspace = Workspace(root if root.is_absolute() else self.directory / root)
        if self.directory.is_relative_to(self.workspace.root):
            raise ServiceError('工作空间不能包含服务安装目录或身份凭据')
        self.identity_file = self.directory / 'identity.json'
        self.identity = json.loads(self.identity_file.read_text('utf8')) if self.identity_file.exists() else {}
        self.fingerprint = platform.node() + '|' + str(uuid.getnode()) + '|' + str(self.directory)
        if self.identity.get('fingerprint') != self.fingerprint:
            self.identity = {}
        self.stop = threading.Event()
        self.request_lock = threading.Lock()
        self.active_requests = 0
        self.mq_task_active = False
        self.draining = False
        self.last_activity = time.monotonic()
        self.logger = logging.getLogger('code-server.' + str(id(self)))
        self.logger.setLevel(logging.INFO)
        (self.directory / 'logs').mkdir(exist_ok=True)
        log = RotatingFileHandler(self.directory / 'logs/service.log', maxBytes=2 * 1024 * 1024, backupCount=3, encoding='utf8')
        log.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        self.logger.addHandler(log)
        self.logger.addHandler(logging.StreamHandler())
        self.logger.info('CodeServer 运行账户：%s；新目录沿用父目录继承权限', self.run_user)

    def report(self):
        parsed = urlsplit(self.config['platform'])
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80)))
            address = sock.getsockname()[0]
        return {'name': self.config.get('name') or platform.node(), 'ipAddress': address,
                'runUser': self.run_user,
                'installDirectory': str(self.directory), 'workspace': str(self.workspace.root),
                'endpoint': self.config.get('advertiseUrl') or f'http://{address}:{self.config.get("port", 8093)}',
                'osType': platform.system(), 'osVersion': platform.platform(), 'version': VERSION, 'pid': os.getpid(),
                'upgradeSchema': 1 if os.getenv('CODESERVER_SUPERVISED') == '1' else 0, 'mqWorkerSchema': 1,
                'actualDigest': os.getenv('CODESERVER_RELEASE_DIGEST', 'source-local'),
                'launcherVersion': os.getenv('PROGRAM_LAUNCHER_VERSION', '')}

    def control(self, action):
        with self.request_lock:
            if action == 'drain':
                self.draining = True
            elif action == 'resume':
                self.draining = False
            elif action != 'status':
                raise ServiceError('控制指令无效')
            return {'activeRequests': self.active_requests, 'draining': self.draining,
                    'runUser': self.run_user,
                    'idleSeconds': time.monotonic() - self.last_activity,
                    'actualDigest': os.getenv('CODESERVER_RELEASE_DIGEST', 'source-local'), 'pid': os.getpid()}

    def platform_request(self, path, body, token=''):
        request = Request(self.config['platform'].rstrip('/') + path, data=json.dumps(body).encode('utf8'),
                          headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token,
                                   **({'X-Code-Server-ID':self.identity['serverId']} if self.identity else {})})
        with OPENER.open(request, timeout=10) as response:
            return json.loads(response.read(65536))

    def heartbeat(self):
        while not self.stop.is_set():
            try:
                payload = self.report()
                if not self.identity:
                    enrolled = self.platform_request('/api/code-servers/enroll', {**payload, 'code': self.config.get('enrollCode', '')})
                    self.identity = {**enrolled, 'fingerprint': self.fingerprint}
                    temporary = self.identity_file.with_suffix('.tmp')
                    temporary.write_text(json.dumps(self.identity, indent=2), encoding='utf8')
                    temporary.replace(self.identity_file)
                    try:
                        self.identity_file.chmod(0o600)
                    except OSError:
                        pass
                    self.logger.info('已登记代码生成服务器：%s · 版本：%s', self.identity['serverId'], VERSION)
                    self.console_title()
                self.platform_request('/api/code-servers/me/heartbeat', {**payload, 'serverId': self.identity['serverId']}, self.identity['token'])
            except Exception as error:
                # Never log credentials, prompt bodies or URL query parameters.
                self.logger.error('登记/心跳失败：%s%s', type(error).__name__, f' HTTP {error.code}' if isinstance(error, HTTPError) else '')
            self.stop.wait(5)

    def console_title(self):
        if os.name == 'nt':
            import ctypes
            digest=os.getenv('CODESERVER_RELEASE_DIGEST','source-local')
            short=digest[7:19] if digest.startswith('sha256:') else digest
            ctypes.windll.kernel32.SetConsoleTitleW(f'代码生成服务器 · {self.identity.get("serverId", "待登记")} · {VERSION} · {short}')

    def model(self, body):
        url = body.get('url')
        try:
            parsed = urlsplit(url)
            origin = f'{parsed.scheme}://{parsed.netloc}'
            if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.port == 0
                    or parsed.username or parsed.password or parsed.fragment):
                raise ValueError()
        except (ValueError, TypeError):
            raise ServiceError('模型地址必须为有效的 HTTP(S) 地址，不能包含账号密码或片段', 400)
        data = body.get('body')
        if data is not None and not isinstance(data, dict):
            raise ServiceError('模型请求体无效')
        if data is not None:
            data = dict(data)
            for key in ('prj_dir', 'input_file_dir', 'code_dir', 'output_file_dir'):
                value = data.get(key)
                if value:
                    # Model interfaces may retain absolute server-side paths; canonicalize
                    # them but still enforce the configured workspace and symlink boundary.
                    target = Path(value)
                    if target.is_absolute():
                        try:
                            value = target.relative_to(self.workspace.root).as_posix()
                        except ValueError:
                            raise ServiceError(f'{key} 必须位于本机工作空间内', 403)
                    resolved = self.workspace.path(value, True)
                    if key in ('prj_dir', 'code_dir', 'output_file_dir') or key == 'input_file_dir' and not resolved.exists():
                        resolved.mkdir(parents=True, exist_ok=True)
                    data[key] = str(resolved)
        method = body.get('method')
        if method not in ('GET', 'POST'):
            raise ServiceError('模型请求方法无效')
        timeout = body.get('timeoutSeconds', 300)
        if type(timeout) is not int or not 10 <= timeout <= 1800:
            raise ServiceError('模型超时无效')
        request = Request(url, data=json.dumps(data, ensure_ascii=False).encode('utf8') if data is not None else None,
                          headers={'Content-Type': 'application/json; charset=utf-8', 'Accept': 'text/plain, application/json, text/event-stream'}, method=method)
        self.logger.info('调用模型 %s %s%s', method, origin, parsed.path)
        try:
            return OPENER.open(request, timeout=timeout)
        except HTTPError as error:
            return error


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        self.server.service.logger.info(fmt, *args)

    def respond(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        service = self.server.service
        streaming = False
        tracked = False
        try:
            expected = service.identity.get('token', '')
            actual = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if not expected or not hmac.compare_digest(actual, expected):
                raise ServiceError('实例凭据无效', 401)
            self.connection.settimeout(30)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_JSON:
                raise ServiceError('请求体为空或超过 15 MB', 413)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ServiceError('请求必须是 JSON 对象')
            if self.path == '/api/control':
                return self.respond(200, service.control(body.get('action')))
            if self.path in ('/api/files', '/api/model'):
                with service.request_lock:
                    if self.path == '/api/model' and service.draining and not service.mq_task_active:
                        raise ServiceError('服务等待空闲升级，请稍后重试', 503)
                    service.active_requests += 1
                    tracked = True
            if self.path == '/api/files':
                if body.get('action') == 'logs':
                    kind=body.get('kind','service')
                    if kind not in ('service','launcher','worker'):
                        raise ServiceError('日志类型无效')
                    file=service.directory/'logs'/(kind+'.log')
                    data = file.read_bytes()[-65536:].decode('utf8', errors='replace') if file.exists() else ''
                    return self.respond(200, {'content': data})
                result = service.workspace.operation(body)
                service.logger.info('文件操作 %s', body.get('action'))
                return self.respond(200, result)
            if self.path == '/api/model':
                with service.model(body) as response:
                    self.send_response(response.code)
                    self.send_header('Content-Type', response.headers.get('Content-Type', 'text/plain; charset=utf-8'))
                    self.send_header('Cache-Control', 'no-store, no-transform')
                    self.send_header('X-Accel-Buffering', 'no')
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    streaming = True
                    self.close_connection = True
                    total = 0
                    while True:
                        chunk = response.read1(4096)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_TOTAL:
                            raise ServiceError('模型输出超过 10 MB', 413)
                        self.wfile.write(chunk)
                        self.wfile.flush()
                return
            raise ServiceError('接口不存在', 404)
        except (BrokenPipeError, ConnectionResetError):
            service.logger.info('平台连接已断开')
        except Exception as error:
            service.logger.error('请求失败：%s%s', type(error).__name__, ': ' + str(error) if isinstance(error, ServiceError) else '')
            if not streaming:
                status = error.status if isinstance(error, ServiceError) else 502 if isinstance(error, (OSError, URLError)) else 400
                self.respond(status, {'message': str(error) if isinstance(error, ServiceError) else '远程服务请求失败，请检查服务日志'})
        finally:
            if tracked:
                with service.request_lock:
                    service.active_requests -= 1
                    service.last_activity = time.monotonic()


def main():
    here = Path(os.getenv('CODESERVER_INSTANCE_DIR', str(Path(__file__).resolve().parent))).resolve()
    config_path = here / 'config.json'
    if not config_path.exists():
        shutil.copyfile(here / 'config.example.json', config_path)
        raise SystemExit('已创建 config.json，请配置平台地址和登记码后重新启动。')
    config = json.loads(config_path.read_text('utf-8-sig'))
    service = Service(here, config)
    server = ThreadingHTTPServer((config.get('host', '0.0.0.0'), config.get('port', 8093)), Handler)
    server.daemon_threads = True
    server.service = service
    thread = threading.Thread(target=service.heartbeat, daemon=True)
    thread.start()
    if __package__:
        from .mq_worker import run as consume_mq
    else:
        from mq_worker import run as consume_mq
    threading.Thread(target=consume_mq,args=(service,),name='code-generation-tasks',daemon=True).start()
    def stop_service(*_):
        service.stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop_service)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, stop_service)
    print(f'代码生成服务器 {VERSION} · 工作空间：{service.workspace.root}', flush=True)
    print('程序版本 ID：'+os.getenv('CODESERVER_RELEASE_DIGEST','source-local'),flush=True)
    if service.identity:
        print(f'实例 ID：{service.identity["serverId"]}', flush=True)
    service.console_title()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        service.stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
