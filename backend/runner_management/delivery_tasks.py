"""File delivery is an execution attempt of a deployment task."""
import hashlib
import json
import uuid
from datetime import datetime, timezone

FIELDS = ('delivery_id', 'binding_type', 'owner_key', 'owner_id', 'runner_id',
          'layout_revision', 'artifact_digest', 'signature', 'target_path', 'status',
          'requested_at', 'started_at', 'finished_at', 'error', 'installed_path')
JOB_FIELDS = ('job_type', 'job_id', 'source_id', 'flow_id', 'step_id', 'config_id', 'config_type',
              'environment', 'archive_id', 'parent_task_id', 'git_commit', 'executor_id', 'server_id',
              'delivery_id', 'status', 'created_at', 'updated_at', 'lease_until', 'payload')


def parent_map(db):
    result = {}
    for row in db.execute("SELECT * FROM jobs WHERE job_type='deployment' ORDER BY created_at,job_id").fetchall():
        data = json.loads(row['payload'])
        for identifier in set([*(data.get('deliveryHistory') or []), row['delivery_id']]) - {'', None}:
            result.setdefault(identifier, {})[row['job_id']] = dict(row)
    return result


def attach(db, identifier, record, job=None):
    stored = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?", (identifier,)).fetchone()
    if not stored:
        raise ValueError('部署任务不存在')
    saved = json.loads(stored['payload'])
    saved.setdefault('deliveryAttempts', {})[record['delivery_id']] = dict(record)
    db.execute("UPDATE jobs SET payload=? WHERE job_type='deployment' AND job_id=?",
               (json.dumps(saved, ensure_ascii=False, separators=(',', ':')), identifier))
    if job is not None:
        job.setdefault('deliveryAttempts', {})[record['delivery_id']] = dict(record)


def manual_job(db, record, context=None):
    """Give an independent historical/manual delivery a normal deployment task."""
    context = context or {}
    snapshot = db.execute('SELECT snapshot_json FROM runtime_operations WHERE record_id=?', (record['delivery_id'],)).fetchone()
    snapshot = json.loads(snapshot['snapshot_json']) if snapshot else {}
    layout = context.get('layout') or {}
    source = snapshot.get('sourceNode') or layout.get('sourceNode') or {}
    source = source if isinstance(source, dict) else {}
    runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (record['runner_id'],)).fetchone()
    if not runner:
        raise ValueError('部署任务的 Runner 不存在')
    identifier = record['delivery_id']
    if db.execute("SELECT 1 FROM jobs WHERE job_type='deployment' AND job_id=?", (identifier,)).fetchone():
        identifier = hashlib.sha256(('manual-deployment:' + identifier).encode()).hexdigest()[:32]
        if db.execute("SELECT 1 FROM jobs WHERE job_type='deployment' AND job_id=?", (identifier,)).fetchone():
            raise ValueError('历史部署任务 ID 冲突')
    status = 'delivering' if record['status'] in ('pending', 'running') else record['status']
    updated = record['finished_at'] or record['started_at'] or record['requested_at']
    owner = record['owner_id']
    job = dict(jobId=identifier, sourceId=str(source.get('sourceId') or ''), flowId=str(source.get('flowId') or ''),
               stepId=str(source.get('stepId') or ''), configId=str(snapshot.get('configId') or layout.get('configId') or ''),
               configType=str(layout.get('configType') or ''), environment=snapshot.get('environment') or layout.get('deploymentEnvironment') or 'default',
               archiveId='', taskId='', gitCommit='', status=status, runnerId=record['runner_id'],
               deploymentId=owner if record['binding_type']=='deployment' and len(owner)<=80 else '',
               deliveryOwnerId=owner, deliveryBindingType=record['binding_type'], deliveryId=record['delivery_id'],
               runtimeId='', targetPath=record['target_path'], installedPath=record['installed_path'],
               artifactDigest=record['artifact_digest'], createdAt=record['requested_at'], updatedAt=updated,
               automatic=False, manualDelivery=True, parentJobId='', rollback=False, taskCreatedAt=record['requested_at'],
               archive={}, deploymentScope='configuration', deliveryAttempts={record['delivery_id']: dict(record)},
               runnerName=runner['name'], runnerIp=runner['ip_address'], instanceDirectory=runner['install_directory'],
               message=record['error'] or ('代码部署完成' if status=='success' else '等待 Runner 领取并部署'))
    sources = context.get('sources') or snapshot.get('sources') or []
    commits = {item.get('gitCommit') for item in sources if isinstance(item, dict) and item.get('gitCommit')}
    if len(commits) == 1:
        job['gitCommit'] = next(iter(commits))
    if context.get('files') is not None:
        from .deployment_file_summary import summarize
        job['fileSummary'] = summarize(context['files'])
    values = dict.fromkeys(JOB_FIELDS, '')
    values.update(job_type='deployment', job_id=identifier, source_id=job['sourceId'], flow_id=job['flowId'],
                  step_id=job['stepId'], config_id=job['configId'], config_type=job['configType'], environment=job['environment'],
                  executor_id=job['deploymentId'], server_id=record['runner_id'], delivery_id=record['delivery_id'], status=status, git_commit=job['gitCommit'],
                  created_at=record['requested_at'], updated_at=updated, lease_until=0,
                  payload=json.dumps(job, ensure_ascii=False, separators=(',', ':')))
    db.execute('INSERT INTO jobs (' + ','.join(JOB_FIELDS) + ') VALUES (' + ','.join('?' for _ in JOB_FIELDS) + ')',
               tuple(values[field] for field in JOB_FIELDS))
    return job


