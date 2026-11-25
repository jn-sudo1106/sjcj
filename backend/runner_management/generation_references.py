"""Freeze Git reference inputs and copy verified bytes before invoking an Agent."""
import base64
import hashlib
import json
import re
import subprocess
from pathlib import Path, PurePosixPath


def normalize(raw):
    from .directory_layout import safe_path
    from .server import ApiError
    if not isinstance(raw, list) or len(raw) > 20: raise ApiError('输入参考文件最多选择 20 个')
    result, names = [], set()
    for item in raw:
        if not isinstance(item, dict) or not re.fullmatch(r'[0-9a-f]{32}', str(item.get('repositoryId', ''))):
            raise ApiError('参考文件仓库无效')
        path = safe_path(item.get('path'))
        name = PurePosixPath(path).name
        if name.casefold() in names: raise ApiError('输入参考文件存在同名文件，请修改名称后选择')
        names.add(name.casefold())
        result.append({'repositoryId': item['repositoryId'], 'path': path})
    return result


def content(app, item):
    from .server import ApiError
    from .directory_layout import git_files
    normalized = normalize([item])[0]
    commit = item.get('gitCommit', '')
    if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{40}', commit): raise ApiError('参考文件 Git 版本无效')
    with app.store.connect() as db: repo = app.repository(db, normalized['repositoryId'])
    entry = git_files(app, repo, commit).get(normalized['path'])
    if not entry or entry[0] not in ('100644', '100755'): raise ApiError(f"参考文件不存在或不是普通文件：{normalized['path']}", 404)
    if entry[1] > 5 * 1024 * 1024: raise ApiError('参考文件不能超过 5 MB', 413)
    result = subprocess.run(['git', 'show', f"{commit}:{normalized['path']}"], cwd=Path(repo['local_path']), capture_output=True, timeout=20, check=False)
    if result.returncode: raise ApiError(f"读取参考文件失败：{normalized['path']}", 409)
    if not result.stdout: raise ApiError(f"参考文件内容为空：{normalized['path']}")
    return result.stdout


def snapshot(app, raw):
    result, commits, total = [], {}, 0
    for item in normalize(raw):
        if item['repositoryId'] not in commits:
            with app.store.connect() as db: repo = app.repository(db, item['repositoryId'])
            commits[item['repositoryId']] = app.git(Path(repo['local_path']), 'rev-parse', 'HEAD').strip()
        frozen = {**item, 'gitCommit': commits[item['repositoryId']]}
        data = content(app, frozen); total += len(data)
        if total > 10 * 1024 * 1024:
            from .server import ApiError
            raise ApiError('参考文件总大小不能超过 10 MB', 413)
        result.append({**frozen, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return result


def sync(app, server_id, workspace, files, emit=None):
    from .code_servers import operation
    from .generated_archives import relative_workspace_path
    from .server import ApiError
    from .directory_layout import store_layout
    root = relative_workspace_path(app, server_id, workspace['inputFileDir'])
    key = 'generation-input:' + hashlib.sha256((server_id + ':' + root).encode()).hexdigest()
    with app.store.connect() as db:
        previous = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key,)).fetchone()
    old = json.loads(previous['setting_value']) if previous else []
    if not files and not old:
        if emit: emit('progress', message='未配置 Git 参考文件，跳过输入目录同步')
        return
    if emit: emit('progress', message=f'正在同步 {len(files)} 个 Git 参考文件到输入目录…' if files else '正在清理已取消的 Git 参考文件…')
    payload, receipt = [], []
    # Resolve every input before touching the remote machine.
    for item in files:
        data = content(app, item)
        if hashlib.sha256(data).hexdigest() != item.get('sha256'): raise ApiError('参考文件与任务 Git 快照不一致', 409)
        target = root + '/' + PurePosixPath(item['path']).name
        payload.append({'path': target, 'data': base64.b64encode(data).decode('ascii')})
        receipt.append({'path': target, 'sha256': item['sha256']})
    operation(app, server_id, {'action': 'mkdir', 'path': root})
    # Remove only previously managed, unchanged files that have been deselected.
    current = {item['path']: item for item in operation(app, server_id, {'action': 'list', 'path': root})['items']}
    targets = {item['path'] for item in receipt}
    for item in old:
        if item['path'] in targets or item['path'] not in current: continue
        if current[item['path']].get('sha256') != item['sha256']:
            raise ApiError('已取消的参考文件在输入目录中被修改，请手工移除后重试', 409)
        operation(app, server_id, {'action': 'delete', 'path': item['path'], 'expectedHash': item['sha256']})
    if payload:
        operation(app, server_id, {'action': 'upload', 'overwrite': True, 'files': payload})
        actual = {item['path']: item['sha256'] for item in operation(app, server_id, {'action': 'export', 'paths': [item['path'] for item in receipt]})['files']}
        if any(actual.get(item['path']) != item['sha256'] for item in receipt): raise ApiError('参考文件下载校验失败，已停止生成', 409)
        if emit:
            for item in receipt:
                emit('progress', message=f"已同步参考文件 {PurePosixPath(item['path']).name} → {workspace['inputFileDir']}（SHA-256 校验通过）")
    with app.store.connect() as db: store_layout(db, key, receipt)
    if emit: emit('progress', message='Git 参考文件同步并校验完成' if files else '已清理取消的 Git 参考文件，当前未配置输入参考文件')
