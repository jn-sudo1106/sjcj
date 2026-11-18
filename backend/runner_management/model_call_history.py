"""Persist bounded invocation metadata without copying prompts or model responses."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import re
import time
import uuid
from urllib.parse import urlsplit, urlunsplit
from .runtime_history import redact, stamp


def endpoint(value):
    parsed = urlsplit(value)
    host = parsed.hostname or ''
    if ':' in host: host = '[' + host + ']'
    if parsed.port: host += ':' + str(parsed.port)
    return urlunsplit((parsed.scheme, host, parsed.path, '', ''))


def message(value):
    text = str(value or '').strip()
    lines = text.splitlines()
    return redact(lines[-1] if 'Traceback (' in text else lines[0] if lines else '')[:1000]


def identity(selected):
    return {'interfaceId': selected['id'], 'interfaceName': selected['name'], 'kind': selected['kind'],
            'model': selected.get('model', ''), 'endpoint': endpoint(selected.get('endpoint', '')),
            'cdpPort': selected.get('cdpPort'), 'serverId': selected.get('generationServerId', ''),
            'serverAddress': urlsplit(selected.get('endpoint', '')).hostname or ''}


class Call:
    def __init__(self, app, selected, body, purpose):
        self.app, self.started = app, time.monotonic()
        self.data = {**identity(selected), 'callId': uuid.uuid4().hex, 'purpose': purpose, 'status': 'running',
                     'taskId': str(body.get('taskId') or ''), 'configId': str(body.get('configId') or ''),
                     'startedAt': stamp(), 'finishedAt': '', 'durationMs': None, 'httpStatus': None, 'message': ''}
        with app.store.connect() as db:
            self.data['taskRecorded'] = bool(self.data['taskId'] and db.execute('SELECT 1 FROM generation_jobs WHERE task_id=?', (self.data['taskId'],)).fetchone())
            db.execute('INSERT INTO model_interface_calls VALUES (?,?,?,?,?)',
                       (self.data['callId'], self.data['interfaceId'], self.data['startedAt'], 'running', json.dumps(self.data,ensure_ascii=False)))

    def event(self, kind, fields):
        if kind == 'headers':
            self.data['httpStatus'] = fields.get('status')
            if not fields.get('ok', True): self.fail('HTTP ' + str(fields.get('status')))
        elif kind == 'error': self.fail(fields.get('message', '模型响应中断'))

    def fail(self, reason):
        self.data.update(status='failed', message=message(reason))

    def result(self, result):
        if not isinstance(result, dict): return
        if 'status' in result and type(result['status']) is int: self.data['httpStatus'] = result['status']
        if result.get('ok') is False: self.fail('HTTP ' + str(result.get('status', '请求失败')))
        archive = result.get('archive') or {}
        if archive.get('status') == 'failed': self.fail(archive.get('message') or '生成结果归档失败')

    def close(self):
        if self.data['status'] == 'running': self.data['status'] = 'succeeded'
        self.data.update(finishedAt=stamp(), durationMs=round((time.monotonic()-self.started)*1000))
        with self.app.store.connect() as db:
            db.execute('UPDATE model_interface_calls SET status=?,payload=? WHERE call_id=?',
                       (self.data['status'], json.dumps(self.data,ensure_ascii=False), self.data['callId']))


@contextmanager
def track(app, selected, body, purpose):
    call = Call(app, selected, body, purpose)
    try:
        yield call
    except BaseException as error:
        call.fail(error)
        raise
    finally:
        call.close()


def listing(app, interface_id, query):
    from .server import ApiError
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', interface_id): raise ApiError('智能体接口 ID 无效')
    try:
        page = int((query.get('page') or ['1'])[0]); size = int((query.get('pageSize') or ['20'])[0])
    except (ValueError, TypeError): raise ApiError('分页参数无效')
    if page < 1 or not 1 <= size <= 100: raise ApiError('分页参数无效')
    with app.store.connect() as db:
        total = db.execute('SELECT COUNT(*) total FROM model_interface_calls WHERE interface_id=?', (interface_id,)).fetchone()['total']
        rows = db.execute('SELECT payload FROM model_interface_calls WHERE interface_id=? ORDER BY started_at DESC,call_id DESC LIMIT ? OFFSET ?',
                          (interface_id,size,(page-1)*size)).fetchall()
    return {'interfaceId':interface_id, 'items':[json.loads(row['payload']) for row in rows], 'total':total}


def recover_interrupted(app):
    with app.store.connect() as db:
        rows = db.execute("SELECT call_id,payload FROM model_interface_calls WHERE status='running'").fetchall()
        for row in rows:
            data=json.loads(row['payload'])
            data.update(status='interrupted', finishedAt=stamp(), message='管理服务已重启，此次调用的最终结果未能确认')
            db.execute('UPDATE model_interface_calls SET status=?,payload=? WHERE call_id=?', ('interrupted',json.dumps(data,ensure_ascii=False),row['call_id']))


def backfill(app):
    """Recover only existing finished generation tasks, never invent old Chat calls."""
    count = 0
    with app.store.connect() as db:
        jobs = db.execute("SELECT status,payload FROM generation_jobs WHERE status IN ('succeeded','failed')").fetchall()
        for row in jobs:
            job=json.loads(row['payload']); model=job.get('modelCall') or {}
            if not model.get('interfaceId') or not job.get('startedAt'): continue
            call_id=hashlib.sha256(('generation:'+job['taskId']).encode()).hexdigest()[:32]
            if db.execute('SELECT 1 FROM model_interface_calls WHERE interface_id=? AND payload LIKE ?',
                          (model['interfaceId'], '%"taskId": "'+job['taskId']+'"%')).fetchone(): continue
            started,finished=job['startedAt'],job.get('finishedAt') or ''
            try: duration=round((datetime.fromisoformat(finished.replace('Z','+00:00'))-datetime.fromisoformat(started.replace('Z','+00:00'))).total_seconds()*1000)
            except (ValueError,TypeError): duration=None
            data={**identity({**model,'id':model['interfaceId'],'name':model.get('name','历史智能体'),'kind':model.get('kind','agent')}),
                  'callId':call_id,'purpose':'generation','status':row['status'],'taskId':job['taskId'],'configId':job.get('configId',''),
                  'startedAt':started,'finishedAt':finished,'durationMs':max(0,duration) if duration is not None else None,
                  'httpStatus':None,'message':message(job.get('message')),'historical':True,'taskRecorded':True}
            count += db.execute('INSERT OR IGNORE INTO model_interface_calls VALUES (?,?,?,?,?)',
                                (call_id,model['interfaceId'],started,row['status'],json.dumps(data,ensure_ascii=False))).rowcount
    return count
