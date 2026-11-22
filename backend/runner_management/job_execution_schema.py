"""Normalize task execution targets and machine identities without changing payloads."""


def execution_fields(row):
    result = dict(row)
    kind = result['job_type']
    if kind not in ('generation', 'deployment'):
        raise ValueError('未知任务类型，无法迁移执行标识')
    legacy_executor = result.pop('interface_id', '') if kind == 'generation' else result.get('deployment_id', '')
    legacy_server = result.get('server_id', '') if kind == 'generation' else result.get('runner_id', '')
    if result.get('executor_id') and result['executor_id'] != legacy_executor:
        raise ValueError('任务执行标识冲突，请核对后再迁移')
    if kind == 'deployment' and result.get('server_id') not in (None, '', legacy_server):
        raise ValueError('任务执行机器冲突，请核对后再迁移')
    result['executor_id'] = legacy_executor or ''
    result['server_id'] = legacy_server or ''
    for name in ('interface_id', 'runner_id', 'deployment_id'):
        result.pop(name, None)
    return result


def sqlite_migrate(db, table_schema):
    columns = {row['name'] for row in db.execute('PRAGMA table_info(jobs)')}
    if not {'interface_id', 'runner_id', 'deployment_id'} & columns:
        return
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    rows = [execution_fields(row) for row in db.execute('SELECT * FROM jobs').fetchall()]
    db.execute(table_schema.strip().rstrip(';').replace('EXISTS jobs (', 'EXISTS jobs_executors (', 1))
    for row in rows:
        db.execute('INSERT INTO jobs_executors (' + ','.join(row) + ') VALUES (' + ','.join('?' for _ in row) + ')', tuple(row.values()))
        stored = db.execute('SELECT * FROM jobs_executors WHERE job_type=? AND job_id=?', (row['job_type'], row['job_id'])).fetchone()
        if any(stored[key] != value for key, value in row.items()):
            raise ValueError('任务执行标识迁移后校验失败')
    if db.execute('SELECT COUNT(*) n FROM jobs_executors').fetchone()['n'] != len(rows):
        raise ValueError('任务执行标识迁移后数量不一致')
    db.execute('DROP TABLE jobs')
    db.execute('ALTER TABLE jobs_executors RENAME TO jobs')


def mysql_migrate(cursor):
    cursor.execute('SHOW COLUMNS FROM ce_runner_jobs')
    columns = {row[0] for row in cursor.fetchall()}
    legacy = {'interface_id', 'runner_id', 'deployment_id'} & columns
    if not legacy:
        cursor.execute('SHOW INDEX FROM ce_runner_jobs')
        if not any(row[2] == 'jobs_pending' for row in cursor.fetchall()):
            cursor.execute('CREATE INDEX jobs_pending ON ce_runner_jobs(job_type,status,executor_id,created_at)')
        return
    if legacy != {'interface_id', 'runner_id', 'deployment_id'}:
        raise ValueError('任务执行标识旧字段不完整，请核对迁移状态')
    if 'executor_id' not in columns:
        cursor.execute("ALTER TABLE ce_runner_jobs ADD COLUMN executor_id VARCHAR(80) NOT NULL DEFAULT ''")
    cursor.execute('SELECT * FROM ce_runner_jobs')
    names = [item[0] for item in cursor.description]
    rows = [execution_fields(dict(zip(names, row))) for row in cursor.fetchall()]
    for row in rows:
        cursor.execute('UPDATE ce_runner_jobs SET executor_id=%s,server_id=%s WHERE job_type=%s AND job_id=%s',
                       (row['executor_id'], row['server_id'], row['job_type'], row['job_id']))
    cursor.execute('SELECT * FROM ce_runner_jobs')
    names = [item[0] for item in cursor.description]
    actual = {(row['job_type'], row['job_id']): row for row in (dict(zip(names, item)) for item in cursor.fetchall())}
    for row in rows:
        stored = actual[(row['job_type'], row['job_id'])]
        if any(stored[key] != value for key, value in row.items()):
            raise ValueError('任务执行标识迁移后校验失败')
    cursor.connection.commit()
    cursor.execute('SHOW INDEX FROM ce_runner_jobs')
    if any(row[2] == 'jobs_pending' for row in cursor.fetchall()):
        cursor.execute('DROP INDEX jobs_pending ON ce_runner_jobs')
    cursor.execute('ALTER TABLE ce_runner_jobs DROP COLUMN interface_id,DROP COLUMN runner_id,DROP COLUMN deployment_id')
    cursor.execute('CREATE INDEX jobs_pending ON ce_runner_jobs(job_type,status,executor_id,created_at)')
