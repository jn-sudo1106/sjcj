"""Merge delivery receipts into their deployment jobs, preserving every attempt."""
import json
from . import delivery_tasks as records


def copy_rows(db, rows):
    parents = records.parent_map(db)
    for row in rows:
        existing = records.owner(db, row['delivery_id'])
        if existing:
            saved = json.loads(existing['payload'])['deliveryAttempts'][row['delivery_id']]
            if saved != dict(row):
                raise ValueError('下发任务合并校验失败：' + row['delivery_id'])
            continue
        candidates = list(parents.get(row['delivery_id'], {}).values())
        if candidates:
            candidates.sort(key=lambda job: (job['delivery_id'] != row['delivery_id'], job['created_at'], job['job_id']))
            records.attach(db, candidates[0]['job_id'], row)
        else:
            records.manual_job(db, row)


def sqlite_migrate(db, *, backfill=True):
    legacy = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='directory_deliveries'").fetchone()
    if legacy:
        rows = db.execute('SELECT * FROM directory_deliveries').fetchall()
        copy_rows(db, rows)
        actual = {row['delivery_id']: dict(row) for row in db.execute(records.projection())}
        for row in rows:
            stored = actual.get(row['delivery_id']) or {}
            different = [name for name, value in dict(row).items() if stored.get(name) != value]
            if different:
                raise ValueError('下发任务合并校验失败：' + ','.join(different))
        db.execute('DROP TABLE directory_deliveries')
    db.execute('CREATE VIEW IF NOT EXISTS directory_deliveries AS ' + records.projection())
    sqlite_triggers(db)
    if legacy and backfill:
        backfill_artifacts(db)
    return bool(legacy)


def backfill_artifacts(db):
    from .task_artifacts import sync_delivery
    for row in db.execute("SELECT payload FROM jobs WHERE job_type='deployment'").fetchall():
        job = json.loads(row['payload'])
        if job.get('manualDelivery'):
            sync_delivery(db, job)


def sqlite_triggers(db):
    metadata = 'json_object(' + ','.join("'" + name + "',NEW." + name for name in records.FIELDS) + ')'
    path = "'$.deliveryAttempts.\"'||NEW.delivery_id||'\"'"
    old_path = "'$.deliveryAttempts.\"'||OLD.delivery_id||'\"'"
    job = ("json_object('jobId',NEW.delivery_id,'deliveryId',NEW.delivery_id,'deploymentId',NEW.owner_id,"
           "'runnerId',NEW.runner_id,'manualDelivery',json('true'),'status',NEW.status,'createdAt',NEW.requested_at,"
           "'updatedAt',NEW.requested_at,'message',NEW.error,'deliveryAttempts',json_object(NEW.delivery_id," + metadata + '))')
    db.execute('CREATE TRIGGER IF NOT EXISTS deployment_attempt_insert INSTEAD OF INSERT ON directory_deliveries BEGIN '
               "INSERT INTO jobs(job_type,job_id,executor_id,server_id,delivery_id,status,created_at,updated_at,payload) VALUES("
               "'deployment',NEW.delivery_id,NEW.owner_id,NEW.runner_id,NEW.delivery_id,NEW.status,NEW.requested_at,NEW.requested_at," + job + '); END')
    db.execute('CREATE TRIGGER IF NOT EXISTS deployment_attempt_update INSTEAD OF UPDATE ON directory_deliveries BEGIN '
               'UPDATE jobs SET payload=json_set(payload,' + path + ',' + metadata + ") WHERE job_type='deployment' AND json_type(payload," + old_path + ') IS NOT NULL; END')
    db.execute('CREATE TRIGGER IF NOT EXISTS deployment_attempt_delete INSTEAD OF DELETE ON directory_deliveries BEGIN '
               'UPDATE jobs SET payload=json_remove(payload,' + old_path + ") WHERE job_type='deployment' AND json_type(payload," + old_path + ') IS NOT NULL; END')


def mysql_migrate(cursor, *, backfill=True):
    from .store import MySqlConnection
    db = MySqlConnection(cursor.connection)
    cursor.execute("SELECT TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ce_runner_directory_deliveries'")
    row = cursor.fetchone()
    legacy = row and row[0] == 'BASE TABLE'
    if legacy:
        rows = db.execute('SELECT * FROM directory_deliveries').fetchall()
        copy_rows(db, rows)
        cursor.execute(records.projection(mysql=True))
        names = [item[0] for item in cursor.description]
        actual = {row['delivery_id']: row for row in (dict(zip(names, values)) for values in cursor.fetchall())}
        for row in rows:
            stored = actual.get(row['delivery_id']) or {}
            different = [name for name, value in row.items() if stored.get(name) != value]
            if different:
                raise ValueError('下发任务合并校验失败：' + ','.join(different))
        cursor.connection.commit()
        cursor.execute('DROP TABLE ce_runner_directory_deliveries')
    cursor.execute('CREATE OR REPLACE VIEW ce_runner_directory_deliveries AS ' + records.projection(mysql=True))
    if legacy and backfill:
        backfill_artifacts(db)
    return bool(legacy)
