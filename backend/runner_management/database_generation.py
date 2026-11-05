"""Database-backed code generation. No business task/MQ requests are made here."""
import copy
import json
import re
import threading
import time
import uuid

LOCK = threading.RLock()
ACTIVE = set()


def read(app, task_id):
    from .server import ApiError
    with app.store.connect() as db:
        row = db.execute('SELECT payload,status,server_id FROM generation_jobs WHERE task_id=?', (task_id,)).fetchone()
    if not row or row['status'] == 'deleted': raise ApiError('代码生成任务不存在或已删除', 404)
    record = json.loads(row['payload'])
    record.update(status='queued' if row['status'] == 'claimed' else row['status'], serverId=row['server_id'])
    archive = (record.get('result') or {}).get('archive')
    if archive and archive.get('archiveId') and not archive.get('serverCodeDirectory'):
        from .generated_archives import PREFIX, public as archive_public
        with app.store.connect() as db:
            saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + archive['archiveId'],)).fetchone()
        if saved:
            record['result']['archive'] = archive_public(json.loads(saved['setting_value']))
    return record


def public(record):
    return {key: value for key, value in record.items() if key not in ('input', 'task', 'params')}


def put(app, record):
    # Only the executor writes payload after its atomic claimed -> running transition.
    with app.store.connect() as db:
        db.execute("UPDATE generation_jobs SET payload=?,status=?,server_id=? WHERE task_id=? AND status<>'deleted'",
                   (json.dumps(record, ensure_ascii=False), record['status'], record['serverId'], record['taskId']))


