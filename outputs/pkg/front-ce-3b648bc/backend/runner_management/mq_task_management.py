"""Code-generation task views and durable logical deletion over the business task ledger."""
import json
import re
import time

from .directory_layout import store_layout

PREFIX = 'mq-code-deleted:'


def context(row):
    result = {}
    for field in ('params', 'vars'):
        value = row.get(field) or {}
        if isinstance(value, str):
            try: value = json.loads(value)
            except ValueError: continue
        if isinstance(value, dict): result.update(value)
    return result


def source_id(row):
    data = context(row)
    return str(data.get('codeSourceId') or data.get('sourceId') or row.get('sourceId') or '')


def marker(app, task_id):
    from .mq_generation import key
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + key(task_id),)).fetchone()
    return json.loads(row['setting_value']) if row else None


def business_page(config_id, headers, page, size, task_id='', state=''):
    from .mq_generation import fetch_json
    from .server import ApiError
    query = {'configId': config_id, 'page': page, 'limit': size}
    if task_id: query['taskId'] = task_id
    if state: query['state'] = state
    data = fetch_json('/api/v1/task/topTaskPaged', headers=headers, query=query)
    if not isinstance(data, dict) or not isinstance(data.get('data'), list):
        raise ApiError('业务后台代码生成任务分页响应无效', 502)
    return data['data'], int(data.get('count') or 0)


def validate_config(config_id, headers):
    from .mq_generation import fetch_json
    from .server import ApiError
    if not re.fullmatch(r'[1-9][0-9]{0,19}', config_id): raise ApiError('请选择有效的代码生成派发配置')
    response = fetch_json('/api/v1/source/codeConfigOptions', headers=headers)
    options = response.get('data') if isinstance(response, dict) else response
    if not isinstance(options, list): raise ApiError('代码生成派发配置查询失败', 502)
    if not any(str(item.get('configId')) == config_id for item in options):
        raise ApiError('只能管理当前可用的 201 类型代码生成任务', 409)


def paged(app, query, headers):
    from .server import ApiError
    config_id = str(query.get('configId') or '')
    validate_config(config_id, headers)
    owner = str(query.get('sourceId') or '')
    task_id = str(query.get('taskId') or '')
    state = str(query.get('state') or '')
    if owner and not re.fullmatch(r'[1-9][0-9]{0,19}', owner): raise ApiError('源 ID 无效')
    if task_id and not re.fullmatch(r'[1-9][0-9]{0,19}', task_id): raise ApiError('任务 ID 无效')
    if state not in ('', 'L', 'W', 'W1', 'C', 'E'): raise ApiError('代码生成任务状态无效')
    try: page, size = int(query.get('page', 1)), int(query.get('size', 20))
    except (TypeError, ValueError): raise ApiError('分页参数无效')
    if page < 1 or not 1 <= size <= 100: raise ApiError('分页参数无效')
    with app.store.connect() as db:
        markers = [json.loads(row['setting_value']) for row in db.execute(
            'SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',)).fetchall()]
    deleted = {item['taskId'] for item in markers if item['configId'] == config_id}
    if not owner and not deleted:
        items, total = business_page(config_id, headers, page, size, task_id, state)
        return {'list': items, 'total': total}
    # CODE_CONFIG task_inst deliberately has no source identity. The target
    # source is vars.codeSourceId, so the collection sourceId SQL filter is wrong.
    # Filter before pagination; keep only the requested page in memory.
    start, end = (page - 1) * size, page * size
    result, matched, scanned, business_total = [], 0, 0, None
    deadline = time.monotonic() + 20
    for current in range(1, 201):
        if time.monotonic() > deadline: raise ApiError('代码生成任务较多，请增加任务 ID 或状态条件后查询', 503)
        items, count = business_page(config_id, headers, current, 50, task_id, state)
        business_total = count if business_total is None else business_total
        for item in items:
            if str(item.get('taskId')) in deleted or (owner and source_id(item) != owner): continue
            if start <= matched < end: result.append(item)
            matched += 1
        scanned += len(items)
        if not items or scanned >= business_total: return {'list': result, 'total': matched}
    raise ApiError('代码生成任务较多，请增加任务 ID 或状态条件后查询', 503)


def remove(app, body, headers):
    from . import mq_generation as mq
    from .server import ApiError, now
    task_id, config_id = str(body.get('taskId') or ''), str(body.get('configId') or '')
    if not re.fullmatch(r'[1-9][0-9]{0,19}', task_id): raise ApiError('任务 ID 无效')
    validate_config(config_id, headers)
    items, _ = business_page(config_id, headers, 1, 1, task_id)
    row = next((item for item in items if str(item.get('taskId')) == task_id and str(item.get('configId')) == config_id), None)
    if not row: raise ApiError('代码生成任务不存在或不属于所选派发配置', 404)
    data = context(row)
    if data.get('taskKind') != 'CODE_CONFIG': raise ApiError('只能删除代码生成任务，不能删除采集任务', 409)
    with mq.LOCK:
        try: record = mq.read(app, task_id)
        except ApiError as error:
            if error.status != 404: raise
            record = None
        if task_id in mq.ACTIVE or record and record['status'] == 'running':
            raise ApiError('该任务正在生成或提交代码，请等待执行结束后再删除', 409)
        entry = {'taskId': task_id, 'configId': config_id, 'sourceId': source_id(row), 'deletedAt': now()}
        with app.store.connect() as db: store_layout(db, PREFIX + mq.key(task_id), entry)
        if record:
            apply_deleted(record, entry)
            mq.put(app, record)
    return {'ok': True, 'message': '任务已删除；排队消息将跳过生成，已有代码和执行记录保留'}


def apply_deleted(record, entry):
    record['deletedAt'] = entry['deletedAt']
    if record['status'] == 'queued':
        record.update(status='failed', message='任务已删除，未执行代码生成', finishedAt=entry['deletedAt'])
