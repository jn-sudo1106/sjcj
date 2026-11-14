import unittest
from urllib.error import HTTPError
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

    def finish(self):
        for _ in range(3):
            resources.dispatch(self.app); self.runner.deliver_pending(); self.other.deliver_pending()
        resources.dispatch(self.app)

    def test_two_machines_get_independent_jobs_and_both_install(self):
        self.setup_pool(); self.targets(['1' * 32, '2' * 32]); self.archive()
        jobs = self.jobs()
        self.assertEqual(len(jobs), 2)
        self.assertEqual(len({job['jobId'] for job in jobs}), 2)
        self.assertEqual({job['targetResourceId'] for job in jobs}, {'1' * 32, '2' * 32})
        self.finish()
        jobs = self.jobs(); self.assertTrue(all(job['status'] == 'success' for job in jobs), jobs)
        self.assertEqual({job['runnerId'] for job in jobs}, {self.runner.identity['runnerId'], self.other.identity['runnerId']})
        self.assertEqual(len({job['runtimeId'] for job in jobs}), 2)
        for runner in (self.runner, self.other):
            self.assertEqual((runner.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')

    def test_one_machine_failure_does_not_change_sibling_and_retry_is_independent(self):
        self.setup_pool(); self.targets(['1' * 32, '2' * 32]); self.archive()
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        with patch('backend.runner_management.directory_download.install_delivery', side_effect=ValueError('target access denied')):
            self.other.deliver_pending()
        resources.dispatch(self.app)
        jobs = {job['targetResourceId']: job for job in self.jobs()}
        self.assertEqual(jobs['1' * 32]['status'], 'success')
        self.assertEqual(jobs['2' * 32]['status'], 'failed')
        successful_id = jobs['1' * 32]['jobId']
        self.act(jobs['2' * 32], 'retry'); self.finish()
        jobs = self.jobs(); self.assertEqual(len(jobs), 2)
        self.assertTrue(all(job['status'] == 'success' for job in jobs), jobs)
        self.assertEqual(next(job for job in jobs if job['targetResourceId'] == '1' * 32)['jobId'], successful_id)

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
        self.assertEqual(self.choice()['effectiveResourceIds'], ['1' * 32])


del Base  # Do not discover the imported baseline test class a second time.
