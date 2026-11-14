"""``monitor_overdue`` 的单元测试：策略兼容、首次初始化、超期判定与干跑/落库边界。

判定本身只依赖 settings 里的游标，用轻量 ``FakeApplication``（只实现 settings
读写）即可；接进执行器的那部分沿用 ``test_monitor_runner`` 的 ``FakeConn`` 假业务库。
"""

import datetime as dt
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.tests.test_monitor_runner import FakeConn  # noqa: E402
from backend.tests.test_monitor_runner_api import FakeApplication  # noqa: E402
from backend.runner_management import monitor_batches as batches  # noqa: E402
from backend.runner_management import monitor_overdue as overdue  # noqa: E402
from backend.runner_management import monitor_runner as runner  # noqa: E402

MOMENT = dt.datetime(2026, 11, 12, 9, 0, 0)
MONITOR_ID = 1104


def result(checked=0, abnormal=0, status=None):
    return {
        "status": status or runner.STATUS_NORMAL,
        "report": {"checkedCount": checked, "abnormalCount": abnormal},
        "exitCode": 0,
        "error": None,
        "durationMs": 5,
    }


def policy(expect=1440, grace=120):
    return {"overduePolicy": {"expectEveryMinutes": expect, "graceMinutes": grace}}


class OverdueEvaluateTest(unittest.TestCase):
    def setUp(self):
        self.app = FakeApplication()
        self.monitor = {"id": MONITOR_ID, "name": "示例检查"}
        self.key = overdue.state_key(MONITOR_ID)

    def seed(self, last_data, status="normal"):
        batches.write(self.app, self.key, {
            "lastDataAt": last_data, "lastStatus": status, "evaluatedAt": last_data,
        })

    # ---- 没配策略：旧记录行为完全不变（硬约束） ----

    def test_without_policy_nothing_is_judged_or_written(self):
        for conf in ({}, {"kind": "ai", "script": "x"},
                     {"overduePolicy": {}}, {"overdue": {"graceMinutes": 30}},
                     {"expectEveryMinutes": 0}, {"expectEveryMinutes": "abc"}):
            self.assertIsNone(overdue.evaluate(self.app, self.monitor, conf, result(0), MOMENT))
            self.assertIsNone(batches.read(self.app, self.key), conf)

    # ---- 首次 0 条：先立基准，不能报警 ----

    def test_first_zero_count_initializes_without_alarm(self):
        self.assertIsNone(overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT))
        state = batches.read(self.app, self.key)
        self.assertEqual(state["lastDataAt"], "2026-11-12 09:00:00")
        self.assertEqual(state["lastStatus"], "normal")
        self.assertEqual(state["evaluatedAt"], "2026-11-12 09:00:00")

    # ---- 超期 / 未超期 ----

    def test_gap_beyond_threshold_is_overdue_with_reason(self):
        self.seed("2026-11-10 08:00:00")
        detail = overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT)
        self.assertTrue(detail["overdue"])
        self.assertEqual(detail["expectEveryMinutes"], 1440)
        self.assertEqual(detail["graceMinutes"], 120)
        self.assertEqual(detail["gapMinutes"], 2940.0)
        self.assertEqual(detail["lastDataAt"], "2026-11-10 08:00:00")
        self.assertIn("超期无新增", detail["reason"])
        self.assertIn("2940", detail["reason"])
        self.assertIn("1440", detail["reason"])
        self.assertIn("120", detail["reason"])
        state = batches.read(self.app, self.key)
        self.assertEqual(state["lastStatus"], "overdue")
        # 0 条不能刷新基准，否则永远等不到超期。
        self.assertEqual(state["lastDataAt"], "2026-11-10 08:00:00")

    def test_within_threshold_is_not_overdue(self):
        self.seed("2026-11-11 10:00:00")  # 1380 分钟 < 1440 + 120
        detail = overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT)
        self.assertFalse(detail["overdue"])
        self.assertNotIn("reason", detail)
        state = batches.read(self.app, self.key)
        self.assertEqual(state["lastStatus"], "normal")
        self.assertEqual(state["lastDataAt"], "2026-11-11 10:00:00")

    def test_exactly_at_threshold_is_not_overdue(self):
        # gap == 阈值不算超过（"超过"是严格大于），边界抖一秒不能误报。
        self.seed("2026-11-11 07:00:00")  # 距 11-12 09:00 恰好 1560 分钟
        detail = overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT)
        self.assertFalse(detail["overdue"])

    # ---- 有新增：刷新游标 ----

    def test_new_data_refreshes_last_data_at(self):
        self.seed("2026-10-01 00:00:00", status="overdue")
        self.assertIsNone(overdue.evaluate(self.app, self.monitor, policy(), result(7), MOMENT))
        state = batches.read(self.app, self.key)
        self.assertEqual(state["lastDataAt"], "2026-11-12 09:00:00")
        self.assertEqual(state["lastStatus"], "normal")

    # ---- 策略三种写法等价 ----

    def test_policy_alias_forms_are_equivalent(self):
        self.seed("2026-11-10 08:00:00")
        for conf in ({"overduePolicy": {"expectEveryMinutes": 1440, "graceMinutes": 120}},
                     {"overdue": {"expectEveryMinutes": 1440, "graceMinutes": 120}},
                     {"expectEveryMinutes": 1440}):
            detail = overdue.evaluate(self.app, self.monitor, conf, result(0), MOMENT, persist=False)
            self.assertIsNotNone(detail, conf)
            self.assertTrue(detail["overdue"], conf)
        # 直接写分钟数时宽限默认 0，阈值更小，同样判超期。
        self.assertEqual(overdue.policy_of({"expectEveryMinutes": "1440"})["graceMinutes"], 0)

    # ---- 无法判定时不猜 ----

    def test_unknown_checked_count_does_not_touch_state(self):
        # 脚本没输出条数（多半是执行失败）：不能当成 0 条判超期。
        self.seed("2026-11-10 08:00:00")
        self.assertIsNone(overdue.evaluate(
            self.app, self.monitor, policy(), {"status": runner.STATUS_ERROR, "report": {}}, MOMENT))
        self.assertEqual(batches.read(self.app, self.key)["lastDataAt"], "2026-11-10 08:00:00")

    def test_unreadable_last_data_at_is_treated_as_missing(self):
        batches.write(self.app, self.key, {"lastDataAt": "不是时间", "lastStatus": "normal"})
        self.assertIsNone(overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT))
        self.assertEqual(batches.read(self.app, self.key)["lastDataAt"], "2026-11-12 09:00:00")

    def test_missing_app_or_monitor_returns_none(self):
        self.assertIsNone(overdue.evaluate(None, self.monitor, policy(), result(0), MOMENT))
        self.assertIsNone(overdue.evaluate(self.app, {}, policy(), result(0), MOMENT))
        self.assertIsNone(overdue.evaluate(self.app, {"id": "oops"}, policy(), result(0), MOMENT))

    # ---- 干跑（persist=False）只算不写 ----

    def test_dry_run_judgement_writes_nothing(self):
        self.seed("2026-11-10 08:00:00")
        before = batches.read(self.app, self.key)
        detail = overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT, persist=False)
        self.assertTrue(detail["overdue"])
        self.assertEqual(batches.read(self.app, self.key), before)

    def test_dry_run_on_first_zero_count_does_not_initialize(self):
        self.assertIsNone(overdue.evaluate(self.app, self.monitor, policy(), result(0), MOMENT, persist=False))
        self.assertIsNone(batches.read(self.app, self.key))


