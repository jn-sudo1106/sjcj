import unittest
from pathlib import Path
from urllib.error import HTTPError
from backend.tests import test_generated_archives as fixtures
from backend.runner_management import generation_tasks


class GenerationDestinationsTest(unittest.TestCase):
    setUp = fixtures.GeneratedArchivesTest.setUp
    tearDown = fixtures.GeneratedArchivesTest.tearDown
    request = fixtures.GeneratedArchivesTest.request
    start_remote = fixtures.GeneratedArchivesTest.start_remote
    fixture = fixtures.GeneratedArchivesTest.fixture

    def configured(self):
        service, repo, origin, body, calls = self.fixture()
        with self.app.store.connect() as db:
            db.execute('CREATE TABLE cs_config (CONFIG_ID TEXT PRIMARY KEY,CONFIG_TYPE TEXT,TOPIC TEXT)')
            db.execute('INSERT INTO cs_config VALUES (?,?,?)', ('101', '90', 'news_list'))
        folder = self.request('/api/runner-management/settings/code-repos/' + repo['repoId'] + '/directories', {
            'name': '网页抓取', 'configType': '90', 'configTypeName': '网页抓取', 'path': 'links'})
        body.update(configType='90', queueName='news_list')
        return service, repo, origin, body, calls, folder

    def test_id_and_mq_default_to_links_for_both_local_directory_rules(self):
        service, repo, origin, body, calls, folder = self.configured()
        for query in ('configId=101', 'queueName=news_list'):
            target = self.request('/api/runner-management/site-scripts/generation-destination?' + query)
            self.assertEqual((target['configType'], target['directoryPath']), ('90', 'links'))
        for index, mode in enumerate(('config', 'queue')):
            result = self.request('/api/runner-management/model-interfaces/generate', {
                **body, 'destinationMode': 'type', 'configType': '', 'workspaceMode': mode, 'taskId': 'auto-' + mode})
            self.assertEqual(result['archive']['directoryPath'], 'links')
            self.assertTrue(result['archive']['pushed'])
            owner = '101' if mode == 'config' else 'news_list'
            self.assertEqual(Path(calls[-1]['code_dir']), service.workspace.root / owner / 'code')
            self.assertEqual(self.app.git(origin, 'show', 'main:links/101/newslink.py').strip(), 'VALUE = ' + str(index + 1))
        names = self.app.git(origin, 'ls-tree', '-r', '--name-only', 'main').splitlines()
        self.assertIn('links/101/lib/helper.py', names)
        self.assertFalse(any('/code/' in name or '/news_list/' in name for name in names))

    def test_custom_selection_persists_and_overrides_type_and_folder_default(self):
        service, repo, origin, body, calls, folder = self.configured()
        other_origin = Path(self.tmp.name) / 'other-origin'; other_origin.mkdir()
        self.app.git(other_origin, 'init', '--bare')
        other = self.app.create_repository({'name': '手工目标仓库', 'path': str(Path(self.tmp.name) / 'other-repo'),
                                            'remoteUrl': other_origin.as_uri(), 'branch': 'main'})
        self.request('/api/runner-management/code-servers/' + service.identity['serverId'] + '/generation-git-binding', {
            'path': '', 'repositoryId': repo['repoId'], 'directoryId': folder['directoryId']})
        result = self.request('/api/runner-management/model-interfaces/generate', {
            **body, 'destinationMode': 'custom', 'repositoryId': other['repoId'], 'directoryId': 'default', 'taskId': 'custom-target'})
        self.assertEqual(result['archive']['repoId'], other['repoId'])
        self.assertEqual(result['archive']['directoryPath'], 'default')
        self.assertEqual(self.app.git(other_origin, 'show', 'main:default/101/newslink.py').strip(), 'VALUE = 1')
        saved = generation_tasks.save_config(self.app, {'configId': '101', 'generation': {
            'interfaceId': body['interfaceId'], 'repositoryId': other['repoId'], 'directoryId': 'default', 'destinationMode': 'custom',
            'configType': '90', 'queueName': 'news_list', 'systemPrompt': '系统', 'userPrompt': '用户', 'fileNameMode': 'queue'}})
        self.assertEqual(saved['generation']['destinationMode'], 'custom')

    def test_ambiguous_mq_is_rejected_but_exact_config_id_is_resolved(self):
        self.configured()
        with self.app.store.connect() as db: db.execute('INSERT INTO cs_config VALUES (?,?,?)', ('202', '95', 'news_list'))
        for query in ('queueName=news_list', 'configId=101&configType=95'):
            with self.assertRaises(HTTPError) as error: self.request('/api/runner-management/site-scripts/generation-destination?' + query)
            self.assertEqual(error.exception.code, 409)
        self.assertEqual(self.request('/api/runner-management/site-scripts/generation-destination?configId=101')['directoryPath'], 'links')

    def test_legacy_publish_uses_type_directory_and_replaces_old_code_save_rule(self):
        _, repo, _, _, _, folder = self.configured()
        route = '/api/runner-management/site-scripts/publish'
        payload = {'configId': '101', 'queueName': 'news_list', 'codeType': 'default',
                   'code': 'def scrape(url):\n    return []\n'}
        first = self.request(route, payload)
        self.assertEqual(first['storagePath'], 'links/101/' + first['codeId'] + '.py')
        self.assertEqual(first['directoryId'], folder['directoryId'])
        # Simulate an asset saved before managed directories existed. Its old
        # immutable version remains readable when the next save changes location.
        old_path = 'code/101/' + first['codeId'] + '.py'
        with self.app.store.connect() as db:
            db.execute('UPDATE code_assets SET storage_path=?,directory_id=? WHERE code_id=?',
                       (old_path, '', first['codeId']))
        updated = self.request(route, {**payload, 'code': 'def scrape(url):\n    return [1]\n'})
        self.assertEqual(updated['codeId'], first['codeId'])
        self.assertEqual(updated['storagePath'], first['storagePath'])
        self.assertEqual(updated['directoryId'], folder['directoryId'])
        self.assertFalse(updated['storagePath'].startswith('code/'))

    def test_type_default_directory_is_explicit_and_manual_save_keeps_config_id(self):
        service, repo, origin, body, calls, folder = self.configured()
        route = '/api/runner-management/settings/code-repos/' + repo['repoId'] + '/directories'
        self.request(route, {'name': '其他网页目录', 'configType': '90', 'configTypeName': '网页抓取', 'path': 'aaa-web'})
        self.request(route + '/' + folder['directoryId'] + '/generation-default', {})
        target = self.request('/api/runner-management/site-scripts/generation-destination?configId=101')
        self.assertEqual(target['directoryPath'], 'links')
        self.assertTrue(next(item for item in self.request(route) if item['directoryId'] == folder['directoryId'])['generationDefault'])
        saved = self.request('/api/runner-management/site-scripts/publish', {'configId': '101', 'queueName': 'news_list',
            'codeType': 'default', 'fileNameMode': 'queue', 'fileName': 'news_list.py', 'code': 'def scrape(url):\n    return []\n',
            'repositoryId': repo['repoId'], 'directoryId': folder['directoryId'], 'includeConfigId': True, 'configType': '90'})
        self.assertEqual(saved['storagePath'], 'links/101/news_list.py')
