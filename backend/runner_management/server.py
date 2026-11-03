"""Local management API for signed Runner releases. Python 3.10+."""
from __future__ import annotations

import ast
import base64
import binascii
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

from .artifacts import ArtifactStore
from .store import MySqlStore, create_store


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.getenv("RUNNER_DATA_DIR", str(ROOT / ".runtime"))).resolve()
MAX_JSON = 256 * 1024
MAX_SCRIPT_JSON = 512 * 1024
MAX_UPLOAD_JSON = 15 * 1024 * 1024
MAX_UPLOAD_FILES = 20
MAX_UPLOAD_FOLDER_FILES = 2000
MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_TOTAL_BYTES = 10 * 1024 * 1024
RUNNER_OFFLINE_AFTER_SECONDS = 15
RUNNER_SWEEP_INTERVAL_SECONDS = 5
GIT_LOCK = threading.RLock()
RESPONSE_SENT = object()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def required_text(payload: dict, field: str, limit: int = 255) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ApiError(f"{field} 无效")
    return value.strip()


def as_runner(row, assignment_count=0) -> dict:
    return {
        "runnerId": row["runner_id"], "name": row["name"],
        "ipAddress": row["ip_address"], "installDirectory": row["install_directory"],
        "platform": row["platform"], "capabilities": json.loads(row["capabilities"]),
        "osType": row['os_type'], "osVersion": row['os_version'],
        "status": row["status"], "lastHeartbeat": row["last_heartbeat"],
        "desiredDigest": row["desired_digest"], "actualDigest": row["actual_digest"],
        "assignmentCount": assignment_count, "lastError": row["last_error"],
        "workerDigests": row["worker_digests"],
        "runnerPid": row['runner_pid'], "launcherVersion": row['launcher_version'],
        "workerProcesses": json.loads(row['worker_processes']) if row['worker_processes'] is not None else None,
    }


def reported_os(payload):
    result = []
    for key, limit in (('osType', 64), ('osVersion', 255)):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > limit or any(ord(char) < 32 for char in value)):
            raise ApiError(f'{key} 无效')
        result.append(value.strip() or None if value is not None else None)
    return tuple(result)


def heartbeat_processes(payload):
    """Older Runners omit these fields; null means no process report available."""
    def pid(value):
        if type(value) is not int or not 0 < value <= 4294967295:
            raise ApiError('进程 ID 无效')
        return value
    runner_pid = pid(payload['runnerPid']) if payload.get('runnerPid') is not None else None
    processes = payload.get('workerProcesses')
    if processes is None:
        return runner_pid, None
    if not isinstance(processes, list) or len(processes) > 1000:
        raise ApiError('任务进程列表无效')
    result, seen = [], set()
    for item in processes:
        if not isinstance(item, dict):
            raise ApiError('任务进程信息无效')
        process_pid = pid(item.get('pid'))
        assignment = required_text(item, 'assignmentId', 80)
        queue = required_text(item, 'queue', 255)
        slot = item.get('slot')
        if type(slot) is not int or not 0 <= slot < 100 or (assignment, slot) in seen:
            raise ApiError('任务进程并发序号无效')
        seen.add((assignment, slot))
        record = {'assignmentId': assignment, 'queue': queue, 'slot': slot, 'pid': process_pid}
        for key in ('entry', 'workingDirectory'):
            if key in item:
                record[key] = required_text(item, key, 2048)
        result.append(record)
    return runner_pid, json.dumps(result, ensure_ascii=False)


def as_release(row, used_by=0) -> dict:
    return {
        "digest": row["digest"], "kind": row["kind"], "name": row["name"],
        "platform": row["platform"], "gitCommit": row["git_commit"],
        "status": row["status"], "publishedAt": row["published_at"],
        "signature": row["signature"], "usedBy": used_by,
    }


def as_assignment(row) -> dict:
    layout = json.loads(optional(row, "layout_json") or "null")
    return {
        "assignmentId": row["assignment_id"], "runnerId": row["runner_id"],
        "queue": row["queue"], "processorType": row["processor_type"],
        "releaseDigest": row["release_digest"], "concurrency": row["concurrency"],
        "enabled": bool(row["enabled"]), "environment": row["environment"],
        "codeId": optional(row, "code_id") or "", "configId": optional(row, "config_id") or "",
        "scriptDigest": optional(row, "script_digest") or "", "deliveryPath": optional(row, "delivery_path") or "",
        "siteHost": optional(row, "site_host") or "", "repoName": optional(row, "repo_name") or "",
        "gitCommit": optional(row, "git_commit") or "",
        "directoryTemplate": layout['directoryTemplate'] if layout else "{configId}" if optional(row, "code_id") else "",
    }


def as_binding(row) -> dict:
    return {
        "configId": row["config_id"], "gitUrl": row["git_url"],
        "gitCommit": row["git_commit"], "scriptDigest": row["digest"],
        "publishedAt": row["published_at"], "status": row["status"],
    }


CODE_VERSION_SELECT = (
    "SELECT a.*,v.*,v.repo_id AS version_repo_id,r.name AS repo_name,r.local_path AS repo_path FROM code_versions v "
    "JOIN code_assets a ON a.code_id=v.code_id LEFT JOIN code_repositories r "
    "ON r.repo_id=COALESCE(NULLIF(v.repo_id,''),a.repo_id) "
)

ASSIGNMENT_SELECT = (
    "SELECT x.*,a.config_id,a.site_host,v.delivery_path,v.git_commit,v.layout_json,b.digest AS script_digest,r.name AS repo_name "
    "FROM assignments x LEFT JOIN code_assets a ON a.code_id=x.code_id "
    "LEFT JOIN code_runtime_bindings b ON b.config_id=a.config_id AND b.queue_name=x.queue AND b.site_host=a.site_host "
    "AND b.environment=CASE WHEN x.environment='production' THEN 'prd' ELSE x.environment END "
    "LEFT JOIN code_versions v ON v.digest=b.digest LEFT JOIN code_repositories r "
    "ON r.repo_id=COALESCE(NULLIF(v.repo_id,''),a.repo_id) "
)


def optional(row, key: str):
    return row[key] if key in row.keys() else None


def as_code_version(row) -> dict:
    layout = json.loads(optional(row, "layout_json") or "null")
    return {
        "repoId": optional(row, "version_repo_id") or optional(row, "repo_id"), "repoName": optional(row, "repo_name"),
        "repoPath": optional(row, "repo_path"), "configType": optional(row, "config_type") or "",
        "codeId": row["code_id"], "configId": row["config_id"],
        "queueName": row["queue_name"], "siteHost": row["site_host"],
        "storagePath": row["source_repo_path"] if layout else optional(row, "repository_storage_path") or row["storage_path"], "deliveryPath": row["delivery_path"],
        "directoryId": optional(row, "repository_directory_id") or "",
        "gitUrl": row["git_url"], "gitCommit": row["git_commit"],
        "scriptDigest": row["digest"], "publishedAt": row["published_at"],
        "prompt": row["prompt"], "userPrompt": row["prompt"], "systemPrompt": optional(row, 'system_prompt') or '', "promptTemplateId": int(optional(row, 'prompt_template_id') or 0), "url": row["source_url"],
        "sourceRepoPath": optional(row, "source_repo_path") or "",
        "sourceGitCommit": optional(row, "source_git_commit") or "",
        "directoryLayout": layout,
    }


def valid_queue(value: str) -> str:
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", value)
            or value.endswith(".") or value.upper().split(".")[0] in
            {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}):
        raise ApiError("队列名不能作为安全的下发文件名")
    return value


def valid_environment(value: str) -> str:
    normalized = "prd" if value == "production" else value
    if normalized not in ("prd", "test"):
        raise ApiError("运行环境无效")
    return normalized


def count_of(row) -> int:
    return int(next(iter(dict(row).values())))


