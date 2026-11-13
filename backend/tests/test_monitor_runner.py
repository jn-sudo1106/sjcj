"""monitor_runner 的单元测试：计划计算、结论解析、状态判定与回写边界。"""

import datetime as dt
import json
import os
import sys
import unittest
from unittest.mock import mock_open, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.runner_management import monitor_runner as runner  # noqa: E402


class DatabaseEnvironmentTest(unittest.TestCase):
    def test_invalid_column_stops_before_script_execution(self):
        with patch.object(runner, "table_fields", return_value=["CREATE_DT"]), \
                patch.object(runner.subprocess, "run") as run:
            result = runner.execute("print('should not run')", {"tableName": "sense_data.T", "timeColumn": "msg_time"}, {})
        self.assertEqual(result["status"], runner.STATUS_ERROR)
        self.assertIn("不存在入库时间字段 msg_time", result["error"])
        run.assert_not_called()

    def test_execution_receives_table_column_and_window(self):
        import types
        report = {"status": "ERROR", "abnormalReasons": ["具体失败原因"]}
        with patch.object(runner, "table_fields", return_value=["CREATE_DT"]), \
                patch.object(runner.subprocess, "run", return_value=types.SimpleNamespace(stdout=json.dumps(report), stderr="", returncode=0)) as run:
            result = runner.execute("pass", {"tableName": "sense_data.T", "timeColumn": "CREATE_DT"}, {"timeout": 10})
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["DQ_TABLE_NAME"], "sense_data.T")
        self.assertEqual(env["DQ_TIME_COLUMN"], "CREATE_DT")
        self.assertIn("DQ_START_DATE", env)
        self.assertEqual(result["report"]["reason"], "具体失败原因")

    def test_legacy_and_dq_scripts_use_same_configured_database(self):
        config = {
            "db": {"host": "test-db", "port": 9907, "user": "reader", "password": "test-only", "database": "sense_db"},
            "env": {"DQ_DB_HOST": "configured-db", "DB_PORT": "3306"},
        }
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_CONFIG": "/config.json", "DB_HOST": "old-db"}, clear=True), \
                patch("builtins.open", mock_open(read_data=json.dumps(config))):
            cfg = runner.load_config()
        for suffix in ("HOST", "PORT", "USER", "PASSWORD", "NAME"):
            self.assertEqual(cfg["env"]["DB_" + suffix], cfg["env"]["DQ_DB_" + suffix])
        self.assertEqual(cfg["env"]["DB_PORT"], "9907")
        self.assertEqual(cfg["env"]["DB_HOST"], "configured-db")


class CronTest(unittest.TestCase):
    def test_quartz_style_daily(self):
        after = dt.datetime(2026, 11, 12, 9, 0, 0)
        self.assertEqual(runner.next_run_at("0 0 8 * * ?", after), "2026-11-13 08:00:00")
        before = dt.datetime(2026, 11, 12, 7, 59, 0)
        self.assertEqual(runner.next_run_at("0 0 8 * * ?", before), "2026-11-12 08:00:00")

    def test_every_hour(self):
        after = dt.datetime(2026, 11, 12, 9, 30, 0)
        self.assertEqual(runner.next_run_at("0 0 * * * ?", after), "2026-11-12 10:00:00")

    def test_five_field(self):
        after = dt.datetime(2026, 11, 12, 9, 30, 0)
        self.assertEqual(runner.next_run_at("30 6 * * *", after), "2026-11-13 06:30:00")

    def test_step_and_list(self):
        after = dt.datetime(2026, 11, 12, 9, 0, 0)
        self.assertEqual(runner.next_run_at("0 0/15 1,4 * * ?", after), "2026-11-13 01:00:00")

    def test_invalid(self):
        with self.assertRaises(ValueError):
            runner.next_run_at("0 0 8", dt.datetime(2026, 11, 12, 9, 0, 0))


class ParseReportTest(unittest.TestCase):
    def test_last_json_wins(self):
        stdout = '准备开始\n{"a": 1}\n调试 {"b": 2}\n最终 {"checkedCount": 3}\n'
        self.assertEqual(runner.parse_report(stdout), {"checkedCount": 3})

    def test_no_json(self):
        self.assertIsNone(runner.parse_report("纯文本输出"))

    def test_broken_json_skipped(self):
        self.assertEqual(runner.parse_report('{"a": }\n{"ok": true}'), {"ok": True})


