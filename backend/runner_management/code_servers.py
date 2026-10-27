"""Platform registry and authenticated relay for remote code workspaces.

Uses the existing settings/enrollment store, admin authorization and Runner heartbeat
intervals. No generation task scheduler or second task state machine is introduced.
"""
import hashlib
import base64
import hmac
import io
import json
import secrets
import threading
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

LOCK = threading.Lock()
PREFIX = 'code-server:'
MAX_RESULT = 15 * 1024 * 1024


def instance_token(app, server_id):
    # Domain-separated deterministic credential: DB stores only its hash, while
    # the existing platform signing key allows authenticated reverse calls.
    return base64.urlsafe_b64encode(app.artifacts.private_key.sign(
        b'code-generation-server-token-v1\0' + server_id.encode('ascii'))).decode('ascii')


def read(app, server_id):
    from .server import ApiError
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + server_id,)).fetchone()
    if not row:
        raise ApiError('代码生成服务器不存在', 404)
    return json.loads(row['setting_value'])


def write(db, row):
    key = PREFIX + row['serverId']
    db.execute('DELETE FROM settings WHERE setting_key=?', (key,))
    db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)', (key, json.dumps(row, ensure_ascii=False)))


def public(row):
    from .server import RUNNER_OFFLINE_AFTER_SECONDS
    result = {key: value for key, value in row.items() if key not in ('token', 'tokenHash')}
    stamp = row.get('lastHeartbeat')
    result['status'] = 'online' if stamp and datetime.now(timezone.utc) - datetime.fromisoformat(stamp) <= timedelta(seconds=RUNNER_OFFLINE_AFTER_SECONDS) else 'offline'
    return result


def listing(app):
    with app.store.connect() as db:
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()
    return {'items': sorted((public(json.loads(row['setting_value'])) for row in rows), key=lambda x: (x['name'], x['serverId']))}


def enrollment_code(app):
    code = secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(timespec='seconds')
    # Separate scope prevents accidentally registering a code server as an execution Runner.
    with app.store.connect() as db:
        db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)',
                   ('code-server-enroll:' + hashlib.sha256(code.encode()).hexdigest(), json.dumps({'expiresAt': expires, 'usedAt': None})))
    return {'code': code, 'expiresAt': expires}


def endpoint(value):
    from .server import ApiError
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or parsed.port == 0:
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError('管理服务地址须为 HTTP(S) 主机和端口')
    return value.rstrip('/')


def enroll(app, body):
    from .server import ApiError, now, required_text
    code = required_text(body, 'code', 128)
    address = endpoint(required_text(body, 'endpoint', 2000))
    row = {key: required_text(body, key, limit) for key, limit in
           (('name', 100), ('ipAddress', 64), ('installDirectory', 2000), ('workspace', 2000), ('osType', 64), ('osVersion', 255), ('version', 100))}
    row.update(endpoint=address, serverId=str(uuid.uuid4()), lastHeartbeat=now())
    token = instance_token(app, row['serverId'])
    row['tokenHash'] = hashlib.sha256(token.encode()).hexdigest()
    key = 'code-server-enroll:' + hashlib.sha256(code.encode()).hexdigest()
    with LOCK, app.store.connect() as db:
        existing = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key,)).fetchone()
        entry = json.loads(existing['setting_value']) if existing else {}
        if not entry or entry['expiresAt'] < now() or entry['usedAt']:
            raise ApiError('登记码无效或已过期，请从平台重新下载服务包', 403)
        others = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()
        if any((other['ipAddress'], other['installDirectory']) == (row['ipAddress'], row['installDirectory']) for other in map(lambda x: json.loads(x['setting_value']), others)):
            raise ApiError('该机器和实例目录已登记，请保留原身份文件', 409)
        db.execute('DELETE FROM settings WHERE setting_key=?', (key,))
        write(db, row)
    return {'serverId': row['serverId'], 'token': token, 'heartbeatSeconds': 5}


def heartbeat(app, headers, body):
    from .server import ApiError, now, required_text
    server_id = required_text(body, 'serverId', 80)
    token = headers.get('Authorization', '').removeprefix('Bearer ')
    with LOCK:
        row = read(app, server_id)
        if not token or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), row['tokenHash']):
            raise ApiError('代码生成服务器实例凭据无效', 401)
        for field, limit in (('name', 100), ('ipAddress', 64), ('workspace', 2000), ('osType', 64), ('osVersion', 255), ('version', 100)):
            row[field] = required_text(body, field, limit)
        row['endpoint'] = endpoint(required_text(body, 'endpoint', 2000))
        if type(body.get('pid')) is not int or body['pid'] <= 0:
            raise ApiError('进程 ID 无效')
        row.update(lastHeartbeat=now(), pid=body['pid'])
        with app.store.connect() as db:
            write(db, row)
    return {'ok': True, 'heartbeatSeconds': 5}


