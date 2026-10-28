"""Explicit, immutable directory deliveries. Saving a view never queues work."""
from datetime import datetime, timedelta, timezone
import hashlib
import uuid

from .directory_bindings import owner_key, owner_layout
from .directory_layout import normalize, safe_path, snapshot_files
from .snapshot_reader import read_snapshot
from .python_cache import is_python_cache


def as_delivery(row):
    return {'deliveryId': row['delivery_id'], 'bindingType': row['binding_type'],
            'ownerId': row['owner_id'], 'runnerId': row['runner_id'],
            'status': row['status'], 'layoutRevision': row['layout_revision'],
            'artifactDigest': row['artifact_digest'], 'targetPath': row['target_path'],
            'installedPath': row['installed_path'], 'requestedAt': row['requested_at'],
            'startedAt': row['started_at'], 'finishedAt': row['finished_at'], 'error': row['error']}


def expire_deliveries(db):
    from .server import now
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(timespec='seconds')
    db.execute("UPDATE directory_deliveries SET status='failed',finished_at=?,error=? "
               "WHERE status='running' AND started_at<?", (now(), 'Runner 下发超时，请检查实例后重新下发', cutoff))


def target_path(layout):
    from .server import ApiError
    result = layout['directoryTemplate']
    for token, value in (('{configId}', layout['configId']), ('{queue}', layout['queueName']), ('{website}', layout['siteHost'])):
        if token in result and not value:
            raise ApiError('根目录模板中的变量没有对应值，请修改目录视图')
        result = result.replace(token, value)
    if '{environment}' in result:
        raise ApiError('请在目录视图中选择生产、测试或默认目录类型，再下发代码')
    return safe_path(result, template=True)


def bound_layout(app, binding_type, owner_id, runner_id, db):
    from .directory_bindings import list_bindings
    from .server import ApiError
    layout = owner_layout(app, binding_type, owner_id, db)
    owner_id = layout.get('ownerId', owner_id)
    bound = any(row['bindingType'] == binding_type and row['ownerId'].casefold() == owner_id.casefold()
                for row in list_bindings(app, db, runner_id))
    if binding_type == 'deployment':
        from .deployment_configuration import runtime_rows
        runtime = next((row for row in runtime_rows(app, db) if row['deploymentId'] == owner_id and row['runnerId'] == runner_id), None)
        bound = bound or runtime is not None
        if runtime and runtime.get('assignment') and runtime['assignment'].get('codeId'):
            layout = {**layout, 'codeId': runtime['assignment']['codeId']}
        if runtime and runtime.get('legacyRef'):
            kind, legacy_owner, legacy_runner = runtime['legacyRef']
            if db.execute("SELECT 1 FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? AND status IN ('pending','running')",
                          (kind, owner_key(legacy_owner), legacy_runner)).fetchone():
                raise ApiError('原有配置的代码正在下发，请完成后再下发部署配置', 409)
    if not bound:
        raise ApiError('绑定关系不存在，请刷新运行绑定', 404)
    normalize(app, layout['codeId'], layout, db, standalone=True)
    return layout, owner_id


def baseline(app, binding_type, owner_id, runner_id, root, db):
    row = db.execute("SELECT artifact_digest FROM directory_deliveries WHERE binding_type=? AND owner_key=? "
                     "AND runner_id=? AND target_path=? AND status='success' ORDER BY requested_at DESC,delivery_id DESC LIMIT 1",
                     (binding_type, owner_key(owner_id), runner_id, root)).fetchone()
    if not row and binding_type == 'deployment':
        from .deployment_configuration import runtime_rows
        runtime = next((item for item in runtime_rows(app, db) if item['deploymentId'] == owner_id and item['runnerId'] == runner_id), None)
        if runtime and runtime.get('legacyRef'):
            legacy_type, legacy_owner, _ = runtime['legacyRef']
            row = db.execute("SELECT artifact_digest FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? AND target_path=? AND status='success' ORDER BY requested_at DESC,delivery_id DESC LIMIT 1",
                             (legacy_type, owner_key(legacy_owner), runner_id, root)).fetchone()
    if not row:
        return None, {}, {}
    def read(digest):
        signed = db.execute('SELECT signature FROM directory_deliveries WHERE artifact_digest=? LIMIT 1', (digest,)).fetchone()
        if not signed:
            raise ValueError('找不到已下发版本的签名')
        return app.artifacts.read(digest), signed['signature']
    files, manifest = read_snapshot(read, row['artifact_digest'], app.artifacts.public_key)
    # Validate the complete signed archive first; mutable local bytecode never
    # participates in source change detection or new delivery manifests.
    return row['artifact_digest'], {name: data for name, data in files.items() if name != 'manifest.json' and not is_python_cache(name)}, {
        **manifest, 'directories': [name for name in manifest.get('directories', []) if not is_python_cache(name)]}