class DueTest(unittest.TestCase):
    def test_conf_schedule_preferred(self):
        conf = {"kind": "ai", "script": "x", "schedule": {"next": "2026-11-12 08:00:00"}}
        now = dt.datetime(2026, 11, 12, 9, 0, 0)
        self.assertTrue(runner.is_due(conf, now, "2027-01-01 08:00:00"))

    def test_future_not_due(self):
        conf = {"kind": "ai", "script": "x", "schedule": {"next": "2026-11-13 08:00:00"}}
        now = dt.datetime(2026, 11, 12, 9, 0, 0)
        self.assertFalse(runner.is_due(conf, now))

    def test_missing_schedule_uses_fallback(self):
        conf = {"kind": "ai", "script": "x"}
        now = dt.datetime(2026, 11, 12, 9, 0, 0)
        self.assertFalse(runner.is_due(conf, now, "2027-01-01 08:00:00"))
        self.assertTrue(runner.is_due(conf, now, "2026-11-12 08:00:00"))

    def test_rule_or_scriptless_is_not_ai_check(self):
        self.assertFalse(runner.is_ai_check({"kind": "rule", "script": "x"}))
        self.assertFalse(runner.is_ai_check({"kind": "ai", "script": "  "}))
        self.assertTrue(runner.is_ai_check({"kind": "ai", "script": "print(1)"}))


class ArgvTest(unittest.TestCase):
    def test_table_and_time_column(self):
        argv = runner.build_argv({"tableName": "sense_data.T", "timeColumn": "CREATE_DT"})
        self.assertEqual(argv, ["--format", "json", "--table", "sense_data.T", "--time-column", "CREATE_DT"])

    def test_without_context(self):
        self.assertEqual(runner.build_argv({}), ["--format", "json"])


class StatusTest(unittest.TestCase):
    def _run(self, stdout, returncode=0):
        script = "import sys\nsys.exit(%d)\n" % returncode
        cfg = {"python": sys.executable, "timeout": 10, "env": dict(os.environ)}
        return runner.execute(script, {}, cfg)

    def test_error_status_is_not_normal(self):
        cfg = {"python": sys.executable, "timeout": 10, "env": dict(os.environ)}
        script = (
            "import json\n"
            "print(json.dumps({'status': 'ERROR', 'reason': '检查执行失败', 'checkedCount': 0, 'abnormalCount': 0}))\n"
        )
        outcome = runner.execute(script, {}, cfg)
        self.assertEqual(outcome["status"], runner.STATUS_ERROR)

    def test_abnormal(self):
        cfg = {"python": sys.executable, "timeout": 10, "env": dict(os.environ)}
        script = "import json\nprint(json.dumps({'status':'ABNORMAL','checkedCount':2,'abnormalCount':1}))\n"
        outcome = runner.execute(script, {}, cfg)
        self.assertEqual(outcome["status"], runner.STATUS_ABNORMAL)
        self.assertEqual(outcome["report"]["abnormalCount"], 1)

    def test_normal(self):
        cfg = {"python": sys.executable, "timeout": 10, "env": dict(os.environ)}
        script = "import json\nprint(json.dumps({'status':'NORMAL','checkedCount':5,'abnormalCount':0}))\n"
        outcome = runner.execute(script, {}, cfg)
        self.assertEqual(outcome["status"], runner.STATUS_NORMAL)

    def test_no_json_is_error(self):
        outcome = self._run("print('hello')")
        self.assertEqual(outcome["status"], runner.STATUS_ERROR)
        self.assertIn("结构化结论", outcome["error"])

    def test_nonzero_without_report_is_error(self):
        outcome = self._run("raise SystemExit(3)", returncode=3)
        self.assertEqual(outcome["status"], runner.STATUS_ERROR)


