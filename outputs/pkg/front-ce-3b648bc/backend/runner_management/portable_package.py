"""Fresh Windows Runner installations, including a private Python runtime."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import io
import json
import os
import re
from pathlib import Path
import secrets
import struct
import sys
import sysconfig
import threading
from urllib.parse import urlparse
import zipfile

from .artifacts import ArtifactStore, verify_artifact
from .program_dependencies import DEFAULT_PIP_SETTINGS

BUILD_LOCK = threading.Lock()
DEPENDENCIES = ('cryptography', 'cffi', 'pycparser')
RUNTIME_EXCLUDES = {'site-packages', '__pycache__', 'test', 'tests', 'idlelib', 'tkinter', 'turtledemo'}

LAUNCHER = r'''"""Run this folder's bundled Python; identity is created only on first start."""
import argparse
import ipaddress
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import runpy
import socket
import sys
from urllib.parse import urlparse
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

def announce_instance(identity, directory, version):
    runner_id = identity['runnerId']
    version_label = version[7:19] if version.startswith('sha256:') else version
    if os.name == 'nt':
        import ctypes
        try:
            ctypes.windll.kernel32.SetConsoleTitleW('Runner | ' + runner_id + ' | 版本 ' + version_label + ' | ' + str(directory))
        except OSError:
            pass
    print('Runner 实例 ID：' + runner_id + '\nRunner 版本 ID：' + version + '\nRunner 目录：' + str(directory), flush=True)
    logging.info('Runner 实例 ID=%s；版本 ID=%s；目录=%s', runner_id, version, directory)

def main():
    parser = argparse.ArgumentParser(description='便携 Runner 启动入口')
    parser.add_argument('--check', action='store_true', help='检查运行环境，不登记、不启动实例')
    parser.add_argument('--server', help='覆盖配置中的管理服务地址')
    parser.add_argument('--enroll-code', help='覆盖配置中的一次性接入码')
    args = parser.parse_args()
    config_path = ROOT / 'runner.json'
    config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    server = (args.server or config.get('server', '')).strip().rstrip('/')
    parsed = urlparse(server)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SystemExit('请在 runner.json 中设置正确的管理服务地址，例如 http://192.168.1.36:8092')
    # LAN management traffic must not be sent through a workstation's web proxy.
    try:
        local_server = ipaddress.ip_address(parsed.hostname).is_private
    except ValueError:
        local_server = parsed.hostname == 'localhost'
    if local_server:
        bypass = ','.join(filter(None, [os.environ.get('NO_PROXY', ''), os.environ.get('no_proxy', ''), parsed.hostname]))
        os.environ['NO_PROXY'] = os.environ['no_proxy'] = bypass
    logging.info('启动 Runner；目录=%s；管理服务=%s；PID=%s', ROOT, server, os.getpid())
    if config.get('ipAddress'):
        os.environ['RUNNER_ADVERTISE_IP'] = config['ipAddress']
    meta = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    from runner_management.artifacts import verify_artifact
    stem = ROOT / 'instance' / 'runner-versions' / meta['runnerDigest'][7:]
    verify_artifact(stem.with_suffix('.zip').read_bytes(), meta['runnerDigest'],
                    stem.with_suffix('.sig').read_text(encoding='ascii'), meta['publicKey'])
    if args.check:
        from runner_management.runner import Runner
        import cryptography
        print(json.dumps({'ok': True, 'python': sys.executable, 'pythonHome': sys.prefix, 'cryptography': cryptography.__file__, 'runnerDigest': meta['runnerDigest'], 'server': server}, ensure_ascii=False))
        return
    code = args.enroll_code if args.enroll_code is not None else config.get('enrollCode', '')
    while True:
        try:
            from runner_management.runner import Runner
            runner = Runner(ROOT / 'instance', server)
            if runner.identity and not runner.identity_matches_directory():
                runner.identity = None
            if config.get('packageToken') and args.enroll_code is None and not code:
                from runner_management.runner import json_request
                if not runner.identity:
                    identity = json_request(server, '/api/runners/enroll', payload={
                        'packageToken': config['packageToken'], 'installDirectory': str(runner.directory),
                        'ipAddress': runner.ip_address, 'platform': sys.platform,
                        'hostName': socket.gethostname(),
                        **getattr(runner, 'os_info', {}),
                        'capabilities': ['python', 'deployment-entry', 'retry-policy'],
                    })
                    identity['installDirectory'] = str(runner.directory)
                    temporary = runner.identity_path.with_suffix('.tmp')
                    temporary.write_text(json.dumps(identity), encoding='utf-8')
                    os.replace(temporary, runner.identity_path)
                    runner.identity = identity
                    print('已登记独立 Runner 实例：' + identity['runnerId'], flush=True)
            if not runner.identity:
                if not code:
                    code = input('请输入管理页生成的远程接入码：').strip()
                if not code:
                    raise SystemExit('未输入接入码')
                runner.enroll(code)
                print('已登记独立 Runner 实例：' + runner.identity['runnerId'], flush=True)
            current_path = runner.directory / 'current.json'
            current_digest = json.loads(current_path.read_text(encoding='utf-8'))['digest'] if current_path.exists() else 'source-local'
            announce_instance(runner.identity, runner.directory, current_digest)
            sys.argv = [str(ROOT / 'runner_management' / 'start.py'), '--dir', str(ROOT / 'instance'), '--server', server]
            if code:
                sys.argv.extend(['--enroll-code', code])
            runpy.run_path(sys.argv[0], run_name='__main__')
            break
        except RuntimeError as exc:
            if '登记码' not in str(exc):
                raise
            print('包内接入凭据已过期或失效，请重新下载 Runner 包，或在服务器页面生成远程接入码。', flush=True)
            code = input('请输入新接入码：').strip()
            if not code:
                raise SystemExit('未输入接入码')

