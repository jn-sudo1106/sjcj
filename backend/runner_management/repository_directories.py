"""Node-type save destinations within a Git repository."""
import json
import uuid
from pathlib import Path

from .directory_layout import revision, store_layout

PREFIX = 'repository-directory:'


def list_directories(app, db, repo_id):
    repo = app.repository(db, repo_id)
    default = {'directoryId': 'default', 'repoId': repo_id, 'name': '默认目录',
               'configType': repo['config_type'], 'configTypeName': repo['config_type_name'],
               'path': app.repository_upload_directory(db, repo), 'status': 'ACTIVE', 'isDefault': True}
    default['revision'] = revision(default)
    rows = [json.loads(row['setting_value']) for row in db.execute(
        'SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()]
    rows = [row for row in rows if row['repoId'] == repo_id]
    for row in rows:
        row['codeCount'] = db.execute('SELECT COUNT(*) AS count FROM code_assets WHERE directory_id=?',
                                     (row['directoryId'],)).fetchone()['count']
    result = [default, *sorted(rows, key=lambda row: (row['configType'], row['name']))]
    for item in result:
        selected = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('generation-type-default:' + item['configType'],)).fetchone() if item['configType'] else None
        choice = json.loads(selected['setting_value']) if selected else {}
        item['generationDefault'] = choice.get('repositoryId') == repo_id and choice.get('directoryId') == item['directoryId']
    return result


def get_directory(app, db, repo_id, directory_id, config_type=None, active=True):
    from .server import ApiError
    row = next((row for row in list_directories(app, db, repo_id) if row['directoryId'] == directory_id), None)
    if not row:
        raise ApiError('仓库配置目录不存在，请刷新后选择', 404)
    if active and row['status'] != 'ACTIVE':
        raise ApiError('仓库配置目录已停用，请选择其他目录', 409)
    if config_type is not None and row['configType'] not in ('', config_type):
        raise ApiError('所选目录不适用于此节点类型', 409)
    safe_directory(app, app.repository(db, repo_id), row['path'])
    return row


def safe_directory(app, repo, raw):
    from .server import ApiError
    if not isinstance(raw, str) or not raw or len(raw) > 300:
        raise ApiError('请填写仓库内的相对目录，最多 300 个字符')
    parent, _, leaf = raw.replace('\\', '/').rpartition('/')
    relative = app.upload_path(parent, leaf)
    root = Path(repo['local_path']).resolve()
    target = root / relative
    if not target.resolve().is_relative_to(root) or any(
            (root / Path(*relative.parts[:index])).is_symlink() for index in range(1, len(relative.parts) + 1)):
        raise ApiError('配置目录不能经过符号链接或位于仓库外部')
    if target.exists() and not target.is_dir():
        raise ApiError('配置目录路径已经是一个文件', 409)
    return relative


def save_directory(app, repo_id, payload, directory_id=None, headers=None):
    from .server import ApiError, GIT_LOCK, now, required_text
    with GIT_LOCK, app.store.connect() as db:
        repo = app.repository(db, repo_id)
        if repo['status'] != 'ACTIVE':
            raise ApiError('仓库已停用，不能修改配置目录', 409)
        old = get_directory(app, db, repo_id, directory_id, active=False) if directory_id else None
        if old and (old['isDefault'] or payload.get('revision') != old['revision']):
            raise ApiError('默认目录由仓库配置管理' if old['isDefault'] else '目录配置已更新，请刷新', 409)
        config_type = app.valid_config_type(payload.get('configType', old['configType'] if old else ''))
        if repo['config_type'] not in ('', config_type):
            raise ApiError('目录节点类型应与所属仓库一致', 409)
        type_name = app.repository_type_name(db, config_type, payload.get('configTypeName', ''), headers)
        name = required_text(payload, 'name', 60)
        if any(ord(char) < 32 for char in name):
            raise ApiError('目录名称无效')
        relative = safe_directory(app, repo, payload.get('path') or (old['path'] if old else type_name or 'default'))
        path = relative.as_posix()
        if old and path != old['path']:
            raise ApiError('已有目录路径不能直接修改，请新建目录后在节点中切换保存位置', 409)
        # Directory type classifies future save destinations. Existing assets
        # retain their actual node type and immutable version/file references.
        # Reclassifying a folder must not rewrite those business identities.
        for other in list_directories(app, db, repo_id):
            if other['directoryId'] == directory_id:
                continue
            if other['path'].casefold() == path.casefold() or other['name'] == name:
                raise ApiError('此仓库已有相同的目录路径或配置名称', 409)
            if path.casefold().startswith(other['path'].casefold() + '/') or other['path'].casefold().startswith(path.casefold() + '/'):
                raise ApiError('配置目录不能相互嵌套，请使用独立目录', 409)
        status = payload.get('status', old['status'] if old else 'ACTIVE')
        if status not in ('ACTIVE', 'DISABLED'):
            raise ApiError('目录状态无效')
        root = Path(repo['local_path'])
        if not (root / '.git').exists() and repo['is_default'] and (not root.exists() or not any(root.iterdir())):
            root.mkdir(parents=True, exist_ok=True)
            app.git(root, 'init')
            app.git(root, 'symbolic-ref', 'HEAD', 'refs/heads/' + repo['branch'])
        if not (root / '.git').is_dir() or Path(app.git(root, 'rev-parse', '--show-toplevel').strip()).resolve() != root.resolve():
            raise ApiError('服务器目录不是独立 Git 仓库，请先验证仓库', 409)
        target = root / relative
        if not old:
            import subprocess
            if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=root, capture_output=True, timeout=10).returncode:
                raise ApiError('仓库已有暂存文件，请先处理后再新建目录', 409)
            target.mkdir(parents=True, exist_ok=True)
            if not any(target.iterdir()):
                marker = relative / '.gitkeep'
                (root / marker).write_bytes(b'')
                app.git(root, 'add', '--', marker.as_posix())
                app.git(root, '-c', 'user.name=Runner Builder', '-c', 'user.email=runner@localhost',
                        'commit', '-m', 'Create repository directory ' + path)
            if repo['remote_url']:
                app.set_git_origin(root, repo['remote_url'])
                app.push_git(root, repo['branch'])
        item = {'directoryId': directory_id or uuid.uuid4().hex, 'repoId': repo_id, 'name': name,
                'configType': config_type, 'configTypeName': type_name, 'path': path, 'status': status,
                'isDefault': False, 'updatedAt': now()}
        item['revision'] = revision(item)
        store_layout(db, PREFIX + item['directoryId'], item)
        return {**item, 'codeCount': old.get('codeCount', 0) if old else 0}


