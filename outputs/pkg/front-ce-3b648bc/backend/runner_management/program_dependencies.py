"""Install declared program dependencies in a per-deployment virtual environment."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time
from urllib.parse import urlsplit

from .bundle_install import linked
from .runtime_logs import ConsoleCapture

DEFAULT_PIP_SETTINGS = {'indexUrl': 'https://pypi.org/simple', 'proxy': ''}


def ensure_pip_settings(directory: Path):
    """Seed missing instance settings without replacing a user's configuration."""
    path = directory / 'pip.json'
    try:
        with path.open('x', encoding='utf-8') as output:
            output.write(json.dumps(DEFAULT_PIP_SETTINGS, ensure_ascii=False, indent=2) + '\n')
    except FileExistsError:
        pass
    return path


def requirement_files(snapshot: Path) -> dict[str, str]:
    """Included requirements/constraints must also belong to the signed snapshot."""
    files = {}
    root = snapshot.resolve()
    def visit(path):
        path = path.resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError('依赖清单引用必须是部署目录内已下发的文件')
        name = path.relative_to(root).as_posix()
        if name in files:
            return
        data = path.read_bytes()
        if len(files) >= 50 or len(data) > 1024 * 1024:
            raise ValueError('依赖清单超过 50 个文件或单文件超过 1 MB')
        files[name] = hashlib.sha256(data).hexdigest()
        for line in data.decode('utf-8-sig').splitlines():
            line = line.strip()
            if not line.startswith(('-r', '-c', '--requirement', '--constraint')):
                continue
            words = shlex.split(line, comments=True)
            if not words:
                continue
            option = words[0]
            if option in ('-r', '-c', '--requirement', '--constraint'):
                reference = words[1] if len(words) > 1 else ''
            elif option.startswith(('--requirement=', '--constraint=')):
                reference = option.split('=', 1)[1]
            elif option.startswith(('-r', '-c')) and not option.startswith('--'):
                reference = option[2:]
            else:
                continue
            if not reference:
                raise ValueError('依赖清单引用不能为空')
            visit(path.parent / reference)
    visit(root / 'requirements.txt')
    return files


def clean_environment():
    env = {key: value for key, value in os.environ.items()
           if not key.upper().startswith('RUNNER_') and key.upper() not in ('PYTHONHOME', 'PYTHONPATH')}
    # PYTHONIOENCODING affects console streams only. Pip also decodes UTF-8
    # requirement files using the interpreter's default file encoding.
    env.update(PYTHONNOUSERSITE='1', PYTHONUTF8='1', PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1',
               PIP_NO_INPUT='1', PIP_DISABLE_PIP_VERSION_CHECK='1')
    return env


def installation_environment(directory: Path):
    """Pip has its own instance settings, independent of workstation proxies."""
    path = directory / 'pip.json'
    settings = {}
    if path.exists():
        if linked(path) or path.stat().st_size > 16384:
            raise ValueError('实例 pip.json 必须是普通文件且不能超过 16 KB')
        try:
            settings = json.loads(path.read_text(encoding='utf-8-sig'))
        except (OSError, ValueError) as exc:
            raise ValueError('实例 pip.json 格式错误，请使用 UTF-8 JSON') from exc
        if not isinstance(settings, dict) or set(settings) - {'indexUrl', 'proxy'}:
            raise ValueError('实例 pip.json 只支持 indexUrl 和 proxy 配置')
    index = settings.get('indexUrl', DEFAULT_PIP_SETTINGS['indexUrl'])
    proxy = settings.get('proxy', DEFAULT_PIP_SETTINGS['proxy'])
    for value, schemes, field in ((index, {'http', 'https'}, 'indexUrl'),
                                  (proxy, {'http', 'https', 'socks5', 'socks5h'}, 'proxy')):
        if field == 'proxy' and value == '':
            continue
        try:
            parsed = urlsplit(value)
            valid = isinstance(value, str) and parsed.scheme in schemes and bool(parsed.hostname)
            valid = valid and not parsed.fragment and not any(char.isspace() for char in value)
            parsed.port
        except (TypeError, ValueError, AttributeError):
            valid = False
        if not valid:
            raise ValueError(f'实例 pip.json 的 {field} 地址格式错误')
    env = {key: value for key, value in clean_environment().items()
           if (not key.upper().startswith('PIP_') or key.upper() in {'PIP_CERT', 'PIP_CLIENT_CERT'})
           and key.upper() not in {'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'} }
    env.update(PIP_CONFIG_FILE=os.devnull, PIP_INDEX_URL=index, PIP_NO_INPUT='1',
               PIP_DISABLE_PIP_VERSION_CHECK='1', NO_PROXY='*', no_proxy='*')
    if proxy:
        # Explicit instance proxy; do not inherit desktop or registry proxies.
        env['PIP_PROXY'] = proxy
    return env


