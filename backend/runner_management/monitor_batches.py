"""Durable, authenticated batches over the existing source-check contract.

Credentials remain in the worker's memory. Restart/session expiry pauses work;
resume supplies a fresh session without replaying confirmed creates.
"""
import hashlib
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, build_opener

from .business_node_types import NoRedirect

LOCK = threading.RLock()
ACTIVE = set()
APPLY_LOCKS = {}
PREFIX = 'monitor-batch:'
TEMPLATE = 'ingestion_freshness'


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def error(message, status=400):
    from .server import ApiError
    return ApiError(message, status)


def call(path, headers, body=None, query=None, allow_check_failure=False, allow_list=False):
    from .mq_generation import business_base
    target = business_base() + path + ('?' + urlencode(query) if query else '')
    forwarded = {'Accept': 'application/json'}
    for name in ('Cookie', 'Access-Token'):
        if headers.get(name): forwarded[name] = headers[name]
    if body is not None: forwarded['Content-Type'] = 'application/json'
    request = Request(target, headers=forwarded,
                      data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    try:
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024: raise ValueError()
        result = json.loads(raw)
    except Exception as exc:
        status = getattr(exc, 'code', None)
        if status in (301, 302, 401, 403): raise error('业务会话已失效，请登录后继续批次', 401) from exc
        raise error('业务接口请求失败或超时，未将未知结果视为成功', 502) from exc
    if allow_list and isinstance(result, list): return {'data': result}
    if not isinstance(result, dict): raise error('业务接口返回格式无效', 502)
    if not allow_check_failure and (result.get('success') is False or result.get('code') not in (None, '', 0, '0')):
        raise error(str(result.get('msg') or result.get('message') or '业务接口拒绝请求')[:400], 502)
    return result


def read(app, key):
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key,)).fetchone()
    return json.loads(row['setting_value']) if row else None


def write(app, key, value):
    with app.store.connect() as db:
        db.execute('DELETE FROM settings WHERE setting_key=?', (key,))
        db.execute('INSERT INTO settings(setting_key,setting_value) VALUES(?,?)',
                   (key, json.dumps(value, ensure_ascii=False)))


def item_key(batch_id, source_id=''):
    return f'{PREFIX}{batch_id}:item:{source_id}'


def progress(app, job):
    with LOCK:
        current = read(app, PREFIX + job['batchId'])
        if current and current['status'] == 'paused': return False
        write(app, PREFIX + job['batchId'], job)
        return True


def owner(identity):
    if identity is None: return 'local-development'
    value = identity.get('userLoginName') or identity.get('userName') or identity.get('id')
    if not value: raise error('当前身份缺少用户标识', 403)
    return str(value)


def batch(app, batch_id, identity):
    if not re.fullmatch('[0-9a-f]{32}', batch_id): raise error('批次不存在', 404)
    result = read(app, PREFIX + batch_id)
    if not result or result['owner'] != owner(identity): raise error('批次不存在', 404)
    return result


def rows_of(result):
    rows = result.get('data', result.get('list'))
    if isinstance(rows, dict): rows = rows.get('list')
    if not isinstance(rows, list): raise error('业务列表返回格式无效', 502)
    return rows


def source_checks(source_id, headers):
    rows = []
    page = 1
    while True:
        result = call('/api/v1/source/check/paged', headers, query={'sourceId': source_id, 'page': page, 'limit': 200})
        part = rows_of(result)
        rows.extend(row for row in part if str(row.get('sourceId')) == source_id)
        if not part or len(rows) >= int(result.get('count', result.get('total', len(part)))): return rows
        page += 1
        if page > 100: raise error('该源监控过多，请缩小范围后核对', 409)


def definition(options):
    conf = {'kind': 'rule', 'timeType': 'C', 'minSize': 1, 'notifyOn': 'none',
            'templateCode': TEMPLATE, 'templateVersion': 1,
            'checkMsg': '约定检查窗口内没有新数据入库'}
    if options['window'] == 'hours': conf['startDt'] = f'DATE_SUB(NOW(), INTERVAL {options["hours"]} HOUR)'
    return conf


def conf_of(row):
    try:
        result = json.loads(row.get('checkConf') or '{}')
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError): return {}