def remove_directory(app, repo_id, directory_id, expected_revision):
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        old = get_directory(app, db, repo_id, directory_id, active=False)
        if old['isDefault'] or expected_revision != old['revision']:
            raise ApiError('默认目录不能移除' if old['isDefault'] else '目录配置已更新，请刷新', 409)
        if db.execute('SELECT 1 FROM code_assets WHERE directory_id=?', (directory_id,)).fetchone() or db.execute(
                'SELECT 1 FROM code_versions WHERE repository_directory_id=?', (directory_id,)).fetchone():
            raise ApiError('目录已有节点代码或历史版本引用，请使用停用', 409)
        db.execute('DELETE FROM settings WHERE setting_key=?', (PREFIX + directory_id,))
        return {'ok': True}


def managed_paths(db, repo_id, exclude_config_id=None):
    assets = {row['code_id']: dict(row) for row in db.execute('SELECT * FROM code_assets').fetchall()}
    paths = {row['storage_path'] for row in assets.values() if row['repo_id'] == repo_id and row['config_id'] != exclude_config_id}
    for row in db.execute('SELECT * FROM code_versions WHERE repo_id=?', (repo_id,)).fetchall():
        if exclude_config_id is None or assets.get(row['code_id'], {}).get('config_id') != exclude_config_id:
            paths.update((row['repository_storage_path'], row['source_repo_path']))
    from .generated_archives import records
    for record in records(db):
        if record['repoId'] == repo_id and record['configId'] != exclude_config_id and (record['status'] == 'committed' or record.get('gitCommit')):
            paths.update(item['path'] for item in record['files'])
    return paths - {''}
