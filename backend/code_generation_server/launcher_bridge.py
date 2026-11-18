"""One-time, signed migration of an installed legacy supervisor, without re-enrollment.

After migration the stable host switches versioned launchers and never rewrites
instance configuration, identity, workspace, or the private Python environment.
"""
import ctypes
import io
import json
import os
import shlex
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.request import Request, urlopen
import zipfile

SOURCE_FILES = ('start.py', 'start.cmd', '__init__.py', 'service.py', 'bootstrapper.py',
                'launcher_host.py', 'launcher_bridge.py', 'mq_worker.py', 'requirements.txt')
SUPPORT_FILES = ('__init__.py', 'artifacts.py', 'bootstrapper.py', 'program_launcher.py', 'runner.py')


def supervisor_locked(root):
    path = root / '.supervisor.lock'
    if not path.is_file():
        return False
    with path.open('r+b') as stream:
        try:
            if os.name == 'nt':
                import msvcrt
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            return False
        except OSError:
            return True


def process_details(pid):
    if os.name != 'nt':
        command = Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0', b' ').decode()
        fields = Path(f'/proc/{pid}/stat').read_text().split(') ', 1)[1].split()
        return command, int(fields[1])
    from ctypes import wintypes
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = api.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ProcessLookupError(pid)
    class UnicodeString(ctypes.Structure):
        _fields_ = [('length', wintypes.USHORT), ('maximum', wintypes.USHORT), ('buffer', ctypes.c_void_p)]
    class ProcessBasic(ctypes.Structure):
        _fields_ = [('reserved', ctypes.c_void_p), ('peb', ctypes.c_void_p), ('reserved2', ctypes.c_void_p * 2),
                    ('pid', ctypes.c_size_t), ('parent', ctypes.c_size_t)]
    query = ctypes.WinDLL('ntdll').NtQueryInformationProcess
    query.argtypes = [wintypes.HANDLE, wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
    query.restype = wintypes.LONG
    try:
        size = wintypes.ULONG()
        query(handle, 60, None, 0, ctypes.byref(size))
        if not 0 < size.value <= 131072:
            raise ValueError('无法核对旧启动器进程')
        data = ctypes.create_string_buffer(size.value)
        if query(handle, 60, data, size.value, ctypes.byref(size)) < 0:
            raise ValueError('无法核对旧启动器命令')
        text = UnicodeString.from_buffer(data)
        command = ctypes.wstring_at(text.buffer, text.length // 2)
        basic = ProcessBasic()
        if query(handle, 0, ctypes.byref(basic), ctypes.sizeof(basic), ctypes.byref(size)) < 0:
            raise ValueError('无法核对旧启动器父进程')
        return command, int(basic.parent)
    finally:
        api.CloseHandle(handle)


def find_supervisor(root, worker_pid):
    """Older packages did not lock a file; validate the actual ancestor command instead."""
    _, parent = process_details(worker_pid)
    for _ in range(4):
        if parent <= 1:
            break
        command, ancestor = process_details(parent)
        args = [value.strip('"') for value in shlex.split(command, posix=False)]
        scripts = [value for value in args[1:] if not value.startswith('-')]
        expected = str(root / 'start.py').replace('\\', '/').lower()
        if '-c' not in args and any(value.replace('\\', '/').lower() in ('start.py', './start.py', expected) for value in scripts):
            return parent, stamp(parent)
        if '-m' in args and 'code_generation_server.start' in args:
            return parent, stamp(parent)
        parent = ancestor
    return None


def owned_by(worker_pid):
    parent = os.getppid()
    for _ in range(4):
        if parent == worker_pid:
            return True
        if parent <= 1:
            break
        try:
            _, parent = process_details(parent)
        except (OSError, ValueError):
            break
    return False


def request_shutdown(root, timeout=90):
    """IPC also works for Windows background processes without an attached console."""
    state = json.loads((root / '.launcher-host-state.json').read_text('utf8'))
    (root / '.launcher-host-stop.json').write_text(json.dumps({'hostId': state['hostId']}))
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        try:
            if stamp(state['pid']) != state['stamp']:
                return
        except (ProcessLookupError, FileNotFoundError):
            return
        time.sleep(0.25)
    raise RuntimeError('等待新启动器退出超时，保留备份，未覆盖运行中的程序')


def stamp(pid):
    if os.name == 'nt':
        from ctypes import wintypes
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        api.OpenProcess.restype = wintypes.HANDLE
        api.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = api.OpenProcess(0x1000 | 0x100000, False, pid)
        if not handle:
            raise ProcessLookupError(pid)
        try:
            if api.WaitForSingleObject(handle, 0) == 0:
                raise ProcessLookupError(pid)
            values = [wintypes.FILETIME() for _ in range(4)]
            if not api.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)):
                raise OSError(ctypes.get_last_error())
            return str((values[0].dwHighDateTime << 32) | values[0].dwLowDateTime)
        finally:
            api.CloseHandle(handle)
    fields = Path(f'/proc/{pid}/stat').read_text().split(') ', 1)[1].split()
    if fields[0] == 'Z':
        raise ProcessLookupError(pid)
    return fields[19]


