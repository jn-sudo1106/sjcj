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
                   'stage': stage, 'message': message, 'detail': detail, 'level': level,
                   **({'attemptId': job['deliveryId']} if job.get('deliveryId') else {})})


def detail(app, identifier):
    from .server import ApiError
    from .deployment_resources import view
    if not isinstance(identifier, str) or not re.fullmatch('[0-9a-f]{32}', identifier):
        raise ApiError('部署任务 ID 无效')
    with app.store.connect() as db:
        row = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?", (identifier,)).fetchone()
        if not row:
            raise ApiError('部署任务不存在', 404)
        job = json.loads(row['payload'])
        from .deployment_log_storage import events as task_events
        events, managed = task_events(db, job)
        legacy = list(job.get('executionEvents') or [])
        known = {event['eventId'] for event in events}
        events.extend(event for event in legacy if event.get('eventId') not in known)
        available = bool(events)
        # Historical tasks keep only facts that were actually saved, without fabricated verification stages.
        if not managed and not legacy:
            events.append({'eventId': identifier + '-created', 'time': job['createdAt'], 'stage': 'created',
                           'level': 'info', 'message': '部署任务已创建', 'detail': ''})
            events.append({'eventId': identifier + '-result', 'time': job['updatedAt'], 'stage': job['status'],
                           'level': 'error' if job['status'] == 'failed' else 'info', 'message': job['message'], 'detail': ''})
        events.sort(key=lambda item: (item['time'], item.get('_sequence', 0)))
        events = [{key: value for key, value in event.items() if not key.startswith('_')} for event in events]
        return {**view(job), 'events': events, 'historyAvailable': available,
                'finishedAt': job['updatedAt'] if job['status'] in ('success', 'failed', 'superseded') else None}
