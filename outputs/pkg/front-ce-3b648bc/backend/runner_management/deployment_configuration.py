"""Named deployment configurations and a single runtime binding contract.

Legacy owner layouts are projected without modifying their saved data. Editing
or binding a projection materializes its independent deployment identifier.
"""
from __future__ import annotations

import ast
import hashlib
import io
import json
import re
import uuid
import zipfile
from contextlib import nullcontext
from pathlib import Path
from .retry_policy import retry_policy, DEFAULT_RETRY_POLICY

from .directory_layout import (encode, get_config_layout, get_queue_layout,
                               get_named_layout, normalize, revision, safe_path,
                               snapshot_files, store_layout, node_paths)

DEPLOYMENT_PREFIX = 'deployment-config:'
RUNTIME_PREFIX = 'runtime-config:'
DELETED_PREFIX = 'deployment-config-deleted:'


def legacy_id(kind, owner):
    return uuid.uuid5(uuid.NAMESPACE_URL, 'ce:deployment:' + kind + ':' + owner.casefold()).hex


def registry_key(layout, asset=None):
    """Manual delivery and queue execution share one installed ownership key."""
    if layout.get('registryKey'):
        return layout['registryKey']
    if layout.get('legacyType'):
        if asset:
            return '|'.join(asset[key] for key in ('config_id', 'queue_name', 'site_host'))
        from .directory_bindings import owner_key
        return '@directory:' + layout['legacyType'] + ':' + owner_key(layout['legacyOwner']) + '||'
    return '@deployment:' + layout['deploymentId']


def configurations(app, db):
    deleted = {row['setting_key'][len(DELETED_PREFIX):] for row in db.execute(
        'SELECT setting_key FROM settings WHERE setting_key LIKE ?', (DELETED_PREFIX + '%',)).fetchall()}
    result = {row['setting_key'][len(DEPLOYMENT_PREFIX):]: json.loads(row['setting_value'])
              for row in db.execute('SELECT * FROM settings WHERE setting_key LIKE ?', (DEPLOYMENT_PREFIX + '%',)).fetchall()}
    candidates = set()
    for row in db.execute('SELECT config_id,queue_name FROM code_assets').fetchall():
        candidates.add(('config', row['config_id']))
    for row in db.execute('SELECT queue_name FROM queue_runner_bindings').fetchall():
        candidates.add(('queue', row['queue_name']))
    for row in db.execute('SELECT * FROM settings').fetchall():
        key = row['setting_key']
        if key.startswith('config-directory-layout:'):
            candidates.add(('config', key[len('config-directory-layout:'):]))
        elif key.startswith('queue-directory-layout:') or key.startswith('directory-layout:'):
            layout = json.loads(row['setting_value'])
            if layout.get('bindingType') in ('queue', 'website', 'custom'):
                candidates.add((layout['bindingType'], layout.get('ownerId') or layout['queueName']))
    from .server import ApiError
    for kind, owner in sorted(candidates):
        identifier = legacy_id(kind, owner)
        if identifier in deleted:
            continue
        if identifier in result:
            continue
        try:
            layout = (get_config_layout(app, owner, db) if kind == 'config' else
                      get_queue_layout(app, owner, db) if kind == 'queue' else get_named_layout(app, kind, owner, db))
        except ApiError as exc:
            if exc.status == 404:
                continue
            raise
        label = {'config': '配置 ', 'queue': '队列 ', 'website': '网站 ', 'custom': '公共目录 '}[kind]
        item = {**layout, 'deploymentId': identifier, 'name': label + owner,
                'pathStyle': kind, 'legacyType': kind, 'legacyOwner': owner, 'isNew': False}
        item['revision'] = revision(item)
        result[identifier] = item
    for item in result.values():
        if item.get('registryKey'):
            continue
        asset = None
        if item.get('legacyType'):
            kind, owner = item['legacyType'], item['legacyOwner']
            original = (get_config_layout(app, owner, db) if kind == 'config' else
                        get_queue_layout(app, owner, db) if kind == 'queue' else get_named_layout(app, kind, owner, db))
            if original.get('codeId'):
                asset = db.execute('SELECT * FROM code_assets WHERE code_id=?', (original['codeId'],)).fetchone()
        item['registryKey'] = registry_key(item, asset)
        item['revision'] = revision(item)
    return result


def get_configuration(app, identifier, db):
    from .server import ApiError
    if not re.fullmatch('[0-9a-f]{32}', identifier or ''):
        raise ApiError('部署配置 ID 无效')
    item = configurations(app, db).get(identifier)
    if not item:
        raise ApiError('部署配置不存在，请刷新后重新选择', 404)
    return item


def list_configurations(app, keyword=''):
    with app.store.connect() as db:
        items = with_source_nodes(db, configurations(app, db).values())
        return sorted((item for item in items if keyword.strip().casefold() in
                       (' '.join(str(item.get(key, '')) for key in ('name', 'deploymentId', 'configId', 'queueName', 'siteHost', 'directoryTemplate')) +
                        ' '.join(str(node) for node in item.get('relatedSourceNodes', []))).casefold()),
                      key=lambda item: (item['name'].casefold(), item['deploymentId']))