class OverdueRunnerIntegrationTest(unittest.TestCase):
    """接进 ``run_due`` / ``apply_result`` 后的行为：状态位、message、remarks。"""

    def setUp(self):
        self.app = FakeApplication()
        self.key = overdue.state_key(MONITOR_ID)
        self.conf = dict(policy(), kind="ai", script="x",
                         schedule={"next": "2026-11-12 08:00:00"})
        self.row = (MONITOR_ID, "示例", 301, "sense_data.T", json.dumps(self.conf),
                    "0 0 8 * * ?", None, None, 200)
        self._original_execute = runner.execute
        self._original_now = runner.business_now
        # 0 条数据：脚本只能报「正常」，正是假绿的来源。
        runner.execute = lambda script, conf, cfg: result(0)
        # apply_result / compose_message 自己取当前时间，这里固定成 MOMENT，
        # 否则断言依赖测试运行的真实时刻。
        runner.business_now = lambda cfg=None: MOMENT

    def tearDown(self):
        runner.execute = self._original_execute
        runner.business_now = self._original_now

    def seed(self, last_data="2026-11-10 08:00:00"):
        batches.write(self.app, self.key, {
            "lastDataAt": last_data, "lastStatus": "normal", "evaluatedAt": last_data,
        })

    def run_once(self, apply):
        return runner.run_due(
            FakeConn([self.row]), {"python": "x", "timeout": 5, "env": {}},
            apply=apply, now=MOMENT, app=self.app,
        )

    def statements(self, conn):
        return conn.store.get("statements", [])

    def test_dry_run_does_not_write_state_or_change_result(self):
        self.seed()
        before = batches.read(self.app, self.key)
        conn = FakeConn([self.row])
        results = runner.run_due(conn, {"python": "x", "timeout": 5, "env": {}},
                                 apply=False, now=MOMENT, app=self.app)
        item = results[0]
        # 结果保持原样（仍然「正常」），只在输出里带上「会不会判超期」。
        self.assertEqual(item["status"], runner.STATUS_NORMAL)
        self.assertIn("---[OK]:", item["message"])
        self.assertTrue(item["overdue"]["overdue"])
        self.assertEqual(batches.read(self.app, self.key), before)
        writes = [sql for sql, _ in self.statements(conn) if not sql.startswith("SELECT")]
        self.assertEqual(writes, [])

    def test_apply_marks_overdue_as_abnormal_with_message_and_remarks(self):
        self.seed()
        conn = FakeConn([self.row])
        item = runner.run_due(conn, {"python": "x", "timeout": 5, "env": {}},
                              apply=True, now=MOMENT, app=self.app)[0]
        self.assertEqual(item["status"], runner.STATUS_ABNORMAL)
        self.assertEqual(item["abnormalCount"], 1)
        self.assertIn("超期无新增", item["reason"])
        # message 沿用既有格式，只是状态位/异常数变化。
        self.assertIn("---[X]:示例-异常", item["message"])
        self.assertIn("检查数:0 异常数:1", item["message"])

        update = [p for p in self.statements(conn) if p[0].startswith("UPDATE ck_source SET STATE")][0]
        self.assertEqual(update[1][0], "E")
        # message 只沿用既有格式（状态位 + 异常数变化），长原因放 reason/remarks。
        self.assertIn("---[X]:示例-异常, 检查数:0 异常数:1", update[1][1])
        self.assertNotIn("超期无新增", update[1][1])

        insert = [p for p in self.statements(conn) if p[0].startswith("INSERT INTO ck_job_log")][0]
        self.assertEqual(insert[1][4], "E")
        remarks = json.loads(insert[1][9])
        self.assertEqual(remarks["status"], runner.STATUS_ABNORMAL)
        self.assertEqual(remarks["abnormalCount"], 1)
        self.assertTrue(remarks["overdue"]["overdue"])
        self.assertEqual(remarks["overdue"]["lastDataAt"], "2026-11-10 08:00:00")
        self.assertEqual(remarks["overdue"]["gapMinutes"], 2940.0)
        self.assertIn("超期无新增", remarks["reason"])

        state = batches.read(self.app, self.key)
        self.assertEqual(state["lastStatus"], "overdue")
        self.assertEqual(state["lastDataAt"], "2026-11-10 08:00:00")

        # item 在 monitor_events.record 之前就被抬成异常，事件表里应有一条带原因的异常事件。
        events = [batches.read(self.app, k) for k in sorted(self.app.store.settings)
                  if k.startswith("monitor-events:")]
        events = [e for e in events if isinstance(e, dict) and e.get("eventId")]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], runner.STATUS_ABNORMAL)
        self.assertIn("超期无新增", events[0]["reason"])

    def test_apply_within_grace_keeps_normal_result(self):
        self.seed("2026-11-11 10:00:00")
        conn = FakeConn([self.row])
        item = runner.run_due(conn, {"python": "x", "timeout": 5, "env": {}},
                              apply=True, now=MOMENT, app=self.app)[0]
        self.assertEqual(item["status"], runner.STATUS_NORMAL)
        self.assertIn("---[OK]:", item["message"])
        insert = [p for p in self.statements(conn) if p[0].startswith("INSERT INTO ck_job_log")][0]
        self.assertNotIn("overdue", json.loads(insert[1][9]))
        self.assertEqual(batches.read(self.app, self.key)["lastStatus"], "normal")

    def test_execution_error_does_not_judge_or_touch_state(self):
        # 执行失败时即使脚本写了 0 条也不可信：不判超期、不刷新游标。
        self.seed()
        runner.execute = lambda script, conf, cfg: {
            "status": runner.STATUS_ERROR,
            "report": {"checkedCount": 0, "abnormalCount": 0},
            "exitCode": 1,
            "error": "boom",
            "durationMs": 5,
        }
        conn = FakeConn([self.row])
        item = runner.run_due(conn, {"python": "x", "timeout": 5, "env": {}},
                              apply=True, now=MOMENT, app=self.app)[0]
        self.assertEqual(item["status"], runner.STATUS_ERROR)
        self.assertNotIn("overdue", item)
        insert = [p for p in self.statements(conn) if p[0].startswith("INSERT INTO ck_job_log")][0]
        self.assertNotIn("overdue", json.loads(insert[1][9]))
        self.assertEqual(batches.read(self.app, self.key)["lastDataAt"], "2026-11-10 08:00:00")

    def test_apply_without_policy_keeps_legacy_behavior(self):
        conf = {"kind": "ai", "script": "x", "schedule": {"next": "2026-11-12 08:00:00"}}
        row = (MONITOR_ID, "示例", 301, "sense_data.T", json.dumps(conf),
               "0 0 8 * * ?", None, None, 200)
        conn = FakeConn([row])
        item = runner.run_due(conn, {"python": "x", "timeout": 5, "env": {}},
                              apply=True, now=MOMENT, app=self.app)[0]
        self.assertEqual(item["status"], runner.STATUS_NORMAL)
        self.assertNotIn("overdue", item)
        # 老记录不写超期状态、不建异常事件（monitor-events 索引保持空）。
        self.assertIsNone(batches.read(self.app, self.key))