def create(app, body, *, _task_id=None, _lineage=None, _node_update=None):
    from .server import ApiError
    from .generation_tasks import read_config, stamp
    from .model_interfaces import listing
    source_id, flow_id, step_id, owner = (str(body.get(key) or '') for key in ('sourceId', 'flowId', 'stepId', 'configId'))
    if any(not re.fullmatch(r'[1-9][0-9]{0,19}', value) for value in (source_id, flow_id, step_id, owner)):
        raise ApiError('请提供有效的源、流程、步骤和节点配置 ID')
    saved = read_config(app, owner).get('generation') or {}
    override = body.get('generation') or {}
    if not isinstance(override, dict): raise ApiError('代码生成配置无效')
    data = copy.deepcopy(saved)
    fields = ('interfaceId', 'repositoryId', 'directoryId', 'configType', 'queueName', 'systemPrompt', 'userPrompt',
              'url', 'fileNameMode', 'fileName', 'destinationMode', 'outputSubdirectory')
    data.update({key: override[key] for key in fields if key in override})
    if any(not isinstance(value, str) or len(value) > (12000 if 'Prompt' in key else 2000) for key, value in data.items()):
        raise ApiError('代码生成配置字段无效或过长')
    if not data.get('systemPrompt', '').strip() or not data.get('userPrompt', '').strip(): raise ApiError('请填写系统和用户提示词')
    selected = next((item for item in listing(app)['items'] if item['id'] == data.get('interfaceId') and item['enabled']), None)
    if not selected: raise ApiError('所选模型不存在或已禁用')
    from .generation_workspaces import directory, node_defaults
    from .generated_archives import destination
    directory({**data, 'configId': owner})
    data = node_defaults(data)
    destination(app, {**data, 'configId': owner})
    from urllib.parse import urlsplit
    try:
        url = urlsplit(data.get('url', ''))
        if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password: raise ValueError()
    except ValueError: raise ApiError('源 URL 无效')
    entries = body.get('entryIds') or []
    if not isinstance(entries, list) or len(entries) > 1000 or any(not re.fullmatch(r'[1-9][0-9]{0,19}', str(value)) for value in entries):
        raise ApiError('任务数据 ID 无效')
    task_id = _task_id or uuid.uuid4().hex
    data.update(configId=owner, taskId=task_id, sampleId='www.realcan.cn.py', autoCommit=True, deferCommit=False)
    from .source_code_relations import source_context
    data['sourceContext'] = source_context({'sourceId': source_id, 'flowId': flow_id, 'stepId': step_id, 'flowVersionId': body.get('flowVersionId')})
    for field in ('systemPrompt', 'userPrompt'):
        for name, value in {'sourceId': source_id, 'flowId': flow_id, 'configId': owner, 'taskId': task_id,
                            'sourceName': str(body.get('sourceName') or source_id), 'url': data['url'], 'sourceUrl': data['url']}.items():
            data[field] = data[field].replace('{{' + name + '}}', value).replace('${' + name + '}', value)
    data['prompt'] = data['userPrompt']
    record = {'taskId': task_id, 'sourceId': source_id, 'sourceName': str(body.get('sourceName') or source_id)[:200],
              'flowId': flow_id, 'stepId': step_id, 'configId': owner, 'nodeName': str(body.get('nodeName') or step_id)[:200],
              'flowVersionId': str(body.get('flowVersionId') or ''), 'entryIds': entries,
              'status': 'queued', 'serverId': '', 'queue': '', 'createdAt': stamp(), 'startedAt': '', 'finishedAt': '',
              'message': '等待匹配所选模型的生成机器', 'callbackSent': False, 'stages': [], 'output': '', 'result': None,
              'input': data, 'task': {'SourceId': source_id, 'Url': data['url']},
              'params': {'orchestration': {'aiGeneration': data}}}
    from .mq_generation import model_call_info
    record['modelCall'] = model_call_info(app, record, selected)
    if _lineage: record.update(_lineage)
    with app.store.connect() as db:
        if _node_update:
            key, previous, updated = _node_update
            from .store import MySqlConnection
            compare = 'BINARY setting_value=BINARY ?' if isinstance(db, MySqlConnection) else 'setting_value=?'
            if db.execute('UPDATE settings SET setting_value=? WHERE setting_key=? AND ' + compare,
                          (updated, key, previous)).rowcount != 1:
                raise ApiError('节点生成配置已修改，请重新打开修正工作区后再提交', 409)
        db.execute('INSERT INTO generation_jobs (task_id,source_id,flow_id,config_id,interface_id,status,server_id,created_at,lease_until,payload) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (task_id, source_id, flow_id, owner, selected['id'], 'queued', '', record['createdAt'], 0, json.dumps(record, ensure_ascii=False)))
        from .source_code_relations import note_task
        note_task(db, record)
    return {'job': public(record)}


def legacy_row(record):
    variables = {'taskKind': 'CODE_CONFIG', 'codeSourceId': record['sourceId'], 'sourceFlowId': record['flowId'],
                 'stepConfigId': record['configId'], 'stepId': record['stepId'],
                 '_codeOrchestration': {'aiGeneration': {**record['input'], 'modelCall': record.get('modelCall')}}}
    return {'taskId': record['taskId'], 'configId': record['configId'], 'sourceId': record['sourceId'],
            'state': {'queued': 'L', 'running': 'L', 'succeeded': 'C', 'failed': 'E'}[record['status']],
            'taskName': '生成步骤脚本[' + record['nodeName'] + ']-' + record['sourceName'],
            'vars': json.dumps(variables, ensure_ascii=False), 'params': '{}', 'createDt': record['createdAt'],
            'taskUrl': record['input']['url'], 'taskResult': record.get('message', '')}


def paged(app, query):
    from .server import ApiError
    try: page, size = int(query.get('page') or 1), int(query.get('size') or 20)
    except (ValueError, TypeError): raise ApiError('分页参数无效')
    if page < 1 or not 1 <= size <= 100: raise ApiError('分页参数无效')
    clauses, values = ["status<>'deleted'"], []
    for key, column in (('sourceId', 'source_id'), ('configId', 'config_id'), ('taskId', 'task_id')):
        if query.get(key): clauses.append(column + '=?'); values.append(str(query[key]))
    states = {'L': ('queued', 'claimed', 'running'), 'C': ('succeeded',), 'E': ('failed',)}
    if query.get('state'):
        if query['state'] not in states: raise ApiError('任务状态无效')
        selected = states[query['state']]
        clauses.append('status IN (' + ','.join('?' for _ in selected) + ')'); values.extend(selected)
    where = ' WHERE ' + ' AND '.join(clauses)
    with app.store.connect() as db:
        total = db.execute('SELECT COUNT(*) AS total FROM generation_jobs' + where, values).fetchone()['total']
        rows = db.execute('SELECT task_id FROM generation_jobs' + where + ' ORDER BY created_at DESC,task_id DESC LIMIT ? OFFSET ?',
                          [*values, size, (page - 1) * size]).fetchall()
    result = []
    for row in rows:
        try: result.append(legacy_row(read(app, row['task_id'])))
        except ApiError as error:
            if error.status != 404: raise
    return {'list': result, 'total': total}


def remove(app, body):
    from .server import ApiError
    ids = body.get('taskIds') if 'taskIds' in body else [body.get('taskId')]
    if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value) for value in ids):
        raise ApiError('请提供 1 至 100 个有效任务 ID')
    items = []
    for task_id in dict.fromkeys(ids):
        with LOCK, app.store.connect() as db:
            changed = db.execute("DELETE FROM generation_jobs WHERE task_id=? AND status<>'running'", (task_id,)).rowcount
            exists = db.execute("SELECT 1 FROM generation_jobs WHERE task_id=?", (task_id,)).fetchone()
        items.append({'taskId': task_id, 'ok': bool(changed or not exists),
                      'message': '任务记录已从数据库删除，已有代码和 Git 归档保留' if changed or not exists else '任务正在生成，请结束后再删除'})
    count = sum(item['ok'] for item in items)
    if 'taskIds' not in body and not count: raise ApiError(items[0]['message'], 409)
    return {'ok': not any(not item['ok'] for item in items), 'items': items, 'deletedCount': count,
            'failedCount': len(items) - count, 'message': items[0]['message']}


