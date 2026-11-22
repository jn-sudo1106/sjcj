"""Small SQLite store for the local Runner management service."""
from __future__ import annotations

import sqlite3
import os
import re
from contextlib import contextmanager
from pathlib import Path
from .runtime_schema import SQLITE_SCHEMA as LOG_SCHEMA, MYSQL_SCHEMA as MYSQL_LOG_SCHEMA, TABLES as LOG_TABLES
from .source_code_schema import SQLITE_SCHEMA as SOURCE_CODE_SCHEMA, MYSQL_SCHEMA as MYSQL_SOURCE_CODE_SCHEMA
from .job_schema import SQLITE_SCHEMA as DEPLOYMENT_SCHEMA, MYSQL_SCHEMA as MYSQL_DEPLOYMENT_SCHEMA


SCHEMA = """
CREATE TABLE IF NOT EXISTS runners (
    runner_id TEXT PRIMARY KEY, name TEXT NOT NULL, ip_address TEXT NOT NULL,
    install_directory TEXT NOT NULL, platform TEXT NOT NULL, capabilities TEXT NOT NULL,
    token_hash TEXT NOT NULL, status TEXT NOT NULL, last_heartbeat TEXT,
    desired_digest TEXT, actual_digest TEXT, last_error TEXT, worker_digests TEXT,
    runner_pid INTEGER, worker_processes TEXT, os_type TEXT, os_version TEXT, launcher_version TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS runners_location ON runners(ip_address, install_directory);
CREATE TABLE IF NOT EXISTS directory_runner_bindings (
    binding_type TEXT NOT NULL, owner_key TEXT NOT NULL, owner_id TEXT NOT NULL,
    runner_id TEXT NOT NULL REFERENCES runners(runner_id), created_at TEXT NOT NULL,
    PRIMARY KEY(binding_type, owner_key, runner_id)
);
CREATE TABLE IF NOT EXISTS enrollment_codes (
    code_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS releases (
    digest TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
    platform TEXT NOT NULL, git_commit TEXT NOT NULL, status TEXT NOT NULL,
    published_at TEXT NOT NULL, signature TEXT NOT NULL, entry TEXT NOT NULL,
    git_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
    assignment_id TEXT PRIMARY KEY, runner_id TEXT NOT NULL REFERENCES runners(runner_id),
    queue TEXT NOT NULL, processor_type TEXT NOT NULL,
    release_digest TEXT NOT NULL REFERENCES releases(digest),
    concurrency INTEGER NOT NULL, enabled INTEGER NOT NULL, environment TEXT NOT NULL,
    code_id TEXT NOT NULL DEFAULT '',
    UNIQUE(runner_id, queue)
);
CREATE TABLE IF NOT EXISTS code_assets (
    code_id TEXT PRIMARY KEY, config_id TEXT NOT NULL, queue_name TEXT NOT NULL,
    site_host TEXT NOT NULL, storage_path TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(config_id, queue_name, site_host)
);
CREATE TABLE IF NOT EXISTS code_runtime_bindings (
    environment TEXT NOT NULL, config_id TEXT NOT NULL, queue_name TEXT NOT NULL,
    site_host TEXT NOT NULL, digest TEXT NOT NULL REFERENCES releases(digest),
    PRIMARY KEY(environment, config_id, queue_name, site_host)
);
CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS code_repositories (
    repo_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, local_path TEXT NOT NULL UNIQUE,
    remote_url TEXT NOT NULL, branch TEXT NOT NULL, is_default INTEGER NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    config_type TEXT NOT NULL DEFAULT '', config_type_name TEXT NOT NULL DEFAULT ''
);
"""