class StructuredRemarksOverdueTest(unittest.TestCase):
    def item(self, window=None):
        return {"runId": "run-1104-20261112090000", "monitorId": MONITOR_ID,
                "durationMs": 5, "window": window}

    def outcome(self, reason="超期无新增"):
        return {"status": runner.STATUS_ABNORMAL,
                "report": {"checkedCount": 0, "abnormalCount": 1, "reason": reason}}

    def overdue(self):
        return {"overdue": True, "expectEveryMinutes": 1440, "graceMinutes": 120,
                "lastDataAt": "2026-11-10 08:00:00", "gapMinutes": 2940.0,
                "reason": "超期无新增：距上次有新增数据已 2940 分钟，超过预期更新周期 1440 分钟（宽限 120 分钟）"}

    def test_overdue_field_is_valid_json_when_it_fits(self):
        text = runner.structured_remarks(self.item(), {"scriptPath": "/code01/x.py"},
                                         self.outcome(), {"remarksMax": 900}, overdue=self.overdue())
        parsed = json.loads(text)
        self.assertTrue(parsed["overdue"]["overdue"])
        self.assertEqual(parsed["overdue"]["lastDataAt"], "2026-11-10 08:00:00")
        self.assertEqual(parsed["overdue"]["gapMinutes"], 2940.0)

    def test_window_is_dropped_before_overdue(self):
        window = {"start": "2026-11-10 00:00:00", "end": "2026-11-12 09:00:00", "note": "x" * 300}
        text = runner.structured_remarks(self.item(window), {"scriptPath": "/code01/x.py"},
                                         self.outcome(), {"remarksMax": 330}, overdue=self.overdue())
        self.assertLessEqual(len(text), 330)
        parsed = json.loads(text)
        self.assertNotIn("window", parsed)
        self.assertIn("overdue", parsed)

    def test_overdue_is_dropped_before_reason_is_truncated(self):
        text = runner.structured_remarks(self.item(), {"scriptPath": "/code01/x.py"},
                                         self.outcome("很长的原因" * 100),
                                         {"remarksMax": 220}, overdue=self.overdue())
        self.assertLessEqual(len(text), 220)
        parsed = json.loads(text)
        self.assertEqual(parsed["runId"], "run-1104-20261112090000")
        self.assertEqual(parsed["checkedCount"], 0)
        self.assertEqual(parsed["abnormalCount"], 1)
        self.assertNotIn("overdue", parsed)

    def test_without_overdue_result_layout_is_unchanged(self):
        text = runner.structured_remarks(self.item(), {"scriptPath": "/code01/x.py"},
                                         self.outcome("ok"), {"remarksMax": 900})
        parsed = json.loads(text)
        self.assertNotIn("overdue", parsed)
        self.assertEqual(parsed["reason"], "ok")


if __name__ == "__main__":
    unittest.main()