import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from unittest.mock import patch
from backend.tests.test_deployment_resources import DeploymentResourcesTest as Base
from backend.runner_management import deployment_resources as resources


class MultiTargetDeploymentTest(unittest.TestCase):
    setUp = Base.setUp
    tearDown = Base.tearDown
    request = Base.request
    fixture = Base.fixture
    archive = Base.archive
    pool = Base.pool
    jobs = Base.jobs
    context = Base.context
    choice = Base.choice
    act = Base.act
    route = Base.route

    def targets(self, ids, **changes):
        current = self.choice(**changes)
        return self.request('/api/runner-management/node-deployment-resource', {
            **self.context(**changes), 'revision': current['revision'], 'resourceIds': ids, 'useDefault': False})

    def setup_pool(self):
        other = self.fixture(); self.pool(other)

    def test_configuration_entry_is_reused_by_new_tasks_for_multiple_machines(self):
        import json
        self.setup_pool(); self.targets(['1' * 32, '2' * 32]); self.archive(); self.finish()
        initial = self.jobs()
        selected = self.request('/api/runner-management/deployment-configurations/' + initial[0]['deploymentId'])
        with self.app.store.connect() as db:
            receipts = {row['job_id']: row['payload'] for row in db.execute('SELECT job_id,payload FROM deployment_jobs')}
        self.request('/api/runner-management/deployment-configurations/' + selected['deploymentId'] + '/entry', {
            'entryPoint': 'main.py', 'revision': selected['revision']})
        preview = self.choice()
        self.assertEqual(preview['entryPoint'], 'main.py')
        with self.app.store.connect() as db:
            self.assertEqual(receipts, {row['job_id']: row['payload'] for row in db.execute('SELECT job_id,payload FROM deployment_jobs')})
        self.archive(identifier='next-version', content=b'VALUE = 2\n', created='2026-11-02T03:00:00Z')
        self.finish()
        jobs = [job for job in self.jobs() if job['archiveId'] == 'next-version']
        self.assertEqual(len(jobs), 2)
        self.assertEqual(len({job['jobId'] for job in jobs}), 2)
        self.assertEqual(len({job['runnerId'] for job in jobs}), 2)
        self.assertTrue(all(job['configurationId'] == selected['deploymentId'] and job['status'] == 'success' for job in jobs), jobs)
        for job in jobs:
            layout = self.request('/api/runner-management/deployment-configurations/' + job['deploymentId'])
            self.assertEqual(layout['entryPoint'], 'main.py')

    def finish(self):
        for _ in range(3):
            resources.dispatch(self.app); self.runner.deliver_pending(); self.other.deliver_pending()
        resources.dispatch(self.app)

    def test_two_machines_get_independent_jobs_and_both_install(self):
        self.setup_pool(); self.targets(['1' * 32, '2' * 32]); self.archive()
        jobs = self.jobs()
        self.assertEqual(len(jobs), 2)
        self.assertEqual(len({job['jobId'] for job in jobs}), 2)
        self.assertEqual({job['targetResourceId'] for job in jobs}, {self.runner.identity['runnerId'], self.other.identity['runnerId']})
        self.finish()
        jobs = self.jobs(); self.assertTrue(all(job['status'] == 'success' for job in jobs), jobs)
        self.assertEqual({job['runnerId'] for job in jobs}, {self.runner.identity['runnerId'], self.other.identity['runnerId']})
        self.assertEqual(len({job['runtimeId'] for job in jobs}), 2)
        for runner in (self.runner, self.other):
            self.assertEqual((runner.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')

    def test_first_generated_delivery_to_each_machine_only_installs_task_files(self):
        import base64
        import copy
        self.setup_pool(); self.targets([])
        original = self.archive()
        uploaded = self.app.upload_repository_files(self.repo['repoId'], {
            'folder': 'default/1401218/sites', 'files': [
                {'name': 'www.ceyear.com.py', 'data': base64.b64encode(b'def scrape(url): return []\n').decode()},
                {'name': 'unrelated.example.py', 'data': base64.b64encode(b'UNRELATED = True\n').decode()},
            ]}, owner_config_id='1401218')
        record = copy.deepcopy(original)
        record.update(archiveId='site-only', taskId='site-only', gitCommit=uploaded['gitCommit'],
                      repositoryPrefix='1401218/sites',
                      files=[item for item in uploaded['files'] if item['path'].endswith('/www.ceyear.com.py')])
        from backend.runner_management import generated_archives
        generated_archives.store(self.app, record)
        choice = self.targets(['1' * 32, '2' * 32])
        preview = self.request('/api/runner-management/node-deployment-resource?' + urlencode({
            **self.context(), 'archiveId': record['archiveId']}))
        self.assertEqual(preview['generatedFiles'], ['default/1401218/sites/www.ceyear.com.py'])
        self.request('/api/runner-management/deployment-jobs', {
            **self.context(), 'archiveId': record['archiveId'], 'resourceIds': ['1' * 32, '2' * 32], 'targetRevision': choice['revision']})
        self.finish()
        self.assertEqual(len(self.jobs()), 2)
        for job in self.jobs():
            self.assertEqual(job['status'], 'success', job)
            self.assertEqual(job['deploymentScope'], 'task-files')
            self.assertEqual(job['selectedPaths'], ['sites/www.ceyear.com.py'])
        for runner in (self.runner, self.other):
            root = runner.directory / 'test/default/1401218'
            self.assertEqual(sorted(str(path.relative_to(root)).replace('\\', '/') for path in root.rglob('*') if path.is_file() and path.name != 'version.json'),
                             ['sites/www.ceyear.com.py'])

    def test_one_machine_failure_does_not_change_sibling_and_retry_is_independent(self):
        self.setup_pool(); self.targets(['1' * 32, '2' * 32]); self.archive()
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        with patch('backend.runner_management.directory_download.install_delivery', side_effect=ValueError('target access denied')):
            self.other.deliver_pending()
        resources.dispatch(self.app)
        jobs = {('1' * 32 if job['targetResourceId'] == self.runner.identity['runnerId'] else '2' * 32): job for job in self.jobs()}
        self.assertEqual(jobs['1' * 32]['status'], 'success')
        self.assertEqual(jobs['2' * 32]['status'], 'failed')
        successful_id = jobs['1' * 32]['jobId']
        self.act(jobs['2' * 32], 'retry'); self.finish()
        jobs = self.jobs(); self.assertEqual(len(jobs), 2)
        self.assertTrue(all(job['status'] == 'success' for job in jobs), jobs)
        self.assertEqual(next(job for job in jobs if job['targetResourceId'] == self.runner.identity['runnerId'])['jobId'], successful_id)

    def test_new_generation_supersedes_only_previous_jobs_of_each_target(self):
        self.setup_pool(); self.targets(['1' * 32, '2' * 32])
        self.archive('old', created='2026-11-02T01:00:00Z')
        self.archive('new', content=b'VALUE = 2\n', created='2026-11-02T02:00:00Z')
        jobs = self.jobs()
        self.assertEqual(len(jobs), 4)
        self.assertTrue(all(job['status'] == 'superseded' for job in jobs if job['archiveId'] == 'old'))
        self.assertTrue(all(job['status'] == 'waiting_resource' for job in jobs if job['archiveId'] == 'new'))

    def test_no_selected_targets_disables_automatic_deployment(self):
        self.setup_pool(); choice = self.targets([])
        self.assertEqual(choice['effectiveResourceIds'], [])
        self.archive(); self.assertEqual(self.jobs(), [])

    def test_manual_multi_deploy_is_idempotent_and_validates_source_and_revision(self):
        self.setup_pool(); self.targets([]); archive = self.archive()
        choice = self.targets(['1' * 32, '2' * 32])
        body = {**self.context(), 'archiveId': archive['archiveId'], 'resourceIds': ['1' * 32, '2' * 32], 'targetRevision': choice['revision']}
        result = self.request('/api/runner-management/deployment-jobs', body)
        self.assertEqual(len(result['items']), 2)
        again = self.request('/api/runner-management/deployment-jobs', body)
        self.assertEqual({job['jobId'] for job in result['items']}, {job['jobId'] for job in again['items']})
        self.assertEqual(len(self.jobs()), 2)
        with self.assertRaises(HTTPError):
            self.request('/api/runner-management/deployment-jobs', {**body, 'sourceId': '430024911'})
        self.targets(['1' * 32])
        with self.assertRaises(HTTPError) as stale:
            self.request('/api/runner-management/deployment-jobs', body)
        self.assertEqual(stale.exception.code, 409)

    def test_foreign_environment_and_duplicate_targets_are_rejected(self):
        self.setup_pool()
        for ids in (['1' * 32, '1' * 32], ['3' * 32], ['4' * 32], ['missing']):
            with self.subTest(ids=ids), self.assertRaises(HTTPError): self.targets(ids)
        self.assertEqual(self.choice()['effectiveResourceIds'], [self.runner.identity['runnerId']])


del Base  # Do not discover the imported baseline test class a second time.
