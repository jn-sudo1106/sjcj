import json
import unittest
from pathlib import Path
from urllib.error import HTTPError

from backend.tests import test_runner_management as baseline


class RepositoryReferencesTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def fixture(self):
        route = '/api/runner-management'
        payload = {'configId': '101', 'queueName': 'download', 'codeType': 'default', 'code': 'def scrape(url):\n    return []\n'}
        first = self.request(route + '/site-scripts/publish', payload)
        second = self.request(route + '/site-scripts/publish', {**payload, 'code': 'def scrape(url):\n    return [1]\n'})
        with self.app.store.connect() as db:
            db.execute('UPDATE code_versions SET published_at=? WHERE digest=?', ('2020-01-01T00:00:00+00:00', first['scriptDigest']))
            db.execute('UPDATE code_versions SET published_at=? WHERE digest=?', ('2021-01-01T00:00:00+00:00', second['scriptDigest']))
        return route, first, second

    def query(self, repo_id, path):
        from urllib.parse import quote
        return self.request('/api/runner-management/settings/code-repos/' + repo_id + '/files/references?path=' + quote(path))

    def test_current_history_directory_mapping_and_all_flow_origins(self):
        route, first, second = self.fixture()
        repo = self.request(route + '/settings/code-repos')[0]
        path = second['storagePath']
        with self.app.store.connect() as db:
            db.execute('CREATE TABLE cs_flow (FLOW_ID TEXT,FLOW_NAME TEXT,IS_DELETE INTEGER)')
            db.execute('CREATE TABLE cs_item_config (CONFIG_ID TEXT,ITEM_CONFIG TEXT,NAME TEXT,FLOW_ID TEXT,IS_DELETE INTEGER)')
            for flow_id in ('1', '2'):
                db.execute('INSERT INTO cs_flow VALUES (?,?,0)', (flow_id, '下载流程' + flow_id))
                db.execute('INSERT INTO cs_item_config VALUES (?,?,?,?,0)', ('101', flow_id + '1', '下载节点', flow_id))
        deployment = self.request(route + '/deployment-configurations', {
            'name': '下载部署', 'directoryTemplate': 'download', 'pathStyle': 'custom', 'configId': '101',
            'sourceNode': {'configId': '101', 'flowId': '1', 'flowName': '下载流程1', 'stepId': '11', 'nodeName': '下载节点'},
            'nodes': [{'id': 'shared', 'parentId': '', 'name': 'app', 'kind': 'folder', 'repoId': repo['repoId'],
                       'sourcePath': path.rpartition('/')[0], 'sourceType': 'directory', 'gitCommit': second['gitCommit']}]})
        result = self.query(repo['repoId'], path)
        self.assertTrue(any('节点代码' in reason for reason in result['protectionReasons']))
        node = next(row for row in result['items'] if row['kind'] == 'node')
        self.assertEqual({row['flowId'] for row in node['sourceNodes']}, {'1', '2'})
        historical = next(row for row in result['items'] if row.get('digest') == first['scriptDigest'])
        self.assertEqual(historical['scope'], 'history')
        self.assertEqual(next(row for row in result['items'] if row.get('digest') == second['scriptDigest'])['scope'], 'current')
        mapped = next(row for row in result['items'] if row.get('deploymentId') == deployment['deploymentId'])
        self.assertEqual(mapped['targetPaths'], ['app/' + path.rsplit('/', 1)[-1]])
        self.assertEqual([node['flowId'] for node in mapped['sourceNodes']], ['1'])
        # Old snapshots may remain in use even when a later version exists.
        with self.app.store.connect() as db:
            db.execute('INSERT INTO code_runtime_bindings VALUES (?,?,?,?,?)', ('prd', '101', 'download', '', first['scriptDigest']))
        bound = next(row for row in self.query(repo['repoId'], path)['items'] if row.get('digest') == first['scriptDigest'])
        self.assertEqual(bound['scope'], 'current'); self.assertFalse(bound['isLatest'])
        self.assertEqual(bound['environments'], ['prd'])
        runner = baseline.Runner(Path(self.tmp.name) / 'reference-runner', self.url)
        runner.enroll()
        with self.app.store.connect() as db:
            db.execute('DELETE FROM code_runtime_bindings WHERE digest=?', (first['scriptDigest'],))
            db.execute('INSERT INTO assignments (assignment_id,runner_id,queue,processor_type,release_digest,concurrency,enabled,environment,code_id) VALUES (?,?,?,?,?,?,?,?,?)',
                       ('reference-assignment', runner.identity['runnerId'], 'download', 'custom', first['scriptDigest'], 1, 1, 'test', first['codeId']))
        machine_bound = next(row for row in self.query(repo['repoId'], path)['items'] if row.get('digest') == first['scriptDigest'])
        self.assertEqual(machine_bound['scope'], 'current')
        self.assertEqual(machine_bound['machineBindingCount'], 1)
        self.assertEqual(machine_bound['environments'], [])

    def test_repository_isolation_path_boundary_and_system_protection_reason(self):
        route, first, second = self.fixture()
        other = self.request(route + '/settings/code-repos', {'name': '其他仓库', 'path': str(Path(self.tmp.name) / 'other'), 'remoteUrl': '', 'branch': 'main'})
        self.assertEqual(self.query(other['repoId'], second['storagePath'])['items'], [])
        system = self.query(other['repoId'], 'code/unreferenced.py')
        self.assertEqual(system['protectionReasons'], [])
        self.assertEqual(system['items'], [])
        with self.assertRaises(HTTPError) as caught:
            self.query(first['repoId'], '../outside.py')
        self.assertEqual(caught.exception.code, 400)
        from backend.runner_management.repository_references import mapped_paths
        layout = {'nodes': [{'id': 'dir', 'parentId': '', 'name': 'app', 'repoId': other['repoId'], 'sourcePath': 'shared', 'sourceType': 'directory'}]}
        self.assertEqual(mapped_paths(layout, other['repoId'], 'shared/a.py'), ['app/a.py'])
        self.assertEqual(mapped_paths(layout, other['repoId'], 'shared-other/a.py'), [])