def remove_configuration(app, identifier, expected_revision):
    from .server import ApiError, GIT_LOCK, now
    from .directory_bindings import owner_key
    from .directory_delivery import expire_deliveries
    with GIT_LOCK, app.store.connect() as db:
        item = get_configuration(app, identifier, db)
        if expected_revision != item['revision']:
            raise ApiError('部署配置已更新，请刷新列表后再删除', 409)
        if (any(doc.get('deploymentId') == identifier for doc in documents(db))
                or db.execute('SELECT 1 FROM directory_runner_bindings WHERE binding_type=? AND owner_id=?', ('deployment', identifier)).fetchone()
                or any(row.get('deploymentId') == identifier for row in runtime_rows(app, db))):
            raise ApiError('部署配置已绑定机器，请先到「服务器」移除对应绑定后再删除', 409)
        expire_deliveries(db)
        owners = [('deployment', identifier)]
        if item.get('legacyType'):
            owners.append((item['legacyType'], item['legacyOwner']))
        for kind, owner in owners:
            if db.execute("SELECT 1 FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND status IN ('pending','running')",
                          (kind, owner_key(owner))).fetchone():
                raise ApiError('此部署配置有代码正在下发，请完成后再删除', 409)
        db.execute('DELETE FROM settings WHERE setting_key=?', (DEPLOYMENT_PREFIX + identifier,))
        if item.get('legacyType'):
            # Old layouts/code assets remain as history, but must not recreate
            # the deleted legacy projection on the next list request.
            store_layout(db, DELETED_PREFIX + identifier, {'deploymentId': identifier, 'name': item['name'], 'deletedAt': now()})
        return {'ok': True}


def with_source_nodes(db, items):
    """Resolve legacy origins for display without changing saved bindings/revisions.

    A config can be reused by several flow versions. Return every live node;
    never turn the first query result into a persisted sourceNode binding.
    """
    items = [dict(item) for item in items]
    ids = sorted({item['configId'] for item in items if item.get('configId')})
    if not ids:
        return items
    try:
        rows = db.execute(
            'SELECT i.CONFIG_ID config_id,i.ITEM_CONFIG step_id,i.NAME node_name,'
            'f.FLOW_ID flow_id,f.FLOW_NAME flow_name,f.IS_DELETE flow_flag '
            'FROM cs_item_config i JOIN cs_flow f ON f.FLOW_ID=i.FLOW_ID '
            'WHERE i.IS_DELETE>=0 AND f.IS_DELETE>=0 AND i.CONFIG_ID IN (' +
            ','.join('?' for _ in ids) + ') ORDER BY f.FLOW_ID,i.ITEM_CONFIG', ids).fetchall()
    except Exception as exc:
        # Standalone Runner installations may not have the business schema.
        import sqlite3
        missing = (isinstance(exc, sqlite3.OperationalError) and 'no such table:' in str(exc)) or (
            getattr(exc, 'args', ()) and exc.args[0] == 1146)
        if not missing:
            raise
        return items
    indexed = {}
    for row in rows:
        config_id = str(row['config_id'])
        indexed.setdefault(config_id, []).append({
            'configId': config_id, 'flowId': str(row['flow_id']),
            'flowName': row['flow_name'] or '流程 ' + str(row['flow_id']),
            'stepId': str(row['step_id']), 'nodeName': row['node_name'] or '节点 ' + str(row['step_id']),
            'isDraft': row['flow_flag'] == 2})
    for item in items:
        item['relatedSourceNodes'] = indexed.get(str(item.get('configId', '')), [])
    return items


def save_configuration(app, payload, identifier='', *, _db=None):
    from .server import ApiError, GIT_LOCK, required_text, now
    with (nullcontext() if _db is not None else GIT_LOCK), (nullcontext(_db) if _db is not None else app.store.connect()) as db:
        current = get_configuration(app, identifier, db) if identifier else None
        if current and payload.get('revision') != current['revision']:
            raise ApiError('部署配置已被修改，请刷新后再保存', 409)
        name = required_text(payload, 'name', 100).strip()
        if not name:
            raise ApiError('请填写配置名称')
        identifier = identifier or uuid.uuid4().hex
        layout = normalize(app, '', payload, db, standalone=True)
        clear_entry = payload.get('clearEntryPoint', False)
        if type(clear_entry) is not bool:
            raise ApiError('清除执行入口标记无效')
        if clear_entry and layout['entryPoint']:
            raise ApiError('清除执行入口时不能同时指定启动文件')
        # Adding mappings must not erase a saved entry when an older client
        # omits it or submits an empty value. Follow the same mapped node if
        # it was moved/renamed, and clear only if it was removed or explicitly
        # requested. This never selects an entry from another configuration.
        if current and current.get('entryPoint') and not layout['entryPoint'] and not clear_entry:
            old_paths, new_paths = node_paths(current), node_paths(layout)
            entry = current['entryPoint']
            for node in current['nodes']:
                old_path = old_paths[node['id']]
                mapped_entry = node.get('repoId') and (entry == old_path or
                    node.get('sourceType') == 'directory' and entry.startswith(old_path + '/'))
                if mapped_entry and node['id'] in new_paths:
                    replacement = next(item for item in layout['nodes'] if item['id'] == node['id'])
                    if replacement.get('repoId') and replacement['kind'] == node['kind']:
                        layout['entryPoint'] = safe_path(new_paths[node['id']] + entry[len(old_path):])
                    break
        for key in ('configId', 'queueName', 'siteHost'):
            value = payload.get(key, '')
            if not isinstance(value, str) or len(value) > 253:
                raise ApiError('路径变量值无效')
            layout[key] = value
        # Resolve values now, so a saved configuration can be used on any Runner.
        from .directory_delivery import target_path
        target_path(layout)
        style = payload.get('pathStyle', 'custom')
        if style not in ('config', 'queue', 'website', 'custom'):
            raise ApiError('路径格式无效')
        item = {**layout, 'deploymentId': identifier, 'name': name, 'pathStyle': style, 'isNew': False}
        source = payload.get('sourceNode', (current or {}).get('sourceNode'))
        if (current or {}).get('sourceNode') and source is None:
            raise ApiError('已有部署配置不能移除来源节点')
        if source is not None:
            if not isinstance(source, dict):
                raise ApiError('来源流程节点无效')
            source = {key: required_text(source, key, limit).strip() for key, limit in
                      (('flowId', 100), ('flowName', 500), ('stepId', 100), ('nodeName', 500), ('configId', 100))}
            if not all(source.values()) or source['configId'] != layout['configId']:
                raise ApiError('节点配置 ID 必须与来源流程节点一致')
            original = (current or {}).get('sourceNode')
            if original and any(source[key] != original[key] for key in ('flowId', 'stepId', 'configId')):
                raise ApiError('已有部署配置不能更换来源节点，请从流程节点另建配置')
            item['sourceNode'] = source
            code_id = payload.get('codeId', '')
            if code_id:
                if not isinstance(code_id, str):
                    raise ApiError('节点代码无效')
                code = db.execute('SELECT * FROM code_assets WHERE code_id=?', (code_id,)).fetchone()
                if not code or code['config_id'] != source['configId']:
                    raise ApiError('关联代码必须属于来源节点配置')
                item['codeId'] = code_id
        if current:
            for key in ('managedBy', 'deploymentEnvironment'):
                if key in current:
                    item[key] = current[key]
            for key in ('legacyType', 'legacyOwner'):
                if key in current:
                    item[key] = current[key]
            if 'codeId' not in payload:
                item['codeId'] = current.get('codeId', '')
        item['registryKey'] = current['registryKey'] if current else '@deployment:' + identifier
        item['updatedAt'] = now()
        item['revision'] = revision(item)
        store_layout(db, DEPLOYMENT_PREFIX + identifier, item)
        return item


