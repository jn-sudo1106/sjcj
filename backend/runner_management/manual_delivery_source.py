"""Resolve current Git code for explicit manual deliveries, without changing drafts on GET."""
import hashlib
from pathlib import Path

from .directory_layout import node_paths, revision, safe_path


def current_layout(app, layout, db):
    from .server import ApiError
    commits = {}
    nodes = []
    for node in layout['nodes']:
        node = dict(node)
        if node.get('repoId'):
            identifier = node['repoId']
            if identifier not in commits:
                repo = app.repository(db, identifier)
                if repo['status'] != 'ACTIVE': raise ApiError('映射的仓库已停用', 409)
                try:
                    commits[identifier] = app.git(Path(repo['local_path']), 'rev-parse', '--verify', 'refs/heads/' + repo['branch'] + '^{commit}').strip()
                except ApiError as error:
                    raise ApiError('无法读取 Git 仓库配置的分支，请先同步仓库后再下发', 409) from error
            node['gitCommit'] = commits[identifier]
        nodes.append(node)
    result = {**layout, 'nodes': nodes}
    # Generated configurations materialize every tracked file as a mapping.
    # Re-open that same Git directory so newly added files also appear.
    mapped = [node for node in nodes if node.get('repoId')]
    paths = node_paths(result)
    bases = {(node['repoId'], node['sourcePath'][:-len(paths[node['id']]) - 1])
             for node in mapped if node['sourcePath'].endswith('/' + paths[node['id']])}
    if (layout.get('managedBy') == 'generated-code' and mapped and len(bases) == 1
            and all(node['sourcePath'].endswith('/' + paths[node['id']]) for node in mapped)):
        from .directory_layout import git_files
        from .delivery_ignore import ignored_paths
        from .python_cache import is_python_cache
        from .deployment_resources import layout_nodes
        identifier, base = next(iter(bases))
        safe_path(base)
        repo = app.repository(db, identifier)
        tree = git_files(app, repo, commits[identifier])
        ignored = ignored_paths(repo, commits[identifier], tree)
        files = [{'path': name} for name in sorted(tree) if name.startswith(base + '/')
                 and name not in ignored and not is_python_cache(name)]
        result['nodes'] = layout_nodes({'repoId': identifier, 'directoryPath': base,
                                       'gitCommit': commits[identifier], 'files': files}, base)
    result['revision'] = revision(result)
    return result


def source_directories(layout):
    paths = node_paths(layout)
    result = set()
    for node in layout['nodes']:
        if not node.get('repoId'): continue
        path, target = node['sourcePath'], paths[node['id']]
        directory = (path if node['sourceType'] == 'directory' else
                     path[:-len(target) - 1] if path.endswith('/' + target) else path.rpartition('/')[0])
        result.add((node['repoId'], directory, node['gitCommit']))
    return [{'repoId': repo, 'path': path, 'gitCommit': commit} for repo, path, commit in sorted(result)]


def installed_layout(layout, files, sources, directories):
    """Keep unselected files on their old Git origins after a partial delivery."""
    from .directory_delivery import file_sources
    origins = {item['targetPath']: item for item in file_sources(files, sources)}
    nodes, folders = [], set(directories)
    for name in files:
        parts = name.split('/')
        folders.update('/'.join(parts[:index]) for index in range(1, len(parts)))
    for name in sorted(folders | set(files), key=lambda value: (value.count('/'), value)):
        parent, _, leaf = name.rpartition('/')
        node = {'id': hashlib.sha256(name.encode()).hexdigest(),
                'parentId': hashlib.sha256(parent.encode()).hexdigest() if parent else '',
                'name': leaf, 'kind': 'folder' if name in folders else 'file'}
        if name in files:
            source = origins[name]
            node.update({key: source[key] for key in ('repoId', 'sourcePath', 'gitCommit')}, sourceType='file')
        nodes.append(node)
    result = {**layout, 'nodes': nodes}
    result['revision'] = revision(result)
    return result
