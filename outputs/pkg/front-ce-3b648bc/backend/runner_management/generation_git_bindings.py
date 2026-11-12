"""Map remote generation folders to managed Git destinations."""
from pathlib import PurePosixPath, PureWindowsPath


def relative_path(server, value):
    from .code_servers import generation_root
    from .server import ApiError
    if not isinstance(value, str) or len(value) > 2000:
        raise ApiError('生成目录无效')
    root = server['workspace']
    kind = PureWindowsPath if PureWindowsPath(root).drive or '\\' in root else PurePosixPath
    absolute = generation_root(server, str(kind(root) / kind(value.strip())))
    relative = kind(absolute).relative_to(kind(root)).as_posix()
    return '' if relative == '.' else relative


def match(server, code_directory):
    path = relative_path(server, code_directory)
    windows = bool(PureWindowsPath(server['workspace']).drive or '\\' in server['workspace'])
    key = path.casefold() if windows else path
    candidates = []
    for item in server.get('generationGitBindings', []):
        owner = item['path'].casefold() if windows else item['path']
        if not owner or key == owner or key.startswith(owner + '/'):
            candidates.append(item)
    return max(candidates, key=lambda item: len(item['path'])) if candidates else None


def describe(app, server):
    from .server import ApiError
    from .repository_directories import get_directory
    result = []
    with app.store.connect() as db:
        for item in server.get('generationGitBindings', []):
            value = dict(item)
            try:
                repo = app.repository(db, item['repositoryId'])
                directory = get_directory(app, db, item['repositoryId'], item['directoryId'])
                if repo['status'] != 'ACTIVE':
                    raise ApiError('代码仓库已停用', 409)
                value.update(repoName=repo['name'], remoteUrl=repo['remote_url'], branch=repo['branch'], directoryPath=directory['path'])
            except ApiError as error:
                value['error'] = str(error)
            result.append(value)
    return result


def save(app, server_id, body):
    from . import code_servers
    from .server import ApiError, required_text
    from .repository_directories import get_directory
    if 'path' not in body:
        raise ApiError('请提供需要绑定的生成目录')
    repo_id = body.get('repositoryId')
    if not isinstance(repo_id, str):
        raise ApiError('请选择代码仓库')
    with code_servers.LOCK:
        server = code_servers.read(app, server_id)
        path = relative_path(server, body['path'])
        windows = bool(PureWindowsPath(server['workspace']).drive or '\\' in server['workspace'])
        key = path.casefold() if windows else path
        items = [item for item in server.get('generationGitBindings', [])
                 if (item['path'].casefold() if windows else item['path']) != key]
        if repo_id:
            required_text(body, 'repositoryId', 80)
            directory_id = required_text(body, 'directoryId', 80)
            with app.store.connect() as db:
                repo = app.repository(db, repo_id)
                if repo['status'] != 'ACTIVE':
                    raise ApiError('代码仓库已停用', 409)
                get_directory(app, db, repo_id, directory_id)
            items.append({'path': path, 'repositoryId': repo_id, 'directoryId': directory_id})
        if len(items) > 200:
            raise ApiError('每台生成服务器最多保存 200 个目录绑定')
        server['generationGitBindings'] = items
        with app.store.connect() as db:
            code_servers.write(db, server)
    return {'items': describe(app, server)}