def stop_exact(pid, expected, timeout=55):
    """Never signal a reused PID; Windows holds a process handle through termination."""
    if pid <= 1 or pid == os.getpid():
        raise ValueError('升级进程标识无效')
    try:
        if stamp(pid) != expected:
            raise ValueError('进程代次已变化，取消自动更新')
    except (ProcessLookupError, FileNotFoundError):
        return
    if os.name == 'nt':
        from ctypes import wintypes
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        api.OpenProcess.restype = wintypes.HANDLE
        api.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        api.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = api.OpenProcess(0x1000 | 0x100000 | 1, False, pid)
        if not handle:
            raise ProcessLookupError(pid)
        try:
            values = [wintypes.FILETIME() for _ in range(4)]
            if not api.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)):
                raise OSError(ctypes.get_last_error())
            actual = str((values[0].dwHighDateTime << 32) | values[0].dwLowDateTime)
            if actual != expected:
                raise ValueError('进程代次已变化，取消自动更新')
            # Generation and workspace writes have already drained before this call.
            if not api.TerminateProcess(handle, 0) or api.WaitForSingleObject(handle, int(timeout * 1000)) != 0:
                raise RuntimeError('旧启动器未退出，取消替换')
        finally:
            api.CloseHandle(handle)
    else:
        os.kill(pid, signal.SIGTERM)
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            try:
                if stamp(pid) != expected:
                    return
            except (FileNotFoundError, ProcessLookupError):
                return
            time.sleep(0.1)
        raise RuntimeError('旧启动器未退出，取消替换')


def check_legacy(service):
    supervisor = find_supervisor(service.directory, os.getpid())
    if not supervisor:
        return
    if time.monotonic() < getattr(service, '_next_launcher_check', 0):
        return
    service._next_launcher_check = time.monotonic() + 30
    previous = getattr(service, '_launcher_bridge_process', None)
    if previous and previous.poll() is None:
        return
    root = service.directory
    python = root / '.runtime' / 'python' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    command = [str(python) if python.is_file() else sys.executable, '-B', '-m',
               'code_generation_server.launcher_bridge', str(root), str(supervisor[0]), supervisor[1],
               str(os.getpid()), stamp(os.getpid())]
    with (root / 'logs/launcher-migration.log').open('ab') as output:
        service._launcher_bridge_process = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL,
            stdout=output, stderr=output, env=dict(os.environ, PYTHONUNBUFFERED='1'),
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == 'nt' else 0,
            start_new_session=os.name != 'nt')


def verify_bundle(data, digest, signature, public_key):
    try:
        from runner_management.artifacts import verify_artifact
    except ModuleNotFoundError:
        from backend.runner_management.artifacts import verify_artifact
    verify_artifact(data, digest, signature, public_key)
    expected = {'code_generation_server/' + name for name in SOURCE_FILES}
    expected |= {'runner_management/' + name for name in SUPPORT_FILES}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if set(names) != expected | {'manifest.json'} or len(names) != len(set(names)):
            raise ValueError('启动器制品文件清单无效')
        manifest = json.loads(archive.read('manifest.json'))
        if manifest.get('kind') != 'code-server-launcher' or manifest.get('entryModule') != 'code_generation_server.start':
            raise ValueError('启动器制品类型无效')
        files = {}
        for name in expected:
            relative = name.removeprefix('code_generation_server/')
            content = archive.read(name)
            if name.endswith('.py'):
                compile(content, name, 'exec')
            files[relative] = content
        return files