def equivalent(row, options):
    conf = conf_of(row)
    expected = definition(options)
    return (conf.get('kind') in (None, 'rule') and not conf.get('methods') and not conf.get('orchestration')
            and conf.get('timeType', 'C') == 'C' and str(conf.get('minSize', 1)) == '1'
            and conf.get('maxSize') in (None, '', 99999999, '99999999')
            and not conf.get('cond') and not conf.get('checkRule') and not conf.get('sourceIds')
            and not conf.get('endDt') and row.get('lastId') in (None, -1, '-1')
            and (conf.get('startDt') or '').upper() == (expected.get('startDt') or '').upper()
            and bool(row.get('schedule')) and not str(row['schedule']).upper().startswith('AFTER'))


def prepare(app, job, item, headers):
    source_id = item['sourceId']
    checks = source_checks(source_id, headers)
    marked = []
    for row in checks:
        conf = conf_of(row)
        if conf.get('templateCode') == TEMPLATE or equivalent(row, job['options']): marked.append(row)
    if marked:
        if len(marked) > 1: raise error('该源有多条通用或等价检查，请核对后保留一条；未猜测目标记录')
        row = marked[0]
        if int(row.get('isDelete', 0)) != 0: raise error('现有通用检查已停用，保留停用意图，请单独核对')
        item.update(status='existing', monitorId=str(row['id']), tableName=row.get('tableName'),
                    message='已有通用检查；保持原窗口、计划、通知和启停，不重复新增')
        return
    table_id = str(item.get('tableId') or '')
    if not table_id: raise error('源未登记主表，请先补齐主表')
    result = call('/api/v1/entry/queryEntryType', headers, query={'type': table_id})
    entry = result.get('data')
    if not isinstance(entry, dict): raise error('主表详情不可用')
    table_name = str(entry.get('tableName') or '').strip()
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', table_name):
        raise error('主表没有有效的库.表名称，不能猜测检查范围')
    payload = {'sourceId': source_id, 'name': item['name'] + '-通用入库检查', 'tableName': table_name,
               'schedule': job['options']['schedule'], 'checkConf': json.dumps(definition(job['options']), ensure_ascii=False)}
    # The legacy check-one result contains sqlResult even when cnt=0. A SQL
    # error has no result, so an absent table never becomes a "no data" pass.
    result = call('/api/v1/source/check/check-one', headers, payload, allow_check_failure=True)
    detail = result.get('data')
    if isinstance(detail, str):
        try: detail = json.loads(detail)
        except ValueError: detail = None
    if not isinstance(detail, dict):
        message = str(result.get('msg') or '')
        tail = message.split('上下文json:', 1)
        if len(tail) == 2:
            try: detail = json.loads(tail[1])
            except ValueError: detail = None
    sql_result = detail.get('sqlResult') if isinstance(detail, dict) else None
    if isinstance(sql_result, str):
        try: sql_result = json.loads(sql_result)
        except ValueError: sql_result = None
    if not isinstance(sql_result, dict) or 'cnt' not in sql_result:
        raise error(str(result.get('msg') or '预检未取得实际查询结果')[:300])
    item.update(status='ready', tableName=table_name, checkedCount=sql_result['cnt'], payload=payload,
                message='查询已验证；当前无新增' if int(sql_result['cnt']) == 0 else '查询已验证；当前有新增')


def key_rows(app, prefix):
    with app.store.connect() as db:
        return db.execute('SELECT setting_key FROM settings WHERE setting_key LIKE ? ORDER BY setting_key', (prefix + '%',)).fetchall()


