"""到点执行「AI 脚本」类数据监控，并把结构化结论写回 ``ck_source`` / ``ck_job_log``。

背景
----
Java 调度器（``AutoCheckTask`` → ``CkSourceService.queryWaitSend``）只会执行
``check_conf`` 里的 SQL 规则检查；它不认 ``kind='ai'`` 的脚本检查。为了让脚本
检查也能按计划跑，本模块做两件事：

1. 按 ``check_conf.schedule.next``（脚本检查自己的计划状态）挑出到点的 AI 记录，
   在本地以子进程方式执行脚本；
2. 执行完把结论写回：``ck_source.STATE/LAST_RUN/LAST_MSG``、``check_conf.schedule``、
   以及一条 ``ck_job_log``（``JOB_ID = ck_source.ID``，与旧平台口径一致）。

为什么不直接用 ``ck_source.NEXT_RUN`` 排期
------------------------------------------
``CkSourceMapper.lockForDeal`` 的条件是
``LOCK_STATE != 'L' AND (NEXT_RUN <= NOW() OR NEXT_RUN IS NULL)``——**NULL 也会被立刻捡走**。
所以 AI 记录的 ``NEXT_RUN`` 必须停在远期（本模块保持原值不动，例如 2027-01-01），
脚本检查的计划状态放在 ``check_conf.schedule`` 里，Java 永远不碰这些记录。

安全边界
--------
* 默认 dry-run：只执行、只打印，不写库；``--apply`` 才回写。
* 只处理 ``check_conf.kind == 'ai'`` 且带 ``script`` 正文的记录。
* 脚本必须只读（生成时的约定），本模块不改源表。
* 抓不到结构化结论时按「执行失败」上报，不补 0。
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

DEFAULT_TIMEOUT = 120
DEFAULT_DB_PORT = 3306
# Java 调度器要跳过 AI 记录：NEXT_RUN 必须停在远期（NULL 会被立刻捡走）。
PARKED_NEXT_RUN = "2027-01-01 08:00:00"
DEFAULT_TIMEZONE = "Asia/Shanghai"
MAX_CANDIDATES = 200
# 每页读取的源记录数：翻页读而不是一次 LIMIT 200，让 ID 靠后的检查也能进候选。
CANDIDATE_PAGE = 500

# ``ck_job_log.REMARKS`` 在老库里是 VARCHAR(100)，结构化 JSON 会被拦腰截断；
# 迁移（V3.6.4）把它扩到 1000，这里再做一层长度保护：超长先丢可选字段，
# 绝不把 JSON 截断成非法串——否则前端解析失败会把「未知」显示成 0。
REMARKS_MAX = 900
# 占位锁的超时（分钟）：进程崩了留下的 LOCK_STATE='L' 到点可被接管。
LOCK_LEASE_MINUTES = 15

# 同一个进程里扫描线程与 HTTP 手动触发可能同时进来，先做进程内互斥。
_IN_FLIGHT: set = set()
_IN_FLIGHT_LOCK = threading.Lock()


def _acquire_local(monitor_id: int) -> bool:
    with _IN_FLIGHT_LOCK:
        if monitor_id in _IN_FLIGHT:
            return False
        _IN_FLIGHT.add(monitor_id)
        return True


def _release_local(monitor_id: int) -> None:
    with _IN_FLIGHT_LOCK:
        _IN_FLIGHT.discard(monitor_id)


STATUS_ABNORMAL = "ABNORMAL"
STATUS_NORMAL = "NORMAL"
STATUS_ERROR = "ERROR"


def business_now(cfg: Optional[Dict[str, Any]] = None) -> _dt.datetime:
    """业务时区的当前时间（naive）。计划时间、日志时间都按业务时区解释。"""

    zone = (cfg or {}).get("timezone") or os.environ.get("RUNNER_MONITOR_TIMEZONE") or DEFAULT_TIMEZONE
    return _dt.datetime.now(ZoneInfo(str(zone))).replace(tzinfo=None)


class RunnerUnavailable(Exception):
    """配置缺失或数据库不可用——调用方必须显示「不可取得」，不能降级成 0。"""


# --------------------------------------------------------------------------- 配置


def load_config() -> Dict[str, Any]:
    """读取执行器配置。

    优先 ``RUNNER_MONITOR_RUNNER_CONFIG``（JSON）::

        {"python": "/usr/bin/python3", "timeout": 120,
         "db": {"host": "127.0.0.1", "port": 3306, "user": "sense",
                "password": "***", "database": "sense_db"},
         "env": {"DQ_DB_HOST": "127.0.0.1"}}

    缺省复用 ``RUNNER_MONITOR_DELIVERY_CONFIG`` 的 db 段；脚本连接参数默认由
    ``DQ_DB_*`` 派生（生成脚本读取这套环境变量）。
    """

    cfg: Dict[str, Any] = {"python": sys.executable, "timeout": DEFAULT_TIMEOUT,
                      "timezone": os.environ.get("RUNNER_MONITOR_TIMEZONE") or DEFAULT_TIMEZONE}
    path = os.environ.get("RUNNER_MONITOR_RUNNER_CONFIG", "").strip()
    if path:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                cfg.update(json.load(handle) or {})
        except (OSError, ValueError) as exc:
            raise RunnerUnavailable("执行器配置不可读：%s" % exc)

    db = cfg.get("db") or {}
    if not db:
        delivery = os.environ.get("RUNNER_MONITOR_DELIVERY_CONFIG", "").strip()
        if delivery:
            try:
                with open(delivery, "r", encoding="utf-8") as handle:
                    db = (json.load(handle) or {}).get("db") or {}
            except (OSError, ValueError):
                db = {}
    db = {
        "host": db.get("host") or os.environ.get("DQ_DB_HOST", "127.0.0.1"),
        "port": int(db.get("port") or os.environ.get("DQ_DB_PORT") or DEFAULT_DB_PORT),
        "user": db.get("user") or os.environ.get("DQ_DB_USER", ""),
        "password": db.get("password") or os.environ.get("DQ_DB_PASSWORD", ""),
        "database": db.get("database") or os.environ.get("DQ_DB_NAME", ""),
    }
    cfg["db"] = db
    env = dict(os.environ)
    env.update(
        {
            "DQ_DB_HOST": str(db["host"]),
            "DQ_DB_PORT": str(db["port"]),
            "DQ_DB_USER": db["user"],
            "DQ_DB_PASSWORD": db["password"],
        }
    )
    if db["database"]:
        env["DQ_DB_NAME"] = str(db["database"])
    env.update({k: str(v) for k, v in (cfg.get("env") or {}).items()})
    # 兼容已生成的 DB_* 脚本，连接目标与执行器的 DQ_DB_* 配置保持一致。
    for suffix in ("HOST", "PORT", "USER", "PASSWORD", "NAME"):
        env["DB_" + suffix] = env.get("DQ_DB_" + suffix, "")
    cfg["env"] = env
    cfg["timeout"] = int(cfg.get("timeout") or DEFAULT_TIMEOUT)
    return cfg


# ----------------------------------------------------------------------- 计划计算

_FIELD_ALIASES = {"?": "*"}


def _expand_field(text: str, low: int, high: int) -> Optional[set]:
    text = (text or "").strip() or "*"
    values: set = set()
    for chunk in text.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        step = 1
        if "/" in chunk:
            chunk, _, raw_step = chunk.partition("/")
            step = int(raw_step)
        if chunk in ("*", "?"):
            start, end = low, high
        elif "-" in chunk:
            raw_start, _, raw_end = chunk.partition("-")
            start, end = int(raw_start), int(raw_end)
        else:
            start = end = int(chunk)
        if end < start:
            raise ValueError("cron 区间非法：%s" % text)
        if start < low or end > high:
            raise ValueError("cron 取值越界：%s" % text)
        values.update(range(start, end + 1, step))
    return values or None


def parse_cron(expr: str) -> List[Optional[set]]:
    """把 5/6 段 cron 展开成 [秒, 分, 时, 日, 月, 周] 集合；``*``/``?`` 返回 None。"""

    raw = (expr or "").split()
    if len(raw) == 5:
        raw = ["0"] + raw
    if len(raw) != 6:
        raise ValueError("cron 需要 5 或 6 段：%r" % expr)
    bounds = [(0, 59), (0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]
    fields: List[Optional[set]] = []
    for text, (low, high) in zip(raw, bounds):
        text = _FIELD_ALIASES.get(text, text)
        fields.append(None if text in ("*", "?") else _expand_field(text, low, high))
    return fields


def next_run_at(schedule: str, after: Optional[_dt.datetime] = None) -> Optional[str]:
    """返回 ``after`` 之后（不含）最近一次触发时间，格式 ``YYYY-MM-DD HH:MM:SS``。

    空计划表示「只有手动触发」，返回 ``None`` 而不是抛错：检查已经执行完才走到这里，
    因为没填 cron 让整次运行回滚/报 400，会把「检查跑过了」这件事一起吞掉。
    """

    if not (schedule or "").strip():
        return None
    fields = parse_cron(schedule)
    # 监控计划都是分钟级：秒段只要包含 0 即在整分触发。
    sec, minute, hour, dom, month, dow = fields
    if sec is not None and 0 not in sec:
        return None
    base = (after or business_now()).replace(second=0, microsecond=0) + _dt.timedelta(minutes=1)
    limit = base + _dt.timedelta(days=366)
    while base <= limit:
        if (minute is None or base.minute in minute) and (hour is None or base.hour in hour):
            if (dom is None or base.day in dom) and (month is None or base.month in month):
                if dow is None or ((base.weekday() + 1) % 7) in dow:
                    return base.strftime("%Y-%m-%d %H:%M:%S")
        base += _dt.timedelta(minutes=1)
    return None


# ----------------------------------------------------------------------- 记录挑选


def _parse_conf(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "replace")
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def schedule_state(conf: Dict[str, Any]) -> Dict[str, Any]:
    state = conf.get("schedule")
    return dict(state) if isinstance(state, dict) else {}


def is_ai_check(conf: Dict[str, Any]) -> bool:
    return str(conf.get("kind") or "").lower() == "ai" and bool((conf.get("script") or "").strip())


def due_at(conf: Dict[str, Any], fallback: Optional[str] = None) -> Optional[str]:
    state = schedule_state(conf)
    return state.get("next") or fallback


def row_due_at(conf: Dict[str, Any], row: Dict[str, Any], now: Optional[_dt.datetime] = None) -> Optional[str]:
    """这一条检查下一次该跑的时间（按 ``check_conf.schedule.next`` 或 cron 推算）。

    只认 ``schedule.next`` 会让「刚设计划、还没跑过第一次」的检查永远等不到执行：
    保存只写 ``ck_source.SCHEDULE``，``schedule.next`` 要等执行器回写才有，而
    ``NEXT_RUN`` 被停在远期用来防止 Java 任务抢跑。所以没有 next 时，用 cron 从
    「上次运行时间」（没有就从当前时间）往后推一次。
    """

    state = schedule_state(conf)
    if state.get("next"):
        return state["next"]
    cron = str(row.get("schedule") or "").strip()
    if not cron:
        return None
    base = None
    # 上次运行时间是首选基准；从没跑过就用创建时间，再没有就当「刚刚到期」处理。
    # 不能用 now 当基准：next_run_at 取的是 now 之后的整分边界，每轮扫描都往后
    # 推一分钟，这条检查就永远不会到期。
    for key in ("last_run", "create_dt"):
        value = row.get(key)
        if not value:
            continue
        try:
            base = _dt.datetime.strptime(str(value)[:19], "%Y-%m-%d %H:%M:%S")
            break
        except ValueError:
            continue
    if base is None:
        base = (now or business_now()) - _dt.timedelta(minutes=1)
    try:
        return next_run_at(cron, base)
    except ValueError:
        return None


def is_row_due(conf: Dict[str, Any], row: Dict[str, Any], now: Optional[_dt.datetime] = None) -> bool:
    due = row_due_at(conf, row, now)
    if not due:
        return False
    try:
        stamp = _dt.datetime.strptime(str(due)[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    return stamp <= (now or business_now())


def is_due(conf: Dict[str, Any], now: Optional[_dt.datetime] = None, fallback: Optional[str] = None) -> bool:
    due = due_at(conf, fallback)
    if not due:
        return False
    try:
        stamp = _dt.datetime.strptime(str(due)[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    return stamp <= (now or business_now())


# ------------------------------------------------------------------------- 执行


def window_for(conf: Dict[str, Any], now: Optional[_dt.datetime] = None) -> Dict[str, str]:
    """按检查配置算出本次的检查窗口，供脚本通过 ``DQ_START_DATE/DQ_END_DATE`` 使用。

    窗口必须是「本周期」而不是「表内全历史」：否则一张停更半年的表会被算成
    连续几百天异常（试跑时真实出现过）。
    """

    moment = now or business_now()
    spec = conf.get("window") if isinstance(conf.get("window"), dict) else {}
    kind = str(spec.get("type") or "today")
    if kind == "hours":
        hours = max(1, int(spec.get("hours") or 24))
        start = moment - _dt.timedelta(hours=hours)
        return {"start": start.strftime("%Y-%m-%d %H:%M:%S"), "end": moment.strftime("%Y-%m-%d %H:%M:%S")}
    if kind == "period":
        # 上一个完整周期（周更/月更按 schedule 的周期长度近似）
        hours = max(1, int(spec.get("periodHours") or 24))
        end = moment.replace(minute=0, second=0, microsecond=0)
        start = end - _dt.timedelta(hours=hours)
        return {"start": start.strftime("%Y-%m-%d %H:%M:%S"), "end": end.strftime("%Y-%m-%d %H:%M:%S")}
    start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return {"start": start.strftime("%Y-%m-%d %H:%M:%S"), "end": moment.strftime("%Y-%m-%d %H:%M:%S")}


def build_argv(conf: Dict[str, Any]) -> List[str]:
    """把 check_conf 里能确定的执行参数翻译成脚本参数（只加脚本认识的）。"""

    argv: List[str] = ["--format", "json"]
    table = str(conf.get("tableName") or conf.get("table") or "").strip()
    if table:
        argv.extend(["--table", table])
    column = str(conf.get("timeColumn") or conf.get("dateColumn") or "").strip()
    if column:
        argv.extend(["--time-column", column])
    return argv


def parse_report(stdout: str) -> Optional[Dict[str, Any]]:
    """从 stdout 里取出最后一个 JSON 对象（脚本允许先打日志再输出结果）。"""

    text = (stdout or "").strip()
    decoder = json.JSONDecoder()
    best: Optional[Dict[str, Any]] = None
    index = 0
    while True:
        start = text.find("{", index)
        if start < 0:
            break
        try:
            value, consumed = decoder.raw_decode(text[start:])
        except ValueError:
            index = start + 1
            continue
        if isinstance(value, dict):
            best = value
        index = start + max(consumed, 1)
    return best


def table_fields(table: str, cfg: Dict[str, Any]) -> List[str]:
    """查询当前执行环境的物理字段，不使用平台登记字段推测表结构。"""
    import pymysql
    db = cfg.get("db") or {}
    parts = table.split(".")
    if len(parts) == 1:
        parts.insert(0, str(db.get("database") or ""))
    if len(parts) != 2 or any(not re.fullmatch(r"[A-Za-z0-9_$]+", part) for part in parts):
        raise ValueError("请选择有效的数据库表名")
    conn = pymysql.connect(host=db.get("host"), port=int(db.get("port") or 3306),
                           user=db.get("user"), password=db.get("password"),
                           database=db.get("database") or None, connect_timeout=5, read_timeout=10)
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                           "WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION", tuple(parts))
            fields = [row[0] for row in cursor.fetchall()]
        if not fields:
            raise ValueError("表 %s 不存在或当前账号无权读取字段" % table)
        return fields
    finally:
        conn.close()


def report_reason(report: Dict[str, Any]) -> str:
    reasons = report.get("abnormalReasons")
    return str(report.get("reason") or report.get("error") or
               ("；".join(str(item) for item in reasons) if isinstance(reasons, list) else reasons) or "")


def execute(script: str, conf: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    """子进程执行脚本；返回 ``{status, report, exitCode, durationMs, stderr, error}``。"""

    started = _dt.datetime.now()
    window = window_for(conf, business_now())
    table = str(conf.get("tableName") or conf.get("table") or "").strip()
    column = str(conf.get("timeColumn") or conf.get("dateColumn") or "").strip()
    if table:
        try:
            fields = table_fields(table, cfg)
            if column and column not in fields:
                raise ValueError("表 %s 中不存在入库时间字段 %s，请重新选择并生成脚本" % (table, column))
        except Exception as exc:
            return {"status": STATUS_ERROR, "report": None, "exitCode": None,
                    "durationMs": 0, "stderr": "", "error": "执行前字段校验失败：%s" % exc}
    env = dict(cfg.get("env") or {})
    env["DQ_TABLE_NAME"] = table
    env["DQ_TIME_COLUMN"] = column
    env["DQ_SOURCE_ID"] = str(conf.get("sourceId") or "")
    env["DQ_START_DATE"] = window["start"]
    env["DQ_END_DATE"] = window["end"]
    handle = tempfile.NamedTemporaryFile("w", suffix=".monitor.py", delete=False, encoding="utf-8")
    try:
        handle.write(script)
        handle.close()
        argv = [str(cfg.get("python") or sys.executable), handle.name] + build_argv(conf)
        try:
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=cfg["timeout"],
                env=env,
            )
        except subprocess.TimeoutExpired:
            return {
                "status": STATUS_ERROR,
                "report": None,
                "exitCode": None,
                "error": "执行超时（%ss）" % cfg["timeout"],
                "stdout": "",
                "stderr": "",
                "durationMs": int((_dt.datetime.now() - started).total_seconds() * 1000),
            }
        except OSError as exc:
            raise RunnerUnavailable("无法启动脚本解释器：%s" % exc)
        report = parse_report(completed.stdout)
        duration = int((_dt.datetime.now() - started).total_seconds() * 1000)
        if completed.returncode != 0 and report is None:
            return {
                "status": STATUS_ERROR,
                "report": None,
                "exitCode": completed.returncode,
                "error": (completed.stderr or completed.stdout or "").strip()[-800:] or "脚本执行失败",
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "durationMs": duration,
            }
        if report is None:
            return {
                "status": STATUS_ERROR,
                "report": None,
                "exitCode": completed.returncode,
                "error": "脚本没有输出结构化结论（期望 stdout 为 JSON）",
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "durationMs": duration,
            }
        raw_status = str(report.get("status") or "").upper()
        report["reason"] = report_reason(report)
        if raw_status in (STATUS_ABNORMAL, "ABNORMAL"):
            status = STATUS_ABNORMAL
        elif raw_status in (STATUS_NORMAL, "NORMAL", "OK", "PASS"):
            status = STATUS_NORMAL
        elif raw_status in (STATUS_ERROR, "FAILED", "FAIL"):
            status = STATUS_ERROR
        elif "error" in report and report.get("error"):
            status = STATUS_ERROR
        elif _abnormal_count(report):
            status = STATUS_ABNORMAL
        elif completed.returncode not in (0, None):
            status = STATUS_ERROR
        else:
            status = STATUS_NORMAL
        return {
            "status": status,
            "report": report,
            "exitCode": completed.returncode,
            "error": report["reason"] if status == STATUS_ERROR else None,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "durationMs": duration,
            "window": window,
        }
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass


def _abnormal_count(report: Dict[str, Any]) -> int:
    try:
        return int(report.get("abnormalCount") or 0)
    except (TypeError, ValueError):
        return 0


def _checked_count(report: Dict[str, Any]) -> Optional[int]:
    try:
        return int(report.get("checkedCount"))
    except (TypeError, ValueError):
        return None


def compose_message(row: Dict[str, Any], outcome: Dict[str, Any]) -> str:
    stamp = business_now().strftime("%Y-%m-%d %H:%M:%S")
    report = outcome.get("report") or {}
    name = row.get("name") or "#%s" % row.get("id")
    if outcome["status"] == STATUS_ERROR:
        return "%s---[X]:%s-执行失败: %s" % (stamp, name, outcome.get("error"))
    checked = _checked_count(report)
    abnormal = _abnormal_count(report)
    if outcome["status"] == STATUS_ABNORMAL:
        return "%s---[X]:%s-异常, 检查数:%s 异常数:%s" % (stamp, name, checked, abnormal)
    return "%s---[OK]:%s-正常, 检查数:%s 异常数:%s" % (stamp, name, checked, abnormal)


def _overdue_detail(
    app: Optional[Any],
    row: Dict[str, Any],
    conf: Dict[str, Any],
    outcome: Dict[str, Any],
    moment: Optional[_dt.datetime] = None,
    persist: bool = True,
) -> Optional[Dict[str, Any]]:
    """调用「超期无新增」判定。

    ``monitor_overdue`` 依赖本模块的常量与 ``business_now``，这里延迟导入避免
    循环依赖（与 ``monitor_events`` 的接法一致）。``persist=False`` 是干跑：
    只读状态、只返回判定，不落任何状态。
    """

    if app is None:
        return None
    if (outcome or {}).get("status") == STATUS_ERROR:
        # 执行失败时「0 条」不可信（多半是脚本没跑起来），既不能判超期，
        # 也不能刷新 lastDataAt——留给下一次成功的执行。
        return None
    from . import monitor_overdue
    return monitor_overdue.evaluate(app, row, conf, outcome, moment=moment, persist=persist)


def run_due(
    conn,
    cfg: Dict[str, Any],
    *,
    apply: bool = False,
    limit: int = 20,
    monitor_ids: Optional[Iterable[int]] = None,
    force: bool = False,
    now: Optional[_dt.datetime] = None,
    app: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """执行到点的 AI 检查。``apply=False`` 时只执行不写库。

    ``app`` 只在 HTTP/后台服务里传：apply 成功后用它落异常事件；
    CLI dry-run（无 app）不碰事件存储。
    """

    wanted = {int(value) for value in (monitor_ids or [])}
    candidates = fetch_candidates(conn, wanted)
    moment = now or business_now(cfg)
    results: List[Dict[str, Any]] = []
    lease = int(cfg.get("lockLeaseMinutes") or LOCK_LEASE_MINUTES)
    for row in candidates:
        if len(results) >= limit:
            break
        conf = row["conf"]
        monitor_id = int(row["id"])
        if wanted and monitor_id not in wanted:
            continue
        if not force and not is_row_due(conf, row, moment):
            continue
        if not _acquire_local(monitor_id):
            results.append(skipped_item(row, "同一条检查已在本进程执行中，本轮跳过"))
            continue
        claimed = False
        try:
            # 先占位再执行：手动触发与后台轮询同时到点时，只有一个能拿到 LOCK_STATE='L'。
            # 旧实现是先跑脚本再 claim，跑完才发现抢不到锁——既白跑一次，也可能，
            # 两个实例同时落库（后写的覆盖先写的）。
            if apply:
                if not claim(conn, monitor_id, lease):
                    results.append(
                        skipped_item(row, "另一个执行实例已占用该检查（LOCK_STATE=L 未释放），本轮跳过")
                    )
                    continue
                claimed = True
            execution_conf = dict(conf, tableName=row.get("table_name") or conf.get("tableName") or "",
                                  sourceId=row.get("source_id"))
            outcome = execute(conf.get("script") or "", execution_conf, cfg)
            run_id = "run-%s-%s" % (monitor_id, moment.strftime("%Y%m%d%H%M%S"))
            item = {
                "runId": run_id,
                "monitorId": monitor_id,
                "sourceId": row.get("source_id"),
                "name": row.get("name"),
                "tableName": row.get("table_name"),
                "status": outcome["status"],
                "checkedCount": _checked_count(outcome.get("report") or {}),
                "abnormalCount": _abnormal_count(outcome.get("report") or {}),
                "reason": (outcome.get("report") or {}).get("reason"),
                "message": compose_message(row, outcome),
                "durationMs": outcome["durationMs"],
                "exitCode": outcome["exitCode"],
                "error": outcome.get("error"),
                "window": outcome.get("window") or window_for(conf, moment),
                "applied": False,
            }
            if apply:
                apply_result(conn, row, conf, outcome, item, cfg, app)
                item["applied"] = True
            elif app is not None:
                # 干跑只算不写：只把「会不会判超期」带进输出，不改状态、不落状态。
                # 判定依赖上次 apply 记下的 lastDataAt，所以干跑前得先真实跑过一次。
                try:
                    detail = _overdue_detail(app, row, conf, outcome, moment, persist=False)
                except Exception as exc:  # 判定失败不能拖垮整轮扫描
                    print("超期判定失败（干跑，%s）：%s" % (monitor_id, exc), file=sys.stderr, flush=True)
                    detail = None
                if detail is not None:
                    item["overdue"] = detail
            results.append(item)
        finally:
            if claimed:
                try:
                    release(conn, monitor_id)
                except Exception:  # pragma: no cover - 释放失败不能盖住真实错误
                    pass
            _release_local(monitor_id)
    return results


def skipped_item(row: Dict[str, Any], reason: str) -> Dict[str, Any]:
    """没抢到执行权时的占位结果——调用方要能区分「跳过」与「执行失败」。"""

    return {
        "runId": None,
        "monitorId": int(row["id"]),
        "sourceId": row.get("source_id"),
        "name": row.get("name"),
        "tableName": row.get("table_name"),
        "status": "SKIPPED",
        "checkedCount": None,
        "abnormalCount": None,
        "reason": reason,
        "message": None,
        "durationMs": None,
        "exitCode": None,
        "error": None,
        "window": None,
        "applied": False,
        "skipped": True,
    }


# ------------------------------------------------------------------------- 写库


def claim(conn, monitor_id: int, lease_minutes: int = LOCK_LEASE_MINUTES) -> bool:
    """先占位再执行，避免手动运行与后台轮询重叠时重复跑同一条检查。

    只有把 ``LOCK_STATE`` 抢到 ``'L'`` 的那一次调用返回 True；抓不到就说明已经有人
    在跑，调用方必须跳过而不是照样执行。租约用 ``LAST_RUN`` 判断：上一轮占位超过
    ``lease_minutes`` 还没写回结果（进程被杀/机器重启），允许接管，避免永久卡死。
    """

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ck_source SET LOCK_STATE='L' WHERE ID=%s AND IS_DELETE=0 AND ("
            "LOCK_STATE IS NULL OR LOCK_STATE<>'L' "
            "OR LAST_RUN IS NULL OR LAST_RUN < NOW() - INTERVAL %s MINUTE)",
            (monitor_id, max(1, int(lease_minutes))),
        )
        return cur.rowcount == 1


def release(conn, monitor_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE ck_source SET LOCK_STATE='C' WHERE ID=%s", (monitor_id,))


def fetch_candidates(conn, wanted: Optional[set] = None) -> List[Dict[str, Any]]:
    """读出候选 AI 检查（按 ID 翻页，避免 ID 靠后的检查被 LIMIT 截掉）。

    旧实现一条 ``LIMIT MAX_CANDIDATES`` 的查询：共享库里 ``ck_source`` 行数远超
    200 时，ID 靠后的 AI 检查根本进不了候选，界面看着「有计划」却永远不执行。
    """

    rows: List[Dict[str, Any]] = []
    last_id = 0
    while len(rows) < MAX_CANDIDATES:
        sql = (
            "SELECT ID, NAME, SOURCE_ID, TABLE_NAME, CHECK_CONF, SCHEDULE, NEXT_RUN, LAST_RUN, GROUP_ID, CREATE_DT "
            "FROM ck_source WHERE IS_DELETE=0 AND ID > %s"
        )
        params: List[Any] = [last_id]
        if wanted:
            sql += " AND ID IN (%s)" % ",".join(["%s"] * len(wanted))
            params.extend(sorted(wanted))
        sql += " ORDER BY ID ASC LIMIT %s"
        params.append(CANDIDATE_PAGE)
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            batch = cur.fetchall() or []
        if not batch:
            break
        for row in batch:
            if isinstance(row, dict):
                item = dict(row)
            else:
                item = dict(zip(("id", "name", "source_id", "table_name", "check_conf", "schedule", "next_run", "last_run", "group_id", "create_dt"), row))
            conf = _parse_conf(item.get("check_conf"))
            item["conf"] = conf
            if is_ai_check(conf):
                rows.append(item)
        last_id = int(batch[-1]["id"] if isinstance(batch[-1], dict) else batch[-1][0])
        if len(batch) < CANDIDATE_PAGE:
            break
    return rows


def structured_remarks(
    item: Dict[str, Any],
    conf: Dict[str, Any],
    outcome: Dict[str, Any],
    cfg: Optional[Dict[str, Any]] = None,
    overdue: Optional[Dict[str, Any]] = None,
) -> str:
    """``ck_job_log.REMARKS`` 的结构化结论（前端运行记录读它）。

    两件事必须保证：
    * 合法 JSON——宁可少字段，也不能截断成半个对象；
    * ``runId``/``status``/两个计数/耗时优先保住，窗口、原因、脚本路径、
      超期详情可选。

    超长时按价值从低到高丢：``scriptPath`` → ``window`` → ``overdue`` →
    截断 ``reason``；超期长原因只留在 ``reason`` 里，``overdue`` 只放短字段。
    """

    limit = int((cfg or {}).get("remarksMax") or REMARKS_MAX)
    payload: Dict[str, Any] = {
        "runId": item.get("runId"),
        "monitorId": item.get("monitorId") or (int(item["monitorId"]) if item.get("monitorId") else None),
        "status": outcome["status"],
        "checkedCount": _checked_count(outcome.get("report") or {}),
        "abnormalCount": _abnormal_count(outcome.get("report") or {}),
        "durationMs": item.get("durationMs"),
    }
    optional = {
        "window": item.get("window") or outcome.get("window"),
        "reason": (outcome.get("report") or {}).get("reason"),
        "scriptPath": conf.get("scriptPath"),
    }
    payload.update(optional)
    if overdue and overdue.get("overdue"):
        # 只在超期时出现：正常轮次不额外写字段，每条运行记录都能省一点。
        payload["overdue"] = {
            "overdue": True,
            "expectEveryMinutes": overdue.get("expectEveryMinutes"),
            "graceMinutes": overdue.get("graceMinutes"),
            "lastDataAt": overdue.get("lastDataAt"),
            "gapMinutes": overdue.get("gapMinutes"),
        }
    text = json.dumps(payload, ensure_ascii=False)
    # 先丢低价值字段，再退化为只保留核心字段；理由超长就截断理由本身。
    for key in ("scriptPath", "window", "overdue"):
        if len(text) <= limit:
            break
        payload.pop(key, None)
        text = json.dumps(payload, ensure_ascii=False)
    if len(text) > limit and payload.get("reason"):
        overflow = len(text) - limit
        reason = str(payload["reason"])
        payload["reason"] = reason[: max(0, len(reason) - overflow - 1)] + "…"
        text = json.dumps(payload, ensure_ascii=False)
    return text


def apply_result(
    conn,
    row: Dict[str, Any],
    conf: Dict[str, Any],
    outcome: Dict[str, Any],
    item: Dict[str, Any],
    cfg: Optional[Dict[str, Any]] = None,
    app: Optional[Any] = None,
) -> None:
    now = business_now()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    # 写库/生成结构化结论之前先做「超期无新增」判定：脚本报 0 条只能是「正常」，
    # 断流时这个「正常」是假绿，必须在这一步被抬成异常。
    overdue = None
    if app is not None:
        try:
            overdue = _overdue_detail(app, row, conf, outcome, now, persist=True)
        except Exception as exc:
            # 判定失败不能回滚已经跑完的结果，但也不能静默：从 stderr 能追到原因。
            print("超期无新增判定失败：%s" % exc, file=sys.stderr, flush=True)
    if overdue and overdue.get("overdue") and outcome.get("status") == STATUS_NORMAL:
        overdue_reason = overdue.get("reason") or ""
        outcome = dict(outcome)
        report = dict(outcome.get("report") or {})
        # 保持既有口径：异常数至少 1，前端/邮件按 abnormalCount>0 也能看出问题。
        report["abnormalCount"] = max(1, _abnormal_count(report))
        report["reason"] = overdue_reason
        outcome["report"] = report
        outcome["status"] = STATUS_ABNORMAL
        # item 是 notification 事件与返回值的共同来源，一起改，避免状态自相矛盾。
        item["status"] = STATUS_ABNORMAL
        item["abnormalCount"] = report["abnormalCount"]
        item["reason"] = overdue_reason
        item["message"] = compose_message(row, outcome)
    message = item["message"]
    state = "E" if outcome["status"] != STATUS_NORMAL else "C"
    schedule = dict(conf.get("schedule") or {})
    schedule["last"] = stamp
    try:
        schedule["next"] = next_run_at(str(row.get("schedule") or ""), now)
    except ValueError as exc:
        # 计划填错也不该丢掉这次已经跑完的结果：记下原因，等下次保存修正。
        schedule["next"] = None
        schedule["cronError"] = str(exc)
    conf = dict(conf)
    conf["schedule"] = schedule
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ck_source SET STATE=%s, LAST_MSG=%s, LAST_RUN=%s, CHECK_CONF=%s, VER=%s "
            "WHERE ID=%s AND IS_DELETE=0",
            (state, message, stamp, json.dumps(conf, ensure_ascii=False), int(now.timestamp() * 1000), int(row["id"])),
        )
        structured = structured_remarks(item, conf, outcome, cfg, overdue=overdue)
        cur.execute(
            "INSERT INTO ck_job_log (JOB_ID, NAME, SOURCE_ID, TABLE_NAME, JOB_TYPE, STATE, LOG_TYPE, "
            "LOG_CODE, LOG_MSG, JOB_CONF, REMARKS, LOG_DT, CREATE_DT, GROUP_ID) "
            "VALUES (%s,%s,%s,%s,'source',%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                int(row["id"]),
                row.get("name"),
                row.get("source_id"),
                row.get("table_name"),
                state,
                "正常" if state == "C" else "出错",
                "0" if state == "C" else "-1",
                message,
                json.dumps(conf, ensure_ascii=False),
                structured,
                stamp,
                stamp,
                row.get("group_id"),
            ),
        )
    if app is not None:
        # 事件存储是 Runner 自己的 settings 表，失败不能回滚已经落库的检查结果，
        # 但也不能静默吞掉——通知没发出去必须能从 stderr 追到原因。
        from . import monitor_events
        try:
            monitor_events.record(app, item, conf, outcome)
        except Exception as exc:
            print("记录监控异常事件失败：%s" % exc, file=sys.stderr, flush=True)


# ------------------------------------------------------------------------ CLI


def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="执行到点的 AI 数据检查（默认 dry-run）")
    parser.add_argument("--apply", action="store_true", help="回写 ck_source / ck_job_log")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--monitor-id", type=int, action="append", default=[])
    parser.add_argument("--force", action="store_true", help="忽略计划时间（仅用于验证）")
    args = parser.parse_args(argv)

    try:
        import pymysql  # noqa: F401
    except ImportError:
        print(json.dumps({"error": "缺少 pymysql（脚本执行需要它连库）"}, ensure_ascii=False))
        return 2

    cfg = load_config()
    db = cfg["db"]
    import pymysql

    try:
        conn = pymysql.connect(
            host=db["host"],
            port=db["port"],
            user=db["user"],
            password=db["password"],
            database=db["database"] or None,
            charset="utf8mb4",
            autocommit=True,
        )
    except Exception as exc:  # pragma: no cover - 环境问题
        print(json.dumps({"error": "无法连接监控库：%s" % exc}, ensure_ascii=False))
        return 2
    try:
        results = run_due(
            conn,
            cfg,
            apply=args.apply,
            limit=args.limit,
            monitor_ids=args.monitor_id,
            force=args.force,
        )
    finally:
        conn.close()
    print(json.dumps({"apply": args.apply, "count": len(results), "items": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
