import subprocess
from pathlib import Path
import unittest
from urllib.error import HTTPError
from unittest.mock import patch
from backend.tests import test_runner_management as fixture


class RepositorySyncTest(unittest.TestCase):
    request = fixture.ManagementIntegrationTest.request
    tearDown = fixture.ManagementIntegrationTest.tearDown

    def test_git_object_permission_error_is_reported_without_exposing_git_credentials(self):
        real_run = subprocess.run
        def run(args, **kwargs):
            if args[:2] == ['git', 'fetch']:
                return subprocess.CompletedProcess(args, 128, '', 'insufficient permission for adding an object to repository database .git/objects https://user:private-secret@example.com/repo.git')
            return real_run(args, **kwargs)
        with patch('backend.runner_management.repository_sync.subprocess.run', side_effect=run):
            with self.assertRaises(HTTPError) as failure:
                self.request(self.route, {})
        body = failure.exception.read().decode()
        self.assertEqual(failure.exception.code, 503)
        self.assertIn('无写入权限', body)
        self.assertNotIn('private-secret', body)

    def git(self, folder, *args):
        result = subprocess.run(['git', *args], cwd=folder, capture_output=True, text=True, encoding='utf8', timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def setUp(self):
        fixture.ManagementIntegrationTest.setUp(self)
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        self.repo_id = repo['repoId']; self.local = Path(repo['path'])
        self.local.mkdir(parents=True, exist_ok=True)
        self.git(self.local, 'init', '-b', 'main')
        self.git(self.local, 'config', 'user.name', 'Test'); self.git(self.local, 'config', 'user.email', 'test@example.invalid')
        self.commit(self.local, 'newslink.py', 'base\n')
        self.remote = Path(self.tmp.name) / 'remote.git'
        self.git(Path(self.tmp.name), 'init', '--bare', str(self.remote))
        self.git(self.local, 'remote', 'add', 'origin', self.remote.as_posix())
        self.git(self.local, 'push', '-u', 'origin', 'main')
        self.writer = Path(self.tmp.name) / 'writer'
        self.git(Path(self.tmp.name), 'clone', '--branch', 'main', self.remote.as_posix(), str(self.writer))
        self.git(self.writer, 'config', 'user.name', 'Test'); self.git(self.writer, 'config', 'user.email', 'test@example.invalid')
        with self.app.store.connect() as db:
            db.execute('UPDATE code_repositories SET remote_url=?,branch=? WHERE repo_id=?', (self.remote.as_posix(), 'main', self.repo_id))
        self.route = '/api/runner-management/settings/code-repos/' + self.repo_id + '/sync'

    def commit(self, folder, path, content):
        file = folder / path; file.parent.mkdir(parents=True, exist_ok=True); file.write_text(content, encoding='utf8')
        self.git(folder, 'add', '--', path); self.git(folder, 'commit', '-m', 'update ' + path)
        return self.git(folder, 'rev-parse', 'HEAD')

    def push(self, path='links/1401218/bin/package.py', content='new\n'):
        commit = self.commit(self.writer, path, content)
        self.git(self.writer, 'push', 'origin', 'main')
        return commit

    def test_fetches_remote_files_and_refresh_api_sees_bin(self):
        remote = self.push()
        result = self.request(self.route, {})
        self.assertEqual((result['mode'], result['gitCommit']), ('fast-forward', remote))
        files = self.request('/api/runner-management/settings/code-repos/' + self.repo_id + '/files?folder=links/1401218&view=directory')
        self.assertIn('links/1401218/bin', [row['path'] for row in files['items']])
        again = self.request(self.route, {})
        self.assertFalse(again['changed']); self.assertEqual(again['receivedCommits'], 0)

    def test_diverged_history_is_merged_preserving_both_commits(self):
        local = self.commit(self.local, 'receipt-fix.py', 'fix\n'); remote = self.push()
        result = self.request(self.route, {})
        self.assertEqual(result['mode'], 'merge')
        parents = self.git(self.local, 'rev-list', '--parents', '-n', '1', 'HEAD').split()[1:]
        self.assertEqual(parents, [local, remote])
        self.assertEqual((self.local / 'receipt-fix.py').read_text(), 'fix\n')

    def test_conflict_is_reported_without_leaving_merge_or_changing_files(self):
        local = self.commit(self.local, 'newslink.py', 'local\n'); self.push('newslink.py', 'remote\n')
        with self.assertRaises(HTTPError) as error: self.request(self.route, {})
        self.assertEqual(error.exception.code, 409)
        self.assertIn('newslink.py', error.exception.read().decode())
        self.assertEqual(self.git(self.local, 'rev-parse', 'HEAD'), local)
        self.assertEqual((self.local / 'newslink.py').read_text(), 'local\n')
        self.assertFalse((self.local / '.git/MERGE_HEAD').exists())
        self.assertEqual(self.git(self.local, 'status', '--porcelain'), '')

    def test_overlapping_unsaved_changes_are_preserved(self):
        self.push('newslink.py', 'remote\n')
        (self.local / 'newslink.py').write_text('unsaved\n')
        with self.assertRaises(HTTPError) as error: self.request(self.route, {})
        self.assertEqual(error.exception.code, 409)
        self.assertEqual((self.local / 'newslink.py').read_text(), 'unsaved\n')

    def test_unrelated_unsaved_work_is_preserved_during_sync(self):
        self.push()
        (self.local / 'notes.txt').write_text('working\n')
        result = self.request(self.route, {})
        self.assertTrue(result['changed'])
        self.assertEqual((self.local / 'notes.txt').read_text(), 'working\n')

    def test_ignored_untracked_file_is_not_overwritten(self):
        self.push('private.log', 'remote\n')
        (self.local / '.git/info/exclude').write_text('*.log\n')
        (self.local / 'private.log').write_text('unsaved\n')
        with self.assertRaises(HTTPError): self.request(self.route, {})
        self.assertEqual((self.local / 'private.log').read_text(), 'unsaved\n')

    def test_staged_work_and_wrong_branch_are_rejected(self):
        (self.local / 'newslink.py').write_text('staged\n'); self.git(self.local, 'add', 'newslink.py')
        with self.assertRaises(HTTPError): self.request(self.route, {})
        self.assertEqual(self.git(self.local, 'show', ':newslink.py'), 'staged')
        self.git(self.local, 'commit', '-m', 'staged work')
        self.git(self.local, 'checkout', '-b', 'other')
        with self.assertRaises(HTTPError): self.request(self.route, {})
        self.assertEqual(self.git(self.local, 'branch', '--show-current'), 'other')
