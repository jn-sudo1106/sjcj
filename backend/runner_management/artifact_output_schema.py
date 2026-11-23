"""Add queryable node context and output inventory without another output table."""
COLUMNS = ('source_id', 'flow_id', 'config_id', 'output_files')


def sqlite_migrate(db):
    existing = {row['name'] for row in db.execute('PRAGMA table_info(artifacts)')}
    for name in COLUMNS:
        if name not in existing:
            db.execute('ALTER TABLE artifacts ADD COLUMN ' + name + " TEXT NOT NULL DEFAULT '" + ('[]' if name == 'output_files' else '') + "'")
    db.execute('CREATE INDEX IF NOT EXISTS artifact_node_outputs ON artifacts(artifact_type,source_id,flow_id,config_id)')


def mysql_migrate(cursor):
    cursor.execute('SHOW COLUMNS FROM ce_runner_artifacts')
    existing = {row[0] for row in cursor.fetchall()}
    for name in COLUMNS:
        if name not in existing:
            definition = "LONGTEXT NOT NULL DEFAULT '[]'" if name == 'output_files' else "VARCHAR(80) NOT NULL DEFAULT ''"
            cursor.execute('ALTER TABLE ce_runner_artifacts ADD COLUMN ' + name + ' ' + definition)
    cursor.execute("SHOW INDEX FROM ce_runner_artifacts WHERE Key_name='artifact_node_outputs'")
    if not cursor.fetchone():
        cursor.execute('CREATE INDEX artifact_node_outputs ON ce_runner_artifacts(artifact_type,source_id,flow_id,config_id)')
