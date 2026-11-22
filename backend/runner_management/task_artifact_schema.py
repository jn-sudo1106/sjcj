"""Verified migration of asset/version storage into task_artifacts."""
from . import task_artifacts as records

SQLITE_SCHEMA = '''CREATE TABLE IF NOT EXISTS task_artifacts (
 artifact_id TEXT PRIMARY KEY, artifact_type TEXT NOT NULL,
 task_type TEXT, task_id TEXT, name TEXT NOT NULL DEFAULT '', machine_path TEXT NOT NULL DEFAULT '',
 repo_id TEXT NOT NULL DEFAULT '', git_path TEXT NOT NULL DEFAULT '', git_commit TEXT NOT NULL DEFAULT '',
 sha256 TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
 FOREIGN KEY(task_type,task_id) REFERENCES jobs(job_type,job_id) ON DELETE SET NULL,
 CHECK ((task_type IS NULL)=(task_id IS NULL))
)'''
MYSQL_SCHEMA = '''CREATE TABLE IF NOT EXISTS task_artifacts (
 artifact_id VARCHAR(128) PRIMARY KEY, artifact_type VARCHAR(30) NOT NULL,
 task_type VARCHAR(20) NULL, task_id VARCHAR(80) NULL, name VARCHAR(512) NOT NULL DEFAULT '',
 machine_path VARCHAR(2048) NOT NULL DEFAULT '', repo_id VARCHAR(80) NOT NULL DEFAULT '',
 git_path VARCHAR(2048) NOT NULL DEFAULT '', git_commit VARCHAR(80) NOT NULL DEFAULT '',
 sha256 VARCHAR(64) NOT NULL DEFAULT '', created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
 payload LONGTEXT NOT NULL,
 FOREIGN KEY(task_type,task_id) REFERENCES ce_runner_jobs(job_type,job_id) ON DELETE SET NULL,
 INDEX task_artifact_task(task_type,task_id), INDEX task_artifact_kind(artifact_type),
 INDEX task_artifact_repo(repo_id), INDEX task_artifact_hash(sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'''


def copy(db, assets, releases):
    for row in assets:
        records.save_asset(db, dict(row))
    for row in releases:
        records.save_release(db, dict(row), insert_only=True)
    # Compare complete projected records before removing either source table.
    for rows, fields, identity, prefix in ((assets, records.ASSET_FIELDS, 'code_id', 'asset:'),
                                           (releases, records.RELEASE_FIELDS, 'digest', '')):
        import json
        for row in rows:
            stored = db.execute('SELECT payload FROM task_artifacts WHERE artifact_id=?', (prefix + row[identity],)).fetchone()
            metadata = json.loads(stored['payload']) if stored else {}
            if any(metadata.get(name) != row[name] for name in fields):
                raise ValueError('产出物迁移校验失败：' + prefix + row[identity])


