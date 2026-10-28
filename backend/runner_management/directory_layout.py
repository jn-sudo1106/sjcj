"""Draft directory trees and immutable, multi-repository node code packages."""
from __future__ import annotations

import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path


def safe_path(value: str, *, template: bool = False) -> str:
    from .server import ApiError
    if not isinstance(value, str) or not value or len(value) > 400:
        raise ApiError("目录或文件路径无效")
    checked = value
    if template:
        for token in ("{configId}", "{queue}", "{website}", "{environment}"):
            checked = checked.replace(token, "placeholder")
    if any(ch in checked for ch in '\\:< >"|?*{}'.replace(' ', '')):
        raise ApiError("路径必须为相对路径，只支持 {configId}、{queue}、{website}、{environment} 变量")
    for part in checked.split('/'):
        if (not part or part in ('.', '..') or part.lower() == '.git'
                or part.endswith(('.', ' ')) or any(ord(ch) < 32 for ch in part)
                or part.upper().split('.')[0] in {'CON', 'PRN', 'AUX', 'NUL',
                    *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}):
            raise ApiError("路径包含无效目录名或保留文件名")
    if template and checked.split('/')[0].lower() in ('versions', 'runner-versions', 'code', 'logs', 'identity.json', 'current.json', 'previous.json', 'instance.lock', '.runtime'):
        raise ApiError("下发目录不能覆盖 Runner 的程序、日志或身份目录")
    return value


def git_files(app, repo, commit: str) -> dict[str, tuple[str, int]]:
    from .server import ApiError
    result = subprocess.run(['git', 'ls-tree', '-r', '-l', '-z', commit], cwd=Path(repo['local_path']),
                            capture_output=True, timeout=20, check=False)
    if result.returncode:
        raise ApiError("仓库提交不可用，请刷新后重新选择", 409)
    files = {}
    for record in result.stdout.split(b'\0'):
        if not record:
            continue
        info, name = record.split(b'\t', 1)
        mode, kind, _, size = info.decode('ascii').split()
        path = name.decode('utf-8')
        files[path] = (mode if kind == 'blob' else 'submodule', int(size) if size != '-' else 0)
    if len(files) > 5000:
        raise ApiError("仓库超过 5000 个文件，请使用专用代码仓库", 413)
    return files


def repository_tree(app, repo_id: str, commit: str = '') -> dict:
    with app.store.connect() as db:
        repo = app.repository(db, repo_id)
    from .server import ApiError
    if commit and not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ApiError("仓库提交无效")
    commit = commit or app.git(Path(repo['local_path']), 'rev-parse', 'HEAD').strip()
    files = git_files(app, repo, commit)
    entries = {}
    for name, (mode, size) in files.items():
        from .server import ApiError
        # Unsafe tracked names are never offered as selectable destinations.
        try:
            safe_path(name)
        except ApiError:
            continue
        parts = name.split('/')
        for index in range(1, len(parts)):
            path = '/'.join(parts[:index])
            entries[path] = {'path': path, 'kind': 'directory', 'size': None, 'selectable': True}
        entries[name] = {'path': name, 'kind': 'file', 'size': size, 'selectable': mode in ('100644', '100755')}
    return {'repoId': repo_id, 'gitCommit': commit, 'items': sorted(entries.values(), key=lambda x: x['path'].casefold())}