def run_install(runner, command, working_dir, info):
    capture = ConsoleCapture(runner.logs, info.get('runtimeId', ''), info['runId'])
    process = None
    try:
        process = subprocess.Popen(command, cwd=working_dir, env=installation_environment(runner.directory),
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        capture.attach(process.stdout)
        deadline, next_heartbeat = time.monotonic() + 900, 0
        while process.poll() is None:
            if not runner.running:
                raise RuntimeError('Runner 已停止，依赖安装已取消')
            if time.monotonic() >= deadline:
                raise RuntimeError('依赖安装超过 15 分钟，请检查安装日志和软件源连接')
            if time.monotonic() >= next_heartbeat:
                # Package downloads must not make a healthy Runner look offline.
                try:
                    runner.post('/api/runners/me/heartbeat', runner.heartbeat_payload())
                    assignment = info.get('assignment', {})
                    if assignment.get('assignmentId'):
                        assignments = runner.get('/api/runners/me/assignments')
                        if hasattr(runner, 'processes'):
                            from .process_control import apply_stops
                            apply_stops(runner, assignments)
                            desired = {row['assignmentId']: row for row in assignments}
                            for key, (digest, child, _) in list(runner.processes.items()):
                                owner = desired.get(key.split(':', 1)[0])
                                slot = int(key.split(':', 1)[1]) if ':' in key else 0
                                if not owner or owner['releaseDigest'] != digest or slot >= int(owner.get('concurrency', 1)):
                                    runner.stop(key, timeout=3)
                        current = next((row for row in assignments
                                        if row['assignmentId'] == assignment['assignmentId']), None)
                        if (not current or current.get('releaseDigest') != assignment.get('releaseDigest')
                                or current.get('operationId', '') != assignment.get('operationId', '')):
                            raise InterruptedError('启动请求已停止或更新，依赖安装已取消')
                except InterruptedError:
                    raise
                except (RuntimeError, OSError):
                    pass
                runner.logs.pump()
                next_heartbeat = time.monotonic() + 5
            time.sleep(.2)
        if process.returncode:
            raise RuntimeError(f'依赖安装失败（退出码 {process.returncode}），请查看运行日志中的安装输出')
    finally:
        if process and process.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
        capture.close()


def dependency_python(runner, snapshot: Path, working_dir: Path, manifest: dict, info: dict) -> Path:
    if not (snapshot / 'requirements.txt').is_file():
        return Path(sys.executable)
    def stage(name, message):
        runner.logs.event(info['runId'], 'stage', message, stage=name)
        runner.logs.pump()
    stage('dependency-check', '检查已下发的 requirements.txt')
    files = requirement_files(snapshot)
    for name, digest in files.items():
        installed = working_dir / name
        if not installed.is_file() or hashlib.sha256(installed.read_bytes()).hexdigest() != digest:
            raise ValueError(f'依赖清单未下发或与配置不一致，请重新下发：{name}')
    fingerprint = hashlib.sha256(json.dumps({'files': files, 'python': sys.version,
                                              'baseInterpreter': str(Path(sys.executable).resolve())}, sort_keys=True).encode()).hexdigest()
    identifier = hashlib.sha256(manifest['deploymentId'].encode()).hexdigest()[:32]
    environment = runner.directory / '.runtime' / 'program-env' / identifier
    for parent in (environment, *environment.parents):
        if parent == runner.directory:
            break
        if linked(parent):
            raise ValueError('处理程序依赖环境不能使用符号链接')
    if not environment.resolve().is_relative_to(runner.directory):
        raise ValueError('处理程序依赖环境必须位于实例目录内')
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    marker = environment / 'requirements-state.json'
    try:
        installed = json.loads(marker.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        installed = {}
    if python.is_file() and installed.get('fingerprint') == fingerprint:
        stage('dependency-ready', '依赖清单未变化，复用已安装的独立环境')
        return python
    stage('dependency-env', '准备处理程序独立 Python 环境')
    run_install(runner, [sys.executable, '-m', 'venv', '--copies', str(environment)], working_dir, info)
    install_env = installation_environment(runner.directory)
    source_host = urlsplit(install_env['PIP_INDEX_URL']).hostname
    connection = '使用实例 pip.json 指定代理' if install_env.get('PIP_PROXY') else '直接连接，不继承机器代理'
    stage('dependency-install', f'按 requirements.txt 安装依赖；默认源 {source_host}；{connection}。清单内指定的软件源优先，安装输出见本次运行日志')
    run_install(runner, [str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(snapshot / 'requirements.txt')], snapshot, info)
    temporary = marker.with_suffix('.tmp')
    temporary.write_text(json.dumps({'fingerprint': fingerprint, 'files': files}, sort_keys=True), encoding='utf-8')
    os.replace(temporary, marker)
    stage('dependency-ready', '依赖安装完成，准备启动处理程序')
    return python
