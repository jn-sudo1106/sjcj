"""Rename the output table while retaining its rows, keys and references."""


def sqlite_rename(db):
    names = {row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('task_artifacts','artifacts')")}
    if names == {'task_artifacts', 'artifacts'}:
        raise ValueError('产出物新旧表同时存在，请核对后再迁移')
    if 'task_artifacts' in names:
        db.execute('ALTER TABLE task_artifacts RENAME TO artifacts')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('产出物表改名后的外键校验失败')


def mysql_rename(cursor):
    cursor.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() "
                   "AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME IN ('task_artifacts','ce_runner_artifacts')")
    names = {row[0] for row in cursor.fetchall()}
    if names == {'task_artifacts', 'ce_runner_artifacts'}:
        raise ValueError('产出物新旧表同时存在，请核对后再迁移')
    if 'task_artifacts' in names:
        cursor.execute('RENAME TABLE task_artifacts TO ce_runner_artifacts')
    if names:
        # MariaDB/MySQL retarget foreign keys on RENAME, but not view SQL.
        # Repair views before Store introspects them, also after an interrupted
        # migration in which the physical table was already renamed.
        cursor.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() "
                       "AND TABLE_TYPE='VIEW' AND TABLE_NAME IN ('ce_runner_code_assets','ce_runner_releases')")
        views = {row[0] for row in cursor.fetchall()}
        from .task_artifacts import views as definitions
        for name, query in definitions(mysql=True):
            if name in views:
                cursor.execute('CREATE OR REPLACE VIEW ' + name + ' AS ' + query)
