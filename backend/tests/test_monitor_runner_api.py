"""AI 数据监控执行器管理接口的单元测试。

覆盖 monitor-runner 的 status / scan / 后台线程接线，全部用 fake app 与
monkeypatch 顶掉 run_due、load_config 和连库函数，不连真库。
"""
import json
import os
import threading
import time
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError

from backend.tests import test_monitor_batches as batch_tests
from backend.runner_management import monitor_batches as batches
from backend.runner_management import monitor_runner
from backend.runner_management import server


CFG = {
    "python": "python3",
    "timeout": 10,
    "timezone": "Asia/Shanghai",
    "db": {"host": "127.0.0.1", "port": 3306, "user": "sense", "password": "", "database": "sense_db"},
    "env": {},
}

ITEM = {
    "runId": "run-1", "monitorId": 7, "sourceId": "s1", "name": "新闻时效",
    "tableName": "sense_data.news", "status": "normal", "checkedCount": 3,
    "abnormalCount": 0, "reason": "", "message": "", "durationMs": 12,
    "exitCode": 0, "error": "", "window": {}, "applied": False,
}


class ScriptTestContract(unittest.TestCase):
    def test_source_and_physical_column_reach_executor_and_reason_is_returned(self):
        outcome = {"status": "ERROR", "report": {"reason": "不存在字段 msg_time"}}
        with patch.object(monitor_runner, "load_config", return_value=CFG), \
                patch.object(monitor_runner, "execute", return_value=outcome) as execute:
            result = server.monitor_runner_test_script({"script": "pass", "tableName": "sense_data.T",
                                                        "timeColumn": "CREATE_DT", "sourceId": "123"})
        self.assertEqual(execute.call_args.args[1]["sourceId"], "123")
        self.assertEqual(execute.call_args.args[1]["timeColumn"], "CREATE_DT")
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "不存在字段 msg_time")


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _FakeConnection:
    """只实现 settings 读写所需的 SQL，用来替换 app.store.connect()。"""

    def __init__(self, store):
        self._store = store

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split()).lower()
        if normalized.startswith("select setting_value from settings"):
            value = self._store.settings.get(params[0])
            return _Result([{"setting_value": value}] if value is not None else [])
        if normalized.startswith("delete from settings"):
            self._store.settings.pop(params[0], None)
            return _Result([])
        if normalized.startswith("insert into settings"):
            self._store.settings[params[0]] = params[1]
            return _Result([])
        raise AssertionError(f"fake store 不接受 SQL：{sql}")


class FakeStore:
    def __init__(self):
        self.settings = {}

    def connect(self):
        return _FakeConnection(self)


class FakeApplication:
    """只提供 monitor-runner 需要的 authenticate_admin 与 settings 读写。"""

    def __init__(self):
        self.store = FakeStore()

    def authenticate_admin(self, headers, client_ip, write=False):
        return {"userLoginName": "tester"}


