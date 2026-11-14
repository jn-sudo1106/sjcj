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

    # ---- notifyOn：策略决定建不建事件 -------------------------------------

    def test_notify_on_none_never_creates_event(self):
        for status in ('NORMAL', 'ABNORMAL', 'ERROR'):
            self.assertIsNone(events.record(self.app, self.item(status), {'notifyOn': 'none'}))
        self.assertEqual(events.listing(self.app), [])
        self.assertIsNone(batches.read(self.app, events.INDEX_KEY))

    def test_notify_on_error_is_default_for_missing_and_invalid(self):
        # 缺键、空字符串、非法值按 error：异常建、正常不建。
        confs = ({}, {'kind': 'ai'}, {'notifyOn': ''}, {'notifyOn': 'bogus'}, None)
        for index, conf in enumerate(confs):
            self.assertIsNone(events.record(self.app, self.item(
                'NORMAL', runId='run-1104-2026111211%02d00' % index), conf))
        for index, conf in enumerate([{}, {'notifyOn': ''}, {'notifyOn': 'bogus'}]):
            row = events.record(self.app, self.item(
                'ABNORMAL', runId='run-1104-2026111212%02d00' % index), conf)
            self.assertIsNotNone(row)
            self.assertEqual(row['notifyOn'], 'error')
        self.assertEqual(len(events.listing(self.app)), 3)

    def test_notify_on_legacy_disabled_means_mute(self):
        # 2026-11-13 修复：旧前端把「关闭告警」写成 disabled/off/false，此前被当非法值
        # 归一成 error —— 用户关了告警，异常照旧发邮件。历史值必须等价于 none。
        for index, legacy in enumerate(('disabled', 'off', 'false', 'Disabled', ' OFF ', 'Off')):
            conf = {'notifyOn': legacy}
            self.assertEqual(events.notify_policy(conf), 'none')
            self.assertIsNone(events.record(self.app, self.item(
                'ABNORMAL', runId='run-1104-2026111300%02d00' % index), conf))
        self.assertEqual(events.listing(self.app), [])

    def test_notify_on_ok_only_records_normal(self):
        self.assertIsNone(events.record(self.app, self.item('ABNORMAL'), {'notifyOn': 'ok'}))
        row = events.record(self.app, self.item('NORMAL'), {'notifyOn': 'ok'})
        self.assertIsNotNone(row)
        self.assertEqual(row['status'], 'NORMAL')
        self.assertEqual(row['notifyOn'], 'ok')
        self.assertEqual(row['delivery']['state'], 'pending')
        self.assertEqual([item['status'] for item in events.listing(self.app)], ['NORMAL'])

    def test_notify_on_all_records_every_status_once_per_run(self):
        normal = events.record(self.app, self.item('NORMAL'), {'notifyOn': 'all'})
        abnormal = events.record(self.app, self.item('ABNORMAL', runId='run-1104-20261112210500'),
                                 {'notifyOn': 'all'})
        failed = events.record(self.app, self.item('ERROR', runId='run-1104-20261112211000',
                                                   error='脚本超时'), {'notifyOn': 'all'})
        self.assertEqual([row['status'] for row in events.listing(self.app)],
                         ['ERROR', 'ABNORMAL', 'NORMAL'])
        self.assertEqual(failed['reason'], '脚本超时')
        for row in (normal, abnormal, failed):
            self.assertEqual(row['notifyOn'], 'all')
        # 同一 runId 重复 record 仍只有一条。
        again = events.record(self.app, self.item('NORMAL'), {'notifyOn': 'all'})
        self.assertEqual(again['eventId'], normal['eventId'])
        self.assertEqual(len(events.listing(self.app)), 3)
        self.assertEqual(len(batches.read(self.app, events.INDEX_KEY)), 3)

    def test_notify_on_accepts_json_string_and_whitespace(self):
        self.assertIsNone(events.record(self.app, self.item(), json.dumps({'notifyOn': 'none'})))
        row = events.record(self.app, self.item('NORMAL', runId='run-1104-20261112130000'),
                            '{"notifyOn": " OK "}')
        self.assertEqual(row['notifyOn'], 'ok')
        # 解析不了的 conf 按空配置处理 → 默认 error 口径。
        self.assertIsNone(events.record(self.app, self.item(
            'NORMAL', runId='run-1104-20261112131000'), 'not-json'))
        self.assertIsNotNone(events.record(self.app, self.item(
            'ABNORMAL', runId='run-1104-20261112132000'), 'not-json'))

    # ---- 收件人：检查项优先，回落到全局 -----------------------------------

    def test_conf_receivers_and_mail_to_are_merged(self):
        self.configure(recipient='global@example.com')
        conf = {'receivers': ['a@example.com', 'b@example.com'], 'mailTo': 'c@example.com'}
        event = events.record(self.app, self.item(), conf)
        self.assertEqual(event['recipients'],
                         ['a@example.com', 'b@example.com', 'c@example.com'])
        with patch.object(events.delivery, 'send') as sender:
            result = events.deliver(self.app, event['eventId'])
        self.assertEqual(result['delivery']['state'], 'sent')
        self.assertEqual([row['recipient'] for row in result['deliveries']],
                         ['a@example.com', 'b@example.com', 'c@example.com'])
        self.assertTrue(all(row['state'] == 'sent' and row['channel'] == 'email'
                            for row in result['deliveries']))
        self.assertEqual(sender.call_count, 3)
        # 检查项自带收件人时不再叠加全局收件人。
        sent = [call.args[1]['recipient'] for call in sender.call_args_list]
        self.assertNotIn('global@example.com', sent)

    def test_dirty_receivers_are_split_deduped_and_filtered(self):
        conf = {'receivers': 'a@example.com, b@example.com; a@example.com\nnot-an-email'}
        event = events.record(self.app, self.item(), conf)
        self.assertEqual(event['recipients'], ['a@example.com', 'b@example.com'])

    def test_recipients_fall_back_to_global_config(self):
        self.configure(recipient='ops@example.com')
        event = events.record(self.app, self.item(), {'notifyOn': 'error'})
        self.assertEqual(event['recipients'], [])
        with patch.object(events.delivery, 'send') as sender:
            result = events.deliver(self.app, event['eventId'])
        self.assertEqual(result['deliveries'][0]['recipient'], 'ops@example.com')
        sender.assert_called_once()

    def test_conf_recipients_deliver_even_if_global_recipient_missing(self):
        self.configure(recipient='')
        event = events.record(self.app, self.item(), {'receivers': ['team@example.com']})
        with patch.object(events.delivery, 'send') as sender:
            result = events.deliver(self.app, event['eventId'])
        self.assertEqual(result['delivery']['state'], 'sent')
        self.assertEqual(result['deliveries'][0]['recipient'], 'team@example.com')
        sender.assert_called_once()

    def test_one_failed_recipient_does_not_block_others_and_retry_only_resends_it(self):
        self.configure()
        conf = {'receivers': ['bad@example.com', 'good@example.com']}
        event = events.record(self.app, self.item(), conf)
        base = events.now()

        def flaky(config, row, recipient=None):
            if recipient == 'bad@example.com':
                raise OSError('mailbox full')

        with patch.object(events, 'send_email', side_effect=flaky) as sender:
            first = events.deliver(self.app, event['eventId'], moment=base)
        self.assertEqual(first['delivery']['state'], 'failed')
        self.assertEqual([(row['recipient'], row['state']) for row in first['deliveries']],
                         [('bad@example.com', 'failed'), ('good@example.com', 'sent')])
        self.assertIn('mailbox full', first['deliveries'][0]['error'])
        self.assertIn('good@example.com', [row['recipient'] for row in first['deliveries']
                                           if row['state'] == 'sent'])
        self.assertEqual(sender.call_count, 2)
        with patch.object(events, 'send_email') as sender:
            second = events.deliver(self.app, event['eventId'],
                                    moment=base + timedelta(seconds=events.RETRY_SECONDS + 1))
            sender.assert_called_once()
            # 只补发失败的那个，已成功的 good@ 不再重复收信。
            self.assertEqual(sender.call_args.args[2], 'bad@example.com')
        self.assertEqual(second['delivery']['state'], 'sent')
        self.assertEqual(len(second['deliveries']), 3)
        self.assertEqual([row['recipient'] for row in second['deliveries']
                          if row['state'] == 'sent'].count('good@example.com'), 1)

    # ---- 渠道：显式不开 mail 时不投递，也不伪装成已发送 -------------------

    def test_channels_without_mail_creates_event_without_delivery(self):
        self.configure()
        event = events.record(self.app, self.item(), {'channels': ['dingtalk']})
        self.assertEqual(event['channels'], ['dingtalk'])
        self.assertEqual(event['delivery']['state'], 'not-configured')
        self.assertEqual(event['delivery']['reason'], events.CHANNEL_DISABLED_REASON)
        self.assertEqual(event['deliveries'], [])
        with patch.object(events, 'send_email') as sender:
            result = events.deliver(self.app, event['eventId'])
            events.tick(self.app)
        sender.assert_not_called()
        self.assertEqual(result['delivery']['state'], 'not-configured')
        self.assertEqual(result['delivery']['reason'], events.CHANNEL_DISABLED_REASON)
        self.assertEqual(result['deliveries'], [])

    def test_channels_empty_or_non_mail_string_blocks_mail(self):
        for index, channels in enumerate(([], 'ding', 'dingtalk', 'dingtalk,webhook', [''])):
            row = events.record(self.app, self.item(
                runId='run-1104-2026111214%02d00' % index), {'channels': channels})
            self.assertEqual(row['delivery']['state'], 'not-configured', channels)
            self.assertEqual(row['delivery']['reason'], events.CHANNEL_DISABLED_REASON)

    def test_channels_with_mail_delivers(self):
        self.configure()
        for index, channels in enumerate((['mail'], ['email'], 'mail,dingtalk',
                                          [{'type': 'email'}])):
            event = events.record(self.app, self.item(
                runId='run-1104-2026111215%02d00' % index), {'channels': channels})
            self.assertEqual(event['delivery']['state'], 'pending', channels)
            with patch.object(events.delivery, 'send') as sender:
                self.assertEqual(events.deliver(self.app, event['eventId'])['delivery']['state'],
                                 'sent')
                sender.assert_called_once()

    def test_channels_absent_keeps_legacy_notify_type_behaviour(self):
        self.configure()
        mail = events.record(self.app, self.item(), {'notifyType': 'mail'})
        self.assertEqual(mail['channels'], ['mail'])
        self.assertEqual(mail['delivery']['state'], 'pending')
        ding = events.record(self.app, self.item(runId='run-1104-20261112210500'),
                             {'notifyType': 'ding'})
        self.assertEqual(ding['channels'], ['dingtalk'])
        self.assertEqual(ding['delivery']['state'], 'not-configured')
        legacy = events.record(self.app, self.item(runId='run-1104-20261112211000'), {})
        self.assertIsNone(legacy['channels'])
        self.assertEqual(legacy['delivery']['state'], 'pending')

    def test_channels_blocked_retry_is_http_200_and_stays_not_configured(self):
        self.configure()
        event = events.record(self.app, self.item(), {'channels': ['dingtalk']})
        with patch.object(events, 'send_email') as sender:
            result = self.request('/api/runner-management/monitor-runner/notifications/%s/retry'
                                  % event['eventId'], {})
        sender.assert_not_called()
        self.assertEqual(result['event']['delivery']['state'], 'not-configured')
        self.assertEqual(result['event']['delivery']['reason'], events.CHANNEL_DISABLED_REASON)
        listing = self.request('/api/runner-management/monitor-runner/notifications?monitorId=1104')
        row = listing['items'][0]
        self.assertEqual(row['notifyOn'], 'error')
        self.assertEqual(row['channels'], ['dingtalk'])
        self.assertEqual(row['recipients'], [])

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