def sqlite_migrate(db):
    db.execute(SQLITE_SCHEMA)
    legacy = {row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('code_assets','releases')")}
    assets = db.execute('SELECT * FROM code_assets').fetchall() if 'code_assets' in legacy else []
    releases = db.execute('SELECT * FROM releases').fetchall() if 'releases' in legacy else []
    copy(db, assets, releases)
    for table, field in (('assignments', 'release_digest'), ('code_runtime_bindings', 'digest')):
        refs = db.execute('PRAGMA foreign_key_list(' + table + ')').fetchall()
        if not any(row['table'] == 'releases' for row in refs):
            continue
        ddl = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()['sql']
        import re
        ddl = re.sub(r'(?i)REFERENCES\s+releases\s*\(digest\)', 'REFERENCES task_artifacts(artifact_id)', ddl)
        ddl = re.sub(r'(?i)^CREATE TABLE\s+"?' + table + r'"?', 'CREATE TABLE ' + table + '_artifact_merge', ddl, count=1)
        db.execute(ddl)
        db.execute('INSERT INTO ' + table + '_artifact_merge SELECT * FROM ' + table)
        db.execute('DROP TABLE ' + table)
        db.execute('ALTER TABLE ' + table + '_artifact_merge RENAME TO ' + table)
    for table in legacy:
        db.execute('DROP TABLE ' + table)
    for name, query in records.views():
        db.execute('CREATE VIEW IF NOT EXISTS ' + name + ' AS ' + query)
    for name, fields in (('code_assets', records.ASSET_FIELDS), ('releases', records.RELEASE_FIELDS)):
        sqlite_compatibility_triggers(db, name, fields)
    for name, columns in (('task_artifact_task', 'task_type,task_id'), ('task_artifact_kind', 'artifact_type'),
                           ('task_artifact_repo', 'repo_id'), ('task_artifact_hash', 'sha256')):
        db.execute('CREATE INDEX IF NOT EXISTS ' + name + ' ON task_artifacts(' + columns + ')')
    if legacy:
        records.backfill_outputs(db)


def sqlite_compatibility_triggers(db, view, fields):
    """Local legacy SQL clients keep working; production writes use helpers."""
    asset = view == 'code_assets'
    identity = "'asset:'||NEW.code_id" if asset else 'NEW.digest'
    old_identity = "'asset:'||OLD.code_id" if asset else 'OLD.digest'
    kind = 'code_identity' if asset else 'package'
    metadata = 'json_object(' + ','.join("'" + name + "',COALESCE(NEW." + name +
                           (',0)' if name == 'prompt_template_id' else ",'')") for name in fields) + ')'
    values = (identity, "'" + kind + "'", 'NULL', 'NULL',
              'COALESCE(NEW.queue_name,\'\')' if asset else "COALESCE(NEW.name,'')",
              "''" if asset else "COALESCE(NEW.artifact_path,'')", "COALESCE(NEW.repo_id,'')",
              "COALESCE(NEW.storage_path,'')" if asset else "COALESCE(NEW.repository_storage_path,'')",
              "''" if asset else "COALESCE(NEW.git_commit,'')",
              "''" if asset else "replace(NEW.digest,'sha256:','')",
              "COALESCE(NEW.created_at,'')" if asset else "COALESCE(NEW.published_at,'')",
              "strftime('%Y-%m-%dT%H:%M:%fZ','now')", metadata)
    db.execute('CREATE TRIGGER IF NOT EXISTS ' + view + '_artifact_insert INSTEAD OF INSERT ON ' + view +
               ' BEGIN INSERT OR IGNORE INTO task_artifacts (' + ','.join(records.FIELDS) + ') VALUES (' + ','.join(values) + '); END')
    assignments = ','.join(field + '=' + value for field, value in zip(records.FIELDS, values)
                           if field not in ('task_type', 'task_id', 'created_at'))
    db.execute('CREATE TRIGGER IF NOT EXISTS ' + view + '_artifact_update INSTEAD OF UPDATE ON ' + view +
               ' BEGIN UPDATE task_artifacts SET ' + assignments + ' WHERE artifact_id=' + old_identity + '; END')
    db.execute('CREATE TRIGGER IF NOT EXISTS ' + view + '_artifact_delete INSTEAD OF DELETE ON ' + view +
               ' BEGIN DELETE FROM task_artifacts WHERE artifact_id=' + old_identity + '; END')


def mysql_migrate(cursor):
    from .store import MySqlConnection
    db = MySqlConnection(cursor.connection)
    cursor.execute(MYSQL_SCHEMA)
    cursor.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() "
                   "AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME IN ('ce_runner_code_assets','ce_runner_releases')")
    legacy = {row[0] for row in cursor.fetchall()}
    assets = db.execute('SELECT * FROM code_assets').fetchall() if 'ce_runner_code_assets' in legacy else []
    releases = db.execute('SELECT * FROM releases').fetchall() if 'ce_runner_releases' in legacy else []
    copy(db, assets, releases)
    cursor.connection.commit()
    for table, field in (('ce_runner_assignments', 'release_digest'), ('ce_runner_code_runtime_bindings', 'digest')):
        cursor.execute('SELECT CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE '
                       'WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s AND REFERENCED_TABLE_NAME IS NOT NULL', (table, field))
        refs = cursor.fetchall()
        if any(target == 'ce_runner_releases' for _, target in refs):
            if not any(target == 'task_artifacts' for _, target in refs):
                cursor.execute('ALTER TABLE ' + table + ' ADD FOREIGN KEY (' + field + ') REFERENCES task_artifacts(artifact_id)')
            for constraint, target in refs:
                if target == 'ce_runner_releases':
                    cursor.execute('ALTER TABLE ' + table + ' DROP FOREIGN KEY `' + constraint.replace('`', '``') + '`')
    for table in legacy:
        cursor.execute('DROP TABLE ' + table)
    for name, query in records.views(mysql=True):
        cursor.execute('CREATE OR REPLACE VIEW ' + name + ' AS ' + query)
    if legacy:
        records.backfill_outputs(db)
