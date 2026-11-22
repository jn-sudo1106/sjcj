"""Append-only operation history; console bodies stay out of the database."""
TABLES = ('runtime_operations', 'program_runs', 'logs')
SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS runtime_operations (
 record_id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
 deployment_id TEXT NOT NULL, assignment_id TEXT NOT NULL, parent_id TEXT NOT NULL,
 kind TEXT NOT NULL, status TEXT NOT NULL, requested_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, finished_at TEXT, error TEXT NOT NULL, snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_history ON runtime_operations(runtime_id, requested_at);
CREATE TABLE IF NOT EXISTS program_runs (
 run_id TEXT PRIMARY KEY, slot INTEGER NOT NULL, pid INTEGER, entry TEXT NOT NULL,
 working_directory TEXT NOT NULL, interpreter TEXT NOT NULL, exit_code INTEGER,
 started_at TEXT, ended_at TEXT, reason TEXT NOT NULL
);




"""
MYSQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS ce_runner_runtime_operations (
 record_id CHAR(32) PRIMARY KEY, runner_id VARCHAR(80) NOT NULL, runtime_id VARCHAR(100) NOT NULL,
 deployment_id VARCHAR(400) NOT NULL, assignment_id VARCHAR(80) NOT NULL, parent_id VARCHAR(80) NOT NULL,
 kind VARCHAR(20) NOT NULL, status VARCHAR(30) NOT NULL, requested_at VARCHAR(50) NOT NULL,
 updated_at VARCHAR(50) NOT NULL, finished_at VARCHAR(50), error TEXT NOT NULL, snapshot_json LONGTEXT NOT NULL,
 INDEX runtime_history (runtime_id, requested_at), INDEX runner_history (runner_id, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ce_runner_program_runs (
 run_id CHAR(32) PRIMARY KEY, slot INT NOT NULL, pid BIGINT, entry TEXT NOT NULL,
 working_directory TEXT NOT NULL, interpreter TEXT NOT NULL, exit_code BIGINT,
 started_at VARCHAR(50), ended_at VARCHAR(50), reason TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;




"""

from .log_schema import SQLITE_SCHEMA as LOG_SCHEMA, MYSQL_SCHEMA as MYSQL_LOG_SCHEMA
SQLITE_SCHEMA += LOG_SCHEMA
MYSQL_SCHEMA += MYSQL_LOG_SCHEMA
