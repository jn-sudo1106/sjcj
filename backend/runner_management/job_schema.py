"""Shared durable task storage; delivery is part of a deployment task."""

GENERATION_COLUMNS = ('task_id', 'source_id', 'flow_id', 'config_id', 'interface_id', 'status',
                      'server_id', 'created_at', 'lease_until', 'payload')
DEPLOYMENT_COLUMNS = ('job_id', 'source_id', 'flow_id', 'step_id', 'config_id', 'config_type', 'environment',
                      'archive_id', 'task_id', 'git_commit', 'status', 'runner_id', 'deployment_id',
                      'delivery_id', 'created_at', 'updated_at', 'payload')

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
 job_type TEXT NOT NULL CHECK(job_type IN ('generation','deployment')), job_id TEXT NOT NULL,
 source_id TEXT NOT NULL DEFAULT '', flow_id TEXT NOT NULL DEFAULT '', step_id TEXT NOT NULL DEFAULT '',
 config_id TEXT NOT NULL DEFAULT '', config_type TEXT NOT NULL DEFAULT '', environment TEXT NOT NULL DEFAULT '',
 archive_id TEXT NOT NULL DEFAULT '', parent_task_id TEXT NOT NULL DEFAULT '', git_commit TEXT NOT NULL DEFAULT '',
 executor_id TEXT NOT NULL DEFAULT '', server_id TEXT NOT NULL DEFAULT '',
 delivery_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '', lease_until REAL NOT NULL DEFAULT 0,
 payload TEXT NOT NULL, PRIMARY KEY(job_type,job_id)
);
"""
SQLITE_INDEXES = """
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(job_type,status,executor_id,created_at);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(job_type,config_id,environment,created_at);
CREATE INDEX IF NOT EXISTS jobs_source ON jobs(job_type,source_id,created_at);
CREATE INDEX IF NOT EXISTS jobs_archive ON jobs(job_type,archive_id,environment);
"""

MYSQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS ce_runner_jobs (
 job_type VARCHAR(20) NOT NULL, job_id VARCHAR(80) NOT NULL,
 source_id VARCHAR(80) NOT NULL DEFAULT '', flow_id VARCHAR(80) NOT NULL DEFAULT '', step_id VARCHAR(80) NOT NULL DEFAULT '',
 config_id VARCHAR(80) NOT NULL DEFAULT '', config_type VARCHAR(40) NOT NULL DEFAULT '', environment VARCHAR(20) NOT NULL DEFAULT '',
 archive_id VARCHAR(80) NOT NULL DEFAULT '', parent_task_id VARCHAR(80) NOT NULL DEFAULT '', git_commit VARCHAR(80) NOT NULL DEFAULT '',
 executor_id VARCHAR(80) NOT NULL DEFAULT '', server_id VARCHAR(80) NOT NULL DEFAULT '',
 delivery_id VARCHAR(80) NOT NULL DEFAULT '', status VARCHAR(30) NOT NULL,
 created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL DEFAULT '', lease_until DOUBLE NOT NULL DEFAULT 0,
 payload LONGTEXT NOT NULL, PRIMARY KEY(job_type,job_id),
 INDEX jobs_pending(job_type,status,executor_id,created_at), INDEX jobs_owner(job_type,config_id,environment,created_at),
 INDEX jobs_source(job_type,source_id,created_at), INDEX jobs_archive(job_type,archive_id,environment)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


def merged_row(kind, row):
    result = dict(row)
    if kind == 'generation':
        result['job_id'] = result.pop('task_id')
    else:
        result['parent_task_id'] = result.pop('task_id')
    result['job_type'] = kind
    from .job_execution_schema import execution_fields
    return execution_fields(result)


def copy_rows(execute, kind, rows):
    for row in rows:
        values = merged_row(kind, row)
        execute('INSERT OR IGNORE INTO jobs (' + ','.join(values) + ') VALUES (' + ','.join('?' for _ in values) + ')', tuple(values.values()))
        stored = execute('SELECT * FROM jobs WHERE job_type=? AND job_id=?', (kind, values['job_id'])).fetchone()
        if not stored or any(stored[key] != value for key, value in values.items()):
            raise ValueError('任务表合并校验失败：' + kind + '/' + values['job_id'])


def sqlite_migrate(db):
    from .job_execution_schema import sqlite_migrate as migrate_execution
    migrate_execution(db, SQLITE_SCHEMA)
    for kind, table in (('generation', 'generation_jobs'), ('deployment', 'deployment_jobs')):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        copy_rows(db.execute, kind, db.execute('SELECT * FROM ' + table).fetchall())
        db.execute('DROP TABLE ' + table)
    for statement in SQLITE_INDEXES.split(';'):
        if statement.strip():
            db.execute(statement)


def mysql_migrate(cursor):
    from .job_execution_schema import mysql_migrate as migrate_execution
    migrate_execution(cursor)
    class Result:
        def fetchone(self):
            row = cursor.fetchone()
            return dict(zip([item[0] for item in cursor.description], row)) if row else None

    def execute(sql, values=()):
        import re
        cursor.execute(re.sub(r'\bjobs\b', 'ce_runner_jobs', sql).replace('?', '%s').replace('INSERT OR IGNORE', 'INSERT IGNORE'), values)
        return Result()

    copied = []
    for kind, table in (('generation', 'ce_runner_generation_jobs'), ('deployment', 'ce_runner_deployment_jobs')):
        cursor.execute('SELECT COUNT(*) FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s', (table,))
        if not cursor.fetchone()[0]:
            continue
        cursor.execute('SELECT * FROM ' + table)
        names = [item[0] for item in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
        copy_rows(execute, kind, rows)
        copied.append(table)
    cursor.connection.commit()
    for table in copied:
        cursor.execute('DROP TABLE ' + table)
