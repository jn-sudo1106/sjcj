import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from backend.tests.test_business_task_logs import BusinessTaskLogsTest
from backend.runner_management import business_task_index as index, runtime_history as history


class BusinessTaskIndexTest(unittest.TestCase):
    setUp = BusinessTaskLogsTest.setUp
    tearDown = BusinessTaskLogsTest.tearDown
    request = BusinessTaskLogsTest.request
    captured = BusinessTaskLogsTest.captured

    def test_historical_backfill_is_idempotent_and_batch_reads_only_indexed_actual_resources(self):
        record, stream, runner = self.captured('192.168.1.173', [
            ['INFO 任务 123 · 配置 1401218 · URL https://example.com'],
            ['INFO 任务 123 完成：2 条', 'ERROR 任务 1234 执行失败']])
        self.captured('192.168.1.201', [['INFO 任务 456 执行失败']], task_topic='other')
        self.assertGreater(index.backfill(self.app)['events'], 0)
        self.assertEqual(index.backfill(self.app)['events'], 0)
        with patch.object(history, 'stream_dir', side_effect=AssertionError('List requests must not scan logs')):
            with patch.object(self.app, 'authenticate_admin', wraps=self.app.authenticate_admin) as auth:
                result = self.request('/api/runner-management/business-task-executions/batch', {
                    'tasks': [{'taskId': '123', 'topic': 'auto_snatch_web_link'}, {'taskId': '456', 'topic': 'auto_snatch_web_link'}, {'taskId': 'missing'}]})
                self.assertFalse(auth.call_args.kwargs['write'])
        self.assertEqual(len(result['items']['123']), 1)
        item = result['items']['123'][0]
        self.assertEqual((item['runnerId'], item['recordId'], item['streamId'], item['machine']), (runner, record, stream, '192.168.1.173'))
        self.assertEqual((item['status'], item['seq']), ('completed', 2))
        self.assertEqual(result['items']['456'], [])
        self.assertEqual(result['items']['missing'], [])

    def test_live_log_ingestion_indexes_tasks_and_backfill_cannot_replace_newer_execution(self):
        record, stream, runner = self.captured('192.168.1.173', [['INFO 任务 123 · 配置 1401218 · URL https://example.com']])
        payload = {'recordId': record, 'streamId': stream, 'seq': 2, 'entries': [{'text': 'ERROR 任务 123 执行失败', 'time': history.stamp()}]}
        self.assertEqual(history.ingest_logs(self.app, runner, payload), {'ack': 2})
        self.assertEqual(history.ingest_logs(self.app, runner, payload), {'ack': 2})
        index.backfill(self.app)
        result = index.listing(self.app, {'tasks': [{'taskId': '123'}]})
        self.assertEqual(len(result['items']['123']), 1)
        self.assertEqual(result['items']['123'][0]['status'], 'failed')
        self.assertEqual(result['items']['123'][0]['seq'], 2)
        history.ingest_logs(self.app, runner, {**payload, 'seq': 3, 'entries': [{'text': 'INFO 任务 123 · 配置 1401218 · URL https://example.com', 'time': history.stamp()}]})
        self.assertEqual(index.listing(self.app, {'tasks': [{'taskId': '123'}]})['items']['123'][0]['status'], 'observed')

    def test_retries_on_different_machines_are_retained_and_identity_uses_execution_snapshot(self):
        record, _, runner = self.captured('192.168.1.201', [['ERROR 任务 123 执行失败']])
        self.captured('192.168.1.173', [['INFO 任务 123 完成：2 条']])
        with self.app.store.connect() as db:
            row=db.execute('SELECT snapshot_json FROM runtime_operations WHERE record_id=?', (record,)).fetchone()
            snapshot=json.loads(row['snapshot_json']); snapshot['runnerName']='执行时的机器名称'
            db.execute('UPDATE runtime_operations SET snapshot_json=? WHERE record_id=?', (json.dumps(snapshot), record))
        index.backfill(self.app)
        result=index.listing(self.app, {'tasks':[{'taskId':'123'}]})['items']['123']
        self.assertEqual({item['machine'] for item in result}, {'192.168.1.201','192.168.1.173'})
        self.assertEqual(next(item['runnerName'] for item in result if item['runnerId']==runner), '执行时的机器名称')
        self.assertEqual(result[0]['status'], 'completed')

    def test_batch_validation_and_task_boundaries(self):
        self.captured('machine', [['INFO 任务 1234 完成：1 条', 'INFO 任务 123evil 完成：1 条']])
        index.backfill(self.app)
        self.assertEqual(index.listing(self.app, {'tasks':[{'taskId':'123'}]})['items']['123'], [])
        from backend.runner_management.server import ApiError
        for payload in ({}, {'tasks':[]}, {'tasks':[{'taskId':'123'}]*201}, {'tasks':[{'taskId':'12 OR 1=1'}]}, {'tasks':[{'taskId':'123','topic':None}]}):
            with self.assertRaises(ApiError): index.listing(self.app, payload)
        with self.assertRaises(HTTPError) as error:
            self.request('/api/runner-management/business-task-executions/batch', {'tasks':[{'taskId':'!'}]})
        self.assertEqual(error.exception.code, 400)
