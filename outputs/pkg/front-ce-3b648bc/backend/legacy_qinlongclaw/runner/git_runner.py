"""Git deployment supervisor. Requires Python 3.10+ and Git on PATH."""
import argparse
import codecs
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
from pathlib import Path
import subprocess
import sys
import time
import threading
import io
import tarfile
import tempfile


def relay_output(stream, log_file, console):
    """复制原始输出到文件，增量解码后实时显示，保留不带换行的输出。"""
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    try:
        while True:
            chunk = stream.read1(4096)
            if not chunk:
                break
            log_file.write(chunk)
            log_file.flush()
            text = decoder.decode(chunk)
            if text:
                try:
                    console.write(text)
                    console.flush()
                except (OSError, UnicodeError):
                    pass  # 控制台不可用时仍继续保存文件并排空管道。
        tail = decoder.decode(b'', final=True)
        if tail:
            try:
                console.write(tail)
                console.flush()
            except (OSError, UnicodeError):
                pass
    finally:
        stream.close()
        log_file.close()


def redact_output(value):
    """保留诊断信息，隐藏 URL 凭据、查询参数及认证头。"""
    value = re.sub(r'(?i)(https?://)[^\s/@]+@', r'\1[REDACTED]@', str(value))
    value = re.sub(r'(?i)(https?://[^\s?\#]+)[?\#][^\s]*', r'\1?[REDACTED]', value)
    value = re.sub(r'(?im)((?:proxy-)?authorization\s*[:=])[^\r\n]*', r'\1 [REDACTED]', value)
    value = re.sub(r'(?i)((?:password|passwd|token|secret)\s*[:=]\s*)[^\s,;]+', r'\1[REDACTED]', value)
    return value[-6000:]


