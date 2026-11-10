import unittest
from pathlib import Path
from unittest.mock import patch

from backend.tests import test_database_generation as fixtures
from backend.runner_management import code_servers, database_generation as tasks, generation_references as refs, generation_tasks, model_interfaces
from backend.runner_management.server import ApiError


class GenerationReferencesTest(unittest.TestCase):
    setUp = fixtures.DatabaseGenerationTest.setUp
    tearDown = fixtures.DatabaseGenerationTest.tearDown
    request = fixtures.DatabaseGenerationTest.request
    fixture = fixtures.DatabaseGenerationTest.fixture
    start_remote = fixtures.DatabaseGenerationTest.start_remote
    configured = fixtures.DatabaseGenerationTest.configured
    handler = fixtures.DatabaseGenerationTest.handler

    def reference(self, repo, text='VALUE = 1\n'):
        root = Path(repo['path'])
        file = root / 'links/1401218/demo.py'
        file.parent.mkdir(parents=True, exist_ok=True); file.write_text(text, encoding='utf8')
        self.app.git(root, 'add', '--', 'links/1401218/demo.py')
        self.app.git(root, 'commit', '-m', 'Reference input')
        return {'repositoryId': repo['repoId'], 'path': 'links/1401218/demo.py'}

    def test_task_freezes_git_reference_and_syncs_before_model_without_archiving_input(self):
        service, _, body, calls = self.configured()
        repo = self.app.list_repositories()[0]
        selected = self.reference(repo)
        generation = generation_tasks.read_config(self.app, '101')['generation']
        generation_tasks.save_config(self.app, {'configId': '101', 'generation': {**generation, 'referenceFiles': [selected]}})
        job = tasks.create(self.app, body)['job']
        frozen = tasks.read(self.app, job['taskId'])['input']['referenceFiles'][0]
        self.reference(repo, 'VALUE = 2\n')
        server = code_servers.read(self.app, service.identity['serverId'])
        tasks.claim(self.app, server); tasks.execute(self.handler(), self.app, server, job['taskId'])
        result = tasks.read(self.app, job['taskId'])
        self.assertEqual(result['status'], 'succeeded', result['message'])
        target = service.workspace.root / '101/input/demo.py'
        self.assertEqual(target.read_text('utf8'), 'VALUE = 1\n')
        self.assertIn(str(target), calls[0]['prompt'])
        self.assertEqual(calls[0]['input_file_dir'], str(target.parent))
        self.assertEqual(result['input']['referenceFiles'][0]['gitCommit'], frozen['gitCommit'])
        self.assertFalse(any('/input/' in file['path'] for file in result['result']['archive']['files']))

    def test_direct_sync_failure_stops_model_call_and_releases_agent(self):
        service, repo, _, payload, calls = self.fixture()
        selected = self.reference(repo)
        operation = code_servers.operation
        def fail_upload(app, server, body):
            if body['action'] == 'upload' and any(file['path'].endswith('/input/demo.py') for file in body['files']):
                raise ApiError('参考文件下载失败', 502)
            return operation(app, server, body)
        with patch.object(code_servers, 'operation', side_effect=fail_upload):
            with self.assertRaisesRegex(ApiError, '参考文件下载失败'):
                model_interfaces.generate(self.app, {**payload, 'referenceFiles': [selected]})
        self.assertFalse(calls)

    def test_rejects_missing_unsafe_and_same_name_references(self):
        _, repo, _, _, _ = self.fixture()
        selected = self.reference(repo)
        with self.assertRaises(ApiError): refs.snapshot(self.app, [{**selected, 'path': 'missing.py'}])
        with self.assertRaises(ApiError): refs.normalize([{**selected, 'path': '../demo.py'}])
        with self.assertRaisesRegex(ApiError, '同名'): refs.normalize([selected, {**selected, 'path': 'other/demo.py'}])

    def test_deselection_removes_only_managed_inputs_and_preserves_user_files(self):
        service, repo, _, _, _ = self.fixture()
        selected = self.reference(repo)
        workspace = {'inputFileDir': str(service.workspace.root / '101/input')}
        frozen = refs.snapshot(self.app, [selected])
        refs.sync(self.app, service.identity['serverId'], workspace, frozen)
        user_file = service.workspace.root / '101/input/user.txt'; user_file.write_text('keep', encoding='utf8')
        refs.sync(self.app, service.identity['serverId'], workspace, [])
        self.assertFalse((user_file.parent / 'demo.py').exists())
        self.assertEqual(user_file.read_text('utf8'), 'keep')
