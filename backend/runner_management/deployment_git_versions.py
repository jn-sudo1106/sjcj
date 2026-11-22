"""Delivered Git provenance and bounded remote checks, separate from runtime lists."""
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import zipfile

from cryptography.exceptions import InvalidSignature

from .directory_bindings import owner_key


PREFIX = 'delivery-git-sources:'
COMMIT = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})')
POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix='git-version')
LOCK = threading.RLock()


def sources_summary(sources):
    if not isinstance(sources, list):
        raise ValueError('下发版本来源格式无效')
    result = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError('下发版本来源格式无效')
        repo, path, commit = (source.get(key, '') for key in ('repoId', 'sourcePath', 'gitCommit'))
        if isinstance(repo, str) and isinstance(path, str) and isinstance(commit, str) and repo and COMMIT.fullmatch(commit):
            result.add((repo, path, commit))
    return [dict(zip(('repoId', 'sourcePath', 'gitCommit'), item)) for item in sorted(result)]


def remember(db, digest, sources):
    """Save immutable metadata in the existing settings table when creating a delivery."""
    from .directory_layout import store_layout
    store_layout(db, PREFIX + digest.removeprefix('sha256:'), sources_summary(sources))


def delivered_sources(app, delivery):
    from .artifacts import verify_artifact
    from .package_limits import MAX_MANIFEST_BYTES
    digest = delivery['artifact_digest']
    with LOCK:
        cache = getattr(app, '_delivered_git_sources', None)
        if cache is None:
            cache = app._delivered_git_sources = {}
        if digest in cache:
            return cache[digest]
    with app.store.connect() as db:
        saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                           (PREFIX + digest.removeprefix('sha256:'),)).fetchone()
    if saved:
        result = sources_summary(json.loads(saved['setting_value']))
    else:
        # Old receipts have no SQL metadata. Inspect only the immutable signed
        # manifest once; never use today's editable layout as delivered history.
        data = app.artifacts.read(digest)
        verify_artifact(data, digest, delivery['signature'], app.artifacts.public_key)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if archive.getinfo('manifest.json').file_size > MAX_MANIFEST_BYTES:
                raise ValueError('下发版本清单超过大小限制')
            result = sources_summary(json.loads(archive.read('manifest.json')).get('sources', []))
    with LOCK:
        if len(cache) >= 64:
            cache.clear()
        cache[digest] = result
    return result


def source_directories(layout):
    from .directory_layout import node_paths
    paths = node_paths(layout)
    result = set()
    for node in layout.get('nodes', []):
        if not node.get('repoId') or not node.get('sourcePath'):
            continue
        path, relative = node['sourcePath'], paths[node['id']]
        directory = path if node.get('sourceType') == 'directory' else (
            path[:-len(relative) - 1] if relative and path.endswith('/' + relative) else path.rsplit('/', 1)[0] if '/' in path else '')
        result.add((node['repoId'], directory))
    return sorted(result)


def git_tree(app, repo, commit):
    """Read immutable blob IDs in one command; never fetch or change a worktree."""
    key = (repo['repo_id'], repo['local_path'], commit)
    with LOCK:
        cache = getattr(app, '_deployment_git_trees', None)
        if cache is None:
            cache = app._deployment_git_trees = {}
        if key in cache:
            return cache[key]
    result = subprocess.run(['git', 'ls-tree', '-r', '-z', commit, '--'], cwd=Path(repo['local_path']),
                            capture_output=True, timeout=8, check=False)
    if result.returncode:
        raise ValueError('本地尚无对应 Git 提交，请先同步仓库后核对文件内容')
    tree = {}
    for entry in result.stdout.split(b'\0'):
        if not entry:
            continue
        metadata, path = entry.split(b'\t', 1)
        _, kind, digest = metadata.split()
        if kind == b'blob':
            tree[path.decode('utf8')] = digest.decode('ascii')
    with LOCK:
        if len(cache) >= 32:
            cache.clear()
        cache[key] = tree
    return tree