class MessageTest(unittest.TestCase):
    def test_abnormal_message_keeps_legacy_shape(self):
        row = {"id": 1104, "name": "示例检查"}
        outcome = {"status": runner.STATUS_ABNORMAL, "report": {"checkedCount": 10, "abnormalCount": 2}}
        message = runner.compose_message(row, outcome)
        self.assertIn("---[X]:示例检查-异常", message)
        self.assertIn("检查数:10", message)
        self.assertIn("异常数:2", message)

    def test_error_message_says_failed(self):
        row = {"id": 1, "name": "示例"}
        message = runner.compose_message(row, {"status": runner.STATUS_ERROR, "error": "超时", "report": None})
        self.assertIn("执行失败", message)
        self.assertNotIn("正常", message)


class FakeCursor(object):
    def __init__(self, store):
        self.store = store
        self.result = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.store.setdefault("statements", []).append((sql, params))
        if sql.startswith("SELECT"):
            self.result = self.store.get("candidates", [])
        else:
            self.result = []

    def fetchall(self):
        return self.result

    def fetchone(self):
        return self.result[0] if self.result else None

    @property
    def rowcount(self):
        return 1


class FakeConn(object):
    def __init__(self, candidates):
        self.store = {"candidates": candidates}

    def cursor(self):
        return FakeCursor(self.store)


class RunDueTest(unittest.TestCase):
    def test_dry_run_skips_write(self):
        conf = {"kind": "ai", "script": "print('{}')", "schedule": {"next": "2026-11-12 08:00:00"}}
        conn = FakeConn([(1104, "示例", 301, "sense_data.T", json.dumps(conf), "0 0 8 * * ?", None, None, 200)])
        original = runner.execute
        runner.execute = lambda script, conf, cfg: {
            "status": runner.STATUS_ABNORMAL,
            "report": {"checkedCount": 3, "abnormalCount": 1},
            "exitCode": 0,
            "error": None,
            "durationMs": 5,
        }
        try:
            results = runner.run_due(
                conn, {"python": "x", "timeout": 5, "env": {}}, apply=False, now=dt.datetime(2026, 11, 12, 9, 0, 0)
            )
        finally:
            runner.execute = original
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["applied"])
        writes = [sql for sql, _ in conn.store.get("statements", []) if not sql.startswith("SELECT")]
        self.assertEqual(writes, [])

    def test_apply_writes_state_and_log(self):
        conf = {"kind": "ai", "script": "x", "schedule": {"next": "2026-11-12 08:00:00"}}
        conn = FakeConn([(1104, "示例", 301, "sense_data.T", json.dumps(conf), "0 0 8 * * ?", None, None, 200)])
        row = runner.fetch_candidates(conn)[0]
        item = {"message": "m", "status": runner.STATUS_ABNORMAL}
        runner.apply_result(conn, row, conf, {"status": runner.STATUS_ABNORMAL, "report": {}}, item)
        statements = conn.store["statements"]
        update_sql, update_params = [pair for pair in statements if pair[0].startswith("UPDATE ck_source")][0]
        self.assertIn("STATE=%s", update_sql)
        self.assertEqual(update_params[0], "E")
        insert_sql, insert_params = [pair for pair in statements if pair[0].startswith("INSERT INTO ck_job_log")][0]
        self.assertEqual(insert_params[0], 1104)
        self.assertEqual(insert_params[4], "E")
        next_conf = json.loads(update_params[3])
        self.assertIsNotNone(next_conf["schedule"]["next"])

    def test_not_due_is_skipped(self):
        conf = {"kind": "ai", "script": "x", "schedule": {"next": "2099-01-01 00:00:00"}}
        conn = FakeConn([(1104, "示例", 301, "sense_data.T", json.dumps(conf), "0 0 8 * * ?", None, None, 200)])
        results = runner.run_due(
            conn, {"python": "x", "timeout": 5, "env": {}}, apply=False, now=dt.datetime(2026, 11, 12, 9, 0, 0)
        )
        self.assertEqual(results, [])


class LockedCursor(FakeCursor):
    """模拟「锁已被别的执行实例占用」：UPDATE ... LOCK_STATE 影响 0 行。"""

    @property
    def rowcount(self):
        return 0


class LockedConn(FakeConn):
    def cursor(self):
        return LockedCursor(self.store)