def create(db, record, *, parent_job=None, context=None):
    if not db.execute('SELECT 1 FROM runners WHERE runner_id=?', (record['runner_id'],)).fetchone():
        raise ValueError('部署任务的 Runner 不存在')
    if owner(db, record['delivery_id']):
        raise ValueError('部署执行记录 ID 已存在')
    if parent_job is not None:
        if parent_job.get('runnerId') not in ('', None, record['runner_id']):
            raise ValueError('部署任务的目标 Runner 不一致')
        attach(db, parent_job['jobId'], record, parent_job)
        job = parent_job
    else:
        job = manual_job(db, record, context)
        from .deployment_history import record as record_event
        from .deployment_log_storage import flush
        record_event(job, 'created', '部署任务已创建，等待 Runner 领取', date=job['createdAt'])
        flush(db, job)
    from .task_artifacts import sync_delivery
    sync_delivery(db, {'jobId': job['jobId'], 'deliveryId': record['delivery_id'], 'createdAt': job['createdAt']})
    return job


def owner(db, identifier):
    from .store import MySqlConnection
    expression = "JSON_EXTRACT(payload,?)" if isinstance(db, MySqlConnection) else 'json_extract(payload,?)'
    path = '$.deliveryAttempts.' + json.dumps(identifier)
    return db.execute("SELECT job_id,payload FROM jobs WHERE job_type='deployment' AND " + expression + ' IS NOT NULL', (path,)).fetchone()