def compare_sources(app, repo, remote_commit, sources):
    """Different origin commits can still contain exactly the same deployed files."""
    result = {'contentStatus': 'unknown', 'contentError': '', 'differentPaths': [], 'comparedFiles': 0}
    if not sources or not remote_commit:
        return result
    if all(source['gitCommit'] == remote_commit for source in sources):
        return {**result, 'contentStatus': 'same_commit'}
    try:
        remote = git_tree(app, repo, remote_commit)
        differences, checked, incomplete = set(), set(), False
        for source in sources:
            if source['gitCommit'] == remote_commit:
                continue
            path = source['sourcePath']
            before = git_tree(app, repo, source['gitCommit'])
            if path in before:
                checked.add(path)
                if before[path] != remote.get(path):
                    differences.add(path)
            else:
                old_files = {name: digest for name, digest in before.items() if name.startswith(path + '/')}
                new_files = {name: digest for name, digest in remote.items() if name.startswith(path + '/')}
                # Directory mappings can exclude tracked caches/ignored files.
                # Equal trees prove equality; unequal trees need scope-aware
                # delivery preview, rather than claiming every change deployed.
                if old_files and old_files == new_files:
                    checked.update(old_files)
                else:
                    incomplete = True
        return {**result, 'contentStatus': 'different' if differences else 'unknown' if incomplete else 'same',
                'differentPaths': sorted(differences)[:10], 'comparedFiles': len(checked),
                'contentError': '目录来源有变化，请在下发预览中按文件范围核对' if incomplete and not differences else ''}
    except (OSError, ValueError, UnicodeError, subprocess.TimeoutExpired):
        return {**result, 'contentError': '本地未具备完整提交，或文件内容核对失败；可同步仓库后重试'}


def remote_version(repo):
    result = {'remoteCommit': '', 'remoteStatus': 'unconfigured', 'remoteError': '',
              'checkedAt': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    if not repo['remote_url']:
        return result
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never',
           'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes -o ConnectTimeout=5',
           'GIT_HTTP_LOW_SPEED_LIMIT': '1', 'GIT_HTTP_LOW_SPEED_TIME': '5'}
    try:
        query = subprocess.run(['git', 'ls-remote', '--exit-code', '--', repo['remote_url'], 'refs/heads/' + repo['branch']],
                               cwd=Path(repo['local_path']), env=env, capture_output=True,
                               text=True, encoding='utf8', errors='replace', timeout=8, check=False)
        for line in query.stdout.splitlines() if query.returncode == 0 else []:
            parts = line.split()
            if len(parts) == 2 and COMMIT.fullmatch(parts[0]) and parts[1] == 'refs/heads/' + repo['branch']:
                return {**result, 'remoteCommit': parts[0], 'remoteStatus': 'ok'}
        reason = '远程分支不存在或没有提交' if query.returncode == 2 else '远程版本查询失败，请检查网络和 Git 凭据'
    except subprocess.TimeoutExpired:
        reason = '远程版本查询超时'
    except OSError:
        reason = '无法访问本地 Git 目录或执行 Git'
    # stderr and command exceptions may contain credential-bearing remote URLs.
    return {**result, 'remoteStatus': 'error', 'remoteError': reason}


def remote_versions(app, repos, refresh):
    pending, result = {}, {}
    with LOCK:
        cache = getattr(app, '_remote_git_versions', None)
        if cache is None:
            cache = app._remote_git_versions = {}
            app._remote_git_version_requests = {}
        requests = app._remote_git_version_requests
        if len(cache) > 128:
            cache.clear()
        for repo in repos:
            key = (repo['repo_id'], repo['remote_url'], repo['branch'], repo['local_path'])
            old = cache.get(key)
            if old and time.monotonic() < old[0] and (not refresh or time.monotonic() - old[1] < 5):
                result[repo['repo_id']] = old[2]
                continue
            future = requests.get(key)
            if future is None:
                future = requests[key] = POOL.submit(remote_version, repo)
                def complete(done, key=key):
                    value = done.result()
                    with LOCK:
                        cache[key] = (time.monotonic() + (60 if value['remoteStatus'] != 'error' else 15), time.monotonic(), value)
                        requests.pop(key, None)
                future.add_done_callback(complete)
            pending[repo['repo_id']] = future
    wait(set(pending.values()), timeout=10)
    for identifier, future in pending.items():
        result[identifier] = future.result() if future.done() else {'remoteCommit': '', 'remoteStatus': 'checking', 'remoteError': '', 'checkedAt': ''}
    return result


