"""Manually archive a task's existing output without another model invocation."""
import base64
import json
import uuid
from pathlib import PurePosixPath, PureWindowsPath


def normalized(path):
    kind = PureWindowsPath if '\\' in path or PureWindowsPath(path).drive else PurePosixPath
    value = kind(path).as_posix().rstrip('/')
    return value.casefold() if kind is PureWindowsPath else value


def submit(app, task_id):
    from .server import ApiError, GIT_LOCK, now
    from . import database_generation as tasks, generated_archives as archives, generation_parallel as parallel
    from .agent_pool import hold
    from .generation_workspaces import serialized
    from .source_code_relations import source_context, task_stamp
    if not isinstance(task_id, str) or len(task_id) > 80 or not task_id:
        raise ApiError('任务 ID 无效')
    with serialized('manual-generation-submit', task_id, 1):
        task = tasks.read(app, task_id)
        if task['status'] not in ('failed', 'succeeded'):
            raise ApiError('请等待智能体任务执行结束后再提交生成代码', 409)
        with app.store.connect() as db:
            original = db.execute("SELECT payload FROM jobs WHERE job_type='generation' AND job_id=?", (task_id,)).fetchone()['payload']
            archive_id = ((task.get('result') or {}).get('archive') or {}).get('archiveId', '')
            saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (archives.PREFIX + archive_id,)).fetchone() if archive_id else None
        archive = json.loads(saved['setting_value']) if saved else None
        context = source_context({key: task.get(key, '') for key in ('sourceId', 'flowId', 'stepId', 'flowVersionId')})
        if archive and (archive.get('taskId') != task_id or archive.get('configId') != task['configId']
                        or archive.get('serverId') != task.get('serverId')
                        or archive.get('sourceContext') and source_context(archive['sourceContext']) != context):
            raise ApiError('生成结果与当前任务、源或执行机器不匹配，不能提交', 409)
        if archive and archive['status'] == 'committed':
            if task['status'] == 'succeeded':
                return {'job': tasks.public(task)}
            return persist(app, task, original, archives.public(archive), [], now(), archive.get('expectedFileName'))
        request = task.get('request') or {}
        paths = request.get('body') or {}
        if not task.get('serverId') or not paths.get('code_dir') or not paths.get('prj_dir'):
            raise ApiError('任务未记录实际生成目录，无法提交已有文件，请重新生成', 422)
        call = task.get('modelCall') or {}
        selected = {'generationServerId': task['serverId'], 'endpoint': request.get('url') or call.get('endpoint', ''),
                    'cdpPort': paths.get('cdp_port'), 'timeoutSeconds': 600}
        if not selected['endpoint']:
            raise ApiError('任务未记录智能体接口，无法核对生成工作目录', 422)
        # Hold the original browser port, not today's configured interface.
        with hold(app, selected, 'manual-submit-' + uuid.uuid4().hex):
            root = normalized(paths['code_dir'])
            with app.store.connect() as db:
                others = db.execute("SELECT payload FROM jobs WHERE job_type='generation' AND server_id=? AND job_id<>?", (task['serverId'], task_id)).fetchall()
            for row in others:
                other = json.loads(row['payload'])
                directory = ((other.get('request') or {}).get('body') or {}).get('code_dir')
                if not directory or task_stamp(other.get('startedAt', '')) < task_stamp(task.get('startedAt', '')):
                    continue
                directory = normalized(directory)
                if directory == root or directory.startswith(root + '/') or root.startswith(directory + '/'):
                    raise ApiError('该生成目录已被后续任务使用，不能作为本任务结果提交，请重新生成', 409)
            workspace = (archive or {}).get('workspace') or (task.get('result') or {}).get('workspace')
            if not workspace:
                kind = PureWindowsPath if '\\' in paths['prj_dir'] else PurePosixPath
                parts = kind(paths['prj_dir']).parts
                base = kind(*parts[:parts.index('.agents')]) if '.agents' in parts else kind(paths['prj_dir'])
                workspace = {'instanceId': task['serverId'], 'taskId': task_id, 'prjDir': str(base),
                             'codeDir': str(base / 'code' / task['input'].get('outputSubdirectory', '')),
                             'inputFileDir': paths.get('input_file_dir', str(base / 'input')),
                             'outputFileDir': str(base / 'output'), 'taskRecordPath': str(base / 'tasks' / (task_id + '.json'))}
            selected['_publishedWorkspace'] = workspace
            with parallel.publishing(selected), archives.LOCK, GIT_LOCK:
                if not archive:
                    from .generation_prompt_context import filename
                    from .model_interfaces import script_service
                    body = task['input']
                    if not body.get('repositoryId') or not body.get('directoryId'):
                        raise ApiError('任务未记录原仓库位置，不能使用当前配置替代，请重新生成', 422)
                    target = archives.destination(app, {**body, 'destinationMode': 'custom', 'sourceContext': context})
                    execution = {**workspace, 'codeDir': paths['code_dir']}
                    archive = archives.create(app, selected, execution, {**target, 'expectedFileName': filename(body, script_service())})
                expected = archive.get('expectedFileName') or (task.get('result') or {}).get('fileName')
                if not expected:
                    raise ApiError('任务未记录主脚本名称，无法确认生成结果', 422)
                archive['sourceContext'] = context
                archive['expectedFileName'] = expected
                try:
                    parallel.merge_dependencies(app, selected, archive)
                    files = archives.collect(app, archive)
                    verify_proxy_credentials(app, task['configId'], files)
                except ApiError as error:
                    archive.update(status='failed', message=str(error))
                    archives.store(app, archive)
                    persist(app, task, original, archives.public(archive), [], now(), expected)
                    raise
                parallel.publish_files(app, selected, files)
                completed = archives.commit(app, archive['archiveId'])
                return persist(app, task, original, completed, files, now(), expected)


