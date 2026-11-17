"""Stored execution receipts for deployment tasks; reading never opens code bundles."""
import json
import re
import uuid
from datetime import datetime, timezone


def record(job, stage, message, *, level='info', detail='', date=None):
    from .runtime_history import redact
    events = job.setdefault('executionEvents', [])
    message, detail = redact(message)[:4000], redact(detail)[:32000]
    if events and all(events[-1].get(key) == value for key, value in (
            ('stage', stage), ('message', message), ('detail', detail), ('level', level))):
        return
    events.append({'eventId': uuid.uuid4().hex, 'time': date or datetime.now(timezone.utc).isoformat(timespec='microseconds'),
                   'stage': stage, 'message': message, 'detail': detail, 'level': level})


def detail(app, identifier):
    from .server import ApiError
    from .deployment_resources import view
    if not isinstance(identifier, str) or not re.fullmatch('[0-9a-f]{32}', identifier):
        raise ApiError('部署任务 ID 无效')
    with app.store.connect() as db:
        row = db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (identifier,)).fetchone()
        if not row:
            raise ApiError('部署任务不存在', 404)
        job = json.loads(row['payload'])
        events = list(job.get('executionEvents') or [])
        delivery_ids = set(job.get('deliveryHistory') or [])
        if job.get('deliveryId'):
            delivery_ids.add(job['deliveryId'])
        delivery_ids = sorted(value for value in delivery_ids if isinstance(value, str) and re.fullmatch('[0-9a-f]{32}', value))
        if delivery_ids:
            records = db.execute('SELECT * FROM runtime_events WHERE record_id IN (' + ','.join('?' for _ in delivery_ids) + ')', delivery_ids).fetchall()
            events.extend({'eventId': row['event_id'], 'time': row['occurred_at'], 'stage': row['stage'],
                           'level': row['level'], 'message': row['message'], 'detail': row['detail']} for row in records)
        # Historical tasks keep only facts that were actually saved, without fabricated verification stages.
        if not job.get('executionEvents'):
            events.append({'eventId': identifier + '-created', 'time': job['createdAt'], 'stage': 'created',
                           'level': 'info', 'message': '部署任务已创建', 'detail': ''})
            events.append({'eventId': identifier + '-result', 'time': job['updatedAt'], 'stage': job['status'],
                           'level': 'error' if job['status'] == 'failed' else 'info', 'message': job['message'], 'detail': ''})
        events.sort(key=lambda item: (item['time'], item['eventId']))
        return {**view(job), 'events': events, 'historyAvailable': bool(job.get('executionEvents')),
                'finishedAt': job['updatedAt'] if job['status'] in ('success', 'failed', 'superseded') else None}
