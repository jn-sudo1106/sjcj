"""Deployment configurations own entries; machine tasks inherit the selection."""
import ast
import hashlib
import json

def scope(layout):
    groups = {}
    for node in layout['nodes']:
        if not node.get('repoId') or not node.get('sourcePath'):
            continue
        parts = node['sourcePath'].split('/')
        if node.get('sourceType') != 'directory':
            parts.pop()
        root = groups.setdefault(node['repoId'], parts[:])
        while any(index >= len(parts) or value != parts[index] for index, value in enumerate(root)):
            root.pop()
    if not groups:
        return ''
    owner = layout.get('configId') or 'manual:' + layout.get('deploymentId', '')
    identity = [owner, sorted((repo, '/'.join(root)) for repo, root in groups.items())]
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def source_entry(layout, entry):
    from .directory_layout import node_paths
    paths = node_paths(layout)
    for node in layout['nodes']:
        if not node.get('repoId') or not node.get('sourcePath'):
            continue
        target = paths[node['id']]
        if node.get('sourceType') == 'directory' and entry.startswith(target + '/'):
            return {'repoId': node['repoId'], 'path': node['sourcePath'] + entry[len(target):], 'gitCommit': node['gitCommit']}
        if node.get('sourceType') != 'directory' and entry == target:
            return {'repoId': node['repoId'], 'path': node['sourcePath'], 'gitCommit': node['gitCommit']}
    return None


def target_entry(layout, choice):
    from .directory_layout import node_paths
    paths, targets = node_paths(layout), set()
    for node in layout['nodes']:
        if node.get('repoId') != choice['repoId'] or not node.get('sourcePath'):
            continue
        source = node['sourcePath']
        if node.get('sourceType') == 'directory' and choice['path'].startswith(source + '/'):
            targets.add(paths[node['id']] + choice['path'][len(source):])
        elif node.get('sourceType') != 'directory' and source == choice['path']:
            targets.add(paths[node['id']])
    if len(targets) != 1:
        from .server import ApiError
        raise ApiError('共享 Git 入口在部署配置中缺失或有多个映射，请检查源目录映射', 409)
    return targets.pop()


def read_choice(db, layout):
    from .deployment_configuration import DEPLOYMENT_PREFIX
    identifier = layout.get('entryConfigurationId')
    if identifier:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (DEPLOYMENT_PREFIX + identifier,)).fetchone()
        if row:
            configuration = json.loads(row['setting_value'])
            if 'entrySource' in configuration and scope(configuration) == scope(layout):
                return {**configuration['entrySource'], 'configurationId': identifier}
    key = scope(layout)
    if key:
        for row in db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (DEPLOYMENT_PREFIX + '%',)).fetchall():
            item = json.loads(row['setting_value'])
            if 'entrySource' in item and scope(item) == key:
                return {**item['entrySource'], 'configurationId': item['deploymentId']}
    return None


def apply_choice(db, layout):
    choice = read_choice(db, layout)
    if choice is None:
        return False
    layout['entryPoint'] = target_entry(layout, choice) if choice.get('path') else ''
    layout['entryConfigurationId'] = choice['configurationId']
    if not layout['entryPoint']:
        layout['clearEntryPoint'] = True
    return True


def publish_choice(app, db, layout, *, verify=True):
    from .server import ApiError, now
    from .directory_layout import store_layout, revision
    from .deployment_configuration import configurations, DEPLOYMENT_PREFIX
    from .entry_types import entry_kind, executable_image
    key, entry = scope(layout), layout.get('entryPoint', '')
    if not key:
        raise ApiError('请先关联 Git 仓库和源目录，再设置共享入口', 422)
    choice = source_entry(layout, entry) if entry else {'repoId': '', 'path': ''}
    if not choice:
        raise ApiError('请选择 Git 部署配置中已映射的启动文件', 422)
    if entry:
        try: kind = entry_kind(entry)
        except ValueError as exc: raise ApiError(str(exc), 422) from exc
        if entry.rsplit('/', 1)[-1].lower() == '__init__.py':
            raise ApiError('请选择 Python 脚本或 EXE 程序作为入口', 422)
        if verify:
            from .directory_layout import snapshot_files
            files, _, _ = snapshot_files(app, {'nodes': [{
                'id': 'entry', 'parentId': '', 'name': 'entry.exe' if kind == 'executable' else 'entry.py',
                'kind': 'file', 'sourceType': 'file', 'repoId': choice['repoId'],
                'sourcePath': choice['path'], 'gitCommit': choice['gitCommit']} ]}, db)
            image = next(iter(files.values()))
            try:
                if kind == 'executable': executable_image(image)
                else: ast.parse(image.decode('utf-8-sig'))
            except (UnicodeError, SyntaxError, ValueError) as exc:
                raise ApiError('入口文件无效：' + str(exc), 422) from exc
    previous = read_choice(db, layout)
    identifier = previous['configurationId'] if previous else layout['deploymentId']
    selected_at = now()
    changed = []
    for item in configurations(app, db).values():
        if scope(item) != key:
            continue
        try:
            item['entryPoint'] = target_entry(item, choice) if entry else ''
        except ApiError:
            # Old task layouts may predate this Git file. They retain their
            # pinned contents and pick up the configured entry on redeployment.
            if item['deploymentId'] == identifier:
                item['entryPoint'] = entry
        item['entryConfigurationId'] = identifier
        if item['deploymentId'] == identifier:
            item['entrySource'] = choice
            item['entrySelectedAt'] = selected_at
        item['updatedAt'] = selected_at; item['revision'] = revision(item)
        store_layout(db, DEPLOYMENT_PREFIX + item['deploymentId'], item)
        changed.append(item)
    return changed


def select(app, identifier, body):
    from .server import ApiError, GIT_LOCK
    from .deployment_configuration import get_configuration
    from .directory_layout import safe_path
    with GIT_LOCK, app.store.connect() as db:
        layout = get_configuration(app, identifier, db)
        if body.get('revision') != layout['revision']:
            raise ApiError('Git 部署配置已更新，请刷新后重新选择入口', 409)
        entry = safe_path(body.get('entryPoint'))
        return {'items': publish_choice(app, db, {**layout, 'entryPoint': entry})}