def normalize(app, code_id: str, payload: dict, db, *, standalone: bool = False) -> dict:
    from .server import ApiError
    asset = db.execute('SELECT * FROM code_assets WHERE code_id=?', (code_id,)).fetchone() if code_id else None
    if not asset and (code_id or not standalone):
        raise ApiError("节点代码不存在", 404)
    template = safe_path(payload.get('directoryTemplate'), template=True)
    if not standalone and '{website}' in template:
        raise ApiError("网站变量只能用于网站目录视图")
    entry = payload.get('entryPoint', '')
    if not isinstance(entry, str):
        raise ApiError("执行入口格式无效")
    if entry or not standalone:
        entry = safe_path(entry)
    if entry and not entry.lower().endswith('.py'):
        raise ApiError("入口必须是 Python 文件")
    raw_nodes = payload.get('nodes')
    if not isinstance(raw_nodes, list) or not (0 if standalone else 1) <= len(raw_nodes) <= 200:
        raise ApiError("目录或文件不能超过 200 个" if standalone else "请配置 1 至 200 个目录或文件")
    nodes, ids = [], set()
    for raw in raw_nodes:
        if not isinstance(raw, dict):
            raise ApiError("目录树格式无效")
        node_id, parent = raw.get('id'), raw.get('parentId') or ''
        name = safe_path(raw.get('name'))
        if '/' in name or not isinstance(node_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', node_id) or node_id in ids:
            raise ApiError("目录节点名称或标识无效")
        if raw.get('kind') not in ('folder', 'file') or not isinstance(parent, str):
            raise ApiError("目录节点类型无效")
        node = {'id': node_id, 'parentId': parent, 'name': name, 'kind': raw['kind']}
        if raw.get('repoId'):
            repo = app.repository(db, raw['repoId'])
            if repo['status'] != 'ACTIVE':
                raise ApiError("映射的仓库已停用", 409)
            commit = raw.get('gitCommit')
            source = safe_path(raw.get('sourcePath'))
            source_type = raw.get('sourceType')
            if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{40}', commit):
                raise ApiError("请为仓库代码选择固定 Git 提交")
            if source_type != ('directory' if raw['kind'] == 'folder' else 'file'):
                raise ApiError("文件和文件夹的映射类型不一致")
            node.update(repoId=repo['repo_id'], sourcePath=source, sourceType=source_type, gitCommit=commit)
        elif raw['kind'] == 'file':
            raise ApiError("文件必须关联仓库代码")
        nodes.append(node)
        ids.add(node_id)
    by_id = {node['id']: node for node in nodes}
    destinations = set()
    for node in nodes:
        parts, visited, current = [], set(), node
        while current:
            if current['id'] in visited:
                raise ApiError("目录树存在循环")
            visited.add(current['id'])
            parts.insert(0, current['name'])
            parent = current['parentId']
            current = by_id.get(parent) if parent else None
            if parent and (not current or current['kind'] != 'folder'):
                raise ApiError("上级目录不存在或不是文件夹")
        destination = safe_path('/'.join(parts))
        if destination.casefold() in ('manifest.json', 'version.json'):
            raise ApiError("根目录的 manifest.json、version.json 由系统维护，请使用其他目标名称")
        if destination.casefold() in destinations:
            raise ApiError("同一目录下不能有重名文件或文件夹")
        destinations.add(destination.casefold())
    result = {'codeId': code_id, 'configId': asset['config_id'] if asset else '', 'queueName': asset['queue_name'] if asset else '',
              'siteHost': asset['site_host'] if asset else '', 'directoryTemplate': template, 'entryPoint': entry, 'nodes': nodes}
    return result


def node_paths(layout: dict) -> dict[str, str]:
    nodes = {node['id']: node for node in layout['nodes']}
    def path(node):
        return (path(nodes[node['parentId']]) + '/' if node['parentId'] else '') + node['name']
    return {node['id']: path(node) for node in nodes.values()}


def encode(layout: dict) -> str:
    return json.dumps(layout, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def revision(layout: dict) -> str:
    return hashlib.sha256(encode({k: v for k, v in layout.items() if k != 'revision'}).encode()).hexdigest()


def get_layout(app, code_id: str, db=None) -> dict:
    from .server import ApiError, CODE_VERSION_SELECT, optional
    if db is None:
        with app.store.connect() as connection:
            return get_layout(app, code_id, connection)
    saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('delivery-layout:' + code_id,)).fetchone()
    if saved:
        return json.loads(saved['setting_value'])
    version = db.execute(CODE_VERSION_SELECT + 'WHERE a.code_id=? ORDER BY v.published_at DESC,v.digest DESC LIMIT 1', (code_id,)).fetchone()
    if not version:
        raise ApiError("节点代码不存在", 404)
    if optional(version, 'layout_json'):
        layout = json.loads(version['layout_json'])
    else:
        parts, nodes, parent = version['delivery_path'].split('/'), [], ''
        for index, name in enumerate(parts):
            is_file = index == len(parts) - 1
            node = {'id': 'default-' + str(index), 'parentId': parent, 'name': name, 'kind': 'file' if is_file else 'folder'}
            if is_file:
                node.update(repoId=version['version_repo_id'] or version['repo_id'], sourcePath=optional(version, 'repository_storage_path') or version['storage_path'],
                            sourceType='file', gitCommit=version['git_commit'])
            nodes.append(node)
            parent = node['id']
        layout = {'codeId': code_id, 'configId': version['config_id'], 'queueName': version['queue_name'],
                  'siteHost': version['site_host'], 'directoryTemplate': '{configId}',
                  'entryPoint': version['delivery_path'], 'nodes': nodes}
    layout['revision'] = revision(layout)
    return layout


def save_layout(app, code_id: str, payload: dict) -> dict:
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        current = get_layout(app, code_id, db)
        if payload.get('revision') != current['revision']:
            raise ApiError("目录配置已被其他操作更新，请重新加载后编辑", 409)
        layout = normalize(app, code_id, payload, db)
        layout['revision'] = revision(layout)
        key = 'delivery-layout:' + code_id
        if db.execute('SELECT 1 FROM settings WHERE setting_key=?', (key,)).fetchone():
            db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (encode(layout), key))
        else:
            db.execute('INSERT INTO settings VALUES (?,?)', (key, encode(layout)))
        return layout


