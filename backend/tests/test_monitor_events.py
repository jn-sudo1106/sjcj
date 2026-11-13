import datetime as dt
import json
import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.tests import test_monitor_batches as batch_tests
from backend.tests.test_monitor_runner import FakeConn
from backend.runner_management import monitor_batches as batches
from backend.runner_management import monitor_events as events
from backend.runner_management import monitor_runner as runner


class MonitorEventsTest(unittest.TestCase):
    setUp = batch_tests.MonitorBatchesTest.setUp
    tearDown = batch_tests.MonitorBatchesTest.tearDown
    request = batch_tests.MonitorBatchesTest.request

    def item(self, status='ABNORMAL', **changes):
        value = {
            'runId': 'run-1104-20261112204836',
            'monitorId': 1104,
            'sourceId': 301,
            'name': '示例检查',
            'tableName': 'sense_data.T',
            'status': status,
            'checkedCount': 120,
            'abnormalCount': 3,
            'reason': '3 行超出阈值',
            'window': {'start': '2026-11-12 00:00:00', 'end': '2026-11-12 08:00:00'},
            'error': None,
        }
        value.update(changes)
        return value

    def configure(self, enabled=True, recipient='ops@example.com', smtp=True):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        config = {'notify': {'enabled': enabled, 'recipient': recipient}}
        if smtp:
            config['smtp'] = {'host': 'smtp.example.com', 'port': 465, 'user': 'monitor',
                              'password': 'test-only', 'from': 'monitor@example.com', 'tls': 'ssl'}
        path = Path(folder.name) / 'delivery.json'
        path.write_text(json.dumps(config), encoding='utf-8')
        patcher = patch.dict(os.environ, {'RUNNER_MONITOR_DELIVERY_CONFIG': str(path)})
        patcher.start()
        self.addCleanup(patcher.stop)
        return path

    def test_normal_result_creates_no_event(self):
        self.assertIsNone(events.record(self.app, self.item('NORMAL')))
        self.assertEqual(events.listing(self.app), [])

    def test_abnormal_and_failed_results_create_events_newest_first(self):
        abnormal = events.record(self.app, self.item('ABNORMAL'))
        failed = events.record(self.app, self.item('ERROR', runId='run-1105-20261112205500',
                                                   monitorId=1105, error='脚本超时'))
        self.assertEqual(abnormal['status'], 'ABNORMAL')
        self.assertEqual(failed['reason'], '脚本超时')
        rows = events.listing(self.app)
        self.assertEqual([row['eventId'] for row in rows], [failed['eventId'], abnormal['eventId']])
        self.assertEqual(rows[0]['deliveries'], [])
        self.assertEqual(rows[0]['createdAt'][:4], '2026')

    def test_apply_result_wires_abnormal_runs_into_events(self):
        conf = {'kind': 'ai', 'script': 'x'}
        conn = FakeConn([(1104, '示例', 301, 'sense_data.T', json.dumps(conf),
                          '0 0 8 * * ?', None, None, 200)])
        original = runner.execute
        runner.execute = lambda *args: {
            'status': runner.STATUS_ABNORMAL, 'report': {'checkedCount': 20, 'abnormalCount': 2},
            'exitCode': 0, 'error': None, 'durationMs': 5,
        }
        try:
            rows = runner.run_due(conn, {'python': 'x', 'timeout': 5, 'env': {}}, apply=True,
                                  force=True, now=dt.datetime(2026, 11, 12, 9, 0, 0), app=self.app)
        finally:
            runner.execute = original
        self.assertTrue(rows[0]['applied'])
        stored = events.listing(self.app)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]['eventId'], 'evt-1104-20261112090000')
        self.assertEqual(stored[0]['abnormalCount'], 2)

    def test_same_run_is_idempotent(self):
        first = events.record(self.app, self.item())
        second = events.record(self.app, self.item())
        self.assertEqual(first['eventId'], 'evt-1104-20261112204836')
        self.assertEqual(second['eventId'], first['eventId'])
        self.assertEqual(len(events.listing(self.app)), 1)
        self.assertEqual(batches.read(self.app, events.INDEX_KEY), [first['eventId']])

    def test_unconfigured_smtp_is_reported_not_sent(self):
        self.configure(enabled=False)
        event = events.record(self.app, self.item())
        result = events.deliver(self.app, event['eventId'])
        self.assertEqual(result['delivery']['state'], 'not-configured')
        self.assertIn('notify.enabled', result['delivery']['reason'])
        self.assertEqual(result['deliveries'], [])
        self.assertNotEqual(result['delivery']['state'], 'sent')

    def test_missing_delivery_config_is_not_sent(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patcher = patch.dict(os.environ, {'RUNNER_MONITOR_DELIVERY_CONFIG': str(Path(folder.name) / 'missing.json')})
        patcher.start()
        self.addCleanup(patcher.stop)
        event = events.record(self.app, self.item())
        result = events.deliver(self.app, event['eventId'])
        self.assertEqual(result['delivery']['state'], 'not-configured')
        self.assertTrue(result['delivery']['reason'])
        self.assertEqual(result['deliveries'], [])

    def test_failure_retries_with_limit_and_interval(self):
        self.configure()
        event = events.record(self.app, self.item())
        base = events.now()
        with patch.object(events, 'send_email', side_effect=OSError('smtp down')) as sender:
            first = events.deliver(self.app, event['eventId'], moment=base)
            self.assertEqual(first['delivery']['state'], 'failed')
            self.assertEqual(first['delivery']['attempts'], 1)
            self.assertEqual(first['deliveries'][0]['attempt'], 1)
            self.assertEqual(first['deliveries'][0]['state'], 'failed')
            self.assertIn('smtp down', first['deliveries'][0]['error'])
            self.assertEqual(first['delivery']['nextAttemptAt'],
                             events.stamp(base + timedelta(seconds=events.RETRY_SECONDS)))
            # 未到最小间隔：不重试，attempt 不涨。
            second = events.deliver(self.app, event['eventId'], moment=base + timedelta(seconds=30))
            self.assertEqual(second['delivery']['attempts'], 1)
            self.assertEqual(sender.call_count, 1)
            third = events.deliver(self.app, event['eventId'], moment=base + timedelta(seconds=61))
            self.assertEqual(third['delivery']['attempts'], 2)
            fourth = events.deliver(self.app, event['eventId'], moment=base + timedelta(seconds=122))
            self.assertEqual(fourth['delivery']['attempts'], 3)
            self.assertEqual(len(fourth['deliveries']), 3)
            fifth = events.deliver(self.app, event['eventId'], moment=base + timedelta(seconds=300))
            self.assertEqual(fifth['delivery']['attempts'], 3)
            self.assertEqual(len(fifth['deliveries']), 3)
            self.assertEqual(sender.call_count, 3)
        with patch.object(events, 'send_email') as sender:
            events.tick(self.app)
            sender.assert_not_called()

    def test_success_records_sent_receipt_once(self):
        self.configure()
        event = events.record(self.app, self.item())
        with patch.object(events.delivery, 'send') as sender:
            sent = events.deliver(self.app, event['eventId'], moment=events.now())
            self.assertEqual(sent['delivery']['state'], 'sent')
            self.assertEqual(sent['deliveries'][0]['state'], 'sent')
            self.assertEqual(sent['deliveries'][0]['channel'], 'email')
            self.assertEqual(sent['deliveries'][0]['recipient'], 'ops@example.com')
            sender.assert_called_once()
            events.deliver(self.app, event['eventId'], moment=events.now())
            sender.assert_called_once()
        subject = sender.call_args.args[1]['subject']
        body = sender.call_args.args[1]['body']
        self.assertIn('示例检查', subject)
        for text in ('源 ID：301', '数据表：sense_data.T', '检查条数：120', '异常条数：3',
                     'runId：run-1104-20261112204836'):
            self.assertIn(text, body)
        self.assertNotIn('<html', body)

    def test_index_cap_and_order(self):
        with patch.object(events, 'MAX_EVENTS', 3):
            ids = []
            for hour in range(5):
                row = events.record(self.app, self.item(
                    runId='run-%s-20261112%02d0000' % (1200 + hour, hour)))
                ids.append(row['eventId'])
            rows = events.listing(self.app)
            self.assertEqual([row['eventId'] for row in rows], list(reversed(ids))[:3])
            self.assertEqual(batches.read(self.app, events.INDEX_KEY), list(reversed(ids))[:3])
            self.assertIsNone(batches.read(self.app, events.PREFIX + ids[0]))
            self.assertIsNone(batches.read(self.app, events.PREFIX + ids[1]))
            self.assertIsNotNone(batches.read(self.app, events.PREFIX + ids[4]))

    def test_http_listing_and_retry(self):
        self.configure()
        first = events.record(self.app, self.item())
        second = events.record(self.app, self.item(runId='run-1104-20261112210500'))
        listing = self.request('/api/runner-management/monitor-runner/notifications?monitorId=1104&limit=1')
        self.assertEqual(listing['count'], 1)
        self.assertEqual(listing['items'][0]['eventId'], second['eventId'])
        matching = self.request('/api/runner-management/monitor-runner/notifications?runId=' + first['runId'])
        self.assertEqual([row['eventId'] for row in matching['items']], [first['eventId']])
        with patch.object(events, 'send_email') as sender:
            result = self.request('/api/runner-management/monitor-runner/notifications/%s/retry'
                                  % first['eventId'], {})
            self.assertEqual(result['event']['delivery']['state'], 'sent')
            sender.assert_called_once()
        with self.assertRaises(HTTPError) as missing:
            self.request('/api/runner-management/monitor-runner/notifications/evt-9999-20990101000000/retry', {})
        self.assertEqual(missing.exception.code, 404)
        with self.assertRaises(HTTPError) as malformed:
            self.request('/api/runner-management/monitor-runner/notifications/not-an-event/retry', {})
        self.assertEqual(malformed.exception.code, 404)


if __name__ == '__main__':
    unittest.main()