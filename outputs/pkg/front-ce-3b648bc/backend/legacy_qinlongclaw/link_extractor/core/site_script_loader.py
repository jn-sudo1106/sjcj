"""Load trusted, locally managed per-host news scrapers."""
import logging
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

from core.list_content_resolver import plain_text

AICODE_DIR = Path(__file__).resolve().parents[2] / 'aicode'


def resolve_site_script(url, task=None):
    from core.managed_script import resolve
    managed = resolve(task)
    return managed if managed else find_site_script(url)


def current_aicode_directory():
    pointer = os.environ.get('QINLONG_AICODE_POINTER', '')
    if not pointer or not Path(pointer).is_file():
        return AICODE_DIR
    pointer = Path(pointer).resolve()
    payload = json.loads(pointer.read_text(encoding='utf-8'))
    directory = (pointer.parent / payload['directory']).resolve()
    if directory.parent != pointer.parent or not directory.is_dir():
        raise ValueError('aicode 快照路径无效')
    return directory


def find_site_script(url):
    host = (urlsplit(url).hostname or '').lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]*', host):
        return None
    # 精确主机名优先，不模糊匹配其他域名，也不执行目录下的批量脚本。
    directory = current_aicode_directory()
    for name in (host, host.replace('.', '_')):
        path = directory / (name + '.py')
        if path.is_file() and path.resolve().parent == directory.resolve():
            logging.info('[AiCode] 命中网站脚本: %s', path)
            return path
    logging.info('[AiCode] 未找到 %s 的域名脚本，查找目录: %s；使用通用抓取', host, directory)
    return None


def run_site_script(path, url):
    from queue_url_history import record_url
    record_url(url, 'AiCode:' + path.name)
    logging.info('[AiCode] 使用网站专用脚本: %s', path.name)
    # Managed scripts run in a separate process with a narrow environment and deadline.
    managed_root = os.environ.get('RUNNER_SCRIPT_CACHE')
    instance_root = os.environ.get('RUNNER_INSTANCE_DIR') or (str(Path(managed_root).resolve().parent) if managed_root else '')
    if managed_root and path.resolve().is_relative_to(Path(instance_root).resolve()):
        from core.managed_script import runtime_snapshot, safe_relative, code_key
        snapshot = runtime_snapshot(path)
        if snapshot:
            # The displayed code directory stays fixed. Each task reads its own
            # verified bytes, so later directory updates cannot mix its modules.
            with tempfile.TemporaryDirectory(prefix='runner-task-') as temporary:
                package_root = Path(temporary)
                for directory in snapshot['manifest'].get('directories', []):
                    if not safe_relative(directory):
                        raise ValueError('代码包目录无效')
                    (package_root / directory).mkdir(parents=True, exist_ok=True)
                for name, data in snapshot['files'].items():
                    if not safe_relative(name):
                        raise ValueError('代码包文件路径无效')
                    destination = package_root / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(data)
                registry = dict(snapshot['registry'], current={
                    code_key(snapshot['manifest']): snapshot['digest'],
                })
                (package_root / 'version.json').write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding='utf-8')
                rows = invoke_managed(package_root / snapshot['manifest']['entry'], url, package_root)
                return normalize_rows(rows, path, url)
        package_root = path.parent
        for parent in path.parents:
            if not parent.is_relative_to(Path(instance_root).resolve()):
                break
            manifest_file = parent / 'manifest.json'
            if manifest_file.is_file():
                manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
                if manifest.get('kind') == 'script' and manifest.get('entry') == path.relative_to(parent).as_posix():
                    package_root = parent
                    break
        rows = invoke_managed(path, url, package_root)
        return normalize_rows(rows, path, url)
    old_path = sys.path[:]
    # 脚本自己的辅助模块也要重新加载，不能沿用上一版 sys.modules 缓存。
    removed = {}
    for name, module in list(sys.modules.items()):
        filename = getattr(module, '__file__', None)
        if filename and (Path(filename).resolve().is_relative_to(AICODE_DIR.resolve())
                         or Path(filename).resolve().is_relative_to(path.parent.parent)
                         and path.parent.name.startswith('snapshot-')):
            removed[name] = sys.modules.pop(name)
    try:
        sys.path.insert(0, str(path.parent))
        namespace = runpy.run_path(str(path), run_name='_qinlong_site_scraper_')
        scrape = namespace.get('scrape')
        if not callable(scrape):
            raise ValueError(f'{path.name} 必须提供 scrape(url) 函数')
        rows = scrape(url)
    finally:
        sys.path[:] = old_path
        for name, module in list(sys.modules.items()):
            filename = getattr(module, '__file__', None)
            if filename and Path(filename).resolve().is_relative_to(path.parent.resolve()):
                sys.modules.pop(name, None)
        sys.modules.update(removed)
    return normalize_rows(rows, path, url)


def invoke_managed(path, url, package_root):
    invoke = ("import json,runpy,sys; sys.path[:0]=[sys.argv[3],str(__import__('pathlib').Path(sys.argv[1]).parent)]; "
              "f=runpy.run_path(sys.argv[1],run_name='_site_')['scrape']; "
              "print(json.dumps(f(sys.argv[2]),ensure_ascii=False))")
    env = {key: value for key, value in os.environ.items()
           if key.upper() in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE')}
    env['PYTHONIOENCODING'] = 'utf-8'
    result = subprocess.run([sys.executable, '-I', '-B', '-c', invoke, str(path), url, str(package_root)], cwd=path.parent,
                            env=env, capture_output=True, text=True, timeout=120, check=True)
    return json.loads(result.stdout)


def normalize_rows(rows, path, url):
    if not isinstance(rows, list):
        raise ValueError(f'{path.name} 的 scrape(url) 必须返回列表')
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('网站脚本返回的每条新闻必须为字典')
        item = {}
        for target, aliases in {
            'Text': ('Text', 'title', 'Title'),
            'Date': ('Date', 'date'),
            'Summary': ('Summary', 'summary'),
            'Content': ('Content', 'content', 'Contents'),
        }.items():
            value = next((row[key] for key in aliases if row.get(key)), '')
            item[target] = str(value).strip()
        item['Content'] = plain_text(item['Content'], str(row.get('url') or url))
        if item['Text'] or item['Summary']:
            result.append(item)
    logging.info('[AiCode] 专用脚本抓取完成: %s 条', len(result))
    return result
