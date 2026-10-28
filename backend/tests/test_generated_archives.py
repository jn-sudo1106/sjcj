import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from backend.tests import test_code_generation_servers as code_server_tests
from backend.runner_management import model_interfaces
from backend.runner_management.server import ApiError


class GeneratedArchivesTest(unittest.TestCase):
    setUp = code_server_tests.CodeServerTest.setUp
    tearDown = code_server_tests.CodeServerTest.tearDown
    request = code_server_tests.CodeServerTest.request
    start_remote = code_server_tests.CodeServerTest.start_remote

    def fixture(self, extra_files=None, text_only=False):
        service, endpoint, identity, _ = self.start_remote()
        calls = []
        class Model(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append(body)
                root = Path(body['code_dir']); root.mkdir(parents=True, exist_ok=True)
                if not text_only:
                    (root / 'newslink.py').write_text('VALUE = ' + str(len(calls)), encoding='utf8')
                    (root / 'lib').mkdir(exist_ok=True)
                    (root / 'lib/helper.py').write_text('def helper(): return 1\n', encoding='utf8')
                for path, content in (extra_files or {}).items():
                    target = root / path; target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(content, encoding='utf8')
                (Path(body['input_file_dir']) / 'private.txt').write_text('input is not code')
                (Path(body['output_file_dir']) / 'report.txt').write_text('output is not code')
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps({'content': 'VALUE = ' + str(len(calls)) if text_only else '已生成文件'}).encode())
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        self.addCleanup(upstream.server_close); self.addCleanup(upstream.shutdown)
        origin_url = f'http://127.0.0.1:{upstream.server_port}'
        service.config['allowedModelOrigins'] = [origin_url]
        models = model_interfaces.listing(self.app)
        agent = models['items'][1]
        agent.update(endpoint=origin_url + '/wb/agent', generationServerId=identity['serverId'], prjDir='.')
        model_interfaces.save(self.app, models)
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repo['path']); root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        origin = Path(self.tmp.name) / 'git-origin'; origin.mkdir()
        self.app.git(origin, 'init', '--bare')
        self.app.configure_repository_git(repo['repoId'], origin.as_uri(), 'main')
        payload = {'interfaceId': agent['id'], 'configId': '101', 'configType': '95', 'queueName': 'download',
                   'repositoryId': repo['repoId'], 'directoryId': 'default', 'autoCommit': True,
                   'fileName': 'newslink.py', 'prompt': '生成处理程序', 'url': 'https://example.com/news', 'sampleId': 'www.realcan.cn.py'}
        return service, repo, origin, payload, calls

    def test_multiple_files_auto_commit_flatten_prefix_owned_updates_and_references(self):
        service, repo, origin, payload, calls = self.fixture()
        result = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': 'task-1'})
        archive = result['archive']
        self.assertEqual(archive['status'], 'committed'); self.assertTrue(archive['pushed'])
        self.assertEqual(result['code'], 'VALUE = 1')
        paths = self.app.git(origin, 'ls-tree', '-r', '--name-only', 'main').splitlines()
        self.assertEqual(paths, ['default/lib/helper.py', 'default/newslink.py'])
        self.assertTrue(all('task-1' not in path and 'input' not in path and 'output' not in path for path in paths))
        second = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': 'task-2'})
        self.assertEqual(second['archive']['status'], 'committed')
        self.assertNotEqual(second['archive']['gitCommit'], archive['gitCommit'])
        self.assertEqual(calls[0]['code_dir'], calls[1]['code_dir'])
        self.assertEqual(Path(calls[0]['prj_dir']).name, '101')
        for task, commit in (('task-1', archive['gitCommit']), ('task-2', second['archive']['gitCommit'])):
            receipt = json.loads((Path(calls[0]['prj_dir']) / 'tasks' / (task + '.json')).read_text('utf8'))
            self.assertEqual(receipt['status'], 'succeeded')
            self.assertEqual(receipt['gitCommit'], commit)
            self.assertTrue(receipt['pushed'])
        self.assertEqual(self.app.git(origin, 'show', 'main:default/newslink.py').strip(), 'VALUE = 2')
        referenced = self.request('/api/runner-management/settings/code-repos/' + repo['repoId'] + '/files/references?path=default/newslink.py')
        self.assertEqual({row['scope'] for row in referenced['items'] if row['kind'] == 'generation'}, {'current', 'history'})
        # Another config cannot overwrite files associated with this node.
        blocked = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'configId': 'other', 'taskId': 'task-3'})
        self.assertEqual(blocked['archive']['status'], 'failed')
        self.assertEqual(self.app.git(origin, 'show', 'main:default/newslink.py').strip(), 'VALUE = 2')

    def test_push_retry_does_not_regenerate_and_commit_is_idempotent(self):
        service, repo, origin, payload, calls = self.fixture()
        push = self.app.push_git
        attempts = []
        def fail_once(root, branch):
            attempts.append(branch)
            if len(attempts) == 1:
                raise ApiError('测试推送失败', 502)
            return push(root, branch)
        with patch.object(self.app, 'push_git', side_effect=fail_once):
            result = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': 'retry-task', 'deferCommit': True})
            archive = result['archive']
            route = '/api/runner-management/site-scripts/generated-results/' + archive['archiveId'] + '/commit'
            failed = archive
            self.assertEqual(failed['status'], 'failed'); self.assertTrue(failed['gitCommit'])
            saved = self.request(route, {})
            self.assertEqual(saved['status'], 'committed'); self.assertTrue(saved['pushed'])
            self.assertEqual(self.request(route, {})['gitCommit'], saved['gitCommit'])
        self.assertEqual(len(calls), 1); self.assertEqual(len(attempts), 2)
        state = self.request('/api/runner-management/site-scripts/generation-state?configId=101')
        self.assertEqual(state['archive']['archiveId'], archive['archiveId'])
        self.assertEqual(state['archive']['status'], 'committed')
        receipt = json.loads((Path(calls[0]['prj_dir']) / 'tasks/retry-task.json').read_text('utf8'))
        self.assertEqual(receipt['gitCommit'], saved['gitCommit']); self.assertEqual(receipt['status'], 'succeeded')

    def test_node_generation_automatically_commits_despite_old_manual_preference(self):
        service, repo, origin, payload, calls = self.fixture()
        self.request('/api/runner-management/site-scripts/generation-settings', {'configId': '101', 'autoCommit': False})
        self.assertFalse(self.request('/api/runner-management/site-scripts/generation-state?configId=101')['autoCommit'])
        result = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': 'manual', 'autoCommit': False})
        archive = result['archive']; self.assertEqual(archive['status'], 'committed')
        self.assertTrue(archive['pushed'])
        self.assertEqual(self.app.git(origin, 'show', 'main:default/newslink.py').strip(), 'VALUE = 1')
        self.assertEqual(len(calls), 1)

    def test_gitignore_and_uncommitted_local_edits_are_preserved(self):
        service, repo, origin, payload, calls = self.fixture({'.gitignore': '*.tmp\n', 'cache.tmp': 'do not commit'})
        first = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': 'ignore-task'})
        self.assertEqual(first['archive']['status'], 'committed')
        self.assertEqual({file['relativePath'] for file in first['archive']['files']}, {'.gitignore', 'newslink.py', 'lib/helper.py'})
        self.assertNotIn('cache.tmp', self.app.git(origin, 'ls-tree', '-r', '--name-only', 'main'))
        target = Path(repo['path']) / 'default/newslink.py'
        target.write_text('MANUAL = True', encoding='utf8')
        second = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': 'local-edit-task'})
        self.assertEqual(second['archive']['status'], 'failed')
        self.assertIn('本地修改', second['archive']['message'])
        self.assertEqual(target.read_text('utf8'), 'MANUAL = True')
        self.assertEqual(self.app.git(origin, 'show', 'main:default/newslink.py').strip(), 'VALUE = 1')

    def test_queue_custom_paths_and_registered_server_root_override_model_root(self):
        service, repo, origin, payload, calls = self.fixture()
        models = model_interfaces.listing(self.app)
        models['items'][1]['prjDir'] = r'D:\old-model-setting'
        model_interfaces.save(self.app, models)
        for mode, path, expected in (('queue', '', 'download'), ('custom', 'news/cninfo', 'news/cninfo')):
            result = self.request('/api/runner-management/model-interfaces/generate', {
                **payload, 'workspaceMode': mode, 'workspacePath': path, 'taskId': mode + '-task'})
            self.assertEqual(result['archive']['status'], 'committed', result['archive']['message'])
            root = service.workspace.root / expected
            self.assertEqual(Path(calls[-1]['code_dir']), root / 'code')
            self.assertEqual(Path(calls[-1]['prj_dir']), root)
            record = json.loads((root / 'tasks' / (mode + '-task.json')).read_text('utf8'))
            self.assertEqual(record['gitCommit'], result['archive']['gitCommit'])
        for path in ('../escape', r'D:\outside'):
            with self.assertRaises(Exception):
                self.request('/api/runner-management/model-interfaces/generate', {**payload, 'workspaceMode': 'custom', 'workspacePath': path})

    def test_text_only_agent_updates_existing_code_in_reused_directory(self):
        service, repo, origin, payload, calls = self.fixture(text_only=True)
        for task, expected in (('first', 'VALUE = 1'), ('second', 'VALUE = 2')):
            result = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'taskId': task})
            self.assertEqual(result['archive']['status'], 'committed', result['archive']['message'])
            self.assertEqual(self.app.git(origin, 'show', 'main:default/newslink.py').strip(), expected)