class ClaimOrderTest(unittest.TestCase):
    def setUp(self):
        self.conf = {"kind": "ai", "script": "print('{}')", "schedule": {"next": "2026-11-12 08:00:00"}}
        self.row = (1104, "示例", 301, "sense_data.T", json.dumps(self.conf), "0 0 8 * * ?", None, None, 200)
        self.events = []
        self._orig_execute = runner.execute
        runner.execute = lambda script, conf, cfg: (
            self.events.append("execute")
            or {"status": runner.STATUS_ABNORMAL, "report": {"checkedCount": 1, "abnormalCount": 1},
                "exitCode": 0, "error": None, "durationMs": 3}
        )

    def tearDown(self):
        runner.execute = self._orig_execute

    def test_lock_is_taken_before_running_script(self):
        conn = FakeConn([self.row])
        original_cursor = FakeCursor.execute

        def tracking_cursor_execute(cursor_self, sql, params=None):
            if sql.startswith("UPDATE ck_source SET LOCK_STATE"):
                self.events.append("claim")
            return original_cursor(cursor_self, sql, params)

        FakeCursor.execute = tracking_cursor_execute
        try:
            results = runner.run_due(
                conn, {"python": "x", "timeout": 5, "env": {}}, apply=True,
                now=dt.datetime(2026, 11, 12, 9, 0, 0),
            )
        finally:
            FakeCursor.execute = original_cursor
        self.assertEqual(self.events[:2], ["claim", "execute"], "必须先占位再执行脚本")
        self.assertTrue(results[0]["applied"])

    def test_locked_monitor_is_skipped_without_executing(self):
        conn = LockedConn([self.row])
        results = runner.run_due(
            conn, {"python": "x", "timeout": 5, "env": {}}, apply=True,
            now=dt.datetime(2026, 11, 12, 9, 0, 0),
        )
        self.assertEqual(self.events, [], "抢不到占位锁就不能再执行脚本")
        self.assertEqual(results[0]["status"], "SKIPPED")
        self.assertTrue(results[0]["skipped"])
        self.assertFalse(results[0]["applied"])

    def test_same_monitor_in_flight_is_skipped(self):
        conn = FakeConn([self.row])
        runner._IN_FLIGHT.add(1104)
        try:
            results = runner.run_due(
                conn, {"python": "x", "timeout": 5, "env": {}}, apply=True,
                now=dt.datetime(2026, 11, 12, 9, 0, 0),
            )
        finally:
            runner._IN_FLIGHT.discard(1104)
        self.assertEqual(self.events, [])
        self.assertEqual(results[0]["status"], "SKIPPED")


class StructuredRemarksTest(unittest.TestCase):
    def test_keeps_valid_json_when_reason_is_long(self):
        item = {"runId": "run-1104-20261112204836", "monitorId": 1104, "durationMs": 104,
                "window": {"start": "2026-11-12 00:00:00", "end": "2026-11-12 20:48:36"}}
        outcome = {"status": runner.STATUS_ABNORMAL,
                   "report": {"checkedCount": 1, "abnormalCount": 1, "reason": "很长的原因" * 200}}
        text = runner.structured_remarks(item, {"scriptPath": "/code01/x.py"}, outcome, {"remarksMax": 240})
        self.assertLessEqual(len(text), 240)
        parsed = json.loads(text)
        self.assertEqual(parsed["runId"], "run-1104-20261112204836")
        self.assertEqual(parsed["checkedCount"], 1)
        self.assertEqual(parsed["abnormalCount"], 1)
        self.assertEqual(parsed["durationMs"], 104)

    def test_keeps_optional_fields_when_fits(self):
        item = {"runId": "run-1-20261112090000", "monitorId": 1, "durationMs": 5}
        outcome = {"status": runner.STATUS_NORMAL, "report": {"checkedCount": 10, "abnormalCount": 0, "reason": "ok"}}
        text = runner.structured_remarks(item, {"scriptPath": "/code01/x.py"}, outcome, {"remarksMax": 900})
        parsed = json.loads(text)
        self.assertEqual(parsed["reason"], "ok")
        self.assertEqual(parsed["scriptPath"], "/code01/x.py")


if __name__ == "__main__":
    unittest.main()
