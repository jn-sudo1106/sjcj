import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from backend.tests.test_mq_generation import MqGenerationTest
from backend.runner_management import mq_generation as mq, mq_task_management as tasks
from backend.runner_management.server import ApiError


class CodeTaskManagementTest(unittest.TestCase):
    setUp = MqGenerationTest.setUp
    tearDown = MqGenerationTest.tearDown
    request = MqGenerationTest.request
    fixture = MqGenerationTest.fixture
    start_remote = MqGenerationTest.start_remote
    configure = MqGenerationTest.configure
    personal = MqGenerationTest.personal

    def row(self, task_id='501', source='43001', state='L', kind='CODE_CONFIG'):
        return {'taskId': task_id, 'configId': '201001', 'sourceId': '-1', 'state': state,
                'vars': json.dumps({'taskKind': kind, 'codeSourceId': source, 'sourceFlowId': 40, 'stepConfigId': 101})}

    def business(self, rows):
        def fetch(path, body=None, headers=None, query=None):
            if path.endswith('/codeConfigOptions'): return {'code': 0, 'data': [{'configId': '201001'}]}
            self.assertTrue(path.endswith('/topTaskPaged'))
            self.assertNotIn('sourceId', query)  # The generation ledger has no collection source identity.
            data = [row for row in rows if str(row['configId']) == query['configId']
                    and (not query.get('taskId') or str(row['taskId']) == query['taskId'])
                    and (not query.get('state') or row['state'] == query['state'])]
            start = (query['page'] - 1) * query['limit']
            return {'code': 0, 'count': len(data), 'data': data[start:start + query['limit']]}
        return patch.object(mq, 'fetch_json', side_effect=fetch)

    def test_source_filter_uses_target_source_in_vars_before_pagination(self):
        rows = [self.row(str(600 - index), '43001' if index % 2 == 0 else '43002') for index in range(128)]
        with self.business(rows):
            result = self.request('/api/runner-management/mq-code-jobs/tasks?configId=201001&sourceId=43001&page=2&size=2')
        self.assertEqual(result['total'], 64)
        self.assertEqual([row['taskId'] for row in result['list']], ['596', '594'])
        with self.business(rows):
            later = self.request('/api/runner-management/mq-code-jobs/tasks?configId=201001&sourceId=43001&page=30&size=2')
        self.assertEqual(later['total'], 64)
        self.assertEqual([row['taskId'] for row in later['list']], ['484', '482'])

    def test_logical_delete_is_persistent_and_excluded_before_counting_and_paging(self):
        rows = [self.row('503'), self.row('502'), self.row('501')]
        with self.business(rows):
            result = self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '503'})
            page = self.request('/api/runner-management/mq-code-jobs/tasks?configId=201001&page=1&size=2')
        self.assertTrue(result['ok'])
        self.assertIsNotNone(tasks.marker(self.app, '503'))
        self.assertEqual(page['total'], 2)
        self.assertEqual([row['taskId'] for row in page['list']], ['502', '501'])

    def test_running_and_collection_tasks_cannot_be_deleted(self):
        running = {'taskId': '501', 'serverId': 'server', 'status': 'running', 'callbackSent': False}
        mq.put(self.app, running)
        with self.business([self.row()]):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '501'})
            self.assertEqual(error.exception.code, 409)
        self.assertIsNone(tasks.marker(self.app, '501'))
        with self.business([self.row('502', kind='COLLECTION')]):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '502'})
            self.assertEqual(error.exception.code, 409)
        with self.business([self.row()]):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '999'})
            self.assertEqual(error.exception.code, 404)

    def test_delete_requires_write_permission(self):
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('无写入权限', 403)) as auth:
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '501'})
            self.assertEqual(error.exception.code, 403)
            self.assertTrue(auth.call_args.kwargs['write'])

    def test_deleting_before_mq_claim_skips_model_and_sends_failure_receipt(self):
        service, origin, calls, returns, messages, gets = self.configure()
        with self.business([self.row()]):
            self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '501'})
        job = self.personal(service, 'next', {})['job']
        self.personal(service, 'execute', job)
        self.assertFalse(calls)
        self.assertEqual(returns[0]['IsSuccess'], 'false')
        self.assertIn('已删除', returns[0]['ErrorMessage'])
        self.assertTrue(mq.read(self.app, '501')['deletedAt'])

    def test_deleting_after_claim_prevents_generation_and_retains_execution_record(self):
        service, origin, calls, returns, messages, gets = self.configure()
        job = self.personal(service, 'next', {})['job']
        with self.business([self.row()]):
            self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '501'})
        self.personal(service, 'execute', job)
        self.assertFalse(calls)
        self.assertTrue(mq.read(self.app, '501')['callbackSent'])
        self.assertEqual(mq.read(self.app, '501')['status'], 'failed')

    def test_finished_task_deletion_preserves_generated_code_and_success(self):
        record = {'taskId': '501', 'serverId': 'server', 'status': 'succeeded', 'callbackSent': True, 'result': {'code': 'retained'}}
        mq.put(self.app, record)
        with self.business([self.row(state='C')]):
            self.request('/api/runner-management/mq-code-jobs/delete', {'configId': '201001', 'taskId': '501'})
        saved = mq.read(self.app, '501')
        self.assertEqual(saved['status'], 'succeeded')
        self.assertEqual(saved['result']['code'], 'retained')