def listing(app, query):
    from .server import ApiError
    from .directory_delivery import target_path
    identifiers = list(dict.fromkeys(query.get('runtimeId', [])))
    if not 1 <= len(identifiers) <= 100 or any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value) for value in identifiers):
        raise ApiError('请提供 1–100 个有效运行配置 ID')
    contexts, deliveries, repositories = {}, {}, {}
    with app.store.connect() as db:
        for identifier in identifiers:
            row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('runtime-config:' + identifier,)).fetchone()
            doc = json.loads(row['setting_value']) if row else {}
            deployment = doc.get('deploymentId', '')
            if not deployment and identifier.startswith('unbound-'):
                deployment = identifier.removeprefix('unbound-')
            saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('deployment-config:' + deployment,)).fetchone() if deployment else None
            if not saved:
                contexts[identifier] = {'sources': [], 'deployedStatus': 'unknown', 'deployedError': '运行配置或 Git 映射不存在'}
                continue
            layout = json.loads(saved['setting_value'])
            mapped = source_directories(layout)
            delivery = db.execute("SELECT * FROM directory_deliveries WHERE binding_type='deployment' AND owner_key=? AND runner_id=? AND target_path=? AND status='success' ORDER BY finished_at DESC,requested_at DESC,delivery_id DESC LIMIT 1",
                                  (owner_key(deployment), doc.get('runnerId', ''), doc.get('executionDirectory') or target_path(layout))).fetchone() if doc else None
            if delivery:
                deliveries[identifier] = dict(delivery)
            contexts[identifier] = {'sources': [{'repoId': repo, 'directory': directory} for repo, directory in mapped],
                                    'deployedStatus': 'ok' if delivery else 'not_delivered', 'deployedError': '',
                                    'deliveryId': delivery['delivery_id'] if delivery else '', 'finishedAt': delivery['finished_at'] if delivery else ''}
            for repo, _ in mapped:
                if repo not in repositories:
                    record = db.execute('SELECT * FROM code_repositories WHERE repo_id=?', (repo,)).fetchone()
                    if record:
                        repositories[repo] = dict(record)
    # No DB transaction or global Git mutation lock spans a network request.
    remote = remote_versions(app, list(repositories.values())[:20], query.get('refresh') == ['1'])
    for identifier, context in contexts.items():
        delivered = []
        if identifier in deliveries:
            try:
                delivered = delivered_sources(app, deliveries[identifier])
            except (OSError, ValueError, KeyError, zipfile.BadZipFile, InvalidSignature):
                context.update(deployedStatus='unknown', deployedError='历史下发版本清单不可读取或校验失败')
        for source in context['sources']:
            repo, directory = source['repoId'], source['directory']
            scoped = [item for item in delivered if item['repoId'] == repo and
                      (not directory or item['sourcePath'] == directory or item['sourcePath'].startswith(directory + '/'))]
            commits = sorted({item['gitCommit'] for item in scoped})
            source.update(deployedCommits=commits, branch=repositories.get(repo, {}).get('branch', ''),
                          **remote.get(repo, {'remoteCommit': '', 'remoteStatus': 'error', 'remoteError': '仓库不可用或查询数量超限', 'checkedAt': ''}))
            comparison = compare_sources(app, repositories[repo], source['remoteCommit'], scoped) if repo in repositories and source['remoteStatus'] == 'ok' else {
                'contentStatus': 'unknown', 'contentError': '', 'differentPaths': [], 'comparedFiles': 0}
            source.update(comparison)
    return {'items': [{'runtimeId': identifier, **context} for identifier, context in contexts.items()]}
