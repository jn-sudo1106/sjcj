"""Stable CodeServer launcher; workers upgrade through Runner's signed supervisor."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid

HERE = Path(__file__).resolve().parent
if __package__:
    from .service import Service, Handler, Workspace, ServiceError, require_user_account
else:
    spec = importlib.util.spec_from_file_location('code_generation_server', HERE / '__init__.py', submodule_search_locations=[str(HERE)])
    module = importlib.util.module_from_spec(spec)
    sys.modules['code_generation_server'] = module
    spec.loader.exec_module(module)
    from code_generation_server.service import Service, Handler, Workspace, ServiceError, require_user_account


def ensure_verifier():
    if importlib.util.find_spec('cryptography'):
        return
    # Keep signature verification dependencies private to this installation.
    environment = HERE / '.runtime' / 'python'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if environment.exists():
        try:
            valid = python.is_file() and subprocess.run(
                [str(python), '-c', 'import sys'], stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=15,
            ).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            valid = False
        if not valid:
            backup = environment.with_name('python.invalid-' + uuid.uuid4().hex[:12])
            environment.rename(backup)
            print(f'私有 Python 环境已失效，使用当前 Python 重建：{sys.executable}', flush=True)
    if not python.is_file():
        subprocess.run([sys.executable, '-m', 'venv', str(environment)], check=True)
    if subprocess.run([str(python), '-c', 'import cryptography'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        print('首次启动：准备 CodeServer 签名校验依赖…', flush=True)
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(HERE / 'requirements.txt')], check=True)
    raise SystemExit(subprocess.call([str(python), '-X', 'utf8', str(HERE / 'start.py')]))

def load_configuration():
    config_file = HERE / 'config.json'
    connection_file = HERE / 'config.package.json'
    if connection_file.exists():
        connection = json.loads(connection_file.read_text(encoding='utf-8-sig'))
        if not isinstance(connection, dict) or any(
                not isinstance(connection.get(key), str) or not connection[key].strip()
                for key in ('platform', 'enrollCode')):
            raise SystemExit('包内接入配置无效，请重新下载服务包')
        source = config_file if config_file.exists() else HERE / 'config.example.json'
        config = json.loads(source.read_text(encoding='utf-8-sig'))
        config.update(platform=connection['platform'].strip(), enrollCode=connection['enrollCode'].strip())
        temporary = HERE / 'config.package.tmp'
        temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf8')
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        temporary.replace(config_file)
        connection_file.unlink()
        print('已将包内管理服务地址和登记码写入 config.json', flush=True)
    if not config_file.exists():
        import shutil
        shutil.copyfile(HERE / 'config.example.json', config_file)
        raise SystemExit('已创建 config.json，请配置平台地址和登记码后重新启动')
    return json.loads(config_file.read_text(encoding='utf-8-sig'))


def main():
    try:
        require_user_account()
    except ServiceError as error:
        raise SystemExit(str(error)) from error
    config = load_configuration()
    ensure_verifier()
    if __package__:
        from .bootstrapper import CodeServerBootstrapper
    else:
        from code_generation_server.bootstrapper import CodeServerBootstrapper
    lock = (HERE / '.supervisor.lock').open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            if lock.tell() == 0:
                lock.write(b'0');lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise SystemExit('此实例目录的 CodeServer 已在运行')
    supervisor = None
    try:
        supervisor = CodeServerBootstrapper(HERE, config)
        signal.signal(signal.SIGTERM, lambda *_: setattr(supervisor, 'running', False))
        if hasattr(signal, 'SIGBREAK'):
            signal.signal(signal.SIGBREAK, lambda *_: setattr(supervisor, 'running', False))
        supervisor.serve()
    except KeyboardInterrupt:
        if supervisor:
            supervisor.running = False
            supervisor.stop()
    finally:
        lock.close()


if __name__ == '__main__':
    main()
