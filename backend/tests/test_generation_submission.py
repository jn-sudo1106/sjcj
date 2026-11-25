import json
import uuid
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.tests import test_database_generation as fixtures
from backend.runner_management import database_generation as tasks, code_servers, generated_archives, agent_pool
from backend.runner_management.server import ApiError


class GenerationSubmissionTest(unittest.TestCase):
    setUp = fixtures.DatabaseGenerationTest.setUp
    tearDown = fixtures.DatabaseGenerationTest.tearDown
    fixture = fixtures.DatabaseGenerationTest.fixture
    start_remote = fixtures.DatabaseGenerationTest.start_remote
    configured = fixtures.DatabaseGenerationTest.configured
    request = fixtures.DatabaseGenerationTest.request
    handler = fixtures.DatabaseGenerationTest.handler

    def late_task(self, write=True):
        service, origin, body, calls = self.configured(text_only=True, response_text='正在检查目标网站，等待网络请求完成。')
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        tasks.claim(self.app, server); tasks.execute(self.handler(), self.app, server, job['taskId'])
        record = tasks.read(self.app, job['taskId'])
        self.assertEqual(record['status'], 'failed')
        if write:
            directory = Path(record['request']['body']['code_dir'])
            (directory / record['result']['fileName']).write_text('def scrape(url):\n    return []\n', encoding='utf8')
            (directory / 'requirements.txt').write_text('requests\n', encoding='utf8')
        return service, origin, record, calls

    def submit(self, task):
        return self.request('/api/runner-management/code-generation/tasks/commit', {'taskId': task['taskId']})['job']

    def test_manual_submit_collects_late_files_updates_source_and_is_idempotent(self):
        service, origin, task, calls = self.late_task()
        original_finished = task['finishedAt']
        with patch('backend.runner_management.model_interfaces.generate', side_effect=AssertionError('Do not regenerate')):
            submitted = self.submit(task)
        self.assertEqual(submitted['status'], 'succeeded')
        self.assertEqual(submitted['finishedAt'], original_finished)
        self.assertIn('def scrape', submitted['result']['code'])
        archive = submitted['result']['archive']
        self.assertEqual(archive['status'], 'committed'); self.assertTrue(archive['pushed'])
        self.assertEqual(len(archive['files']), 2)
        for file in archive['files']:
            self.assertTrue(Path(file['serverPath']).is_file())
            self.assertTrue(self.app.git(origin, 'show', 'main:' + file['path']))
        state = generated_archives.state(self.app, task['configId'], {key: task[key] for key in ('sourceId', 'flowId', 'stepId')})
        self.assertEqual(state['archive']['gitCommit'], archive['gitCommit'])
        with self.app.store.connect() as db:
            count = db.execute("SELECT COUNT(*) AS count FROM artifacts WHERE task_id=? AND artifact_type='code'", (task['taskId'],)).fetchone()['count']
        self.assertEqual(count, 2)
        self.assertEqual(len(calls), 1)
        repeated = self.submit(task)
        self.assertEqual(repeated['result']['archive']['gitCommit'], archive['gitCommit'])
        self.assertEqual(len(calls), 1)

    def test_manual_submit_recovers_timeout_without_previous_archive(self):
        _, _, task, _ = self.late_task()
        expected = task['result']['fileName']
        task['result'] = None; tasks.put(self.app, task)
        result = self.submit(task)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['result']['fileName'], expected)
        self.assertIn('def scrape', result['result']['code'])

    def test_missing_main_never_marks_task_successful_or_commits_dependencies_only(self):
        _, _, task, _ = self.late_task(write=False)
        (Path(task['request']['body']['code_dir']) / 'requirements.txt').write_text('requests\n')
        with self.assertRaises(HTTPError) as error: self.submit(task)
        self.assertEqual(error.exception.code, 422)
        self.assertIn('未生成主脚本', json.load(error.exception)['message'])
        self.assertEqual(tasks.read(self.app, task['taskId'])['status'], 'failed')

    def test_failed_push_can_be_retried_without_generating_again(self):
        _, _, task, calls = self.late_task()
        push = self.app.push_git
        attempts = []
        def fail_once(*args):
            attempts.append(True)
            if len(attempts) == 1: raise ApiError('模拟远程不可用', 502)
            return push(*args)
        with patch.object(self.app, 'push_git', side_effect=fail_once):
            failed = self.submit(task)
            self.assertEqual(failed['status'], 'failed')
            self.assertEqual(len(failed['result']['archive']['files']), 2)
            restored = self.submit(task)
        self.assertEqual(restored['status'], 'succeeded')
        self.assertTrue(restored['result']['archive']['pushed'])
        self.assertEqual(len(calls), 1)

    def test_known_proxy_password_is_not_submitted_to_git(self):
        _, _, task, _ = self.late_task()
        from backend.runner_management.node_proxy_settings import save
        save(self.app, {'configId': task['configId'], 'useProxy': True, 'revision': 0,
                        'proxyDetail': {'ip': 'proxy.test', 'port': 31100, 'account': 'test', 'password': 'test-private-value'}})
        file = Path(task['request']['body']['code_dir']) / task['result']['fileName']
        file.write_text('PASSWORD = "test-private-value"\n')
        with self.assertRaises(HTTPError) as error: self.submit(task)
        self.assertEqual(error.exception.code, 422)
        self.assertIn('真实代理密码', json.load(error.exception)['message'])
        self.assertEqual(tasks.read(self.app, task['taskId'])['status'], 'failed')

    def test_busy_agent_and_reused_slot_cannot_be_submitted(self):
        service, _, task, _ = self.late_task()
        request = task['request']
        resource = {'endpoint': request['url'], 'cdpPort': request['body'].get('cdp_port'), 'generationServerId': task['serverId']}
        self.assertTrue(agent_pool.acquire(self.app, resource, 'other-owner'))
        with self.assertRaises(HTTPError) as busy: self.submit(task)
        self.assertEqual(busy.exception.code, 409)
        agent_pool.release(self.app, resource, 'other-owner')
        body = {key: task[key] for key in ('sourceId', 'flowId', 'stepId', 'configId')}
        later = tasks.create(self.app, body)['job']
        record = tasks.read(self.app, later['taskId'])
        record.update(status='failed', serverId=service.identity['serverId'], request=request,
                      startedAt=(datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat())
        tasks.put(self.app, record)
        with self.assertRaises(HTTPError) as reused: self.submit(task)
        self.assertEqual(reused.exception.code, 409)
        self.assertIn('后续任务', json.load(reused.exception)['message'])

    def test_running_foreign_archive_and_non_admin_are_rejected(self):
        _, _, task, _ = self.late_task()
        task['status'] = 'running'; tasks.put(self.app, task)
        with self.assertRaises(HTTPError) as running: self.submit(task)
        self.assertEqual(running.exception.code, 409)
        task['status'] = 'failed'; tasks.put(self.app, task)
        archive_id = task['result']['archive']['archiveId']
        with self.app.store.connect() as db:
            row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (generated_archives.PREFIX + archive_id,)).fetchone()
            archive = json.loads(row['setting_value']); archive['taskId'] = uuid.uuid4().hex
            db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (json.dumps(archive), generated_archives.PREFIX + archive_id))
        with self.assertRaises(HTTPError) as foreign: self.submit(task)
        self.assertEqual(foreign.exception.code, 409)
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('需要管理员权限', 403)) as auth:
            with self.assertRaises(HTTPError) as forbidden: self.submit(task)
        self.assertEqual(forbidden.exception.code, 403)
        self.assertTrue(auth.call_args.kwargs['write'])