def ensure_node_configuration(app, payload):
    """Idempotent save from orchestration; never binds, delivers or starts a Runner."""
    from .server import ApiError, GIT_LOCK, required_text, CODE_VERSION_SELECT
    from .directory_layout import get_layout
    from .script_file_links import state as file_link_state
    raw_source = payload.get('sourceNode')
    if not isinstance(raw_source, dict):
        raise ApiError('请提供来源流程节点')
    source = {key: required_text(raw_source, key, limit) for key, limit in
              (('flowId', 100), ('flowName', 500), ('stepId', 100), ('nodeName', 500), ('configId', 100))}
    queue = payload.get('queueName', '')
    if not isinstance(queue, str) or len(queue) > 253:
        raise ApiError('任务队列无效')
    queue = queue.strip()
    digest = payload.get('scriptDigest', '')
    if not isinstance(digest, str):
        raise ApiError('代码版本无效')
    identity = tuple(source[key] for key in ('flowId', 'stepId', 'configId'))
    identifier = uuid.uuid5(uuid.NAMESPACE_URL, 'ce:node-deployment:' + encode(identity)).hex
    with GIT_LOCK, app.store.connect() as db:
        items = configurations(app, db)
        matches = [item for item in items.values() if item.get('managedBy') != 'generated-code' and item.get('sourceNode') and
                   tuple(item['sourceNode'][key] for key in ('flowId', 'stepId', 'configId')) == identity]
        if len(matches) > 1 and identifier not in items:
            raise ApiError('该流程节点已有多个部署配置，请在部署配置中选择要更新的项', 409)
        current = items.get(identifier) or (matches[0] if matches else None)
        if not current:
            # Materialize the existing config projection instead of showing it twice.
            # A config reused by another flow/node still gets its own deployment identity.
            config_identifier = legacy_id('config', source['configId'])
            legacy = items.get(config_identifier)
            if (legacy and not legacy.get('sourceNode') and legacy.get('queueName') == queue
                    and not file_link_state(db, legacy.get('codeId', '')).get('detached')):
                current = legacy
                if current['name'] == '配置 ' + source['configId']:
                    current = {**current, 'name': source['flowName'] + ' / ' + source['nodeName']}
            elif not legacy:
                identifier = config_identifier
        if current:
            identifier = current['deploymentId']
        versions = db.execute(CODE_VERSION_SELECT + 'WHERE a.config_id=? AND a.queue_name=? '
                              'ORDER BY v.published_at DESC,v.digest DESC', (source['configId'], queue)).fetchall()
        versions = [row for row in versions if not file_link_state(db, row['code_id']).get('detached')]
        version = next((row for row in versions if row['digest'] == digest), None) if digest else next(
            (row for row in versions if current and row['code_id'] == current.get('codeId')), versions[0] if versions else None)
        if digest and not version:
            raise ApiError('代码版本不属于当前节点配置和任务队列', 409)
        layout = dict(current) if current else {
            'name': source['flowName'] + ' / ' + source['nodeName'], 'pathStyle': 'config',
            'configId': source['configId'], 'directoryTemplate': '{configId}', 'nodes': [],
            'entryPoint': '', 'codeId': '', 'siteHost': '',
        }
        if version:
            if not layout['nodes']:
                generated = get_layout(app, version['code_id'], db)
                layout['nodes'] = generated['nodes']
                layout['siteHost'] = generated['siteHost']
            repo_id = version['version_repo_id'] or version['repo_id']
            path = version['repository_storage_path'] or version['storage_path']
            matches_code = lambda node: node.get('repoId') == repo_id and node.get('sourcePath') == path and node.get('sourceType') == 'file'
            if not any(matches_code(node) for node in layout['nodes']):
                target_name = path.rsplit('/', 1)[-1]
                if target_name.casefold() in {value.casefold() for value in node_paths(layout).values()}:
                    raise ApiError('部署目录已有同名文件，请在部署配置中调整代码映射后重试', 409)
                layout['nodes'] = [*layout['nodes'], {'id': 'generated-' + version['code_id'], 'parentId': '',
                                   'name': target_name, 'kind': 'file', 'repoId': repo_id,
                                   'sourcePath': path, 'sourceType': 'file', 'gitCommit': version['git_commit']}]
            # Update only this generated file; custom targets, dependencies and entry stay intact.
            layout['nodes'] = [dict(node, gitCommit=version['git_commit']) if matches_code(node) else node for node in layout['nodes']]
            layout['codeId'] = version['code_id']
        elif current and (queue != current.get('queueName') or file_link_state(db, current.get('codeId', '')).get('detached')):
            layout['codeId'] = ''
        layout.update(sourceNode=source, queueName=queue, configId=source['configId'])
        # Repeated saves without changes do not advance the deployment revision.
        if current and all(layout.get(key) == current.get(key) for key in
                           ('sourceNode', 'queueName', 'configId', 'codeId', 'siteHost', 'nodes')):
            return current
        result = save_configuration(app, layout, identifier if current else '', _db=db)
        if not current:
            # Use the stable node key so simultaneous/repeated saves resolve to one deployment.
            db.execute('DELETE FROM settings WHERE setting_key=?', (DEPLOYMENT_PREFIX + result['deploymentId'],))
            result.update(deploymentId=identifier, registryKey='@deployment:' + identifier)
            result['revision'] = revision(result)
            store_layout(db, DEPLOYMENT_PREFIX + identifier, result)
        return result


