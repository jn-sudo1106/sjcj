"""File history at the same immutable Git snapshot used by deployment mapping."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .directory_layout import git_files, safe_path


def file_metadata(app, repo_id: str, path: str, commit: str = '') -> dict:
    from .server import ApiError
    safe_path(path)
    if commit and not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ApiError('仓库提交无效')
    with app.store.connect() as db:
        repo = app.repository(db, repo_id)
    root = Path(repo['local_path'])
    commit = commit or app.git(root, 'rev-parse', 'HEAD').strip()
    entry = git_files(app, repo, commit).get(path)
    if entry is None:
        raise ApiError('仓库提交中不存在该文件', 404)
    if entry[0] not in ('100644', '100755'):
        raise ApiError('仅支持查看普通仓库文件的版本信息', 415)
    result = subprocess.run(
        ['git', '--literal-pathspecs', 'log', '--follow', '--format=%H%x09%cI', commit, '--', path],
        cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=20, check=False,
    )
    if result.returncode:
        raise ApiError('读取文件版本信息失败', 500)
    history = [line.split('\t', 1) for line in result.stdout.splitlines() if '\t' in line]
    if not history:
        raise ApiError('该文件暂无可用的 Git 历史', 409)
    return {'repoId': repo_id, 'path': path, 'gitCommit': commit,
            'fileCommit': history[0][0], 'createdAt': history[-1][1], 'updatedAt': history[0][1]}