def verify_proxy_credentials(app, config_id, files):
    from .node_proxy_settings import read
    from .server import ApiError
    secret = ((read(app, config_id) or {}).get('proxyDetail') or {}).get('password') or ''
    if len(secret) >= 6 and any(secret.encode() in base64.b64decode(file['data']) for file in files if file['path'].endswith('.py')):
        raise ApiError('生成代码包含真实代理密码，请先改为从环境变量读取，再提交生成代码', 422)


def persist(app, task, original, archive, files, date, expected=None):
    from . import database_generation as tasks
    from .server import ApiError
    result = {**(task.get('result') or {}), 'archive': archive}
    expected = expected or result.get('fileName')
    primary = next((file for file in files if file['sourceRelativePath'] == expected), None)
    if primary:
        result.update(code=base64.b64decode(primary['data']).decode('utf-8-sig'), previewPath=primary['path'])
    result.setdefault('fileName', expected or '')
    result.setdefault('workspace', {'codeDir': archive.get('serverCodeDirectory', '')})
    success = archive['status'] == 'committed'
    task['manualSubmission'] = {'submittedAt': date, 'previousStatus': task['status'], 'previousMessage': task.get('message', ''), 'status': 'succeeded' if success else 'failed'}
    task.update(result=result, status='succeeded' if success else 'failed', callbackSent=True,
                message=('生成代码已提交并推送 Git' if archive.get('pushed') else '生成代码已提交本地 Git') if success else archive.get('message', '代码归档失败'))
    task['stages'] = (task.get('stages', []) + ['手动提交生成代码：' + task['message']])[-40:]
    with app.store.connect() as db:
        from .store import MySqlConnection
        compare = 'BINARY payload=BINARY ?' if isinstance(db, MySqlConnection) else 'payload=?'
        if db.execute("UPDATE jobs SET payload=?,status=? WHERE job_type='generation' AND job_id=? AND status IN ('failed','succeeded') AND " + compare,
                      (json.dumps(task, ensure_ascii=False), task['status'], task['taskId'], original)).rowcount != 1:
            raise ApiError('任务记录已变化，请刷新后查看最新提交结果', 409)
    return {'job': tasks.public(task)}