def documents(db):
    return [json.loads(row['setting_value']) for row in db.execute(
        'SELECT * FROM settings WHERE setting_key LIKE ?', (RUNTIME_PREFIX + '%',)).fetchall()]


def delivery_compatibility(app, delivery, doc, assignment, layout, db, latest_snapshots):
    """Compare executable files, not configuration metadata or entry selection.

    Runner still verifies the actual local files against the signed program at
    start. This only proves that the acknowledged delivery contains that code.
    """
    from .server import ApiError
    from .snapshot_reader import read_snapshot
    from .artifacts import verify_artifact
    from .bundle_install import code_key
    from .directory_delivery import target_path
    from cryptography.exceptions import InvalidSignature
    result = {'deliveredCodeMatches': False, 'latestCodeMatchesDelivery': False}
    if not delivery or delivery['status'] != 'success':
        return result
    def read(digest):
        signed = db.execute('SELECT signature FROM directory_deliveries WHERE artifact_digest=? LIMIT 1', (digest,)).fetchone()
        if not signed:
            raise ValueError('找不到已下发版本的签名')
        return app.artifacts.read(digest), signed['signature']
    try:
        delivered, manifest = read_snapshot(read, delivery['artifactDigest'], app.artifacts.public_key)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, InvalidSignature):
        return result
    delivered_directories = set(manifest.get('directories', []))
    delivered_hashes = {path: hashlib.sha256(data).hexdigest() for path, data in delivered.items() if path != 'manifest.json'}
    for path in delivered:
        parts = path.split('/')
        delivered_directories.update('/'.join(parts[:index]) for index in range(1, len(parts)))
    def matches(hashes, root, key, directories):
        return (root == delivery['targetPath'] and code_key(manifest) == key
                and bool(hashes) and set(directories) <= delivered_directories
                and all(delivered_hashes.get(path) == digest for path, digest in hashes.items()))
    if assignment and assignment['processorType'] == 'deployment-entry':
        try:
            digest = assignment['releaseDigest']
            signed = db.execute('SELECT signature FROM releases WHERE digest=?', (digest,)).fetchone()
            if signed:
                data = app.artifacts.read(digest)
                verify_artifact(data, digest, signed['signature'], app.artifacts.public_key)
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    program = json.loads(archive.read('manifest.json'))
                    files = {name: archive.read(name) for name in archive.namelist() if name != 'manifest.json'}
                result['deliveredCodeMatches'] = (program.get('executionSchema') == 2
                    and bool(doc.get('executionEntry')) and doc['executionEntry'] == program['entry']
                    and doc['executionEntry'] in files and doc.get('executionDirectory') == program['directoryTemplate']
                    and matches({path: hashlib.sha256(data).hexdigest() for path, data in files.items()},
                                program['directoryTemplate'], code_key(program), program.get('directories', [])))
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, InvalidSignature):
            pass
    try:
        root, key = target_path(layout), registry_key(layout)
        # Git commits are immutable. Cache only bounded file hashes, excluding
        # entry/name metadata, so heartbeat/list queries do not reread every repo.
        content_key = revision({'nodes': layout['nodes'], 'root': root, 'registryKey': key})
        if content_key not in latest_snapshots:
            files, _, directories = snapshot_files(app, layout, db)
            if len(latest_snapshots) >= 64:
                latest_snapshots.clear()
            latest_snapshots[content_key] = ({path: hashlib.sha256(data).hexdigest() for path, data in files.items()}, directories)
        hashes, directories = latest_snapshots[content_key]
        result['latestCodeMatchesDelivery'] = matches(hashes, root, key, directories)
    except (OSError, ValueError, KeyError, ApiError):
        pass
    return result