def summaries(app, ids):
    from .server import ApiError
    if not 1 <= len(ids) <= 100 or any(not re.fullmatch(r'[a-f0-9]{32}', value) for value in ids):
        raise ApiError('请提供 1 至 100 个有效任务 ID')
    with app.store.connect() as db:
        rows = db.execute("SELECT task_id FROM generation_jobs WHERE status<>'deleted' AND task_id IN ("
                          + ','.join('?' for _ in ids) + ')', ids).fetchall()
    items = []
    for row in rows:
        try: record = read(app, row['task_id'])
        except ApiError as error:
            if error.status == 404: continue
            raise
        item = {key: record[key] for key in ('taskId', 'serverId', 'configId', 'queue', 'status', 'callbackSent', 'message', 'modelCall')}
        item['finishedAt'] = record.get('finishedAt', '')
        archive = (record.get('result') or {}).get('archive')
        if archive and archive.get('repoId') and archive.get('files'):
            item['archive'] = {key: archive.get(key, '') for key in ('repoId', 'directoryId', 'directoryPath')}
            item['archive']['files'] = [{'path': file['path']} for file in archive['files']]
        items.append(item)
    return {'items': items}


def claim(app, server):
    from .model_interfaces import listing
    from .code_servers import registry
    machine = next((row for row in registry(app) if row['serverId'] == server['serverId']), None)
    if not machine or machine['status'] != 'online' or not machine.get('mqCapable'): return {'job': None}
    interfaces = [row['id'] for row in listing(app)['items'] if row['enabled'] and row.get('generationServerId') == server['serverId']]
    if not interfaces: return {'job': None}
    server_id, clock = server['serverId'], time.time()
    with app.store.connect() as db:
        rows = db.execute("SELECT task_id FROM generation_jobs WHERE interface_id IN (" + ','.join('?' for _ in interfaces)
                          + ") AND (status='queued' OR (status='claimed' AND lease_until<?)) ORDER BY created_at,task_id LIMIT 20", [*interfaces, clock]).fetchall()
    for row in rows:
        with LOCK, app.store.connect() as db:
            changed = db.execute("UPDATE generation_jobs SET status='claimed',server_id=?,lease_until=? WHERE task_id=? AND (status='queued' OR (status='claimed' AND lease_until<?))",
                                 (server_id, clock + 60, row['task_id'], clock)).rowcount
        if changed: return {'job': {'taskId': row['task_id']}}
    return {'job': None}