def preview(app, job, headers):
    scope = job['scope']
    query = {'enable': '0', 'sorted': 1, 'page': 1, 'limit': 200, 'pageSize': 200}
    if scope.get('sourceIds'): query['ids'] = ','.join(scope['sourceIds'])
    if scope.get('siteId'): query['siteIds'] = scope['siteId']
    if scope.get('name'): query['name'] = scope['name']
    while True:
        result = call('/api/v1/source/sourcePaged', headers, query)
        sources = rows_of(result)
        total = int(result.get('count', result.get('total', len(sources))))
        if job.get('sourceTotal') is not None and job['sourceTotal'] != total:
            raise error('圈定源范围期间总数变化，请重新预检；尚未新增监控', 409)
        job['sourceTotal'] = total
        for source in sources:
            source_id = str(source.get('sourceId') or '')
            if not re.fullmatch('[1-9][0-9]{0,19}', source_id): continue
            if scope.get('sourceIds') and source_id not in scope['sourceIds']: continue
            key = item_key(job['batchId'], source_id)
            if read(app, key): continue
            item = {'sourceId': source_id, 'name': str(source.get('sourceName') or source.get('name') or source_id),
                    'tableId': str(source.get('entryTypeId') or ''), 'status': 'pending'}
            write(app, key, item)
        job['message'] = f'正在固定源清单，第 {query["page"]} 页'
        if not progress(app, job): return
        if not sources or query['page'] * 200 >= total: break
        query['page'] += 1
    keys = key_rows(app, item_key(job['batchId']))
    job['total'] = len(keys)
    if len(keys) != total: raise error('源清单不完整，未执行新增；请重新选择范围', 409)
    available = {read(app, row['setting_key'])['sourceId'] for row in keys}
    for source_id in set(scope.get('sourceIds') or []) - available:
        write(app, item_key(job['batchId'], source_id), {
            'sourceId': source_id, 'name': source_id, 'tableId': '', 'status': 'blocked',
            'message': '未在当前权限及筛选范围内找到启用源；未新增监控',
        })
    keys = key_rows(app, item_key(job['batchId']))
    job['total'] = len(keys)
    for row in keys:
        current = read(app, PREFIX + job['batchId'])
        if current['status'] == 'paused': return
        item = read(app, row['setting_key'])
        if item['status'] != 'pending': continue
        try: prepare(app, job, item, headers)
        except Exception as exc:
            if getattr(exc, 'status', None) == 401: raise
            item.update(status='blocked', message=str(exc))
        write(app, row['setting_key'], item)
        job['prepared'] = job.get('prepared', 0) + 1
        if not progress(app, job): return
    job.update(status='previewed', message='预检完成；提交前请核对当前批次的统一检查窗口和计划')


def apply(app, job, headers):
    for row in key_rows(app, item_key(job['batchId'])):
        if read(app, PREFIX + job['batchId'])['status'] == 'paused': return
        item = read(app, row['setting_key'])
        if item['status'] not in ('ready', 'create_unknown'): continue
        try:
            checks = source_checks(item['sourceId'], headers)
            recovered = [check for check in checks if conf_of(check).get('batchCreateKey') == item['createKey']]
            other = [check for check in checks if conf_of(check).get('templateCode') == TEMPLATE or equivalent(check, job['options'])]
            if not recovered and other and item['status'] == 'ready':
                if len(other) != 1 or int(other[0].get('isDelete', 0)) != 0:
                    raise error('预检后通用检查发生变化：存在多条或已停用，请核对；未继续新增', 409)
                item.update(status='existing', monitorId=str(other[0]['id']), tableName=other[0].get('tableName'),
                            message='预检后已补齐通用检查，本次复用，保持原配置')
                write(app, row['setting_key'], item)
                continue
            if len(recovered) > 1: raise error('发现多个相同创建标识，请人工核对，未继续新增', 409)
            if not recovered:
                if item['status'] == 'create_unknown':
                    item['message'] = '上次提交结果不确定，未找到回读记录；为避免重复新增，请核对后处理'
                    write(app, row['setting_key'], item)
                    continue
                payload = dict(item['payload'])
                conf = json.loads(payload['checkConf'])
                conf['batchCreateKey'] = item['createKey']
                payload['checkConf'] = json.dumps(conf, ensure_ascii=False)
                # Persist uncertainty before the network mutation. A dropped response
                # must never cause automatic re-insertion on resume.
                item.update(status='create_unknown', message='正在提交并回查')
                write(app, row['setting_key'], item)
                call('/api/v1/source/check/add', headers, payload)
                recovered = [check for check in source_checks(item['sourceId'], headers)
                             if conf_of(check).get('batchCreateKey') == item['createKey']]
            if len(recovered) != 1: raise error('已提交，但未回读到唯一记录；保留待核对状态', 409)
            item.update(status='created', monitorId=str(recovered[0]['id']), message='已新增并回读；通知静默，可单独配置通知')
        except Exception as exc:
            item['message'] = str(exc)
            if getattr(exc, 'status', None) == 401:
                write(app, row['setting_key'], item)
                raise
            if item['status'] == 'ready': item['status'] = 'blocked'
        write(app, row['setting_key'], item)
    job.update(status='completed', message='批量配置已处理；已创建与待核对分别统计，不代表正式运行已完成')