if __name__ == '__main__':
    log_root = ROOT / 'instance' / 'logs'
    log_root.mkdir(parents=True, exist_ok=True)
    log_path = log_root / 'startup.log'
    handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    try:
        main()
    except URLError:
        logging.exception('连接管理服务失败')
        print('无法连接管理服务，请核对 runner.json 中的 server 地址、服务器 8092 端口及两台机器之间的网络。', file=sys.stderr)
        print('完整错误已保存到：' + str(log_path), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        logging.exception('Runner 启动失败')
        print('Runner 启动失败，完整错误已保存到：' + str(log_path), file=sys.stderr)
        raise SystemExit(1)
    except SystemExit as exc:
        if exc.code:
            logging.error('启动退出：%s', exc.code)
        raise
    finally:
        logging.shutdown()
'''

START_CMD = '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nset "PYTHONHOME=%~dp0runtime"\r\nset "PYTHONPATH="\r\nset "PYTHONNOUSERSITE=1"\r\n"%~dp0runtime\\python.exe" -X utf8 start.py\r\nif errorlevel 1 pause\r\n'

README = '''Runner Windows 64 位便携包

1. 将 ZIP 解压为一个独立文件夹，复制到目标 Windows 64 位机器。
2. runner.json 已填管理服务地址，确认目标机器能访问该地址。修改地址时必须指向同一个平台的 Runner 管理服务。
3. 双击“启动Runner.cmd”，使用包内 Python，不需要安装系统 Python。
4. 首次启动自动登记新实例。同一个包可以复制到多个目录，分别双击启动，每个目录会登记独立的实例 ID。同机多个实例不需要修改端口或填写不同的接入码。
   包内接入凭据有效期 15 分钟，在有效期内可登记多个实例。过期后重新下载包，或在启动窗口输入服务器页面新生成的远程接入码。已经登记的实例重启不受此有效期限制。
5. 登记后在“机器配置”绑定部署配置、下发代码，再启动处理程序。

每份新下载包不含现有实例身份、日志、机器配置或数据库密码。建议分别解压原始包，如 E:\\runner-1 和 E:\\runner-2，各自拥有独立的身份、日志、下发文件和进程。也支持将已登记文件夹复制到新目录，启动时会识别目录变化并重新登记，不能同时用同一个目录启动多份 Runner。
已内置 Runner 必需依赖。业务脚本在部署根目录提供 requirements.txt 并随代码下发后，Runner 启动前自动在该部署独立环境安装第三方库，清单未变化时复用环境。安装输出进入运行日志。浏览器程序及其他外部程序仍按业务要求准备，不随 Runner 包打包。
依赖安装默认直接连接 https://pypi.org/simple，不继承机器的 HTTP 代理、pip.ini 或 PIP_* 安装配置，不修改系统设置。每个实例可在 instance\\pip.json 设置 indexUrl 软件源和 proxy 代理；proxy 为空表示直接连接。修改后下一次启动安装时生效，无需重启 Runner。requirements.txt 内指定的软件源优先，企业证书环境仍保留。
包内已附带 instance\\pip.json 默认配置；旧实例升级后，缺少该文件时自动补齐，已有的自定义软件源及代理设置保持不变。每个文件夹的实例配置互相独立。
命令行检查：runtime\\python.exe -X utf8 start.py --check（不登记、不启动）。
首次启动及登记失败的完整异常保存在 instance\\logs\\startup.log，单文件最多 5 MB，保留 3 份历史备份。
每次启动控制台标题均显示 Runner 实例 ID、实际运行版本 ID（12 位摘要）和安装目录；控制台显示完整实例 ID 和完整版本摘要。初始版本取 instance/current.json，升级或回滚启动新进程时同步更新标题和输出，不以 package.json 的初始下载版本作为运行版本。
Runner 运行日志：instance\\logs\\runner\\<运行记录>\\console-0001.log；处理程序输出：instance\\logs\\programs\\<运行配置>\\<运行记录>\\console-0001.log。
Runner 登记及心跳自动上报实际操作系统类型和版本，在平台“服务器”页显示；旧 Runner 升级后补齐版本信息。
连接超时时，在目标机器 PowerShell 执行 Test-NetConnection <管理服务IP> -Port 8092，并用浏览器打开 http://<管理服务IP>:8092/health。包内启动器会让内网管理服务连接绕过系统 HTTP 代理，不改系统代理设置。
关闭启动窗口会停止该目录的 Runner；平常可在平台关闭处理进程并保留 Runner 在线。Runner 升级通过平台的已签名版本完成。
'''


def validate_server(value):
    from .server import ApiError
    if not isinstance(value, str) or len(value) > 500:
        raise ApiError('管理服务地址无效')
    value = value.strip().rstrip('/')
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        raise ApiError('管理服务地址无效')
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or any(ch.isspace() for ch in value)):
        raise ApiError('请填写管理服务根地址，例如 http://192.168.1.36:8092，不带接口路径或凭据')
    return value


def runtime_files():
    """Explicit interpreter/stdlib + installed public wheel files, never a workspace copy."""
    from .server import ApiError
    if os.name != 'nt' or struct.calcsize('P') != 8:
        raise ApiError('当前服务器未提供 Windows 64 位便携 Python 运行环境', 503)
    home = Path(sys.base_prefix)
    files = {}
    for name in ('python.exe', 'python3.dll', f'python{sys.version_info.major}{sys.version_info.minor}.dll',
                 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt'):
        if not (home / name).is_file():
            raise ApiError('服务器 Python 运行环境缺少必要文件：' + name, 503)
        files[name] = home / name
    for folder in ('DLLs', 'Lib'):
        for path in (home / folder).rglob('*'):
            relative = path.relative_to(home)
            if path.is_file() and not path.is_symlink() and not any(part in RUNTIME_EXCLUDES for part in relative.parts) and path.suffix not in ('.pyc', '.pyo'):
                files[relative.as_posix()] = path
    site = Path(sysconfig.get_path('purelib')).resolve()
    for name in DEPENDENCIES:
        try:
            distribution = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            raise ApiError('服务器缺少 Runner 打包依赖：' + name, 503)
        for entry in distribution.files or []:
            path = distribution.locate_file(entry).resolve()
            if (path.is_file() and path.is_relative_to(site) and '__pycache__' not in path.parts
                    and path.suffix not in ('.pyc', '.pyo')):
                files['Lib/site-packages/' + path.relative_to(site).as_posix()] = path
    return files


def runtime_archive(app):
    prepared = os.getenv('RUNNER_WINDOWS_RUNTIME', '').strip()
    if prepared:
        from .server import ApiError
        path = Path(prepared).resolve()
        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
                if ('python.exe' not in names or 'python3.dll' not in names
                        or 'Lib/encodings/__init__.py' not in names
                        or not any(re.fullmatch(r'python3[0-9]+\.dll', name) for name in names)
                        or any(name.startswith(('/', '\\')) or '\\' in name or ':' in name or '..' in name.split('/') for name in names)):
                    raise ValueError('invalid runtime archive')
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            raise ApiError('预置 Windows Python 运行环境无效，请检查 RUNNER_WINDOWS_RUNTIME', 503) from exc
        return path
    files = runtime_files()
    metadata = [(name, path.stat().st_size, path.stat().st_mtime_ns) for name, path in sorted(files.items())]
    fingerprint = hashlib.sha256(json.dumps(metadata).encode()).hexdigest()
    target = app.data_dir / 'portable-runtime' / (fingerprint + '.zip')
    with BUILD_LOCK:
        if not target.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix('.tmp')
            try:
                with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
                    for name, path in sorted(files.items()):
                        archive.writestr(ArtifactStore._zip_info(name), path.read_bytes())
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
    return target


def runtime_version():
    return os.getenv('RUNNER_WINDOWS_PYTHON_VERSION', '').strip() or '.'.join(map(str, sys.version_info[:3]))


def package_info(app, default_server):
    from .server import as_release
    with app.store.connect() as db:
        releases = [as_release(row) for row in db.execute("SELECT * FROM releases WHERE kind='runner' AND status='published' AND platform IN ('win32','any') ORDER BY published_at DESC,digest DESC")]
    return {'server': validate_server(os.getenv('RUNNER_PUBLIC_URL', default_server)), 'platform': 'windows-x64',
            'pythonVersion': runtime_version(), 'releases': releases,
            'enrollmentMinutes': 15, 'ready': bool(os.getenv('RUNNER_WINDOWS_RUNTIME', '').strip()) or (os.name == 'nt' and struct.calcsize('P') == 8)}


def build_package(app, payload):
    from .server import ApiError
    server = validate_server(payload.get('server'))
    digest = payload.get('digest')
    if not isinstance(digest, str) or len(digest) != 71 or not digest.startswith('sha256:'):
        raise ApiError('请选择有效的 Runner 版本', 422)
    with app.store.connect() as db:
        row = db.execute("SELECT * FROM releases WHERE digest=? AND kind='runner' AND status='published' AND platform IN ('win32','any')", (digest,)).fetchone()
    if not row:
        raise ApiError('请选择已发布的 Windows Runner 版本', 422)
    data = app.artifacts.read(digest)
    verify_artifact(data, digest, row['signature'], app.artifacts.public_key)
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        manifest = json.loads(source.read('manifest.json'))
        if manifest.get('kind') != 'runner' or manifest.get('entryModule') != 'runner_management.runner':
            raise ApiError('Runner 版本入口无效', 422)
        sources = {name: source.read(name) for name in source.namelist() if name.startswith('runner_management/') and name.endswith('.py')}
    if 'runner_management/start.py' not in sources:
        raise ApiError('此旧版本缺少文件夹启动入口，请选择较新的 Runner 版本', 422)
    runtime = runtime_archive(app)
    code = secrets.token_urlsafe(24)
    expiry = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(timespec='seconds')
    with app.store.connect() as db:
        db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)', (
            'portable-enroll:' + hashlib.sha256(code.encode()).hexdigest(), json.dumps({'expiresAt': expiry, 'digest': digest})))
    content = io.BytesIO()
    with zipfile.ZipFile(content, 'w', zipfile.ZIP_DEFLATED) as archive:
        with zipfile.ZipFile(runtime) as library:
            for name in library.namelist():
                archive.writestr(ArtifactStore._zip_info('Runner/runtime/' + name), library.read(name))
        for name, body in sources.items():
            archive.writestr(ArtifactStore._zip_info('Runner/' + name), body)
        extras = {'start.py': LAUNCHER.encode('utf-8'), '启动Runner.cmd': START_CMD.encode('utf-8'), '使用说明.txt': README.encode('utf-8-sig'),
                  'runner.json': json.dumps({'server': server, 'packageToken': code, 'enrollExpiresAt': expiry, 'ipAddress': ''}, ensure_ascii=False, indent=2).encode('utf-8'),
                  'package.json': json.dumps({'runnerDigest': digest, 'publishedAt': row['published_at'], 'pythonVersion': runtime_version(),
                                              'platform': 'windows-x64', 'publicKey': app.artifacts.public_key}).encode('utf-8'),
                  'instance/current.json': json.dumps({'digest': digest}).encode('utf-8'),
                  'instance/pip.json': json.dumps(DEFAULT_PIP_SETTINGS, indent=2).encode('utf-8'),
                  'instance/runner-versions/' + digest[7:] + '.zip': data,
                  'instance/runner-versions/' + digest[7:] + '.sig': row['signature'].encode('ascii')}
        for name, body in extras.items():
            archive.writestr(ArtifactStore._zip_info('Runner/' + name), body)
    return 'Runner-windows-x64-' + digest[7:19] + '.zip', content.getvalue()
