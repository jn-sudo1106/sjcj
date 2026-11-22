import json
import subprocess
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management.server import ApiError


class RepositoryDirectoryRenameTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def fixture(self):
        self.repo = self.request('/api/runner-management/settings/code-repos')[0]
        self.route = '/api/runner-management/settings/code-repos/' + self.repo['repoId'] + '/directories'
        directory = self.request(self.route, {'name': '规则处理代码', 'path': 'ruleHandle', 'configType': '600', 'configTypeName': '规则处理'})
        self.root = Path(self.repo['path'])
        self.origin = Path(self.tmp.name) / 'origin'; self.origin.mkdir()
        self.app.git(self.origin, 'init', '--bare')
        with self.app.store.connect() as db:
            db.execute('UPDATE code_repositories SET remote_url=? WHERE repo_id=?', (self.origin.as_uri(), self.repo['repoId']))
        self.app.set_git_origin(self.root, self.origin.as_uri()); self.app.push_git(self.root, 'main')
        return directory

    def save(self, old, path='ruleProcess'):
        return self.request(self.route + '/' + old['directoryId'], {**old, 'path': path})

    def test_rename_moves_git_directory_preserves_identity_and_unrelated_work(self):
        old = self.fixture()
        (self.root / 'unrelated.txt').write_text('unfinished')
        updated = self.save(old)
        self.assertEqual(updated['directoryId'], old['directoryId'])
        self.assertNotEqual(updated['revision'], old['revision'])
        self.assertFalse((self.root / old['path']).exists())
        self.assertTrue((self.root / 'ruleProcess/.gitkeep').exists())
        self.assertEqual((self.root / 'unrelated.txt').read_text(), 'unfinished')
        self.assertEqual(self.app.git(self.origin, 'ls-tree', '-r', '--name-only', 'refs/heads/main').strip(), 'ruleProcess/.gitkeep')
        self.assertNotIn('unrelated.txt', self.app.git(self.root, 'ls-files'))
        with self.assertRaises(HTTPError) as error:
            self.save(old, 'stale')
        self.assertEqual(error.exception.code, 409)

    def test_failed_push_preserves_consistent_local_path_and_retry_pushes_once(self):
        old = self.fixture()
        with patch.object(self.app, 'push_git', side_effect=ApiError('push failed', 502)):
            pending = self.save(old)
        self.assertTrue(pending['pendingPush'])
        self.assertTrue((self.root / 'ruleProcess/.gitkeep').exists())
        self.assertEqual(self.request(self.route)[0]['path'], 'ruleProcess')
        local = self.app.git(self.root, 'rev-parse', 'HEAD').strip()
        updated = self.save(pending)
        self.assertFalse(updated.get('pendingPush'))
        self.assertEqual(self.app.git(self.root, 'rev-parse', 'HEAD').strip(), local)
        self.assertEqual(self.app.git(self.origin, 'rev-parse', 'refs/heads/main').strip(), local)

    def test_commit_failure_restores_original_folder_index_and_configuration(self):
        old = self.fixture(); original = self.app.git
        def fail_commit(root, *args):
            if 'commit' in args and any('Rename repository directory' in arg for arg in args):
                raise ApiError('commit failed', 500)
            return original(root, *args)
        with patch.object(self.app, 'git', side_effect=fail_commit), self.assertRaises(HTTPError):
            self.save(old)
        self.assertTrue((self.root / 'ruleHandle/.gitkeep').exists())
        self.assertFalse((self.root / 'ruleProcess').exists())
        self.assertEqual(self.app.git(self.root, 'status', '--porcelain').strip(), '')
        self.assertEqual(self.request(self.route)[0]['path'], 'ruleHandle')

    def test_push_timeout_keeps_new_directory_and_retryable_configuration(self):
        old = self.fixture()
        with patch.object(self.app, 'push_git', side_effect=subprocess.TimeoutExpired(['git', 'push'], 60)):
            pending = self.save(old)
        self.assertTrue(pending['pendingPush'])
        self.assertTrue((self.root / 'ruleProcess/.gitkeep').exists())
        self.assertEqual(self.request(self.route)[0]['path'], 'ruleProcess')

    def test_dirty_directory_nested_path_and_existing_target_do_not_move_files(self):
        old = self.fixture()
        (self.root / 'occupied').mkdir(); (self.root / 'occupied/keep').write_text('keep')
        for path in ('../outside', 'ruleHandle/subdir', 'occupied'):
            with self.assertRaises(HTTPError): self.save(old, path)
        (self.root / 'ruleHandle/local.py').write_text('draft')
        with self.assertRaises(HTTPError): self.save(old)
        self.assertEqual((self.root / 'ruleHandle/local.py').read_text(), 'draft')
        self.assertEqual((self.root / 'occupied/keep').read_text(), 'keep')

    def test_referenced_generation_file_blocks_rename_but_allows_label_edit(self):
        old = self.fixture()
        from backend.runner_management.source_code_relations import sync_archive
        with self.app.store.connect() as db:
            sync_archive(db, {'archiveId': 'archive', 'configId': '1401281', 'taskId': 'task',
                'repoId': self.repo['repoId'], 'directoryId': old['directoryId'], 'directoryPath': 'ruleHandle',
                'sourceContext': {'sourceId': '430024906', 'flowId': '21000040', 'stepId': '41896'},
                'createdAt': '2026-11-22T00:00:00+00:00', 'files': [{'path': 'ruleHandle/site.py'}]})
        with self.assertRaises(HTTPError) as error: self.save(old)
        self.assertIn('归档引用', json.load(error.exception)['message'])
        updated = self.request(self.route + '/' + old['directoryId'], {**old, 'name': '规则脚本'})
        self.assertEqual(updated['name'], '规则脚本')
        self.assertTrue((self.root / 'ruleHandle/.gitkeep').exists())

    def test_deployment_mapping_blocks_directory_rename(self):
        old = self.fixture()
        mapping = {'deployment': {'nodes': [{'id': 'rules', 'kind': 'file', 'sourceType': 'directory',
                       'sourcePath': 'ruleHandle', 'repoId': self.repo['repoId']}]}}
        with patch('backend.runner_management.deployment_configuration.configurations', return_value=mapping), self.assertRaises(HTTPError) as error:
            self.save(old)
        self.assertIn('部署配置引用', json.load(error.exception)['message'])
