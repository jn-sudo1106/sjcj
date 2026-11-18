"""Fetch and merge a repository's configured branch without discarding local work."""
import os
from pathlib import Path
import subprocess


def synchronize(app, repo_id):
    from .server import ApiError, GIT_LOCK

    with GIT_LOCK:
        with app.store.connect() as db:
            repo = app.repository(db, repo_id)
        if repo['status'] != 'ACTIVE':
            raise ApiError('仓库已停用，请启用后再同步', 409)
        if not repo['remote_url']:
            raise ApiError('请先在仓库配置中填写远端 Git 地址', 409)
        root = Path(repo['local_path'])
        env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never',
               'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes -o ConnectTimeout=8',
               'GIT_HTTP_LOW_SPEED_LIMIT': '1', 'GIT_HTTP_LOW_SPEED_TIME': '15'}

        def run(*args, timeout=20):
            try:
                return subprocess.run(['git', *args], cwd=root, env=env, capture_output=True,
                                      text=True, encoding='utf8', errors='replace', timeout=timeout)
            except subprocess.TimeoutExpired as error:
                raise ApiError('仓库同步超时，请稍后重试并检查网络', 504) from error
            except OSError as error:
                raise ApiError('无法访问服务器 Git 仓库，请检查目录和 Git 安装', 503) from error

        def value(*args):
            result = run(*args)
            if result.returncode:
                raise ApiError('无法读取仓库状态，请检查服务器 Git 仓库', 409)
            return result.stdout.strip()

        top = value('rev-parse', '--show-toplevel')
        if Path(top).resolve() != root.resolve():
            raise ApiError('配置目录不是独立的 Git 仓库', 409)
        branch = repo['branch']
        if run('check-ref-format', 'refs/heads/' + branch).returncode:
            raise ApiError('仓库配置的分支无效', 409)
        current = run('symbolic-ref', '--quiet', '--short', 'HEAD')
        if current.returncode or current.stdout.strip() != branch:
            raise ApiError('当前分支与配置不一致，请先将服务器仓库切换到 ' + branch, 409)
        if value('remote', 'get-url', 'origin') != repo['remote_url']:
            raise ApiError('服务器 origin 与仓库配置不一致，请先检查 Git 地址', 409)
        for name in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'):
            path = Path(value('rev-parse', '--git-path', name))
            if (path if path.is_absolute() else root / path).exists():
                raise ApiError('仓库有未完成的合并或变基，请先处理后再同步', 409)
        if value('diff', '--cached', '--name-only'):
            raise ApiError('仓库暂存区有未提交修改，请先提交或取消暂存后再同步', 409)
        before = value('rev-parse', '--verify', 'HEAD^{commit}')
        ref = 'refs/remotes/origin/' + branch
        fetched = run('fetch', '--no-tags', 'origin', 'refs/heads/' + branch + ':' + ref, timeout=45)
        if fetched.returncode:
            # Git stderr can include credential-bearing URLs. Never reflect it.
            details = fetched.stderr.lower()
            if 'insufficient permission' in details or 'permission denied' in details and '.git' in details:
                raise ApiError('服务器 Git 仓库无写入权限，请检查后台运行账号对仓库目录的权限', 503)
            raise ApiError('拉取远端失败，请检查网络、Git 凭据及配置分支是否存在', 502)
        remote = value('rev-parse', '--verify', ref + '^{commit}')
        count = int(value('rev-list', '--count', before + '..' + remote))
        result = {'repoId': repo_id, 'branch': branch, 'previousCommit': before,
                  'remoteCommit': remote, 'gitCommit': before, 'receivedCommits': count,
                  'changed': False, 'mode': 'unchanged'}
        if run('merge-base', '--is-ancestor', remote, before).returncode == 0:
            return {**result, 'message': '本地仓库已包含远端最新提交'}

        # Only edits affected by this update block it. Unrelated editor work stays intact.
        incoming = set(value('diff', '--name-only', before + '...' + remote).splitlines())
        dirty = set(value('diff', '--name-only', 'HEAD').splitlines())
        untracked = set(value('ls-files', '--others').splitlines())
        affected = {path for path in dirty | untracked if any(
            path == other or path.startswith(other + '/') or other.startswith(path + '/') for other in incoming)}
        if affected:
            raise ApiError('远端更新涉及未提交文件，请先保存或提交：' + '、'.join(sorted(affected)[:10]), 409)
        preview = run('merge-tree', '--write-tree', '--name-only', before, remote, timeout=35)
        if preview.returncode == 1:
            paths = preview.stdout.split('\n\n', 1)[0].splitlines()[1:]
            raise ApiError('远端提交与本地提交存在冲突，请处理后再同步：' + '、'.join(paths[:10]), 409)
        if preview.returncode:
            raise ApiError('无法安全预检合并，请检查仓库历史及 Git 版本（需要 2.38 或更高版本）', 409)
        if value('rev-parse', 'HEAD') != before:
            raise ApiError('同步期间仓库提交发生变化，请刷新后重试', 409)
        mode = 'fast-forward' if run('merge-base', '--is-ancestor', before, remote).returncode == 0 else 'merge'
        args = ('--ff-only',) if mode == 'fast-forward' else ('--no-ff', '-m', 'Merge remote ' + branch + ' into platform repository')
        try:
            merged = run('-c', 'user.name=Platform repository sync', '-c', 'user.email=platform@localhost',
                         'merge', *args, remote, timeout=45)
        except ApiError:
            run('merge', '--abort')
            raise
        if merged.returncode:
            abort = run('merge', '--abort')
            if abort.returncode and value('rev-parse', 'HEAD') != before:
                raise ApiError('仓库合并未完成，请检查服务器仓库状态', 409)
            raise ApiError('无法合并远端提交，请检查未提交文件或服务器 Git 状态；现有文件已保留', 409)
        return {**result, 'changed': True, 'mode': mode, 'gitCommit': value('rev-parse', 'HEAD'),
                'message': f'已同步远端 {branch}，合入 {count} 个提交'}
