import unittest
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.parse import quote
from backend.tests import test_runner_management as baseline


class NodeDeploymentContractTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request
    route = '/api/runner-management/deployment-configurations/from-node'
    source = {'flowId': '123', 'flowName': '新闻流程', 'stepId': '456', 'nodeName': '列表抓取', 'configId': '1401081'}

    def sync(self, **patch):
        return self.request(self.route, {'sourceNode': self.source, 'queueName': 'news_list', **patch})

    def code(self, body='def scrape(url):\n    return []\n'):
        return self.request('/api/runner-management/site-scripts/publish', {
            'configId': '1401081', 'queueName': 'news_list', 'fileNameMode': 'website',
            'fileName': 'example.com.py', 'code': body, 'prompt': '抓取新闻', 'url': 'https://example.com/list'})

    def test_empty_saved_node_creates_once_and_isolated_by_flow_and_step(self):
        first = self.sync()
        self.assertEqual(first, self.sync())
        self.assertEqual(first['sourceNode'], self.source)
        self.assertEqual(first['directoryTemplate'], '{configId}')
        self.assertEqual(first['nodes'], [])
        other_flow = self.sync(sourceNode={**self.source, 'flowId': '124'})
        other_step = self.sync(sourceNode={**self.source, 'stepId': '457'})
        self.assertEqual(len({first['deploymentId'], other_flow['deploymentId'], other_step['deploymentId']}), 3)
        with self.app.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) AS n FROM settings WHERE setting_key LIKE 'deployment-config:%'").fetchone()['n'], 3)
            self.assertEqual(db.execute('SELECT COUNT(*) AS n FROM assignments').fetchone()['n'], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) AS n FROM directory_deliveries').fetchone()['n'], 0)

    def test_concurrent_saves_resolve_to_one_configuration(self):
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: self.sync(), range(4)))
        self.assertEqual(len({item['deploymentId'] for item in results}), 1)
        self.assertEqual(len({item['revision'] for item in results}), 1)

    def test_origin_lookup_does_not_change_revision_or_persist_derived_links(self):
        first = self.sync()
        with self.app.store.connect() as db:
            db.execute('CREATE TABLE cs_flow (FLOW_ID INTEGER,FLOW_NAME TEXT,IS_DELETE INTEGER)')
            db.execute('CREATE TABLE cs_item_config (ITEM_CONFIG INTEGER,NAME TEXT,CONFIG_ID INTEGER,FLOW_ID INTEGER,IS_DELETE INTEGER)')
            db.execute("INSERT INTO cs_flow VALUES (123,'新闻流程',0)")
            db.execute("INSERT INTO cs_item_config VALUES (456,'列表抓取',1401081,123,0)")
        route = '/api/runner-management/deployment-configurations/' + first['deploymentId']
        detail = self.request(route)
        self.assertEqual(detail['revision'], first['revision'])
        self.assertEqual(detail['relatedSourceNodes'][0]['stepId'], '456')
        listed = self.request('/api/runner-management/deployment-configurations?keyword=' + quote('新闻流程'))
        self.assertEqual(listed[0]['deploymentId'], first['deploymentId'])
        saved = self.request(route, {**detail, 'name': '改名'})
        self.assertNotIn('relatedSourceNodes', saved)
        self.assertEqual(saved['sourceNode'], first['sourceNode'])

    def test_code_is_added_and_updates_only_its_commit_preserving_custom_layout(self):
        first = self.sync()
        code = self.code()
        linked = self.sync(scriptDigest=code['scriptDigest'])
        self.assertEqual(linked['deploymentId'], first['deploymentId'])
        self.assertEqual(linked['codeId'], code['codeId'])
        self.assertTrue(any(node.get('sourcePath') == code['storagePath'] for node in linked['nodes']))
        self.assertEqual(linked['entryPoint'], '')
        file = next(node for node in linked['nodes'] if node['kind'] == 'file')
        file['name'] = 'custom.py'
        edited = self.request('/api/runner-management/deployment-configurations/' + linked['deploymentId'], {
            **linked, 'name': '我的部署', 'pathStyle': 'custom', 'directoryTemplate': 'custom-root',
            'entryPoint': 'custom.py', 'nodes': [file, {'id': 'extra', 'parentId': '', 'name': 'shared', 'kind': 'folder'}]})
        updated_code = self.code('def scrape(url):\n    return [{"title": "new"}]\n')
        changed = self.sync(scriptDigest=updated_code['scriptDigest'])
        self.assertEqual(changed['name'], '我的部署')
        self.assertEqual(changed['directoryTemplate'], edited['directoryTemplate'])
        self.assertEqual(changed['entryPoint'], 'custom.py')
        self.assertEqual(changed['nodes'][1], edited['nodes'][1])
        self.assertEqual(changed['nodes'][0]['gitCommit'], updated_code['gitCommit'])
        self.assertEqual(changed, self.sync(scriptDigest=updated_code['scriptDigest']))

    def test_manual_source_deployment_is_reused_and_bad_code_does_not_modify_it(self):
        existing = self.request('/api/runner-management/deployment-configurations', {
            'name': '手工部署', 'sourceNode': self.source, 'pathStyle': 'config', 'configId': '1401081',
            'queueName': 'news_list', 'directoryTemplate': '{configId}/prod', 'entryPoint': '', 'nodes': []})
        self.assertEqual(self.sync()['deploymentId'], existing['deploymentId'])
        with self.assertRaises(HTTPError):
            self.sync(scriptDigest='sha256:missing')
        self.assertEqual(self.request('/api/runner-management/deployment-configurations/' + existing['deploymentId']), existing)


if __name__ == '__main__':
    unittest.main()