def runtime_rows(app, db):
    from .directory_bindings import list_bindings
    from .server import ASSIGNMENT_SELECT, as_assignment
    layouts = configurations(app, db)
    assignments = {row['assignment_id']: as_assignment(row) for row in db.execute(ASSIGNMENT_SELECT).fetchall()}
    bindings = list_bindings(app, db)
    docs = documents(db)
    used_assignments, used_bindings, rows = set(), set(), []
    if not hasattr(app, '_deployment_content_hashes'):
        app._deployment_content_hashes = {}
    latest_snapshots = app._deployment_content_hashes

    def append(doc, binding, assignment):
        layout = layouts.get(doc.get('deploymentId'))
        if not layout:
            return
        # A legacy association can deliver the independent edited configuration
        # immediately, without changing its queue's currently adopted version.
        if binding and binding['bindingType'] != 'deployment':
            from .directory_bindings import owner_key
            from .directory_delivery import as_delivery
            latest = db.execute('SELECT * FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? ORDER BY requested_at DESC,delivery_id DESC LIMIT 1',
                                ('deployment', owner_key(layout['deploymentId']), doc['runnerId'])).fetchone()
            binding = {**binding, 'bindingType': 'deployment', 'ownerId': layout['deploymentId'],
                       'directoryTemplate': layout['directoryTemplate'], 'entryPoint': layout['entryPoint'],
                       'layoutRevision': layout['revision'], 'delivery': as_delivery(latest) if latest else binding['delivery']}
        if assignment and assignment['processorType'] == 'deployment-entry':
            assignment = {**assignment, 'deliveryPath': doc.get('executionEntry', ''),
                          'directoryTemplate': doc.get('executionDirectory', ''), 'scriptDigest': doc.get('scriptDigest', '')}
        item = {**doc, 'name': layout['name'], 'retryPolicy': retry_policy(doc.get('retryPolicy')),
                'entryPoint': doc.get('executionEntry', layout['entryPoint']),
                'directoryTemplate': doc.get('executionDirectory', layout['directoryTemplate']),
                'layoutRevision': layout['revision'],
                'binding': binding, 'assignment': assignment}
        item.update(delivery_compatibility(app, (binding or {}).get('delivery'), doc, assignment, layout, db, latest_snapshots))
        item['revision'] = revision(item)
        rows.append(item)

    for doc in docs:
        assignment = assignments.get(doc.get('assignmentId'))
        used_assignments.add(doc.get('assignmentId'))
        binding = next((row for row in bindings if row['bindingType'] == 'deployment'
                        and row['ownerId'] == doc['deploymentId'] and row['runnerId'] == doc['runnerId']), None)
        if binding:
            used_bindings.add(('deployment', doc['deploymentId'], doc['runnerId']))
        if doc.get('legacyRef'):
            used_bindings.add(tuple(doc['legacyRef']))
        append(doc, binding, assignment)
    for binding in bindings:
        key = (binding['bindingType'], binding['ownerId'], binding['runnerId'])
        if key in used_bindings:
            continue
        identifier = binding['ownerId'] if key[0] == 'deployment' else legacy_id(key[0], key[1])
        related = [item for item in assignments.values() if item['runnerId'] == key[2]
                   and ((key[0] == 'config' and item['configId'] == key[1])
                        or (key[0] == 'queue' and item['queue'] == key[1])
                        or (key[0] == 'website' and item['siteHost'] == key[1]))]
        matches = [item for item in related if item['assignmentId'] not in used_assignments]
        # The old config API infers a directory binding from active queues.
        # Queues already represented by independent runtime documents must not
        # also create an empty legacy row; explicit old directory bindings stay.
        if key[0] == 'config' and related and not matches and not db.execute(
                'SELECT 1 FROM config_runner_bindings WHERE config_id=? AND runner_id=?', (key[1], key[2])).fetchone():
            continue
        for assignment in matches or [None]:
            if assignment:
                used_assignments.add(assignment['assignmentId'])
            runtime_id = 'legacy-' + hashlib.sha256(encode([*key, assignment['assignmentId'] if assignment else '']).encode()).hexdigest()[:32]
            append({'runtimeId': runtime_id, 'deploymentId': identifier, 'runnerId': key[2],
                    'assignmentId': assignment['assignmentId'] if assignment else '', 'legacyRef': list(key),
                    'appliedRevision': ''}, binding, assignment)
    # Existing queue-only assignments remain visible; no queue is stopped by migration.
    for assignment in assignments.values():
        if assignment['assignmentId'] in used_assignments:
            continue
        identifier = legacy_id('config', assignment['configId']) if assignment['configId'] else ''
        if identifier in layouts:
            append({'runtimeId': 'legacy-' + assignment['assignmentId'], 'deploymentId': identifier,
                    'runnerId': assignment['runnerId'], 'assignmentId': assignment['assignmentId'], 'appliedRevision': ''}, None, assignment)
        else:
            item = {'runtimeId': 'legacy-' + assignment['assignmentId'], 'deploymentId': '', 'name': '待选择部署配置',
                    'runnerId': assignment['runnerId'], 'assignmentId': assignment['assignmentId'], 'appliedRevision': '',
                    'directoryTemplate': '', 'entryPoint': '', 'layoutRevision': '', 'binding': None, 'assignment': assignment,
                    'retryPolicy': retry_policy()}
            item['revision'] = revision(item)
            rows.append(item)
    from .process_control import runtime_slots
    return runtime_slots(db, rows)


def list_runtimes(app):
    with app.store.connect() as db:
        return runtime_rows(app, db)


