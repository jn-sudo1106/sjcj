"""Deletion of HEAD files depends on current links, not immutable history."""
import json


def policy(app, db, repo_id):
    links = {row['setting_key'].removeprefix('script-file-link:'): json.loads(row['setting_value'])
             for row in db.execute('SELECT * FROM settings WHERE setting_key LIKE ?', ('script-file-link:%',)).fetchall()}
    assets = {row['code_id']: dict(row) for row in db.execute('SELECT * FROM code_assets').fetchall()}
    default_repo = app.default_repository(db)['repo_id']
    paths, prefixes = {}, []
    for asset in assets.values():
        if (asset['repo_id'] or default_repo) == repo_id and not links.get(asset['code_id'], {}).get('detached'):
            paths[asset['storage_path']] = '仍有关联的节点代码，请先在“查看引用”中取消对应关联'
    latest = set()
    for row in db.execute('SELECT * FROM code_versions ORDER BY published_at DESC,digest DESC').fetchall():
        if row['code_id'] in latest:
            continue
        latest.add(row['code_id'])
        asset = assets.get(row['code_id'], {})
        link = links.get(row['code_id'], {})
        if link.get('detached') or (link.get('sourceDetached') and link.get('digest') == row['digest']):
            continue
        if (row['repo_id'] or asset.get('repo_id') or default_repo) == repo_id and row['source_repo_path']:
            paths.setdefault(row['source_repo_path'], '仍被节点作为来源文件关联，请先取消来源关联')
    # A saved Git commit remains readable after deleting a file from HEAD.
    # Only mappings which implicitly follow HEAD depend on the current file.
    from .deployment_configuration import configurations
    for layout in configurations(app, db).values():
        for node in layout.get('nodes', []):
            if node.get('repoId') != repo_id or node.get('gitCommit') or not node.get('sourcePath'):
                continue
            source = node['sourcePath'].rstrip('/')
            reason = '部署配置未固定文件版本，请先调整部署映射'
            if node.get('sourceType') == 'directory':
                prefixes.append((source, reason))
            else:
                paths.setdefault(source, reason)
    return paths, prefixes


def reason(rules, path):
    paths, prefixes = rules
    return paths.get(path) or next((message for prefix, message in prefixes if path == prefix or path.startswith(prefix + '/')), '')