class Runner:
    def __init__(self, config_path):
        self.config_path = Path(config_path).resolve()
        self.config = json.loads(self.config_path.read_text(encoding='utf-8-sig'))
        self.root = (self.config_path.parent / self.config.get('deploy_directory', 'deployment')).resolve()
        # Runner/config must remain outside the checkout that is updated.
        for protected in (self.config_path, Path(__file__).resolve()):
            if protected.is_relative_to(self.root):
                raise ValueError('部署目录不能包含外壳程序或配置文件')
        self.repository = self.config.get('repository', '').strip()
        self.branch = self.config.get('branch', '').strip()
        if not self.repository or not self.branch or self.branch.startswith('-'):
            raise ValueError('请配置 repository 和 branch')
        self.command = self.config.get('command')
        self.commands = self.config.get('commands', [self.command])
        if not isinstance(self.commands, list) or not self.commands or any(
                not isinstance(cmd, list) or not cmd or not all(isinstance(x, str) and x for x in cmd)
                for cmd in self.commands):
            raise ValueError('commands 必须是启动命令数组，或提供单个 command')
        self.interval = max(0, float(self.config.get('check_interval_seconds', 0)))
        self.aicode_interval = max(0, float(self.config.get('aicode_check_interval_seconds', 120)))
        self.aicode_cache = self.config_path.parent / '.aicode-cache'
        self.aicode_pointer = self.aicode_cache / 'active.json'
        self.delay = max(1, float(self.config.get('restart_delay_seconds', 10)))
        self.processes = {}
        self.restart_at = {}
        self.python = self.root / '.runner-venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        self.state = self.config_path.parent / '.runner-installed.json'

    def run_command(self, args, capture=False, cwd=None):
        # Windows 的默认 cp936 无法读取含中文注释的 UTF-8 requirements。
        # UTF8 控制默认文件解码，IOENCODING 保证捕获的 Python 输出编码一致。
        env = dict(os.environ, GIT_TERMINAL_PROMPT='0',
                   PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
        result = subprocess.run(args, cwd=cwd or self.root, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding='utf-8', errors='replace',
                                timeout=max(1, float(getattr(self, 'config', {}).get('command_timeout_seconds', 1800))))
        if result.returncode:
            # pip 将依赖冲突的具体原因写到 stdout，不能只保留 stderr。
            detail = ('标准输出:\n' + redact_output(result.stdout or '(空)')
                      + '\n错误输出:\n' + redact_output(result.stderr or '(空)'))
            raise RuntimeError(f'{Path(args[0]).name} 执行失败，退出码 {result.returncode}\n{detail}')
        return result.stdout.strip() if capture else None

    def git(self, *args):
        return self.run_command(['git', *args], capture=True)

    def checkout(self):
        if not self.root.exists() or (self.root.is_dir() and not any(self.root.iterdir())):
            self.root.parent.mkdir(parents=True, exist_ok=True)
            logging.info('首次下载代码到 %s', self.root)
            self.run_command(['git', 'clone', '--branch', self.branch, '--single-branch',
                              '--', self.repository, str(self.root)], cwd=self.root.parent)
        if not (self.root / '.git').is_dir():
            raise RuntimeError('部署目录不是 Git 仓库；请选择新的独立目录')
        if self.git('remote', 'get-url', 'origin') != self.repository:
            raise RuntimeError('部署目录仓库与配置不一致，拒绝覆盖')
        if self.git('branch', '--show-current') != self.branch:
            raise RuntimeError('部署目录分支与配置不一致，拒绝切换')
        self.check_clean()

    def check_clean(self):
        if self.git('status', '--porcelain', '--untracked-files=no'):
            raise RuntimeError('部署代码有已跟踪文件的本地修改，暂停更新，不覆盖修改')

    def update(self):
        self.check_clean()
        self.git('fetch', 'origin', self.branch)
        current = self.git('rev-parse', 'HEAD')
        remote = self.git('rev-parse', 'FETCH_HEAD')
        if current == remote:
            return False
        # Verify fast-forward BEFORE stopping the running application.
        self.git('merge-base', '--is-ancestor', current, remote)
        logging.info('发现代码更新：%s -> %s', current[:12], remote[:12])
        self.stop()
        self.git('merge', '--ff-only', remote)
        return True

    def prepare(self):
        revision = self.git('rev-parse', 'HEAD')
        requirement = self.config.get('requirements', '')
        stamp = {'revision': revision, 'root': str(self.root), 'requirements': requirement}
        if self.python.exists() and self.state.exists():
            if json.loads(self.state.read_text(encoding='utf-8')) == stamp:
                return
        if not self.python.exists():
            logging.info('创建独立 Python 环境')
            self.run_command([self.config.get('python', sys.executable), '-m', 'venv', str(self.python.parent.parent)])
        if requirement:
            path = (self.root / requirement).resolve()
            if not path.is_relative_to(self.root) or not path.is_file():
                raise ValueError('requirements 必须是部署目录内存在的文件，或设为空字符串')
            logging.info('安装项目依赖')
            command = [str(self.python), '-m', 'pip', 'install',
                       '--timeout', str(max(1, int(self.config.get('pip_timeout_seconds', 60)))),
                       '--retries', str(max(0, int(self.config.get('pip_retries', 5)))),
                       '-r', str(path)]
            index_url = str(self.config.get('pip_index_url') or '').strip()
            if index_url:
                command.extend(['--index-url', index_url])
            self.run_command(command)
        self.state.write_text(json.dumps(stamp), encoding='utf-8')

    def update_aicode(self):
        """发布不可变脚本快照，不修改正在运行的主程序或 Git 工作区。"""
        self.git('fetch', 'origin', self.branch)
        revision = self.git('rev-parse', 'FETCH_HEAD')
        tree = self.git('ls-tree', revision, '--', 'aicode')
        tree_id = tree.split()[2] if tree else 'empty'
        if tree and not tree.startswith('040000 tree '):
            raise RuntimeError('远程 aicode 必须是普通目录')
        if self.aicode_pointer.exists():
            current = json.loads(self.aicode_pointer.read_text(encoding='utf-8'))
            if current.get('tree') == tree_id and (self.aicode_cache / current['directory']).is_dir():
                return False
        self.aicode_cache.mkdir(parents=True, exist_ok=True)
        snapshot = Path(tempfile.mkdtemp(prefix='snapshot-', dir=self.aicode_cache))
        if tree:
            result = subprocess.run(['git', 'archive', '--format=tar', revision + ':aicode'],
                                    cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
            if result.returncode:
                raise RuntimeError('读取远程 aicode 快照失败')
            with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
                for member in archive:
                    destination = (snapshot / member.name).resolve()
                    if not destination.is_relative_to(snapshot.resolve()):
                        raise ValueError('aicode 快照包含越界路径')
                    if member.isdir():
                        destination.mkdir(parents=True, exist_ok=True)
                    elif member.isfile():
                        data = archive.extractfile(member).read()
                        if destination.suffix == '.py':
                            compile(data, member.name, 'exec')
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_bytes(data)
                    else:
                        raise ValueError('aicode 快照不允许符号链接或特殊文件')
        pointer = snapshot / 'publication.json'
        pointer.write_text(json.dumps({'tree': tree_id, 'revision': revision,
                                      'directory': snapshot.name}), encoding='utf-8')
        os.replace(pointer, self.aicode_pointer)
        logging.info('[AiCode] 已热更新脚本快照 %s；后续任务生效，无需重启', revision[:12])
        return True

    def start(self):
        self.prepare()
        for index in range(len(self.commands)):
            try:
                self.start_app(index)
            except Exception as exc:
                logging.error('程序 %s 启动失败：%s', index + 1, exc)
                self.restart_at[index] = time.monotonic() + self.delay

    def start_app(self, index):
        if index in self.processes and self.processes[index][0].poll() is None:
            return
        args = [value.replace('{python}', str(self.python)) for value in self.commands[index]]
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in self.config.get('environment', {}).items()})
        env['PYTHONUNBUFFERED'] = '1'
        env['PYTHONIOENCODING'] = 'utf-8'
        if self.aicode_interval:
            env['QINLONG_AICODE_POINTER'] = str(self.aicode_pointer)
        name = re.sub(r'[^a-zA-Z0-9_-]', '_', Path(args[1] if len(args) > 1 else args[0]).stem)
        log_name = 'application.log' if len(self.commands) == 1 else f'application_{index + 1}_{name}.log'
        app_log = (self.config_path.parent / log_name).open('ab')
        try:
            child = subprocess.Popen(args, cwd=self.root, env=env, stdout=subprocess.PIPE,
                                          stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                          creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
        except Exception:
            app_log.close()
            raise
        output_thread = threading.Thread(
            target=relay_output, args=(child.stdout, app_log, sys.stdout), daemon=True)
        self.processes[index] = (child, output_thread)
        self.restart_at.pop(index, None)
        output_thread.start()
        logging.info('程序 %s 已启动，PID=%s，日志=%s', name, child.pid, log_name)

    def stop_app(self, index):
        item = self.processes.pop(index, None)
        if item is None:
            return
        child, output_thread = item
        if child.poll() is None:
            logging.info('停止外壳启动的程序，PID=%s', child.pid)
            child.terminate()
            try:
                child.wait(timeout=max(1, float(self.config.get('stop_timeout_seconds', 30))))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        output_thread.join(timeout=2)

    def stop(self):
        for index in list(self.processes):
            self.stop_app(index)
        self.restart_at.clear()

    def supervise(self):
        for index in range(len(self.commands)):
            item = self.processes.get(index)
            if item is not None and item[0].poll() is None:
                continue
            if index not in self.restart_at:
                self.stop_app(index)
                self.restart_at[index] = time.monotonic() + self.delay
                logging.warning('程序 %s 已退出，%s 秒后独立重启', index + 1, self.delay)
            if time.monotonic() >= self.restart_at[index]:
                try:
                    self.prepare()
                    self.start_app(index)
                except Exception as exc:
                    logging.error('程序 %s 重启失败：%s', index + 1, exc)
                    self.restart_at[index] = time.monotonic() + self.delay

    def serve(self):
        self.checkout()
        self.update()
        if self.aicode_interval:
            try:
                self.update_aicode()
            except Exception as exc:
                logging.error('[AiCode] 首次同步失败，保留已有脚本：%s', exc)
        self.start()
        next_check = time.monotonic() + self.interval
        next_aicode_check = time.monotonic() + self.aicode_interval
        try:
            while True:
                if self.aicode_interval and time.monotonic() >= next_aicode_check:
                    try:
                        self.update_aicode()
                    except Exception as exc:
                        logging.error('[AiCode] 同步失败，继续使用原脚本：%s', exc)
                    next_aicode_check = time.monotonic() + self.aicode_interval
                if self.interval and time.monotonic() >= next_check:
                    try:
                        if self.update():
                            self.start()
                    except Exception as exc:
                        logging.error('自动更新失败：%s', exc)
                    next_check = time.monotonic() + self.interval
                self.supervise()
                time.sleep(1)
        finally:
            self.stop()


def main():
    parser = argparse.ArgumentParser(description='从配置的 Git 仓库更新并运行项目')
    parser.add_argument('--config', default=str(Path(__file__).with_name('config.json')))
    args = parser.parse_args()
    config = Path(args.config).resolve()
    if not config.is_file():
        parser.error('请先复制 config.example.json 为 config.json 并填写仓库地址')
    handler = RotatingFileHandler(config.parent / 'runner.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s',
                        handlers=[handler, logging.StreamHandler()])
    try:
        Runner(config).serve()
    except KeyboardInterrupt:
        logging.info('外壳已停止')
    except Exception as exc:
        logging.error('外壳启动失败：%s', exc)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
