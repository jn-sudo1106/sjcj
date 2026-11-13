"""Resolve a node's type and its default managed Git save directory."""


def mode(body):
    from .server import ApiError
    value = body.get('destinationMode') or ('custom' if body.get('repositoryId') and body.get('directoryId') else 'type')
    if value not in ('type', 'custom'):
        raise ApiError('代码提交位置规则无效')
    return value


def node_type(app, db, body):
    from .server import ApiError
    from .store import MySqlStore
    supplied = app.valid_config_type(body.get('configType', ''))
    owner, queue = body.get('configId', ''), body.get('queueName', '')
    if not isinstance(owner, str) or len(owner) > 80 or not isinstance(queue, str) or len(queue) > 120:
        raise ApiError('配置 ID 或 MQ 名称无效')
    available = isinstance(app.store, MySqlStore) or db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cs_config'").fetchone()
    actual = ''
    if available:
        if owner:
            row = db.execute('SELECT CONFIG_TYPE config_type FROM cs_config WHERE CONFIG_ID=?', (owner,)).fetchone()
            if row: actual = str(row['config_type'] or '')
        if not actual and queue:
            rows = db.execute('SELECT DISTINCT CONFIG_TYPE config_type FROM cs_config WHERE TOPIC=?', (queue,)).fetchall()
            types = {str(row['config_type']) for row in rows if row['config_type'] is not None}
            if len(types) > 1:
                raise ApiError('该 MQ 对应多个配置类型，请指定明确的配置 ID', 409)
            actual = next(iter(types), '')
        if not actual and not supplied:
            raise ApiError('无法根据配置 ID 或 MQ 名称找到配置类型，请检查节点配置', 404)
    if actual and supplied and actual != supplied:
        raise ApiError('节点配置类型与数据库不一致，请刷新节点配置', 409)
    return app.valid_config_type(actual or supplied)


def automatic(app, body):
    from .server import ApiError
    from .repository_directories import list_directories, get_directory
    with app.store.connect() as db:
        config_type = node_type(app, db, body)
        selected = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('generation-type-default:' + config_type,)).fetchone() if config_type else None
        if selected:
            import json
            choice = json.loads(selected['setting_value'])
            repo = app.repository(db, choice['repositoryId'])
            if repo['status'] != 'ACTIVE': raise ApiError('该配置类型的默认生成仓库已停用', 409)
            directory = get_directory(app, db, repo['repo_id'], choice['directoryId'], config_type)
            if directory['configType'] != config_type: raise ApiError('默认生成目录的节点类型已变更，请重新设置', 409)
            return describe(repo, directory, config_type, 'type')
        rule = db.execute('SELECT repo_id FROM code_repo_rules WHERE config_type=?', (config_type,)).fetchone() if config_type else None
        if rule:
            repos = [app.repository(db, rule['repo_id'])]
            if repos[0]['status'] != 'ACTIVE':
                raise ApiError('该配置类型绑定的代码仓库已停用', 409)
        else:
            repos = db.execute('SELECT * FROM code_repositories WHERE status=? ORDER BY is_default DESC,created_at,repo_id', ('ACTIVE',)).fetchall()
        matches = []
        for repo in repos:
            if repo['config_type'] not in ('', config_type): continue
            for directory in list_directories(app, db, repo['repo_id']):
                if config_type and directory['configType'] == config_type and directory['status'] == 'ACTIVE':
                    rank = (0 if repo['config_type'] == config_type else 1 if repo['is_default'] else 2,
                            int(directory['isDefault']), repo['created_at'], repo['repo_id'], directory['path'], directory['directoryId'])
                    matches.append((rank, repo, directory))
        if matches:
            _, repo, directory = min(matches, key=lambda item: item[0])
            directory = get_directory(app, db, repo['repo_id'], directory['directoryId'], config_type)
            matched_by = 'type'
        else:
            repo = repos[0] if rule else app.resolve_code_repository(db, None, config_type)
            directory = get_directory(app, db, repo['repo_id'], 'default', config_type)
            matched_by = 'default'
    return describe(repo, directory, config_type, matched_by)


def describe(repo, directory, config_type, matched_by):
    return {'repositoryId': repo['repo_id'], 'directoryId': directory['directoryId'], 'directoryPath': directory['path'],
            'repoName': repo['name'], 'remoteUrl': repo['remote_url'], 'branch': repo['branch'],
            'configType': config_type, 'matchedBy': matched_by}


def set_default(app, repo_id, directory_id):
    from .server import ApiError, GIT_LOCK
    from .repository_directories import get_directory
    from .directory_layout import store_layout
    with GIT_LOCK, app.store.connect() as db:
        repo = app.repository(db, repo_id)
        if repo['status'] != 'ACTIVE': raise ApiError('代码仓库已停用', 409)
        directory = get_directory(app, db, repo_id, directory_id)
        if not directory['configType']: raise ApiError('请先为目录配置节点类型')
        store_layout(db, 'generation-type-default:' + directory['configType'], {'repositoryId': repo_id, 'directoryId': directory_id})
    return {'ok': True}
