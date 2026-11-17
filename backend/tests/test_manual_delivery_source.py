import json
from pathlib import Path
import unittest
from urllib.error import HTTPError

from backend.tests import test_runner_management as fixtures
from backend.runner_management.runner import Runner
from backend.runner_management.directory_layout import revision, store_layout


class ManualDeliverySourceTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request
    directory_fixture = fixtures.ManagementIntegrationTest.directory_fixture

    def fixture(self, generated=False):
        self.directory_fixture()
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        self.root = Path(repo['path'])
        self.app.git(self.root, 'branch', '-M', repo['branch'])
        folder = self.root / 'manual-source'; folder.mkdir()
        for name in ('one.py', 'two.py'):
            (folder / name).write_text('VALUE = 1\n')
        self.commit('Initial manual source')
        old = self.app.git(self.root, 'rev-parse', 'HEAD').strip()
        nodes = [{'id': 'root', 'parentId': '', 'kind': 'folder', 'name': 'app',
                  'repoId': repo['repoId'], 'sourcePath': 'manual-source', 'sourceType': 'directory', 'gitCommit': old}]
        if generated:
            from backend.runner_management.deployment_resources import layout_nodes
            nodes = layout_nodes({'repoId': repo['repoId'], 'directoryPath': 'manual-source', 'gitCommit': old,
                                  'files': [{'path': 'manual-source/one.py'}, {'path': 'manual-source/two.py'}]})
        layout = self.request('/api/runner-management/deployment-configurations', {
            'name': 'manual current Git', 'configId': 'manual-source', 'pathStyle': 'custom',
            'directoryTemplate': 'manual-target', 'entryPoint': '', 'nodes': nodes})
        if generated:
            layout['managedBy'] = 'generated-code'; layout['revision'] = revision(layout)
            with self.app.store.connect() as db: store_layout(db, 'deployment-config:' + layout['deploymentId'], layout)
        self.runner = Runner(Path(self.tmp.name) / 'manual-runner', self.url); self.runner.enroll()
        self.request('/api/runner-management/directory-bindings', {'bindingType': 'deployment', 'ownerId': layout['deploymentId'], 'runnerId': self.runner.identity['runnerId']})
        self.route = '/api/runner-management/directory-bindings/deployment/' + layout['deploymentId'] + '/' + self.runner.identity['runnerId']
        self.request(self.route + '/deliver', {'revision': layout['revision']}); self.runner.deliver_pending()
        return layout

    def commit(self, message):
        self.app.git(self.root, 'add', '--', 'manual-source')
        self.app.git(self.root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', message)

    def updated_source(self):
        (self.root / 'manual-source/one.py').write_text('VALUE = 2\n')
        (self.root / 'manual-source/new.py').write_text('NEW = True\n')
        self.commit('Current source changes')

    def test_current_git_preview_sees_modified_and_new_files_without_changing_saved_configuration(self):
        layout = self.fixture(generated=True); self.updated_source()
        with self.app.store.connect() as db:
            before = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('deployment-config:' + layout['deploymentId'],)).fetchone()['setting_value']
        pinned = self.request(self.route + '/delivery-preview')
        self.assertTrue(all(item['status'] == 'unchanged' for item in pinned['items']))
        preview = self.request(self.route + '/delivery-preview?source=current-git')
        changes = {item['path']: item['status'] for item in preview['items'] if item['status'] != 'unchanged'}
        self.assertEqual(changes, {'new.py': 'added', 'one.py': 'modified'})
        self.assertEqual(preview['gitSources'][0]['path'], 'manual-source')
        with self.app.store.connect() as db:
            after = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('deployment-config:' + layout['deploymentId'],)).fetchone()['setting_value']
        self.assertEqual(after, before)
        self.assertEqual((self.runner.directory / 'manual-target/one.py').read_text(), 'VALUE = 1\n')

    def test_partial_delivery_keeps_unselected_file_origins_and_current_preview_still_shows_their_changes(self):
        layout = self.fixture(); self.updated_source()
        preview = self.request(self.route + '/delivery-preview?source=current-git')
        job = self.request(self.route + '/deliver', {'revision': preview['revision'], 'sourceMode': 'current-git',
            'sourceRevision': preview['sourceRevision'], 'baselineDigest': preview['baselineDigest'], 'scope': 'selected', 'paths': ['app/new.py']})
        self.runner.deliver_pending()
        target = self.runner.directory / 'manual-target'
        self.assertEqual((target / 'app/new.py').read_text(), 'NEW = True\n')
        self.assertEqual((target / 'app/one.py').read_text(), 'VALUE = 1\n')
        with self.app.store.connect() as db:
            saved = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('deployment-config:' + layout['deploymentId'],)).fetchone()['setting_value'])
            status = db.execute('SELECT status FROM directory_deliveries WHERE delivery_id=?', (job['deliveryId'],)).fetchone()['status']
        self.assertEqual(status, 'success')
        origins = {node['sourcePath']: node['gitCommit'] for node in saved['nodes'] if node.get('repoId')}
        self.assertNotEqual(origins['manual-source/new.py'], origins['manual-source/one.py'])
        again = self.request(self.route + '/delivery-preview?source=current-git')
        self.assertEqual({item['path'] for item in again['items'] if item['status'] != 'unchanged'}, {'app/one.py'})

    def test_source_advance_after_preview_rejects_delivery_without_altering_configuration(self):
        layout = self.fixture(); self.updated_source()
        preview = self.request(self.route + '/delivery-preview?source=current-git')
        (self.root / 'manual-source/one.py').write_text('VALUE = 3\n'); self.commit('Concurrent source change')
        with self.assertRaises(HTTPError) as error:
            self.request(self.route + '/deliver', {'revision': preview['revision'], 'sourceMode': 'current-git',
                'sourceRevision': preview['sourceRevision'], 'baselineDigest': preview['baselineDigest'], 'scope': 'all'})
        self.assertEqual(error.exception.code, 409)
        self.assertIn('Git 目录已更新', error.exception.read().decode())
        with self.app.store.connect() as db:
            current = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('deployment-config:' + layout['deploymentId'],)).fetchone()['setting_value'])
        self.assertEqual(current['nodes'], layout['nodes'])

    def test_generated_full_delivery_uses_current_directory_and_removes_only_old_managed_files(self):
        self.fixture(generated=True); self.updated_source()
        (self.root / 'manual-source/two.py').unlink(); self.commit('Remove obsolete source')
        target = self.runner.directory / 'manual-target'
        (target / 'local-runtime.txt').write_text('keep runtime data')
        preview = self.request(self.route + '/delivery-preview?source=current-git')
        result = self.request(self.route + '/deliver', {'revision': preview['revision'], 'sourceMode': 'current-git',
            'sourceRevision': preview['sourceRevision'], 'baselineDigest': preview['baselineDigest'], 'scope': 'all'})
        self.runner.deliver_pending()
        with self.app.store.connect() as db:
            status = db.execute('SELECT status FROM directory_deliveries WHERE delivery_id=?', (result['deliveryId'],)).fetchone()['status']
        self.assertEqual(status, 'success')
        self.assertEqual((target / 'one.py').read_text(), 'VALUE = 2\n')
        self.assertTrue((target / 'new.py').is_file())
        self.assertFalse((target / 'two.py').exists())
        self.assertEqual((target / 'local-runtime.txt').read_text(), 'keep runtime data')


del fixtures
