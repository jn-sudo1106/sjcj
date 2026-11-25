"""Reusable agent slots isolate models; a short publication lock protects node outputs."""
import base64
import contextlib
import subprocess
import re


def isolate(selected, canonical):
    from .agent_pool import resource_key
    selected['_publishedWorkspace'] = canonical
    # Existing reference files belong to the node, not an agent's output slot.
    selected['_inputDirectory'] = canonical['inputFileDir']
    selected['_workspaceDirectory'] += '/.agents/' + resource_key(selected).split(':')[-1][:32]


def bind_paths(body, canonical, execution):
    mapping = {canonical[key]: execution[key] for key in ('codeDir', 'inputFileDir', 'outputFileDir', 'prjDir')}
    pattern = re.compile('(?:' + '|'.join(re.escape(path) for path in sorted(mapping, key=len, reverse=True)) + r')(?![A-Za-z0-9_.-])')
    return {**body, **{key: pattern.sub(lambda match: mapping[match.group()], body[key])
                      for key in ('systemPrompt', 'userPrompt', 'prompt') if isinstance(body.get(key), str)}}


def clear_slot(app, selected, workspace):
    from .code_servers import operation
    from .generated_archives import relative_workspace_path
    path = relative_workspace_path(app, selected['generationServerId'], workspace['codeDir'])
    operation(app, selected['generationServerId'], {'action': 'mkdir', 'path': path})
    for item in operation(app, selected['generationServerId'], {'action': 'export', 'paths': [path]})['files']:
        operation(app, selected['generationServerId'], {'action': 'delete', 'path': item['path'], 'expectedHash': item['sha256']})


@contextlib.contextmanager
def publishing(selected):
    canonical = selected.get('_publishedWorkspace')
    if not canonical:
        yield
        return
    from .generation_workspaces import serialized_paths
    with serialized_paths(selected['generationServerId'], [canonical['prjDir'], canonical['codeDir']], selected['timeoutSeconds']):
        yield


def merge_dependencies(app, selected, record):
    canonical = selected.get('_publishedWorkspace')
    if not canonical:
        return
    from .code_servers import operation
    from .generated_archives import relative_workspace_path
    server = selected['generationServerId']
    target = relative_workspace_path(app, server, canonical['codeDir'])
    operation(app, server, {'action': 'mkdir', 'path': target})
    files = operation(app, server, {'action': 'export', 'paths': [target]})['files']
    previous = next((item for item in files if item['path'] == target + '/requirements.txt'), None)
    generated = operation(app, server, {'action': 'export', 'paths': [record['codeDirectory']]})['files']
    expected = record.get('expectedFileName')
    if expected and not any(item['path'] == record['codeDirectory'] + '/' + expected for item in generated):
        return  # A refused/incomplete generation must not become a dependency-only result.
    current = next((item for item in generated if item['path'] == record['codeDirectory'] + '/requirements.txt'), None)
    existing = base64.b64decode(previous['data']).decode('utf-8-sig') if previous else ''
    # Other servers publish into the same Git configuration directory. Preserve
    # their declarations too, while finish holds the central Git/archive locks.
    from .directory_layout import git_files
    with app.store.connect() as db:
        repo = app.repository(db, record['repoId'])
    head = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', 'HEAD'], cwd=repo['local_path'], capture_output=True, text=True, timeout=30)
    commit = head.stdout.strip() if head.returncode == 0 else ''
    name = '/'.join(part for part in (record['directoryPath'], record.get('repositoryPrefix', ''), 'requirements.txt') if part)
    authoritative = app.git(repo['local_path'], 'show', commit + ':' + name) if commit and name in git_files(app, repo, commit) else existing
    added = base64.b64decode(current['data']).decode('utf-8-sig') if current else ''
    lines = authoritative.splitlines()
    known = {line.strip() for line in lines}
    def package(line):
        match = re.match(r'^([A-Za-z0-9][A-Za-z0-9_.-]*)', line.strip())
        return re.sub(r'[-_.]+', '-', match.group(1)).lower() if match else ''
    names = {package(line) for line in lines if package(line)}
    additions = []
    for line in (existing + '\n' + added).splitlines():
        value = line.strip()
        if not value or value in known:
            continue
        if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value) and package(value) in names:
            continue
        additions.append(line); known.add(value)
        if package(value): names.add(package(value))
    merged = authoritative if not additions else authoritative.rstrip() + ('\n' if authoritative.strip() else '') + '\n'.join(additions) + '\n'
    if not merged.strip():
        return
    operation(app, server, {'action': 'upload', 'overwrite': True, 'files': [{
        'path': record['codeDirectory'] + '/requirements.txt', 'data': base64.b64encode(merged.encode()).decode()}]})


def publish_files(app, selected, files):
    canonical = selected.get('_publishedWorkspace')
    if not canonical:
        return
    from .code_servers import operation
    from .generated_archives import relative_workspace_path
    target = relative_workspace_path(app, selected['generationServerId'], canonical['codeDir'])
    operation(app, selected['generationServerId'], {'action': 'upload', 'overwrite': True,
        'files': [{'path': target + '/' + item['sourceRelativePath'], 'data': item['data']} for item in files]})