class _FakeDbConnection:
    """scan/worker 里打开的业务库连接，只关心是否关闭。"""

    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class MonitorRunnerApiTest(unittest.TestCase):
    def setUp(self):
        self.app = FakeApplication()

    def tearDown(self):
        server.MONITOR_RUNNER_WORKER = None

    @contextmanager
    def patched(self, items=None, cfg=None, load_config_error=None, connect_error=None):
        """替换 load_config / connect / run_due，返回调用记录与假连接。"""
        cfg = dict(CFG) if cfg is None else cfg
        connection = _FakeDbConnection()
        calls = []

        def fake_run_due(conn, config, **kwargs):
            calls.append({"connection": conn, "config": config, **kwargs})
            value = items(len(calls)) if callable(items) else (items or [])
            if isinstance(value, Exception):
                raise value
            return value

        load_kwargs = {"side_effect": load_config_error} if load_config_error else {"return_value": cfg}
        connect_kwargs = {"side_effect": connect_error} if connect_error else {"return_value": connection}
        with patch.object(monitor_runner, "load_config", **load_kwargs), \
                patch.object(server, "monitor_runner_connect", **connect_kwargs), \
                patch.object(monitor_runner, "run_due", side_effect=fake_run_due):
            yield SimpleNamespace(calls=calls, connection=connection)

    # ---- status ----

    def test_status_reports_state_and_availability(self):
        batches.write(self.app, server.MONITOR_RUNNER_STATE_KEY, {
            "lastRunAt": "2026-11-12T00:00:00+00:00", "count": 3, "applied": 2,
            "lastError": "上一次失败",
        })
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_ENABLED": "1",
                                     "RUNNER_MONITOR_RUNNER_SECONDS": "60"}), self.patched():
            status = server.monitor_runner_status(self.app)
        self.assertIs(status["enabled"], True)
        self.assertIs(status["running"], False)
        self.assertEqual(status["intervalSeconds"], 60)
        self.assertEqual(status["lastRunAt"], "2026-11-12T00:00:00+00:00")
        self.assertEqual(status["lastError"], "上一次失败")
        self.assertEqual(status["lastResult"],
                         {"count": 3, "applied": 2, "at": "2026-11-12T00:00:00+00:00"})
        self.assertIs(status["available"], True)
        self.assertIsNone(status["reason"])

    def test_status_honours_enabled_and_interval_environment(self):
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_ENABLED": "false",
                                     "RUNNER_MONITOR_RUNNER_SECONDS": "3"}), self.patched():
            status = server.monitor_runner_status(self.app)
        self.assertIs(status["enabled"], False)
        # 最小 10 秒，不能按 3 秒疯狂轮询。
        self.assertEqual(status["intervalSeconds"], 10)
        self.assertIsNone(status["lastRunAt"])
        self.assertIsNone(status["lastError"])
        self.assertIsNone(status["lastResult"])
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_SECONDS": "not-a-number"}), self.patched():
            self.assertEqual(server.monitor_runner_interval(), 60)

    def test_status_reports_unavailable_when_config_unreadable(self):
        error = monitor_runner.RunnerUnavailable("执行器配置不可读：缺少 RUNNER_MONITOR_DELIVERY_CONFIG")
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_ENABLED": "1"}), \
                self.patched(load_config_error=error):
            status = server.monitor_runner_status(self.app)
        self.assertIs(status["available"], False)
        self.assertIn("执行器配置不可读", status["reason"])
        # 不能拿 0 计数冒充正常结果。
        self.assertIsNone(status["lastResult"])

    def test_status_reports_unavailable_without_business_database(self):
        cfg = {**CFG, "db": {**CFG["db"], "database": ""}}
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_ENABLED": "1"}), self.patched(cfg=cfg):
            status = server.monitor_runner_status(self.app)
        self.assertIs(status["available"], False)
        self.assertIn("db.database", status["reason"])

    # ---- scan ----

    def test_scan_defaults_to_dry_run_with_limit_five(self):
        items = [dict(ITEM), {**ITEM, "runId": "run-2", "monitorId": 8}]
        with self.patched(items=items) as calls:
            result = server.monitor_runner_scan({})
        self.assertEqual(result, {"applied": False, "count": 2, "items": items})
        self.assertEqual(len(calls.calls), 1)
        call = calls.calls[0]
        self.assertEqual(call["config"], CFG)
        self.assertIs(call["apply"], False)
        self.assertEqual(call["limit"], 5)
        self.assertEqual(call["monitor_ids"], [])
        self.assertIs(call["force"], False)
        self.assertTrue(calls.connection.closed)

    def test_scan_clamps_limit_and_normalises_monitor_ids(self):
        with self.patched(items=[]) as calls:
            result = server.monitor_runner_scan(
                {"apply": True, "limit": 999, "monitorIds": [3, "4"], "force": True})
            server.monitor_runner_scan({"limit": 0})
        self.assertEqual(result, {"applied": True, "count": 0, "items": []})
        first, second = calls.calls
        self.assertIs(first["apply"], True)
        self.assertIs(first["force"], True)
        self.assertEqual(first["limit"], 50)
        self.assertEqual(first["monitor_ids"], [3, 4])
        self.assertEqual(second["limit"], 1)

    def test_scan_rejects_invalid_parameters(self):
        cases = [
            ({"limit": "abc"}, "limit 无效"),
            ({"monitorIds": 3}, "monitorIds 必须是整数数组"),
            ({"monitorIds": ["x"]}, "monitorIds 必须是整数数组"),
            ({"apply": "false"}, "apply 必须是布尔值"),
            ({"force": 1}, "force 必须是布尔值"),
        ]
        with self.patched(items=[]) as calls:
            for payload, message in cases:
                with self.assertRaises(server.ApiError) as caught:
                    server.monitor_runner_scan(payload)
                self.assertEqual(caught.exception.status, 400)
                self.assertEqual(str(caught.exception), message)
        self.assertEqual(calls.calls, [])

    def test_scan_reports_unavailable_without_business_database(self):
        cfg = {**CFG, "db": {**CFG["db"], "database": ""}}
        with self.patched(cfg=cfg) as calls:
            with self.assertRaises(monitor_runner.RunnerUnavailable) as caught:
                server.monitor_runner_scan({})
        self.assertIn("db.database", str(caught.exception))
        self.assertEqual(calls.calls, [])

    def test_scan_propagates_config_unavailable(self):
        error = monitor_runner.RunnerUnavailable("执行器配置不可读：bad json")
        with self.patched(load_config_error=error):
            with self.assertRaises(monitor_runner.RunnerUnavailable) as caught:
                server.monitor_runner_scan({"apply": True})
        self.assertIs(caught.exception, error)

    def test_scan_wraps_connection_failure_as_unavailable(self):
        with self.patched(items=[], connect_error=OSError("Can't connect to MySQL server")):
            with self.assertRaises(monitor_runner.RunnerUnavailable) as caught:
                server.monitor_runner_scan({"apply": True})
        self.assertIn("无法连接监控库", str(caught.exception))
        self.assertIn("Can't connect to MySQL server", str(caught.exception))

    # ---- 后台线程 ----

    def test_worker_survives_failure_and_records_state(self):
        stopped = threading.Event()
        snapshots = []

        def items(index):
            if index == 1:
                return [dict(ITEM)]
            if index == 2:
                raise RuntimeError("库超时")
            # 第三轮被执行，说明线程在异常后仍然活着；记下当时状态后收工。
            snapshots.append(server.monitor_runner_state(self.app))
            stopped.set()
            return [{**ITEM, "applied": True}]

        thread = threading.Thread(target=server.monitor_runner_worker,
                                  args=(self.app, stopped), daemon=True)
        with self.patched(items=items) as calls, \
                patch.object(server, "monitor_runner_interval", return_value=0.05):
            thread.start()
            thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(calls.calls), 3)
        self.assertIn("执行失败", snapshots[0]["lastError"])
        self.assertIn("库超时", snapshots[0]["lastError"])
        state = server.monitor_runner_state(self.app)
        self.assertIsNone(state["lastError"])
        self.assertEqual(state["count"], 1)
        self.assertEqual(state["applied"], 1)
        self.assertTrue(state["lastRunAt"])

    def test_worker_records_failure_state_without_touching_counter(self):
        stopped = threading.Event()

        def items(index):
            batches.write(self.app, server.MONITOR_RUNNER_STATE_KEY,
                          {"lastRunAt": "2026-11-11T00:00:00+00:00", "count": 9, "applied": 4})
            stopped.set()
            raise RuntimeError("库超时")

        with self.patched(items=items), \
                patch.object(server, "monitor_runner_interval", return_value=0.05):
            server.monitor_runner_worker(self.app, stopped)
        state = server.monitor_runner_state(self.app)
        self.assertIn("执行失败", state["lastError"])
        self.assertIn("库超时", state["lastError"])
        self.assertEqual(state["count"], 0)
        self.assertEqual(state["applied"], 0)

    def test_start_respects_switch_and_status_reports_running(self):
        stopped = threading.Event()
        with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_ENABLED": "0"}), \
                patch.object(server, "monitor_runner_round", return_value={}):
            self.assertIsNone(server.monitor_runner_start(self.app, stopped))
        worker = None
        try:
            with patch.dict(os.environ, {"RUNNER_MONITOR_RUNNER_ENABLED": "1"}), \
                    patch.object(server, "monitor_runner_round", return_value={}), \
                    patch.object(server, "monitor_runner_interval", return_value=30):
                worker = server.monitor_runner_start(self.app, stopped)
                self.assertIsNotNone(worker)
                self.assertIs(server.MONITOR_RUNNER_WORKER, worker)
                for _ in range(200):
                    if worker.is_alive():
                        break
                    time.sleep(0.01)
                with self.patched():
                    status = server.monitor_runner_status(self.app)
                self.assertIs(status["running"], True)
                self.assertEqual(status["intervalSeconds"], 30)
        finally:
            stopped.set()
            if worker:
                worker.join(timeout=5)
            server.MONITOR_RUNNER_WORKER = None
        self.assertFalse(worker.is_alive())


