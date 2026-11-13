import json
import smtplib
import unittest
from unittest.mock import Mock, patch

from backend.tests import test_monitor_batches as batch_tests
from backend.runner_management import monitor_batches as batches
from backend.runner_management import monitor_delivery as delivery


class MonitorDeliveryTest(unittest.TestCase):
    setUp = batch_tests.MonitorBatchesTest.setUp
    tearDown = batch_tests.MonitorBatchesTest.tearDown
    request = batch_tests.MonitorBatchesTest.request
    fixture = batch_tests.MonitorBatchesTest.fixture
    create = batch_tests.MonitorBatchesTest.create
    settle = batch_tests.MonitorBatchesTest.settle
    action = batch_tests.MonitorBatchesTest.action

    def subscription(self):
        self.fixture()
        batch_id = self.create()
        self.settle(batch_id)
        item = self.action(batch_id, 'apply')['items'][0]
        stored = batches.read(self.app, batches.item_key(batch_id, '100'))
        self.config = patch.object(delivery, 'configuration', return_value={'smtp': {}, 'db': {}})
        self.config.start()
        self.addCleanup(self.config.stop)
        self.request('/api/runner-management/monitor-batches/' + batch_id,
                     {'action': 'delivery', 'recipient': 'jiangnan@wanvs.com', 'enabled': True})
        self.row = {'id': item['monitorId'], 'sourceId': 100, 'name': '测试源', 'disabled': 0,
                    'due': 2000, 'now': 1000,
                    'conf': json.dumps({'batchCreateKey': stored['createKey'], 'notifyOn': 'none'})}
        self.log = {'id': 999, 'state': 'E', 'message': '数量:0', 'at': '2026-11-12 12:00:00'}
        self.snap = patch.object(delivery, 'snapshots', side_effect=lambda config, ids: {key: (self.row, self.log) for key in ids})
        self.snap.start()
        self.addCleanup(self.snap.stop)
        return batch_id

    def test_abnormal_receipt_dedup_and_recovery(self):
        batch_id = self.subscription()
        with patch.object(delivery, 'send') as sender:
            delivery.tick(self.app)
            delivery.tick(self.app)
            self.log = {**self.log, 'id': 1000}  # Repeated abnormal run stays one notification.
            delivery.tick(self.app)
            self.assertEqual(sender.call_count, 1)
            self.log = {**self.log, 'id': 1001, 'state': 'C', 'message': '数量:2'}
            delivery.tick(self.app)
            self.assertEqual(sender.call_count, 2)
            self.assertIn('监控恢复', sender.call_args.args[1]['subject'])
        status = self.request('/api/runner-management/monitor-batches/' + batch_id)['delivery']
        self.assertEqual(len(status['receipts']), 2)
        self.assertTrue(all(row['status'] == 'accepted' for row in status['receipts']))

    def test_overdue_without_log_and_disabled_subscription(self):
        batch_id = self.subscription()
        self.row['now'] = self.row['due'] + 901
        self.log = None
        with patch.object(delivery, 'send') as sender:
            delivery.tick(self.app)
            self.assertIn('检查超期未运行', sender.call_args.args[1]['subject'])
            self.request('/api/runner-management/monitor-batches/' + batch_id, {'action': 'delivery', 'enabled': False})
            delivery.tick(self.app)
            self.assertEqual(sender.call_count, 1)

    def test_timeout_is_uncertain_until_explicit_retry(self):
        batch_id = self.subscription()
        with patch.object(delivery, 'send', side_effect=TimeoutError) as sender:
            delivery.tick(self.app)
            delivery.tick(self.app)
            self.assertEqual(sender.call_count, 1)
        status = self.request('/api/runner-management/monitor-batches/' + batch_id)['delivery']
        self.assertEqual(status['receipts'][0]['status'], 'uncertain')
        self.request('/api/runner-management/monitor-batches/' + batch_id, {'action': 'retry_delivery'})
        with patch.object(delivery, 'send') as sender:
            delivery.tick(self.app)
            sender.assert_called_once()
        self.assertEqual(self.request('/api/runner-management/monitor-batches/' + batch_id)['delivery']['receipts'][0]['status'], 'accepted')

    def test_changed_check_configuration_is_not_silently_subscribed(self):
        batch_id = self.subscription()
        self.row['conf'] = json.dumps({'batchCreateKey': 'another-batch', 'notifyOn': 'none'})
        with patch.object(delivery, 'send') as sender:
            delivery.tick(self.app)
            sender.assert_not_called()
        self.assertTrue(self.request('/api/runner-management/monitor-batches/' + batch_id)['delivery']['error'])

    def test_smtp_uses_exact_recipient_no_cc_and_quit_failure_preserves_accept(self):
        client = Mock()
        client.send_message.return_value = {}
        client.quit.side_effect = OSError('connection closed after accepted DATA')
        config = {'smtp': {'tls': 'ssl', 'host': 'smtp.test', 'port': 465, 'from': 'monitor@example.com',
                           'user': 'monitor', 'password': 'test-only'}}
        event = {'recipient': 'jiangnan@wanvs.com', 'subject': '测试', 'body': '监控测试', 'messageId': '<test@monitor.local>'}
        with patch.object(delivery.smtplib, 'SMTP_SSL', return_value=client): delivery.send(config, event)
        message = client.send_message.call_args.args[0]
        self.assertEqual(message['To'], 'jiangnan@wanvs.com')
        self.assertIsNone(message['Cc'])
        self.assertEqual(client.send_message.call_args.kwargs['to_addrs'], ['jiangnan@wanvs.com'])

    def test_smtp_auth_error_keeps_server_code(self):
        batch_id = self.subscription()
        error = smtplib.SMTPAuthenticationError(550, b'User has no permission')
        with patch.object(delivery, 'send', side_effect=error):
            delivery.tick(self.app)
        receipt = self.request('/api/runner-management/monitor-batches/' + batch_id)['delivery']['receipts'][0]
        self.assertEqual(receipt['status'], 'failed')
        self.assertIn('550', receipt['message'])
        self.assertIn('User has no permission', receipt['message'])

    def test_smtp_refusal_is_failed_not_accepted(self):
        batch_id = self.subscription()
        with patch.object(delivery, 'send', side_effect=smtplib.SMTPRecipientsRefused({'test': (550, b'no')})):
            delivery.tick(self.app)
        self.assertEqual(self.request('/api/runner-management/monitor-batches/' + batch_id)['delivery']['receipts'][0]['status'], 'failed')
