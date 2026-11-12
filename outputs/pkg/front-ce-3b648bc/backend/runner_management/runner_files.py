"""Read-only instance browsing through the Runner's authenticated polling channel."""
import hashlib
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

PREFIX = 'runner-file-request:'
INTERNAL = {'.runtime', '.git', '__pycache__', 'runner-versions', 'versions', 'code', 'logs', 'identity.json', 'current.json', 'previous.json', 'instance.lock', 'pip.json', 'retry-state.json'}


def relative(value, action='list'):
    if not isinstance(value, str) or len(value) > 1024 or any(ord(c) < 32 for c in value): raise ValueError('目录路径无效')
    value = value.replace('\\', '/')
    if value.startswith('/') or ':' in value or any(part in ('.', '..') for part in value.split('/')): raise ValueError('路径必须位于 Runner 实例目录内')
    value = value.rstrip('/')
    if value and (value.split('/')[0].casefold() in INTERNAL or any(part.casefold() in ('.git', '__pycache__') for part in value.split('/'))): raise ValueError('Runner 内部文件不提供浏览，请选择部署目录')
    if not value and action != 'list': raise ValueError('请选择文件')
    return value


def local(root, action, value):
    if action not in ('list', 'read'): raise ValueError('仅支持查看目录和文件')
    value = relative(value, action)
    root = Path(root).resolve(); target = root / value
    from .bundle_install import linked
    for part in (target, *target.parents):
        if part == root: break
        if linked(part): raise ValueError('不支持读取符号链接或连接目录')
    if not target.resolve().is_relative_to(root): raise ValueError('路径超出实例目录')
    if action == 'read':
        if not target.is_file(): raise ValueError('文件不存在')
        if target.stat().st_size > 65536: raise ValueError('文件超过 64 KB，暂不支持在线预览')
        raw = target.read_bytes()
        if b'\0' in raw: raise ValueError('二进制文件不支持文本预览')
        try: content = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            try: content = raw.decode('gb18030')
            except UnicodeDecodeError: raise ValueError('文件不是支持的文本编码')
        if len(json.dumps(content).encode()) > 190000: raise ValueError('文件预览内容过大')
        return {'path': value, 'content': content, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    if not target.is_dir(): raise ValueError('目录不存在')
    items = []
    truncated = False
    for file in sorted(target.iterdir(), key=lambda item: item.name.casefold()):
        path = file.relative_to(root).as_posix()
        try: relative(path)
        except ValueError: continue
        if linked(file): continue
        if len(items) == 200: truncated = True; break
        try:
            stat = file.stat(); folder = file.is_dir()
            items.append({'name': file.name, 'path': path, 'isDirectory': folder, 'size': None if folder else stat.st_size,
                'modifiedAt': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                'sha256': hashlib.sha256(file.read_bytes()).hexdigest() if not folder and stat.st_size <= 5 * 1024 * 1024 else ''})
        except OSError:
            items.append({'name': file.name, 'path': path, 'isDirectory': False, 'accessError': True})
    while len(json.dumps(items).encode()) > 190000:
        items.pop(); truncated = True
    return {'path': value, 'items': sorted(items, key=lambda item: (not item['isDirectory'], item['name'].casefold())), 'truncated': truncated}


def create(app, runner_id, body):
    from .server import ApiError, GIT_LOCK
    from .directory_layout import store_layout
    action = body.get('action')
    if action not in ('list', 'read'): raise ApiError('仅支持浏览目录和预览文件')
    try: path = relative(body.get('path', ''), action)
    except ValueError as error: raise ApiError(str(error)) from error
    with GIT_LOCK, app.store.connect() as db:
        runner = db.execute('SELECT status,capabilities FROM runners WHERE runner_id=?', (runner_id,)).fetchone()
        if not runner: raise ApiError('Runner 实例不存在', 404)
        if runner['status'] == 'offline': raise ApiError('Runner 离线，暂时无法浏览目录', 409)
        if 'file-browser' not in json.loads(runner['capabilities']): raise ApiError('此 Runner 尚不支持目录浏览，请先升级 Runner', 409)
        records = db.execute('SELECT setting_key,setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()
        count = 0
        for raw in records:
            row = json.loads(raw['setting_value'])
            if row['expiresAt'] < time.time(): db.execute('DELETE FROM settings WHERE setting_key=?', (raw['setting_key'],))
            elif row['runnerId'] == runner_id and row['status'] == 'pending': count += 1
        if count >= 10: raise ApiError('目录请求较多，请稍后重试', 429)
        request = {'requestId': uuid.uuid4().hex, 'runnerId': runner_id, 'action': action, 'path': path, 'status': 'pending', 'expiresAt': time.time() + 60}
        store_layout(db, PREFIX + request['requestId'], request)
        return {'requestId': request['requestId']}


def result(app, identifier):
    from .server import ApiError
    if not re.fullmatch(r'[0-9a-f]{32}', identifier): raise ApiError('文件请求 ID 无效')
    with app.store.connect() as db:
        raw = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + identifier,)).fetchone()
    if not raw: raise ApiError('目录请求不存在或已过期，请刷新', 404)
    row = json.loads(raw['setting_value'])
    if row['expiresAt'] < time.time(): raise ApiError('等待 Runner 响应超时，请检查实例状态后刷新', 408)
    return row


def pending(app, runner_id):
    with app.store.connect() as db:
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()
    return [row for raw in rows if (row := json.loads(raw['setting_value']))['runnerId'] == runner_id and row['status'] == 'pending' and row['expiresAt'] >= time.time()][:5]


def complete(app, runner_id, identifier, body):
    from .server import ApiError, GIT_LOCK
    from .directory_layout import store_layout
    with GIT_LOCK:
        row = result(app, identifier)
        if row['runnerId'] != runner_id: raise ApiError('文件请求不属于当前实例', 403)
        if row['status'] != 'pending': return {'ok': True}
        if not isinstance(body.get('result'), dict) or len(json.dumps(body).encode()) > 220000: raise ApiError('文件响应格式无效或过大')
        row.update(status='failed' if body.get('error') else 'success', result=body['result'], error=str(body.get('error') or '')[:500])
        with app.store.connect() as db: store_layout(db, PREFIX + identifier, row)
    return {'ok': True}


def poll(runner):
    for request in runner.get('/api/runners/me/file-requests'):
        try: response = {'result': local(runner.directory, request['action'], request['path'])}
        except (ValueError, OSError) as error: response = {'result': {}, 'error': str(error)}
        runner.post('/api/runners/me/file-requests/' + request['requestId'] + '/result', response)
