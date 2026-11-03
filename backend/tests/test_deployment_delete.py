import json
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend.tests import test_node_deployment as node_fixture
from backend.runner_management import deployment_configuration as deployments
from backend.runner_management.directory_bindings import owner_key
from backend.runner_management.runner import Runner
from backend.runner_management.server import now


class DeploymentDeleteTest(unittest.TestCase):
    setUp = node_fixture.NodeDeploymentContractTest.setUp
    tearDown = node_fixture.NodeDeploymentContractTest.tearDown
    request = node_fixture.NodeDeploymentContractTest.request
    sync = node_fixture.NodeDeploymentContractTest.sync
    code = node_fixture.NodeDeploymentContractTest.code
    source = node_fixture.NodeDeploymentContractTest.source
    route = node_fixture.NodeDeploymentContractTest.route

    def delete(self, item, revision=None):
        url = self.url + '/api/runner-management/deployment-configurations/' + item['deploymentId']
        url += '?revision=' + quote(item['revision'] if revision is None else revision, safe='')
        with urlopen(Request(url, method='DELETE'), timeout=5) as response:
            return json.load(response)

    def test_delete_unbound_configuration_and_preserve_other_configuration(self):
        first = self.sync()
        other = self.sync(sourceNode={**self.source, 'stepId': '789'})
        self.assertEqual(self.delete(first), {'ok': True})
        ids = {row['deploymentId'] for row in self.request('/api/runner-management/deployment-configurations')}
        self.assertNotIn(first['deploymentId'], ids)
        self.assertIn(other['deploymentId'], ids)
        with self.assertRaises(HTTPError) as missing:
            self.request('/api/runner-management/deployment-configurations/' + first['deploymentId'])
        self.assertEqual(missing.exception.code, 404)

    def test_stale_revision_and_saved_runtime_binding_reject_deletion(self):
        item = self.sync()
        with self.assertRaises(HTTPError) as stale:
            self.delete(item, 'old')
        self.assertEqual(stale.exception.code, 409)
        with self.app.store.connect() as db:
            db.execute('INSERT INTO settings VALUES (?,?)', ('runtime-config:binding-1', json.dumps({'deploymentId': item['deploymentId']})))
        with self.assertRaises(HTTPError) as bound:
            self.delete(item)
        self.assertEqual(bound.exception.code, 409)
        self.assertIn('已绑定机器', json.load(bound.exception)['message'])
        with self.app.store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT 1 FROM settings WHERE setting_key=?', ('deployment-config:' + item['deploymentId'],)).fetchone())

    def test_legacy_projection_stays_deleted_without_removing_code_or_old_layout(self):
        code = self.code()
        identifier = deployments.legacy_id('config', self.source['configId'])
        item = self.request('/api/runner-management/deployment-configurations/' + identifier)
        self.delete(item)
        for _ in range(2):
            self.assertNotIn(identifier, {row['deploymentId'] for row in self.request('/api/runner-management/deployment-configurations')})
        with self.app.store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT 1 FROM code_assets WHERE code_id=?', (code['codeId'],)).fetchone())
            self.assertIsNotNone(db.execute('SELECT 1 FROM code_versions WHERE digest=?', (code['scriptDigest'],)).fetchone())
        self.assertTrue(self.request('/api/runner-management/directory-layouts/configs/' + self.source['configId'])['nodes'])

    def test_pending_delivery_blocks_delete_but_completed_history_does_not(self):
        item = self.sync()
        self.runner = Runner(Path(self.tmp.name) / 'instance', self.url)
        self.runner.enroll()
        with self.app.store.connect() as db:
            db.execute('INSERT INTO directory_deliveries '
                       '(delivery_id,binding_type,owner_key,owner_id,runner_id,layout_revision,artifact_digest,signature,target_path,status,requested_at) '
                       'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                       ('delivery-1', 'deployment', owner_key(item['deploymentId']), item['deploymentId'], self.runner.identity['runnerId'],
                        item['revision'], 'sha256:history', 'signature', '1401081', 'pending', now()))
        with self.assertRaises(HTTPError) as pending:
            self.delete(item)
        self.assertEqual(pending.exception.code, 409)
        with self.app.store.connect() as db:
            db.execute("UPDATE directory_deliveries SET status='success' WHERE delivery_id='delivery-1'")
        self.delete(item)
        with self.app.store.connect() as db:
            self.assertIsNotNone(db.execute("SELECT 1 FROM directory_deliveries WHERE delivery_id='delivery-1'").fetchone())


if __name__ == '__main__': unittest.main()