def get_config_layout(app, config_id: str, db=None) -> dict:
    """One editable directory view per config; old code-specific drafts stay recoverable."""
    from .server import ApiError, CODE_VERSION_SELECT
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', config_id):
        raise ApiError("配置 ID 无效")
    if db is None:
        with app.store.connect() as connection:
            return get_config_layout(app, config_id, connection)
    stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                        ('config-directory-layout:' + config_id,)).fetchone()
    if stored:
        return editor_layout(json.loads(stored['setting_value']), 'config')
    rows = db.execute(CODE_VERSION_SELECT + "WHERE a.config_id=? "
                      "ORDER BY CASE WHEN a.site_host='' THEN 0 ELSE 1 END,v.published_at DESC,v.digest DESC",
                      (config_id,)).fetchall()
    if not rows:
        raise ApiError("该配置尚无节点代码，无法加载目录视图", 404)
    code_ids = list(dict.fromkeys(row['code_id'] for row in rows))
    drafts = []
    for code_id in code_ids:
        old = db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                         ('delivery-layout:' + code_id,)).fetchone()
        if old:
            drafts.append(json.loads(old['setting_value']))
    # Prefer the most complete saved tree; never merge conflicting destinations
    # or delete the remaining legacy drafts during a read.
    layout = max(drafts, key=lambda draft: len(draft['nodes'])) if drafts else get_layout(app, code_ids[0], db)
    return editor_layout(layout, 'config')


def editor_layout(layout: dict, binding_type: str) -> dict:
    """Directory editing never reads or changes Runner target selection."""
    result = {key: value for key, value in layout.items() if key not in ('runnerIds', 'revision', 'isNew')}
    result['bindingType'] = binding_type
    if binding_type != 'config':
        result['configId'] = ''
    result['revision'] = revision(result)
    return result


def config_runner_layout(layout: dict, db) -> dict:
    runner_ids = {row['runner_id'] for row in db.execute(
        'SELECT runner_id FROM config_runner_bindings WHERE config_id=?', (layout['configId'],)).fetchall()}
    stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                        ('config-directory-layout:' + layout['configId'],)).fetchone()
    explicit_targets = stored and 'runnerIds' in json.loads(stored['setting_value'])
    if not explicit_targets:
        # Existing queue assignments identify the initial targets. Once a view
        # is saved explicitly, removing a binding must not resurrect it here.
        runner_ids.update(row['runner_id'] for row in db.execute(
            'SELECT DISTINCT x.runner_id FROM assignments x JOIN code_assets a ON a.code_id=x.code_id '
            'WHERE a.config_id=? AND x.enabled=1', (layout['configId'],)).fetchall())
    layout['runnerIds'] = sorted(runner_ids)
    layout['revision'] = revision(layout)
    return layout