def logs(monitor_id, source_id, headers):
    result = call('/api/v1/source/check/paged-logs', headers,
                  query={'jobId': monitor_id, 'sourceId': source_id, 'page': 1, 'limit': 10})
    return [row for row in rows_of(result) if str(row.get('sourceId')) == source_id]


def verify(app, job, headers):
    keys = key_rows(app, item_key(job['batchId']))
    for row in keys:
        if read(app, PREFIX + job['batchId'])['status'] == 'paused': return
        item = read(app, row['setting_key'])
        if item['status'] != 'created': continue
        previous = logs(item['monitorId'], item['sourceId'], headers)
        item.update(status='queued', baselineLogId=str(previous[0]['logId']) if previous else '',
                    message='已申请运行，等待实际日志回执')
        write(app, row['setting_key'], item)
        call('/api/v1/source/check/runNow', headers, query={'ids': item['monitorId']})
    deadline = time.monotonic() + 180
    while True:
        waiting = False
        for row in keys:
            if read(app, PREFIX + job['batchId'])['status'] == 'paused': return
            item = read(app, row['setting_key'])
            if item['status'] not in ('queued', 'unconfirmed'): continue
            recent = logs(item['monitorId'], item['sourceId'], headers)
            fresh = next((record for record in recent if int(record.get('logId') or 0) > int(item.get('baselineLogId') or 0)), None)
            if fresh:
                text = str(fresh.get('logMsg') or '')
                failed = bool(re.search(r'执行失败|无法执行|异常退出|连接失败|超时|timeout|timed out', text, re.I))
                item.update(status='executed', logId=str(fresh['logId']), at=fresh.get('createDt'),
                            exec='failed' if failed else 'succeeded',
                            data='unknown' if failed else ('abnormal' if fresh.get('state') == 'E' else 'normal' if fresh.get('state') == 'C' else 'unknown'),
                            message=text[:500])
            else:
                waiting = True
                if time.monotonic() >= deadline:
                    item.update(status='unconfirmed', message='未取得实际运行回执，请检查调度是否漏跑；继续回查不会重复请求运行')
            write(app, row['setting_key'], item)
        if not waiting or time.monotonic() >= deadline: break
        time.sleep(2)
    job.update(status='completed', message='正式运行回查结束；以实际日志为准，未回执项不标记成功。通知保持静默')


def launch(app, job, headers, action):
    marker = (id(app), job['batchId'])
    with LOCK:
        if marker in ACTIVE: raise error('该批次正在执行', 409)
        ACTIVE.add(marker)
        job.update(status={'preview': 'preparing', 'apply': 'applying', 'verify': 'verifying'}[action], action=action, message='开始处理', updatedAt=stamp())
        write(app, PREFIX + job['batchId'], job)
    credentials = {key: headers[key] for key in ('Cookie', 'Access-Token') if headers.get(key)}
    def work():
        try:
            if action == 'apply':
                with LOCK: apply_lock = APPLY_LOCKS.setdefault(id(app), threading.Lock())
                with apply_lock: apply(app, job, credentials)
            else:
                (preview if action == 'preview' else verify)(app, job, credentials)
        except Exception as exc:
            job.update(status='paused', message=str(exc))
        finally:
            with LOCK:
                if read(app, PREFIX + job['batchId'])['status'] != 'paused' or job['status'] == 'paused':
                    write(app, PREFIX + job['batchId'], job)
                ACTIVE.discard(marker)
    threading.Thread(target=work, name='monitor-batch-' + job['batchId'][:8], daemon=True).start()