def relay_request(app, server_id, action, body):
    from .server import ApiError
    row = read(app, server_id)
    if public(row)['status'] != 'online':
        raise ApiError('代码生成服务器已离线，请检查远程服务及心跳', 503)
    request = Request(row['endpoint'] + '/api/' + action, data=json.dumps(body, ensure_ascii=False).encode('utf8'),
                      headers={'Content-Type': 'application/json'}, method='POST')
    request.add_unredirected_header('Authorization', 'Bearer ' + instance_token(app, server_id))
    return request


def operation(app, server_id, body):
    from .server import ApiError
    action = body.get('action')
    if action not in ('list', 'read', 'write', 'mkdir', 'delete', 'upload', 'export', 'download', 'logs'):
        raise ApiError('文件操作不存在')
    try:
        with urlopen(relay_request(app, server_id, 'files', body), timeout=30) as response:
            raw = response.read(MAX_RESULT + 1)
            if len(raw) > MAX_RESULT:
                raise ApiError('远程响应超过 15 MB，请缩小选择范围', 413)
            return json.loads(raw)
    except HTTPError as exc:
        try:
            message = json.loads(exc.read(4096)).get('message', '远程文件操作失败')
        except (ValueError, AttributeError):
            message = '远程文件操作失败'
        raise ApiError(message, exc.code if 400 <= exc.code < 500 else 502) from exc
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise ApiError('无法访问代码生成服务器，请检查地址、端口及网络', 502) from exc


def import_repository(app, server_id, body):
    from .server import ApiError, required_text
    result = operation(app, server_id, {'action': 'export', 'paths': body.get('paths')})
    files = result['files']
    if not files:
        raise ApiError('所选范围没有文件')
    # Preserve workspace-relative paths in the selected managed repository directory.
    uploads = [{'name': item['path'].rsplit('/', 1)[-1], 'relativePath': item['path'], 'data': item['data']} for item in files]
    return app.upload_repository_files(required_text(body, 'repositoryId', 80), {
        'overwrite': body.get('overwrite', False), 'directoryId': body.get('directoryId', ''), 'uploadType': 'folder', 'files': uploads})


def model_request(app, selected, request):
    """Keep the existing model adapter contract and streaming response unchanged."""
    server_id = selected.get('generationServerId')
    if not server_id:
        return request
    workspace = selected.get('_workspace')
    if workspace:
        from .server import ApiError
        row = read(app, server_id)
        path_type = PureWindowsPath if '\\' in row['workspace'] or PureWindowsPath(row['workspace']).drive else PurePosixPath
        input_path = path_type(workspace['inputFileDir'])
        try:
            relative = input_path.relative_to(path_type(row['workspace'])) if input_path.is_absolute() else input_path
        except ValueError as exc:
            raise ApiError('输入目录必须位于生成服务器工作空间内', 403) from exc
        # Existing installed services already support mkdir. Prepare the input
        # directory through that API so they can use isolated paths immediately.
        operation(app, server_id, {'action': 'mkdir', 'path': relative.as_posix()})
    return relay_request(app, server_id, 'model', {
        'url': request.full_url, 'method': request.get_method(),
        'body': json.loads(request.data) if request.data else None,
        'timeoutSeconds': selected['timeoutSeconds'],
    })


def package(app, platform):
    platform = endpoint(platform)
    code = enrollment_code(app)
    data = io.BytesIO()
    source = Path(__file__).resolve().parents[1] / 'code_generation_server'
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ('start.py', 'start.cmd', 'config.example.json'):
            archive.write(source / name, name)
        archive.writestr('config.json', json.dumps({'platform': platform, 'enrollCode': code['code'], 'host': '0.0.0.0', 'port': 8093,
                           'advertiseUrl': '', 'workspace': './workspace', 'allowedModelOrigins': ['http://127.0.0.1:6000', 'http://localhost:6000']}, ensure_ascii=False, indent=2))
        archive.writestr('使用说明.txt',
            '需要 Python 3.10+，无须 pip 安装依赖。\n'
            '1. 解压到独立目录，修改 config.json 的 workspace 为模型机器上的工作空间。\n'
            '2. platform 必须是本机可访问的平台管理地址；平台也必须能访问本机 8093 端口。\n'
            '3. 运行 start.cmd（Windows），或 python start.py（Linux/Windows）。\n'
            '4. 在平台“大模型接口”选择本服务器，模型地址填写本机地址，例如 http://127.0.0.1:6000/wb/agent。\n'
            '5. prj_dir、input_file_dir、code_dir、output_file_dir 都必须位于 workspace 内，可使用相对路径。\n'
            '6. 实例身份保存在 identity.json，重启请保留；同机多个实例需使用不同目录和 port。\n'
            '7. 拷贝为新实例时重新下载包，或在平台获取新登记码填入 enrollCode；登记码仅可用一次，有效 24 小时。\n'
            '8. 多网卡可配置 advertiseUrl，例如 http://192.168.1.171:8093。\n'
            '9. 服务日志：logs/service.log；服务版本和实例 ID 会在启动时输出。\n')
    return data.getvalue()
