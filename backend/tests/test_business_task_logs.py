import json
import unittest
import uuid
from unittest.mock import patch
from backend.tests import test_runner_management as fixtures
from backend.runner_management import runtime_history as history


class BusinessTaskLogsTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request

    def captured(self, ip, messages, task_topic='auto_snatch_web_link'):
        record, stream, runner = (uuid.uuid4().hex for _ in range(3))
        with self.app.store.connect() as db:
            history.insert_record(db, record, {'runnerId': runner}, 'run', {
                'ipAddress': ip, 'queue': task_topic, 'configId': '1401218', 'installDirectory': 'D:/Runner2'}, status='exited')
            db.execute('INSERT INTO program_runs VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (record, 0, 123, 'newslink.py', 'D:/Runner2', 'python', history.stamp(), None, None, ''))
            from backend.runner_management import log_records
            log_records.insert(db,log_records.migrated_row('stream',{'stream_id':stream,'record_id':record,
                'runner_id':runner,'last_seq':len(messages),'byte_count':1000,'updated_at':history.stamp()}))
        directory = history.stream_dir(self.app, stream)
        for seq, lines in enumerate(messages, 1):
            (directory / f'{seq:012}.json').write_text(json.dumps({'seq': seq, 'entries': [
                {'text': text, 'time': history.stamp(), 'source': 'console'} for text in lines]}), encoding='utf8')
        return record, stream, runner

    def test_exact_task_finds_actual_machines_and_opens_start_not_latest_tail(self):
        first, stream, _ = self.captured('192.168.1.201', [
            ['2026-11-13 INFO 任务 123 · 配置 1401218 · URL https://example.com'],
            ['child output', '2026-11-13 INFO 任务 123 完成：2 条'],
            ['2026-11-13 ERROR 任务 1234 执行失败']])
        second, _, _ = self.captured('192.168.1.172', [
            ['2026-11-13 INFO 任务 123 · 配置 1401218 · URL https://example.com',
             '2026-11-13 ERROR 任务 123 执行失败']])
        self.captured('wrong-machine', [['2026-11-13 INFO 任务 1234 完成：1 条']])
        result = self.request('/api/runner-management/business-task-executions?taskId=123&topic=auto_snatch_web_link')
        self.assertEqual({item['machine'] for item in result['items']}, {'192.168.1.201', '192.168.1.172'})
        self.assertEqual({item['recordId'] for item in result['items']}, {first, second})
        found = next(item for item in result['items'] if item['recordId'] == first)
        self.assertEqual((found['status'], found['seq']), ('completed', 1))
        exact = self.request('/api/runner-management/runtime-operations?since=&recordId=' + first)
        self.assertEqual([row['recordId'] for row in exact['items']], [first])
        output = self.request('/api/runner-management/log-streams/' + stream + '/entries?fromSeq=1')
        self.assertEqual(output['entries'][0]['seq'], 1)
        self.assertIn('child output', [line['text'] for line in output['entries']])
        self.assertEqual(self.request('/api/runner-management/business-task-executions?taskId=absent')['items'], [])

    def test_earlier_seq_one_can_be_selected_even_with_more_than_eight_batches(self):
        _, stream, _ = self.captured('machine', [[f'line {n}'] for n in range(15)])
        tail = self.request('/api/runner-management/log-streams/' + stream + '/entries')
        start = self.request('/api/runner-management/log-streams/' + stream + '/entries?fromSeq=1')
        self.assertEqual((tail['firstCursor'], start['firstCursor']), (8, 1))

    def test_topic_and_budget_do_not_invent_execution(self):
        self.captured('machine', [['INFO 任务 123 完成：1 条']])
        result = self.request('/api/runner-management/business-task-executions?taskId=123&topic=other')
        self.assertEqual(result['items'], [])
        with patch('backend.runner_management.business_task_logs.MAX_BYTES', 1):
            limited = self.request('/api/runner-management/business-task-executions?taskId=123')
        self.assertTrue(limited['truncated']); self.assertEqual(limited['items'], [])
