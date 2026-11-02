"""File history at the same immutable Git snapshot used by deployment mapping."""
from __future__ import annotations

import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

from .directory_layout import git_files, safe_path


@lru_cache(maxsize=4096)
def _last_change(root: str, commit: str, path: str):
    result = subprocess.run(
        ['git', '--no-pager', '--literal-pathspecs', 'log', '-1', '--format=%cI',
         '--no-show-signature', commit, '--', path],
        cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=3, check=False,
    )
    if result.returncode:
        raise RuntimeError('读取仓库文件时间失败')
    return result.stdout.strip() or None


def file_times(root: Path, commit: str, paths: list[str]) -> dict:
    """Last Git change per visible file/directory, cached by immutable snapshot.

    Filesystem mtimes change during cloning/copying and cannot describe code history.
    Directory paths use the latest commit touching a descendant. No remote Git calls.
    """
    if not commit or not paths:
        return {}
    def load(path):
        try: return path, _last_change(str(root.resolve()), commit, path)
        except (OSError, subprocess.TimeoutExpired, RuntimeError): return path, None
    with ThreadPoolExecutor(max_workers=min(8, len(paths))) as executor:
        return dict(executor.map(load, paths))


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