def execute(handler, app, server, task_id):
    from .server import ApiError, RESPONSE_SENT, now
    from .model_interfaces import generate
    with LOCK:
        record = read(app, task_id)
        if record['status'] != 'queued' or record['serverId'] != server['serverId']:
            raise ApiError('任务尚未领取、已结束或已由其他机器领取', 409)
        from .mq_generation import target_server, model_call_info
        target, message = target_server(app, record)
        if target != server['serverId']:
            with app.store.connect() as db:
                db.execute("UPDATE generation_jobs SET status='queued',server_id='',lease_until=0 WHERE task_id=? AND status='claimed' AND server_id=?",
                           (task_id, server['serverId']))
            return {'type': 'done', 'status': 'queued', 'message': message or '等待所选模型机器领取任务', 'result': None}
        with app.store.connect() as db:
            changed = db.execute("UPDATE generation_jobs SET status='running' WHERE task_id=? AND server_id=? AND status='claimed'",
                                 (task_id, server['serverId'])).rowcount
        if not changed: raise ApiError('任务已被执行、删除或领取已失效，请重新领取', 409)
        record.update(status='running', startedAt=now(), message='正在调用模型生成代码', modelCall=model_call_info(app, record)); put(app, record); ACTIVE.add(task_id)
    connected, last_saved = True, 0
    try:
        handler.send_response(200); handler.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
        handler.send_header('Connection', 'close'); handler.end_headers()
    except OSError: connected = False
    handler.close_connection = True
    def emit(kind, **fields):
        nonlocal connected, last_saved
        if kind == 'chunk': record['output'] = (record['output'] + fields.get('text', ''))[-262144:]
        elif kind == 'request': record['request'] = fields['request']
        elif kind == 'progress':
            record['message'] = fields.get('message', '')
            record['stages'] = (record['stages'] + [record['message']])[-40:]
        if kind != 'chunk' or time.monotonic() - last_saved >= .5: put(app, record); last_saved = time.monotonic()
        if connected:
            try: handler.wfile.write((json.dumps({'type': kind, **fields}, ensure_ascii=False) + '\n').encode()); handler.wfile.flush()
            except OSError: connected = False
    try:
        result = generate(app, record['input'], emit)
        if not result.get('archive'):
            result['archive'] = archive_text(app, record, result)
        archive = result.get('archive') or {}
        record.update(result=result, status='failed' if archive.get('status') == 'failed' else 'succeeded',
                      message=archive.get('message') or '代码已生成并提交 Git')
    except Exception as error:
        record.update(status='failed', message=str(error)[:1500]); emit('error', message=record['message'])
    finally:
        record.update(finishedAt=now(), callbackSent=True); put(app, record)
        with LOCK: ACTIVE.discard(task_id)
    emit('done', status=record['status'], message=record['message'], result=record['result'])
    return RESPONSE_SENT


def archive_text(app, record, result):
    """Chat interfaces return text rather than files; archive it to the same typed Git directory."""
    import base64
    import hashlib
    from .server import ApiError, now
    from .generated_archives import destination, store, public as archive_public
    filename, code = result.get('fileName', ''), result.get('code', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.py', filename) or '..' in filename or not code.strip():
        raise ApiError('模型未返回有效的 Python 代码，无法提交仓库', 502)
    target = destination(app, record['input'])
    relative = (target['repositoryPrefix'] + '/' if target['repositoryPrefix'] else '') + filename
    data = code.encode('utf8')
    uploaded = app.upload_repository_files(target['repoId'], {'directoryId': target['directoryId'], 'overwrite': True, 'uploadType': 'folder',
                   'files': [{'name': filename, 'relativePath': relative, 'data': base64.b64encode(data).decode()}]}, owner_config_id=record['configId'])
    archive = {**target, 'archiveId': uuid.uuid4().hex, 'taskId': record['taskId'], 'serverId': record['serverId'],
               'createdAt': now(), 'status': 'committed', 'message': '代码已生成并提交 Git',
               'gitCommit': uploaded.get('gitCommit', ''), 'pushed': uploaded.get('pushed', False),
               'files': [{'path': target['directoryPath'] + '/' + relative, 'relativePath': relative,
                          'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    store(app, archive)
    return archive_public(archive)


def recover(app):
    from .server import now
    with app.store.connect() as db:
        rows = db.execute("SELECT task_id FROM generation_jobs WHERE status='running'").fetchall()
    for row in rows:
        record = read(app, row['task_id'])
        record.update(status='failed', callbackSent=True, finishedAt=now(), message='管理服务重启，结果待核对；请检查仓库后重新创建任务')
        put(app, record)


def personal(handler, app, method, path, body, server):
    from .server import ApiError
    if method == 'POST' and path.endswith('/next'): return claim(app, server)
    if method == 'POST' and path.endswith('/execute'):
        task_id = body.get('taskId')
        if not isinstance(task_id, str) or not re.fullmatch(r'[a-f0-9]{32}', task_id): raise ApiError('任务 ID 无效')
        return execute(handler, app, server, task_id)
    raise ApiError('接口不存在', 404)
