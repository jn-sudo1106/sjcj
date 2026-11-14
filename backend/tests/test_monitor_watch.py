import unittest
from unittest.mock import Mock, patch

from backend.tests import test_monitor_batches as batch_tests
from backend.runner_management import monitor_batches as batches
from backend.runner_management import monitor_watch as watch


def config(**overrides):
    value = {'mq': {'url': 'http://mq:19601', 'user': '', 'password': '', 'timeout': 1},
             'db': None, 'smtp': {}, 'notify': {'enabled': False, 'recipient': ''},
             'graceMinutes': 15, 'pollSeconds': 300}
    value.update(overrides)
    return value


def queue(name, messages=0, unacked=0, consumers=1, rate=0.0):
    return {'name': name, 'messages': messages, 'messages_unacknowledged': unacked,
            'consumers': consumers, 'message_stats': {'ack_details': {'rate': rate}}}


class MonitorWatchTest(unittest.TestCase):
    setUp = batch_tests.MonitorBatchesTest.setUp
    tearDown = batch_tests.MonitorBatchesTest.tearDown
    request = batch_tests.MonitorBatchesTest.request
    fixture = batch_tests.MonitorBatchesTest.fixture

    def scan(self, cfg=None, queues=(), defined=(), overdue=None, **kwargs):
        cfg = cfg or config()
        with patch.object(watch, 'fetch_queues', return_value=list(queues)), \
             patch.object(watch, 'read_defined_queues', return_value=list(defined)), \
             patch.object(watch, 'read_overdue', return_value=overdue or {'graceMinutes': 15, 'items': []}):
            return watch.scan(self.app, cfg, **kwargs)

    def test_configured_queue_missing_from_broker_is_a_problem(self):
        snapshot = self.scan(queues=[queue('other')],
                             defined=[{'name': 'q1', 'maxSize': 500, 'minSize': None,
                                       'minRate': None, 'maxRate': None, 'minConsumer': None}])
        self.assertEqual(snapshot['queue']['items'][0]['status'], 'missing')
        self.assertEqual(snapshot['summary']['queueProblems'], 1)
        self.assertFalse(snapshot['summary']['healthy'])

    def test_unobservable_metrics_are_never_healthy(self):
        with patch.object(watch, 'fetch_queues', side_effect=watch.WatchUnavailable('连接被拒绝')), \
             patch.object(watch, 'read_overdue', return_value={'graceMinutes': 15, 'items': []}):
            snapshot = watch.scan(self.app, config())
        self.assertFalse(snapshot['queue']['reachable'])
        self.assertIn('连接被拒绝', snapshot['queue']['error'])
        self.assertFalse(snapshot['summary']['healthy'])

    def test_unavailable_database_keeps_overdue_unknown(self):
        with patch.object(watch, 'fetch_queues', return_value=[]), \
             patch.object(watch, 'read_defined_queues', return_value=[]):
            snapshot = watch.scan(self.app, config(db=None))
        self.assertFalse(snapshot['monitors']['available'])
        self.assertIn('业务数据库', snapshot['monitors']['error'])
        self.assertFalse(snapshot['summary']['healthy'])

    def test_unreadable_queue_definitions_are_unknown_even_when_broker_is_reachable(self):
        with patch.object(watch, 'fetch_queues', return_value=[queue('q1')]), \
             patch.object(watch, 'read_defined_queues', side_effect=watch.WatchUnavailable('权限不足')), \
             patch.object(watch, 'read_overdue', return_value={'graceMinutes': 15, 'items': []}):
            result = watch.scan(self.app, config())
        self.assertTrue(result['queue']['reachable'])
        self.assertEqual(result['summary']['queueUnobservable'], 1)
        self.assertFalse(result['summary']['healthy'])
        self.assertNotEqual(watch.signature_of(result), 'ok')

    def test_failed_notification_retries_same_problem_and_success_clears_error(self):
        cfg = config(notify={'enabled': True, 'recipient': 'ops@example.com'})
        with patch.object(watch, 'fetch_queues', side_effect=watch.WatchUnavailable('连接被拒绝')), \
             patch.object(watch, 'read_overdue', return_value={'graceMinutes': 15, 'items': []}), \
             patch.object(watch, 'send_digest', side_effect=[watch.WatchUnavailable('SMTP 登录失败'), True]) as sender:
            watch.scan(self.app, cfg)
            self.assertIn('SMTP 登录失败', batches.read(self.app, watch.STATE)['lastError'])
            watch.scan(self.app, cfg)
            watch.scan(self.app, cfg)
            self.assertEqual(sender.call_count, 2)
            self.assertEqual(batches.read(self.app, watch.STATE).get('lastError'), '')

    def test_threshold_order_matches_old_platform(self):
        rules = {'name': 'q', 'maxSize': 500, 'minSize': 10, 'minRate': 5,
                 'maxRate': 100, 'minConsumer': 2}
        self.assertEqual(watch.classify(rules, None, {'slowConsumerMessages': 200})[0], 'missing')
        self.assertEqual(watch.classify(rules, queue('q', messages=500), {'slowConsumerMessages': 200})[0], 'backlog')
        self.assertEqual(watch.classify(rules, queue('q', messages=5, consumers=3), {'slowConsumerMessages': 200})[0], 'insufficient')
        self.assertEqual(watch.classify(rules, queue('q', messages=300, consumers=3, rate=1), {'slowConsumerMessages': 200})[0], 'slow_consumer')
        self.assertEqual(watch.classify(rules, queue('q', messages=300, consumers=3, rate=500), {'slowConsumerMessages': 200})[0], 'too_fast')
        self.assertEqual(watch.classify(rules, queue('q', messages=300, consumers=1, rate=9), {'slowConsumerMessages': 200})[0], 'no_consumer')
        self.assertEqual(watch.classify(rules, queue('q', messages=300, consumers=3, rate=9), {'slowConsumerMessages': 200})[0], 'ok')

    def test_overdue_monitor_is_counted(self):
        overdue = {'graceMinutes': 15, 'items': [{'monitorId': '1105', 'sourceId': '301276575',
                                                  'name': '入库检查', 'cron': '0 0 8 * * ?',
                                                  'due': '2026-11-12 08:00:00', 'lastRun': None,
                                                  'lastLog': None}]}
        snapshot = self.scan(queues=[], defined=[], overdue=overdue)
        self.assertEqual(snapshot['summary']['overdueMonitors'], 1)
        self.assertFalse(snapshot['summary']['healthy'])

    def test_routes_read_latest_and_rescan(self):
        self.scan()
        got = self.request('/api/runner-management/monitor-watch')
        self.assertEqual(got['latest']['summary']['healthy'], True)
        with patch.object(watch, 'queue_health', return_value={'reachable': False, 'error': '不可达',
                                                               'items': [], 'summary': {'total': 0, 'problems': 0}}), \
             patch.object(watch, 'read_overdue', return_value={'graceMinutes': 15, 'items': []}):
            posted = self.request('/api/runner-management/monitor-watch/scan', {})
        self.assertFalse(posted['summary']['healthy'])
        self.assertEqual(batches.read(self.app, 'monitor-watch:latest')['summary']['healthy'], False)

    def test_digest_only_when_problem_signature_changes(self):
        cfg = config(notify={'enabled': True, 'recipient': 'ops@example.com'})
        with patch.object(watch, 'fetch_queues', return_value=[queue('q1', messages=600)]), \
             patch.object(watch, 'read_defined_queues', return_value=[{'name': 'q1', 'maxSize': 500,
                                                                       'minSize': None, 'minRate': None,
                                                                       'maxRate': None, 'minConsumer': None}]), \
             patch.object(watch, 'read_overdue', return_value={'graceMinutes': 15, 'items': []}), \
             patch.object(watch, 'send_digest', Mock(return_value=True)) as sender:
            watch.scan(self.app, cfg)
            watch.scan(self.app, cfg)
            self.assertEqual(sender.call_count, 1)
        # 问题消失后再次出现要重新通知一次
        with patch.object(watch, 'fetch_queues', return_value=[]), \
             patch.object(watch, 'read_defined_queues', return_value=[]), \
             patch.object(watch, 'read_overdue', return_value={'graceMinutes': 15, 'items': []}), \
             patch.object(watch, 'send_digest', Mock(return_value=True)) as sender:
            watch.scan(self.app, cfg)
            watch.scan(self.app, cfg)
            self.assertEqual(sender.call_count, 0)

    def test_digest_requires_channel_and_recipient(self):
        with self.assertRaises(watch.WatchUnavailable):
            watch.send_digest(config(), {'at': '2026-11-12T00:00:00+00:00',
                                         'queue': {'reachable': True, 'error': None, 'items': [],
                                                   'summary': {'total': 0, 'problems': 0}},
                                         'monitors': {'available': True, 'graceMinutes': 15, 'items': [], 'count': 0}})


if __name__ == '__main__':
    unittest.main()