def program_snapshot(app, layout, db):
    """Package exactly the selected entry and tree, without a queue shell."""
    from .server import ApiError, now
    from .directory_delivery import target_path
    files, sources, directories = snapshot_files(app, layout, db)
    entry = layout['entryPoint']
    if not entry.lower().endswith('.py') or entry not in files:
        raise ApiError('请在部署目录中选择已关联仓库的 Python 启动文件', 422)
    try:
        ast.parse(files[entry].decode('utf-8-sig'))
    except (UnicodeError, SyntaxError) as exc:
        raise ApiError('启动文件不是有效的 Python 代码', 422) from exc
    primary = next(source for source in sources if entry == source['targetPath'] or
                   source['sourceType'] == 'directory' and entry.startswith(source['targetPath'] + '/'))
    manifest = {'kind': 'processor', 'processorType': 'deployment-entry', 'entry': entry,
                'executionSchema': 2, 'directoryTemplate': target_path(layout),
                'deploymentId': layout['deploymentId'], 'deploymentRevision': layout['revision'],
                'configId': layout['configId'], 'queueName': layout['queueName'],
                'siteHost': layout['siteHost'], 'codeId': layout.get('codeId', ''),
                'registryKey': registry_key(layout), 'layoutSchema': 2, 'versionFile': 'version.json',
                'directories': directories, 'sources': sources}
    digest, signature = app.artifacts.publish(files, manifest)
    db.execute('INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)',
               (digest, 'processor', 'deployment-entry', 'any', primary['gitCommit'],
                'published', now(), signature, entry, 'deployment:' + layout['deploymentId']))
    return digest


def save_runtime(app, payload, *, _db=None):
    from .server import ApiError, GIT_LOCK, now, required_text, valid_environment
    from .directory_bindings import owner_key
    from .directory_delivery import target_path
    with (nullcontext() if _db is not None else GIT_LOCK), (nullcontext(_db) if _db is not None else app.store.connect()) as db:
        rows = runtime_rows(app, db)
        old = next((row for row in rows if row['runtimeId'] == payload.get('runtimeId')), None)
        if payload.get('runtimeId') and not old:
            raise ApiError('运行配置不存在，请刷新', 404)
        if old and payload.get('revision') != old['revision']:
            raise ApiError('运行配置已更新，请刷新后再保存', 409)
        try:
            policy = retry_policy(payload.get('retryPolicy', (old or {}).get('retryPolicy')))
        except ValueError as exc:
            raise ApiError(str(exc), 422) from exc
        identifier = required_text(payload, 'deploymentId', 32)
        layout = get_configuration(app, identifier, db)
        if payload.get('layoutRevision') != layout['revision']:
            raise ApiError('部署配置已更新，请重新选择', 409)
        normalize(app, '', layout, db, standalone=True)
        runner_id = required_text(payload, 'runnerId', 80)
        runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (runner_id,)).fetchone()
        if not runner:
            raise ApiError('运行机器不存在，请刷新', 404)
        if old and runner_id != old['runnerId']:
            raise ApiError('修改运行机器请新建绑定，以保留原机器的运行状态')
        environment = payload.get('environment', 'test')
        env = valid_environment(environment)
        environment = 'production' if env == 'prd' else 'test'
        concurrency = payload.get('concurrency', 1)
        if type(concurrency) is not int or not 1 <= concurrency <= 100:
            raise ApiError('并发数应为 1 至 100')
        # Omission is the current binding contract. Explicit values remain
        # supported for existing clients, including directory-only bindings.
        code_id = payload.get('codeId', layout.get('codeId', ''))
        if not isinstance(code_id, str):
            raise ApiError('运行队列无效')
        assignment = old.get('assignment') if old else None
        if assignment and assignment['enabled'] and policy != DEFAULT_RETRY_POLICY and 'retry-policy' not in json.loads(runner['capabilities']):
            raise ApiError('此 Runner 尚不支持自定义重试策略，请先升级 Runner', 422)
        assignment_id = assignment['assignmentId'] if assignment else ''
        if (assignment and not code_id and not assignment.get('codeId') and not layout.get('entryPoint')
                and assignment['processorType'] != 'deployment-entry'):
            code_id = '@existing'
        script_digest = ''
        if not code_id and any(row['deploymentId'] == identifier and row['runnerId'] == runner_id and not row.get('assignmentId')
                               and row['runtimeId'] != (old or {}).get('runtimeId') for row in rows):
            raise ApiError('此部署配置已绑定该机器，请编辑已有运行配置', 409)
        if not layout.get('entryPoint') and code_id == '@existing':
            if not assignment or assignment.get('codeId') or assignment['processorType'] == 'deployment-entry':
                raise ApiError('原有队列运行信息无效，请刷新')
            db.execute('UPDATE assignments SET concurrency=?,environment=? WHERE assignment_id=?', (concurrency, environment, assignment_id))
        elif layout.get('entryPoint'):
            if code_id:
                code = db.execute('SELECT * FROM code_assets WHERE code_id=?', (code_id,)).fetchone()
                if not code:
                    raise ApiError('运行代码不存在，请刷新', 404)
                if layout.get('sourceNode') and code['config_id'] != layout['configId']:
                    raise ApiError('关联代码必须属于部署配置的来源节点')
            queue = layout.get('queueName') or '@deployment:' + identifier
            duplicate = db.execute('SELECT assignment_id FROM assignments WHERE runner_id=? AND queue=?', (runner_id, queue)).fetchone()
            if duplicate and duplicate['assignment_id'] != assignment_id:
                raise ApiError('该机器已运行此队列，请编辑已有运行配置', 409)
            script_digest = program_snapshot(app, layout, db)
            # A changed entry/version stays stopped until the explicit Start
            # action. It must never replace a running process invisibly.
            enabled = int(bool(assignment and assignment['enabled']
                               and assignment['processorType'] == 'deployment-entry'
                               and assignment['releaseDigest'] == script_digest))
            if assignment_id:
                db.execute('UPDATE assignments SET queue=?,processor_type=?,release_digest=?,concurrency=?,environment=?,code_id=?,enabled=? WHERE assignment_id=?',
                           (queue, 'deployment-entry', script_digest, concurrency, environment, code_id, enabled, assignment_id))
            else:
                assignment_id = str(uuid.uuid4())
                db.execute('INSERT INTO assignments (assignment_id,runner_id,queue,processor_type,release_digest,concurrency,enabled,environment,code_id) VALUES (?,?,?,?,?,?,?,?,?)',
                           (assignment_id, runner_id, queue, 'deployment-entry', script_digest, concurrency, 0, environment, code_id))
        elif assignment_id:
            db.execute('DELETE FROM assignments WHERE assignment_id=?', (assignment_id,))
            assignment_id = ''
        existing_doc = next((doc for doc in documents(db) if doc.get('deploymentId') == identifier and doc['runnerId'] == runner_id
                             and doc.get('runtimeId') != (old or {}).get('runtimeId') and not code_id and not doc.get('assignmentId')), None)
        if existing_doc:
            raise ApiError('此部署配置已绑定该机器', 409)
        store_layout(db, DEPLOYMENT_PREFIX + identifier, layout)
        db.execute('INSERT OR IGNORE INTO directory_runner_bindings VALUES (?,?,?,?,?)', ('deployment', owner_key(identifier), identifier, runner_id, now()))
        runtime_id = old['runtimeId'] if old and not old['runtimeId'].startswith('legacy-') else uuid.uuid4().hex
        doc = {'runtimeId': runtime_id, 'deploymentId': identifier, 'runnerId': runner_id,
               'assignmentId': assignment_id, 'appliedRevision': layout['revision'], 'scriptDigest': script_digest,
               'executionEntry': layout['entryPoint'], 'retryPolicy': policy,
               'executionDirectory': target_path(layout) if script_digest else layout['directoryTemplate']}
        if old and old.get('legacyRef'):
            doc['legacyRef'] = old['legacyRef']
        store_layout(db, RUNTIME_PREFIX + runtime_id, doc)
        if old and old.get('deploymentId') and old['deploymentId'] != identifier:
            if not any(item['deploymentId'] == old['deploymentId'] and item['runnerId'] == runner_id for item in documents(db)):
                db.execute('DELETE FROM directory_runner_bindings WHERE binding_type=? AND owner_key=? AND runner_id=?', ('deployment', owner_key(old['deploymentId']), runner_id))
        return next(row for row in runtime_rows(app, db) if row['runtimeId'] == runtime_id)


