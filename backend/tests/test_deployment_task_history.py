import json
import unittest
from unittest.mock import patch
from backend.tests import test_deployment_resources as fixtures
from backend.runner_management import deployment_resources as resources
from backend.runner_management.deployment_history import record


class DeploymentTaskHistoryTest(unittest.TestCase):
    setUp = fixtures.DeploymentResourcesTest.setUp
    tearDown = fixtures.DeploymentResourcesTest.tearDown
    request = fixtures.DeploymentResourcesTest.request
    fixture = fixtures.DeploymentResourcesTest.fixture
    archive = fixtures.DeploymentResourcesTest.archive
    save_rules = fixtures.DeploymentResourcesTest.save_rules
    jobs = fixtures.DeploymentResourcesTest.jobs
    route = fixtures.DeploymentResourcesTest.route

    def completed(self):
        self.fixture(); self.archive(); self.save_rules(self.runner)
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        # Runner event upload is asynchronous; historical-fixture edits must
        # happen after the real events have reached the service.
        if self.runner.logs.thread:
            self.runner.logs.thread.join(timeout=5)
        return self.jobs()[0]

    def test_completed_task_reads_saved_stages_without_reopening_git_or_artifacts(self):
        job = self.completed()
        self.assertEqual(job['status'], 'success')
        with self.app.store.connect() as db:
            from backend.runner_management.runtime_history import add_event
            add_event(db, job['deliveryId'], 'verify', '校验摘要和签名', detail='token=do-not-expose')
            before = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?", (job['jobId'],)).fetchone()['payload']
        with patch.object(self.app.artifacts, 'read', side_effect=AssertionError('must not verify again')), \
             patch.object(self.app, 'git', side_effect=AssertionError('must not read Git again')):
            first = self.request('/api/runner-management/deployment-jobs/' + job['jobId'])
            second = self.request('/api/runner-management/deployment-jobs/' + job['jobId'])
        self.assertEqual(first, second)
        stages = [event['stage'] for event in first['events']]
        for stage in ('created', 'resource', 'baseline', 'source', 'scope', 'package', 'packaged', 'verify', 'success'):
            self.assertIn(stage, stages)
        self.assertNotIn('do-not-expose', json.dumps(first))
        self.assertTrue(first['historyAvailable'])
        self.assertTrue(first['finishedAt'])
        self.assertNotIn('executionEvents', job)
        with self.app.store.connect() as db:
            after = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?", (job['jobId'],)).fetchone()['payload']
        self.assertEqual(before, after)

    def test_failed_transaction_keeps_the_real_stage_and_retry_keeps_prior_attempt(self):
        self.fixture(); self.archive(); self.save_rules(self.runner)
        def fail(app, db, job, rule, runner):
            record(job, 'source', '正在读取固定版本文件')
            raise RuntimeError('无法读取指定版本')
        with patch.object(resources, 'prepare', side_effect=fail):
            resources.dispatch(self.app)
        job = self.jobs()[0]
        detail = self.request('/api/runner-management/deployment-jobs/' + job['jobId'])
        self.assertEqual(detail['status'], 'failed')
        self.assertIn('source', [event['stage'] for event in detail['events']])
        self.assertIn('无法读取指定版本', detail['events'][-1]['message'])
        self.request('/api/runner-management/deployment-jobs/' + job['jobId'] + '/retry', {})
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        completed = self.request('/api/runner-management/deployment-jobs/' + job['jobId'])
        self.assertEqual(completed['status'], 'success')
        self.assertIn('retry', [event['stage'] for event in completed['events']])
        self.assertIn('无法读取指定版本', json.dumps(completed, ensure_ascii=False))

    def test_historical_tasks_do_not_invent_missing_verification_steps(self):
        job = self.completed()
        with self.app.store.connect() as db:
            payload = json.loads(db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?", (job['jobId'],)).fetchone()['payload'])
            payload.pop('executionEvents', None)
            db.execute("DELETE FROM logs WHERE log_type='event' AND record_id=?", (job['deliveryId'],))
            db.execute("DELETE FROM logs WHERE log_type='event' AND task_type='deployment' AND task_id=?", (job['jobId'],))
            db.execute("UPDATE jobs SET payload=? WHERE job_type='deployment' AND job_id=?", (json.dumps(payload), job['jobId']))
        result = self.request('/api/runner-management/deployment-jobs/' + job['jobId'])
        self.assertFalse(result['historyAvailable'])
        self.assertEqual([event['stage'] for event in result['events']], ['created', 'success'])
