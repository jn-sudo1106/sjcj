import copy
import json
import unittest
from unittest.mock import patch

from backend.tests import test_deployment_resources as fixtures
from backend.runner_management import deployment_resources as resources


class DeploymentSourceIdentityTest(unittest.TestCase):
    setUp = fixtures.DeploymentResourcesTest.setUp
    tearDown = fixtures.DeploymentResourcesTest.tearDown
    request = fixtures.DeploymentResourcesTest.request
    fixture = fixtures.DeploymentResourcesTest.fixture
    archive = fixtures.DeploymentResourcesTest.archive
    save_rules = fixtures.DeploymentResourcesTest.save_rules
    jobs = fixtures.DeploymentResourcesTest.jobs
    route = fixtures.DeploymentResourcesTest.route

    def test_shared_config_keeps_the_source_of_its_creating_delivery(self):
        self.fixture(); self.archive(); self.save_rules(self.runner)
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        first = self.jobs()[0]
        with self.app.store.connect() as db:
            original = json.loads(db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (first['jobId'],)).fetchone()['payload'])
            archive = copy.deepcopy(original['archive'])
            archive.update(archiveId='another-source-archive', taskId='another-source-task')
            archive['sourceContext']['sourceId'] = '999999'
            later = resources.enqueue(db, archive, 'test')
            later.update(runnerId=first['runnerId'], deploymentId=first['deploymentId'], deliveryId=first['deliveryId'], status='success', createdAt='2030-01-01T00:00:00Z')
            resources.persist(db, later)
        with patch.object(self.app.artifacts, 'read', side_effect=AssertionError('read only')), patch.object(self.app, 'git', side_effect=AssertionError('read only')):
            rows = self.request('/api/runner-management/runtime-configurations')
        row = next(item for item in rows if item['runtimeId'] == first['runtimeId'])
        self.assertEqual(row['sourceContext']['sourceId'], first['sourceId'])
        self.assertEqual(row['sourceContext']['deploymentJobId'], first['jobId'])
        self.assertNotEqual(row['sourceContext']['sourceId'], later['sourceId'])


if __name__ == '__main__':
    unittest.main()
