"""Package selected ordinary files from one immutable Git snapshot."""
import re
import subprocess
import tempfile
import zipfile

from .package_limits import MAX_CODE_BYTES, MIB

MAX_DOWNLOAD_FILES = 200


def package(app, repo_id, paths):
    from .server import ApiError, GIT_LOCK
    from .directory_layout import safe_path, git_files
    if not isinstance(paths, list) or not 1 <= len(paths) <= MAX_DOWNLOAD_FILES:
        raise ApiError(f'请选择 1–{MAX_DOWNLOAD_FILES} 个仓库文件', 422)
    paths = list(dict.fromkeys(safe_path(path) for path in paths))
    with app.store.connect() as db:
        repo = app.repository(db, repo_id)
    with GIT_LOCK:
        commit = app.git(repo['local_path'], 'rev-parse', '--verify', 'HEAD').strip()
        if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', commit):
            raise ApiError('仓库尚无可下载的 Git 提交', 409)
        entries = git_files(app, repo, commit)
    for path in paths:
        entry = entries.get(path)
        if not entry:
            raise ApiError('仓库文件不存在，请刷新列表后重试：' + path, 404)
        if entry[0] not in ('100644', '100755'):
            raise ApiError('仅支持下载普通文件，不支持符号链接或子模块：' + path, 422)
    if sum(entries[path][1] for path in paths) > MAX_CODE_BYTES:
        raise ApiError(f'所选文件总大小不能超过 {MAX_CODE_BYTES // MIB} MB', 413)
    output = tempfile.SpooledTemporaryFile(max_size=8 * MIB, mode='w+b')
    try:
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in paths:
                result = subprocess.run(['git', 'cat-file', 'blob', commit + ':' + path], cwd=repo['local_path'],
                                        capture_output=True, timeout=60, check=False)
                if result.returncode or len(result.stdout) != entries[path][1]:
                    raise ApiError('读取仓库文件失败，请刷新后重试：' + path, 409)
                archive.writestr(path, result.stdout)
        size = output.tell()
        output.seek(0)
        return output, 'repository-' + commit[:12] + '.zip', size
    except Exception:
        output.close()
        raise
