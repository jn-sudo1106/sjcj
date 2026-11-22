"""Runner targets for independently owned directory views."""
from __future__ import annotations

import re
import hashlib

from .directory_layout import (config_runner_layout, get_config_layout, get_queue_layout,
                               get_named_layout, save_named_layout, store_layout)


def owner_layout(app, binding_type: str, owner_id: str, db) -> dict:
    from .server import ApiError
    if binding_type == 'deployment':
        from .deployment_configuration import get_configuration
        return {**get_configuration(app, owner_id, db), 'ownerId': owner_id, 'bindingType': 'deployment'}
    if binding_type == 'config':
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', owner_id):
            raise ApiError('配置 ID 无效')
        return get_config_layout(app, owner_id, db)
    if binding_type == 'queue':
        return get_queue_layout(app, owner_id, db)
    if binding_type in ('website', 'custom'):
        return get_named_layout(app, binding_type, owner_id, db)
    raise ApiError('请选择配置、队列、网站或自定义目录绑定方式')


def owner_key(owner_id: str) -> str:
    return hashlib.sha256(owner_id.casefold().encode()).hexdigest()


def as_binding(binding_type: str, owner_id: str, runner_id: str, created_at: str, layout: dict) -> dict:
    return {'bindingType': binding_type, 'ownerId': owner_id, 'runnerId': runner_id,
            'directoryTemplate': layout['directoryTemplate'], 'entryPoint': layout['entryPoint'],
            'createdAt': created_at, 'layoutRevision': layout['revision'], 'delivery': None}


def list_bindings(app, db=None, runner_id: str | None = None, *, layouts=None) -> list[dict]:
    if db is None:
        with app.store.connect() as connection:
            return list_bindings(app, connection, runner_id, layouts=layouts)
    rows = []
    candidates = db.execute(
        "SELECT owner_id AS config_id FROM directory_runner_bindings WHERE binding_type='config' "
        'UNION SELECT a.config_id FROM assignments x JOIN code_assets a ON a.code_id=x.code_id WHERE x.enabled=1').fetchall()
    for candidate in candidates:
        owner_id = candidate['config_id']
        layout = get_config_layout(app, owner_id, db)
        targets = config_runner_layout(dict(layout), db)['runnerIds']
        dates = {row['runner_id']: row['created_at'] for row in db.execute(
            "SELECT runner_id,created_at FROM directory_runner_bindings WHERE binding_type='config' AND owner_key=?", (owner_key(owner_id),)).fetchall()}
        rows.extend(as_binding('config', owner_id, target, dates.get(target, ''), layout)
                    for target in targets if runner_id is None or target == runner_id)
    for row in db.execute('SELECT * FROM directory_runner_bindings').fetchall():
        if row['binding_type'] == 'config':
            continue
        if runner_id is not None and row['runner_id'] != runner_id:
            continue
        if layouts is not None and row['binding_type'] == 'deployment' and row['owner_id'] in layouts:
            layout = layouts[row['owner_id']]
        else:
            layout = owner_layout(app, row['binding_type'], row['owner_id'], db)
        rows.append(as_binding(row['binding_type'], row['owner_id'], row['runner_id'], row['created_at'], layout))
    # Listing must stay read-only: expiring deliveries here holds UPDATE locks
    # throughout runtime snapshot verification and blocks concurrent readers.
    # The deployment sweeper and delivery mutation paths perform expiration.
    from .directory_delivery import as_delivery
    deliveries = {}
    for delivery in db.execute('SELECT * FROM directory_deliveries ORDER BY requested_at,delivery_id').fetchall():
        deliveries[(delivery['binding_type'], delivery['owner_key'], delivery['runner_id'])] = delivery
    for row in rows:
        latest = deliveries.get((row['bindingType'], owner_key(row['ownerId']), row['runnerId']))
        row['delivery'] = as_delivery(latest) if latest else None
    return sorted(rows, key=lambda row: (row['bindingType'], row['ownerId'], row['runnerId']))


