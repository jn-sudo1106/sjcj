"""Rename an unused configured Git directory without moving historical outputs."""
import json
import subprocess
from pathlib import Path


def rename(app, db, repo, old, relative):
    from .server import ApiError
    previous, following = old['path'], relative.as_posix()
    if following.casefold().startswith(previous.casefold() + '/') or previous.casefold().startswith(following.casefold() + '/'):
        raise ApiError('新旧目录不能相互包含，请填写独立目录', 409)
    for table, clause in (
        ('code_assets', 'directory_id=?'),
        ('releases', 'repository_directory_id=?'),
        ('source_code_relations', 'directory_id=?'),
    ):
        if db.execute('SELECT 1 FROM ' + table + ' WHERE repo_id=? AND ' + clause + ' LIMIT 1',
                      (repo['repo_id'], old['directoryId'])).fetchone():
            raise ApiError('目录已有代码或归档引用，不能直接重命名；请新建目录后切换节点保存位置', 409)
    from .deployment_configuration import configurations
    for layout in configurations(app, db).values():
        for node in layout.get('nodes', []):
            source = node.get('sourcePath', '').rstrip('/')
            if node.get('repoId') == repo['repo_id'] and source and (
                    source == previous or source.startswith(previous + '/')
                    or node.get('sourceType') == 'directory' and previous.startswith(source + '/')):
                raise ApiError('目录仍被部署配置引用，请先调整部署映射后再重命名', 409)
    for row in db.execute("SELECT payload FROM jobs WHERE job_type='generation' AND status IN ('claimed','running')").fetchall():
        job = json.loads(row['payload']); data = job.get('input') or {}
        if data.get('repositoryId') == repo['repo_id'] and (data.get('directoryId') == old['directoryId']
                or data.get('destinationMode') == 'type' and data.get('configType') == old['configType']):
            raise ApiError('该目录有正在执行的生成任务，请完成后再重命名', 409)
    root = Path(repo['local_path']).resolve()
    source, target = root / previous, root / relative
    # Both the forward move and compensation stay inside this repository.
    if not source.resolve().is_relative_to(root) or not target.resolve().is_relative_to(root):
        raise ApiError('目录必须位于当前仓库内', 403)
    if not source.is_dir():
        raise ApiError('原目录不存在，请刷新仓库后重试', 409)
    if target.exists():
        raise ApiError('目标目录已存在，不能覆盖，请填写其他目录名', 409)
    if app.git(root, 'symbolic-ref', '--short', 'HEAD').strip() != repo['branch']:
        raise ApiError('当前 Git 分支与仓库配置不一致，请先同步仓库', 409)
    if app.git(root, 'diff', '--cached', '--name-only').strip():
        raise ApiError('仓库已有暂存文件，请先处理后再修改目录', 409)
    if app.git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--', previous).strip():
        raise ApiError('目录内有未提交的修改或文件，请先提交后再重命名', 409)
    if not app.git(root, 'ls-files', '--', previous).strip():
        raise ApiError('原目录尚未提交 Git，请先提交后再重命名', 409)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        app.git(root, 'mv', '--', previous, following)
        app.git(root, '-c', 'user.name=Runner Builder', '-c', 'user.email=runner@localhost',
                'commit', '-m', 'Rename repository directory ' + previous + ' to ' + following)
    except Exception:
        if target.exists() and not source.exists():
            target.rename(source)
        subprocess.run(['git', 'reset', '--quiet', 'HEAD', '--', previous, following], cwd=root,
                       capture_output=True, timeout=20, check=True)
        raise