class Migration:
    def __init__(self, root):
        self.root = root.resolve()
        self.config = json.loads((root / 'config.json').read_text('utf-8-sig'))
        self.identity = json.loads((root / 'identity.json').read_text('utf8'))
        self.server = self.config['platform'].rstrip('/')
        self.request_id = None

    def call(self, path, body=None):
        headers = {'Authorization': 'Bearer ' + self.identity['token'],
                   'X-Code-Server-ID': self.identity['serverId'], 'Content-Type': 'application/json'}
        request = Request(self.server + path, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    def control(self, action):
        host = self.config.get('host', '127.0.0.1')
        if host in ('0.0.0.0', '::'):
            host = '127.0.0.1'
        if ':' in host:
            host = '[' + host + ']'
        request = Request(f'http://{host}:{self.config.get("port", 8093)}/api/control',
            headers={'Authorization': 'Bearer ' + self.identity['token'], 'Content-Type': 'application/json'},
            data=json.dumps({'action': action}).encode())
        with urlopen(request, timeout=10) as response:
            return json.load(response)

    def report(self, status, message):
        self.call('/api/code-servers/me/launcher-result', {'requestId': self.request_id, 'status': status, 'message': message[:1500]})

    def download(self, digest):
        headers = {'Authorization': 'Bearer ' + self.identity['token'], 'X-Code-Server-ID': self.identity['serverId']}
        with urlopen(Request(self.server + '/api/code-servers/me/artifacts/' + digest, headers=headers), timeout=30) as response:
            data = response.read(16 * 1024 * 1024 + 1)
            signature = response.headers.get('X-Artifact-Signature', '')
        if len(data) > 16 * 1024 * 1024:
            raise ValueError('启动器制品过大')
        key = self.identity.get('publicKey')
        if not key:
            raise ValueError('实例缺少受信任签名公钥')
        return data, signature, verify_bundle(data, digest, signature, key)

    def start(self):
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('CODESERVER_', 'PROGRAM_LAUNCHER_')) and key != 'PYTHONPATH'}
        output = (self.root / 'logs/launcher-restart.log').open('ab')
        try:
            child = subprocess.Popen([sys.executable, '-B', str(self.root / 'start.py')], cwd=self.root,
                env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
                start_new_session=os.name != 'nt')
            (self.root / '.launcher-restart.json').write_text(json.dumps({'pid': child.pid, 'stamp': stamp(child.pid)}))
            return child
        finally:
            output.close()

    def wait_health(self, child, digest, timeout=100):
        until = time.monotonic() + timeout
        while time.monotonic() < until and child.poll() is None:
            try:
                remote = self.call('/api/code-servers/me/status')
                local = self.control('status')
                if (remote.get('launcherDigest') == digest and remote.get('status') == 'online'
                        and remote.get('pid') == local.get('pid') and remote.get('launcherBootId') == local.get('launcherBootId')
                        and local.get('launcherBootId')):
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def apply(self, digest, data, signature, files, parent_pid, parent_stamp, worker_pid, worker_stamp):
        root = self.root
        backup = root / '.runtime' / 'launcher-migrations' / uuid.uuid4().hex
        if not backup.resolve().is_relative_to(root):
            raise ValueError('启动器备份目录不在实例目录内')
        backup.mkdir(parents=True)
        paths = [*files, 'launcher-current.json']
        before = {}
        for name in paths:
            path = root / name
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError('启动器安装目录包含符号链接')
            before[name] = path.read_bytes() if path.is_file() else None
            if before[name] is not None:
                saved = backup / name; saved.parent.mkdir(parents=True, exist_ok=True); saved.write_bytes(before[name])
        # Stage the verified artifact before touching a healthy installation.
        cache = root / 'code-server-launchers'
        if cache.is_symlink() or not cache.resolve().is_relative_to(root):
            raise ValueError('启动器缓存目录不在实例目录内')
        cache.mkdir(exist_ok=True)
        (cache / (digest[7:] + '.zip')).write_bytes(data)
        (cache / (digest[7:] + '.sig')).write_text(signature, encoding='ascii')
        self.report('upgrading', '已验证启动器，等待旧实例退出后自动接入')
        stop_exact(parent_pid, parent_stamp)
        stop_exact(worker_pid, worker_stamp)
        child = None
        try:
            for name, content in {**files, 'launcher-current.json': json.dumps({'digest': digest}).encode()}.items():
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_name(path.name + '.launcher-tmp')
                temporary.write_bytes(content); temporary.replace(path)
            child = self.start()
            if not self.wait_health(child, digest):
                raise RuntimeError('新启动器健康检查失败')
            self.report('succeeded', '旧实例已自动接入启动器升级，身份和工作空间保留')
        except Exception:
            if child and child.poll() is None:
                request_shutdown(root)
                child.wait(timeout=90)
            for name, content in before.items():
                path = root / name
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_bytes(content)
            self.start()
            raise

    def run(self, parent_pid, parent_stamp, worker_pid, worker_stamp):
        if not owned_by(worker_pid) or find_supervisor(self.root, worker_pid) != (parent_pid, parent_stamp):
            raise ValueError('升级请求不属于当前服务进程')
        local = self.control('status')
        remote = self.call('/api/code-servers/me/status')
        if local.get('pid') != worker_pid or remote.get('pid') != worker_pid:
            raise ValueError('服务进程已变化，取消更新')
        desired = self.call('/api/code-servers/me/launcher-desired')
        if not desired.get('digest'):
            return
        self.request_id = desired['requestId']
        digest = desired['digest']
        try:
            data, signature, files = self.download(digest)
            status = self.control('drain')
            until = time.monotonic() + 1800
            while status['activeRequests'] or status['idleSeconds'] < 2:
                if time.monotonic() >= until:
                    raise RuntimeError('等待任务完成超时，保留旧启动器')
                time.sleep(0.5); status = self.control('status')
            self.apply(digest, data, signature, files, parent_pid, parent_stamp, worker_pid, worker_stamp)
        except Exception as error:
            try:
                self.control('resume')
            except Exception:
                pass
            self.report('failed', str(error) or type(error).__name__)
            raise


def main():
    root, parent, parent_stamp, worker, worker_stamp = sys.argv[1:]
    migration = Migration(Path(root))
    migration.run(int(parent), parent_stamp, int(worker), worker_stamp)


if __name__ == '__main__':
    main()
