import unittest
from unittest.mock import patch

from backend.tests import test_generated_archives as archive_tests
from backend.runner_management import generation_tasks as jobs
from backend.runner_management.server import ApiError


class GenerationTasksTest(unittest.TestCase):
    setUp = archive_tests.GeneratedArchivesTest.setUp
    tearDown = archive_tests.GeneratedArchivesTest.tearDown
    request = archive_tests.GeneratedArchivesTest.request
    start_remote = archive_tests.GeneratedArchivesTest.start_remote
    fixture = archive_tests.GeneratedArchivesTest.fixture

    def configured(self):
        _, repo, origin, payload, calls = self.fixture()
        generation = {key: payload[key] for key in ('interfaceId', 'repositoryId', 'directoryId', 'configType', 'queueName', 'url')}
        generation.update(systemPrompt='编写可靠的代码', userPrompt='采集 {{sourceUrl}} 源 {{sourceId}}', fileNameMode='website')
        jobs.save_config(self.app, {'configId': '102', 'generation': generation})
        source = {'sourceId': '123', 'name': '测试源', 'url': 'https://example.net/news', 'flowId': '55', 'nodes': [
            {'configId': '101', 'name': '首节点', 'isRoot': True},
            {'configId': '102', 'name': '下载', 'enabled': True},
            {'configId': '103', 'name': '未配 AI'},
            {'configId': '102', 'name': '同配置重复引用'},
        ]}
        return source, origin, calls

    def test_gate_partial_merge_and_duplicate_tasks(self):
        source, _, _ = self.configured()
        with patch.object(jobs, 'ensure_worker'):
            result = self.request('/api/runner-management/source-code-tasks', {'sources': [source]})
            self.assertEqual(result['created'], [])
            self.assertIn('未启用', result['skipped'][0]['reason'])
            self.request('/api/runner-management/site-scripts/task-config', {'configId': '101', 'enabled': True})
            self.assertTrue(self.request('/api/runner-management/site-scripts/task-config?configId=101')['enabled'])
            result = self.request('/api/runner-management/source-code-tasks', {'sources': [source]})
            self.assertEqual(len(result['created']), 1)
            self.assertEqual(result['created'][0]['configId'], '102')
            self.assertNotIn('input', result['created'][0])
            repeated = jobs.submit(self.app, {'sources': [source]})
            self.assertFalse(repeated['created'])
        jobs.save_config(self.app, {'configId': '102', 'enabled': True})
        self.assertIsNotNone(jobs.read_config(self.app, '102')['generation'])
        self.assertTrue(jobs.read_config(self.app, '102')['enabled'])

    def test_background_generation_archives_and_binds_source_variables(self):
        source, origin, calls = self.configured()
        jobs.save_config(self.app, {'configId': '101', 'enabled': True})
        with patch.object(jobs, 'ensure_worker'):
            jobs.submit(self.app, {'sources': [source]})
        record = jobs.records(self.app)[0]
        self.assertEqual(record['input']['url'], source['url'])
        self.assertIn(source['url'], record['input']['userPrompt'])
        self.assertIn('123', record['input']['userPrompt'])
        jobs.run_one(self.app, record)
        result = jobs.listing(self.app)[0]
        self.assertEqual(result['status'], 'succeeded', result['message'])
        self.assertTrue(result['gitCommit'])
        self.assertTrue(result['archiveId'])
        self.assertEqual(len(calls), 1)
        self.assertNotIn(record['taskId'], calls[0]['code_dir'])
        from pathlib import Path
        import json
        receipt = Path(calls[0]['prj_dir']) / 'tasks' / (record['taskId'] + '.json')
        self.assertEqual(json.loads(receipt.read_text('utf8'))['gitCommit'], result['gitCommit'])
        self.assertEqual(self.app.git(origin, 'show', 'main:default/newslink.py').strip(), 'VALUE = 1')

    def test_restart_marks_interrupted_without_repeating_model_calls(self):
        source, _, calls = self.configured()
        jobs.save_config(self.app, {'configId': '101', 'enabled': True})
        with patch.object(jobs, 'ensure_worker'):
            jobs.submit(self.app, {'sources': [source]})
            record = jobs.records(self.app)[0]
            record['status'] = 'running'; jobs.put(self.app, record)
            jobs.recover(self.app)
        self.assertEqual(jobs.listing(self.app)[0]['status'], 'failed')
        self.assertEqual(calls, [])

    def test_invalid_batch_does_not_leave_partial_tasks(self):
        source, _, _ = self.configured()
        jobs.save_config(self.app, {'configId': '101', 'enabled': True})
        with self.assertRaises(ApiError):
            jobs.submit(self.app, {'sources': [source, {'sourceId': 'invalid'}]})
        self.assertFalse(jobs.records(self.app))

    def test_worker_records_failure_and_continues_following_task(self):
        source, _, _ = self.configured()
        jobs.save_config(self.app, {'configId': '101', 'enabled': True})
        with patch('backend.runner_management.model_interfaces.generate', side_effect=[RuntimeError('模型暂时不可用'), {'archive': {'archiveId': 'a' * 32, 'status': 'committed', 'gitCommit': 'b' * 40}}]) as generate:
            result = jobs.submit(self.app, {'sources': [source, {**source, 'sourceId': '124'}]})
            worker = self.app._generation_worker
            if worker:
                worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
            self.assertEqual(len(result['created']), 2)
            rows = sorted(jobs.listing(self.app), key=lambda row: row['sourceId'])
            self.assertEqual([row['status'] for row in rows], ['failed', 'succeeded'])
            self.assertEqual(rows[0]['message'], '模型暂时不可用')
            self.assertEqual(generate.call_count, 2)
