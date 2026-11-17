import json
from pathlib import Path
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from unittest.mock import patch

from backend.tests import test_runner_management as fixture


class RuntimeDirectoryReadTest(unittest.TestCase):
    setUp = fixture.ManagementIntegrationTest.setUp
    tearDown = fixture.ManagementIntegrationTest.tearDown
    request = fixture.ManagementIntegrationTest.request
    directory_fixture = fixture.ManagementIntegrationTest.directory_fixture
    configured_runtime_fixture = fixture.ManagementIntegrationTest.configured_runtime_fixture
    deliver_runtime_fixture = fixture.ManagementIntegrationTest.deliver_runtime_fixture

    def test_listing_reads_receipts_without_packages_or_git_and_revision_can_start(self):
        _, config, runner, _, _ = self.configured_runtime_fixture()
        self.runner = runner
        delivered = self.deliver_runtime_fixture(config, runner)
        with self.app.store.connect() as db:
            before = [tuple(row) for row in db.execute('SELECT setting_key,setting_value FROM settings ORDER BY setting_key')]
        with patch.object(self.app.artifacts, 'read', side_effect=AssertionError('list must not read bundles')), \
                patch.object(self.app, 'git', side_effect=AssertionError('list must not access Git')), \
                patch('backend.runner_management.deployment_configuration.delivery_compatibility', side_effect=AssertionError('list must not verify code')):
            rows = self.request('/api/runner-management/runtime-configurations')
            current = next(row for row in rows if row['runtimeId'] == delivered['runtimeId'])
        with self.app.store.connect() as db:
            after = [tuple(row) for row in db.execute('SELECT setting_key,setting_value FROM settings ORDER BY setting_key')]
        self.assertEqual(before, after)
        self.assertNotIn('deliveredCodeMatches', current)
        from backend.runner_management.deployment_configuration import delivery_compatibility
        with patch('backend.runner_management.deployment_configuration.delivery_compatibility', wraps=delivery_compatibility) as verify:
            started = self.request('/api/runner-management/runtime-configurations/' + current['runtimeId'] + '/start', {'revision': current['revision']})
        self.assertTrue(started['assignment']['enabled'])
        self.assertTrue(verify.called)

    def test_git_browser_reads_pinned_files_not_worktree_and_rejects_invalid_paths(self):
        _, _, mapped, _ = self.directory_fixture()
        node = mapped['nodes'][0]
        repo = next(row for row in self.request('/api/runner-management/settings/code-repos') if row['repoId'] == node['repoId'])
        path = Path(repo['path']) / 'processor/main.py'
        original = path.read_text()
        path.write_text('unsaved-local-content\n', encoding='utf8')
        route = '/api/runner-management/settings/code-repos/' + node['repoId'] + '/browse?'
        listing = self.request(route + urlencode({'commit': node['gitCommit'], 'path': 'processor'}))
        self.assertEqual([item['name'] for item in listing['items']], ['main.py'])
        content = self.request(route + urlencode({'commit': node['gitCommit'], 'path': 'processor/main.py', 'action': 'read'}))
        self.assertEqual(content['content'], original)
        self.assertEqual(path.read_text(), 'unsaved-local-content\n')
        for bad in ('../identity.json', '/etc/passwd', 'processor/.git/config'):
            with self.assertRaises(HTTPError) as error:
                self.request(route + urlencode({'commit': node['gitCommit'], 'path': bad}))
            self.assertEqual(error.exception.code, 422)
        with self.assertRaises(HTTPError) as missing:
            self.request(route + urlencode({'commit': '0' * 40, 'path': 'processor'}))
        self.assertEqual(missing.exception.code, 404)

    def test_process_listing_reads_reported_workers_without_packages_or_log_snapshots(self):
        _, _, runner, runtime, _ = self.configured_runtime_fixture()
        self.runner = runner
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET worker_processes=? WHERE runner_id=?', (json.dumps([
                {'assignmentId': runtime['assignmentId'], 'slot': 0, 'pid': 12345, 'queue': 'news_list',
                 'entry': 'configured/news/main.py', 'workingDirectory': 'configured'}]), runtime['runnerId']))
        with patch.object(self.app.artifacts, 'read', side_effect=AssertionError('must not open packages')), \
                patch.object(self.app, 'git', side_effect=AssertionError('must not read Git')), \
                patch('backend.runner_management.runtime_history.snapshot', side_effect=AssertionError('must not rebuild log snapshot')):
            result = self.request('/api/runner-management/processes')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['pid'], 12345)
        self.assertEqual(result['items'][0]['runtimeId'], runtime['runtimeId'])


if __name__ == '__main__':
    unittest.main()