class Application:
    def __init__(self, data_dir: Path = RUNTIME, site_script_repo: Path | None = None):
        self.data_dir = data_dir
        self.store = create_store(data_dir / "runner.sqlite3")
        self.artifacts = ArtifactStore(data_dir / "artifacts")
        self.default_site_script_repo = Path(os.getenv(
            "RUNNER_SITE_SCRIPT_REPO", str(ROOT.parent / "site-scripts"))).resolve()
        self.ensure_default_repository(site_script_repo)
        self.migrate_site_script_repo()
        token_key = data_dir / "worker-token.key"
        if not token_key.exists():
            token_key.write_bytes(secrets.token_bytes(32))
            if os.name != "nt":
                token_key.chmod(0o600)
        self.worker_token_key = token_key.read_bytes()

    def ensure_default_repository(self, override: Path | None) -> None:
        """First start after multi-repo support: turn the old single-repo settings into the default repository."""
        with self.store.connect() as db:
            default = db.execute("SELECT * FROM code_repositories WHERE is_default=1").fetchone()
            if not default:
                def setting(key: str):
                    row = db.execute("SELECT setting_value FROM settings WHERE setting_key=?", (key,)).fetchone()
                    return row["setting_value"] if row else None
                path = (override or Path(setting("site_script_repo") or self.default_site_script_repo)).resolve()
                repo_id = uuid.uuid4().hex
                db.execute("INSERT INTO code_repositories "
                           "(repo_id,name,local_path,remote_url,branch,is_default,status,created_at,updated_at,config_type,config_type_name) "
                           "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                    repo_id, "默认仓库", str(path), setting("site_script_git_remote") or "",
                    setting("site_script_git_branch") or "main", 1, "ACTIVE", now(), now(), "", "",
                ))
            else:
                repo_id = default["repo_id"]
                if override and Path(default["local_path"]) != override.resolve():
                    db.execute("UPDATE code_repositories SET local_path=?, updated_at=? WHERE repo_id=?",
                               (str(override.resolve()), now(), repo_id))
            db.execute("UPDATE code_assets SET repo_id=? WHERE repo_id='' OR repo_id IS NULL", (repo_id,))
            db.execute("UPDATE code_versions SET repo_id=(SELECT repo_id FROM code_assets "
                       "WHERE code_assets.code_id=code_versions.code_id) WHERE repo_id='' OR repo_id IS NULL")

    def default_repository(self, db=None):
        if db is None:
            with self.store.connect() as conn:
                return self.default_repository(conn)
        return db.execute("SELECT * FROM code_repositories WHERE is_default=1").fetchone()

    @staticmethod
    def repository(db, repo_id: str):
        row = db.execute("SELECT * FROM code_repositories WHERE repo_id=?", (repo_id,)).fetchone()
        if not row:
            raise ApiError("代码仓库不存在", 404)
        return row

    # 旧的单仓库属性保留为默认仓库的只读视图，旧接口和遗留脚本发布继续可用。
    @property
    def site_script_repo(self) -> Path:
        return Path(self.default_repository()["local_path"])

    @property
    def site_script_git_remote(self) -> str:
        return self.default_repository()["remote_url"]

    @property
    def site_script_git_branch(self) -> str:
        return self.default_repository()["branch"]

    def migrate_site_script_repo(self) -> None:
        """Move the old local Git repository and repair URLs stored with its old location."""
        old_repo = self.data_dir / "git" / "site-scripts"
        target = self.site_script_repo
        old_uri = old_repo.resolve().as_uri() + "#"
        new_uri = target.as_uri() + "#"
        with GIT_LOCK:
            if old_repo.exists() and old_repo.resolve() != target:
                if target.exists():
                    raise RuntimeError(f"站点代码仓库迁移目标已存在：{target}")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(old_repo), str(target))
            with self.store.connect() as db:
                self.rewrite_repo_urls(db, old_uri, new_uri)

    @staticmethod
    def rewrite_repo_urls(db, old_uri: str, new_uri: str) -> None:
        for table in ("code_versions", "releases"):
            rows = db.execute(f"SELECT digest, git_url FROM {table} WHERE git_url LIKE ?", (old_uri + "%",)).fetchall()
            for row in rows:
                if row["git_url"].startswith(old_uri):
                    db.execute(f"UPDATE {table} SET git_url=? WHERE digest=?", (
                        new_uri + row["git_url"][len(old_uri):], row["digest"],
                    ))

    def site_script_repo_setting(self) -> dict:
        repo = self.default_repository()
        return {"path": repo["local_path"], "defaultPath": str(self.default_site_script_repo),
                "remoteUrl": repo["remote_url"], "branch": repo["branch"]}

    def repository_upload_directory(self, db, row) -> str:
        if not row["config_type"]:
            return "default"
        name = row["config_type_name"]
        from .business_node_types import configured
        if isinstance(self.store, MySqlStore) and not configured():
            source_type = db.execute("SELECT TYPE_NAME FROM cfg_source_type WHERE SOURCE_TYPE=?",
                                     (row["config_type"],)).fetchone()
            if source_type and source_type["TYPE_NAME"]:
                name = source_type["TYPE_NAME"]
        if not name:
            name = row["config_type"]
        return self.upload_path("", name).name

    def repository_type_name(self, db, config_type: str, supplied: str = "", headers=None) -> str:
        if not config_type:
            return ""
        from .business_node_types import configured, type_name
        if configured():
            return self.upload_path('', type_name(config_type, headers)).name
        if isinstance(self.store, MySqlStore):
            source_type = db.execute("SELECT TYPE_NAME FROM cfg_source_type WHERE SOURCE_TYPE=?",
                                     (config_type,)).fetchone()
            if not source_type or not source_type["TYPE_NAME"]:
                raise ApiError("配置类型在节点类型字典中不存在")
            return self.upload_path("", source_type["TYPE_NAME"]).name
        return self.upload_path("", supplied or config_type).name

    def as_repository(self, db, row) -> dict:
        return {
            "repoId": row["repo_id"], "name": row["name"], "path": row["local_path"],
            "remoteUrl": row["remote_url"], "branch": row["branch"], "isDefault": bool(row["is_default"]),
            "status": row["status"], "configType": row["config_type"],
            "configTypeName": row["config_type_name"],
            "uploadDirectory": self.repository_upload_directory(db, row),
            "codeCount": count_of(db.execute("SELECT COUNT(DISTINCT code_id) FROM code_versions WHERE repo_id=?", (row["repo_id"],)).fetchone()),
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def list_repositories(self) -> list[dict]:
        with self.store.connect() as db:
            rows = db.execute("SELECT * FROM code_repositories ORDER BY is_default DESC, created_at").fetchall()
            return [self.as_repository(db, row) for row in rows]

    def repository_result(self, repo_id: str) -> dict:
        with self.store.connect() as db:
            return self.as_repository(db, self.repository(db, repo_id))

    def verify_repository(self, repo_id: str) -> dict:
        """Read-only check of the server checkout and its configured remote branch."""
        with self.store.connect() as db:
            row = self.repository(db, repo_id)
            path = Path(row["local_path"])
            remote_url = row["remote_url"]
            branch = row["branch"]
        checks: list[dict] = []

        def add(name: str, status: str, message: str) -> None:
            checks.append({"name": name, "status": status, "message": message})

        if not path.is_dir():
            add("directory", "error", "服务器目录不存在或不是文件夹")
        else:
            add("directory", "ok", "服务器目录存在")
            env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never",
                   "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=5",
                   "GIT_HTTP_LOW_SPEED_LIMIT": "1", "GIT_HTTP_LOW_SPEED_TIME": "8"}

            def run(*args: str, timeout: int = 8):
                return subprocess.run(["git", *args], cwd=path, capture_output=True, text=True,
                                      encoding="utf-8", errors="replace", env=env, timeout=timeout, check=False)

            try:
                root = run("rev-parse", "--show-toplevel")
                if root.returncode or Path(root.stdout.strip()).resolve() != path.resolve():
                    add("git", "error", "该目录不是独立的 Git 工作仓库")
                else:
                    add("git", "ok", "本地 Git 仓库正常")
                    current = run("symbolic-ref", "--quiet", "--short", "HEAD")
                    if current.returncode:
                        add("branch", "warning", "当前处于游离 HEAD，发布时会推送到配置的目标分支")
                    elif current.stdout.strip() != branch:
                        add("branch", "warning", f"当前本地分支为 {current.stdout.strip()}，配置的目标分支为 {branch}")
                    else:
                        add("branch", "ok", f"本地分支为 {branch}")

                    staged = run("diff", "--cached", "--quiet")
                    if staged.returncode == 1:
                        add("staged", "warning", "存在已暂存文件，发布代码时可能一同提交")
                    elif staged.returncode not in (0, 1):
                        add("staged", "warning", "无法检查暂存区")

                    origin = run("remote", "get-url", "origin")
                    if not remote_url:
                        if origin.returncode == 0:
                            add("remote", "warning", "配置未填写 Git 地址，但本地仓库存在 origin")
                        else:
                            add("remote", "skipped", "未配置远程地址，仅验证本地仓库")
                    elif origin.returncode or origin.stdout.strip() != remote_url:
                        add("remote", "error", "本地 origin 与系统配置的 Git 地址不一致")
                    else:
                        remote = run("ls-remote", "--heads", "origin", f"refs/heads/{branch}", timeout=15)
                        if remote.returncode:
                            add("remote", "error", "远程仓库连接失败，请检查地址、网络、凭据和读取权限")
                        elif not remote.stdout.strip():
                            add("remote", "warning", f"远程仓库可连接，但 {branch} 分支尚不存在；首次推送会创建")
                        else:
                            add("remote", "ok", f"远程仓库及 {branch} 分支可读取")
                        if remote.returncode == 0:
                            head = run("rev-parse", "--verify", "HEAD")
                            if head.returncode:
                                add("push", "warning", "本地尚无提交，无法验证远程写入权限")
                            else:
                                dry_run = run("push", "--dry-run", "--porcelain", "origin",
                                              f"HEAD:refs/heads/{branch}", timeout=15)
                                if dry_run.returncode:
                                    add("push", "error", "试推送失败，请检查写入权限或远程分支是否允许当前提交")
                                else:
                                    add("push", "ok", "试推送通过，远程未发生更改")
            except (OSError, subprocess.TimeoutExpired):
                add("git", "error", "Git 命令无法完成，请检查服务器 Git 安装或连接超时")

        status = "error" if any(item["status"] == "error" for item in checks) else (
            "warning" if any(item["status"] == "warning" for item in checks) else "ok")
        return {"repoId": repo_id, "status": status, "checks": checks, "checkedAt": now()}

    @staticmethod
    def upload_path(directory, file_name) -> Path:
        if not isinstance(directory, str) or len(directory) > 240 or not isinstance(file_name, str) or len(file_name) > 180:
            raise ApiError("上传路径无效")
        if directory.startswith(("/", "\\")) or ":" in directory or "/" in file_name or "\\" in file_name:
            raise ApiError("上传路径必须是仓库内的相对路径")
        parts = [part for part in directory.replace("\\", "/").split("/") if part]
        parts.append(file_name)
        reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                    *(f"LPT{i}" for i in range(1, 10))}
        for part in parts:
            if (part in (".", "..") or not part or part.endswith((" ", "."))
                    or part.upper().split(".")[0] in reserved or part.lower() == ".git"
                    or any(ord(c) < 32 or c in '<>:"/\\|?*' for c in part)):
                raise ApiError("上传文件名或目录包含非法字符")
        if parts[0].lower() == "code":
            raise ApiError("code 目录由系统管理，请上传到其他目录")
        return Path(*parts)

    def upload_repository_files(self, repo_id: str, payload: dict, *, owner_config_id=None) -> dict:
        overwrite = payload.get("overwrite", False)
        files = payload.get("files")
        upload_type = payload.get('uploadType', 'files')
        if upload_type not in ('files', 'folder'):
            raise ApiError('上传类型无效')
        max_files = MAX_UPLOAD_FOLDER_FILES if upload_type == 'folder' else MAX_UPLOAD_FILES
        if not isinstance(overwrite, bool) or not isinstance(files, list) or not 1 <= len(files) <= max_files:
            raise ApiError("上传文件参数无效")
        decoded: list[tuple[str, bytes]] = []
        seen: set[str] = set()
        total = 0
        for file in files:
            if not isinstance(file, dict) or not isinstance(file.get("data"), str):
                raise ApiError("上传文件参数无效")
            name = file.get("name")
            self.upload_path("default", name)
            relative = file.get('relativePath', name)
            if upload_type == 'folder':
                if (not isinstance(relative, str) or len(relative) > 400 or relative.startswith('/')
                        or '\\' in relative or any(not part for part in relative.split('/'))
                        or relative.rsplit('/', 1)[-1] != name):
                    raise ApiError('文件夹上传路径无效')
                parent = relative.rpartition('/')[0]
                self.upload_path('default/' + parent, name)
            elif relative != name:
                raise ApiError('上传子目录请使用文件夹上传')
            key = relative.casefold()
            if key in seen:
                raise ApiError("上传列表包含重复文件路径")
            seen.add(key)
            encoded = file["data"]
            if len(encoded) > ((MAX_UPLOAD_FILE_BYTES + 2) // 3) * 4:
                raise ApiError("单个文件不能超过 5 MB", 413)
            try:
                content = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise ApiError("文件内容编码无效") from exc
            if len(content) > MAX_UPLOAD_FILE_BYTES:
                raise ApiError("单个文件不能超过 5 MB", 413)
            total += len(content)
            if total > MAX_UPLOAD_TOTAL_BYTES:
                raise ApiError("单次上传不能超过 10 MB", 413)
            decoded.append((relative, content))
        if any('/'.join(name.split('/')[:index]).casefold() in seen
               for name, _ in decoded for index in range(1, len(name.split('/')))):
            raise ApiError('上传文件与文件夹的路径冲突')

        with GIT_LOCK:
            with self.store.connect() as db:
                row = self.repository(db, repo_id)
                if payload.get('directoryId'):
                    from .repository_directories import get_directory
                    directory = get_directory(self, db, repo_id, payload['directoryId'])['path']
                else:
                    directory = self.repository_upload_directory(db, row)
                from .repository_directories import managed_paths
                protected_paths = {path.casefold() for path in managed_paths(db, repo_id, exclude_config_id=owner_config_id)}
            if payload.get("directory") not in (None, "", directory):
                raise ApiError("上传目录由仓库配置类型决定", 400)
            paths = []
            for relative, content in decoded:
                parent, _, name = relative.rpartition('/')
                paths.append((self.upload_path(directory + '/' + parent if parent else directory, name), content))
            if row["status"] != "ACTIVE":
                raise ApiError("已停用的仓库不能上传文件", 409)
            repo = Path(row["local_path"])
            if not repo.is_dir() or not (repo / ".git").exists():
                raise ApiError("服务器仓库目录不存在或不是 Git 仓库，请先验证仓库", 409)
            git_root = self.git(repo, "rev-parse", "--show-toplevel").strip()
            if Path(git_root).resolve() != repo.resolve():
                raise ApiError("仓库目录不是独立的 Git 工作仓库", 409)
            staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo,
                                    capture_output=True, timeout=10, check=False)
            if staged.returncode:
                raise ApiError("仓库已有暂存文件，请先处理后再上传", 409)
            changed_paths = set()
            tracked_paths = set()
            if owner_config_id is not None:
                working = subprocess.run(['git', 'diff', '--name-only', '-z'], cwd=repo, capture_output=True, timeout=10, check=False)
                tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=repo, capture_output=True, timeout=10, check=False)
                if working.returncode or tracked.returncode:
                    raise ApiError('读取仓库文件状态失败，暂不能自动归档', 409)
                changed_paths = {name.decode('utf8') for name in working.stdout.split(b'\0') if name}
                tracked_paths = {name.decode('utf8') for name in tracked.stdout.split(b'\0') if name}
            for relative, content in paths:
                target = repo / relative
                if any((repo / Path(*relative.parts[:index])).is_symlink()
                       or getattr(repo / Path(*relative.parts[:index]), 'is_junction', lambda: False)()
                       for index in range(1, len(relative.parts))):
                    raise ApiError("上传路径不能经过符号链接目录", 400)
                if any((repo / Path(*relative.parts[:index])).exists()
                       and not (repo / Path(*relative.parts[:index])).is_dir()
                       for index in range(1, len(relative.parts))):
                    raise ApiError('目标目录中已有文件占用文件夹路径：' + relative.as_posix(), 409)
                if not target.resolve().is_relative_to(repo.resolve()) or target.is_symlink() or target.is_dir():
                    raise ApiError("上传路径不能指向仓库外部或目录", 400)
                if target.resolve().relative_to(repo.resolve()).parts[0].lower() == "code":
                    raise ApiError("code 目录由系统管理，请上传到其他目录")
                same_content = target.is_file() and target.stat().st_size == len(content) and target.read_bytes() == content
                if relative.as_posix().casefold() in protected_paths and not (owner_config_id is not None and same_content):
                    raise ApiError('文件已有流程代码或历史版本引用，请在流程节点中更新代码', 409)
                if owner_config_id is not None and (relative.as_posix() in changed_paths or target.exists() and relative.as_posix() not in tracked_paths and not same_content):
                    raise ApiError('目标文件有未提交的本地修改，不能自动覆盖：' + relative.as_posix(), 409)
                if target.exists() and not overwrite:
                    raise ApiError(f"{relative.as_posix()} 已存在；如需更新请勾选覆盖", 409)
            previous_contents = {}
            for relative, content in paths:
                target = repo / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                if owner_config_id is not None:
                    previous_contents[relative.as_posix()] = target.read_bytes() if target.is_file() else None
                target.write_bytes(content)
            if owner_config_id is not None:
                all_paths = b''.join(relative.as_posix().encode('utf8') + b'\0' for relative, _ in paths)
                ignored = subprocess.run(['git', 'check-ignore', '--no-index', '-z', '--stdin'], cwd=repo, input=all_paths,
                                         capture_output=True, timeout=20, check=False)
                if ignored.returncode not in (0, 1):
                    raise ApiError('读取仓库 gitignore 规则失败', 409)
                excluded = {name.decode('utf8') for name in ignored.stdout.split(b'\0') if name}
                for ignored_path in excluded:
                    target = repo / ignored_path
                    previous = previous_contents[ignored_path]
                    if previous is None:
                        target.unlink()
                    else:
                        target.write_bytes(previous)
                paths = [(relative, content) for relative, content in paths if relative.as_posix() not in excluded]
                if not paths:
                    raise ApiError('生成文件全部被仓库 gitignore 忽略，未创建提交', 409)
            # Read literal paths from stdin to preserve Unicode filenames and
            # avoid Windows' command-line length limit for folder uploads.
            staged_paths = b''.join(relative.as_posix().encode('utf-8') + b'\0' for relative, _ in paths)
            staged_upload = subprocess.run(['git', '--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'],
                                          cwd=repo, input=staged_paths, capture_output=True, timeout=120, check=False)
            if staged_upload.returncode:
                raise ApiError('上传文件暂存失败，请检查仓库的忽略规则和文件状态', 409)
            changed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo,
                                     capture_output=True, timeout=10, check=False).returncode != 0
            if changed:
                self.git(repo, "-c", "user.name=Runner Builder", "-c", "user.email=runner@localhost",
                         "commit", "-m", f"Upload {len(paths)} file(s)")
            commit = self.git(repo, "rev-parse", "HEAD").strip()
            if row["remote_url"]:
                self.set_git_origin(repo, row["remote_url"])
                try:
                    self.push_git(repo, row["branch"])
                except ApiError as exc:
                    error = ApiError("文件已提交到服务器本地仓库，但远程推送失败；修复后可勾选覆盖重新上传，或手动推送本地提交", 502)
                    error.local_commit = commit
                    error.uploaded_paths = [relative.as_posix() for relative, _ in paths]
                    raise error from exc
            return {"repoId": repo_id, "gitCommit": commit, "pushed": bool(row["remote_url"]),
                    "changed": changed, "files": [
                        {"path": relative.as_posix(), "size": len(content),
                         "gitUrl": self.git_url_for(row, commit, relative)} for relative, content in paths]}

    def list_repository_files(self, repo_id: str, keyword: str = "", page: int = 1, directory_id: str = "", view: str = "paths", folder: str = "") -> dict:
        if len(keyword) > 100 or not 1 <= page <= 100000:
            raise ApiError("文件列表查询参数无效")
        if view not in ('paths', 'directory') or len(folder) > 500 or (folder and (
                folder.startswith('/') or '\\' in folder or ':' in folder
                or any(part in ('', '.', '..') or part.lower() == '.git' for part in folder.split('/')))):
            raise ApiError("目录查询路径无效")
        with self.store.connect() as db:
            row = self.repository(db, repo_id)
            upload_directory = self.repository_upload_directory(db, row)
            from .repository_directories import get_directory, managed_paths
            prefix = get_directory(self, db, repo_id, directory_id, active=False)['path'] + '/' if directory_id else ''
            protected_paths = managed_paths(db, repo_id)
            from .repository_delete_policy import policy, reason as deletion_reason
            deletion_rules = policy(self, db, repo_id)
        repo = Path(row["local_path"])
        if not repo.is_dir() or not (repo / ".git").exists():
            raise ApiError("服务器仓库目录不存在或不是 Git 仓库", 409)
        result = subprocess.run(["git", "ls-files", "-z"], cwd=repo, capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=20, check=False)
        if result.returncode:
            raise ApiError("读取仓库文件列表失败", 500)
        names = [name for name in result.stdout.split("\0") if name and keyword.casefold() in name.casefold()
                 and (not prefix or name.startswith(prefix)) and not name.endswith('/.gitkeep')]
        names.sort(key=str.casefold)
        folders = set()
        if view == 'directory':
            browse_prefix = prefix + (folder + '/' if folder else '')
            children = set()
            for name in names:
                if not name.startswith(browse_prefix):
                    continue
                rest = name[len(browse_prefix):]
                child = browse_prefix + rest.split('/')[0]
                children.add(child)
                if '/' in rest:
                    folders.add(child)
            # Group all tracked paths before paging; a directory is never split
            # across pages or omitted because its descendants are on another page.
            names = sorted(children, key=lambda name: (name not in folders, name.casefold()))
        total = len(names)
        commit = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=repo,
                                capture_output=True, text=True, timeout=10, check=False)
        head = commit.stdout.strip() if commit.returncode == 0 else ""
        from .repository_metadata import file_times
        visible_names = names[(page - 1) * 50:page * 50]
        updated = file_times(repo, head, visible_names)
        items = []
        for name in visible_names:
            relative = Path(name)
            if name in folders:
                items.append({'path': name, 'kind': 'directory', 'size': None,
                              'managed': False, 'canDelete': False, 'gitUrl': '', 'updatedAt': updated.get(name)})
                continue
            target = repo / relative
            managed = relative.parts[0].lower() == "code" or relative.as_posix() in protected_paths
            safe = (target.resolve().is_relative_to(repo.resolve()) and not target.is_symlink()
                    and not any((repo / Path(*relative.parts[:index])).is_symlink()
                                for index in range(1, len(relative.parts))))
            exists = safe and target.is_file()
            delete_reason = deletion_reason(deletion_rules, name)
            items.append({"path": relative.as_posix(), "size": target.stat().st_size if exists else None,
                          "managed": managed, "canDelete": exists and not delete_reason and row['status'] == 'ACTIVE',
                          "deleteReason": delete_reason,
                          "kind": "file",
                          "updatedAt": updated.get(name),
                          "gitUrl": self.git_url_for(row, head, relative) if head else ""})
        return {"repoId": repo_id, "uploadDirectory": upload_directory, "total": total,
                "page": page, "pageSize": 50, "items": items}

    def read_repository_file(self, repo_id: str, raw_path: str) -> dict:
        if not isinstance(raw_path, str) or not raw_path or len(raw_path) > 500:
            raise ApiError("文件路径无效")
        normalized = raw_path.replace("\\", "/")
        if normalized.startswith("/") or ":" in normalized:
            raise ApiError("文件路径无效")
        parts = normalized.split("/")
        if any(not part or part in (".", "..") or part.lower() == ".git" for part in parts):
            raise ApiError("文件路径无效")
        relative = Path(*parts)
        with self.store.connect() as db:
            row = self.repository(db, repo_id)
        repo = Path(row["local_path"])
        if not repo.is_dir() or not (repo / ".git").exists():
            raise ApiError("服务器仓库目录不存在或不是 Git 仓库", 409)
        target = repo / relative
        if (not target.resolve().is_relative_to(repo.resolve()) or target.is_symlink()
                or any((repo / Path(*parts[:index])).is_symlink() for index in range(1, len(parts)))):
            raise ApiError("文件路径不能指向仓库外部", 400)
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", "--", str(relative)],
                                 cwd=repo, capture_output=True, timeout=10, check=False)
        if tracked.returncode or not target.is_file():
            raise ApiError("仓库文件不存在", 404)
        commit = self.git(repo, "rev-parse", "HEAD").strip()
        snapshot = subprocess.run(["git", "show", f"{commit}:{relative.as_posix()}"], cwd=repo,
                                  capture_output=True, timeout=20, check=False)
        if snapshot.returncode:
            raise ApiError("仓库提交中不存在该文件", 404)
        data = snapshot.stdout
        if len(data) > 1024 * 1024:
            raise ApiError("文件超过 1 MB，暂不支持在线预览", 413)
        if b"\0" in data:
            raise ApiError("二进制文件暂不支持在线预览", 415)
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ApiError("文件不是 UTF-8 文本，暂不支持在线预览", 415) from exc
        return {"repoId": repo_id, "path": relative.as_posix(), "size": len(data), "content": content,
                "gitCommit": commit}

    def delete_repository_file(self, repo_id: str, raw_path: str, *, association: bool = False) -> dict:
        if not isinstance(raw_path, str) or not raw_path or len(raw_path) > 500:
            raise ApiError("文件路径无效")
        normalized = raw_path.replace("\\", "/")
        from .directory_layout import safe_path
        relative = Path(safe_path(normalized))
        with GIT_LOCK:
            with self.store.connect() as db:
                row = self.repository(db, repo_id)
                from .repository_delete_policy import policy, reason as deletion_reason
                blocked = deletion_reason(policy(self, db, repo_id), relative.as_posix()) if not association else ''
                if blocked:
                    raise ApiError(blocked, 409)
            if row["status"] != "ACTIVE":
                raise ApiError("已停用的仓库不能删除文件", 409)
            repo = Path(row["local_path"])
            if not repo.is_dir() or not (repo / ".git").exists():
                raise ApiError("服务器仓库目录不存在或不是 Git 仓库", 409)
            target = repo / relative
            if (not target.resolve().is_relative_to(repo.resolve()) or target.is_symlink()
                    or any((repo / Path(*relative.parts[:index])).is_symlink()
                           for index in range(1, len(relative.parts)))):
                raise ApiError("文件路径不能指向仓库外部", 400)
            tracked = subprocess.run(["git", '--literal-pathspecs', "ls-files", "--error-unmatch", "--", str(relative)],
                                     cwd=repo, capture_output=True, timeout=10, check=False)
            if tracked.returncode or not target.is_file():
                raise ApiError("仓库文件不存在", 404)
            staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo,
                                    capture_output=True, timeout=10, check=False)
            if staged.returncode:
                raise ApiError("仓库已有暂存文件，请先处理后再删除", 409)
            changed = subprocess.run(["git", '--literal-pathspecs', "status", "--porcelain", "--", str(relative)], cwd=repo,
                                     capture_output=True, timeout=10, check=False)
            format_only = False
            if changed.returncode:
                raise ApiError('无法检查文件本地修改，请刷新后重试', 409)
            if changed.stdout:
                original = subprocess.run(['git', 'show', f'HEAD:{relative.as_posix()}'], cwd=repo,
                                          capture_output=True, timeout=15, check=False)
                data = target.read_bytes()
                if original.returncode or data.replace(b'\r\n', b'\n') != original.stdout.replace(b'\r\n', b'\n'):
                    raise ApiError("文件有未提交的内容修改，请先处理后再删除", 409)
                # Windows repositories copied to Linux may only differ in CRLF.
                # Keep the exact working bytes before removing that tracked file.
                backup = self.data_dir / 'repository-delete-backups' / uuid.uuid4().hex
                backup.mkdir(parents=True, mode=0o700)
                saved = backup / 'file'; saved.write_bytes(data); saved.chmod(0o600)
                (backup / 'receipt.json').write_text(json.dumps({'repoId': repo_id, 'path': relative.as_posix(),
                    'commit': self.git(repo, 'rev-parse', 'HEAD').strip(), 'sha256': hashlib.sha256(data).hexdigest()}))
                format_only = True
            self.git(repo, '--literal-pathspecs', "rm", *(('-f',) if format_only else ()), "--", str(relative))
            self.git(repo, '--literal-pathspecs', "-c", "user.name=Runner Builder", "-c", "user.email=runner@localhost",
                     "commit", "-m", f"Delete {relative.as_posix()}", '--only', '--', str(relative))
            commit = self.git(repo, "rev-parse", "HEAD").strip()
            if row["remote_url"]:
                self.set_git_origin(repo, row["remote_url"])
                try:
                    self.push_git(repo, row["branch"])
                except ApiError as exc:
                    raise ApiError("文件已在本地 Git 提交删除，但远程推送失败；请修复仓库连接后手动推送或进行下一次提交", 502) from exc
            return {"repoId": repo_id, "path": relative.as_posix(), "gitCommit": commit,
                    "pushed": bool(row["remote_url"])}

    @staticmethod
    def valid_repo_name(payload: dict) -> str:
        name = required_text(payload, "name", 60)
        if any(ord(c) < 32 for c in name):
            raise ApiError("仓库名称无效")
        return name

    @staticmethod
    def valid_remote_url(remote_url) -> str:
        if not isinstance(remote_url, str) or len(remote_url) > 1000 or "#" in remote_url or any(c.isspace() for c in remote_url):
            raise ApiError("Git 地址无效")
        parsed = urlparse(remote_url)
        if remote_url and not (
            (parsed.scheme in ("http", "https", "ssh") and parsed.netloc and not parsed.password
             and not (parsed.scheme in ("http", "https") and parsed.username))
            or (parsed.scheme == "file" and parsed.path.startswith("/") and not parsed.netloc)
            or (re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+", remote_url) is not None)
        ):
            raise ApiError("Git 地址需使用 HTTP(S)、SSH 或 Git 地址，且不能在地址中包含账号密码")
        return remote_url

    @staticmethod
    def valid_branch(branch) -> str:
        if not isinstance(branch, str) or not branch or len(branch) > 120 or subprocess.run(
            ["git", "check-ref-format", "--branch", branch], capture_output=True, timeout=10, check=False,
        ).returncode:
            raise ApiError("Git 分支名称无效")
        return branch

    def valid_repo_path(self, db, raw: str) -> Path:
        target = Path(raw).expanduser()
        if not target.is_absolute():
            raise ApiError("请输入服务器上的绝对路径")
        target = target.resolve()
        if target.is_relative_to(self.data_dir.resolve()) or any(
            target.is_relative_to(other) or other.is_relative_to(target)
            for other in (Path(row["local_path"]) for row in db.execute("SELECT local_path FROM code_repositories").fetchall())
        ):
            raise ApiError("代码仓库不能放在运行缓存目录内，也不能与现有仓库相互包含")
        return target

    @staticmethod
    def ensure_remote_unused(db, remote_url: str, repo_id: str = "") -> None:
        if remote_url and db.execute("SELECT 1 FROM code_repositories WHERE remote_url=? AND repo_id<>?",
                                     (remote_url, repo_id)).fetchone():
            raise ApiError("该 Git 远程地址已被其他代码仓库使用", 409)

    def create_repository(self, payload: dict, headers=None) -> dict:
        """只在服务器上建本地仓库；远程仓库由管理员在 Git 平台上自行准备。"""
        name = self.valid_repo_name(payload)
        remote_url = self.valid_remote_url(payload.get("remoteUrl", ""))
        branch = self.valid_branch(payload.get("branch") or "main")
        config_type = self.valid_config_type(payload.get("configType", ""))
        with GIT_LOCK:
            with self.store.connect() as db:
                config_type_name = self.repository_type_name(db, config_type, payload.get("configTypeName", ""), headers)
                if db.execute("SELECT 1 FROM code_repositories WHERE name=?", (name,)).fetchone():
                    raise ApiError("仓库名称已存在", 409)
                target = self.valid_repo_path(db, required_text(payload, "path", 1000))
                self.ensure_remote_unused(db, remote_url)
            if target.exists() and (not target.is_dir() or any(target.iterdir())):
                raise ApiError("目标路径已存在且不是空目录；请选择新目录或空目录", 409)
            created = not target.exists()
            repo_id = uuid.uuid4().hex
            try:
                target.mkdir(parents=True, exist_ok=True)
                self.git(target, "init")
                self.git(target, "symbolic-ref", "HEAD", f"refs/heads/{branch}")
                if remote_url:
                    self.set_git_origin(target, remote_url)
                with self.store.connect() as db:
                    db.execute("INSERT INTO code_repositories "
                               "(repo_id,name,local_path,remote_url,branch,is_default,status,created_at,updated_at,config_type,config_type_name) "
                               "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                        repo_id, name, str(target), remote_url, branch, 0, "ACTIVE", now(), now(), config_type,
                        config_type_name,
                    ))
            except Exception:
                shutil.rmtree(target if created else target / ".git", ignore_errors=True)
                raise
        return self.repository_result(repo_id)

    def update_repository(self, repo_id: str, payload: dict, headers=None) -> dict:
        with self.store.connect() as db:
            repo = self.repository(db, repo_id)
            if "name" in payload:
                name = self.valid_repo_name(payload)
                if db.execute("SELECT 1 FROM code_repositories WHERE name=? AND repo_id<>?", (name, repo_id)).fetchone():
                    raise ApiError("仓库名称已存在", 409)
                db.execute("UPDATE code_repositories SET name=?, updated_at=? WHERE repo_id=?", (name, now(), repo_id))
            if "configType" in payload:
                config_type = self.valid_config_type(payload["configType"])
                from .repository_directories import list_directories
                if config_type and any(row['configType'] not in ('', config_type) for row in list_directories(self, db, repo_id) if not row['isDefault']):
                    raise ApiError('仓库已有其他节点类型的配置目录，不能修改为此类型', 409)
                if repo["is_default"] and config_type:
                    raise ApiError("默认仓库必须是通用类型", 409)
                config_type_name = self.repository_type_name(db, config_type, payload.get("configTypeName", ""), headers)
                db.execute("UPDATE code_repositories SET config_type=?, config_type_name=?, updated_at=? WHERE repo_id=?",
                           (config_type, config_type_name, now(), repo_id))
                db.execute("DELETE FROM code_repo_rules WHERE repo_id=? AND config_type<>?", (repo_id, config_type))
            if "status" in payload:
                status = payload["status"]
                if status not in ("ACTIVE", "DISABLED"):
                    raise ApiError("仓库状态无效")
                if status == "DISABLED":
                    if repo["is_default"]:
                        raise ApiError("默认仓库不能停用，请先把其他仓库设为默认", 409)
                    if db.execute("SELECT 1 FROM code_repo_rules WHERE repo_id=?", (repo_id,)).fetchone():
                        raise ApiError("仍有旧分类规则指向该仓库，请先调整分类", 409)
                db.execute("UPDATE code_repositories SET status=?, updated_at=? WHERE repo_id=?", (status, now(), repo_id))
        if "remoteUrl" in payload or "branch" in payload:
            self.configure_repository_git(repo_id, payload.get("remoteUrl", repo["remote_url"]),
                                          payload.get("branch", repo["branch"]))
        return self.repository_result(repo_id)

    def set_default_repository(self, repo_id: str) -> dict:
        with self.store.connect() as db:
            repo = self.repository(db, repo_id)
            if repo["config_type"]:
                raise ApiError("只有通用类型仓库可以设为默认", 409)
            if repo["status"] != "ACTIVE":
                raise ApiError("已停用的仓库不能设为默认", 409)
            db.execute("UPDATE code_repositories SET is_default=0, updated_at=? WHERE is_default=1 AND repo_id<>?", (now(), repo_id))
            db.execute("UPDATE code_repositories SET is_default=1, updated_at=? WHERE repo_id=?", (now(), repo_id))
        return self.repository_result(repo_id)

    def list_repo_rules(self) -> list[dict]:
        with self.store.connect() as db:
            rows = db.execute("SELECT * FROM code_repo_rules ORDER BY config_type").fetchall()
        return [{"configType": row["config_type"], "repoId": row["repo_id"]} for row in rows]

    def save_repo_rules(self, payload: dict) -> list[dict]:
        """整批保存“配置类型 → 仓库”；repoId 为空表示该类型回到默认仓库。只影响之后新建的代码。"""
        rules = payload.get("rules")
        if not isinstance(rules, list) or len(rules) > 500:
            raise ApiError("分类规则无效")
        with self.store.connect() as db:
            for rule in rules:
                config_type = rule.get("configType") if isinstance(rule, dict) else None
                repo_id = (rule.get("repoId") or "") if isinstance(rule, dict) else ""
                if not isinstance(config_type, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", config_type):
                    raise ApiError("配置类型无效")
                db.execute("DELETE FROM code_repo_rules WHERE config_type=?", (config_type,))
                if repo_id:
                    if self.repository(db, repo_id)["status"] != "ACTIVE":
                        raise ApiError("不能把配置类型分到已停用的仓库", 409)
                    db.execute("INSERT INTO code_repo_rules VALUES (?,?,?)", (config_type, repo_id, now()))
        return self.list_repo_rules()

    def resolve_code_repository(self, db, asset, config_type: str):
        """兼容未传仓库 ID 的旧客户端；新代码先选同类型仓库，再回退通用默认仓库。"""
        if asset and asset["repo_id"]:
            repo = self.repository(db, asset["repo_id"])
        else:
            rule = db.execute("SELECT repo_id FROM code_repo_rules WHERE config_type=?", (config_type,)).fetchone() if config_type else None
            if rule:
                repo = self.repository(db, rule["repo_id"])
            else:
                repo = (db.execute("SELECT * FROM code_repositories WHERE config_type=? AND status='ACTIVE' "
                                   "ORDER BY created_at,repo_id LIMIT 1", (config_type,)).fetchone()
                        if config_type else None) or self.default_repository(db)
        if repo["status"] != "ACTIVE":
            raise ApiError(f"目标代码仓库「{repo['name']}」已停用，请调整配置类型分类", 409)
        return repo

    @staticmethod
    def valid_config_type(value) -> str:
        if not isinstance(value, str) or (value and not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", value)):
            raise ApiError("配置类型无效")
        return value

    @staticmethod
    def set_git_origin(repo: Path, remote_url: str) -> None:
        existing = subprocess.run(["git", "remote", "get-url", "origin"], cwd=repo,
                                  capture_output=True, text=True, timeout=10, check=False)
        has_origin = existing.returncode == 0
        if remote_url:
            if not has_origin:
                Application.git(repo, "remote", "add", "origin", remote_url)
            elif existing.stdout.strip() != remote_url:
                Application.git(repo, "remote", "set-url", "origin", remote_url)
        elif has_origin:
            Application.git(repo, "remote", "remove", "origin")

    @staticmethod
    def push_git(repo: Path, branch: str) -> None:
        result = subprocess.run(["git", "push", "origin", f"HEAD:refs/heads/{branch}"], cwd=repo,
                                capture_output=True, text=True, encoding="utf-8", errors="replace",
                                env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never"},
                                timeout=60, check=False)
        if result.returncode:
            raise ApiError("Git 推送失败；请检查远程地址、服务器 Git 凭据和目标分支权限。代码已留在本地仓库。", 502)

    def configure_site_script_git(self, payload: dict) -> dict:
        self.configure_repository_git(self.default_repository()["repo_id"],
                                      payload.get("remoteUrl", ""), payload.get("branch", "main"))
        return self.site_script_repo_setting()

    def configure_repository_git(self, repo_id: str, remote_url, branch) -> None:
        remote_url = self.valid_remote_url(remote_url)
        branch = self.valid_branch(branch)
        with GIT_LOCK:
            with self.store.connect() as db:
                row = self.repository(db, repo_id)
                self.ensure_remote_unused(db, remote_url, repo_id)
            old_remote = row["remote_url"]
            if remote_url == old_remote and branch == row["branch"]:
                return
            repo = Path(row["local_path"])
            has_git = (repo / ".git").is_dir()
            try:
                if has_git:
                    self.set_git_origin(repo, remote_url)
                    if remote_url and subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=repo,
                                                     capture_output=True, check=False).returncode == 0:
                        self.push_git(repo, branch)
                with self.store.connect() as db:
                    db.execute("UPDATE code_repositories SET remote_url=?, branch=?, updated_at=? WHERE repo_id=?",
                               (remote_url, branch, now(), repo_id))
                    if remote_url:
                        self.rewrite_repo_urls(db, repo.as_uri() + "#", remote_url + "#")
                    if old_remote:
                        self.rewrite_repo_urls(db, old_remote + "#", (remote_url or repo.as_uri()) + "#")
            except Exception:
                if has_git:
                    self.set_git_origin(repo, old_remote)
                raise

    @staticmethod
    def git_url_for(repo_row, commit: str, relative: Path) -> str:
        base = repo_row["remote_url"] or Path(repo_row["local_path"]).as_uri()
        return f"{base}#{commit}:{relative.as_posix()}"

    def configure_site_script_repo(self, payload: dict) -> dict:
        self.move_repository(self.default_repository()["repo_id"], payload)
        return self.site_script_repo_setting()

    def move_repository(self, repo_id: str, payload: dict) -> dict:
        raw = required_text(payload, "path", 1000)
        with self.store.connect() as db:
            current = Path(self.repository(db, repo_id)["local_path"]).resolve()
            requested = Path(raw).expanduser()
            if requested.is_absolute() and requested.resolve() == current:
                return self.as_repository(db, self.repository(db, repo_id))
            target = self.valid_repo_path(db, raw)
        with GIT_LOCK:
            existing_empty = target.exists()
            if existing_empty:
                if not target.is_dir():
                    raise ApiError("目标路径已经是文件，请选择空目录或新的目录", 409)
                if any(target.iterdir()):
                    raise ApiError("目标目录已有文件或 Git 仓库，不能直接迁移覆盖；请选择空目录或新的目录", 409)
            moved = False
            moved_into_existing = False
            moved_entries = []
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                if current.exists():
                    if existing_empty:
                        moved_into_existing = True
                        for entry in list(current.iterdir()):
                            destination = target / entry.name
                            shutil.move(str(entry), str(destination))
                            moved_entries.append((entry, destination))
                        current.rmdir()
                    else:
                        shutil.move(str(current), str(target))
                        moved = True
                with self.store.connect() as db:
                    self.rewrite_repo_urls(db, current.as_uri() + "#", target.as_uri() + "#")
                    db.execute("UPDATE code_repositories SET local_path=?, updated_at=? WHERE repo_id=?",
                               (str(target), now(), repo_id))
            except Exception as exc:
                if moved_into_existing:
                    try:
                        current.mkdir(exist_ok=True)
                        for entry, destination in reversed(moved_entries):
                            shutil.move(str(destination), str(entry))
                    except OSError as rollback_error:
                        raise ApiError(f"迁移失败，回退文件也失败；请检查 {current} 和 {target}：{rollback_error}", 500) from exc
                if moved:
                    try:
                        shutil.move(str(target), str(current))
                    except OSError as rollback_error:
                        raise ApiError(f"迁移失败，回退文件也失败；请检查 {target}：{rollback_error}", 500) from exc
                raise ApiError(f"代码仓库迁移失败：{exc}", 500) from exc
        return self.repository_result(repo_id)

    def expire_stale_runners(self) -> None:
        """Persist offline state only when the last heartbeat is older than 15 seconds."""
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=RUNNER_OFFLINE_AFTER_SECONDS)).isoformat(timespec="seconds")
        with self.store.connect() as db:
            db.execute("UPDATE runners SET status='offline' WHERE status!='offline' AND (last_heartbeat IS NULL OR last_heartbeat<?)", (cutoff,))

    def worker_token(self, assignment) -> str:
        payload = f"{assignment['assignment_id']}:{assignment['runner_id']}".encode("ascii")
        signature = hmac.new(self.worker_token_key, payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(payload).decode("ascii") + "." + base64.urlsafe_b64encode(signature).decode("ascii")

    def authenticate_worker(self, headers):
        token = headers.get("Authorization", "").removeprefix("Bearer ")
        try:
            payload_part, signature_part = token.split(".", 1)
            payload = base64.urlsafe_b64decode(payload_part.encode("ascii"))
            signature = base64.urlsafe_b64decode(signature_part.encode("ascii"))
            assignment_id, runner_id = payload.decode("ascii").split(":", 1)
        except (ValueError, UnicodeError, binascii.Error):
            raise ApiError("处理程序凭据无效", 401)
        expected = hmac.new(self.worker_token_key, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ApiError("处理程序凭据无效", 401)
        with self.store.connect() as db:
            row = db.execute("SELECT * FROM assignments WHERE assignment_id=? AND runner_id=? AND enabled=1", (assignment_id, runner_id)).fetchone()
        if not row:
            raise ApiError("处理程序分配已失效", 401)
        return row

    def authenticate_admin(self, headers, client_ip: str, write: bool = False) -> None:
        configured = os.getenv("RUNNER_ADMIN_TOKEN", "")
        supplied = headers.get("Access-Token", "") or headers.get("Authorization", "").removeprefix("Bearer ")
        if configured and hmac.compare_digest(configured, supplied):
            return
        auth_url = os.getenv("RUNNER_AUTH_URL", "")
        if auth_url:
            forwarded = {key: headers[key] for key in ("Cookie", "Access-Token") if headers.get(key)}
            if not forwarded:
                raise ApiError("请先登录", 401)
            try:
                with urlopen(Request(auth_url, headers=forwarded), timeout=5) as response:
                    payload = json.load(response)
            except HTTPError as exc:
                if exc.code in (401, 403):
                    raise ApiError("登录状态验证失败", 401) from exc
                raise ApiError("认证服务请求失败，请检查管理服务的登录校验配置", 502) from exc
            except (URLError, TimeoutError, OSError, ValueError) as exc:
                raise ApiError("认证服务不可用或返回格式错误，请检查登录校验地址", 502) from exc
            if not isinstance(payload, dict):
                raise ApiError("认证服务返回格式错误，请检查登录校验地址", 502)
            if str(payload.get("code")) != "0" or not payload.get("data"):
                raise ApiError("请先登录", 401)
            if not isinstance(payload["data"], dict):
                raise ApiError("认证服务返回的用户信息格式错误", 502)
            roles = payload["data"].get("roles", [])
            if write and "admin" not in roles:
                raise ApiError("需要管理员权限", 403)
            return
        if os.getenv("RUNNER_DEV_MODE") == "1" and client_ip in ("127.0.0.1", "::1"):
            return
        raise ApiError("管理服务尚未配置用户认证", 503)

    def authenticate_runner(self, headers) -> dict:
        token = headers.get("Authorization", "").removeprefix("Bearer ")
        if not token:
            raise ApiError("缺少 Runner 实例凭据", 401)
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.store.connect() as db:
            row = db.execute("SELECT * FROM runners WHERE token_hash=?", (digest,)).fetchone()
        if not row:
            raise ApiError("Runner 实例凭据无效", 401)
        return dict(row)

    def enroll(self, payload: dict, local_auto: bool = False) -> dict:
        code = str(payload.get("code") or "").strip()
        package_token = payload.get("packageToken", "")
        if not isinstance(package_token, str) or len(package_token) > 128:
            raise ApiError("包内接入凭据无效", 403)
        if not code and not package_token and not local_auto:
            raise ApiError("首次登记需要登记码", 403)
        if len(code) > 128:
            raise ApiError("登记码长度无效")
        ip = required_text(payload, "ipAddress", 64)
        platform = required_text(payload, "platform", 64)
        from .runner_identity import install_directory, directory_key, reported_name
        try:
            directory = install_directory(payload.get('installDirectory'), platform)
            name = reported_name(payload.get('name') or payload.get('hostName'), ip)
        except ValueError as exc:
            raise ApiError(str(exc)) from exc
        os_type, os_version = reported_os(payload)
        capabilities = payload.get("capabilities", [])
        if not isinstance(capabilities, list) or not all(isinstance(x, str) for x in capabilities):
            raise ApiError("capabilities 无效")
        runner_id, token = str(uuid.uuid4()), secrets.token_urlsafe(48)
        with self.store.connect() as db:
            row = None
            if package_token:
                authorization = db.execute("SELECT setting_value FROM settings WHERE setting_key=?", (
                    "portable-enroll:" + hashlib.sha256(package_token.encode()).hexdigest(),)).fetchone()
                if not authorization or json.loads(authorization['setting_value'])['expiresAt'] < now():
                    raise ApiError("包内登记码无效或已过期，请重新下载 Runner 包或使用远程接入码", 403)
            elif code:
                row = db.execute("SELECT * FROM enrollment_codes WHERE code_hash=?", (hashlib.sha256(code.encode()).hexdigest(),)).fetchone()
                if not row or row["used_at"] or row["expires_at"] < now():
                    raise ApiError("登记码无效或已过期", 403)
            for existing in db.execute('SELECT install_directory,platform FROM runners WHERE ip_address=?', (ip,)).fetchall():
                if existing['platform'] != platform:
                    continue
                try:
                    duplicate = directory_key(existing['install_directory'], platform, legacy=True) == directory_key(directory, platform)
                except ValueError:
                    duplicate = existing['install_directory'] == directory
                if duplicate:
                    raise ApiError("该机器 IP 与目录已有实例", 409)
            db.execute("INSERT INTO runners (runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status,last_heartbeat,desired_digest,actual_digest,last_error,os_type,os_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                runner_id, name, ip, directory,
                platform, json.dumps(capabilities), hashlib.sha256(token.encode()).hexdigest(),
                "offline", None, None, None, None, os_type, os_version,
            ))
            if row:
                db.execute("UPDATE enrollment_codes SET used_at=? WHERE code_hash=?", (now(), row["code_hash"]))
        return {"runnerId": runner_id, "token": token, "publicKey": self.artifacts.public_key}

    def publish_script(self, payload: dict) -> dict:
        if payload.get("queueName"):
            return self.publish_site_code(payload)
        config_id = required_text(payload, "configId", 80)
        file_name = required_text(payload, "fileName", 120)
        code = payload.get("code")
        if not isinstance(code, str) or not code.strip() or len(code) > 200_000:
            raise ApiError("代码不能为空或超过长度限制")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", config_id) or not re.fullmatch(r"[a-z0-9.-]+\.py", file_name, re.I):
            raise ApiError("配置 ID 或文件名无效")
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            raise ApiError(f"Python 语法错误：第 {exc.lineno} 行", 422) from exc
        if not any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "scrape" and node.args.args and node.args.args[0].arg == "url" for node in tree.body):
            raise ApiError("代码必须包含 scrape(url)", 422)
        repo_row = self.default_repository()
        repo = Path(repo_row["local_path"])
        relative = Path("scripts") / config_id / file_name
        with GIT_LOCK:
            repo.mkdir(parents=True, exist_ok=True)
            if not (repo / ".git").exists():
                self.git(repo, "init")
            target = repo / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(code, encoding="utf-8")
            self.git(repo, "add", "--", str(relative))
            changed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo, check=False).returncode != 0
            if changed:
                self.git(repo, "-c", "user.name=Runner Builder", "-c", "user.email=runner@localhost", "commit", "-m", f"Publish {config_id}/{file_name}")
            commit = self.git(repo, "rev-parse", "HEAD").strip()
            if repo_row["remote_url"]:
                self.set_git_origin(repo, repo_row["remote_url"])
                self.push_git(repo, repo_row["branch"])
            git_url = self.git_url_for(repo_row, commit, relative)
        digest, signature = self.artifacts.publish({file_name: code.encode("utf-8")}, {"kind": "script", "entry": file_name, "configId": config_id})
        with self.store.connect() as db:
            db.execute("INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)", (
                digest, "script", file_name, "any", commit, "published", now(), signature, file_name, git_url,
            ))
        return {"gitUrl": git_url, "gitCommit": commit, "scriptDigest": digest}

    def publish_site_code(self, payload: dict) -> dict:
        """Commit an environment-neutral code asset; runtime bindings are separate."""
        config_id = required_text(payload, "configId", 80)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", config_id):
            raise ApiError("配置 ID 无效")
        queue = valid_queue(required_text(payload, "queueName", 120))
        name_mode = payload.get('fileNameMode')
        if name_mode is not None and name_mode not in ('website', 'queue'):
            raise ApiError('文件命名方式无效')
        named_file = required_text(payload, 'fileName', 120) if name_mode else ''
        if name_mode:
            if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.py', named_file)
                    or '..' in named_file):
                raise ApiError('Python 文件名无效')
            valid_queue(named_file)
            if name_mode == 'queue' and named_file != queue + '.py':
                raise ApiError('文件名与队列名称不一致')
        requested_code_id = payload.get('codeId')
        if requested_code_id is not None and (not name_mode or not isinstance(requested_code_id, str)
                or not re.fullmatch(r'[0-9a-f]{32}', requested_code_id)):
            raise ApiError('节点代码 ID 无效')
        role = payload.get("codeType", "site")
        if role not in ("site", "default"):
            raise ApiError("代码类型无效")
        site_host = ""
        if role == "site" and not name_mode:
            site_host = required_text(payload, "siteHost", 253).lower()
            if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", site_host) or "." not in site_host or ".." in site_host:
                raise ApiError("网站域名无效")
        delivery_path = named_file if name_mode else f"sites/{site_host}.py" if site_host else f"{queue}.py"
        code = payload.get("code")
        if not isinstance(code, str) or not code.strip() or len(code.encode("utf-8")) > 200_000:
            raise ApiError("代码不能为空或超过长度限制")
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            raise ApiError(f"Python 语法错误：第 {exc.lineno} 行", 422) from exc
        if not any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "scrape"
                   and node.args.args and node.args.args[0].arg == "url" for node in tree.body):
            raise ApiError("代码必须包含 scrape(url)", 422)
        prompt = str(payload.get("prompt") or "")[:12000]
        if 'userPrompt' in payload:
            if not isinstance(payload['userPrompt'], str) or len(payload['userPrompt']) > 12000:
                raise ApiError('用户提示词无效或超过 12000 字')
            prompt = payload['userPrompt'].strip()
        system_prompt = payload.get('systemPrompt', '')
        if not isinstance(system_prompt, str) or len(system_prompt) > 12000:
            raise ApiError('系统提示词无效或超过 12000 字')
        system_prompt = system_prompt.strip()
        prompt_template_id = payload.get('promptTemplateId', 0)
        if type(prompt_template_id) is not int or not 0 <= prompt_template_id <= 9007199254740991:
            raise ApiError('所选提示词 ID 无效')
        source_url = str(payload.get("url") or "")[:2000]
        config_type = self.valid_config_type(payload.get("configType") or "")
        requested_repo_id = payload.get("repositoryId")
        requested_directory_id = payload.get('directoryId')
        if requested_directory_id is not None and (not isinstance(requested_directory_id, str) or
                requested_directory_id != 'default' and not re.fullmatch(r'[0-9a-f]{32}', requested_directory_id)):
            raise ApiError('仓库配置目录 ID 无效')
        source_repo_path = payload.get("sourceFilePath") or ""
        source_git_commit = payload.get("sourceGitCommit") or ""
        if source_repo_path or source_git_commit:
            if (not isinstance(source_repo_path, str) or not source_repo_path.lower().endswith(".py")
                    or len(source_repo_path) > 500 or not isinstance(source_git_commit, str)
                    or not re.fullmatch(r"[0-9a-f]{40}", source_git_commit)):
                raise ApiError("仓库来源文件或 Git 提交无效")
            source_parts = source_repo_path.replace("\\", "/").split("/")
            if (source_repo_path.startswith(("/", "\\")) or ":" in source_repo_path
                    or any(not part or part in (".", "..") or part.lower() == ".git" for part in source_parts)):
                raise ApiError("仓库来源文件路径无效")
        if requested_repo_id is not None and (not isinstance(requested_repo_id, str) or
                                               not re.fullmatch(r"[0-9a-f]{32}", requested_repo_id)):
            raise ApiError("代码仓库 ID 无效")
        with GIT_LOCK:
            with self.store.connect() as db:
                if isinstance(self.store, MySqlStore):
                    configured = db.execute("SELECT CONFIG_TYPE AS config_type FROM cs_config WHERE CONFIG_ID=?",
                                            (config_id,)).fetchone()
                    if not configured:
                        raise ApiError("节点配置不存在，请先保存节点", 404)
                    actual_type = str(configured["config_type"] or "")
                    if config_type and config_type != actual_type:
                        raise ApiError("节点配置类型与数据库中的配置不一致", 409)
                    config_type = actual_type
                if requested_code_id:
                    asset = db.execute('SELECT * FROM code_assets WHERE code_id=?', (requested_code_id,)).fetchone()
                    if not asset or asset['config_id'] != config_id or asset['queue_name'] != queue:
                        raise ApiError('节点代码不属于当前配置和队列', 409)
                    # Existing website bindings are compatibility metadata. A
                    # filename choice never changes a running asset's identity.
                    site_host = asset['site_host']
                else:
                    asset = db.execute(
                        "SELECT * FROM code_assets WHERE config_id=? AND queue_name=? AND site_host=?",
                        (config_id, queue, site_host),
                    ).fetchone()
                if requested_repo_id:
                    repo_row = self.repository(db, requested_repo_id)
                    if repo_row["status"] != "ACTIVE":
                        raise ApiError("所选代码仓库已停用", 409)
                    if repo_row["config_type"] not in ("", config_type):
                        raise ApiError("所选代码仓库不适用于该配置类型", 409)
                else:
                    repo_row = self.resolve_code_repository(db, asset, config_type)
                if source_repo_path:
                    source_snapshot = subprocess.run(
                        ["git", "show", f"{source_git_commit}:{'/'.join(source_parts)}"],
                        cwd=Path(repo_row["local_path"]), capture_output=True, timeout=20, check=False)
                    if source_snapshot.returncode or len(source_snapshot.stdout) > 200_000 or b"\0" in source_snapshot.stdout:
                        raise ApiError("仓库来源提交或 Python 文件不可用，请重新选择文件", 409)
                repo = Path(repo_row["local_path"])
                code_id = asset["code_id"] if asset else uuid.uuid4().hex
                from .repository_directories import get_directory, safe_directory
                if requested_directory_id or name_mode:
                    requested_directory_id = requested_directory_id or (asset['directory_id'] if asset and asset['repo_id'] == repo_row['repo_id'] else '') or 'default'
                    directory = get_directory(self, db, repo_row['repo_id'], requested_directory_id, config_type)
                    include_config_id = payload.get('includeConfigId', False)
                    if type(include_config_id) is not bool:
                        raise ApiError('配置 ID 目录选项无效')
                    prefix = config_id if include_config_id and Path(directory['path']).name != config_id else ''
                    relative = Path(directory['path']) / prefix / Path(delivery_path).name
                elif asset and asset['repo_id'] == repo_row['repo_id'] and asset['directory_id']:
                    relative = Path(asset['storage_path'])
                    requested_directory_id = asset['directory_id'] or ''
                    if requested_directory_id:
                        get_directory(self, db, repo_row['repo_id'], requested_directory_id, config_type)
                else:
                    # Older callers omit directory metadata. Resolve the managed
                    # save directory instead of inventing a second code/ layer.
                    from .generation_destinations import automatic
                    selected = automatic(self, {'configId': config_id, 'queueName': queue, 'configType': config_type})
                    config_type = selected['configType']
                    if not requested_repo_id:
                        repo_row = self.repository(db, selected['repositoryId'])
                        repo = Path(repo_row['local_path'])
                    requested_directory_id = selected['directoryId'] if selected['repositoryId'] == repo_row['repo_id'] else 'default'
                    directory = get_directory(self, db, repo_row['repo_id'], requested_directory_id, config_type)
                    prefix = config_id if Path(directory['path']).name != config_id else ''
                    relative = Path(directory['path']) / prefix / f"{code_id}.py"
                if (name_mode or requested_directory_id) and db.execute(
                        'SELECT 1 FROM code_assets WHERE repo_id=? AND storage_path=? AND code_id<>? '
                        'UNION ALL SELECT 1 FROM code_versions v JOIN code_assets a ON a.code_id=v.code_id '
                        'WHERE COALESCE(NULLIF(v.repo_id,\'\'),a.repo_id)=? AND '
                        'COALESCE(NULLIF(v.repository_storage_path,\'\'),a.storage_path)=? AND a.code_id<>?',
                        (repo_row['repo_id'], relative.as_posix(), code_id, repo_row['repo_id'], relative.as_posix(), code_id)).fetchone():
                    raise ApiError('该保存路径已被其他节点代码引用，请更换文件名或配置目录', 409)
                # All destination components must remain within the repository.
                safe_directory(self, repo_row, relative.parent.as_posix())
                target = repo / relative
                if target.is_symlink() or not target.resolve().is_relative_to(repo.resolve()):
                    raise ApiError('代码保存路径不能指向仓库外部')
                repo.mkdir(parents=True, exist_ok=True)
                if not (repo / ".git").exists():
                    self.git(repo, "init")
                if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=repo, capture_output=True, timeout=10).returncode:
                    raise ApiError('仓库已有暂存文件，请先处理后再保存节点代码', 409)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(code, encoding="utf-8")
                self.git(repo, "add", "--", str(relative))
                changed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo, check=False).returncode != 0
                if changed:
                    self.git(repo, "-c", "user.name=Runner Builder", "-c", "user.email=runner@localhost",
                             "commit", "-m", f"Publish {config_id}/{queue}/{site_host or 'default'}")
                commit = self.git(repo, "rev-parse", "HEAD").strip()
                if repo_row["remote_url"]:
                    self.set_git_origin(repo, repo_row["remote_url"])
                    self.push_git(repo, repo_row["branch"])
                git_url = self.git_url_for(repo_row, commit, relative)
                published_at = datetime.now(timezone.utc).isoformat()
                artifact_manifest = {"kind": "script", "entry": delivery_path, "configId": config_id,
                                     "queueName": queue, "siteHost": site_host,
                                     "promptDigest": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                                     "sourceUrl": source_url, "repositoryId": repo_row["repo_id"],
                                     "layoutSchema": 2, "directoryTemplate": "{configId}",
                                     "versionFile": "version.json", "codeId": code_id, "directories": [],
                                     "sources": [{"repoId": repo_row["repo_id"], "repoName": repo_row["name"],
                                                  "sourcePath": relative.as_posix(), "sourceType": "file",
                                                  "gitCommit": commit, "targetPath": delivery_path}]}
                if name_mode:
                    artifact_manifest['fileNameMode'] = name_mode
                if system_prompt:
                    artifact_manifest['systemPromptDigest'] = hashlib.sha256(system_prompt.encode('utf-8')).hexdigest()
                if prompt_template_id:
                    artifact_manifest['promptTemplateId'] = prompt_template_id
                if source_repo_path:
                    artifact_manifest.update(sourceFilePath=source_repo_path, sourceGitCommit=source_git_commit)
                digest, signature = self.artifacts.publish(
                    {delivery_path: code.encode("utf-8")},
                    artifact_manifest,
                )
                if not asset:
                    db.execute(
                        "INSERT INTO code_assets (code_id, config_id, queue_name, site_host, storage_path, created_at, repo_id, config_type) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (code_id, config_id, queue, site_host, relative.as_posix(), now(), repo_row["repo_id"], config_type),
                    )
                else:
                    # Freeze historical locations before moving the asset's
                    # current save destination; old Git links keep their meaning.
                    db.execute("UPDATE code_versions SET repository_storage_path=? WHERE code_id=? AND repository_storage_path=''",
                               (asset['storage_path'], code_id))
                db.execute('UPDATE code_assets SET storage_path=?,repo_id=?,directory_id=?,config_type=? WHERE code_id=?',
                           (relative.as_posix(), repo_row['repo_id'], requested_directory_id or '', config_type, code_id))
                db.execute("INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)", (
                    digest, "script", site_host or queue, "any", commit, "published", now(),
                    signature, delivery_path, git_url,
                ))
                db.execute("INSERT OR IGNORE INTO code_versions "
                           "(digest,code_id,git_commit,git_url,delivery_path,prompt,source_url,published_at,repo_id,source_repo_path,source_git_commit,repository_directory_id,repository_storage_path,system_prompt,prompt_template_id) "
                           "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    digest, code_id, commit, git_url, delivery_path, prompt, source_url, published_at, repo_row["repo_id"],
                    source_repo_path, source_git_commit, requested_directory_id or '', relative.as_posix(), system_prompt, prompt_template_id,
                ))
                from .script_file_links import PREFIX as FILE_LINK_PREFIX
                db.execute('DELETE FROM settings WHERE setting_key=?', (FILE_LINK_PREFIX + code_id,))
                row = db.execute(
                    CODE_VERSION_SELECT + "WHERE v.digest=?",
                    (digest,),
                ).fetchone()
        return as_code_version(row)

    @staticmethod
    def git(repo: Path, *args: str) -> str:
        result = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, check=False)
        if result.returncode:
            raise ApiError("本地 Git 提交失败，请检查 Git 安装与存储目录", 500)
        return result.stdout

    def create_code_assignment(self, payload: dict) -> dict:
        """Select node code once; derive its queue and the compatible worker release."""
        runner_id = required_text(payload, "runnerId", 80)
        script_digest = required_text(payload, "scriptDigest", 100)
        concurrency = payload.get("concurrency", 1)
        environment = payload.get("environment", "test")
        if type(concurrency) is not int or not 1 <= concurrency <= 100 or environment not in ("test", "production"):
            raise ApiError("并发数或运行环境无效")
        with self.store.connect() as db:
            runner = db.execute("SELECT * FROM runners WHERE runner_id=?", (runner_id,)).fetchone()
            code = db.execute(CODE_VERSION_SELECT + "WHERE v.digest=?", (script_digest,)).fetchone()
            release = db.execute("SELECT * FROM releases WHERE digest=? AND kind='script' AND status='published'",
                                 (script_digest,)).fetchone()
            if not runner or not code or not release:
                raise ApiError("Runner 实例或节点代码无效")
            if db.execute("SELECT 1 FROM assignments WHERE runner_id=? AND queue=?", (runner_id, code["queue_name"])).fetchone():
                raise ApiError("该实例已分配此队列", 409)
            processor = db.execute(
                "SELECT digest FROM releases WHERE kind='processor' AND name='newslink_nourl' AND status='published' "
                "AND platform IN (?, 'any') ORDER BY published_at DESC,digest DESC LIMIT 1", (runner["platform"],)
            ).fetchone()
        processor_digest = processor["digest"] if processor else self.publish_processor({"processorType": "newslink_nourl"})["digest"]
        with GIT_LOCK, self.store.connect() as db:
            queue = code["queue_name"]
            if db.execute("SELECT 1 FROM assignments WHERE runner_id=? AND queue=?", (runner_id, queue)).fetchone():
                raise ApiError("该实例已分配此队列", 409)
            binding_keys = (valid_environment(environment), code["config_id"], queue, code["site_host"])
            binding = db.execute(
                "SELECT digest FROM code_runtime_bindings WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?",
                binding_keys,
            ).fetchone()
            if binding and binding["digest"] != script_digest and db.execute(
                "SELECT 1 FROM assignments WHERE queue=? AND environment=? AND enabled=1", (queue, environment)
            ).fetchone():
                raise ApiError("该配置在此环境已有其他代码版本正在使用，请选择已采用的版本，或先在运行配置 → 运行版本中应用所选版本", 409)
            if binding:
                db.execute("UPDATE code_runtime_bindings SET digest=? WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?",
                           (script_digest, *binding_keys))
            else:
                db.execute("INSERT INTO code_runtime_bindings VALUES (?,?,?,?,?)", (*binding_keys, script_digest))
            assignment_id = str(uuid.uuid4())
            db.execute("INSERT INTO assignments (assignment_id,runner_id,queue,processor_type,release_digest,concurrency,enabled,environment,code_id) "
                       "VALUES (?,?,?,?,?,?,?,?,?)", (assignment_id, runner_id, queue, "newslink_nourl", processor_digest, concurrency, 1, environment, code["code_id"]))
            db.execute("INSERT OR IGNORE INTO config_runner_bindings VALUES (?,?,?)", (code["config_id"], runner_id, now()))
            return as_assignment(db.execute(ASSIGNMENT_SELECT + "WHERE x.assignment_id=?", (assignment_id,)).fetchone())

    def publish_processor(self, payload: dict) -> dict:
        processor_type = required_text(payload, "processorType", 100)
        if processor_type not in ("probe", "newslink_nourl"):
            raise ApiError("暂不支持该处理程序类型")
        files: dict[str, bytes] = {}
        if processor_type == "probe":
            entry = "probe_worker.py"
            files[entry] = (ROOT / "runner_management" / entry).read_bytes()
        else:
            entry = "newslink_nourl.py"
            source = ROOT / "legacy_qinlongclaw"
            for name in ("newslink_nourl.py", "newsContSnatch.py", "queue_url_history.py", "save_batches.py"):
                files[name] = (source / name).read_bytes()
            for folder in ("link_extractor", "content_extractor"):
                for path in (source / folder).rglob("*.py"):
                    files[path.relative_to(source).as_posix()] = path.read_bytes()
            files["link_extractor/requirements.txt"] = (source / "link_extractor" / "requirements.txt").read_bytes()
        manifest = {"kind": "processor", "entry": entry, "processorType": processor_type}
        if processor_type == 'newslink_nourl':
            manifest['deploymentSchema'] = 1
        digest, signature = self.artifacts.publish(files, manifest)
        with self.store.connect() as db:
            db.execute("INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)", (
                digest, "processor", processor_type, "any", "local", "published", now(), signature, entry, "local-source",
            ))
        return {"digest": digest, "signature": signature}

    def publish_runner(self) -> dict:
        root = Path(__file__).parent
        files = {f"runner_management/{path.name}": path.read_bytes() for path in root.glob("*.py")}
        digest, signature = self.artifacts.publish(files, {"kind": "runner", "entryModule": "runner_management.runner"})
        with self.store.connect() as db:
            inserted = db.execute("INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)", (
                digest, "runner", "native-runner", "any", "local", "published", now(),
                signature, "runner_management.runner", "local-source",
            ))
        return {"digest": digest, "signature": signature, "created": inserted.rowcount > 0}


