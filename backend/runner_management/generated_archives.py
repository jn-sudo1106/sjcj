"""Archive completed remote code output into the node's chosen Git directory.

Records are result/commit receipts, not another generation task scheduler.
"""
import ast
import base64
import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath

PREFIX = 'generated-code-result:'
LOCK = threading.RLock()


def records(db):
    return [json.loads(row['setting_value']) for row in db.execute(
        'SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()]


def store(app, record):
    from .directory_layout import store_layout
    with app.store.connect() as db:
        store_layout(db, PREFIX + record['archiveId'], record)
        from .source_code_relations import sync_archive
        sync_archive(db, record)
        from .deployment_resources import enqueue_archive
        enqueue_archive(db, record, app)


def config_id(value):
    from .server import ApiError
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
        raise ApiError('请先保存有效的节点配置')
    return value


def preference_key(owner):
    return 'node-generation-preference:' + hashlib.sha256(owner.encode('utf8')).hexdigest()


def state(app, owner, context=None):
    owner = config_id(owner)
    from .source_code_relations import source_context, OWNER_WHERE
    expected = source_context(context) if context is not None else None
    with app.store.connect() as db:
        preference = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (preference_key(owner),)).fetchone()
        items = [item for item in records(db) if item['configId'] == owner]
        if expected:
            legacy = {row['archive_id'] for row in db.execute('SELECT archive_id FROM source_code_relations WHERE ' + OWNER_WHERE,
                       (expected['sourceId'], expected['flowId'], expected['stepId'], owner)).fetchall()}
            tasks = db.execute('SELECT task_id,payload FROM generation_jobs WHERE config_id=? AND source_id=? AND flow_id=?',
                               (owner, expected['sourceId'], expected['flowId'])).fetchall()
            task_ids = {row['task_id'] for row in tasks if str(json.loads(row['payload']).get('stepId', '')) == expected['stepId']}
            items = [item for item in items if (
                all(str(item['sourceContext'].get(key, '')) == expected[key] for key in ('sourceId', 'flowId', 'stepId'))
                if item.get('sourceContext') else item['archiveId'] in legacy or item.get('taskId') in task_ids)]
    latest = max(items, key=lambda item: item['createdAt']) if items else None
    return {'autoCommit': json.loads(preference['setting_value'])['autoCommit'] if preference else True,
            'archive': public(latest) if latest else None}


def preference(app, body):
    from .server import ApiError
    from .directory_layout import store_layout
    owner = config_id(body.get('configId'))
    enabled = body.get('autoCommit')
    if type(enabled) is not bool:
        raise ApiError('自动提交须为布尔值')
    with LOCK, app.store.connect() as db:
        store_layout(db, preference_key(owner), {'autoCommit': enabled})
    return {'autoCommit': enabled}


def destination(app, body):
    from .server import ApiError, required_text
    from .repository_directories import get_directory
    owner = config_id(body.get('configId'))
    from .generation_destinations import automatic, mode, node_type as resolve_node_type
    include_id = bool(body.get('destinationMode')) or mode(body) == 'type'
    if mode(body) == 'type':
        body = {**body, **automatic(app, body)}
    repo_id = required_text(body, 'repositoryId', 80)
    directory_id = required_text(body, 'directoryId', 80)
    node_type = app.valid_config_type(body.get('configType', ''))
    if type(body.get('autoCommit', False)) is not bool:
        raise ApiError('自动提交须为布尔值')
    if type(body.get('deferCommit', False)) is not bool:
        raise ApiError('提交方式无效')
    with app.store.connect() as db:
        node_type = resolve_node_type(app, db, body)
        repo = app.repository(db, repo_id)
        if repo['status'] != 'ACTIVE':
            raise ApiError('代码仓库已停用', 409)
        directory = get_directory(app, db, repo_id, directory_id, config_type=node_type)
    from .source_code_relations import source_context
    from .generation_workspaces import output_subdirectory
    repository_prefix = '/'.join(part for part in (
        owner if include_id and directory['path'].split('/')[-1] != owner else '', output_subdirectory(body)) if part)
    return {'configId': owner, 'repoId': repo_id, 'directoryId': directory_id, 'directoryPath': directory['path'],
            'sourceContext': source_context(body.get('sourceContext')),
            'repositoryPrefix': repository_prefix,
            'configType': node_type, 'queueName': str(body.get('queueName', ''))[:120], 'autoCommit': body.get('autoCommit', False), 'deferCommit': body.get('deferCommit', False)}


def relative_workspace_path(app, server_id, path):
    from .code_servers import read
    from .server import ApiError
    root = read(app, server_id)['workspace']
    kind = PureWindowsPath if '\\' in root or PureWindowsPath(root).drive else PurePosixPath
    value = kind(path)
    try:
        relative = value.relative_to(kind(root)) if value.is_absolute() else value
    except ValueError as exc:
        raise ApiError('生成目录必须位于代码服务器工作空间内', 403) from exc
    from .directory_layout import safe_path
    return safe_path(relative.as_posix())


def create(app, selected, workspace, target):
    record = {**target, 'archiveId': uuid.uuid4().hex, 'serverId': selected['generationServerId'],
              'taskId': workspace['taskId'], 'codeDirectory': relative_workspace_path(app, selected['generationServerId'], workspace['codeDir']),
              'workspace': selected.get('_publishedWorkspace', workspace), 'startedAt': selected.get('_generationStartedAt', ''),
              'beforeCodeFiles': selected.get('_beforeCodeFiles'),
              'createdAt': datetime.now(timezone.utc).isoformat(timespec='microseconds'), 'status': 'pending',
              'message': '', 'files': [], 'gitCommit': '', 'pushed': False}
    with LOCK:
        store(app, record)
    return record


def changed_files(record, files):
    before = record.get('beforeCodeFiles')
    if not isinstance(before, dict):
        return files
    code_dir = record['codeDirectory'].rstrip('/') + '/'
    prefix = (record.get('repositoryPrefix') or '').strip('/')
    result = []
    for item in files:
        relative = item.get('relativePath', '')
        if prefix:
            relative = relative.removeprefix(prefix + '/')
        if before.get(code_dir + relative) != item['sha256']:
            result.append(item)
    if any(item.get('relativePath', '').endswith('.py') for item in result):
        selected = {item['path'] for item in result}
        result += [item for item in files if item.get('relativePath', '').split('/')[-1] == 'requirements.txt'
                   and item['path'] not in selected]
    # A dependency-only change still belongs to its existing main script.
    # Include that exact companion, never an unrelated site's old script.
    expected = record.get('expectedFileName')
    if result and expected:
        relative = '/'.join(part for part in (prefix, expected) if part)
        selected = {item['path'] for item in result}
        result += [item for item in files if item.get('relativePath') == relative and item['path'] not in selected]
    return result


def public(record):
    result = {key: record.get(key) for key in ('archiveId', 'status', 'message', 'configId', 'repoId', 'directoryId',
            'directoryPath', 'taskId', 'serverId', 'createdAt', 'files', 'gitCommit', 'pushed')}
    result['files'] = changed_files(record, record.get('files', []))
    result['filesScope'] = 'changes' if isinstance(record.get('beforeCodeFiles'), dict) else 'archive'
    code_dir = (record.get('workspace') or {}).get('codeDir')
    if code_dir:
        from .directory_layout import safe_path
        from .server import ApiError
        result['serverCodeDirectory'] = code_dir
        kind = PureWindowsPath if '\\' in code_dir or PureWindowsPath(code_dir).drive else PurePosixPath
        files = []
        prefix = (record.get('repositoryPrefix') or '').strip('/')
        for item in result['files']:
            file = dict(item)
            relative = item.get('relativePath') or ''
            if prefix and relative.startswith(prefix + '/'):
                relative = relative[len(prefix) + 1:]
            try:
                safe_path(relative)
            except ApiError:
                relative = ''
            if relative:
                file['serverPath'] = str(kind(code_dir) / relative)
            files.append(file)
        result['files'] = files
    return result


def collect(app, record):
    from .code_servers import operation
    from .directory_layout import safe_path
    from .server import ApiError
    result = operation(app, record['serverId'], {'action': 'export', 'paths': [record['codeDirectory']]})
    prefix = record['codeDirectory'].rstrip('/') + '/'
    files = []
    for item in result.get('files', []):
        path = item.get('path', '')
        if not path.startswith(prefix):
            raise ApiError('生成服务器返回了本次代码目录以外的文件', 502)
        relative = safe_path(path[len(prefix):])
        data = base64.b64decode(item['data'], validate=True)
        digest = hashlib.sha256(data).hexdigest()
        if item.get('sha256') != digest:
            raise ApiError('生成文件哈希校验失败，请重试读取', 502)
        destination = (record['repositoryPrefix'] + '/' if record.get('repositoryPrefix') else '') + relative
        files.append({'relativePath': destination, 'sourceRelativePath': relative, 'data': item['data'], 'sha256': digest,
                      'size': len(data), 'path': record['directoryPath'] + '/' + destination})
    expected = record.get('expectedFileName')
    if expected:
        primary = next((item for item in files if item['sourceRelativePath'] == expected), None)
        if not primary:
            raise ApiError('未生成主脚本 ' + expected + '，不能把 requirements.txt 等辅助文件当作生成成功。请查看过程输出中的失败原因', 422)
        try:
            tree = ast.parse(base64.b64decode(primary['data']).decode('utf-8-sig'))
            valid = any(not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Constant) or not isinstance(node.value.value, str) for node in tree.body)
            if not valid: raise ValueError('empty script')
        except (UnicodeError, SyntaxError, ValueError) as error:
            raise ApiError('主脚本 ' + expected + ' 为空或不是有效的 UTF-8 Python 代码，生成未完成', 422) from error
    changed = changed_files(record, files)
    scripts = [item for item in changed if item['sourceRelativePath'].endswith('.py')]
    if scripts:
        from .python_dependency_contract import imports, merge_requirements
        modules = set()
        for item in scripts:
            try:
                modules.update(imports(base64.b64decode(item['data']).decode('utf-8-sig')))
            except UnicodeError:
                continue
        local_modules = {item['sourceRelativePath'].split('/')[0].removesuffix('.py') for item in files
                         if item['sourceRelativePath'].endswith('.py')}
        modules -= local_modules
        requirement = next((item for item in files if item['sourceRelativePath'] == 'requirements.txt'), None)
        previous = base64.b64decode(requirement['data']).decode('utf-8-sig') if requirement else ''
        merged = merge_requirements(previous, modules)
        if merged != previous:
            data = merged.encode('utf-8')
            encoded = base64.b64encode(data).decode('ascii')
            operation(app, record['serverId'], {'action': 'upload', 'overwrite': True, 'files': [{
                'path': prefix + 'requirements.txt', 'data': encoded}]})
            destination = (record.get('repositoryPrefix', '') + '/').lstrip('/') + 'requirements.txt'
            replacement = {'sourceRelativePath': 'requirements.txt', 'relativePath': destination,
                           'path': record['directoryPath'] + '/' + destination, 'data': encoded,
                           'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
            files = [item for item in files if item is not requirement] + [replacement]
        # Include declared companions even when the model reused them unchanged.
        # Task-scoped deployment must not omit a required dependency manifest.
        changed = changed_files(record, files)
        selected = {item['path'] for item in changed}
        changed += [item for item in files if item['sourceRelativePath'].split('/')[-1] == 'requirements.txt'
                    and item['path'] not in selected]
    files = changed
    if not files:
        raise ApiError('本次没有新增或修改代码文件，请检查生成服务输出')
    return sorted(files, key=lambda item: item['relativePath'])


def fallback_code(app, record, text, filename, service):
    """Support agents returning code text without creating a file themselves."""
    from .code_servers import operation
    try:
        code = service.normalize_code(text)
        tree = ast.parse(code)
        if not code.strip() or len(code.encode('utf8')) > 200_000:
            return
        if not any(not isinstance(node, ast.Expr) or isinstance(node.value, ast.Call) for node in tree.body):
            return
    except (ValueError, SyntaxError):
        return
    current = {item['path']: item['sha256'] for item in operation(
        app, record['serverId'], {'action': 'export', 'paths': [record['codeDirectory']]})['files']}
    destination = record['codeDirectory'] + '/' + filename
    if destination in current:
        before = record.get('beforeCodeFiles')
        if not isinstance(before, dict) or current[destination] != before.get(destination): return
    operation(app, record['serverId'], {'action': 'upload', 'overwrite': True, 'files': [{
        'path': record['codeDirectory'] + '/' + filename, 'data': base64.b64encode(code.encode('utf8')).decode('ascii')}]})


def commit(app, archive_id):
    from .server import ApiError
    from .repository_directories import get_directory
    with LOCK:
        with app.store.connect() as db:
            raw = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + archive_id,)).fetchone()
        if not raw:
            raise ApiError('生成结果记录不存在', 404)
        record = json.loads(raw['setting_value'])
        if record['status'] == 'committed':
            return public(record)
        try:
            with app.store.connect() as db:
                directory = get_directory(app, db, record['repoId'], record['directoryId'], config_type=record['configType'])
            if directory['path'] != record['directoryPath']:
                raise ApiError('节点仓库目录已经变化，请重新生成或手工选择文件保存', 409)
            files = collect(app, record)
            manifest = [{key: item[key] for key in ('path', 'relativePath', 'sha256', 'size')} for item in files]
            original_files = changed_files(record, record.get('sourceFiles', record['files']))
            if original_files and sorted(original_files, key=lambda item: item['path']) != manifest:
                raise ApiError('生成文件在上次提交后发生变化，不能沿用原结果重试，请重新生成或手工保存', 409)
            record['files'] = manifest
            record['sourceFiles'] = manifest
            store(app, record)
            uploaded = app.upload_repository_files(record['repoId'], {'directoryId': record['directoryId'],
                'overwrite': True, 'uploadType': 'folder', 'files': [{'name': item['relativePath'].rsplit('/', 1)[-1],
                  'relativePath': item['relativePath'], 'data': item['data']} for item in files]}, owner_config_id=record['configId'])
            record.update(status='committed', gitCommit=uploaded['gitCommit'], pushed=uploaded['pushed'], message='')
            kept = {item['path'] for item in uploaded['files']}
            record['files'] = [item for item in manifest if item['path'] in kept]
        except Exception as error:
            record.update(status='failed', message=str(error) if isinstance(error, ApiError) else '代码归档失败，请检查仓库状态后重试提交')
            if getattr(error, 'local_commit', None):
                record['gitCommit'] = error.local_commit
                kept = set(error.uploaded_paths)
                record['files'] = [item for item in record['files'] if item['path'] in kept]
        store(app, record)
        if record.get('workspace', {}).get('taskRecordPath'):
            from .generation_workspaces import receipt, stamp
            try:
                receipt(app, record['serverId'], record['workspace'], configId=record['configId'], queueName=record['queueName'], startedAt=record.get('startedAt', ''),
                        status='succeeded' if record['status'] == 'committed' else 'failed',
                        finishedAt=stamp(), files=record['files'], gitCommit=record['gitCommit'], pushed=record['pushed'], message=record['message'])
            except Exception:
                pass  # A receipt failure must not repeat a completed Git commit.
        return public(record)