def control_runtime(app, runtime_id, expected_revision, enabled):
    """Set desired worker state; heartbeat remains the evidence of actual state."""
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        row = next((item for item in runtime_rows(app, db) if item['runtimeId'] == runtime_id), None)
        if not row:
            raise ApiError('机器配置不存在，请刷新', 404)
        if expected_revision != row['revision']:
            raise ApiError('机器配置已更新，请刷新后重试', 409)
        assignment = row.get('assignment')
        if enabled and row.get('deploymentId') and (not assignment or
                assignment['processorType'] == 'deployment-entry' and not row.get('entryPoint')):
            layout = get_configuration(app, row['deploymentId'], db)
            if layout.get('entryPoint'):
                raise ApiError('机器配置尚未采用启动文件「' + layout['entryPoint'] +
                               '」。请点击「编辑 → 保存配置」采用入口；已下发且代码未变化时可直接启动。', 422)
            raise ApiError('部署配置「' + layout['name'] +
                           '」未设置启动文件。请在「部署配置」中选择 Python 文件并设为执行入口，保存后再编辑保存机器配置。', 422)
        if not assignment:
            raise ApiError('此绑定仅用于下发目录，没有可启动的节点处理程序', 422)
        if enabled and row['retryPolicy'] != DEFAULT_RETRY_POLICY:
            machine = db.execute('SELECT capabilities FROM runners WHERE runner_id=?', (row['runnerId'],)).fetchone()
            if not machine or 'retry-policy' not in json.loads(machine['capabilities']):
                raise ApiError('此 Runner 尚不支持自定义重试策略，请先升级 Runner', 422)
        if enabled and assignment['processorType'] == 'deployment-entry':
            runner = db.execute('SELECT capabilities FROM runners WHERE runner_id=?', (row['runnerId'],)).fetchone()
            if not runner or 'deployment-entry' not in json.loads(runner['capabilities']):
                raise ApiError('此 Runner 尚不支持按配置入口启动，请先升级 Runner', 422)
            delivery = (row.get('binding') or {}).get('delivery')
            if not delivery:
                raise ApiError('此机器配置尚未下发代码。请点击「下发代码」，等待成功后再启动。', 422)
            if delivery['status'] == 'pending':
                raise ApiError('代码下发任务已提交，正在等待 Runner 处理。请等待下发成功后再启动。', 422)
            if delivery['status'] == 'running':
                raise ApiError('代码正在下发。请等待下发成功后再启动。', 422)
            if delivery['status'] == 'failed':
                reason = '：' + delivery['error'].rstrip('。') if delivery.get('error') else ''
                raise ApiError('代码下发失败' + reason + '。请查看运行日志，重新下发成功后再启动。', 422)
            if delivery['status'] != 'success':
                raise ApiError('代码下发结果尚未确认。请刷新机器配置，确认下发成功后再启动。', 422)
            if not row['deliveredCodeMatches']:
                if row['latestCodeMatchesDelivery']:
                    raise ApiError('已下发代码与当前启动配置不匹配。请点击「编辑 → 保存配置」采用启动配置，代码未变化时无需重新下发。', 422)
                if delivery['layoutRevision'] == row['layoutRevision'] and row['appliedRevision'] != row['layoutRevision']:
                    raise ApiError('代码已下发成功，但机器配置尚未采用该版本。请点击「编辑 → 保存配置」采用后再启动。', 422)
                if row['appliedRevision'] == row['layoutRevision']:
                    raise ApiError('机器配置已采用新版本，但上次下发的仍是其他版本。请重新下发代码，成功后再启动。', 422)
                raise ApiError('已下发代码与机器采用的配置版本不一致。请先点击「编辑 → 保存配置」，再下发代码，成功后启动。', 422)
        elif enabled and row.get('deploymentId') and row.get('entryPoint'):
            raise ApiError('此绑定仍使用旧处理程序，请编辑保存机器配置，采用所选启动文件', 422)
        elif enabled and assignment.get('codeId'):
            # Paused bindings may have been created before another deployment
            # started using this node. Recheck exclusivity at the start boundary.
            code = db.execute('SELECT * FROM code_assets WHERE code_id=?', (assignment['codeId'],)).fetchone()
            if not code:
                raise ApiError('节点代码不存在，请编辑保存机器配置', 422)
            others = db.execute('SELECT x.assignment_id FROM assignments x JOIN code_assets a ON a.code_id=x.code_id '
                                'WHERE x.enabled=1 AND x.environment=? AND a.config_id=? AND x.queue=? AND a.site_host=? AND x.assignment_id<>?',
                                (assignment['environment'], code['config_id'], assignment['queue'], code['site_host'], assignment['assignmentId'])).fetchall()
            other_docs = {doc.get('assignmentId'): doc for doc in documents(db)}
            if any(other_docs.get(item['assignment_id'], {}).get('deploymentId') != row['deploymentId'] for item in others):
                raise ApiError('此队列在同一环境已使用其他部署配置，请先停止冲突程序', 409)
            doc = other_docs.get(assignment['assignmentId'])
            if doc and doc.get('scriptDigest'):
                if any(other_docs.get(item['assignment_id'], {}).get('scriptDigest') != doc['scriptDigest'] for item in others):
                    raise ApiError('此节点已有不同修订的程序运行，请编辑保存以统一配置', 409)
                # Restore this saved binding's snapshot, rather than whichever
                # paused deployment last saved the shared node/environment.
                keys = ('prd' if assignment['environment'] == 'production' else 'test',
                        code['config_id'], assignment['queue'], code['site_host'])
                db.execute('UPDATE code_runtime_bindings SET digest=? WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?',
                           (doc['scriptDigest'], *keys))
        db.execute('UPDATE assignments SET enabled=? WHERE assignment_id=?', (int(enabled), assignment['assignmentId']))
        if enabled:
            from .process_control import new_start
            new_start(db, assignment['assignmentId'])
        return next(item for item in runtime_rows(app, db) if item['runtimeId'] == runtime_id)