def update(db, identifier, *, status, expected_status=None, **changes):
    if set(changes) - {'started_at', 'finished_at', 'error', 'installed_path'}:
        raise ValueError('部署任务更新字段无效')
    stored = owner(db, identifier)
    if not stored:
        raise ValueError('部署任务不存在')
    job = json.loads(stored['payload'])
    attempt = job['deliveryAttempts'][identifier]
    attempt.update(status=status, **changes)
    if job.get('deliveryId') == identifier:
        job.update(status='delivering' if status in ('pending', 'running') else status,
                   installedPath=attempt['installed_path'], updatedAt=datetime.now(timezone.utc).isoformat(timespec='microseconds'),
                   message=attempt['error'] or ('代码部署完成' if status=='success' else 'Runner 正在部署代码'))
        from .deployment_history import record
        record(job, status, job['message'], level='error' if status=='failed' else 'info', date=job['updatedAt'])
    from .store import MySqlConnection
    expression = "JSON_UNQUOTE(JSON_EXTRACT(payload,?))" if isinstance(db, MySqlConnection) else 'json_extract(payload,?)'
    path = '$.deliveryAttempts.' + json.dumps(identifier) + '.status'
    guard = ' AND ' + expression + '=?' if expected_status else ''
    from .deployment_log_storage import payload as task_payload, flush
    result = db.execute("UPDATE jobs SET status=?,updated_at=?,payload=? WHERE job_type='deployment' AND job_id=?" + guard,
                      (job.get('status', status), job.get('updatedAt', attempt['requested_at']),
                       json.dumps(task_payload(job), ensure_ascii=False, separators=(',', ':')), stored['job_id'],
                       *((path, expected_status) if expected_status else ())))
    if result.rowcount:
        flush(db, job)
        if status == 'success':
            from .deployment_outputs import record
            record(db, job, identifier)
    return result


def preserve_attempts(db, job):
    stored = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?", (job['jobId'],)).fetchone()
    attempts = json.loads(stored['payload']).get('deliveryAttempts') if stored else None
    if attempts:
        job['deliveryAttempts'] = {**job.get('deliveryAttempts', {}), **attempts}


def retry(db, job):
    from .server import now, ApiError
    from .directory_delivery import expire_deliveries
    expire_deliveries(db)
    previous = db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=?', (job['deliveryId'],)).fetchone()
    if not previous:
        raise ApiError('找不到上次部署内容，无法重试', 409)
    if db.execute("SELECT 1 FROM directory_deliveries WHERE runner_id=? AND owner_key=? AND status IN ('pending','running')", (previous['runner_id'], previous['owner_key'])).fetchone():
        raise ApiError('已有部署任务正在执行，请等待完成后再重试', 409)
    attempt = {**dict(previous), 'delivery_id': uuid.uuid4().hex, 'status': 'pending', 'requested_at': now(),
               'started_at': None, 'finished_at': None, 'error': '', 'installed_path': ''}
    create(db, attempt, parent_job=job)
    job['deliveryHistory'] = list(dict.fromkeys([*(job.get('deliveryHistory') or []), job['deliveryId']]))
    job.update(deliveryId=attempt['delivery_id'], status='delivering', updatedAt=attempt['requested_at'],
               installedPath='', message='等待 Runner 重新领取并部署')
    from .deployment_resources import persist
    persist(db, job)
    return job


def projection(mysql=False):
    if mysql:
        # MariaDB JSON_TABLE returns escaped backslashes for LONGTEXT columns.
        # Enumerate IDs there and decode scalar values explicitly, preserving
        # Windows paths and messages byte-for-byte across both database engines.
        columns = []
        for field in FIELDS:
            expression = "JSON_UNQUOTE(JSON_EXTRACT(j.payload,CONCAT('$.deliveryAttempts.\"',d.delivery_id,'\"." + field + "')))"
            if field in ('started_at', 'finished_at'):
                expression = "NULLIF(" + expression + ",'null')"
            columns.append(expression + ' AS ' + field)
        return ('SELECT ' + ','.join(columns) +
                " FROM ce_runner_jobs j JOIN JSON_TABLE(j.payload,'$.deliveryAttempts.*' COLUMNS("
                "delivery_id VARCHAR(80) PATH '$.delivery_id')) d ON 1=1 WHERE j.job_type='deployment'")
    return ('SELECT ' + ','.join("json_extract(d.value,'$." + field + "') AS " + field for field in FIELDS) +
            " FROM jobs j JOIN json_each(j.payload,'$.deliveryAttempts') d WHERE j.job_type='deployment'")
