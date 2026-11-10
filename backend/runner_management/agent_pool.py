"""Database leases shared by Agent/Chat endpoints using the same browser port."""
import hashlib
import json
import threading
import time
import uuid
from contextlib import contextmanager
from urllib.parse import urlsplit

ALL = 'all'
KINDS = ('agent', 'gemini-agent')
PREFIX = 'agent-lease:'


def resource_key(item):
    from .model_interfaces import host
    url = urlsplit(item['endpoint'])
    address = host(url.hostname)
    if address in ('localhost', '127.0.0.1', '::1', '0.0.0.0'):
        address = item.get('generationServerId') or address
    # WB Agent and Chat on one CDP port use one browser session.
    identity = [address, item.get('cdpPort')] if item.get('cdpPort') else [address, url.port, url.path]
    return PREFIX + hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def annotate(app, items, servers):
    with app.store.connect() as db:
        leases = {row['setting_key']: json.loads(row['setting_value']) for row in
                  db.execute('SELECT setting_key,setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()}
    machines = {row['serverId']: row for row in servers}
    for item in items:
        lease = leases.get(resource_key(item), {})
        machine = machines.get(item.get('generationServerId'))
        offline = (bool(item.get('generationServerId')) and (not machine or machine['status'] != 'online')) or item.get('generationServerMatch') in ('missing', 'offline', 'ambiguous')
        item['runtimeStatus'] = 'disabled' if not item['enabled'] else 'offline' if offline else 'busy' if lease.get('until', 0) > time.time() else 'idle'


def acquire(app, item, owner, ttl=60, *, renew=False):
    key = resource_key(item)
    with app.store.connect() as db:
        db.execute('INSERT OR IGNORE INTO settings (setting_key,setting_value) VALUES (?,?)', (key, '{}'))
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key,)).fetchone()
        previous = row['setting_value']; lease = json.loads(previous)
        if lease.get('until', 0) > time.time() and not (renew and lease.get('owner') == owner):
            return False
        value = json.dumps({'owner': owner, 'until': time.time() + ttl})
        return bool(db.execute('UPDATE settings SET setting_value=? WHERE setting_key=? AND setting_value=?', (value, key, previous)).rowcount)


def release(app, item, owner):
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (resource_key(item),)).fetchone()
        if row and json.loads(row['setting_value']).get('owner') == owner:
            db.execute('DELETE FROM settings WHERE setting_key=? AND setting_value=?', (resource_key(item), row['setting_value']))


@contextmanager
def hold(app, item, owner=None):
    from .server import ApiError
    owner = owner or uuid.uuid4().hex
    if not acquire(app, item, owner, renew=True):
        raise ApiError('智能体忙碌，请稍后重试或使用任务方式等待空闲资源', 409)
    stopped = threading.Event()
    def renew():
        while not stopped.wait(15):
            try:
                if not acquire(app, item, owner, renew=True): return
            except Exception:
                # Keep reserving through transient database errors; the initial
                # timeout prevents a crashed worker permanently occupying a port.
                continue
    worker = threading.Thread(target=renew, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stopped.set(); worker.join(timeout=2)
        release(app, item, owner)


def allows(items, identifier):
    return identifier == ALL or any(item['id'] == identifier and item['enabled'] for item in items)
