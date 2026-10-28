"""Read-only reverse lookup of repository files, including directory mappings."""
import json

from .directory_layout import safe_path, node_paths


def mapped_paths(layout, repo_id, path):
    result = []
    if not layout or not isinstance(layout, dict):
        return result
    targets = node_paths(layout) if layout.get('nodes') else {}
    for node in layout.get('nodes', []):
        source = node.get('sourcePath', '').rstrip('/')
        if node.get('repoId') != repo_id or not source:
            continue
        if source == path or node.get('sourceType') == 'directory' and path.startswith(source + '/'):
            suffix = path[len(source):].lstrip('/')
            result.append('/'.join(part for part in (targets[node['id']], suffix) if part))
    return sorted(set(result))


def references(app, repo_id, path):
    from .deployment_configuration import configurations, with_source_nodes
    safe_path(path)
    items = []
    with app.store.connect() as db:
        repo = app.repository(db, repo_id)
        default_repo = app.default_repository(db)['repo_id']
        assets = [dict(row) for row in db.execute('SELECT * FROM code_assets').fetchall()]
        asset_map = {row['code_id']: row for row in assets}
        versions = [dict(row) for row in db.execute('SELECT * FROM code_versions ORDER BY published_at DESC,digest DESC').fetchall()]
        bindings = {}
        for row in db.execute('SELECT * FROM code_runtime_bindings').fetchall():
            bindings.setdefault(row['digest'], set()).add(row['environment'])
        machines = {}
        for row in db.execute('SELECT release_digest,runner_id FROM assignments WHERE enabled=1').fetchall():
            machines.setdefault(row['release_digest'], set()).add(row['runner_id'])
        latest = {}
        for version in versions:
            latest.setdefault(version['code_id'], version['digest'])
        for asset in assets:
            if (asset['repo_id'] or default_repo) == repo_id and asset['storage_path'] == path:
                items.append({'kind': 'node', 'scope': 'current', 'configId': asset['config_id'],
                              'codeId': asset['code_id'], 'queueName': asset['queue_name']})
        for version in versions:
            asset = asset_map[version['code_id']]
            owner_repo = version['repo_id'] or asset['repo_id'] or default_repo
            layout = json.loads(version['layout_json']) if version.get('layout_json') else None
            targets = mapped_paths(layout, repo_id, path)
            direct_paths = {version.get('repository_storage_path'), version.get('source_repo_path')}
            # Older versions did not persist a per-version storage path.
            if not any(direct_paths):
                direct_paths.add(asset['storage_path'])
            if not targets and not (owner_repo == repo_id and path in direct_paths):
                continue
            bound = sorted(bindings.get(version['digest'], set()))
            machine_count = len(machines.get(version['digest'], set()))
            is_latest = latest[version['code_id']] == version['digest']
            items.append({'kind': 'version', 'scope': 'current' if is_latest or bound or machine_count else 'history',
                          'configId': asset['config_id'], 'codeId': asset['code_id'], 'queueName': asset['queue_name'],
                          'gitCommit': version.get('source_git_commit') or version['git_commit'],
                          'digest': version['digest'], 'publishedAt': version['published_at'],
                          'isLatest': is_latest, 'environments': bound, 'machineBindingCount': machine_count, 'targetPaths': targets})
        deployments = with_source_nodes(db, configurations(app, db).values())
        from .generated_archives import records
        archives = sorted(records(db), key=lambda item: item['createdAt'], reverse=True)
        newest = set()
        for record in archives:
            owner = (record['configId'], record['repoId'], record['directoryId'])
            current = owner not in newest
            if record['status'] == 'committed':
                newest.add(owner)
            if record['repoId'] == repo_id and any(item['path'] == path for item in record['files']):
                items.append({'kind': 'generation', 'scope': 'current' if current else 'history',
                              'configId': record['configId'], 'queueName': record['queueName'],
                              'gitCommit': record['gitCommit'], 'publishedAt': record['createdAt'],
                              'archiveId': record['archiveId'], 'archiveStatus': record['status']})
        for layout in deployments:
            targets = mapped_paths(layout, repo_id, path)
            if not targets:
                continue
            items.append({'kind': 'deployment', 'scope': 'current', 'configId': layout.get('configId', ''),
                          'queueName': layout.get('queueName', ''), 'deploymentId': layout['deploymentId'],
                          'name': layout['name'], 'targetPaths': targets,
                          'sourceNodes': [layout['sourceNode']] if layout.get('sourceNode') else layout.get('relatedSourceNodes', [])})
        items = with_source_nodes(db, items)
        # Code/config IDs can be shared by multiple flows. Retain all origins.
        known = {}
        for layout in deployments:
            if layout.get('sourceNode'):
                known.setdefault(layout.get('configId'), []).append(layout['sourceNode'])
        for item in items:
            related = item.pop('relatedSourceNodes', [])
            nodes = item.get('sourceNodes', [])
            if item['kind'] != 'deployment' or not nodes:
                nodes = [*nodes, *related, *known.get(item.get('configId'), [])]
            item['sourceNodes'] = list({(node['flowId'], node['stepId'], node['configId']): node for node in nodes}.values())
    reasons = []
    if path.split('/')[0].lower() == 'code':
        reasons.append('系统管理目录')
    if any(item['kind'] == 'node' for item in items):
        reasons.append('流程节点代码引用')
    if any(item['kind'] == 'version' for item in items):
        reasons.append('代码版本引用')
    if any(item['kind'] == 'generation' and (item['archiveStatus'] == 'committed' or item.get('gitCommit')) for item in items):
        reasons.append('节点生成代码归档引用')
    return {'repoId': repo_id, 'repoName': repo['name'], 'path': path, 'protectionReasons': reasons, 'items': items}