def create_binding(app, payload: dict) -> dict:
    from .server import ApiError, GIT_LOCK, now, required_text
    binding_type = required_text(payload, 'bindingType', 10)
    owner_id = required_text(payload, 'ownerId', 400)
    runner_id = required_text(payload, 'runnerId', 80)
    with GIT_LOCK, app.store.connect() as db:
        layout = owner_layout(app, binding_type, owner_id, db)
        owner_id = layout.get('ownerId', owner_id)
        if not db.execute('SELECT 1 FROM runners WHERE runner_id=?', (runner_id,)).fetchone():
            raise ApiError('Runner 实例不存在，请刷新后重新选择', 404)
        if binding_type == 'config':
            duplicate = runner_id in config_runner_layout(dict(layout), db)['runnerIds']
        else:
            duplicate = db.execute('SELECT 1 FROM directory_runner_bindings WHERE binding_type=? AND owner_key=? AND runner_id=?',
                                   (binding_type, owner_key(owner_id), runner_id)).fetchone()
        if duplicate:
            raise ApiError('此目录视图已绑定该 Runner', 409)
        created = now()
        if binding_type in ('website', 'custom') and layout['isNew']:
            layout = save_named_layout(app, binding_type, owner_id, layout, db)
        db.execute('INSERT INTO directory_runner_bindings VALUES (?,?,?,?,?)',
                   (binding_type, owner_key(owner_id), owner_id, runner_id, created))
        return as_binding(binding_type, owner_id, runner_id, created, layout)


def remove_binding(app, binding_type: str, owner_id: str, runner_id: str) -> dict:
    from .server import ApiError, GIT_LOCK, now
    with GIT_LOCK, app.store.connect() as db:
        layout = owner_layout(app, binding_type, owner_id, db)
        owner_id = layout.get('ownerId', owner_id)
        from .directory_delivery import expire_deliveries
        expire_deliveries(db)
        delivery_key = (binding_type, owner_key(owner_id), runner_id)
        if db.execute("SELECT 1 FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? AND status='running'", delivery_key).fetchone():
            raise ApiError('Runner 正在下发代码，请等待完成后再取消绑定', 409)
        from .delivery_tasks import update
        for delivery in db.execute("SELECT delivery_id FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? AND status='pending'", delivery_key).fetchall():
            update(db, delivery['delivery_id'], status='failed', expected_status='pending', finished_at=now(), error='绑定已取消，未下发代码')
        if binding_type == 'config':
            targets = set(config_runner_layout(dict(layout), db)['runnerIds'])
            if runner_id not in targets:
                raise ApiError('绑定关系不存在，请刷新列表', 404)
            targets.remove(runner_id)
            db.execute('DELETE FROM directory_runner_bindings WHERE binding_type=? AND owner_key=? AND runner_id=?', delivery_key)
            # Preserve other legacy targets and remember explicit removal without
            # stopping their existing queue assignments or changing editor revision.
            for target in targets:
                db.execute('INSERT OR IGNORE INTO directory_runner_bindings VALUES (?,?,?,?,?)', ('config', owner_key(owner_id), owner_id, target, now()))
            store_layout(db, 'config-directory-layout:' + owner_id, {**layout, 'runnerIds': sorted(targets)})
        else:
            key = (binding_type, owner_key(owner_id), runner_id)
            if not db.execute('SELECT 1 FROM directory_runner_bindings WHERE binding_type=? AND owner_key=? AND runner_id=?', key).fetchone():
                raise ApiError('绑定关系不存在，请刷新列表', 404)
            db.execute('DELETE FROM directory_runner_bindings WHERE binding_type=? AND owner_key=? AND runner_id=?', key)
        return {'ok': True}


def runner_directory_layouts(app, runner_id: str) -> list[dict]:
    with app.store.connect() as db:
        return [owner_layout(app, row['bindingType'], row['ownerId'], db)
                for row in list_bindings(app, db, runner_id)]