def preview_items(files, directories, old_files, old_manifest):
    folders = set(directories)
    for path in list(files) + list(folders):
        parts = path.split('/')
        folders.update('/'.join(parts[:i]) for i in range(1, len(parts)))
    old_folders = set(old_manifest.get('directories', []))
    for path in old_files:
        parts = path.split('/')
        old_folders.update('/'.join(parts[:i]) for i in range(1, len(parts)))
    return ([{'path': name, 'kind': 'folder', 'size': 0, 'status': 'unchanged' if name in old_folders else 'added'}
             for name in sorted(folders)]
            + [{'path': name, 'kind': 'file', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                'previousSha256': hashlib.sha256(old_files[name]).hexdigest() if name in old_files else None,
                'status': 'added' if name not in old_files else 'unchanged' if hashlib.sha256(old_files[name]).digest() == hashlib.sha256(data).digest() else 'modified'}
               for name, data in sorted(files.items())])


def delivery_preview(app, binding_type, owner_id, runner_id):
    from .server import GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        layout, owner_id = bound_layout(app, binding_type, owner_id, runner_id, db)
        root = target_path(layout)
        files, _, directories = snapshot_files(app, layout, db)
        digest, old_files, manifest = baseline(app, binding_type, owner_id, runner_id, root, db)
        return {'revision': layout['revision'], 'targetPath': root, 'baselineDigest': digest,
                'items': preview_items(files, directories, old_files, manifest)}


def file_sources(names, sources):
    """Keep the actual Git origin of each retained file after partial updates."""
    result = []
    for name in sorted(names):
        for source in sources:
            target = source.get('targetPath', '')
            if target == name or source.get('sourceType') == 'directory' and name.startswith(target + '/'):
                result.append({**source, 'targetPath': name, 'sourcePath': source['sourcePath'] + name[len(target):],
                               'sourceType': 'file', 'kind': 'file'})
                break
    return result