def runner_config_layouts(app, runner_id: str) -> list[dict]:
    with app.store.connect() as db:
        candidates = db.execute(
            'SELECT config_id FROM config_runner_bindings WHERE runner_id=? '
            'UNION SELECT a.config_id FROM assignments x JOIN code_assets a ON a.code_id=x.code_id '
            'WHERE x.runner_id=? AND x.enabled=1', (runner_id, runner_id)).fetchall()
        layouts = [config_runner_layout(get_config_layout(app, row['config_id'], db), db) for row in candidates]
        return [layout for layout in layouts if runner_id in layout['runnerIds']]


def save_config_layout(app, config_id: str, payload: dict) -> dict:
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        current = get_config_layout(app, config_id, db)
        if (payload.get('bindingType', 'config') != 'config'
                or payload.get('configId') != config_id or payload.get('codeId') != current['codeId']):
            raise ApiError("目录视图与当前配置不一致")
        if payload.get('revision') != current['revision']:
            raise ApiError("目录配置已被其他操作更新，请重新加载后编辑", 409)
        layout = editor_layout(normalize(app, current['codeId'], payload, db), 'config')
        key = 'config-directory-layout:' + config_id
        previous = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key,)).fetchone()
        stored_layout = dict(layout)
        # Preserve the old explicit-target marker (including an empty selection)
        # without letting this editor change the association table.
        if previous:
            old = json.loads(previous['setting_value'])
            if 'runnerIds' in old:
                stored_layout['runnerIds'] = old['runnerIds']
        store_layout(db, key, stored_layout)
        return layout


def store_layout(db, key: str, layout: dict) -> None:
    if db.execute('SELECT 1 FROM settings WHERE setting_key=?', (key,)).fetchone():
        db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (encode(layout), key))
    else:
        db.execute('INSERT INTO settings VALUES (?,?)', (key, encode(layout)))


def queue_layout_key(queue: str) -> str:
    # Queue names can contain 120 characters; settings keys are VARCHAR(100).
    return 'queue-directory-layout:' + hashlib.sha256(queue.encode()).hexdigest()


def get_queue_layout(app, queue: str, db=None) -> dict:
    """A queue owns one view, independently of every config using that queue."""
    from .server import ApiError, CODE_VERSION_SELECT, valid_queue
    queue = valid_queue(queue)
    if db is None:
        with app.store.connect() as connection:
            return get_queue_layout(app, queue, connection)
    stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (queue_layout_key(queue),)).fetchone()
    if stored:
        return editor_layout(json.loads(stored['setting_value']), 'queue')
    seed = db.execute(CODE_VERSION_SELECT + "WHERE a.queue_name=? "
                      "ORDER BY CASE WHEN a.site_host='' THEN 0 ELSE 1 END,v.published_at DESC,v.digest DESC LIMIT 1",
                      (queue,)).fetchone()
    if not seed:
        raise ApiError("该队列尚无节点代码，无法加载目录视图", 404)
    layout = get_layout(app, seed['code_id'], db)
    # Reuse the code mappings, but never inherit a config-owned root template.
    layout['directoryTemplate'] = '{queue}'
    return editor_layout(layout, 'queue')


