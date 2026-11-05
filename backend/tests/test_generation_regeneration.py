import copy
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from backend.tests.test_database_generation import DatabaseGenerationTest
from backend.runner_management import database_generation as tasks, generation_tasks


class GenerationRegenerationTest(unittest.TestCase):
    setUp = DatabaseGenerationTest.setUp
    tearDown = DatabaseGenerationTest.tearDown
    request = DatabaseGenerationTest.request
    fixture = DatabaseGenerationTest.fixture
    start_remote = DatabaseGenerationTest.start_remote
    configured = DatabaseGenerationTest.configured
    handler = DatabaseGenerationTest.handler

    def setup_task(self):
        service, origin, body, calls = self.configured()
        job = tasks.create(self.app, body)['job']; record = tasks.read(self.app, job['taskId'])
        record.update(status='failed', output='old error', callbackSent=True)
        tasks.put(self.app, record)
        snapshot = self.request('/api/runner-management/code-generation/tasks/regeneration?taskId=' + job['taskId'])
        submitted = {'taskId': job['taskId'], 'requestId': 'a'*32, 'systemPrompt': '新的系统规范', 'userPrompt': '抓取原网站',
                     'correction': '修正发布日期', 'interfaceId': snapshot['generation']['interfaceId'],
                     'updateNodePrompts': False, 'nodePromptRevision': snapshot['nodePromptRevision']}
        return service, origin, record, snapshot, submitted, calls

    def submit(self, body):
        return self.request('/api/runner-management/code-generation/tasks/regeneration', body)['job']

    def test_snapshot_retry_lineage_idempotency_and_no_mq_or_node_overwrite(self):
        service, origin, parent, snapshot, body, calls = self.setup_task()
        defaults = copy.deepcopy(generation_tasks.read_config(self.app, parent['configId']))
        with patch('backend.runner_management.mq_generation.fetch_json', side_effect=AssertionError('no MQ')):
            child = self.submit(body)
        self.assertNotEqual(parent['taskId'], child['taskId'])
        self.assertEqual(child['parentTaskId'], parent['taskId']); self.assertEqual(child['rootTaskId'], parent['taskId'])
        self.assertEqual(child['attempt'], 2); self.assertEqual(child['status'], 'queued')
        self.assertEqual(self.submit(body)['taskId'], child['taskId'])
        saved = tasks.read(self.app, child['taskId'])
        for field in ('sourceId', 'flowId', 'stepId', 'configId', 'entryIds'):
            self.assertEqual(saved[field], parent[field])
        for field in ('repositoryId', 'directoryId', 'url', 'queueName', 'destinationMode'):
            self.assertEqual(saved['input'].get(field), parent['input'].get(field))
        self.assertEqual(saved['input']['userPrompt'], '抓取原网站\n\n本次修正要求：\n修正发布日期')
        self.assertEqual(tasks.read(self.app, parent['taskId']), parent)
        self.assertEqual(generation_tasks.read_config(self.app, parent['configId']), defaults)
        self.assertFalse(calls)
        server = __import__('backend.runner_management.code_servers', fromlist=['read']).read(self.app, service.identity['serverId'])
        self.assertEqual(tasks.claim(self.app, server)['job']['taskId'], child['taskId'])
        tasks.execute(self.handler(), self.app, server, child['taskId'])
        self.assertEqual(tasks.read(self.app, child['taskId'])['status'], 'succeeded')
        self.assertIn('修正发布日期', calls[-1]['prompt'])
        self.assertEqual(tasks.read(self.app, parent['taskId'])['output'], 'old error')

    def test_update_node_prompts_preserves_other_config_and_conflicts_are_atomic(self):
        service, origin, parent, snapshot, body, calls = self.setup_task()
        before = generation_tasks.read_config(self.app, parent['configId'])
        body['updateNodePrompts'] = True
        child = self.submit(body)
        after = generation_tasks.read_config(self.app, parent['configId'])
        for field, value in before['generation'].items():
            if field not in ('systemPrompt', 'userPrompt'): self.assertEqual(after['generation'][field], value)
        self.assertEqual(after['generation']['systemPrompt'], body['systemPrompt'])
        self.assertIn('修正发布日期', after['generation']['userPrompt'])
        saved = tasks.read(self.app, child['taskId']); saved.update(status='failed'); tasks.put(self.app, saved)
        body['requestId'] = 'b'*32
        with self.assertRaises(HTTPError) as conflict: self.submit(body)
        self.assertEqual(conflict.exception.code, 409)
        with self.app.store.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) n FROM generation_jobs').fetchone()['n'], 2)

    def test_invalid_disabled_model_rolls_back_node_update_and_active_task_blocks_retry(self):
        service, origin, parent, snapshot, body, calls = self.setup_task()
        before = generation_tasks.read_config(self.app, parent['configId'])
        body.update(updateNodePrompts=True, interfaceId='missing-model')
        with self.assertRaises(HTTPError): self.submit(body)
        self.assertEqual(generation_tasks.read_config(self.app, parent['configId']), before)
        body.update(updateNodePrompts=False, interfaceId=snapshot['generation']['interfaceId'])
        child = self.submit(body)
        body['requestId'] = 'b'*32
        with self.assertRaises(HTTPError) as conflict: self.submit(body)
        self.assertEqual(conflict.exception.code, 409)
        with self.assertRaises(HTTPError): self.submit({**body, 'taskId': child['taskId']})

    def test_failed_insert_rolls_back_node_prompt_change(self):
        service, origin, parent, snapshot, body, calls = self.setup_task()
        before = generation_tasks.read_config(self.app, parent['configId']); body['updateNodePrompts'] = True
        with patch('backend.runner_management.source_code_relations.note_task', side_effect=RuntimeError('transaction failure')):
            with self.assertRaises(HTTPError): self.submit(body)
        self.assertEqual(generation_tasks.read_config(self.app, parent['configId']), before)
        with self.app.store.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) n FROM generation_jobs').fetchone()['n'], 1)