def remove_runtime(app, runtime_id, expected_revision):
    from .server import ApiError, GIT_LOCK
    from .directory_bindings import owner_key
    with GIT_LOCK, app.store.connect() as db:
        row = next((item for item in runtime_rows(app, db) if item['runtimeId'] == runtime_id), None)
        if not row:
            raise ApiError('运行配置不存在', 404)
        if expected_revision != row['revision']:
            raise ApiError('运行配置已更新，请刷新后再移除', 409)
        keys = []
        if row.get('binding'):
            keys.append((row['binding']['bindingType'], row['binding']['ownerId'], row['runnerId']))
        if row.get('legacyRef'):
            keys.append(tuple(row['legacyRef']))
        from .directory_delivery import expire_deliveries
        expire_deliveries(db)
        for kind, owner, runner_id in keys:
            if db.execute("SELECT 1 FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? AND status IN ('pending','running')", (kind, owner_key(owner), runner_id)).fetchone():
                raise ApiError('有代码正在下发，请完成后再移除绑定', 409)
        if row.get('assignmentId'):
            db.execute('DELETE FROM assignments WHERE assignment_id=?', (row['assignmentId'],))
        db.execute('DELETE FROM settings WHERE setting_key=?', (RUNTIME_PREFIX + runtime_id,))
        remaining = runtime_rows(app, db)
        for kind, owner, runner_id in keys:
            if any(item['runtimeId'] != runtime_id and item['runnerId'] == runner_id and item['deploymentId'] == row['deploymentId']
                   and not item['runtimeId'].startswith('legacy-') for item in remaining):
                continue
            if kind == 'config':
                db.execute('DELETE FROM config_runner_bindings WHERE config_id=? AND runner_id=?', (owner, runner_id))
                stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('config-directory-layout:' + owner,)).fetchone()
                if stored:
                    layout = json.loads(stored['setting_value']); layout['runnerIds'] = [value for value in layout.get('runnerIds', []) if value != runner_id]
                    store_layout(db, 'config-directory-layout:' + owner, layout)
            elif kind == 'queue':
                db.execute('DELETE FROM queue_runner_bindings WHERE queue_name=? AND runner_id=?', (owner, runner_id))
            else:
                db.execute('DELETE FROM directory_runner_bindings WHERE binding_type=? AND owner_key=? AND runner_id=?', (kind, owner_key(owner), runner_id))
        return {'ok': True}