def save_queue_layout(app, queue: str, payload: dict) -> dict:
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        current = get_queue_layout(app, queue, db)
        if (payload.get('bindingType') != 'queue' or payload.get('queueName') != queue
                or payload.get('configId') != '' or payload.get('codeId') != current['codeId']):
            raise ApiError("目录视图与当前队列不一致")
        if payload.get('revision') != current['revision']:
            raise ApiError("目录配置已被其他操作更新，请重新加载后编辑", 409)
        if '{configId}' in str(payload.get('directoryTemplate', '')):
            raise ApiError("队列绑定的根目录模板不能包含 {configId}")
        layout = editor_layout(normalize(app, current['codeId'], payload, db), 'queue')
        store_layout(db, queue_layout_key(queue), layout)
        return layout


def named_owner(binding_type: str, owner_id: str) -> str:
    from .server import ApiError
    if binding_type == 'website':
        if not isinstance(owner_id, str) or len(owner_id) > 253:
            raise ApiError("网站域名无效")
        owner_id = owner_id.lower()
        if ('.' not in owner_id or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part)
                                      for part in owner_id.split('.'))):
            raise ApiError("请填写网站域名，例如 www.example.com，不包含协议或页面路径")
        return safe_path(owner_id)
    if binding_type == 'custom':
        safe_path(owner_id)
        # A custom owner is a literal directory, not a variable expression.
        safe_path(owner_id, template=True)
        return owner_id
    raise ApiError("目录绑定方式无效")


def named_layout_key(binding_type: str, owner_id: str) -> str:
    return 'directory-layout:' + binding_type + ':' + hashlib.sha256(owner_id.casefold().encode()).hexdigest()


def get_named_layout(app, binding_type: str, owner_id: str, db=None) -> dict:
    from .server import CODE_VERSION_SELECT
    owner_id = named_owner(binding_type, owner_id)
    if db is None:
        with app.store.connect() as connection:
            return get_named_layout(app, binding_type, owner_id, connection)
    stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (named_layout_key(binding_type, owner_id),)).fetchone()
    if stored:
        return {**editor_layout(json.loads(stored['setting_value']), binding_type), 'isNew': False}
    seed = (db.execute(CODE_VERSION_SELECT + 'WHERE a.site_host=? ORDER BY v.published_at DESC,v.digest DESC LIMIT 1',
                       (owner_id,)).fetchone() if binding_type == 'website' else None)
    layout = get_layout(app, seed['code_id'], db) if seed else {
        'codeId': '', 'configId': '', 'queueName': '', 'siteHost': '', 'entryPoint': '', 'nodes': []}
    layout.update(ownerId=owner_id, configId='', queueName='', siteHost=owner_id if binding_type == 'website' else '',
                  directoryTemplate='{website}' if binding_type == 'website' else owner_id)
    return {**editor_layout(layout, binding_type), 'isNew': True}


def save_named_layout(app, binding_type: str, owner_id: str, payload: dict, db=None) -> dict:
    from .server import ApiError, GIT_LOCK
    owner_id = named_owner(binding_type, owner_id)
    if db is None:
        with GIT_LOCK, app.store.connect() as connection:
            return save_named_layout(app, binding_type, owner_id, payload, connection)
    current = get_named_layout(app, binding_type, owner_id, db)
    if (payload.get('bindingType') != binding_type or payload.get('ownerId') != current['ownerId']
            or payload.get('codeId') != current['codeId'] or payload.get('configId') != '' or payload.get('queueName') != ''):
        raise ApiError("目录视图与当前绑定对象不一致")
    if payload.get('revision') != current['revision']:
        raise ApiError("目录配置已被其他操作更新，请重新加载后编辑", 409)
    template = payload.get('directoryTemplate')
    allowed_tokens = ('{website}', '{environment}') if binding_type == 'website' else ('{environment}',)
    checked = template if isinstance(template, str) else ''
    for token in allowed_tokens:
        checked = checked.replace(token, 'placeholder')
    if '{' in checked or '}' in checked:
        raise ApiError("网站目录仅支持 {website}、{environment}，自定义目录仅支持 {environment}")
    layout = normalize(app, current['codeId'], payload, db, standalone=True)
    layout.update(ownerId=current['ownerId'], configId='', queueName='', siteHost=current['siteHost'])
    layout = editor_layout(layout, binding_type)
    store_layout(db, named_layout_key(binding_type, owner_id), layout)
    return {**layout, 'isNew': False}


