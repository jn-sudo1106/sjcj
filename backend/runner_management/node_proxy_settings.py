"""Shared node proxy preferences, keyed by config ID; credentials encrypted at rest."""
import base64
import hashlib
import json
import re
import threading
from urllib.parse import urlsplit
from cryptography.fernet import Fernet

LOCK = threading.Lock()
PREFIX = 'node-proxy:'


def owner(value):
    from .server import ApiError
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', value):
        raise ApiError('请先保存有效的节点配置')
    return value


def cipher(app):
    secret = app.artifacts.private_key.sign(b'node-proxy-settings-encryption-v1')
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret).digest()))


def read(app, config_id):
    config_id = owner(config_id)
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + config_id,)).fetchone()
    stored = json.loads(row['setting_value']) if row else {}
    result = {'configId': config_id, 'configured': bool(row), 'revision': stored.get('revision', 0), 'useProxy': stored.get('useProxy', False)}
    if stored.get('encrypted'):
        result['proxyDetail'] = json.loads(cipher(app).decrypt(stored['encrypted'].encode()))
    return result


def save(app, body):
    from .server import ApiError
    config_id = owner(body.get('configId'))
    enabled = body.get('useProxy')
    if type(enabled) is not bool:
        raise ApiError('代理启用状态无效')
    details = None
    if enabled:
        raw = body.get('proxyDetail')
        if not isinstance(raw, dict): raise ApiError('请填写代理地址和端口')
        details = {key: raw.get(key, '') for key in ('ip', 'account', 'password')}
        for key, limit in (('ip', 253), ('account', 256), ('password', 2048)):
            value = details[key]
            if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value):
                raise ApiError('代理地址或认证字段无效')
        details['ip'] = details['ip'].strip()
        port = raw.get('port')
        try:
            parsed = urlsplit('http://' + details['ip'] + ':' + str(port))
            valid = bool(parsed.hostname) and not any(c.isspace() for c in details['ip']) and not any(c in details['ip'] for c in '/@?#')
            valid = valid and parsed.port == port
        except ValueError: valid = False
        if not valid or type(port) is not int or not 1 <= port <= 65535:
            raise ApiError('请填写有效的代理域名或 IP，以及 1–65535 的端口')
        details['port'] = port
    with LOCK:
        current = read(app, config_id)
        if type(body.get('revision')) is not int or body['revision'] != current['revision']:
            raise ApiError('此配置的代理已更新，请重新打开节点后再修改', 409)
        stored = {'useProxy': enabled, 'revision': current['revision'] + 1,
                  'encrypted': cipher(app).encrypt(json.dumps(details).encode()).decode() if details else ''}
        with app.store.connect() as db:
            db.execute('DELETE FROM settings WHERE setting_key=?', (PREFIX + config_id,))
            db.execute('INSERT INTO settings VALUES (?,?)', (PREFIX + config_id, json.dumps(stored)))
    return read(app, config_id)
