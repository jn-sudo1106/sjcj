import json
from pathlib import Path
import unittest
from unittest.mock import patch

from backend.tests import test_runner_management as fixtures
from backend.runner_management.runner import Runner


class ConfigurationEntryTest(unittest.TestCase):
    request = fixtures.ManagementIntegrationTest.request
    directory_fixture = fixtures.ManagementIntegrationTest.directory_fixture
    deliver_runtime_fixture = fixtures.ManagementIntegrationTest.deliver_runtime_fixture

    def test_preview_uses_unique_configuration_default_on_another_machine_without_live_checks(self):
        from backend.runner_management.deployment_resources import configured_entry
        layout = {'deploymentId': 'default-config', 'configId': '1401218', 'nodes': [{'repoId': 'repo'}],
                  'entryPoint': 'bin/newslink.exe', 'pathStyle': 'custom', 'directoryTemplate': 'links/1401218', 'queueName': '', 'siteHost': ''}
        with self.app.store.connect() as db, patch('backend.runner_management.deployment_configuration.configurations', return_value={'one': layout}):
            self.assertEqual(configured_entry(self.app, db, '1401218', 'repo', 'links/1401218', 'new-runner', 'apps/news'),
                             {'entryPoint': 'bin/newslink.exe', 'entryConfigurationId': 'default-config'})
            self.assertEqual(configured_entry(self.app, db, 'different-config', 'repo', 'links/1401218', 'new-runner', 'apps/news')['entryPoint'], '')
        conflicting = {**layout, 'deploymentId': 'other', 'entryPoint': 'main.py'}
        with self.app.store.connect() as db, patch('backend.runner_management.deployment_configuration.configurations', return_value={'one': layout, 'two': conflicting}):
            self.assertEqual(configured_entry(self.app, db, '1401218', 'repo', 'links/1401218', 'new-runner', 'apps/news')['entryPoint'], '')
        shared = {**layout, 'entrySource': {'repoId': 'repo', 'path': 'links/1401218/bin/newslink.exe'}}
        with self.app.store.connect() as db, patch('backend.runner_management.deployment_configuration.configurations', return_value={'old-machine': conflicting, 'shared': shared}):
            self.assertEqual(configured_entry(self.app, db, '1401218', 'repo', 'links/1401218', 'new-runner', 'links/1401218'),
                             {'entryPoint': 'bin/newslink.exe', 'entryConfigurationId': 'default-config'})

    def setUp(self):
        fixtures.ManagementIntegrationTest.setUp(self)
        self.other = None

    def tearDown(self):
        if self.other:
            self.other.close()
        fixtures.ManagementIntegrationTest.tearDown(self)

    def shared_layouts(self):
        self.directory_fixture()
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repo['path'])
        for name in ('main.py', 'alternate.py'):
            (root / 'processor' / name).write_text('import time\nfrom pathlib import Path\nPath("started.txt").write_text("' + name + '")\nwhile True: time.sleep(.1)\n')
        self.app.git(root, 'add', '--', 'processor')
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'shared entry fixture')
        commit = self.app.git(root, 'rev-parse', 'HEAD').strip()
        def layout(name, folder):
            return self.request('/api/runner-management/deployment-configurations', {'name': name, 'configId': 'shared-entry',
                'pathStyle': 'custom', 'directoryTemplate': name, 'entryPoint': '', 'nodes': [
                    {'id': 'folder', 'parentId': '', 'kind': 'folder', 'name': folder, 'repoId': repo['repoId'],
                     'sourcePath': 'processor', 'sourceType': 'directory', 'gitCommit': commit}]})
        return layout('machine-one', 'app'), layout('machine-two', 'service')

    def test_one_configuration_choice_is_shared_and_each_machine_adopts_on_start(self):
        one, two = self.shared_layouts()
        self.runner = Runner(Path(self.tmp.name) / 'runner-one', self.url); self.runner.enroll()
        self.other = Runner(Path(self.tmp.name) / 'runner-two', self.url); self.other.enroll()
        runtimes = []
        for layout, runner in ((one, self.runner), (two, self.other)):
            self.request('/api/runner-management/runtime-configurations', {'deploymentId': layout['deploymentId'], 'layoutRevision': layout['revision'],
                'runnerId': runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1})
            runtimes.append(self.deliver_runtime_fixture(layout, runner))
        with self.app.store.connect() as db:
            before = [tuple(row) for row in db.execute('SELECT * FROM directory_deliveries ORDER BY delivery_id')]
        chosen = self.request('/api/runner-management/deployment-configurations/' + one['deploymentId'] + '/entry', {
            'entryPoint': 'app/alternate.py', 'revision': one['revision']})
        entries = {item['deploymentId']: item for item in chosen['items']}
        self.assertEqual(entries[one['deploymentId']]['entryPoint'], 'app/alternate.py')
        self.assertEqual(entries[two['deploymentId']]['entryPoint'], 'service/alternate.py')
        self.assertEqual(entries[two['deploymentId']]['entryConfigurationId'], one['deploymentId'])
        self.assertEqual(sum('entrySource' in item for item in chosen['items']), 1)
        with self.app.store.connect() as db:
            self.assertEqual(before, [tuple(row) for row in db.execute('SELECT * FROM directory_deliveries ORDER BY delivery_id')])
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM assignments').fetchone()['n'], 0)
        # Start adopts the same configuration entry on each machine, including
        # the second machine which never received a separate entry selection.
        rows = self.request('/api/runner-management/runtime-configurations')
        for old, runner, folder in ((runtimes[0], self.runner, 'machine-one'), (runtimes[1], self.other, 'machine-two')):
            row = next(item for item in rows if item['runtimeId'] == old['runtimeId'])
            self.request('/api/runner-management/runtime-configurations/' + row['runtimeId'] + '/start', {'revision': row['revision']})
            runner.tick()
            self.assertEqual(len(runner.processes), 1)
            self.assertEqual((runner.directory / folder / 'started.txt').read_text(), 'alternate.py')

    def test_future_deployment_definition_inherits_the_configured_entry(self):
        one, _ = self.shared_layouts()
        self.request('/api/runner-management/deployment-configurations/' + one['deploymentId'] + '/entry', {
            'entryPoint': 'app/alternate.py', 'revision': one['revision']})
        future = self.request('/api/runner-management/deployment-configurations', {**one, 'deploymentId': '', 'revision': '',
            'name': 'future-machine', 'entryPoint': '', 'nodes': [{**one['nodes'][0], 'name': 'future'}]})
        self.assertEqual(future['entryPoint'], 'future/alternate.py')
        self.assertEqual(future['entryConfigurationId'], one['deploymentId'])

    def test_entry_change_does_not_rewrite_an_adopted_running_program(self):
        one, _ = self.shared_layouts()
        one = self.request('/api/runner-management/deployment-configurations/' + one['deploymentId'], {**one, 'entryPoint': 'app/main.py'})
        self.runner = Runner(Path(self.tmp.name) / 'running-target', self.url); self.runner.enroll()
        runtime = self.request('/api/runner-management/runtime-configurations', {'deploymentId': one['deploymentId'],
            'layoutRevision': one['revision'], 'runnerId': self.runner.identity['runnerId'], 'concurrency': 1})
        with self.app.store.connect() as db:
            db.execute('UPDATE assignments SET enabled=1 WHERE assignment_id=?', (runtime['assignmentId'],))
            before = tuple(db.execute('SELECT * FROM assignments WHERE assignment_id=?', (runtime['assignmentId'],)).fetchone())
            document = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('runtime-config:' + runtime['runtimeId'],)).fetchone()['setting_value']
        self.request('/api/runner-management/deployment-configurations/' + one['deploymentId'] + '/entry', {
            'entryPoint': 'app/alternate.py', 'revision': one['revision']})
        with self.app.store.connect() as db:
            self.assertEqual(before, tuple(db.execute('SELECT * FROM assignments WHERE assignment_id=?', (runtime['assignmentId'],)).fetchone()))
            self.assertEqual(document, db.execute('SELECT setting_value FROM settings WHERE setting_key=?', ('runtime-config:' + runtime['runtimeId'],)).fetchone()['setting_value'])


if __name__ == '__main__':
    unittest.main()