def named_layout_owners(app) -> list[dict]:
    with app.store.connect() as db:
        rows = db.execute("SELECT setting_value FROM settings WHERE setting_key LIKE ? OR setting_key LIKE ?",
                          ('directory-layout:website:%', 'directory-layout:custom:%')).fetchall()
        return sorted(({'bindingType': layout['bindingType'], 'ownerId': layout['ownerId']}
                       for row in rows if (layout := json.loads(row['setting_value']))),
                      key=lambda row: (row['bindingType'], row['ownerId']))


def snapshot_files(app, layout: dict, db) -> tuple[dict, list, list]:
    """Read only pinned Git snapshots, shared by publication and manual delivery."""
    from .server import ApiError
    from .python_cache import is_python_cache
    from .delivery_ignore import ignored_paths
    paths, files, sources, trees, directories = node_paths(layout), {}, [], {}, set()
    exclusions = {}
    total_size = 0
    for node in layout['nodes']:
        destination = paths[node['id']]
        if is_python_cache(destination) or is_python_cache(node.get('sourcePath', '')):
            continue
        if not node.get('repoId'):
            if node['kind'] == 'folder':
                directories.add(destination)
            continue
        repo = app.repository(db, node['repoId'])
        key = (node['repoId'], node['gitCommit'])
        if key not in trees:
            trees[key] = git_files(app, repo, node['gitCommit'])
            exclusions[key] = ignored_paths(repo, node['gitCommit'], trees[key])
        tree = trees[key]
        source = node['sourcePath']
        matches = [name for name in tree if name == source] if node['sourceType'] == 'file' else [name for name in tree if name.startswith(source + '/')]
        if not matches:
            raise ApiError(f"仓库提交中不存在：{source}", 409)
        ignored = exclusions[key]
        if source in ignored or source + '/' in ignored:
            if node['sourceType'] == 'file':
                raise ApiError(f"文件已被仓库下发忽略规则排除：{source}，请调整 .gitignore 或移除映射", 422)
            continue
        if node['kind'] == 'folder':
            directories.add(destination)
        sources.append({**node, 'repoName': repo['name'], 'targetPath': destination})
        for name in sorted(matches):
            if name in ignored:
                continue
            mode, size = tree[name]
            if mode not in ('100644', '100755'):
                raise ApiError("代码包不支持符号链接或子仓库")
            target = destination if node['sourceType'] == 'file' else destination + name[len(source):]
            safe_path(target)
            if target.casefold() in {p.casefold() for p in files}:
                raise ApiError(f"多个仓库代码映射到相同位置：{target}", 409)
            total_size += size
            if total_size > 10 * 1024 * 1024 or len(files) >= 2000:
                raise ApiError("代码包超过 10 MB 或 2000 个文件", 413)
            result = subprocess.run(['git', 'show', f"{node['gitCommit']}:{name}"], cwd=Path(repo['local_path']),
                                    capture_output=True, timeout=20, check=False)
            if result.returncode:
                raise ApiError("仓库快照读取失败", 409)
            files[target] = result.stdout
    for path in list(files) + list(directories):
        parts = path.split('/')
        for index in range(1, len(parts)):
            parent = '/'.join(parts[:index])
            if parent.casefold() in {p.casefold() for p in files}:
                raise ApiError(f"文件不能作为上级目录：{parent}", 409)
    if any(directory.casefold() in {p.casefold() for p in files} for directory in directories):
        raise ApiError("文件与目录的目标路径冲突", 409)
    return files, sources, sorted(directories)


