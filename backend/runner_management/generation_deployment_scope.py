"""Merge task outputs with the exact Git origins of already deployed files."""
import hashlib


def merge_nodes(app, db, archive, source_base, before, manifest):
    from .directory_delivery import file_sources
    from .directory_layout import safe_path, git_files
    from .delivery_ignore import ignored_paths
    from .python_cache import is_python_cache
    from .server import ApiError

    prefix = source_base.rstrip('/') + '/'
    repo = app.repository(db, archive['repoId'])
    tree = git_files(app, repo, archive['gitCommit'])
    excluded = ignored_paths(repo, archive['gitCommit'], tree)
    generated = {}
    for item in archive['files']:
        path = safe_path(item['path'])
        if not path.startswith(prefix): raise ApiError('生成文件不在配置的部署目录内', 422)
        if path in excluded or is_python_cache(path): continue
        if path not in tree: raise ApiError('本次生成文件不存在于已归档的 Git 版本：' + path, 422)
        relative = safe_path(path[len(prefix):])
        generated[relative] = {'repoId': archive['repoId'], 'sourcePath': path, 'gitCommit': archive['gitCommit']}
    if not generated: raise ApiError('本次生成任务没有可部署的代码文件', 422)

    retained = {item['targetPath']: item for item in file_sources(before, manifest.get('sources', []))}
    if set(before) - set(retained) - set(generated):
        raise ApiError('无法确认已部署文件的 Git 来源，不能安全合并本次生成文件', 409)
    mappings = {name: source for name, source in retained.items() if name in before}
    mappings.update(generated)
    nodes, folders = [], set()

    def folder(path):
        if not path or path in folders: return
        safe_path(path)
        parent, _, name = path.rpartition('/')
        folder(parent); folders.add(path)
        nodes.append({'id': hashlib.sha256(path.encode()).hexdigest(),
                      'parentId': hashlib.sha256(parent.encode()).hexdigest() if parent else '', 'name': name, 'kind': 'folder'})

    for path in sorted(manifest.get('directories', [])):
        folder(path)
    for path, source in sorted(mappings.items()):
        safe_path(path)
        parent, _, name = path.rpartition('/')
        folder(parent)
        nodes.append({'id': hashlib.sha256(path.encode()).hexdigest(),
                      'parentId': hashlib.sha256(parent.encode()).hexdigest() if parent else '',
                      'name': name, 'kind': 'file', 'sourceType': 'file',
                      **{key: source[key] for key in ('repoId', 'sourcePath', 'gitCommit')}})
    return nodes, sorted(generated)
