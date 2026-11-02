"""Editable node/file associations, separate from immutable code snapshots."""
import json
import re
import subprocess
from pathlib import Path

PREFIX = 'script-file-link:'


def state(db, code_id):
    row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + code_id,)).fetchone()
    return json.loads(row['setting_value']) if row else {}


def present(db, row):
    from .server import as_code_version
    result = as_code_version(row)
    link = state(db, row['code_id'])
    if link.get('detached'):
        result['associationDetached'] = True
    if link.get('sourceDetached') and link.get('digest') == row['digest']:
        result.update(sourceRepoPath='', sourceGitCommit='')
    return result


def lookup(app, digest, target, db):
    from .server import ApiError, CODE_VERSION_SELECT, as_code_version
    if target not in ('saved', 'source') or not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ApiError('代码版本或文件类型无效')
    row = db.execute(CODE_VERSION_SELECT + 'WHERE v.digest=?', (digest,)).fetchone()
    if not row:
        raise ApiError('代码版本不存在', 404)
    version = as_code_version(row)
    path = version['sourceRepoPath'] if target == 'source' else version['storagePath']
    commit = version['sourceGitCommit'] if target == 'source' else version['gitCommit']
    if not path or not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
        raise ApiError('此版本没有可查看的仓库文件关联', 404)
    repo_id = version['repoId'] or app.default_repository(db)['repo_id']
    return row, app.repository(db, repo_id), path, commit


def snapshot(app, repo, path, commit):
    from .server import ApiError
    from .directory_layout import git_files, safe_path
    safe_path(path)
    entry = git_files(app, repo, commit).get(path)
    if not entry:
        raise ApiError('记录的 Git 提交中不存在该文件', 404)
    if entry[0] not in ('100644', '100755'):
        raise ApiError('仅支持查看普通代码文件', 415)
    if entry[1] > 1024 * 1024:
        raise ApiError('文件超过 1 MB，暂不支持在线预览', 413)
    result = subprocess.run(['git', 'show', f'{commit}:{path}'], cwd=repo['local_path'],
                            capture_output=True, timeout=20, check=False)
    if result.returncode:
        raise ApiError('读取仓库版本文件失败', 502)
    if b'\0' in result.stdout:
        raise ApiError('二进制文件暂不支持在线预览', 415)
    try:
        content = result.stdout.decode('utf8')
    except UnicodeDecodeError as exc:
        raise ApiError('文件不是 UTF-8 文本，暂不支持在线预览', 415) from exc
    return {'repoId': repo['repo_id'], 'path': path, 'gitCommit': commit, 'content': content, 'size': len(result.stdout)}


def preview(app, digest, target):
    with app.store.connect() as db:
        _, repo, path, commit = lookup(app, digest, target, db)
    return snapshot(app, repo, path, commit)


def change(app, body):
    from .server import ApiError, GIT_LOCK, now
    from .directory_layout import store_layout, git_files
    action, target = body.get('action'), body.get('target')
    if action not in ('unlink', 'delete'):
        raise ApiError('请选择取消关联或删除文件')
    with GIT_LOCK:
        with app.store.connect() as db:
            row, repo, path, commit = lookup(app, body.get('digest'), target, db)
            if body.get('configId') != row['config_id'] or body.get('queueName') != row['queue_name']:
                raise ApiError('文件关联与当前配置、队列不匹配', 409)
            latest = db.execute('SELECT digest FROM code_versions WHERE code_id=? ORDER BY published_at DESC,digest DESC LIMIT 1', (row['code_id'],)).fetchone()
            if latest['digest'] != row['digest']:
                raise ApiError('当前显示的不是最新代码版本，请刷新后再操作关联', 409)
            link = state(db, row['code_id'])
        deletion = None
        if action == 'delete':
            head = app.git(Path(repo['local_path']), 'rev-parse', 'HEAD').strip()
            if path in git_files(app, repo, head):
                # A historical link must never delete a newer file at the same path.
                snapshot(app, repo, path, commit)
                original = app.git(Path(repo['local_path']), 'rev-parse', f'{commit}:{path}').strip()
                current = app.git(Path(repo['local_path']), 'rev-parse', f'{head}:{path}').strip()
                if original != current:
                    raise ApiError('当前仓库文件与关联快照不同，请在仓库页核对后删除', 409)
                from .repository_references import references
                refs = references(app, repo['repo_id'], path)['items']
                if any(item['scope'] == 'current' and item.get('codeId') != row['code_id'] and
                       (item['kind'] == 'node' or item['kind'] == 'version' and item.get('isLatest')) for item in refs):
                    raise ApiError('此文件还被其他节点关联，请先在仓库页查看引用并处理', 409)
                # Pinned deployments keep their original Git snapshot. Unpinned
                # mappings would depend on HEAD and must be updated explicitly.
                from .deployment_configuration import configurations
                from .repository_references import mapped_paths
                with app.store.connect() as db:
                    for layout in configurations(app, db).values():
                        if mapped_paths(layout, repo['repo_id'], path) and any(
                                node.get('repoId') == repo['repo_id'] and not node.get('gitCommit') for node in layout['nodes']):
                            raise ApiError('部署配置存在未固定版本的文件映射，请先调整部署配置', 409)
                deletion = app.delete_repository_file(repo['repo_id'], path, association=True)
            else:
                deletion = {'deleted': False, 'alreadyAbsent': True}
        link.update(digest=row['digest'], updatedAt=now())
        link['sourceDetached' if target == 'source' else 'detached'] = True
        with app.store.connect() as db:
            store_layout(db, PREFIX + row['code_id'], link)
        return {'ok': True, 'action': action, 'target': target, 'path': path, 'repoId': repo['repo_id'],
                'deletion': deletion, 'message': ('文件已不在当前分支，已取消关联' if deletion and deletion.get('alreadyAbsent') else
                                                '文件已提交删除并取消关联' if action == 'delete' else '已取消关联，仓库文件保留')}
