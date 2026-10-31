"""Platform registry and authenticated relay for remote code workspaces.

Uses the existing settings/enrollment store, admin authorization and Runner heartbeat
intervals. No generation task scheduler or second task state machine is introduced.
"""
import hashlib
import base64
import hmac
import io
import json
import re
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


def generation_root(row, value=None):
    """Resolve paths with the remote machine's OS, preserving its workspace boundary."""
    from .server import ApiError
    root = row['workspace']
    value = row.get('generationRoot', '') if value is None else value
    if not isinstance(value, str) or len(value) > 2000 or any(ord(char) < 32 for char in value):
        raise ApiError('生成代码目录无效')
    value = value.strip() or root
    kind = PureWindowsPath if '\\' in root or PureWindowsPath(root).drive else PurePosixPath
    path = kind(value)
    if not path.is_absolute():
        raise ApiError('请填写生成服务器上的绝对目录')
    try:
        relative = path.relative_to(kind(root))
    except ValueError as error:
        raise ApiError('生成代码目录必须位于该服务器的工作空间内') from error
    if relative.parts:
        from .directory_layout import safe_path
        safe_path(relative.as_posix())
        if any(part.casefold() in ('__pycache__', '.venv', 'node_modules') for part in relative.parts):
            raise ApiError('生成代码目录不能使用受保护目录')
    return str(path)


def save_generation_directory(app, server_id, body):
    from .server import ApiError
    if not isinstance(body.get('generationRoot'), str):
        raise ApiError('请提供生成代码目录')
    with LOCK:
        row = read(app, server_id)
        path = generation_root(row, body['generationRoot'])
        # Store only the override, so clearing it continues following workspace reports.
        row['generationRoot'] = path if body['generationRoot'].strip() else ''
        with app.store.connect() as db:
            write(db, row)
    return public(row)


def public(row):
    from .server import RUNNER_OFFLINE_AFTER_SECONDS
    result = {key: value for key, value in row.items() if key not in ('token', 'tokenHash')}
    stamp = row.get('lastHeartbeat')
    result['status'] = 'online' if stamp and datetime.now(timezone.utc) - datetime.fromisoformat(stamp) <= timedelta(seconds=RUNNER_OFFLINE_AFTER_SECONDS) else 'offline'
    return result


def registry(app):
    with app.store.connect() as db:
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()
    return [public(json.loads(row['setting_value'])) for row in rows]


def listing(app):
    from .code_server_upgrades import read as upgrade
    from .model_interfaces import listing as models
    items = registry(app)
    interfaces = models(app, servers=items)['items']
    for item in items:
        from .generation_git_bindings import describe
        item['generationGitBindings'] = describe(app, item)
        item['upgrade']=upgrade(app,item['serverId'])
        item['supportedModels'] = [{key: model.get(key) for key in ('id', 'name', 'model', 'kind', 'endpoint', 'enabled', 'generationServerMode')}
                                   for model in interfaces if model.get('generationServerId') == item['serverId']]
    return {'items': sorted(items, key=lambda x: (x['name'], x['serverId']))}


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
    row['runUser'] = required_text(body, 'runUser', 255) if 'runUser' in body else ''
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
    return {'serverId': row['serverId'], 'token': token, 'heartbeatSeconds': 5,'publicKey':app.artifacts.public_key}


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
        row['runUser'] = required_text(body, 'runUser', 255) if 'runUser' in body else ''
        launcher_version=body.get('launcherVersion')
        if isinstance(launcher_version,str) and 0<len(launcher_version)<=80:
            row['launcherVersion']=launcher_version
        digest=body.get('actualDigest','source-local')
        if not isinstance(digest,str) or digest!='source-local' and not re.fullmatch(r'sha256:[a-f0-9]{64}',digest):
            raise ApiError('CodeServer 版本摘要无效')
        row.update(actualDigest=digest,upgradeCapable=type(body.get('upgradeSchema')) is int and body.get('upgradeSchema')==1)
        row['mqCapable']=type(body.get('mqWorkerSchema')) is int and body.get('mqWorkerSchema')==1
        with app.store.connect() as db:
            write(db, row)
        from .code_server_upgrades import observe_heartbeat
        observe_heartbeat(app,row)
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


def package(app, platform, existing=False, digest=''):
    platform = endpoint(platform)
    pinned = None
    if digest:
        from .server import ApiError
        if existing or not isinstance(digest,str) or not __import__('re').fullmatch(r'sha256:[a-f0-9]{64}',digest):
            raise ApiError('CodeServer 版本摘要无效')
        with app.store.connect() as db:
            pinned=db.execute("SELECT signature FROM releases WHERE digest=? AND kind='code-server' AND status='published'",(digest,)).fetchone()
        if not pinned:
            raise ApiError('CodeServer 发布版本不存在',404)
        from .artifacts import verify_artifact
        release_data=app.artifacts.read(digest)
        verify_artifact(release_data,digest,pinned['signature'],app.artifacts.public_key)
    code = enrollment_code(app) if not existing else None
    data = io.BytesIO()
    source = Path(__file__).resolve().parents[1] / 'code_generation_server'
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ('start.py', 'start.cmd', 'config.example.json','__init__.py','service.py','bootstrapper.py','mq_worker.py','requirements.txt'):
            archive.write(source / name, name)
        support=Path(__file__).resolve().parent
        for name in ('__init__.py','artifacts.py','bootstrapper.py','program_launcher.py','runner.py'):
            archive.write(support/name,'runner_management/'+name)
        if pinned:
            stem='code-server-versions/'+digest[7:]
            archive.writestr(stem+'.zip',release_data)
            archive.writestr(stem+'.sig',pinned['signature'])
            archive.writestr('current.json',json.dumps({'digest':digest}))
        if not existing:
            archive.writestr('config.json', json.dumps({'platform': platform, 'enrollCode': code['code'], 'host': '0.0.0.0', 'port': 8093,
                               'advertiseUrl': '', 'workspace': './workspace'}, ensure_ascii=False, indent=2))
        archive.writestr('使用说明.txt',
            '需要 Python 3.10+。首次启动自动准备私有签名校验依赖。\n'
            '1. 解压到独立目录，修改 config.json 的 workspace 为模型机器上的工作空间。\n'
            '2. platform 必须是本机可访问的平台管理地址；平台也必须能访问本机 8093 端口。\n'
            '3. 以普通用户登录后运行 start.cmd（Windows），或 python start.py（Linux/Windows）；不要使用 SYSTEM 等内置服务账户。升级继续沿用启动账户。\n'
            '4. 在平台“大模型接口”选择本服务器，模型地址填写本机地址，例如 http://127.0.0.1:6000/wb/agent。\n'
            '5. prj_dir、input_file_dir、code_dir、output_file_dir 都必须位于 workspace 内，可使用相对路径。\n'
            '6. 实例身份保存在 identity.json，重启请保留；同机多个实例需使用不同目录和 port。\n'
            '7. 拷贝为新实例时重新下载包，或在平台获取新登记码填入 enrollCode；登记码仅可用一次，有效 24 小时。\n'
            '8. 多网卡可配置 advertiseUrl，例如 http://192.168.1.171:8093。\n'
            '9. 服务日志：logs/service.log；启动及升级日志：logs/launcher.log、logs/worker.log。\n'
            '10. 升级接入包不含 config.json 和 identity.json；停止旧程序，覆盖解压代码并运行 start.cmd 一次，以后在平台一键升级。\n'
            '11. 正常升级等待模型调用及文件操作完成；版本签名或健康检查失败自动保留/恢复旧版本。\n')
    return data.getvalue()