# 代码资产首次发布时确定所属仓库；分类规则后续变化不搬动已有资产。
CODE_ASSET_COLUMNS = {"repo_id": "TEXT NOT NULL DEFAULT ''", "config_type": "TEXT NOT NULL DEFAULT ''", "directory_id": "TEXT NOT NULL DEFAULT ''"}


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            from .artifact_table_schema import sqlite_rename
            sqlite_rename(db)
            db.executescript(SCHEMA + DEPLOYMENT_SCHEMA + LOG_SCHEMA + SOURCE_CODE_SCHEMA)
            relation_columns = {row[1] for row in db.execute('PRAGMA table_info(source_code_relations)')}
            for name in ('latest_task_id', 'latest_task_created_at'):
                if name not in relation_columns:
                    db.execute(f"ALTER TABLE source_code_relations ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
            columns = {row[1] for row in db.execute("PRAGMA table_info(runners)")}
            if "worker_digests" not in columns:
                db.execute("ALTER TABLE runners ADD COLUMN worker_digests TEXT")
            for name, definition in (("runner_pid", "INTEGER"), ("worker_processes", "TEXT"), ("os_type", "TEXT"), ("os_version", "TEXT"), ("launcher_version", "TEXT")):
                if name not in columns:
                    db.execute(f"ALTER TABLE runners ADD COLUMN {name} {definition}")
            assignment_columns = {row[1] for row in db.execute("PRAGMA table_info(assignments)")}
            if "code_id" not in assignment_columns:
                db.execute("ALTER TABLE assignments ADD COLUMN code_id TEXT NOT NULL DEFAULT ''")
            artifact_store_ready = bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='view' AND name='releases'").fetchone())
            asset_columns = {row[1] for row in db.execute("PRAGMA table_info(code_assets)")}
            for name, definition in CODE_ASSET_COLUMNS.items():
                if not artifact_store_ready and name not in asset_columns:
                    db.execute(f"ALTER TABLE code_assets ADD COLUMN {name} {definition}")
            repo_columns = {row[1] for row in db.execute("PRAGMA table_info(code_repositories)")}
            if "config_type" not in repo_columns:
                db.execute("ALTER TABLE code_repositories ADD COLUMN config_type TEXT NOT NULL DEFAULT ''")
            if "config_type_name" not in repo_columns:
                db.execute("ALTER TABLE code_repositories ADD COLUMN config_type_name TEXT NOT NULL DEFAULT ''")
            from .release_schema import sqlite_migrate
            if not artifact_store_ready:
                sqlite_migrate(db)
            from .job_schema import sqlite_migrate as migrate_jobs
            migrate_jobs(db)
            from .delivery_task_schema import sqlite_migrate as migrate_deliveries
            deliveries_merged = migrate_deliveries(db, backfill=False)
            from .log_schema import sqlite_migrate as migrate_logs
            migrate_logs(db)
            from .task_artifact_schema import sqlite_migrate as migrate_artifacts
            migrate_artifacts(db)
            if deliveries_merged:
                from .delivery_task_schema import backfill_artifacts
                backfill_artifacts(db)
            from .deployment_log_storage import migrate as migrate_deployment_logs
            migrate_deployment_logs(db)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


MYSQL_TABLES = ("runners", "enrollment_codes", "releases", "artifacts", "assignments",
                "code_assets", "code_runtime_bindings", "settings", "jobs", "source_code_relations",
                "code_repositories", "directory_runner_bindings", "directory_deliveries") + LOG_TABLES
MYSQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS ce_runner_runners (
    runner_id VARCHAR(80) PRIMARY KEY, name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(64) NOT NULL, install_directory VARCHAR(512) NOT NULL,
    platform VARCHAR(64) NOT NULL, capabilities TEXT NOT NULL,
    token_hash CHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
    last_heartbeat VARCHAR(50), desired_digest VARCHAR(100), actual_digest VARCHAR(100),
    last_error VARCHAR(500), worker_digests TEXT, runner_pid BIGINT, worker_processes LONGTEXT,
    os_type VARCHAR(64), os_version VARCHAR(255), launcher_version VARCHAR(80),
    UNIQUE KEY runner_location (ip_address, install_directory),
    UNIQUE KEY runner_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_enrollment_codes (
    code_hash CHAR(64) PRIMARY KEY, expires_at VARCHAR(50) NOT NULL, used_at VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_directory_runner_bindings (
    binding_type VARCHAR(20) NOT NULL, owner_key CHAR(64) NOT NULL, owner_id VARCHAR(400) NOT NULL,
    runner_id VARCHAR(80) NOT NULL, created_at VARCHAR(50) NOT NULL,
    PRIMARY KEY(binding_type, owner_key, runner_id),
    FOREIGN KEY (runner_id) REFERENCES ce_runner_runners(runner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_releases (
    digest VARCHAR(100) PRIMARY KEY, kind VARCHAR(20) NOT NULL, name VARCHAR(120) NOT NULL,
    platform VARCHAR(64) NOT NULL, git_commit VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL, published_at VARCHAR(50) NOT NULL,
    signature VARCHAR(255) NOT NULL, entry VARCHAR(255) NOT NULL, git_url TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_assignments (
    assignment_id VARCHAR(80) PRIMARY KEY, runner_id VARCHAR(80) NOT NULL,
    queue VARCHAR(255) NOT NULL, processor_type VARCHAR(100) NOT NULL,
    release_digest VARCHAR(100) NOT NULL, concurrency INT NOT NULL,
    enabled TINYINT NOT NULL, environment VARCHAR(20) NOT NULL,
    code_id VARCHAR(80) NOT NULL DEFAULT '',
    UNIQUE KEY runner_queue (runner_id, queue),
    FOREIGN KEY (runner_id) REFERENCES ce_runner_runners(runner_id),
    FOREIGN KEY (release_digest) REFERENCES ce_runner_releases(digest)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_code_assets (
    code_id VARCHAR(80) PRIMARY KEY, config_id VARCHAR(80) NOT NULL,
    queue_name VARCHAR(120) NOT NULL, site_host VARCHAR(253) NOT NULL,
    storage_path VARCHAR(512) NOT NULL, created_at VARCHAR(50) NOT NULL,
    UNIQUE KEY asset_identity (config_id, queue_name, site_host)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_code_runtime_bindings (
    environment VARCHAR(20) NOT NULL, config_id VARCHAR(80) NOT NULL,
    queue_name VARCHAR(120) NOT NULL, site_host VARCHAR(253) NOT NULL,
    digest VARCHAR(100) NOT NULL,
    PRIMARY KEY (environment, config_id, queue_name, site_host),
    FOREIGN KEY (digest) REFERENCES ce_runner_releases(digest)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_settings (
    setting_key VARCHAR(100) PRIMARY KEY, setting_value LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_code_repositories (
    repo_id VARCHAR(80) PRIMARY KEY, name VARCHAR(60) NOT NULL,
    local_path VARCHAR(512) NOT NULL, remote_url VARCHAR(1000) NOT NULL,
    branch VARCHAR(120) NOT NULL, is_default TINYINT NOT NULL,
    status VARCHAR(20) NOT NULL, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
    config_type VARCHAR(40) NOT NULL DEFAULT '', config_type_name VARCHAR(200) NOT NULL DEFAULT '',
    UNIQUE KEY repo_name (name), UNIQUE KEY repo_path (local_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""
MYSQL_CODE_ASSET_COLUMNS = {"repo_id": "VARCHAR(80) NOT NULL DEFAULT ''", "config_type": "VARCHAR(40) NOT NULL DEFAULT ''", "directory_id": "VARCHAR(80) NOT NULL DEFAULT ''"}


class MySqlConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql: str, values=()):
        import pymysql

        sql = re.sub(r"\b(?:" + "|".join(MYSQL_TABLES) + r")\b", lambda match: "ce_runner_" + match.group(), sql)
        sql = sql.replace("?", "%s").replace("INSERT OR IGNORE", "INSERT IGNORE")
        cursor = self.connection.cursor(pymysql.cursors.DictCursor)
        cursor.execute(sql, values)
        return cursor


class MySqlStore:
    def __init__(self):
        import pymysql

        self.kwargs = {
            "host": os.environ["RUNNER_DB_HOST"],
            "port": int(os.getenv("RUNNER_DB_PORT", "8102")),
            "database": os.environ["RUNNER_DB_NAME"],
            "user": os.environ["RUNNER_DB_USER"],
            "password": os.environ["RUNNER_DB_PASSWORD"],
            "charset": "utf8mb4", "connect_timeout": 5, "read_timeout": 10, "write_timeout": 10,
            "autocommit": False,
        }
        with pymysql.connect(**self.kwargs) as db:
            with db.cursor() as cursor:
                from .artifact_table_schema import mysql_rename
                mysql_rename(cursor)
                for statement in (MYSQL_SCHEMA + MYSQL_DEPLOYMENT_SCHEMA + MYSQL_LOG_SCHEMA + MYSQL_SOURCE_CODE_SCHEMA).split(";"):
                    if statement.strip():
                        cursor.execute(statement)
                for name, length in (('latest_task_id', 80), ('latest_task_created_at', 50)):
                    cursor.execute('SHOW COLUMNS FROM ce_runner_source_code_relations LIKE %s', (name,))
                    if not cursor.fetchone():
                        cursor.execute(f"ALTER TABLE ce_runner_source_code_relations ADD COLUMN {name} VARCHAR({length}) NOT NULL DEFAULT ''")
                for name, definition in (("runner_pid", "BIGINT NULL"), ("worker_processes", "LONGTEXT NULL"), ("os_type", "VARCHAR(64) NULL"), ("os_version", "VARCHAR(255) NULL"), ("launcher_version", "VARCHAR(80) NULL")):
                    cursor.execute("SHOW COLUMNS FROM ce_runner_runners LIKE %s", (name,))
                    if not cursor.fetchone():
                        cursor.execute(f"ALTER TABLE ce_runner_runners ADD COLUMN {name} {definition}")
                cursor.execute("SHOW COLUMNS FROM ce_runner_assignments LIKE 'code_id'")
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE ce_runner_assignments ADD COLUMN code_id VARCHAR(80) NOT NULL DEFAULT ''")
                cursor.execute("SELECT TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ce_runner_releases'")
                artifact_store_ready = cursor.fetchone()[0] == 'VIEW'
                for name, definition in MYSQL_CODE_ASSET_COLUMNS.items():
                    cursor.execute("SHOW COLUMNS FROM ce_runner_code_assets LIKE %s", (name,))
                    if not cursor.fetchone() and not artifact_store_ready:
                        cursor.execute(f"ALTER TABLE ce_runner_code_assets ADD COLUMN {name} {definition}")
                cursor.execute("SHOW COLUMNS FROM ce_runner_code_repositories LIKE 'config_type'")
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE ce_runner_code_repositories ADD COLUMN config_type VARCHAR(40) NOT NULL DEFAULT ''")
                cursor.execute("SHOW COLUMNS FROM ce_runner_code_repositories LIKE 'config_type_name'")
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE ce_runner_code_repositories ADD COLUMN config_type_name VARCHAR(200) NOT NULL DEFAULT ''")
                from .release_schema import mysql_migrate
                if not artifact_store_ready:
                    mysql_migrate(cursor)
                from .job_schema import mysql_migrate as migrate_jobs
                migrate_jobs(cursor)
                from .delivery_task_schema import mysql_migrate as migrate_deliveries
                deliveries_merged = migrate_deliveries(cursor, backfill=False)
                from .log_schema import mysql_migrate as migrate_logs
                migrate_logs(cursor)
                from .task_artifact_schema import mysql_migrate as migrate_artifacts
                migrate_artifacts(cursor)
                if deliveries_merged:
                    from .delivery_task_schema import backfill_artifacts
                    backfill_artifacts(MySqlConnection(db))
                from .deployment_log_storage import migrate as migrate_deployment_logs
                migrate_deployment_logs(MySqlConnection(db))
                cursor.execute("SHOW COLUMNS FROM ce_runner_settings LIKE 'setting_value'")
                setting_column = cursor.fetchone()
                if setting_column and setting_column[1].lower() != 'longtext':
                    cursor.execute("ALTER TABLE ce_runner_settings MODIFY COLUMN setting_value LONGTEXT NOT NULL")
            db.commit()

    @contextmanager
    def connect(self):
        import pymysql

        db = pymysql.connect(**self.kwargs)
        try:
            yield MySqlConnection(db)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


def create_store(path: Path):
    return MySqlStore() if os.getenv("RUNNER_DB_HOST") else Store(path)
