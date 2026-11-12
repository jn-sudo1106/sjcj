import base64
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.tests import test_runner_management as baseline
from backend.runner_management.server import ApiError


class ScriptFileLinksTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request
    route = '/api/runner-management'

    def fixture(self):
        self.request(self.route + '/site-scripts/publish', {'configId': 'bootstrap', 'queueName': 'bootstrap', 'codeType': 'default', 'code': 'def scrape(url):\n    return []\n'})
        repo = self.request(self.route + '/settings/code-repos')[0]
        source = 'def scrape(url):\n    return [url]\n'
        self.request(self.route + '/settings/code-repos/' + repo['repoId'] + '/files', {
            'overwrite': False, 'files': [{'name': 'source.py', 'data': base64.b64encode(source.encode()).decode()}]})
        snapshot = self.request(self.route + '/settings/code-repos/' + repo['repoId'] + '/files/content?path=default/source.py')
        payload = {'configId': '101', 'queueName': 'news', 'codeType': 'default', 'code': source,
                   'sourceFilePath': snapshot['path'], 'sourceGitCommit': snapshot['gitCommit']}
        version = self.request(self.route + '/site-scripts/publish', payload)
        return repo, version, payload, source

    def change(self, version, target='source', action='unlink', **extra):
        return self.request(self.route + '/site-scripts/file-association', {
            'digest': version['scriptDigest'], 'configId': '101', 'queueName': 'news', 'target': target, 'action': action, **extra})

    def test_preview_reads_pinned_source_even_when_head_file_was_deleted(self):
        repo, version, payload, source = self.fixture()
        self.change(version, action='delete')
        result = self.request(self.route + '/site-scripts/file-association/preview?digest=' + version['scriptDigest'] + '&target=source')
        self.assertEqual(result['content'], source)
        self.assertEqual(result['gitCommit'], version['sourceGitCommit'])
        self.assertEqual(result['path'], 'default/source.py')

    def test_unlink_source_is_persistent_and_does_not_rewrite_artifact_or_history(self):
        repo, version, payload, source = self.fixture()
        artifact = self.app.artifacts.read(version['scriptDigest'])
        self.change(version)
        listed = self.request(self.route + '/site-scripts/versions?configId=101&queueName=news')
        self.assertEqual(listed[0]['sourceRepoPath'], '')
        read = self.request(self.route + '/site-scripts/code?digest=' + version['scriptDigest'])
        self.assertEqual(read['sourceRepoPath'], '')
        self.assertEqual(read['code'], source)
        self.assertTrue((Path(repo['path']) / 'default/source.py').is_file())
        self.assertEqual(self.app.artifacts.read(version['scriptDigest']), artifact)
        with self.app.store.connect() as db:
            raw = db.execute('SELECT source_repo_path FROM code_versions WHERE digest=?', (version['scriptDigest'],)).fetchone()
            self.assertEqual(raw['source_repo_path'], 'default/source.py')

    def test_unlink_saved_file_removes_current_selection_and_republish_restores_it(self):
        repo, version, payload, source = self.fixture()
        self.change(version, 'saved')
        self.assertEqual(self.request(self.route + '/site-scripts/versions?configId=101&queueName=news'), [])
        self.assertTrue((Path(repo['path']) / version['storagePath']).is_file())
        self.assertEqual(self.request(self.route + '/site-scripts/code?digest=' + version['scriptDigest'])['code'], source)
        self.request(self.route + '/site-scripts/publish', payload)
        self.assertTrue(self.request(self.route + '/site-scripts/versions?configId=101&queueName=news'))

    def test_delete_source_commits_only_this_file_and_can_retry_when_already_absent(self):
        repo, version, payload, source = self.fixture()
        root = Path(repo['path'])
        (root / 'unrelated.txt').write_text('keep')
        result = self.change(version, action='delete')
        self.assertTrue(result['ok'])
        self.assertFalse((root / 'default/source.py').exists())
        self.assertTrue((root / version['storagePath']).exists())
        self.assertEqual((root / 'unrelated.txt').read_text(), 'keep')
        self.assertEqual(self.app.git(root, 'show', '--format=', '--name-only', 'HEAD').strip(), 'default/source.py')
        self.assertIn('已不在当前分支', self.change(version, action='delete')['message'])
        self.assertEqual(self.request(self.route + '/site-scripts/file-association/preview?digest=' + version['scriptDigest'] + '&target=source')['content'], source)

    def test_delete_saved_system_file_is_explicit_and_preserves_historical_code(self):
        repo, version, payload, source = self.fixture()
        self.change(version, 'saved', 'delete')
        self.assertFalse((Path(repo['path']) / version['storagePath']).exists())
        self.assertEqual(self.request(self.route + '/site-scripts/versions?configId=101&queueName=news'), [])
        self.assertEqual(self.request(self.route + '/site-scripts/code?digest=' + version['scriptDigest'])['code'], source)

    def test_newer_content_owner_mismatch_and_stale_version_are_rejected(self):
        repo, version, payload, source = self.fixture()
        with self.assertRaises(HTTPError) as wrong:
            self.change(version, configId='102')
        self.assertEqual(wrong.exception.code, 409)
        root = Path(repo['path'])
        (root / 'default/source.py').write_text('CHANGED = 1\n')
        self.app.git(root, 'add', '--', 'default/source.py')
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Update source')
        with self.assertRaises(HTTPError) as changed:
            self.change(version, action='delete')
        self.assertEqual(changed.exception.code, 409)
        newer = self.request(self.route + '/site-scripts/publish', {**payload, 'code': source + '\nCHANGED = 2\n'})
        with self.assertRaises(HTTPError) as stale:
            self.change(version)
        self.assertEqual(stale.exception.code, 409)
        self.assertNotEqual(newer['scriptDigest'], version['scriptDigest'])

    def test_association_write_requires_write_permission(self):
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('无写入权限', 403)) as auth:
            with self.assertRaises(HTTPError) as error:
                self.request(self.route + '/site-scripts/file-association', {})
            self.assertEqual(error.exception.code, 403)
            self.assertTrue(auth.call_args.kwargs['write'])

    def test_orchestration_save_does_not_automatically_adopt_detached_code(self):
        repo, version, payload, source = self.fixture()
        self.change(version, 'saved')
        deployment = self.request(self.route + '/deployment-configurations/from-node', {
            'sourceNode': {'configId': '101', 'flowId': '1', 'flowName': '流程', 'stepId': '11', 'nodeName': '抓取节点'},
            'queueName': 'news'})
        self.assertFalse(deployment.get('codeId'))
        self.assertFalse(deployment['nodes'])

    def test_shared_source_cannot_be_deleted_until_other_current_link_is_removed(self):
        repo, version, payload, source = self.fixture()
        other = self.request(self.route + '/site-scripts/publish', {**payload, 'configId': '102'})
        with self.assertRaises(HTTPError) as shared:
            self.change(version, action='delete')
        self.assertEqual(shared.exception.code, 409)
        self.request(self.route + '/site-scripts/file-association', {
            'digest': other['scriptDigest'], 'configId': '102', 'queueName': 'news', 'target': 'source', 'action': 'unlink'})
        self.assertTrue(self.change(version, action='delete')['ok'])

    def delete_from_repository(self, repo, path):
        import json
        from urllib.parse import quote
        from urllib.request import Request, urlopen
        with urlopen(Request(self.url + self.route + '/settings/code-repos/' + repo['repoId'] + '/files?path=' + quote(path), method='DELETE'), timeout=5) as response:
            return json.load(response)

    def test_unlink_allows_repository_delete_while_history_and_pinned_deployment_remain(self):
        repo, version, payload, source = self.fixture()
        listing = lambda: self.request(self.route + '/settings/code-repos/' + repo['repoId'] + '/files')['items']
        current = next(row for row in listing() if row['path'] == version['storagePath'])
        self.assertFalse(current['canDelete']); self.assertIn('节点代码', current['deleteReason'])
        deployment = self.request(self.route + '/deployment-configurations', {
            'name': '固定版本部署', 'pathStyle': 'custom', 'directoryTemplate': 'test', 'entryPoint': 'main.py',
            'nodes': [{'id': 'main', 'parentId': '', 'name': 'main.py', 'kind': 'file', 'repoId': repo['repoId'],
                       'sourcePath': version['storagePath'], 'sourceType': 'file', 'gitCommit': version['gitCommit']}]})
        self.change(version, 'saved')
        current = next(row for row in listing() if row['path'] == version['storagePath'])
        self.assertTrue(current['canDelete']); self.assertFalse(current['deleteReason'])
        self.delete_from_repository(repo, version['storagePath'])
        self.assertEqual(self.request(self.route + '/site-scripts/code?digest=' + version['scriptDigest'])['code'], source)
        preserved = self.request(self.route + '/deployment-configurations/' + deployment['deploymentId'])
        self.assertEqual(preserved['nodes'], deployment['nodes'])

    def test_unreferenced_code_directory_file_is_deletable_and_literal_paths_are_respected(self):
        repo, version, payload, source = self.fixture()
        root = Path(repo['path']); folder = root / 'code'; folder.mkdir()
        for name in ('[a].py', 'a.py'):
            (folder / name).write_text(source)
        self.app.git(root, 'add', '--', 'code')
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Add old files')
        listed = self.request(self.route + '/settings/code-repos/' + repo['repoId'] + '/files')['items']
        self.assertTrue(next(row for row in listed if row['path'] == 'code/[a].py')['canDelete'])
        self.delete_from_repository(repo, 'code/[a].py')
        self.assertFalse((folder / '[a].py').exists()); self.assertTrue((folder / 'a.py').exists())

    def test_crlf_only_changes_are_backed_up_but_real_content_changes_are_rejected(self):
        repo, version, payload, source = self.fixture()
        self.change(version, 'saved')
        root = Path(repo['path']); target = root / version['storagePath']
        self.app.git(root, 'config', 'core.autocrlf', 'false')
        target.write_bytes(source.encode())
        self.app.git(root, 'add', '--', version['storagePath'])
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Normalize fixture to LF')
        target.write_bytes(source.replace('\n', '\r\n').encode())
        self.delete_from_repository(repo, version['storagePath'])
        saved = list((self.app.data_dir / 'repository-delete-backups').glob('*/file'))
        self.assertEqual(len(saved), 1); self.assertEqual(saved[0].read_bytes(), source.replace('\n', '\r\n').encode())
        new = self.request(self.route + '/site-scripts/publish', payload)
        self.change(new, 'saved')
        (root / new['storagePath']).write_text(source + 'UNCOMMITTED = 1\n')
        with self.assertRaises(HTTPError) as changed:
            self.delete_from_repository(repo, new['storagePath'])
        self.assertEqual(changed.exception.code, 409)
        self.assertTrue((root / new['storagePath']).exists())


if __name__ == '__main__':
    unittest.main()
