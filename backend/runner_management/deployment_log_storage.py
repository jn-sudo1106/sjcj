"""Deployment execution events live in logs, linked to their executing task."""
import json
import uuid
from . import log_records

STATES = {'created': 'queued', 'retry': 'queued', 'queued': 'queued', 'requested': 'queued',
          'waiting_resource': 'waiting_resource', 'delivering': 'running', 'running': 'running', 'received': 'running',
          'directory-check': 'running', 'download': 'running', 'verify': 'running', 'install': 'running',
          'installed': 'success', 'success': 'success', 'failed': 'failed', 'superseded': 'superseded'}


def payload(job):
    # executionEvents is only an in-memory transaction buffer. Never write the
    # buffer into the task's parameters or return it from a list API.
    return {key: value for key, value in job.items() if key != 'executionEvents'}


def source_expression(db):
    from .store import MySqlConnection
    expression = "json_extract(payload,'$.origin')"
    return 'JSON_UNQUOTE(' + expression + ')' if isinstance(db, MySqlConnection) else expression


def flush(db, job, *, historical=False):
    """Flush within the task transaction; retries keep IDs and cannot duplicate."""
    from .runtime_history import redact
    for ordinal, event in enumerate(job.get('executionEvents') or []):
        if not isinstance(event, dict):
            raise ValueError('部署过程记录格式无效')
        identifier = event.get('eventId') or uuid.uuid5(uuid.NAMESPACE_URL, 'deployment-event:' + job['jobId'] + ':' +
                      str(ordinal) + ':' + json.dumps(event, ensure_ascii=False, sort_keys=True)).hex
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 64:
            raise ValueError('部署过程记录 ID 无效')
        stage = str(event.get('stage') or '')[:50]
        message = redact(event.get('message') or '')[:4000]
        details = {'stage': stage, 'level': str(event.get('level') or 'info'),
                   'detail': redact(event.get('detail') or '')[:32000], 'origin': 'management'}
        if event.get('attemptId'):
            details['attemptId'] = event['attemptId']
        existing = db.execute("SELECT * FROM logs WHERE log_type='event' AND log_id=?", (identifier,)).fetchone()
        if existing:
            old = json.loads(existing['payload'])
            if (existing['task_type'], existing['task_id'], existing['message'], existing['occurred_at']) != (
                    'deployment', job['jobId'], message, event.get('time') or '') or any(
                    old.get(key) != details[key] for key in ('stage', 'level', 'detail')):
                raise ValueError('部署过程记录迁移冲突')
            continue
        previous = db.execute("SELECT message,seq,payload FROM logs WHERE log_type='event' AND task_type='deployment' AND task_id=? AND " +
                              source_expression(db) + "='management' ORDER BY seq DESC,occurred_at DESC,log_id DESC LIMIT 1", (job['jobId'],)).fetchone()
        if previous and not historical and previous['message'] == message and all(
                json.loads(previous['payload']).get(key) == details.get(key) for key in ('stage', 'level', 'detail', 'attemptId')):
            continue
        value = log_records.empty('event', identifier)
        value.update(task_type='deployment', task_id=job['jobId'], record_id=job['jobId'],
                     occurred_at=event.get('time') or '', updated_at=event.get('time') or '',
                     message=message, status=STATES.get(stage, ''), seq=(previous['seq'] if previous else 0) + 1,
                     payload=log_records.encode(details))
        log_records.insert(db, value)


def migrate(db):
    """Move saved event arrays without changing task identity, status or result."""
    for row in db.execute("SELECT job_id,payload FROM jobs WHERE job_type='deployment'").fetchall():
        job = json.loads(row['payload'])
        if 'executionEvents' in job:
            if not isinstance(job['executionEvents'], list):
                raise ValueError('历史部署过程记录格式无效')
            flush(db, {**job, 'jobId': row['job_id']}, historical=True)
            db.execute("UPDATE jobs SET payload=? WHERE job_type='deployment' AND job_id=?",
                       (json.dumps(payload(job), ensure_ascii=False, separators=(',', ':')), row['job_id']))
        log_records.link_delivery(db, {**job, 'jobId': row['job_id']})


def events(db, job):
    """Read by task; explicit old receipt references keep legacy history visible."""
    identifiers = set(job.get('deliveryHistory') or []) | set((job.get('deliveryAttempts') or {}).keys())
    if job.get('deliveryId'):
        identifiers.add(job['deliveryId'])
    identifiers = sorted(value for value in identifiers if isinstance(value, str) and value)
    # Separate indexed reads avoid scanning the whole log table for a mixed OR.
    rows = db.execute("SELECT * FROM logs WHERE log_type='event' AND task_type='deployment' AND task_id=?",
                      (job['jobId'],)).fetchall()
    if identifiers:
        rows += db.execute("SELECT * FROM logs WHERE log_type='event' AND (task_type IS NULL OR task_type='deployment') AND record_id IN (" +
                           ','.join('?' for _ in identifiers) + ')', tuple(identifiers)).fetchall()
    rows = sorted({row['log_id']: row for row in rows}.values(), key=lambda row: (row['occurred_at'], row['seq'], row['log_id']))
    result, managed = [], False
    for row in rows:
        data = json.loads(row['payload'])
        managed = managed or data.get('origin') == 'management'
        result.append({'eventId': row['log_id'], 'time': row['occurred_at'], 'stage': data.get('stage', ''),
                       'level': data.get('level', ''), 'message': row['message'], 'detail': data.get('detail', ''),
                       '_sequence': row['seq']})
    return result, managed