class MonitorRunnerRouteTest(unittest.TestCase):
    """走真实 HTTP 的路由接线测试（Application 用临时 SQLite，不连真库）。"""

    tearDown = batch_tests.MonitorBatchesTest.tearDown
    request = batch_tests.MonitorBatchesTest.request

    def setUp(self):
        batch_tests.MonitorBatchesTest.setUp(self)
        self.addCleanup(setattr, server, "MONITOR_RUNNER_WORKER", None)

    def test_status_route_returns_persisted_state(self):
        batches.write(self.app, server.MONITOR_RUNNER_STATE_KEY,
                      {"lastRunAt": "2026-11-12T01:02:03+00:00", "count": 4, "applied": 1})
        environment = {"RUNNER_MONITOR_RUNNER_ENABLED": "1", "RUNNER_MONITOR_RUNNER_SECONDS": "60"}
        with patch.dict(os.environ, environment), \
                patch.object(monitor_runner, "load_config", return_value=dict(CFG)):
            status = self.request("/api/runner-management/monitor-runner/status")
        self.assertIs(status["enabled"], True)
        self.assertIs(status["running"], False)
        self.assertEqual(status["intervalSeconds"], 60)
        self.assertEqual(status["lastResult"],
                         {"count": 4, "applied": 1, "at": "2026-11-12T01:02:03+00:00"})
        self.assertIs(status["available"], True)

    def test_scan_route_defaults_to_dry_run(self):
        calls = []

        def fake_run_due(conn, cfg, **kwargs):
            calls.append(kwargs)
            return [dict(ITEM)]

        with patch.object(monitor_runner, "load_config", return_value=dict(CFG)), \
                patch.object(server, "monitor_runner_connect", return_value=_FakeDbConnection()), \
                patch.object(monitor_runner, "run_due", side_effect=fake_run_due):
            result = self.request("/api/runner-management/monitor-runner/scan", {})
        self.assertEqual(result, {"applied": False, "count": 1, "items": [dict(ITEM)]})
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0]["apply"], False)
        self.assertEqual(calls[0]["limit"], 5)
        self.assertEqual(calls[0]["monitor_ids"], [])

    def test_scan_route_returns_503_when_database_unavailable(self):
        message = "无法连接监控库：(2003, \"Can't connect to MySQL server\")"
        error = monitor_runner.RunnerUnavailable(message)
        with patch.object(monitor_runner, "load_config", side_effect=error):
            with self.assertRaises(HTTPError) as caught:
                self.request("/api/runner-management/monitor-runner/scan", {"apply": True})
        self.assertEqual(caught.exception.code, 503)
        self.assertEqual(json.load(caught.exception), {"error": message})
        caught.exception.close()

    def test_scan_route_rejects_invalid_limit(self):
        with patch.object(monitor_runner, "load_config", return_value=dict(CFG)):
            with self.assertRaises(HTTPError) as caught:
                self.request("/api/runner-management/monitor-runner/scan", {"limit": "abc"})
        self.assertEqual(caught.exception.code, 400)
        self.assertEqual(json.load(caught.exception), {"message": "limit 无效"})
        caught.exception.close()