def publish_layout(app, code_id: str, payload: dict) -> dict:
    from .server import ApiError, CODE_VERSION_SELECT, GIT_LOCK, as_code_version, now, valid_environment
    requested_environment = payload.get('environment', 'test')
    environment = 'default' if requested_environment == 'default' else valid_environment(requested_environment)
    with GIT_LOCK, app.store.connect() as db:
        layout = get_layout(app, code_id, db)
        if payload.get('revision') != layout['revision']:
            raise ApiError("请先保存当前目录草稿，再发布", 409)
        layout = normalize(app, code_id, layout, db)
        layout['revision'] = revision(layout)
        files, sources, directories = snapshot_files(app, layout, db)
        entry = layout['entryPoint']
        if entry not in files:
            raise ApiError("入口文件未关联到仓库代码", 422)
        try:
            tree = ast.parse(files[entry].decode('utf-8-sig'))
        except (UnicodeError, SyntaxError) as exc:
            raise ApiError("入口文件不是有效的 UTF-8 Python 代码", 422) from exc
        if not any(isinstance(node, ast.FunctionDef) and node.name == 'scrape' and node.args.args
                   and node.args.args[0].arg == 'url' for node in tree.body):
            raise ApiError("入口必须提供 scrape(url) 函数", 422)
        primary = next(source for source in sources if entry == source['targetPath'] or
                       source['sourceType'] == 'directory' and entry.startswith(source['targetPath'] + '/'))
        main_source = primary['sourcePath'] + entry[len(primary['targetPath']):]
        repo = app.repository(db, primary['repoId'])
        old = db.execute(CODE_VERSION_SELECT + 'WHERE a.code_id=? ORDER BY v.published_at DESC LIMIT 1', (code_id,)).fetchone()
        manifest = {'kind': 'script', 'entry': entry, 'configId': layout['configId'], 'queueName': layout['queueName'],
                    'siteHost': layout['siteHost'], 'directoryTemplate': layout['directoryTemplate'],
                    'directories': sorted(directories), 'sources': sources, 'layoutSchema': 2,
                    'versionFile': 'version.json', 'codeId': code_id}
        digest, signature = app.artifacts.publish(files, manifest)
        # Refresh the queue shell once at publish time so existing assignments
        # can resolve directory packages as well as the earlier single files.
        processor = app.publish_processor({'processorType': 'newslink_nourl'})
        git_url = app.git_url_for(repo, primary['gitCommit'], Path(main_source))
        db.execute('INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)', (
            digest, 'script', layout['siteHost'] or layout['queueName'], 'any', primary['gitCommit'], 'published', now(), signature, entry, git_url))
        db.execute('INSERT OR IGNORE INTO code_versions '
                   '(digest,code_id,git_commit,git_url,delivery_path,prompt,source_url,published_at,repo_id,source_repo_path,source_git_commit,layout_json) '
                   'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (
            digest, code_id, primary['gitCommit'], git_url, entry, old['prompt'], old['source_url'], now(), primary['repoId'],
            main_source, primary['gitCommit'], encode(layout)))
        # A neutral directory is reusable in either runtime environment. Update
        # only bindings already using this node; never create a new deployment.
        environments = [environment] if environment != 'default' else [row['environment'] for row in db.execute(
            'SELECT b.environment FROM code_runtime_bindings b JOIN code_versions v ON v.digest=b.digest '
            'WHERE v.code_id=? AND b.config_id=? AND b.queue_name=? AND b.site_host=?',
            (code_id, layout['configId'], layout['queueName'], layout['siteHost'])).fetchall()]
        for target_environment in environments:
            keys = (target_environment, layout['configId'], layout['queueName'], layout['siteHost'])
            if db.execute('SELECT 1 FROM code_runtime_bindings WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?', keys).fetchone():
                db.execute('UPDATE code_runtime_bindings SET digest=? WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?', (digest, *keys))
            else:
                db.execute('INSERT INTO code_runtime_bindings VALUES (?,?,?,?,?)', (*keys, digest))
            db.execute("UPDATE assignments SET release_digest=? WHERE queue=? AND environment=? AND processor_type='newslink_nourl'",
                       (processor['digest'], layout['queueName'], 'production' if target_environment == 'prd' else 'test'))
        return dict(as_code_version(db.execute(CODE_VERSION_SELECT + 'WHERE v.digest=?', (digest,)).fetchone()), environment=environment)
