"""Read a pinned Git tree without fetching, packaging, or touching the worktree."""
import hashlib
import re
import subprocess
from pathlib import Path


def browse(app, repo_id, commit, path='', action='list'):
    from .server import ApiError
    if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', commit or ''):
        raise ApiError('请选择配置固定的 Git 版本', 422)
    if (action not in ('list', 'read') or len(path) > 1024 or any(ord(c) < 32 for c in path)
            or path.startswith('/') or '\\' in path or ':' in path
            or path and any(part in ('', '.', '..', '.git') for part in path.split('/'))):
        raise ApiError('Git 目录路径无效', 422)
    with app.store.connect() as db:
        repository = app.repository(db, repo_id)
    root = Path(repository['local_path'])
    spec = commit + (':' + path if path else '')

    def git(*args):
        result = subprocess.run(['git', *args], cwd=root, capture_output=True, timeout=20, check=False)
        if result.returncode:
            raise ApiError('配置中的 Git 版本或路径不存在，请检查仓库是否已同步', 404)
        return result.stdout

    kind = git('cat-file', '-t', spec).decode().strip()
    result = {'path': path, 'gitCommit': commit}
    if action == 'read':
        if not path or kind != 'blob':
            raise ApiError('请选择 Git 文件', 422)
        size = int(git('cat-file', '-s', spec))
        if size > 65536:
            raise ApiError('文件超过 64 KB，暂不支持在线预览', 422)
        raw = git('cat-file', 'blob', spec)
        if b'\0' in raw:
            raise ApiError('二进制文件不支持文本预览', 422)
        try:
            content = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            try:
                content = raw.decode('gb18030')
            except UnicodeDecodeError as exc:
                raise ApiError('文件不是支持的文本编码', 422) from exc
        return {**result, 'content': content, 'size': size, 'sha256': hashlib.sha256(raw).hexdigest()}
    if kind not in ('tree', 'commit'):
        raise ApiError('Git 路径不是目录', 422)
    items = []
    entries = git('ls-tree', '-z', '-l', spec).decode('utf-8', errors='replace').split('\0')
    for entry in entries:
        if not entry:
            continue
        meta, name = entry.split('\t', 1)
        mode, object_kind, digest, size = meta.split()
        items.append({'name': name, 'path': '/'.join(filter(None, (path, name))),
                      'isDirectory': object_kind == 'tree', 'size': None if size == '-' else int(size),
                      'accessError': mode == '120000' or object_kind == 'commit', 'gitObject': digest})
    items.sort(key=lambda item: (not item['isDirectory'], item['name'].casefold()))
    return {**result, 'items': items[:500], 'truncated': len(items) > 500}