class Handler(BaseHTTPRequestHandler):
    application: Application

    def respond(self, status: int, body) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def json_body(self, max_size: int = MAX_JSON) -> dict:
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            raise ApiError("请求必须使用 application/json", 415)
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= max_size:
            raise ApiError("请求体大小无效", 413)
        payload = json.loads(self.rfile.read(size))
        if not isinstance(payload, dict):
            raise ApiError("请求体必须是 JSON 对象")
        return payload

    def dispatch(self, method: str) -> None:
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            upload = re.fullmatch(r"/api/runner-management/settings/code-repos/[0-9a-f]{32}/files", path)
            code_files = re.fullmatch(r'/api/runner-management/code-servers/[0-9a-f-]+/files', path)
            limit = MAX_UPLOAD_JSON if upload or code_files else MAX_SCRIPT_JSON if path == '/api/runner-management/site-scripts/publish' else MAX_JSON
            body = self.json_body(limit) if method == "POST" else None
            # Empty since explicitly means all time. Do not silently restore the 24h default.
            keep_empty = path == '/api/runner-management/runtime-operations'
            result = self.route(method, path, body, parse_qs(parsed.query, keep_blank_values=keep_empty))
            if result is not RESPONSE_SENT:
                self.respond(200, result)
        except ApiError as exc:
            self.respond(exc.status, {"message": str(exc)})
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.respond(400, {"message": "请求参数无效"})
        except Exception:
            self.respond(500, {"message": "Runner 管理服务内部错误"})

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def route(self, method: str, path: str, body: dict | None, query: dict | None = None):
        app = self.application
        query = query or {}
        if method == "GET" and path == "/health":
            return {"ok": True}
        if method == 'POST' and path == '/api/code-servers/enroll':
            from .code_servers import enroll
            return enroll(app, body)
        if method == 'POST' and path == '/api/code-servers/me/heartbeat':
            from .code_servers import heartbeat
            return heartbeat(app, self.headers, body)
        if path.startswith('/api/code-servers/me/'):
            from .code_server_upgrades import personal
            return personal(self,app,method,path,body)
        if method == "POST" and path == "/api/runners/enroll":
            local_auto = (os.getenv("RUNNER_DEV_MODE") == "1"
                          and self.client_address[0] in ("127.0.0.1", "::1")
                          and self.server.server_address[0] in ("127.0.0.1", "::1"))
            return app.enroll(body, local_auto=local_auto)
        if path.startswith("/api/runners/me/"):
            runner = app.authenticate_runner(self.headers)
            process_stop = re.fullmatch(r'/api/runners/me/process-stops/([0-9a-f]{32})/result', path)
            if method == 'POST' and process_stop:
                from .process_control import acknowledge
                return acknowledge(app, runner['runner_id'], process_stop.group(1), body)
            if method == 'POST' and path == '/api/runners/me/runtime-events':
                from .runtime_history import ingest_event
                return ingest_event(app, runner['runner_id'], body)
            if method == 'POST' and path == '/api/runners/me/log-batches':
                from .runtime_history import ingest_logs
                return ingest_logs(app, runner['runner_id'], body)
            if method == "GET" and path == "/api/runners/me/directory-deliveries":
                from .directory_delivery import pending_deliveries
                return pending_deliveries(app, runner['runner_id'])
            delivery_result = re.fullmatch(r"/api/runners/me/directory-deliveries/([0-9a-f]{32})/(claim|result)", path)
            if method == "POST" and delivery_result:
                from .directory_delivery import runner_delivery
                result = runner_delivery(app, runner['runner_id'], *delivery_result.groups(), body)
                from .runtime_history import delivery_result as record_delivery_result
                record_delivery_result(app, result, delivery_result.group(2))
                return result
            if method == "GET" and path == "/api/runners/me/configs":
                from .directory_layout import runner_config_layouts
                return runner_config_layouts(app, runner["runner_id"])
            if method == "GET" and path == "/api/runners/me/directory-layouts":
                from .directory_bindings import runner_directory_layouts
                return runner_directory_layouts(app, runner["runner_id"])
            if method == "GET" and path == "/api/runners/me/assignments":
                with app.store.connect() as db:
                    rows = db.execute(ASSIGNMENT_SELECT + "WHERE x.runner_id=? AND x.enabled=1", (runner["runner_id"],)).fetchall()
                    from .runtime_history import assignment_contexts
                    return assignment_contexts(app, db, [{**as_assignment(row), "workerToken": app.worker_token(row)} for row in rows])
            if method == "GET" and path == "/api/runners/me/desired-runner":
                with app.store.connect() as db:
                    row = db.execute("SELECT desired_digest FROM runner_upgrades WHERE runner_id=?", (runner["runner_id"],)).fetchone()
                return {"digest": row["desired_digest"] if row else None}
            if method == "GET" and path == "/api/runners/me/status":
                app.expire_stale_runners()
                with app.store.connect() as db:
                    row = db.execute("SELECT actual_digest, status, last_heartbeat FROM runners WHERE runner_id=?", (runner["runner_id"],)).fetchone()
                return {"actualDigest": row["actual_digest"], "status": row["status"], "lastHeartbeat": row["last_heartbeat"],
                        "installDirectory": runner["install_directory"]}
            if method == "POST" and path == "/api/runners/me/heartbeat":
                runner_pid, worker_processes = heartbeat_processes(body)
                os_type, os_version = reported_os(body)
                from .runner_identity import reported_name
                try:
                    host_name = reported_name(body.get('hostName'), None)
                except ValueError as exc:
                    raise ApiError(str(exc)) from exc
                with app.store.connect() as db:
                    if host_name and runner['name'] in ('', runner['ip_address'], socket.gethostname()):
                        db.execute('UPDATE runners SET name=? WHERE runner_id=?', (host_name, runner['runner_id']))
                    launcher_version = body.get('launcherVersion')
                    if isinstance(launcher_version, str) and 0 < len(launcher_version) <= 80:
                        db.execute('UPDATE runners SET launcher_version=? WHERE runner_id=?', (launcher_version, runner['runner_id']))
                    capabilities = json.loads(runner['capabilities'])
                    capabilities = [value for value in capabilities if value != 'deployment-entry']
                    if body.get('executionSchema') == 2:
                        capabilities.append('deployment-entry')
                    capabilities = [value for value in capabilities if value != 'runtime-logs']
                    if body.get('logSchema') == 1:
                        capabilities.append('runtime-logs')
                    capabilities = [value for value in capabilities if value != 'retry-policy']
                    if body.get('retryPolicySchema') == 1:
                        capabilities.append('retry-policy')
                    capabilities = [value for value in capabilities if value != 'process-control']
                    if body.get('processControlSchema') == 2:
                        capabilities.append('process-control')
                    db.execute('UPDATE runners SET capabilities=? WHERE runner_id=?',
                               (json.dumps(capabilities), runner['runner_id']))
                    db.execute("UPDATE runners SET status=?, last_heartbeat=?, actual_digest=?, worker_digests=?, last_error=?, ip_address=?, runner_pid=?, worker_processes=?, os_type=COALESCE(?,os_type), os_version=COALESCE(?,os_version) WHERE runner_id=?", (
                        "online" if not body.get("lastError") else "error", now(), body.get("runnerDigest"), body.get("workerDigests"),
                        str(body.get("lastError") or "")[:500], str(body.get("ipAddress") or runner["ip_address"]), runner_pid, worker_processes, os_type, os_version, runner["runner_id"],
                    ))
                return {"ok": True}
        if method == "GET" and re.fullmatch(r"/api/workers/configs/[A-Za-z0-9_-]+/script-release", path):
            assignment = app.authenticate_worker(self.headers)
            config_id = path.split("/")[-2]
            with app.store.connect() as db:
                queue = (query.get("queue") or [""])[0]
                environment = (query.get("environment") or [""])[0]
                host = (query.get("host") or [""])[0].lower()
                if queue or environment:
                    if queue != assignment["queue"] or valid_environment(environment) != valid_environment(assignment["environment"]):
                        raise ApiError("处理程序与队列运行配置不匹配", 403)
                    if host and (not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", host) or ".." in host):
                        raise ApiError("网站域名无效")
                    pinned = (query.get("digest") or [""])[0]
                    configured = db.execute(CODE_VERSION_SELECT +
                        'JOIN code_runtime_bindings b ON b.digest=v.digest WHERE a.code_id=? AND b.environment=? '
                        'AND a.config_id=? AND a.queue_name=?',
                        (assignment['code_id'], valid_environment(environment), config_id, queue)).fetchone()
                    if configured and json.loads(optional(configured, 'layout_json') or '{}').get('deploymentId'):
                        # An explicit deployment chooses its entry and tree.
                        # Filename/legacy host metadata cannot override it.
                        if not pinned or pinned == configured['digest']:
                            return as_code_version(configured)
                        historical = db.execute(CODE_VERSION_SELECT +
                            "JOIN releases p ON p.digest=v.digest WHERE v.digest=? AND a.code_id=? "
                            "AND a.config_id=? AND a.queue_name=? AND p.status='published'",
                            (pinned, assignment['code_id'], config_id, queue)).fetchone()
                        if historical:
                            return as_code_version(historical)
                        raise ApiError('任务指定的代码版本与部署节点不匹配', 409)
                    if pinned:
                        row = db.execute(CODE_VERSION_SELECT +
                            "JOIN releases p ON p.digest=v.digest WHERE v.digest=? AND a.config_id=? "
                            "AND a.queue_name=? AND a.site_host IN (?, '') AND p.status='published'",
                            (pinned, config_id, queue, host)).fetchone()
                        if not row:
                            legacy = db.execute(
                                "SELECT b.config_id,r.* FROM script_bindings b JOIN releases r ON r.digest=b.script_digest WHERE b.config_id=?",
                                (config_id,)).fetchone()
                            if legacy:
                                return as_binding(legacy)
                            raise ApiError("任务指定的代码版本与节点队列不匹配", 409)
                        return as_code_version(row)
                    row = db.execute(
                        "SELECT a.*,v.* FROM code_runtime_bindings b "
                        "JOIN code_versions v ON v.digest=b.digest "
                        "JOIN code_assets a ON a.code_id=v.code_id "
                        "WHERE b.environment=? AND b.config_id=? AND b.queue_name=? AND b.site_host=?",
                        (valid_environment(environment), config_id, queue, host),
                    ).fetchone() if host else None
                    if not row:
                        row = db.execute(
                            "SELECT a.*,v.* FROM code_runtime_bindings b "
                            "JOIN code_versions v ON v.digest=b.digest "
                            "JOIN code_assets a ON a.code_id=v.code_id "
                            "WHERE b.environment=? AND b.config_id=? AND b.queue_name=? AND b.site_host=''",
                            (valid_environment(environment), config_id, queue),
                        ).fetchone()
                    if row:
                        return as_code_version(row)
                    legacy = db.execute(
                        "SELECT b.config_id, r.* FROM script_bindings b JOIN releases r "
                        "ON r.digest=b.script_digest WHERE b.config_id=?", (config_id,),
                    ).fetchone()
                    return as_binding(legacy) if legacy else None
                row = db.execute("SELECT b.config_id, r.* FROM script_bindings b JOIN releases r ON r.digest=b.script_digest WHERE b.config_id=?", (config_id,)).fetchone()
                return as_binding(row) if row else None
        if method == "GET" and path.startswith("/api/artifacts/"):
            digest = path.removeprefix("/api/artifacts/")
            with app.store.connect() as db:
                release = db.execute("SELECT * FROM releases WHERE digest=? AND status='published'", (digest,)).fetchone()
                try:
                    runner = app.authenticate_runner(self.headers)
                except ApiError:
                    runner = None
                if runner:
                    delivery = db.execute('SELECT signature FROM directory_deliveries WHERE runner_id=? AND artifact_digest=?',
                                          (runner['runner_id'], digest)).fetchone()
                    assigned = db.execute("SELECT 1 FROM assignments WHERE runner_id=? AND enabled=1 AND release_digest=?", (runner["runner_id"], digest)).fetchone()
                    has_queue = db.execute("SELECT 1 FROM assignments WHERE runner_id=? AND enabled=1", (runner["runner_id"],)).fetchone()
                    desired_runner = db.execute("SELECT 1 FROM runner_upgrades WHERE runner_id=? AND desired_digest=?", (runner["runner_id"], digest)).fetchone()
                    allowed = delivery or (release and (assigned or (release["kind"] == "script" and has_queue) or (release["kind"] == "runner" and desired_runner)))
                else:
                    delivery = None
                    app.authenticate_worker(self.headers)
                    allowed = release and release["kind"] == "script"
            if not allowed:
                raise ApiError("无权下载该制品", 403)
            data = app.artifacts.read(digest)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Artifact-Signature", delivery['signature'] if delivery else release["signature"])
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return RESPONSE_SENT
        prefix = "/api/runner-management"
        if not path.startswith(prefix):
            raise ApiError("接口不存在", 404)
        sub = path[len(prefix):]
        file_read = (method == 'POST' and re.fullmatch(r'/code-servers/[0-9a-f-]+/files', sub)
                     and body.get('action') in ('list', 'read', 'export', 'download', 'logs'))
        app.authenticate_admin(self.headers, self.client_address[0], write=method != "GET" and not file_read)
        if sub == '/code-servers' and method == 'GET':
            from .code_servers import listing
            return listing(app)
        generation_directory = re.fullmatch(r'/code-servers/([0-9a-f-]{36})/generation-directory', sub)
        if generation_directory and method == 'POST':
            from .code_servers import save_generation_directory
            return save_generation_directory(app, generation_directory.group(1), body)
        generation_git = re.fullmatch(r'/code-servers/([0-9a-f-]{36})/generation-git-binding', sub)
        if generation_git and method == 'POST':
            from .generation_git_bindings import save
            return save(app, generation_git.group(1), body)
        mq_binding = re.fullmatch(r'/code-servers/([0-9a-f-]{36})/mq-binding',sub)
        if mq_binding and method=='POST':
            from .mq_generation import save_binding
            return {'binding':save_binding(app,mq_binding.group(1),body,self.headers)}
        if sub == '/code-generation/tasks' and method in ('GET', 'POST'):
            from .database_generation import paged, create
            return paged(app, {key: values[0] for key, values in query.items()}) if method == 'GET' else create(app, body)
        if sub in ('/code-generation/tasks/delete', '/code-generation/tasks/delete-batch') and method == 'POST':
            from .database_generation import remove
            return remove(app, body)
        if sub == '/code-generation/tasks/detail' and method == 'GET':
            from .database_generation import read, public
            return {'job': public(read(app, (query.get('taskId') or [''])[0]))}
        if sub == '/code-generation/tasks/summaries' and method == 'GET':
            from .database_generation import summaries
            ids = (query.get('taskIds') or [''])[0].split(',')
            return summaries(app, ids)
        if sub == '/mq-code-jobs/tasks' and method == 'GET':
            from .mq_task_management import paged
            return paged(app, {key: values[0] for key, values in query.items()}, self.headers)
        if sub == '/mq-code-jobs/delete' and method == 'POST':
            from .mq_task_management import remove
            return remove(app, body, self.headers)
        if sub=='/mq-code-jobs/summaries' and method=='GET':
            from .mq_generation import summaries
            return summaries(app, (query.get('taskIds') or [''])[0].split(','))
        if sub=='/mq-code-jobs' and method=='GET':
            from .mq_generation import read
            task_id=(query.get('taskId') or [''])[0]
            if not re.fullmatch(r'[A-Za-z0-9{}_-]{1,100}',task_id):raise ApiError('TaskID 无效')
            try:job=read(app,task_id)
            except ApiError as error:
                if error.status!=404:raise
                job=None
            return {'job':{k:v for k,v in job.items() if k not in ('task','params')} if job else None}
        if sub=='/code-servers/releases' and method in ('GET','POST'):
            from .code_server_upgrades import releases,publish
            return {'items':releases(app)} if method=='GET' else publish(app)
        if sub=='/code-servers/upgrades' and method=='POST':
            from .code_server_upgrades import schedule
            return schedule(app,body)
        if sub=='/code-servers/migration-package' and method=='POST':
            from .code_servers import package
            data=package(app,body.get('platform'),existing=True)
            self.send_response(200)
            self.send_header('Content-Type','application/zip')
            self.send_header('Content-Length',str(len(data)))
            self.end_headers();self.wfile.write(data)
            return RESPONSE_SENT
        if sub == '/code-servers/enrollment-code' and method == 'POST':
            from .code_servers import enrollment_code
            return enrollment_code(app)
        if sub == '/code-servers/package' and method == 'GET':
            from .runner import machine_ip
            address = os.getenv('RUNNER_LAN_HOST', '').strip() or machine_ip('http://127.0.0.1:8092')
            return {'platform': f'http://{address}:{self.server.server_port}'}
        if sub == '/code-servers/package' and method == 'POST':
            from .code_servers import package
            data = package(app, required_text(body, 'platform', 2000), digest=body.get('digest', ''))
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', 'attachment; filename="code-generation-server.zip"')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            return RESPONSE_SENT
        code_server = re.fullmatch(r'/code-servers/([0-9a-f-]+)/(files|import)', sub)
        if code_server and method == 'POST':
            from .code_servers import operation, import_repository
            server_id, action = code_server.groups()
            return operation(app, server_id, body) if action == 'files' else import_repository(app, server_id, body)
        if sub == '/settings/model-interfaces' and method in ('GET', 'POST'):
            from .model_interfaces import listing, save
            return listing(app) if method == 'GET' else save(app, body)
        if sub == '/settings/model-interfaces/test-prompts' and method == 'POST':
            from .model_interfaces import save_test_prompts
            return save_test_prompts(app, body)
        if sub == '/model-interfaces/generate' and method == 'POST':
            from .model_interfaces import generate, stream_generate
            return stream_generate(self,app,body) if body.get('responseStream') is True else generate(app, body)
        if sub == '/source-code-tasks' and method in ('GET', 'POST'):
            from .generation_tasks import listing, submit
            return listing(app) if method == 'GET' else submit(app, body)
        if sub == '/source-code-relations' and method == 'GET':
            from .source_code_relations import listing
            return listing(app, {key: values[0] for key, values in query.items() if values})
        if sub == '/deployment-resources' and method in ('GET', 'POST'):
            from .deployment_resources import rules, save_rules, entry_names
            if method == 'POST':
                return save_rules(app, body, self.headers)
            with app.store.connect() as db:
                return entry_names(db, rules(db))
        if sub == '/node-deployment-resource' and method in ('GET', 'POST'):
            from .deployment_resources import node_choice
            return node_choice(app, body if method == 'POST' else {key: values[0] for key, values in query.items() if values}, save=method == 'POST')
        if sub == '/deployment-jobs' and method == 'GET':
            from .deployment_resources import listing
            return listing(app, {key: values[0] for key, values in query.items() if values})
        if sub == '/deployment-jobs' and method == 'POST':
            from .deployment_resources import deploy_existing
            return deploy_existing(app, body)
        deployment_action = re.fullmatch(r'/deployment-jobs/([0-9a-f]{32})/(publish|retry|rollback)', sub)
        if deployment_action and method == 'POST':
            from .deployment_resources import action
            return action(app, *deployment_action.groups())
        if sub == '/site-scripts/generation-destination' and method == 'GET':
            from .generation_destinations import automatic
            return automatic(app, {key: (query.get(key) or [''])[0] for key in ('configId', 'queueName', 'configType')})
        if sub == '/site-scripts/task-config' and method in ('GET', 'POST'):
            from .generation_tasks import read_config, save_config
            return read_config(app, (query.get('configId') or [''])[0]) if method == 'GET' else save_config(app, body)
        if sub == '/site-scripts/generation-state' and method == 'GET':
            from .generated_archives import state
            return state(app, (query.get('configId') or [''])[0])
        if sub == '/site-scripts/generation-settings' and method == 'POST':
            from .generated_archives import preference
            return preference(app, body)
        generated_commit = re.fullmatch(r'/site-scripts/generated-results/([0-9a-f]{32})/commit', sub)
        if generated_commit and method == 'POST':
            from .generated_archives import commit
            return commit(app, generated_commit.group(1))
        if sub == '/model-interfaces/test' and method == 'POST':
            from .model_interfaces import test_interface, stream_test
            return stream_test(self, app, body) if body.get('responseStream') is True else test_interface(app, body)
        if method == 'GET' and sub == '/runner-package':
            from .portable_package import package_info
            from .runner import machine_ip
            address = machine_ip('http://127.0.0.1:8092')
            return package_info(app, f'http://{address}:{self.server.server_port}')
        if method == 'POST' and sub == '/runner-package':
            from .portable_package import build_package
            name, data = build_package(app, body)
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', 'attachment; filename="' + name + '"')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            return RESPONSE_SENT
        if method == 'GET' and sub == '/processes':
            from .process_control import listing
            return listing(app)
        stop_process = re.fullmatch(r'/runners/([A-Za-z0-9_-]+)/processes/stop', sub)
        if method == 'POST' and stop_process:
            from .process_control import request_stop
            return request_stop(app, stop_process.group(1), body)
        if sub == '/log-settings' and method in ('GET', 'POST'):
            from .runtime_history import policy
            return policy(app, body if method == 'POST' else None)
        if method == 'GET' and sub == '/runtime-operations':
            from .runtime_history import list_records
            app.expire_stale_runners()
            return list_records(app, query)
        log_detail = re.fullmatch(r'/runtime-operations/([0-9a-f]{32})', sub)
        if method == 'GET' and log_detail:
            from .runtime_history import detail
            return detail(app, log_detail.group(1))
        log_stream = re.fullmatch(r'/log-streams/([0-9a-f]{32})/(entries|download)', sub)
        if method == 'GET' and log_stream:
            from .runtime_history import read_entries, download
            return read_entries(app, log_stream.group(1), query) if log_stream.group(2) == 'entries' else download(app, log_stream.group(1))
        if sub == '/deployment-configurations/from-node' and method == 'POST':
            from .deployment_configuration import ensure_node_configuration
            return ensure_node_configuration(app, body)
        if sub == '/deployment-configurations':
            from .deployment_configuration import list_configurations, save_configuration
            if method == 'GET':
                return list_configurations(app, (query.get('keyword') or [''])[0])
            if method == 'POST':
                return save_configuration(app, body)
        deployment_route = re.fullmatch(r'/deployment-configurations/([0-9a-f]{32})', sub)
        if deployment_route:
            from .deployment_configuration import get_configuration, save_configuration, with_source_nodes
            if method == 'GET':
                with app.store.connect() as db:
                    return with_source_nodes(db, [get_configuration(app, deployment_route.group(1), db)])[0]
            if method == 'POST':
                return save_configuration(app, body, deployment_route.group(1))
            if method == 'DELETE':
                from .deployment_configuration import remove_configuration
                return remove_configuration(app, deployment_route.group(1), (query.get('revision') or [''])[0])
        if sub == '/runtime-configurations':
            from .deployment_configuration import list_runtimes, save_runtime
            if method == 'GET':
                return list_runtimes(app)
            if method == 'POST':
                return save_runtime(app, body)
        runtime_entry = re.fullmatch(r'/runtime-configurations/([A-Za-z0-9_-]+)/entry', sub)
        if runtime_entry and method in ('GET', 'POST'):
            from .runtime_entry import entry
            return entry(app, runtime_entry.group(1), body if method == 'POST' else None)
        runtime_control = re.fullmatch(r'/runtime-configurations/([A-Za-z0-9_-]+)/(start|stop)', sub)
        if runtime_control and method == 'POST':
            from .runtime_history import control
            return control(app, runtime_control.group(1), body.get('revision'), runtime_control.group(2) == 'start')
        runtime_remove = re.fullmatch(r'/runtime-configurations/([A-Za-z0-9_-]+)/remove', sub)
        if runtime_remove and method == 'POST':
            from .deployment_configuration import remove_runtime
            return remove_runtime(app, runtime_remove.group(1), body.get('revision'))
        if sub == "/directory-bindings":
            from .directory_bindings import list_bindings, create_binding
            if method == "GET":
                return list_bindings(app)
            if method == "POST":
                return create_binding(app, body)
        delivery_route = re.fullmatch(r"/directory-bindings/(config|queue|website|custom|deployment)/(.+)/([A-Za-z0-9_-]{1,80})/deliver", sub)
        if delivery_route and method == "POST":
            from .runtime_history import delivery_request
            return delivery_request(app, *delivery_route.groups(), body)
        preview_route = re.fullmatch(r"/directory-bindings/(config|queue|website|custom|deployment)/(.+)/([A-Za-z0-9_-]{1,80})/delivery-preview", sub)
        if preview_route and method == "GET":
            from .directory_delivery import delivery_preview
            return delivery_preview(app, *preview_route.groups())
        directory_binding_route = re.fullmatch(r"/directory-bindings/(config|queue|website|custom|deployment)/(.+)/([A-Za-z0-9_-]{1,80})", sub)
        if directory_binding_route and method == "DELETE":
            from .directory_bindings import remove_binding
            return remove_binding(app, *directory_binding_route.groups())
        if sub == "/directory-layouts/owners" and method == "GET":
            from .directory_layout import named_layout_owners
            return named_layout_owners(app)
        named_layout_route = re.fullmatch(r"/directory-layouts/(website|custom)", sub)
        if named_layout_route:
            from .directory_layout import get_named_layout, save_named_layout
            binding_type = named_layout_route.group(1)
            owner_id = (query.get('owner') or [''])[0]
            if method == "GET":
                return get_named_layout(app, binding_type, owner_id)
            if method == "POST":
                return save_named_layout(app, binding_type, owner_id, body)
        config_layout_route = re.fullmatch(r"/directory-layouts/configs/([A-Za-z0-9_-]{1,100})", sub)
        if config_layout_route:
            from .directory_layout import get_config_layout, save_config_layout
            config_id = config_layout_route.group(1)
            if method == "GET":
                return get_config_layout(app, config_id)
            if method == "POST":
                return save_config_layout(app, config_id, body)
        queue_layout_route = re.fullmatch(r"/directory-layouts/queues/([^/]+)", sub)
        if queue_layout_route:
            from .directory_layout import get_queue_layout, save_queue_layout
            queue = queue_layout_route.group(1)
            if method == "GET":
                return get_queue_layout(app, queue)
            if method == "POST":
                return save_queue_layout(app, queue, body)
        layout_route = re.fullmatch(r"/directory-layouts/([0-9a-f]{32})(/publish)?", sub)
        if layout_route:
            from .directory_layout import get_layout, publish_layout, save_layout
            code_id, action = layout_route.groups()
            if method == "GET" and not action:
                return get_layout(app, code_id)
            if method == "POST":
                return publish_layout(app, code_id, body) if action else save_layout(app, code_id, body)
        repo_tree = re.fullmatch(r"/settings/code-repos/([0-9a-f]{32})/tree", sub)
        if repo_tree and method == "GET":
            from .directory_layout import repository_tree
            return repository_tree(app, repo_tree.group(1), (query.get('commit') or [''])[0])
        if sub == "/settings/site-code-repo":
            if method == "GET":
                return app.site_script_repo_setting()
            if method == "POST":
                return app.configure_site_script_repo(body)
        if method == "POST" and sub == "/settings/site-code-git":
            return app.configure_site_script_git(body)
        if sub == "/settings/code-repos":
            if method == "GET":
                return app.list_repositories()
            if method == "POST":
                return app.create_repository(body, self.headers)
        generation_default = re.fullmatch(r'/settings/code-repos/([0-9a-f]{32})/directories/([0-9a-f]{32}|default)/generation-default', sub)
        if generation_default and method == 'POST':
            from .generation_destinations import set_default
            return set_default(app, *generation_default.groups())
        repo_directories = re.fullmatch(r'/settings/code-repos/([0-9a-f]{32})/directories(?:/([0-9a-f]{32}|default))?', sub)
        if repo_directories:
            from .repository_directories import list_directories, save_directory, remove_directory
            repo_id, directory_id = repo_directories.groups()
            if method == 'GET' and not directory_id:
                with app.store.connect() as db:
                    return list_directories(app, db, repo_id)
            if method == 'POST':
                return save_directory(app, repo_id, body, directory_id, headers=self.headers)
            if method == 'DELETE' and directory_id:
                return remove_directory(app, repo_id, directory_id, (query.get('revision') or [''])[0])
        if sub == '/site-scripts/file-association/preview' and method == 'GET':
            from .script_file_links import preview
            return preview(app, (query.get('digest') or [''])[0], (query.get('target') or [''])[0])
        if sub == '/site-scripts/file-association' and method == 'POST':
            from .script_file_links import change
            return change(app, body)
        repo_files = re.fullmatch(r"/settings/code-repos/([0-9a-f]{32})/files", sub)
        repo_metadata = re.fullmatch(r"/settings/code-repos/([0-9a-f]{32})/files/metadata", sub)
        repo_references = re.fullmatch(r'/settings/code-repos/([0-9a-f]{32})/files/references', sub)
        if repo_references and method == 'GET':
            from .repository_references import references
            return references(app, repo_references.group(1), (query.get('path') or [''])[0])
        if repo_metadata and method == "GET":
            from .repository_metadata import file_metadata
            return file_metadata(app, repo_metadata.group(1), (query.get('path') or [''])[0],
                                 (query.get('commit') or [''])[0])
        repo_content = re.fullmatch(r"/settings/code-repos/([0-9a-f]{32})/files/content", sub)
        if repo_content and method == "GET":
            return app.read_repository_file(repo_content.group(1), (query.get("path") or [""])[0])
        if repo_files and method == "GET":
            return app.list_repository_files(repo_files.group(1), (query.get("keyword") or [""])[0],
                                             int((query.get("page") or ["1"])[0]), (query.get('directoryId') or [''])[0],
                                             (query.get('view') or ['paths'])[0], (query.get('folder') or [''])[0])
        if repo_files and method == "DELETE":
            return app.delete_repository_file(repo_files.group(1), (query.get("path") or [""])[0])
        repo_action = re.fullmatch(r"/settings/code-repos/([0-9a-f]{32})(/path|/default|/verify|/files)?", sub)
        if method == "POST" and repo_action:
            repo_id, action = repo_action.groups()
            if action == "/path":
                return app.move_repository(repo_id, body)
            if action == "/default":
                return app.set_default_repository(repo_id)
            if action == "/verify":
                return app.verify_repository(repo_id)
            if action == "/files":
                return app.upload_repository_files(repo_id, body)
            return app.update_repository(repo_id, body, self.headers)
        if sub == "/settings/code-repo-rules":
            if method == "GET":
                return app.list_repo_rules()
            if method == "POST":
                return app.save_repo_rules(body)
        if method == "GET" and sub == "/runners":
            app.expire_stale_runners()
        if method == "POST" and sub == "/assignments" and "scriptDigest" in body:
            return app.create_code_assignment(body)
        with app.store.connect() as db:
            if method == "GET" and sub == "/runners":
                rows = db.execute("SELECT * FROM runners ORDER BY ip_address, install_directory").fetchall()
                return [as_runner(row, count_of(db.execute("SELECT COUNT(*) FROM assignments WHERE runner_id=?", (row["runner_id"],)).fetchone())) for row in rows]
            if method == "POST" and sub == "/runners/enrollment-codes":
                code = secrets.token_urlsafe(24)
                expiry = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(timespec="seconds")
                db.execute("INSERT INTO enrollment_codes VALUES (?,?,NULL)", (hashlib.sha256(code.encode()).hexdigest(), expiry))
                return {"code": code, "expiresAt": expiry}
            if method == "GET" and sub == "/assignments":
                return [as_assignment(row) for row in db.execute(ASSIGNMENT_SELECT + "ORDER BY x.queue,x.runner_id")]
            if method == "POST" and sub == "/assignments":
                runner_id = required_text(body, "runnerId", 80)
                queue = required_text(body, "queue", 255)
                processor_type = required_text(body, "processorType", 100)
                digest = required_text(body, "releaseDigest", 100)
                release = db.execute("SELECT * FROM releases WHERE digest=?", (digest,)).fetchone()
                runner = db.execute("SELECT * FROM runners WHERE runner_id=?", (runner_id,)).fetchone()
                if not runner or not release or release["kind"] != "processor" or release["name"] != processor_type or release["status"] != "published":
                    raise ApiError("实例或处理程序版本无效")
                concurrency = int(body.get("concurrency", 1))
                environment = body.get("environment", "test")
                if concurrency < 1 or concurrency > 100 or environment not in ("test", "production"):
                    raise ApiError("并发数或运行环境无效")
                if db.execute("SELECT 1 FROM assignments WHERE runner_id=? AND queue=?", (runner_id, queue)).fetchone():
                    raise ApiError("该实例已分配此队列", 409)
                assignment_id = str(uuid.uuid4())
                db.execute("INSERT INTO assignments (assignment_id,runner_id,queue,processor_type,release_digest,concurrency,enabled,environment) "
                           "VALUES (?,?,?,?,?,?,?,?)", (assignment_id, runner_id, queue, processor_type, digest, concurrency, 1, environment))
                return as_assignment(db.execute("SELECT * FROM assignments WHERE assignment_id=?", (assignment_id,)).fetchone())
            if method == "DELETE" and sub.startswith("/assignments/"):
                assignment_id = sub.removeprefix("/assignments/")
                db.execute("DELETE FROM assignments WHERE assignment_id=?", (assignment_id,))
                return {"ok": True}
            if method == "GET" and sub == "/releases":
                rows = db.execute("SELECT * FROM releases ORDER BY published_at DESC").fetchall()
                return [as_release(row, count_of(db.execute(
                    "SELECT COUNT(*) FROM runners WHERE actual_digest=?" if row['kind'] == 'runner'
                    else "SELECT COUNT(*) FROM assignments WHERE release_digest=?", (row['digest'],)).fetchone())) for row in rows]
            if method == "GET" and sub == "/site-scripts/versions":
                config_id = (query.get("configId") or [""])[0]
                queue = (query.get("queueName") or [""])[0]
                if not re.fullmatch(r"[A-Za-z0-9_-]+", config_id):
                    raise ApiError("配置 ID 无效")
                rows = db.execute(
                    CODE_VERSION_SELECT +
                    "WHERE a.config_id=? AND a.queue_name=? ORDER BY v.published_at DESC",
                    (config_id, valid_queue(queue)),
                ).fetchall()
                from .script_file_links import present, state
                return [present(db, row) for row in rows if not state(db, row['code_id']).get('detached')]
            if method == "GET" and sub == "/site-scripts/catalog":
                rows = db.execute(
                    CODE_VERSION_SELECT +
                    "ORDER BY v.published_at DESC"
                ).fetchall()
                from .script_file_links import present, state
                return [dict(present(db, row), environments=[binding["environment"] for binding in db.execute(
                    "SELECT environment FROM code_runtime_bindings WHERE digest=? ORDER BY environment", (row["digest"],)
                ).fetchall()]) for row in rows if not state(db, row['code_id']).get('detached')]
            if method == "GET" and sub == "/site-scripts/code":
                digest = (query.get("digest") or [""])[0]
                row = db.execute(
                    CODE_VERSION_SELECT + "WHERE v.digest=?",
                    (digest,),
                ).fetchone()
                if not row:
                    raise ApiError("代码版本不存在", 404)
                with zipfile.ZipFile(io.BytesIO(app.artifacts.read(digest))) as archive:
                    code = archive.read(row["delivery_path"]).decode("utf-8")
                from .script_file_links import present
                return dict(present(db, row), code=code)
            if method == "GET" and sub == "/site-scripts/bindings":
                config_id = (query.get("configId") or [""])[0]
                queue = (query.get("queueName") or [""])[0]
                environment = (query.get("environment") or [""])[0]
                if not re.fullmatch(r"[A-Za-z0-9_-]+", config_id):
                    raise ApiError("配置 ID 无效")
                rows = db.execute(
                    "SELECT b.environment,a.*,v.* FROM code_runtime_bindings b "
                    "JOIN code_versions v ON v.digest=b.digest "
                    "JOIN code_assets a ON a.code_id=v.code_id "
                    "WHERE b.environment=? AND b.config_id=? AND b.queue_name=? ORDER BY b.site_host",
                    (valid_environment(environment), config_id, valid_queue(queue)),
                ).fetchall()
                return [dict(as_code_version(row), environment=row["environment"]) for row in rows]
            if method == "POST" and sub == "/site-scripts/bind":
                digest = required_text(body, "scriptDigest", 100)
                environment = valid_environment(required_text(body, "environment", 20))
                config_id = required_text(body, "configId", 80)
                queue = valid_queue(required_text(body, "queueName", 120))
                row = db.execute(
                    CODE_VERSION_SELECT + "WHERE v.digest=?",
                    (digest,),
                ).fetchone()
                if not row or row["config_id"] != config_id or row["queue_name"] != queue:
                    raise ApiError("代码版本与节点队列不匹配")
                existing = db.execute(
                    "SELECT 1 FROM code_runtime_bindings WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?",
                    (environment, config_id, queue, row["site_host"]),
                ).fetchone()
                if existing:
                    db.execute(
                        "UPDATE code_runtime_bindings SET digest=? WHERE environment=? AND config_id=? AND queue_name=? AND site_host=?",
                        (digest, environment, config_id, queue, row["site_host"]),
                    )
                else:
                    db.execute("INSERT INTO code_runtime_bindings VALUES (?,?,?,?,?)", (
                        environment, config_id, queue, row["site_host"], digest,
                    ))
                return dict(as_code_version(row), environment=environment)
            if method == "POST" and sub == "/releases/processors":
                return app.publish_processor(body)
            if method == "POST" and sub == "/releases/runners":
                return app.publish_runner()
            upgrade = re.fullmatch(r"/runners/([0-9a-f-]+)/desired-runner", sub)
            if method == "POST" and upgrade:
                runner_id = upgrade.group(1)
                digest = required_text(body, "digest", 100)
                release = db.execute("SELECT 1 FROM releases WHERE digest=? AND kind='runner' AND status='published'", (digest,)).fetchone()
                if not release or not db.execute("SELECT 1 FROM runners WHERE runner_id=?", (runner_id,)).fetchone():
                    raise ApiError("Runner 实例或目标版本无效")
                db.execute("INSERT INTO runner_upgrades VALUES (?,?) ON CONFLICT(runner_id) DO UPDATE SET desired_digest=excluded.desired_digest", (runner_id, digest))
                db.execute("UPDATE runners SET desired_digest=? WHERE runner_id=?", (digest, runner_id))
                return {"runnerId": runner_id, "digest": digest}
            match = re.fullmatch(r"/configs/([A-Za-z0-9_-]+)/script-release", sub)
            if match:
                config_id = match.group(1)
                if method == "GET":
                    row = db.execute("SELECT b.config_id, r.* FROM script_bindings b JOIN releases r ON r.digest=b.script_digest WHERE b.config_id=?", (config_id,)).fetchone()
                    return as_binding(row) if row else None
                if method == "POST":
                    digest = required_text(body, "scriptDigest", 100)
                    release = db.execute("SELECT * FROM releases WHERE digest=? AND kind='script' AND status='published'", (digest,)).fetchone()
                    if not release:
                        raise ApiError("节点脚本版本无效")
                    db.execute("INSERT INTO script_bindings VALUES (?,?) ON CONFLICT(config_id) DO UPDATE SET script_digest=excluded.script_digest", (config_id, digest))
                    return as_binding(db.execute("SELECT b.config_id, r.* FROM script_bindings b JOIN releases r ON r.digest=b.script_digest WHERE b.config_id=?", (config_id,)).fetchone())
        if method == "POST" and sub == "/site-scripts/publish":
            return app.publish_script(body)
        raise ApiError("接口不存在", 404)


def serve(host: str = "127.0.0.1", port: int = 8092, data_dir: Path = RUNTIME):
    lan_host = os.getenv('RUNNER_LAN_HOST', '').strip()
    if lan_host:
        import ipaddress
        address = ipaddress.ip_address(lan_host)
        if address.version != 4 or address.is_loopback or address.is_unspecified or address.is_multicast:
            raise ValueError('RUNNER_LAN_HOST 必须为指定的本机 IPv4 地址')
    application = Application(data_dir)
    from .generation_tasks import recover
    recover(application)
    handler = type("RunnerHandler", (Handler,), {"application": application})
    server = ThreadingHTTPServer((host, port), handler)
    lan_server = None
    lan_thread = None
    if lan_host and host not in ('0.0.0.0', lan_host):
        try:
            lan_server = ThreadingHTTPServer((lan_host, port), handler)
        except Exception:
            server.server_close()
            raise
        lan_thread = threading.Thread(target=lan_server.serve_forever, name='runner-lan-listener', daemon=True)
        lan_thread.start()
    stopped = threading.Event()

    def sweep() -> None:
        last_cleanup = 0
        while not stopped.wait(RUNNER_SWEEP_INTERVAL_SECONDS):
            try:
                application.expire_stale_runners()
                if time.monotonic() - last_cleanup > 3600:
                    from .runtime_history import cleanup
                    cleanup(application)
                    last_cleanup = time.monotonic()
            except Exception as exc:
                print(f"Runner 掉线检测失败：{exc}", file=sys.stderr, flush=True)

    sweeper = threading.Thread(target=sweep, name="runner-offline-sweeper", daemon=True)
    sweeper.start()
    def deployment_sweep() -> None:
        from .deployment_resources import dispatch
        while not stopped.wait(RUNNER_SWEEP_INTERVAL_SECONDS):
            try:
                dispatch(application)
            except Exception as exc:
                print(f"代码部署调度失败：{exc}", file=sys.stderr, flush=True)
    deployment_worker = threading.Thread(target=deployment_sweep, name='generated-code-deployment', daemon=True)
    deployment_worker.start()
    try:
        server.serve_forever()
    finally:
        stopped.set()
        server.server_close()
        if lan_server:
            lan_server.shutdown(); lan_server.server_close()
            lan_thread.join(timeout=5)
        sweeper.join(timeout=RUNNER_SWEEP_INTERVAL_SECONDS + 1)
        deployment_worker.join(timeout=RUNNER_SWEEP_INTERVAL_SECONDS + 1)


if __name__ == "__main__":
    from .local_settings import load_local_settings
    load_local_settings()
    # Helpers import .server for shared errors and the publish lock. With -m,
    # keep those imports on this instance instead of loading a second module.
    if __spec__ is not None:
        sys.modules[__spec__.name] = sys.modules[__name__]
    serve(os.getenv("RUNNER_HOST", "127.0.0.1"), int(os.getenv("RUNNER_PORT", "8092")),
          Path(os.getenv('RUNNER_DATA_DIR', str(RUNTIME))).resolve())
