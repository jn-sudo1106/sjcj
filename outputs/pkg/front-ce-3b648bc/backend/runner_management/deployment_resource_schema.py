"""Durable generated-code deployments; business tasks are unaffected."""

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS deployment_jobs (
 job_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, flow_id TEXT NOT NULL, step_id TEXT NOT NULL,
 config_id TEXT NOT NULL, config_type TEXT NOT NULL, environment TEXT NOT NULL,
 archive_id TEXT NOT NULL, task_id TEXT NOT NULL, git_commit TEXT NOT NULL,
 status TEXT NOT NULL, runner_id TEXT NOT NULL, deployment_id TEXT NOT NULL, delivery_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deployment_jobs_owner ON deployment_jobs(config_id,environment,created_at);
CREATE INDEX IF NOT EXISTS deployment_jobs_status ON deployment_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS deployment_jobs_archive ON deployment_jobs(archive_id,environment);
"""

MYSQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS ce_runner_deployment_jobs (
 job_id CHAR(32) PRIMARY KEY, source_id VARCHAR(80) NOT NULL, flow_id VARCHAR(80) NOT NULL, step_id VARCHAR(80) NOT NULL,
 config_id VARCHAR(80) NOT NULL, config_type VARCHAR(40) NOT NULL, environment VARCHAR(20) NOT NULL,
 archive_id VARCHAR(80) NOT NULL, task_id VARCHAR(80) NOT NULL, git_commit VARCHAR(80) NOT NULL,
 status VARCHAR(30) NOT NULL, runner_id VARCHAR(80) NOT NULL, deployment_id VARCHAR(80) NOT NULL, delivery_id VARCHAR(80) NOT NULL,
 created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL, payload LONGTEXT NOT NULL,
 INDEX deployment_jobs_owner (config_id,environment,created_at), INDEX deployment_jobs_status (status,created_at),
 INDEX deployment_jobs_archive (archive_id,environment)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""
