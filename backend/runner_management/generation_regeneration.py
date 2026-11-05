"""Task-centre correction using immutable task snapshots, without business/MQ writes."""
import copy
import hashlib
import json
import re
import uuid

FIELDS = ('interfaceId', 'repositoryId', 'directoryId', 'configType', 'queueName', 'systemPrompt', 'userPrompt',
          'url', 'fileNameMode', 'fileName', 'destinationMode', 'outputSubdirectory')


def revision(raw):
    return hashlib.sha256((raw or '').encode('utf8')).hexdigest()


def prepare(app, task_id):
    from .database_generation import read
    from .generation_tasks import key
    from .server import ApiError
    if not isinstance(task_id, str) or not re.fullmatch(r'[0-9a-f]{32}', task_id): raise ApiError('代码生成任务 ID 无效')
    record = read(app, task_id)
    snapshot = record.get('input')
    if not isinstance(snapshot, dict): raise ApiError('历史任务缺少生成配置快照，无法重新生成', 409)
    with app.store.connect() as db:
        saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key(record['configId']),)).fetchone()
    return {'taskId': task_id, 'generation': {field: snapshot[field] for field in FIELDS if field in snapshot},
            'context': {field: record.get(field, '') for field in ('sourceId', 'sourceName', 'flowId', 'flowVersionId', 'stepId', 'configId', 'nodeName')},
            'nodePromptRevision': revision(saved['setting_value'] if saved else ''),
            'canUpdateNode': bool(saved and (json.loads(saved['setting_value']).get('generation')))}


def submit(app, task_id, body):
    from . import database_generation as tasks
    from .generation_tasks import key, stamp
    from .server import ApiError
    if not isinstance(body, dict): raise ApiError('重新生成参数无效')
    if not isinstance(task_id, str) or not re.fullmatch(r'[0-9a-f]{32}', task_id): raise ApiError('代码生成任务 ID 无效')
    request_id = body.get('requestId', '')
    if not isinstance(request_id, str) or not re.fullmatch(r'[0-9a-f]{32}', request_id): raise ApiError('重新生成请求 ID 无效')
    for field in ('systemPrompt', 'userPrompt', 'correction'):
        if not isinstance(body.get(field, ''), str) or len(body.get(field, '')) > 12000: raise ApiError('提示词或修正要求过长或格式错误')
    if not body.get('systemPrompt', '').strip() or not body.get('userPrompt', '').strip(): raise ApiError('请填写系统和用户提示词')
    if not isinstance(body.get('interfaceId'), str) or len(body['interfaceId']) > 2000: raise ApiError('请选择有效模型接口')
    if type(body.get('updateNodePrompts', False)) is not bool: raise ApiError('更新节点提示词选项无效')
    fingerprint = revision(json.dumps(body, ensure_ascii=False, sort_keys=True))
    identifier = uuid.uuid5(uuid.NAMESPACE_URL, 'ce:regenerate:' + task_id + ':' + request_id).hex
    with tasks.LOCK:
        original = tasks.read(app, task_id)
        with app.store.connect() as db:
            existing = db.execute('SELECT payload FROM generation_jobs WHERE task_id=?', (identifier,)).fetchone()
        if existing:
            child = json.loads(existing['payload'])
            if child.get('regenerationFingerprint') != fingerprint: raise ApiError('此请求已提交其他内容，请重新打开修正工作区', 409)
            return {'job': tasks.public(child)}
        if original['status'] not in ('succeeded', 'failed'): raise ApiError('请等待原任务执行结束后再重新生成', 409)
        with app.store.connect() as db:
            if db.execute("SELECT 1 FROM generation_jobs WHERE config_id=? AND status IN ('queued','claimed','running')", (original['configId'],)).fetchone():
                raise ApiError('此配置已有等待或执行中的生成任务，请先查看该任务', 409)
        prepared = prepare(app, task_id)
        generation = copy.deepcopy(prepared['generation'])
        user_prompt = body['userPrompt'].strip()
        correction = body.get('correction', '').strip()
        if correction: user_prompt += '\n\n本次修正要求：\n' + correction
        if len(user_prompt) > 12000: raise ApiError('用户提示词与修正要求合计不能超过 12000 字')
        generation.update(interfaceId=body['interfaceId'], systemPrompt=body['systemPrompt'], userPrompt=user_prompt)
        node_update = None
        if body.get('updateNodePrompts'):
            with app.store.connect() as db:
                saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key(original['configId']),)).fetchone()
            if not saved or not json.loads(saved['setting_value']).get('generation'): raise ApiError('节点尚无保存的生成配置，不能更新提示词', 409)
            if body.get('nodePromptRevision') != revision(saved['setting_value']): raise ApiError('节点生成配置已修改，请重新打开修正工作区后再提交', 409)
            updated = json.loads(saved['setting_value'])
            updated['generation'].update(systemPrompt=body['systemPrompt'], userPrompt=user_prompt)
            updated['updatedAt'] = stamp()
            node_update = (key(original['configId']), saved['setting_value'], json.dumps(updated, ensure_ascii=False))
        lineage = {'parentTaskId': task_id, 'rootTaskId': original.get('rootTaskId') or task_id,
                   'attempt': int(original.get('attempt') or 1) + 1, 'correction': correction,
                   'regenerationFingerprint': fingerprint, 'nodePromptsUpdated': bool(node_update)}
        return tasks.create(app, {**prepared['context'], 'entryIds': original.get('entryIds', []), 'generation': generation},
                            _task_id=identifier, _lineage=lineage, _node_update=node_update)
