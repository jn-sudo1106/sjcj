import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.tests import test_runner_management as baseline
from backend.runner_management.server import ApiError


class RepositoryMoveTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def fixture(self):
        code = self.request('/api/runner-management/site-scripts/publish', {
            'configId': '123', 'queueName': 'news_list', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n'})
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        original = Path(repo['path'])
        (original / 'untracked.txt').write_text('keep local edits', encoding='utf8')
        return repo, code, original

    def test_existing_empty_directory_moves_repository_without_extra_nested_folder(self):
        repo, code, original = self.fixture()
        target = Path(self.tmp.name) / 'empty-target'; target.mkdir()
        target_inode = target.stat().st_ino
        changed = self.request('/api/runner-management/settings/code-repos/' + repo['repoId'] + '/path', {'path': str(target)})
        self.assertEqual(changed['path'], str(target))
        self.assertFalse(original.exists())
        self.assertTrue((target / '.git').is_dir())
        self.assertTrue((target / code['storagePath']).is_file())
        self.assertEqual((target / 'untracked.txt').read_text('utf8'), 'keep local edits')
        self.assertEqual(self.app.git(target, 'rev-parse', 'HEAD').strip(), code['gitCommit'])
        self.assertFalse((target / original.name).exists())
        self.assertEqual(target.stat().st_ino, target_inode)
        self.assertTrue(self.request('/api/runner-management/site-scripts/catalog')[0]['gitUrl'].startswith(target.as_uri() + '#'))
        same = self.app.move_repository(repo['repoId'], {'path': str(target / '.')})
        self.assertEqual(same['path'], str(target))

    def test_nonempty_directory_or_file_is_not_overwritten(self):
        repo, code, original = self.fixture()
        for is_file in (False, True):
            target = Path(self.tmp.name) / ('occupied-file' if is_file else 'occupied-directory')
            if is_file: target.write_text('keep', encoding='utf8')
            else:
                target.mkdir(); (target / 'keep.txt').write_text('keep', encoding='utf8')
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/settings/code-repos/' + repo['repoId'] + '/path', {'path': str(target)})
            self.assertEqual(error.exception.code, 409)
            self.assertEqual((target if is_file else target / 'keep.txt').read_text('utf8'), 'keep')
            self.assertTrue((original / code['storagePath']).is_file())
            self.assertEqual(self.request('/api/runner-management/settings/code-repos')[0]['path'], str(original))

    def test_database_failure_restores_original_repository_and_empty_target(self):
        repo, code, original = self.fixture()
        target = Path(self.tmp.name) / 'rollback-empty'; target.mkdir()
        with patch.object(self.app, 'rewrite_repo_urls', side_effect=RuntimeError('database fixture failure')):
            with self.assertRaises(ApiError):
                self.app.move_repository(repo['repoId'], {'path': str(target)})
        self.assertTrue((original / code['storagePath']).is_file())
        self.assertTrue((original / '.git').is_dir())
        self.assertEqual((original / 'untracked.txt').read_text('utf8'), 'keep local edits')
        self.assertTrue(target.is_dir()); self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(self.request('/api/runner-management/settings/code-repos')[0]['path'], str(original))

    def test_move_failure_keeps_source_and_restores_empty_target(self):
        repo, code, original = self.fixture()
        target = Path(self.tmp.name) / 'failed-empty'; target.mkdir()
        with patch('backend.runner_management.server.shutil.move', side_effect=OSError('filesystem fixture failure')):
            with self.assertRaises(ApiError):
                self.app.move_repository(repo['repoId'], {'path': str(target)})
        self.assertTrue((original / code['storagePath']).is_file())
        self.assertTrue(target.is_dir()); self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(self.request('/api/runner-management/settings/code-repos')[0]['path'], str(original))

    def test_partial_move_failure_restores_previously_moved_entries(self):
        import shutil
        repo, code, original = self.fixture()
        target = Path(self.tmp.name) / 'partial-empty'; target.mkdir()
        original_move, calls = shutil.move, 0
        def fail_second(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2: raise OSError('partial move fixture failure')
            return original_move(source, destination)
        with patch('backend.runner_management.server.shutil.move', side_effect=fail_second):
            with self.assertRaises(ApiError):
                self.app.move_repository(repo['repoId'], {'path': str(target)})
        self.assertTrue((original / code['storagePath']).is_file())
        self.assertEqual(self.app.git(original, 'rev-parse', 'HEAD').strip(), code['gitCommit'])
        self.assertEqual((original / 'untracked.txt').read_text('utf8'), 'keep local edits')
        self.assertEqual(list(target.iterdir()), [])
