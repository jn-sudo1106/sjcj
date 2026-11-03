import io
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.tests import test_generated_archives as archive_tests
from backend.runner_management import code_servers, database_generation as tasks, generation_tasks
from backend.runner_management.server import ApiError


class DatabaseGenerationTest(unittest.TestCase):
    setUp = archive_tests.GeneratedArchivesTest.setUp
    tearDown = archive_tests.GeneratedArchivesTest.tearDown
    request = archive_tests.GeneratedArchivesTest.request
    fixture = archive_tests.GeneratedArchivesTest.fixture
    start_remote = archive_tests.GeneratedArchivesTest.start_remote

    def configured(self):
        service, repo, origin, payload, calls = self.fixture()
        self.request('/api/code-servers/me/heartbeat', {**service.report(), 'serverId': service.identity['serverId'],
                     'endpoint': code_servers.read(self.app, service.identity['serverId'])['endpoint']}, service.identity['token'])
        generation = {key: payload[key] for key in ('interfaceId', 'repositoryId', 'directoryId', 'configType', 'queueName', 'url')}
        generation.update(systemPrompt='系统 {{sourceId}}', userPrompt='采集 {{url}} 配置 {{configId}}', fileNameMode='website')
        generation_tasks.save_config(self.app, {'configId': '101', 'generation': generation})
        body = {'sourceId': '430024910', 'sourceName': '测试源', 'flowId': '21000040', 'stepId': '41895',
                'nodeName': '智能采集', 'configId': '101'}
        return service, origin, body, calls

    def handler(self):
        return SimpleNamespace(send_response=lambda *args: None, send_header=lambda *args: None,
                               end_headers=lambda: None, wfile=io.BytesIO())

    def test_create_is_database_only_captures_identity_model_and_does_not_start_generation(self):
        service, origin, body, calls = self.configured()
        with patch('backend.runner_management.mq_generation.fetch_json', side_effect=AssertionError('不能访问 MQ')):
            job = self.request('/api/runner-management/code-generation/tasks', {**body, 'generation': {
                'workspaceMode': 'custom', 'workspacePath': 'old/manual', 'codeDirectory': 'old/code'}})['job']
        self.assertEqual(job['sourceId'], body['sourceId'])
        self.assertEqual(job['flowId'], body['flowId'])
        self.assertEqual(job['configId'], '101')
        self.assertEqual(job['stepId'], '41895')
        self.assertEqual(job['modelCall']['interfaceId'], 'workbuddy-agent-hy3')
        self.assertTrue(job['modelCall']['endpoint'].endswith('/wb/agent'))
        self.assertFalse(calls)
        saved = tasks.read(self.app, job['taskId'])
        self.assertIn(body['sourceId'], saved['input']['systemPrompt'])
        self.assertEqual((saved['input']['workspaceMode'], saved['input']['workspacePath'], saved['input']['codeDirectory']), ('config', '', ''))
        self.assertNotIn('input', job)
        self.assertEqual(tasks.paged(self.app, {'sourceId': body['sourceId']})['total'], 1)
        self.assertEqual(tasks.paged(self.app, {'sourceId': '1'})['total'], 0)

    def test_claim_is_exclusive_and_execute_preserves_stream_and_git_without_mq(self):
        service, origin, body, calls = self.configured()
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        with patch('backend.runner_management.mq_generation.fetch_json', side_effect=AssertionError('不能访问 MQ')):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: tasks.claim(self.app, server), range(2)))
            self.assertEqual(sum(bool(result['job']) for result in results), 1)
            handler = self.handler()
            tasks.execute(handler, self.app, server, job['taskId'])
        saved = tasks.read(self.app, job['taskId'])
        self.assertEqual(saved['status'], 'succeeded', saved['message'])
        from backend.runner_management.source_code_relations import listing
        relation = listing(self.app, {'taskId': job['taskId']})
        self.assertEqual(relation['total'], 2)
        self.assertTrue(all(item['sourceId'] == body['sourceId'] and item['configId'] == body['configId'] for item in relation['items']))
        self.assertTrue(all(item['gitCommit'] == saved['result']['archive']['gitCommit'] for item in relation['items']))
        self.assertTrue(all(item['latestTaskId'] == job['taskId'] for item in relation['items']))
        latest = tasks.create(self.app, body)['job']
        self.assertTrue(all(item['latestTaskId'] == latest['taskId'] and item['taskId'] == job['taskId']
                            for item in listing(self.app, {'sourceId': body['sourceId']})['items']))
        response = self.request('/api/runner-management/source-code-relations?sourceId=' + body['sourceId'])
        self.assertEqual(response['total'], 2)
        # Previously completed tasks only stored repository paths in the result.
        # Recover source paths from the original archive receipt, not today's root.
        saved['result']['archive'].pop('serverCodeDirectory', None)
        for file in saved['result']['archive']['files']:
            file.pop('serverPath', None)
        tasks.put(self.app, saved)
        recovered = tasks.read(self.app, job['taskId'])['result']['archive']
        output = next(file for file in recovered['files'] if file['path'].endswith('/newslink.py'))
        self.assertEqual(output['serverPath'], str(service.workspace.root / '101' / 'code' / 'newslink.py'))
        self.assertEqual(len(calls), 1)
        self.assertIn('"type": "request"', handler.wfile.getvalue().decode())
        self.assertEqual(self.app.git(origin, 'show', 'main:default/101/newslink.py').strip(), 'VALUE = 1')
        with self.assertRaises(ApiError): tasks.execute(self.handler(), self.app, server, job['taskId'])
        self.assertEqual(len(calls), 1)

    def test_summaries_include_only_repository_result_locations_without_code_or_prompts(self):
        service, origin, body, calls = self.configured()
        job = tasks.create(self.app, body)['job']
        self.assertNotIn('archive', tasks.summaries(self.app, [job['taskId']])['items'][0])
        saved = tasks.read(self.app, job['taskId'])
        for paths in (['links/101/news.py'], ['links/101/news.py', 'links/101/lib/helper.py']):
            saved.update(status='succeeded', result={'code': 'PRIVATE_CODE', 'archive': {
                'repoId': 'repo-1', 'directoryId': 'dir-1', 'directoryPath': 'links',
                'files': [{'path': path, 'sha256': 'hash', 'size': 20} for path in paths],
                'workspace': 'PRIVATE_WORKSPACE'}})
            saved['finishedAt'] = '2026-10-31T03:24:24Z'
            tasks.put(self.app, saved)
            summary = self.request('/api/runner-management/code-generation/tasks/summaries?taskIds=' + job['taskId'])['items'][0]
            self.assertEqual(summary['archive'], {'repoId': 'repo-1', 'directoryId': 'dir-1', 'directoryPath': 'links',
                                                  'files': [{'path': path} for path in paths]})
            self.assertEqual(summary['finishedAt'], saved['finishedAt'])
            for key in ('result', 'input', 'params', 'output', 'request'):
                self.assertNotIn(key, summary)

    def test_offline_or_missing_model_machine_does_not_prevent_creation(self):
        service, origin, body, calls = self.configured()
        from backend.runner_management import model_interfaces
        models = model_interfaces.listing(self.app)
        selected = next(row for row in models['items'] if row['id'] == 'workbuddy-agent-hy3')
        selected.update(generationServerMode='auto', generationServerId='', endpoint='http://missing-model.example:6000/wb/agent')
        model_interfaces.save(self.app, models)
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        self.assertIsNone(tasks.claim(self.app, server)['job'])
        self.assertEqual(tasks.read(self.app, job['taskId'])['status'], 'queued')
        self.assertFalse(calls)

    def test_expired_claim_is_released_but_running_job_is_never_repeated(self):
        service, origin, body, calls = self.configured()
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        tasks.claim(self.app, server)
        with self.app.store.connect() as db:
            db.execute('UPDATE generation_jobs SET lease_until=0 WHERE task_id=?', (job['taskId'],))
        self.assertEqual(tasks.claim(self.app, server)['job']['taskId'], job['taskId'])
        record = tasks.read(self.app, job['taskId']); record['status'] = 'running'; tasks.put(self.app, record)
        tasks.recover(self.app)
        self.assertEqual(tasks.read(self.app, job['taskId'])['status'], 'failed')
        self.assertIsNone(tasks.claim(self.app, server)['job'])
        self.assertFalse(calls)

    def test_delete_before_or_after_claim_removes_database_row_and_prevents_execution(self):
        service, origin, body, calls = self.configured()
        server = code_servers.read(self.app, service.identity['serverId'])
        for claimed in (False, True):
            job = tasks.create(self.app, body)['job']
            if claimed: tasks.claim(self.app, server)
            result = self.request('/api/runner-management/code-generation/tasks/delete', {'taskId': job['taskId']})
            self.assertTrue(result['ok'])
            with self.assertRaises(ApiError): tasks.execute(self.handler(), self.app, server, job['taskId'])
            with self.app.store.connect() as db:
                self.assertIsNone(db.execute('SELECT status FROM generation_jobs WHERE task_id=?', (job['taskId'],)).fetchone())
            self.assertTrue(tasks.remove(self.app, {'taskId': job['taskId']})['ok'])
        self.assertEqual(tasks.paged(self.app, {})['total'], 0)
        self.assertFalse(calls)

    def test_running_delete_is_rejected_and_batch_reports_partial_failure(self):
        service, origin, body, calls = self.configured()
        queued = tasks.create(self.app, body)['job']; running = tasks.create(self.app, body)['job']
        record = tasks.read(self.app, running['taskId']); record['status'] = 'running'; tasks.put(self.app, record)
        result = self.request('/api/runner-management/code-generation/tasks/delete-batch', {'taskIds': [queued['taskId'], running['taskId']]})
        self.assertEqual((result['deletedCount'], result['failedCount']), (1, 1))
        self.assertEqual(tasks.paged(self.app, {})['total'], 1)
        self.assertEqual(tasks.read(self.app, running['taskId'])['status'], 'running')
        with self.assertRaises(HTTPError) as error:
            self.request('/api/runner-management/code-generation/tasks/delete', {'taskId': running['taskId']})
        self.assertEqual(error.exception.code, 409)

    def test_all_creation_and_deletion_routes_require_write_access(self):
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('无写入权限', 403)) as auth:
            for path in ('/code-generation/tasks', '/code-generation/tasks/delete', '/code-generation/tasks/delete-batch'):
                with self.assertRaises(HTTPError) as error:
                    self.request('/api/runner-management' + path, {})
                self.assertEqual(error.exception.code, 403)
                self.assertTrue(auth.call_args.kwargs['write'])

    def test_installed_worker_route_alias_claims_database_jobs_and_never_reads_old_mq(self):
        service, origin, body, calls = self.configured()
        task = tasks.create(self.app, body)['job']
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + service.identity['token'],
                   'X-Code-Server-ID': service.identity['serverId']}
        with patch('backend.runner_management.mq_generation.fetch_json', side_effect=AssertionError('不能访问旧 MQ')):
            request = Request(self.url + '/api/code-servers/me/mq/next', data=b'{}', headers=headers)
            with urlopen(request, timeout=10) as response:
                import json
                self.assertEqual(json.load(response)['job']['taskId'], task['taskId'])
        with self.assertRaises(HTTPError) as error:
            with urlopen(Request(self.url + '/api/code-servers/me/tasks/next', data=b'{}', headers={'Content-Type': 'application/json'}), timeout=10): pass
        self.assertEqual(error.exception.code, 401)

    def test_text_result_is_committed_to_configured_repository_without_mq(self):
        service, origin, body, calls = self.configured()
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        tasks.claim(self.app, server)
        with patch('backend.runner_management.model_interfaces.generate', return_value={'fileName': 'news.py', 'code': 'VALUE = 2', 'warnings': []}):
            tasks.execute(self.handler(), self.app, server, job['taskId'])
        saved = tasks.read(self.app, job['taskId'])
        self.assertEqual(saved['status'], 'succeeded', saved['message'])
        archive = saved['result']['archive']
        self.assertEqual(archive['status'], 'committed')
        relative = archive['files'][0]['path']
        self.assertEqual(self.app.git(origin, 'show', 'main:' + relative).strip(), 'VALUE = 2')
        tasks.remove(self.app, {'taskId': job['taskId']})
        with self.app.store.connect() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM generation_jobs WHERE task_id=?', (job['taskId'],)).fetchone())
        self.assertEqual(self.app.git(origin, 'show', 'main:' + relative).strip(), 'VALUE = 2')
        from backend.runner_management.generated_archives import state
        self.assertEqual(state(self.app, '101')['archive']['archiveId'], archive['archiveId'])

    def test_waiting_for_model_exposes_latest_progress_before_any_output_returns(self):
        service, origin, body, calls = self.configured()
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        tasks.claim(self.app, server)
        def generate(app, data, emit):
            self.assertEqual(tasks.read(app, job['taskId'])['message'], '正在调用模型生成代码')
            emit('request', request={'method': 'POST', 'url': 'http://model/agent', 'headers': {}, 'body': {}})
            emit('progress', message='正在连接模型服务，等待过程输出…')
            pending = tasks.read(app, job['taskId'])
            self.assertEqual(pending['status'], 'running')
            self.assertEqual(pending['message'], '正在连接模型服务，等待过程输出…')
            self.assertEqual(pending['stages'][-1], pending['message'])
            self.assertFalse(pending['output'])
            return {'archive': {'status': 'committed'}}
        with patch.object(tasks.time, 'monotonic', return_value=100), patch('backend.runner_management.model_interfaces.generate', side_effect=generate):
            tasks.execute(self.handler(), self.app, server, job['taskId'])
        self.assertEqual(tasks.read(self.app, job['taskId'])['status'], 'succeeded')
