"""Queryable source/node/generated-file provenance, independent of task retention."""

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS source_code_relations (
    relation_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, flow_id TEXT NOT NULL,
    flow_version_id TEXT NOT NULL, step_id TEXT NOT NULL, config_id TEXT NOT NULL,
    task_id TEXT NOT NULL, archive_id TEXT NOT NULL, repo_id TEXT NOT NULL,
    directory_id TEXT NOT NULL, file_path TEXT NOT NULL, git_commit TEXT NOT NULL,
    sha256 TEXT NOT NULL, server_id TEXT NOT NULL, server_path TEXT NOT NULL,
    queue_name TEXT NOT NULL, archive_status TEXT NOT NULL, pushed INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    latest_task_id TEXT NOT NULL DEFAULT '', latest_task_created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS source_code_owner ON source_code_relations(source_id,config_id,created_at);
CREATE INDEX IF NOT EXISTS source_code_config ON source_code_relations(config_id,created_at);
CREATE INDEX IF NOT EXISTS source_code_task ON source_code_relations(task_id);
CREATE INDEX IF NOT EXISTS source_code_archive ON source_code_relations(archive_id);
CREATE INDEX IF NOT EXISTS source_code_repository ON source_code_relations(repo_id);
"""

MYSQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS ce_runner_source_code_relations (
    relation_id CHAR(64) PRIMARY KEY, source_id VARCHAR(80) NOT NULL, flow_id VARCHAR(80) NOT NULL,
    flow_version_id VARCHAR(80) NOT NULL, step_id VARCHAR(80) NOT NULL, config_id VARCHAR(80) NOT NULL,
    task_id VARCHAR(80) NOT NULL, archive_id VARCHAR(80) NOT NULL, repo_id VARCHAR(80) NOT NULL,
    directory_id VARCHAR(80) NOT NULL, file_path TEXT NOT NULL, git_commit VARCHAR(80) NOT NULL,
    sha256 VARCHAR(64) NOT NULL, server_id VARCHAR(80) NOT NULL, server_path TEXT NOT NULL,
    queue_name VARCHAR(120) NOT NULL, archive_status VARCHAR(20) NOT NULL, pushed TINYINT NOT NULL,
    created_at VARCHAR(50) NOT NULL,
    latest_task_id VARCHAR(80) NOT NULL DEFAULT '', latest_task_created_at VARCHAR(50) NOT NULL DEFAULT '',
    INDEX source_code_owner (source_id,config_id,created_at), INDEX source_code_config (config_id,created_at),
    INDEX source_code_task (task_id), INDEX source_code_archive (archive_id), INDEX source_code_repository (repo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""
