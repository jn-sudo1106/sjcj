"""Node-owned code sources and immutable settings for new deployment jobs."""
import hashlib
import json
from pathlib import Path


FIELDS = ('repositoryId', 'sourceDirectory', 'deploymentDirectory')


def validate(app, db, value, targets, *, verify_source=True):
    from .server import ApiError
    from .directory_layout import safe_path
    from .deployment_mapping import relative_directory
    if not isinstance(value, dict) or set(value) - set(FIELDS):
        raise ApiError('部署任务配置无效')
    result = {}
    for key in FIELDS:
        text = value.get(key, '')
        if not isinstance(text, str) or len(text) > 1000:
            raise ApiError('部署任务配置字段无效')
        text = text.strip()
        result[key] = (text.rstrip('/\\') or text) if key in ('sourceDirectory', 'deploymentDirectory') else text
    repo_id, source = result['repositoryId'], result['sourceDirectory']
    if bool(repo_id) != bool(source):
        raise ApiError('请同时选择 Git 仓库并填写仓库内源目录')
    if repo_id:
        repo = app.repository(db, repo_id)
        if repo['status'] != 'ACTIVE':
            raise ApiError('代码仓库已停用', 409)
        result['sourceDirectory'] = safe_path(source.replace('\\', '/'))
        if verify_source:
            source_files(app, repo, result['sourceDirectory'])
    directory = result['deploymentDirectory']
    if directory:
        if any(ord(char) < 32 for char in directory) or '{' in directory or '}' in directory:
            raise ApiError('部署目录请填写实际路径，不支持模板变量')
        from pathlib import PureWindowsPath
        if not PureWindowsPath(directory).drive and not directory.startswith('/'):
            safe_path(directory.replace('\\', '/'))
        for target in targets:
            runner = db.execute('SELECT install_directory FROM runners WHERE runner_id=?', (target['runnerId'],)).fetchone()
            relative_directory(directory, runner)
    return result


def source_files(app, repo, directory):
    from .server import ApiError
    from .directory_layout import git_files
    from .delivery_ignore import ignored_paths
    from .python_cache import is_python_cache
    root = Path(repo['local_path'])
    if repo['remote_url']:
        app.git(root, 'fetch', '--no-tags', 'origin', 'refs/heads/' + repo['branch'])
        commit = app.git(root, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}').strip()
    else:
        commit = app.git(root, 'rev-parse', '--verify', 'refs/heads/' + repo['branch'] + '^{commit}').strip()
    tree = git_files(app, repo, commit)
    excluded = ignored_paths(repo, commit, tree)
    files = [{'path': path, 'size': size} for path, (mode, size) in sorted(tree.items())
             if path.startswith(directory + '/') and path not in excluded and not is_python_cache(path)]
    if not files:
        raise ApiError('Git 源目录不存在或没有可部署文件，请同步仓库后检查目录', 409)
    return commit, files


def apply(app, db, archive, env, *, preview=False, options=None):
    from .deployment_resources import read_choice
    from .server import ApiError
    context = {**(archive.get('sourceContext') or {}), 'configId': archive['configId'], 'environment': env}
    if options is None:
        options = read_choice(db, context).get('deploymentSettings') or {}
    if not any(options.values()):
        return archive
    result = {**archive, 'deploymentSettings': dict(options)}
    if options.get('repositoryId'):
        repo = app.repository(db, options['repositoryId'])
        if repo['status'] != 'ACTIVE':
            raise ApiError('代码仓库已停用', 409)
        result.update(repoId=repo['repo_id'], directoryId='', directoryPath=options['sourceDirectory'], repositoryPrefix='')
        if not preview:
            commit, files = source_files(app, repo, options['sourceDirectory'])
            result.update(gitCommit=commit, files=files, pushed=True)
    if not preview:
        digest = hashlib.sha256(json.dumps([options, result['repoId'], result['gitCommit']], sort_keys=True).encode()).hexdigest()[:16]
        result.update(generationArchiveId=archive['archiveId'], archiveId=archive['archiveId'][:60] + '_' + digest)
    return result
