"""Select an entry from the pinned deployment tree and adopt it atomically."""
from .directory_layout import snapshot_files


def candidates(app, layout, db):
    files, _, _ = snapshot_files(app, layout, db)
    return sorted(path for path in files if path.lower().endswith('.py') and path.rsplit('/', 1)[-1] != '__init__.py')


def entry(app, runtime_id, body=None):
    from .server import ApiError, GIT_LOCK
    from .deployment_configuration import runtime_rows, get_configuration, save_configuration, save_runtime
    with GIT_LOCK, app.store.connect() as db:
        runtime = next((row for row in runtime_rows(app, db) if row['runtimeId'] == runtime_id), None)
        if not runtime:
            raise ApiError('机器配置不存在，请刷新', 404)
        layout = get_configuration(app, runtime['deploymentId'], db)
        files = candidates(app, layout, db)
        if body is None:
            return {'files': files, 'entryPoint': layout['entryPoint'] or (files[0] if len(files) == 1 else ''),
                    'revision': runtime['revision'], 'layoutRevision': layout['revision']}
        if body.get('revision') != runtime['revision'] or body.get('layoutRevision') != layout['revision']:
            raise ApiError('配置已更新，请刷新后重新选择启动文件', 409)
        selected = body.get('entryPoint')
        if not isinstance(selected, str) or selected not in files:
            raise ApiError('请选择当前部署配置中的 Python 启动文件', 422)
        if runtime.get('assignment', {}) and runtime['assignment']['enabled']:
            raise ApiError('请先停止处理程序，再修改启动文件', 409)
        layout = save_configuration(app, {**layout, 'entryPoint': selected}, layout['deploymentId'], _db=db)
        adopted_revision = next(row['revision'] for row in runtime_rows(app, db) if row['runtimeId'] == runtime_id)
        return save_runtime(app, {'runtimeId': runtime_id, 'revision': adopted_revision,
            'deploymentId': layout['deploymentId'], 'layoutRevision': layout['revision'], 'runnerId': runtime['runnerId'],
            'environment': layout.get('deploymentEnvironment') or (runtime.get('assignment') or {}).get('environment', 'test'),
            'concurrency': (runtime.get('assignment') or {}).get('concurrency', 1), 'retryPolicy': runtime.get('retryPolicy')}, _db=db)
