"""Merge the former script-version extension into the release record."""

SQLITE_COLUMNS = {
    'artifact_path': "TEXT NOT NULL DEFAULT ''",
    'code_id': "TEXT NOT NULL DEFAULT ''",
    'delivery_path': "TEXT NOT NULL DEFAULT ''",
    'prompt': "TEXT NOT NULL DEFAULT ''", 'system_prompt': "TEXT NOT NULL DEFAULT ''",
    'prompt_template_id': 'INTEGER NOT NULL DEFAULT 0',
    'source_url': "TEXT NOT NULL DEFAULT ''", 'repo_id': "TEXT NOT NULL DEFAULT ''",
    'source_repo_path': "TEXT NOT NULL DEFAULT ''", 'source_git_commit': "TEXT NOT NULL DEFAULT ''",
    'layout_json': "TEXT NOT NULL DEFAULT ''", 'repository_directory_id': "TEXT NOT NULL DEFAULT ''",
    'repository_storage_path': "TEXT NOT NULL DEFAULT ''",
}
MYSQL_COLUMNS = {
    'artifact_path': "VARCHAR(1024) NOT NULL DEFAULT ''",
    'code_id': "VARCHAR(80) NOT NULL DEFAULT ''", 'delivery_path': "VARCHAR(512) NOT NULL DEFAULT ''",
    'prompt': 'TEXT NULL', 'system_prompt': 'TEXT NULL', 'prompt_template_id': 'BIGINT NOT NULL DEFAULT 0',
    'source_url': 'TEXT NULL', 'repo_id': "VARCHAR(80) NOT NULL DEFAULT ''",
    'source_repo_path': "VARCHAR(512) NOT NULL DEFAULT ''", 'source_git_commit': "VARCHAR(80) NOT NULL DEFAULT ''",
    'layout_json': 'LONGTEXT NULL', 'repository_directory_id': "VARCHAR(80) NOT NULL DEFAULT ''",
    'repository_storage_path': "VARCHAR(512) NOT NULL DEFAULT ''",
}
VERSION_COLUMNS = tuple(name for name in SQLITE_COLUMNS if name != 'artifact_path')
SHARED_COLUMNS = ('git_commit', 'git_url', 'published_at')


def version_values(row, asset_repo=''):
    values = {name: row[name] if name in row.keys() and row[name] is not None else
              0 if name == 'prompt_template_id' else '' for name in (*VERSION_COLUMNS, *SHARED_COLUMNS)}
    values['repo_id'] = values['repo_id'] or asset_repo
    return values


def merge_rows(execute, rows):
    for row in rows:
        release = execute('SELECT kind,code_id FROM releases WHERE digest=?', (row['digest'],)).fetchone()
        if not release or release['kind'] != 'script' or release['code_id'] not in ('', row['code_id']):
            raise ValueError('代码版本无法合并：发布包不存在、类型错误或资产冲突')
        asset = execute('SELECT repo_id FROM code_assets WHERE code_id=?', (row['code_id'],)).fetchone()
        if not asset:
            raise ValueError('代码版本无法合并：代码资产不存在')
        values = version_values(row, asset['repo_id'])
        execute('UPDATE releases SET ' + ','.join(name + '=?' for name in values) + ' WHERE digest=?',
                (*values.values(), row['digest']))
        stored = execute('SELECT * FROM releases WHERE digest=?', (row['digest'],)).fetchone()
        if any(stored[name] != value for name, value in values.items()):
            raise ValueError('代码版本合并后校验失败')


def sqlite_migrate(db):
    # Store initialization is the only migration boundary. Keep DDL and rows in
    # the same SQLite transaction; never disable foreign key enforcement.
    existing = {row['name'] for row in db.execute('PRAGMA table_info(releases)')}
    for name, definition in SQLITE_COLUMNS.items():
        if name not in existing:
            db.execute(f'ALTER TABLE releases ADD COLUMN {name} {definition}')
    legacy = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='code_versions'").fetchone()
    if legacy:
        merge_rows(db.execute, db.execute('SELECT * FROM code_versions').fetchall())
    references = db.execute('PRAGMA foreign_key_list(code_runtime_bindings)').fetchall()
    if any(row['table'] == 'code_versions' for row in references):
        db.execute('CREATE TABLE code_runtime_bindings_merged ('
                   'environment TEXT NOT NULL,config_id TEXT NOT NULL,queue_name TEXT NOT NULL,'
                   'site_host TEXT NOT NULL,digest TEXT NOT NULL REFERENCES releases(digest),'
                   'PRIMARY KEY(environment,config_id,queue_name,site_host))')
        db.execute('INSERT INTO code_runtime_bindings_merged SELECT * FROM code_runtime_bindings')
        db.execute('DROP TABLE code_runtime_bindings')
        db.execute('ALTER TABLE code_runtime_bindings_merged RENAME TO code_runtime_bindings')
    if legacy:
        db.execute('DROP TABLE code_versions')
    db.execute('CREATE INDEX IF NOT EXISTS release_code_version ON releases(code_id,published_at)')
    db.execute('CREATE INDEX IF NOT EXISTS release_repo ON releases(repo_id)')


def mysql_migrate(cursor):
    # MySQL DDL commits implicitly. Copy and verify before switching the FK and
    # dropping the old table. Every step can safely resume after interruption.
    cursor.execute('SHOW COLUMNS FROM ce_runner_releases')
    existing = {row[0] for row in cursor.fetchall()}
    for name, definition in MYSQL_COLUMNS.items():
        if name not in existing:
            cursor.execute(f'ALTER TABLE ce_runner_releases ADD COLUMN {name} {definition}')
    cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ce_runner_code_versions'")
    legacy = bool(cursor.fetchone()[0])
    if legacy:
        cursor.execute('SELECT * FROM ce_runner_code_versions')
        names = [item[0] for item in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]

        class Result:
            def fetchone(self):
                row = cursor.fetchone()
                return dict(zip([item[0] for item in cursor.description], row)) if row else None

        def execute(sql, values=()):
            import re
            sql = re.sub(r'\b(releases|code_assets)\b', lambda match: 'ce_runner_' + match.group(), sql)
            cursor.execute(sql.replace('?', '%s'), values)
            return Result()

        merge_rows(execute, rows)
        cursor.connection.commit()
    cursor.execute("SELECT CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE "
                   "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ce_runner_code_runtime_bindings' AND COLUMN_NAME='digest'")
    refs = cursor.fetchall()
    if not any(row[1] == 'ce_runner_releases' for row in refs):
        # Add the new constraint before removing the old one, without a window
        # in which new binding rows could reference an unknown release.
        cursor.execute('ALTER TABLE ce_runner_code_runtime_bindings ADD CONSTRAINT runtime_release_digest '
                       'FOREIGN KEY (digest) REFERENCES ce_runner_releases(digest)')
    for constraint, target in refs:
        if target == 'ce_runner_code_versions':
            cursor.execute('ALTER TABLE ce_runner_code_runtime_bindings DROP FOREIGN KEY `' + constraint.replace('`', '``') + '`')
    if legacy:
        cursor.execute('DROP TABLE ce_runner_code_versions')
    cursor.execute('SHOW INDEX FROM ce_runner_releases')
    indexes = {row[2] for row in cursor.fetchall()}
    if 'release_code_version' not in indexes:
        cursor.execute('CREATE INDEX release_code_version ON ce_runner_releases(code_id,published_at)')
    if 'release_repo' not in indexes:
        cursor.execute('CREATE INDEX release_repo ON ce_runner_releases(repo_id)')