def finish(app, selected, target, text, filename, service):
    from .generation_parallel import publishing
    from .server import GIT_LOCK
    with publishing(selected), LOCK, GIT_LOCK:
        return _finish(app, selected, target, text, filename, service)


def _finish(app, selected, target, text, filename, service):
    from .code_servers import operation
    record = create(app, selected, selected['_workspace'], {**target, 'expectedFileName': filename})
    preview, preview_path, warnings = '', '', []
    try:
        operation(app, record['serverId'], {'action': 'mkdir', 'path': record['codeDirectory']})
        fallback_code(app, record, text, filename, service)
        from .generation_parallel import merge_dependencies, publish_files
        merge_dependencies(app, selected, record)
        files = collect(app, record)
        publish_files(app, selected, files)
        record['files'] = [{key: item[key] for key in ('path', 'relativePath', 'sha256', 'size')} for item in files]
        record['sourceFiles'] = record['files']
        store(app, record)
        candidates = [item for item in files if item['relativePath'].endswith('.py') and item['size'] <= 200_000]
        if candidates:
            candidate = next((item for item in candidates if item.get('sourceRelativePath') == filename), candidates[0])
            preview = base64.b64decode(candidate['data']).decode('utf-8-sig', errors='replace')
            preview_path = candidate['path']
        else:
            warnings.append('生成文件已保留；代码预览仅显示 200 KB 以内的 Python 文件，请到仓库查看其他文件。')
        if target['autoCommit'] and not target.get('deferCommit'):
            archive = commit(app, record['archiveId'])
        else:
            archive = public(record)
    except Exception as error:
        from .server import ApiError
        record.update(status='failed', message=str(error) if isinstance(error, ApiError) else '读取或归档生成文件失败，请重试提交')
        store(app, record)
        archive = public(record)
    return {'fileName': filename, 'code': preview, 'previewPath': preview_path, 'warnings': warnings, 'archive': archive,
            'workspace': selected.get('_publishedWorkspace', selected['_workspace']), 'interfaceId': selected['id'], 'model': selected['model']}
