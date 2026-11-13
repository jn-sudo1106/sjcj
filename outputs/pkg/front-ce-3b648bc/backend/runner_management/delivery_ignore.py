"""Evaluate deployment exclusions using the selected commit's Git rules."""
from pathlib import Path
import os
import subprocess
import tempfile

from .python_cache import is_python_cache


# Defaults have lower precedence than committed .gitignore rules, so repositories
# can explicitly retain resources. Never guess runtime requirements by extension.
DEFAULT_RULES = '''
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/
.cache/
.venv/
venv/
node_modules/
.idea/
.vscode/
.svn/
.hg/
*.log
*.tmp
*.bak
.DS_Store
Thumbs.db
desktop.ini
'''
METADATA = {'.gitignore', '.gitattributes', '.gitmodules'}


def ignored_paths(repo, commit, tree):
    """Use an isolated rule-only checkout; do not consult mutable server rules.

    Git handles nested rules, directory patterns, ** and negation. --no-index
    also applies the rules to files force-added to the original repository.
    """
    from .directory_layout import safe_path
    from .server import ApiError

    names = set(tree)
    for name in tree:
        names.update('/'.join(name.split('/')[:i]) + '/' for i in range(1, len(name.split('/'))))
    # A Git environment inherited by the service must not redirect the temporary
    # checkout or import machine-wide excludes. The original repo is read-only.
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
    with tempfile.TemporaryDirectory(prefix='runner-delivery-ignore-') as temporary:
        root = Path(temporary)
        initialized = subprocess.run(['git', '-c', 'init.templateDir=', 'init', '-q', str(root)],
                                     env=env, capture_output=True, timeout=20, check=False)
        if initialized.returncode:
            raise ApiError('下发忽略规则初始化失败', 409)
        (root / '.git/info').mkdir(parents=True, exist_ok=True)
        (root / '.git/info/exclude').write_bytes(DEFAULT_RULES.encode('utf-8'))
        rule_bytes = 0
        for name, (mode, size) in tree.items():
            if name.rsplit('/', 1)[-1] != '.gitignore':
                continue
            safe_path(name)
            rule_bytes += size
            if mode not in ('100644', '100755') or rule_bytes > 1024 * 1024:
                raise ApiError('仓库 .gitignore 必须是普通文件且总大小不超过 1 MB', 409)
            result = subprocess.run(['git', 'show', f'{commit}:{name}'], cwd=Path(repo['local_path']),
                                    env=env, capture_output=True, timeout=20, check=False)
            if result.returncode:
                raise ApiError('仓库忽略规则快照读取失败', 409)
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(result.stdout.replace(b'\r\n', b'\n'))
        checked = subprocess.run(['git', '-c', 'core.excludesFile=' + os.devnull,
                                  '-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '-v', '-z', '--stdin'],
                                 cwd=root, env=env, input=b''.join(name.encode('utf-8') + b'\0' for name in sorted(names)),
                                 capture_output=True, timeout=20, check=False)
        if checked.returncode not in (0, 1):
            raise ApiError('仓库下发忽略规则检查失败', 409)
        fields = checked.stdout.split(b'\0')[:-1]
        if len(fields) % 4:
            raise ApiError('仓库下发忽略规则结果无效', 409)
        excluded = {fields[i + 3].decode('utf-8') for i in range(0, len(fields), 4)
                    if not fields[i + 2].startswith(b'!')}
    excluded.update(name for name in names if is_python_cache(name)
                    or name.rstrip('/').rsplit('/', 1)[-1] in METADATA)
    return excluded