def create(app, payload, headers, identity):
    options = payload.get('options') or {}
    window = options.get('window', 'hours')
    hours = options.get('hours', 24)
    schedule = str(options.get('schedule') or '').strip()
    if window not in ('today', 'hours') or type(hours) is not int or not 1 <= hours <= 8784:
        raise error('检查窗口无效')
    if not schedule or schedule.upper().startswith('AFTER'):
        raise error('请选择独立定时 cron，不能依赖采集完成')
    call('/api/v1/source/lastRun', headers, query={'cron': schedule}, allow_list=True)
    scope = payload.get('scope') or {}
    ids = scope.get('sourceIds') or []
    if not isinstance(ids, list) or len(ids) > 5000 or any(not re.fullmatch('[1-9][0-9]{0,19}', str(value)) for value in ids):
        raise error('源 ID 列表无效，单次指定最多 5000 个；大范围请按网站或筛选条件选择')
    scope = {'sourceIds': sorted(set(map(str, ids))), 'siteId': str(scope.get('siteId') or ''), 'name': str(scope.get('name') or '').strip()}
    if scope['siteId'] and not re.fullmatch('[1-9][0-9]{0,19}', scope['siteId']): raise error('网站 ID 无效')
    if not ids and not scope['siteId'] and not scope['name'] and payload.get('allSources') is not True:
        raise error('请选择源范围')
    job = {'batchId': uuid.uuid4().hex, 'owner': owner(identity), 'scope': scope,
           'options': {'window': window, 'hours': hours, 'schedule': schedule},
           'createdAt': stamp(), 'status': 'pending', 'total': 0, 'prepared': 0}
    launch(app, job, headers, 'preview')
    return {'batchId': job['batchId']}


def view(app, batch_id, identity, page=1):
    job = batch(app, batch_id, identity)
    if (id(app), batch_id) not in ACTIVE and job['status'] in ('preparing', 'applying', 'verifying'):
        job.update(status='paused', message='服务已重启，请继续批次；已确认记录不会重复新增')
        write(app, PREFIX + batch_id, job)
    pattern = item_key(batch_id) + '%'
    with app.store.connect() as db:
        grouped = db.execute("SELECT JSON_EXTRACT(setting_value,'$.status') AS state, COUNT(*) AS cnt "
                             'FROM settings WHERE setting_key LIKE ? GROUP BY state', (pattern,)).fetchall()
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ? ORDER BY setting_key LIMIT 50 OFFSET ?',
                          (pattern, (page - 1) * 50)).fetchall()
    counts = {str(row['state']).strip('"'): row['cnt'] for row in grouped}
    items = [{key: value for key, value in json.loads(row['setting_value']).items() if key not in ('payload', 'createKey')} for row in rows]
    from .monitor_delivery import status
    return {**job, 'counts': counts, 'items': items, 'total': sum(counts.values()), 'delivery': status(app, job)}


def command(app, batch_id, payload, headers, identity):
    job = batch(app, batch_id, identity)
    action = payload.get('action')
    if action == 'delivery':
        from .monitor_delivery import configure
        configure(app, job, payload)
        return {'batchId': batch_id}
    if action == 'retry_delivery':
        from .monitor_delivery import retry
        retry(app, job)
        return {'batchId': batch_id}
    if action == 'pause':
        with LOCK:
            job.update(status='paused', message='已暂停；当前请求完成后停止')
            write(app, PREFIX + batch_id, job)
    elif action in ('apply', 'resume', 'verify', 'retry'):
        if job['status'] not in ('previewed', 'paused', 'completed'): raise error('请等待当前阶段完成', 409)
        phase = 'apply' if action == 'apply' else 'verify' if action == 'verify' else job.get('action', 'preview')
        if action == 'retry':
            phase = 'preview'
            for row in key_rows(app, item_key(batch_id)):
                item = read(app, row['setting_key'])
                if item['status'] == 'blocked':
                    item.update(status='pending', message='等待重新预检')
                    write(app, row['setting_key'], item)
        if action == 'apply' and job.get('action') == 'preview' and job['status'] != 'previewed':
            raise error('请先完成全部预检', 409)
        if phase == 'apply':
            with LOCK:
                for row in key_rows(app, item_key(batch_id)):
                    item = read(app, row['setting_key'])
                    if item['status'] == 'ready' and not item.get('createKey'):
                        item['createKey'] = hashlib.sha256((batch_id + ':' + item['sourceId']).encode()).hexdigest()
                        write(app, row['setting_key'], item)
        launch(app, job, headers, phase)
    else: raise error('批次操作无效')
    return {'batchId': batch_id}


def listing(app, identity):
    with app.store.connect() as db:
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ? AND setting_key NOT LIKE ?',
                          (PREFIX + '%', PREFIX + '%:item:%')).fetchall()
    jobs = [json.loads(row['setting_value']) for row in rows]
    return sorted([job for job in jobs if job['owner'] == owner(identity)], key=lambda job: job['createdAt'], reverse=True)[:50]
