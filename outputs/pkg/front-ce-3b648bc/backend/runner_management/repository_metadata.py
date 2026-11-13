"""File history at the same immutable Git snapshot used by deployment mapping."""
from __future__ import annotations

import re
import subprocess
from functools import lru_cache
from pathlib import Path

from .directory_layout import git_files, safe_path


@lru_cache(maxsize=64)
def _change_times(root: str, commit: str):
    # One history walk supports global ordering before paging, rather than
    # starting one Git process per file in a large directory.
    result = subprocess.run(['git', '--no-pager', 'log', '--no-show-signature',
        '--format=%x00%H%x00%cI%x00', '--name-only', '-z', '--no-renames', commit, '--'],
        cwd=root, capture_output=True, timeout=15, check=False)
    if result.returncode: raise RuntimeError('读取仓库文件时间失败')
    tokens = result.stdout.split(b'\0'); values = {}; current = None; index = 0
    while index < len(tokens):
        token = tokens[index]
        if not token and index + 2 < len(tokens) and re.fullmatch(rb'[0-9a-f]{40}', tokens[index + 1]):
            current = tokens[index + 2].decode('ascii'); index += 3; continue
        name = token.removeprefix(b'\n').decode('utf8', errors='replace')
        if name and current:
            values.setdefault(name, current)
            parts = name.split('/')
            for depth in range(1, len(parts)): values.setdefault('/'.join(parts[:depth]), current)
        index += 1
    return values


def file_times(root: Path, commit: str, paths: list[str]) -> dict:
    """Last Git change per file/directory, cached by immutable snapshot.

    Filesystem mtimes change during cloning/copying and cannot describe code history.
    Directory paths use the latest commit touching a descendant. No remote Git calls.
    """
    if not commit or not paths:
        return {}
    try: values = _change_times(str(root.resolve()), commit)
    except (OSError, subprocess.TimeoutExpired, RuntimeError): values = {}
    return {path: values.get(path) for path in paths}


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
