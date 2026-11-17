import base64
import json
from pathlib import Path
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from unittest.mock import patch
from backend.tests import test_deployment_resources as fixtures
from backend.runner_management import deployment_resources as resources


class NodeDeploymentSettingsTest(unittest.TestCase):
    setUp = fixtures.DeploymentResourcesTest.setUp
    tearDown = fixtures.DeploymentResourcesTest.tearDown
    request = fixtures.DeploymentResourcesTest.request
    fixture = fixtures.DeploymentResourcesTest.fixture
    archive = fixtures.DeploymentResourcesTest.archive
    pool = fixtures.DeploymentResourcesTest.pool
    jobs = fixtures.DeploymentResourcesTest.jobs
    context = fixtures.DeploymentResourcesTest.context
    choice = fixtures.DeploymentResourcesTest.choice
    route = fixtures.DeploymentResourcesTest.route

    def test_trailing_directory_separator_is_normalized_before_validation(self):
        self.prepare()
        saved = self.settings({'repositoryId': self.repo['repoId'], 'sourceDirectory': 'default/1401218/',
                               'deploymentDirectory': 'apps/news/'})
        self.assertEqual(saved['deploymentSettings']['sourceDirectory'], 'default/1401218')
        self.assertEqual(saved['deploymentSettings']['deploymentDirectory'], 'apps/news')
        self.assertEqual(saved['targetPath'], 'apps/news')

    def test_generated_site_files_keep_configuration_root_and_manual_source_remains_explicit(self):
        from backend.runner_management.deployment_mapping import mapping
        archive = {'configId': '1401218', 'directoryPath': 'links/1401218/sites', 'repositoryPrefix': ''}
        runner = {'install_directory': 'D:/Runner/instance'}
        self.assertEqual(mapping({}, archive, runner)['targetPath'], 'links/1401218')
        self.assertEqual(mapping({}, archive, runner)['sourceBase'], 'links/1401218')
        manual = {**archive, 'deploymentSettings': {'repositoryId': 'custom'}}
        self.assertEqual(mapping({}, manual, runner)['targetPath'], 'links/1401218/sites')

    def test_preview_uses_unsaved_directories_without_fetching_or_saving(self):
        self.prepare()
        saved = self.settings({}, ids=['1' * 32, '2' * 32])
        query = {**self.context(), 'preview': '1', 'repositoryId': self.repo['repoId'],
                 'sourceDirectory': 'default/1401218/lib', 'deploymentDirectory': 'apps/preview'}
        with patch('backend.runner_management.node_deployment_settings.source_files') as fetch:
            result = self.request('/api/runner-management/node-deployment-resource?' + urlencode(query))
        fetch.assert_not_called()
        self.assertEqual(len(result['targets']), 2)
        self.assertTrue(all(target['targetPath'] == 'apps/preview' for target in result['targets']))
        self.assertTrue(all(target['deploymentDirectory'].replace('\\', '/').endswith('/apps/preview') for target in result['targets']))
        self.assertEqual(self.choice(), saved)

    def settings(self, options, ids=None, **changes):
        current = self.choice(**changes)
        return self.request('/api/runner-management/node-deployment-resource', {
            **self.context(**changes), 'revision': current['revision'], 'resourceIds': ids if ids is not None else ['1' * 32],
            'useDefault': False, 'deploymentSettings': options})

    def prepare(self):
        other = self.fixture(); self.pool(other)
        self.settings({}, ids=[])
        return self.archive()

    def test_source_and_destination_are_saved_scoped_and_pinned_for_actual_delivery(self):
        archive = self.prepare()
        options = {'repositoryId': self.repo['repoId'], 'sourceDirectory': 'default/1401218/lib', 'deploymentDirectory': 'apps/news'}
        saved = self.settings(options)
        self.assertEqual(saved['deploymentSettings'], options)
        self.assertEqual(saved['targetPath'], 'apps/news')
        self.assertEqual(self.choice()['deploymentSettings'], options)
        self.assertNotIn('deploymentSettings', self.choice(environment='production'))
        self.assertNotIn('deploymentSettings', self.choice(sourceId='430024911'))
        body = {**self.context(), 'archiveId': archive['archiveId'], 'resourceIds': ['1' * 32], 'targetRevision': saved['revision']}
        job = self.request('/api/runner-management/deployment-jobs', body)
        self.assertEqual(job['gitDirectory'], 'default/1401218/lib')
        self.assertEqual(job['gitCommit'], archive['gitCommit'])
        self.settings({**options, 'sourceDirectory': 'default/1401218', 'deploymentDirectory': 'apps/next'})
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        completed = next(item for item in self.jobs() if item['jobId'] == job['jobId'])
        self.assertEqual(completed['status'], 'success', completed)
        self.assertEqual((self.runner.directory / 'apps/news/helper.py').read_bytes(), b'HELPER = True\n')
        self.assertFalse((self.runner.directory / 'apps/news/main.py').exists())
        self.assertFalse((self.runner.directory / 'apps/next').exists())
        with self.app.store.connect() as db:
            stored = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('generated-code-result:' + archive['archiveId'],)).fetchone()['setting_value'])
        self.assertEqual(stored['directoryPath'], 'default')

    def test_auto_deployment_applies_saved_source_and_each_target_directory(self):
        self.prepare()
        self.settings({'repositoryId': self.repo['repoId'], 'sourceDirectory': 'default/1401218/lib', 'deploymentDirectory': 'apps/auto'}, ids=['1' * 32, '2' * 32])
        self.archive('next-generation')
        self.assertEqual(len(self.jobs()), 2)
        for _ in range(3):
            resources.dispatch(self.app); self.runner.deliver_pending(); self.other.deliver_pending()
        resources.dispatch(self.app)
        self.assertTrue(all(item['status'] == 'success' for item in self.jobs()), self.jobs())
        for runner in (self.runner, self.other):
            self.assertTrue((runner.directory / 'apps/auto/helper.py').is_file())
            self.assertFalse((runner.directory / 'apps/auto/main.py').exists())

    def test_rejects_invalid_source_and_destination_without_changing_saved_settings(self):
        self.prepare()
        for options in (
            {'repositoryId': self.repo['repoId'], 'sourceDirectory': '../outside'},
            {'repositoryId': self.repo['repoId'], 'sourceDirectory': 'missing'},
            {'repositoryId': self.repo['repoId'], 'sourceDirectory': 'default/1401218/main.py'},
            {'repositoryId': 'missing', 'sourceDirectory': 'default/1401218'},
            {'sourceDirectory': 'default/1401218'},
            {'deploymentDirectory': '../outside'},
            {'deploymentDirectory': '/outside/instance'},
            {'deploymentDirectory': 'versions/overwrite'},
        ):
            with self.subTest(options=options), self.assertRaises(HTTPError):
                self.settings(options)
            self.assertEqual(self.choice().get('deploymentSettings'), {'repositoryId': '', 'sourceDirectory': '', 'deploymentDirectory': ''})

    def test_resource_changes_preserve_settings_and_empty_targets_can_disable_auto_deployment(self):
        self.prepare()
        options = {'repositoryId': '', 'sourceDirectory': '', 'deploymentDirectory': 'apps/preserved'}
        self.settings(options)
        current = self.choice()
        result = self.request('/api/runner-management/node-deployment-resource', {
            **self.context(), 'revision': current['revision'], 'resourceIds': [], 'useDefault': False})
        self.assertEqual(result['deploymentSettings'], options)
        self.archive('disabled-generation')
        self.assertEqual(self.jobs(), [])

    def test_selected_git_repository_is_used_instead_of_generation_repository(self):
        archive = self.prepare()
        repo = self.request('/api/runner-management/settings/code-repos', {
            'name': '独立部署仓库', 'path': str(Path(self.tmp.name) / 'selected-repo'), 'remoteUrl': '', 'branch': 'main', 'configType': '90'})
        root = Path(repo['path']); root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        uploaded = self.app.upload_repository_files(repo['repoId'], {'folder': 'package', 'files': [
            {'name': 'main.py', 'data': base64.b64encode(b'SELECTED_REPO = True\n').decode()}]}, owner_config_id='1401218')
        saved = self.settings({'repositoryId': repo['repoId'], 'sourceDirectory': 'package', 'deploymentDirectory': 'apps/selected'})
        job = self.request('/api/runner-management/deployment-jobs', {
            **self.context(), 'archiveId': archive['archiveId'], 'resourceIds': ['1' * 32], 'targetRevision': saved['revision']})
        self.assertEqual(job['repositoryId'], repo['repoId'])
        self.assertEqual(job['gitCommit'], uploaded['gitCommit'])
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual((self.runner.directory / 'apps/selected/main.py').read_bytes(), b'SELECTED_REPO = True\n')

    def test_unavailable_deployment_source_does_not_lose_successful_generation_receipt(self):
        self.prepare()
        self.settings({'repositoryId': self.repo['repoId'], 'sourceDirectory': 'default/1401218/lib'})
        # Archive recording must survive a deployment configuration becoming unavailable.
        from backend.runner_management.server import ApiError
        with patch('backend.runner_management.node_deployment_settings.source_files', side_effect=ApiError('部署仓库暂不可用', 503)):
            record = self.archive('new-receipt')
        with self.app.store.connect() as db:
            receipt = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('generated-code-result:' + record['archiveId'],)).fetchone()
        self.assertIsNotNone(receipt)
        job = next(item for item in self.jobs() if item['taskId'] == 'new-receipt')
        self.assertEqual(job['status'], 'failed')
        self.assertIn('部署仓库暂不可用', job['message'])