def request_delivery(app, binding_type, owner_id, runner_id, payload):
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        expire_deliveries(db)
        layout, owner_id = bound_layout(app, binding_type, owner_id, runner_id, db)
        if payload.get('revision') != layout['revision']:
            raise ApiError('目录视图已更新，请刷新运行绑定后再下发', 409)
        key = (binding_type, owner_key(owner_id), runner_id)
        if db.execute("SELECT 1 FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? "
                      "AND status IN ('pending','running')", key).fetchone():
            raise ApiError('已有下发任务，请等待 Runner 回报结果', 409)
        files, sources, directories = snapshot_files(app, layout, db)
        if not files:
            raise ApiError('目录视图尚未关联仓库代码，请先配置文件或文件夹', 422)
        root = target_path(layout)
        scope = payload.get('scope', 'all')
        if scope not in ('all', 'selected'):
            raise ApiError('下发范围无效')
        partial = {}
        base_digest, old_files, old_manifest = baseline(app, binding_type, owner_id, runner_id, root, db)
        if 'baselineDigest' in payload and payload['baselineDigest'] != base_digest:
            raise ApiError('已下发版本发生变化，请重新选择下发范围', 409)
        if scope == 'selected':
            if 'baselineDigest' not in payload or payload['baselineDigest'] != base_digest:
                raise ApiError('已下发版本发生变化，请重新选择下发范围', 409)
            paths = payload.get('paths')
            items = {item['path']: item for item in preview_items(files, directories, old_files, old_manifest)}
            if (not isinstance(paths, list) or not paths or len(paths) > len(items)
                    or any(not isinstance(path, str) or path not in items for path in paths)):
                raise ApiError('请选择目录视图中的文件或文件夹')
            paths = sorted(set(paths))
            selected = {name: data for name, data in files.items()
                        if any(name == path or items[path]['kind'] == 'folder' and name.startswith(path + '/') for path in paths)}
            selected_dirs = {name for name in directories if any(name == path or name.startswith(path + '/') for path in paths)}
            selected_dirs.update(path for path in paths if items[path]['kind'] == 'folder')
            retained = {name: origin for name, origin in old_manifest.get('fileOrigins', {}).items() if name not in selected}
            combined = {name: data for name, data in old_files.items() if name in retained}
            combined.update(selected)
            if len(combined) > 2000 or sum(map(len, combined.values())) > 10 * 1024 * 1024:
                raise ApiError('合并后的代码超过 10 MB 或 2000 个文件', 413)
            directories = sorted(set(old_manifest.get('directories', [])) | selected_dirs)
            # A partial update may not silently replace an unselected file with a folder (or vice versa).
            folded = {name.casefold() for name in combined}
            if (len(folded) != len(combined) or any(name.casefold() in folded for name in directories)
                    or any('/'.join(name.split('/')[:i]).casefold() in folded
                           for name in combined for i in range(1, len(name.split('/'))))):
                raise ApiError('所选范围与保留文件的路径冲突，请调整范围或选择全部代码', 409)
            sources = file_sources(retained, old_manifest.get('sources', [])) + file_sources(selected, sources)
            files = selected
            partial = {'deliverySchema': 2, 'deliveryScope': 'selected', 'selectedPaths': paths,
                       'baseDigest': base_digest, 'retainedFiles': retained}
        else:
            combined = files
        # Every scope transfers only paths whose content differs. Retained
        # origins point directly to signed physical files, never to delta chains.
        files = {name: data for name, data in files.items() if name not in old_files
                 or hashlib.sha256(data).digest() != hashlib.sha256(old_files[name]).digest()}
        hashes = {name: hashlib.sha256(data).hexdigest() for name, data in combined.items()}
        latest = db.execute('SELECT * FROM directory_deliveries WHERE binding_type=? AND owner_key=? AND runner_id=? '
                            'ORDER BY requested_at DESC,delivery_id DESC LIMIT 1', key).fetchone()
        same_tree = (base_digest and not files and set(combined) == set(old_files)
                     and set(directories) == set(old_manifest.get('directories', [])))
        if same_tree and (not latest or latest['status'] == 'success'):
            previous = latest or db.execute("SELECT * FROM directory_deliveries WHERE artifact_digest=? AND runner_id=? AND status='success' ORDER BY requested_at DESC LIMIT 1",
                                            (base_digest, runner_id)).fetchone()
            if previous:
                return {**as_delivery(previous), 'unchanged': True, 'transferredFileCount': 0,
                        'unchangedFileCount': len(combined)}
        retained = {name: old_manifest['fileOrigins'][name] for name in combined if name not in files and name in old_files}
        if partial or retained:
            partial = {**partial, 'deliverySchema': 2, 'deliveryScope': 'selected',
                       'syncMode': scope, 'baseDigest': base_digest, 'retainedFiles': retained}
        entry = layout['entryPoint']
        if entry and entry not in combined and scope == 'all':
            raise ApiError('入口文件未关联到仓库代码，请先修改目录视图', 422)
        if entry not in combined:
            entry = ''  # First partial delivery can consist solely of shared code.
        asset = db.execute('SELECT * FROM code_assets WHERE code_id=?', (layout['codeId'],)).fetchone() if layout['codeId'] else None
        # Keep version.json compatible with existing queue workers. Standalone
        # public folders get their own stable namespace instead of a code node.
        namespace_type = layout.get('legacyType', binding_type)
        namespace_owner = layout.get('legacyOwner', owner_id)
        manifest = {'kind': 'script', 'layoutSchema': 2, 'deliverySchema': 1, 'entry': entry,
                    'configId': asset['config_id'] if asset else '@directory:' + namespace_type + ':' + owner_key(namespace_owner),
                    'queueName': asset['queue_name'] if asset else '', 'siteHost': asset['site_host'] if asset else '',
                    'codeId': layout['codeId'], 'directoryTemplate': layout['directoryTemplate'],
                    'bindingType': binding_type, 'ownerId': owner_id, 'layoutRevision': layout['revision'],
                    'deliveryRoot': root, 'directories': directories, 'sources': sources, 'versionFile': 'version.json',
                    'fileHashes': hashes, **partial}
        if binding_type == 'deployment':
            from .deployment_configuration import registry_key
            manifest.update(deploymentId=layout['deploymentId'], registryKey=registry_key(layout, asset))
        # An explicit retry of an unchanged full snapshot uses its cached bundle
        # for local verification/empty-folder recovery; no code is re-downloaded.
        if (same_tree and scope == 'all' and old_manifest.get('deliveryScope') != 'selected'
                and all(old_manifest.get(field) == manifest.get(field) for field in
                        ('bindingType', 'ownerId', 'layoutRevision', 'deliveryRoot', 'entry'))):
            digest = base_digest
            signature = db.execute('SELECT signature FROM directory_deliveries WHERE artifact_digest=? LIMIT 1', (digest,)).fetchone()['signature']
        else:
            digest, signature = app.artifacts.publish(files, manifest)
        delivery_id = uuid.uuid4().hex
        db.execute('INSERT INTO directory_deliveries '
                   '(delivery_id,binding_type,owner_key,owner_id,runner_id,layout_revision,artifact_digest,signature,'
                   'target_path,status,requested_at,started_at,finished_at,error,installed_path) '
                   'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (delivery_id, binding_type, key[1], owner_id, runner_id, layout['revision'], digest, signature,
                    root, 'pending', datetime.now(timezone.utc).isoformat(timespec='microseconds'), None, None, '', ''))
        return {**as_delivery(db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=?', (delivery_id,)).fetchone()),
                'transferredFileCount': len(files), 'unchangedFileCount': len(retained)}


def pending_deliveries(app, runner_id):
    with app.store.connect() as db:
        expire_deliveries(db)
        return [as_delivery(row) for row in db.execute(
            "SELECT * FROM directory_deliveries WHERE runner_id=? AND status='pending' ORDER BY requested_at,delivery_id",
            (runner_id,)).fetchall()]


def runner_delivery(app, runner_id, delivery_id, action, payload):
    from .server import ApiError, GIT_LOCK, now
    with GIT_LOCK, app.store.connect() as db:
        expire_deliveries(db)
        row = db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=? AND runner_id=?', (delivery_id, runner_id)).fetchone()
        if not row:
            raise ApiError('无权操作该下发任务', 403)
        if action == 'claim':
            if row['status'] != 'pending':
                raise ApiError('下发任务已被领取或结束', 409)
            db.execute("UPDATE directory_deliveries SET status='running',started_at=? WHERE delivery_id=? AND status='pending'", (now(), delivery_id))
        else:
            status = payload.get('status')
            error = payload.get('error', '')
            installed = payload.get('installedPath', '')
            if status not in ('success', 'failed') or not isinstance(error, str) or not isinstance(installed, str) or len(installed) > 1000:
                raise ApiError('下发结果无效')
            if status == 'success' and not installed:
                raise ApiError('成功结果必须包含实际安装目录')
            if row['status'] == status:
                return as_delivery(row)  # Lost acknowledgements are safe to retry.
            if row['status'] != 'running':
                raise ApiError('下发任务未运行或已经结束', 409)
            db.execute('UPDATE directory_deliveries SET status=?,finished_at=?,error=?,installed_path=? WHERE delivery_id=?',
                       (status, now(), error[:1000] if status == 'failed' else '', installed if status == 'success' else '', delivery_id))
        return as_delivery(db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=?', (delivery_id,)).fetchone())