class AuthRedirectTest(unittest.TestCase):
    """管理服务登录校验：3xx 跳登录页 = 会话失效（401），不是认证服务故障（502）。"""

    class _Handler(BaseHTTPRequestHandler):
        mode = "redirect"

        def do_GET(self):  # noqa: N802
            if self.mode == "redirect":
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:%d/api/logout.htm" % self.server.server_port)
                self.end_headers()
            else:
                self.send_response(500)
                self.end_headers()

        def log_message(self, *args):
            pass

    def setUp(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self._Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:%d/api/v1/user/info" % self.httpd.server_port
        self.patches = [
            patch.dict(os.environ, {"RUNNER_AUTH_URL": self.url, "RUNNER_ADMIN_TOKEN": ""}, clear=False),
        ]
        for item in self.patches:
            item.start()
        self.app = server.Application.__new__(server.Application)

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.httpd.shutdown()
        self.httpd.server_close()

    def test_redirect_to_login_means_not_logged_in(self):
        with self.assertRaises(server.ApiError) as ctx:
            self.app.authenticate_admin({"Cookie": "EADMIN_SESSION=x"}, "127.0.0.1")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("登录状态验证失败", str(ctx.exception))

    def test_server_error_still_reports_auth_service_failure(self):
        self._Handler.mode = "error"
        try:
            with self.assertRaises(server.ApiError) as ctx:
                self.app.authenticate_admin({"Cookie": "EADMIN_SESSION=x"}, "127.0.0.1")
            self.assertEqual(ctx.exception.status, 502)
        finally:
            self._Handler.mode = "redirect"

if __name__ == "__main__":
    unittest.main()
