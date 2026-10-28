"""Local HTTP and process integration tests; no external DB or MQ required."""
import json
import io
import base64
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from datetime import datetime, timedelta, timezone
from pathlib import Path
import importlib.util
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote

from backend.runner_management.artifacts import verify_artifact
from backend.runner_management.runner import Runner, machine_ip
from backend.runner_management.bootstrapper import Bootstrapper
from backend.runner_management.server import Application, Handler
from backend.runner_management.store import Store


class ManagementIntegrationTest(unittest.TestCase):
    def test_three_workers_ignore_legacy_python_cache_use_verified_source_and_redeliver_safely(self):
        import importlib.util
        import marshal
        import struct
        from backend.runner_management.directory_layout import snapshot_files
        cache_name = '__pycache__/helper.' + sys.implementation.cache_tag + '.pyc'
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repo['path'])
        root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        main = ("import helper,json,os,sys,time\nfrom pathlib import Path\n"
                "Path(__file__).with_name('probe-'+str(os.getpid())+'.json').write_text(json.dumps("
                "{'value':helper.VALUE,'noWrite':sys.dont_write_bytecode,'prefix':sys.pycache_prefix}))\n"
                "while True: time.sleep(.1)\n")
        contents = {'worker/main.py': main.encode(), 'worker/helper.py': b"VALUE = 'verified-source'\n",
                    'worker/config.json': b'{"enabled":true}', 'worker/' + cache_name: b'old-cache'}
        upload = self.request('/api/runner-management/settings/code-repos/' + repo['repoId'] + '/files', {
            'uploadType': 'folder', 'overwrite': False,
            'files': [{'name': name.rsplit('/', 1)[-1], 'relativePath': name, 'data': base64.b64encode(data).decode()} for name, data in contents.items()]})
        config = self.request('/api/runner-management/deployment-configurations', {
            'name': '缓存并发回归', 'directoryTemplate': 'news', 'entryPoint': 'app/main.py', 'pathStyle': 'custom',
            'nodes': [{'id': 'app', 'parentId': '', 'name': 'app', 'kind': 'folder', 'repoId': repo['repoId'],
                       'sourcePath': 'default/worker', 'sourceType': 'directory', 'gitCommit': upload['gitCommit']}]})
        self.runner = Runner(Path(self.tmp.name) / 'python-cache-instance', self.url)
        self.runner.enroll()
        # Recreate an old signed package containing tracked bytecode, even
        # though new snapshots already exclude interpreter-owned caches.
        def legacy_snapshot(*args):
            files, sources, directories = snapshot_files(*args)
            return {**files, 'app/' + cache_name: b'old-cache'}, sources, [*directories, 'app/__pycache__']
        with patch('backend.runner_management.deployment_configuration.snapshot_files', legacy_snapshot), patch('backend.runner_management.directory_delivery.snapshot_files', legacy_snapshot):
            runtime = self.request('/api/runner-management/runtime-configurations', {
                'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'],
                'runnerId': self.runner.identity['runnerId'], 'concurrency': 3})
            runtime = self.deliver_runtime_fixture(config, self.runner)
        target = self.runner.directory / 'news/app'
        cached = target / cache_name
        cached.parent.mkdir(parents=True, exist_ok=True)
        stat = (target / 'helper.py').stat()
        # Valid-looking malicious/stale bytecode must not override the verified
        # source merely because cache files are exempted from runtime checks.
        forged = struct.pack('<4sIII', importlib.util.MAGIC_NUMBER, 0, int(stat.st_mtime) & 0xffffffff, stat.st_size) + marshal.dumps(compile("VALUE='cached-wrong'", 'helper.py', 'exec'))
        cached.write_bytes(forged)
        started = self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': runtime['revision']})
        self.runner.tick()
        self.assertEqual(len(self.runner.processes), 3)
        probes = [json.loads(path.read_text()) for path in target.glob('probe-*.json')]
        self.assertEqual(len(probes), 3)
        self.assertTrue(all(probe['value'] == 'verified-source' and probe['noWrite'] for probe in probes))
        self.assertEqual(len({probe['prefix'] for probe in probes}), 3)
        self.assertEqual(cached.read_bytes(), forged)
        package, manifest = self.runner.prepare(started['assignment']['releaseDigest'])
        for name in ('helper.py', 'config.json'):
            file = target / name
            original = file.read_bytes()
            file.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, '启动文件或依赖与配置版本不一致'):
                self.runner.program_directory(package, manifest)
            file.write_bytes(original)
        route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + self.runner.identity['runnerId']
        preview = self.request(route + '/delivery-preview')
        self.assertFalse(any('__pycache__' in item['path'] for item in preview['items']))
        unchanged = self.request(route + '/deliver', {'revision': config['revision'], 'scope': 'all', 'baselineDigest': preview['baselineDigest']})
        self.assertTrue(unchanged['unchanged'])
        for process_key in list(self.runner.processes):
            self.runner.stop(process_key)
        helper = root / 'default/worker/helper.py'
        helper.write_text("VALUE = 'source-v2'\n", encoding='utf-8')
        self.app.git(root, 'add', 'default/worker/helper.py')
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'change real source')
        config = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'], {
            **config, 'nodes': [{**config['nodes'][0], 'gitCommit': self.app.git(root, 'rev-parse', 'HEAD').strip()}]})
        preview = self.request(route + '/delivery-preview')
        job = self.request(route + '/deliver', {'revision': config['revision'], 'scope': 'all', 'baselineDigest': preview['baselineDigest']})
        self.assertEqual(job['transferredFileCount'], 1)
        self.runner.deliver_pending()
        delivered = next(row for row in self.request('/api/runner-management/directory-bindings') if row['runnerId'] == self.runner.identity['runnerId'])
        self.assertEqual(delivered['delivery']['status'], 'success', delivered['delivery']['error'])
        self.assertEqual(cached.read_bytes(), forged)
        self.assertEqual((target / 'helper.py').read_text(), "VALUE = 'source-v2'\n")

    def process_control_fixture(self):
        repository = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repository['path'])
        root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        saved = self.request('/api/runner-management/settings/code-repos/' + repository['repoId'] + '/files', {
            'overwrite': False, 'files': [{'name': 'worker.py', 'data': base64.b64encode(b'import time\nwhile True: time.sleep(.1)\n').decode()}]})
        config = self.request('/api/runner-management/deployment-configurations', {
            'name': '单进程测试', 'directoryTemplate': 'workers', 'entryPoint': 'worker.py', 'pathStyle': 'custom',
            'nodes': [{'id': 'main', 'parentId': '', 'kind': 'file', 'name': 'worker.py', 'repoId': repository['repoId'],
                       'sourcePath': saved['files'][0]['path'], 'sourceType': 'file', 'gitCommit': saved['gitCommit']}]})
        self.runner = Runner(Path(self.tmp.name) / 'single-process-instance', self.url)
        self.runner.enroll()
        runtime = self.request('/api/runner-management/runtime-configurations', {
            'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'],
            'runnerId': self.runner.identity['runnerId'], 'concurrency': 2})
        runtime = self.deliver_runtime_fixture(config, self.runner)
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': runtime['revision']})
        self.runner.tick()
        return runtime, self.request('/api/runner-management/processes')['items']

    def test_stop_one_process_persists_without_affecting_other_slots_and_manual_start_recovers(self):
        runtime, workers = self.process_control_fixture()
        self.assertEqual(len(workers), 2)
        first, second = sorted(workers, key=lambda item: item['slot'])
        route = '/api/runner-management/runners/' + first['runnerId'] + '/processes/stop'
        command = self.request(route, first)
        self.assertEqual(self.request(route, first)['requestId'], command['requestId'])
        child = self.runner.processes[first['assignmentId']][1]
        survivor = self.runner.processes[first['assignmentId'] + ':1'][1]
        self.runner.tick()
        self.assertIsNotNone(child.poll())
        self.assertIsNone(survivor.poll())
        self.runner.tick()
        remaining = self.request('/api/runner-management/processes')['items']
        self.assertEqual([worker['pid'] for worker in remaining], [second['pid']])
        # The durable instruction survives recreation of the Runner object.
        with self.app.store.connect() as db:
            from backend.runner_management.process_control import commands
            self.assertEqual(commands(db)[0]['status'], 'applied')
        directory = self.runner.directory
        self.runner.close()
        self.runner = Runner(directory, self.url)
        self.runner.tick()
        restarted = self.request('/api/runner-management/processes')['items']
        self.assertEqual([item['slot'] for item in restarted], [1])
        second = restarted[0]
        detail = self.request('/api/runner-management/runtime-operations/' + command['requestId'])
        self.assertEqual(detail['status'], 'success')
        runtime = next(item for item in self.request('/api/runner-management/runtime-configurations') if item['runtimeId'] == runtime['runtimeId'])
        self.assertTrue(runtime['assignment']['enabled'])
        self.assertEqual(runtime['stoppedProcessSlots'], [0])
        # An invalid manual start must not release the stopped slot.
        with self.assertRaises(HTTPError):
            self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': 'stale'})
        self.runner.tick()
        self.assertEqual([item['slot'] for item in self.request('/api/runner-management/processes')['items']], [1])
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': runtime['revision']})
        self.runner.tick()
        revived = self.request('/api/runner-management/processes')['items']
        self.assertEqual(len(revived), 2)
        self.assertEqual(next(item['pid'] for item in revived if item['slot'] == 1), second['pid'])
        self.assertNotEqual(next(item['pid'] for item in revived if item['slot'] == 0), first['pid'])
        for _ in range(30):
            starts = self.request('/api/runner-management/runtime-operations?kind=start&runtimeId=' + runtime['runtimeId'])
            if starts['items'][0]['status'] == 'success':
                break
            time.sleep(.1)
        self.assertEqual(starts['items'][0]['status'], 'success')

    def test_process_stop_rejects_stale_pid_generation_offline_old_runner_and_unauthorized_requests(self):
        _, workers = self.process_control_fixture()
        worker = workers[0]
        route = '/api/runner-management/runners/' + worker['runnerId'] + '/processes/stop'
        for changes in ({'pid': worker['pid'] + 1}, {'slot': 100}, {'slot': True}, {'generation': 'old'}):
            with self.assertRaises(HTTPError) as error:
                self.request(route, {**worker, **changes})
            self.assertIn(error.exception.code, (400, 409))
        with patch.dict(os.environ, {'RUNNER_DEV_MODE': '0', 'RUNNER_ADMIN_TOKEN': 'test-only-admin', 'RUNNER_AUTH_URL': ''}):
            with self.assertRaises(HTTPError) as error:
                self.request(route, worker)
            self.assertEqual(error.exception.code, 503)
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET capabilities=? WHERE runner_id=?', ('[]', worker['runnerId']))
        with self.assertRaises(HTTPError) as error:
            self.request(route, worker)
        self.assertEqual(error.exception.code, 422)
        self.runner.tick()
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET last_heartbeat=? WHERE runner_id=?', ('2000-01-01T00:00:00+00:00', worker['runnerId']))
        with self.assertRaises(HTTPError) as error:
            self.request(route, worker)
        self.assertEqual(error.exception.code, 409)

    def test_pid_replaced_before_runner_receives_stop_does_not_kill_replacement_or_other_slot(self):
        _, workers = self.process_control_fixture()
        first = next(item for item in workers if item['slot'] == 0)
        command = self.request('/api/runner-management/runners/' + first['runnerId'] + '/processes/stop', first)
        other = Runner(Path(self.tmp.name) / 'other-process-runner', self.url)
        other.enroll()
        with self.assertRaises(HTTPError) as error:
            self.request('/api/runners/me/process-stops/' + command['requestId'] + '/result', {'status': 'applied'}, token=other.identity['token'])
        self.assertEqual(error.exception.code, 403)
        assignments = self.runner.get('/api/runners/me/assignments')
        # Simulate the old process exiting and an automatic retry occurring
        # before the close command arrives, using a genuinely new subprocess.
        self.runner.stop(first['assignmentId'])
        self.runner.start(assignments[0])
        replacement = self.runner.processes[first['assignmentId']][1]
        self.runner.tick()
        self.assertIsNone(replacement.poll())
        detail = self.request('/api/runner-management/runtime-operations/' + command['requestId'])
        self.assertEqual(detail['status'], 'failed')
        self.assertIn('PID 已变化', detail['error'])
        self.assertEqual(len(self.request('/api/runner-management/processes')['items']), 2)

    def test_repository_directory_view_groups_before_paging_and_preserves_flat_list(self):
        repo = self.request('/api/runner-management/settings/code-repos', {
            'name': '目录浏览测试', 'path': str(Path(self.tmp.name) / 'browse-local'), 'remoteUrl': '', 'branch': 'main'})
        route = '/api/runner-management/settings/code-repos/' + repo['repoId']
        directory = self.request(route + '/directories', {
            'name': '公共代码', 'configType': '', 'configTypeName': '', 'path': 'shared/python'})
        paths = ['程序/main.py', '程序/utils/helper.py', *['程序/utils/file%02d.py' % i for i in range(55)]]
        self.request(route + '/files', {'directoryId': directory['directoryId'], 'uploadType': 'folder', 'overwrite': False,
            'files': [{'name': p.rsplit('/', 1)[-1], 'relativePath': p, 'data': base64.b64encode(b'pass').decode()} for p in paths]})
        query = route + '/files?directoryId=' + directory['directoryId']
        flat = self.request(query)
        self.assertEqual(flat['total'], 57)
        self.assertEqual(len(flat['items']), 50)
        root = self.request(query + '&view=directory')
        self.assertEqual(root['total'], 1)
        self.assertEqual(root['items'][0]['path'], 'shared/python/程序')
        self.assertEqual(root['items'][0]['kind'], 'directory')
        self.assertFalse(root['items'][0]['canDelete'])
        nested = self.request(query + '&view=directory&folder=' + quote('程序'))
        self.assertEqual([(i['path'], i['kind']) for i in nested['items']], [
            ('shared/python/程序/utils', 'directory'), ('shared/python/程序/main.py', 'file')])
        page2 = self.request(query + '&view=directory&folder=' + quote('程序/utils') + '&page=2')
        self.assertEqual(page2['total'], 56)
        self.assertEqual(len(page2['items']), 6)
        found = self.request(query + '&view=directory&keyword=helper')
        self.assertEqual(found['items'][0]['path'], 'shared/python/程序')
        self.assertEqual(self.request(query + '&view=directory&folder=missing')['total'], 0)
        for invalid in ('../outside', '/absolute', '程序/../utils', '.git', '程序//utils', 'C:/outside'):
            with self.assertRaises(HTTPError) as error:
                self.request(query + '&view=directory&folder=' + quote(invalid))
            self.assertEqual(error.exception.code, 400)

    def test_repository_file_metadata_uses_file_history_at_selected_snapshot(self):
        route = '/api/runner-management/settings/code-repos'
        repo = self.request(route)[0]
        root = Path(repo['path'])
        root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        repo_url = route + '/' + repo['repoId']
        def upload(name, code, date, overwrite=False):
            with patch.dict(os.environ, {'GIT_AUTHOR_DATE': date, 'GIT_COMMITTER_DATE': date}):
                return self.request(repo_url + '/files', {'overwrite': overwrite, 'files': [
                    {'name': name, 'data': base64.b64encode(code.encode()).decode()}]})
        first_time = '2026-10-01T09:00:00+08:00'
        changed_time = '2026-10-05T10:00:00+08:00'
        first = upload('main.py', 'def scrape(url): return []\n', first_time)
        changed = upload('main.py', 'def scrape(url): return [url]\n', changed_time, True)
        unrelated = upload('other.py', 'value = 1\n', '2026-10-06T11:00:00+08:00')
        path = first['files'][0]['path']
        metadata_url = repo_url + '/files/metadata?path=' + quote(path)
        metadata = self.request(metadata_url + '&commit=' + unrelated['gitCommit'])
        self.assertEqual(metadata['gitCommit'], unrelated['gitCommit'])
        self.assertEqual(metadata['fileCommit'], changed['gitCommit'])
        self.assertEqual(metadata['createdAt'], first_time)
        self.assertEqual(metadata['updatedAt'], changed_time)
        historical = self.request(metadata_url + '&commit=' + first['gitCommit'])
        self.assertEqual(historical['fileCommit'], first['gitCommit'])
        self.assertEqual(historical['updatedAt'], first_time)
        self.assertEqual(self.request(metadata_url), metadata)

    def test_repository_file_metadata_follows_renames_and_validates_snapshot_paths(self):
        route = '/api/runner-management/settings/code-repos'
        repo = self.request(route)[0]
        root = Path(repo['path'])
        root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        repo_url = route + '/' + repo['repoId']
        created_at = '2026-10-01T09:00:00+08:00'
        with patch.dict(os.environ, {'GIT_AUTHOR_DATE': created_at, 'GIT_COMMITTER_DATE': created_at}):
            upload = self.request(repo_url + '/files', {'overwrite': False, 'files': [
                {'name': 'main.py', 'data': base64.b64encode(b'def scrape(url): return []\n').decode()}]})
        path = upload['files'][0]['path']
        renamed = 'default/renamed.py'
        self.app.git(root, 'mv', path, renamed)
        with patch.dict(os.environ, {'GIT_AUTHOR_DATE': '2026-10-07T09:00:00+08:00', 'GIT_COMMITTER_DATE': '2026-10-07T09:00:00+08:00'}):
            self.app.git(root, '-c', 'user.name=Runner Builder', '-c', 'user.email=runner@localhost', 'commit', '-m', 'Rename script')
        commit = self.app.git(root, 'rev-parse', 'HEAD').strip()
        metadata = self.request(repo_url + '/files/metadata?path=' + quote(renamed) + '&commit=' + commit)
        self.assertEqual(metadata['createdAt'], created_at)
        self.assertEqual(metadata['fileCommit'], commit)
        for bad_path, revision, status in [('../outside.py', commit, 400), ('.git/config', commit, 400),
                                           ('default', commit, 404), (path, commit, 404),
                                           (renamed, 'HEAD', 400), (renamed, '0' * 40, 409)]:
            with self.subTest(path=bad_path, commit=revision):
                with self.assertRaises(HTTPError) as error:
                    self.request(repo_url + '/files/metadata?path=' + quote(bad_path) + '&commit=' + revision)
                self.assertEqual(error.exception.code, status)

    def test_filename_modes_preserve_code_identity_and_do_not_select_runtime(self):
        route = '/api/runner-management'
        repo = self.request(route + '/settings/code-repos')[0]
        payload = {'configId': 'named-node', 'queueName': 'news_list', 'configType': '90', 'fileNameMode': 'website',
            'fileName': 'www.example.com.py', 'repositoryId': repo['repoId'], 'directoryId': 'default',
            'url': 'https://www.example.com/list', 'code': 'def scrape(url):\n    return []\n'}
        website = self.request(route + '/site-scripts/publish', payload)
        self.assertEqual(website['siteHost'], '')
        self.assertEqual(website['deliveryPath'], 'www.example.com.py')
        self.assertEqual(website['storagePath'], 'default/www.example.com.py')
        renamed = self.request(route + '/site-scripts/publish', {**payload, 'codeId': website['codeId'],
            'fileNameMode': 'queue', 'fileName': 'news_list.py'})
        self.assertEqual(renamed['codeId'], website['codeId'])
        self.assertEqual(renamed['siteHost'], '')
        self.assertEqual(renamed['storagePath'], 'default/news_list.py')
        old = self.request(route + '/site-scripts/code?digest=' + quote(website['scriptDigest']))
        self.assertEqual(old['storagePath'], website['storagePath'])
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM code_runtime_bindings').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM assignments').fetchone()[0], 0)
        for changes in ({'fileName': '../outside.py'}, {'fileName': 'sites/unsafe.py'}, {'fileName': 'CON.py'},
                        {'fileNameMode': 'invalid'}, {'codeId': '0' * 32},
                        {'fileNameMode': 'queue', 'fileName': 'wrong.py'}):
            with self.assertRaises(HTTPError):
                self.request(route + '/site-scripts/publish', {**payload, **changes})
        conflicting = self.request(route + '/site-scripts/publish', {'configId': payload['configId'], 'queueName': payload['queueName'],
            'codeType': 'site', 'siteHost': 'conflict.example.com', 'code': payload['code']})
        with self.assertRaises(HTTPError) as collision:
            self.request(route + '/site-scripts/publish', {**payload, 'codeId': conflicting['codeId'],
                'fileNameMode': 'queue', 'fileName': 'news_list.py'})
        self.assertEqual(collision.exception.code, 409)
        # Editing legacy website code changes its filename without recreating
        # the asset or changing existing adopted versions.
        legacy = self.request(route + '/site-scripts/publish', {'configId': 'legacy-node', 'queueName': 'legacy_queue',
            'codeType': 'site', 'siteHost': 'example.com', 'code': payload['code']})
        with self.app.store.connect() as db:
            db.execute('INSERT INTO code_runtime_bindings VALUES (?,?,?,?,?)',
                       ('test', 'legacy-node', 'legacy_queue', 'example.com', legacy['scriptDigest']))
        migrated = self.request(route + '/site-scripts/publish', {**payload, 'configId': 'legacy-node',
            'queueName': 'legacy_queue', 'codeId': legacy['codeId'], 'fileName': 'example.com.py'})
        self.assertEqual(migrated['codeId'], legacy['codeId'])
        self.assertEqual(migrated['storagePath'], 'default/example.com.py')
        history = self.request(route + '/site-scripts/code?digest=' + quote(legacy['scriptDigest']))
        self.assertEqual(history['storagePath'], legacy['storagePath'])
        updated = self.request(route + '/site-scripts/publish', {**payload, 'configId': 'legacy-node',
            'queueName': 'legacy_queue', 'codeId': legacy['codeId'], 'fileNameMode': 'queue', 'fileName': 'legacy_queue.py'})
        self.assertEqual(updated['codeId'], legacy['codeId'])
        self.assertEqual(updated['siteHost'], 'example.com')
        self.assertEqual(updated['storagePath'], 'default/legacy_queue.py')
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT digest FROM code_runtime_bindings').fetchone()[0], legacy['scriptDigest'])

    def test_filename_mode_deploys_to_configured_website_or_queue_directory(self):
        route = '/api/runner-management'
        code = self.request(route + '/site-scripts/publish', {'configId': 'naming-deploy', 'queueName': 'news_list',
            'fileNameMode': 'website', 'fileName': 'generated.example.com.py', 'code': 'def scrape(url):\n    return []\n'})
        legacy = self.request(route + '/site-scripts/publish', {'configId': 'naming-deploy', 'queueName': 'news_list',
            'codeType': 'site', 'siteHost': 'generated.example.com', 'code': 'def scrape(url):\n    return []\n'})
        self.request(route + '/releases/processors', {'processorType': 'newslink_nourl'})
        for style, environment, template, target in [('website', 'test', '{website}/run', 'deployed.example.com/run'),
                                                     ('queue', 'production', '{queue}/run', 'news_list/run'),
                                                     ('legacy', 'test', '{website}/legacy', 'deployed.example.com/legacy')]:
            runner = Runner(Path(self.tmp.name) / ('naming-deploy-' + style), self.url); runner.enroll()
            selected = legacy if style == 'legacy' else code
            origin = {'flowId': 'flow1', 'flowName': '测试流程', 'stepId': 'step1', 'nodeName': '列表', 'configId': code['configId']}
            config = self.request(route + '/deployment-configurations', {'name': '命名与部署独立-' + style, 'pathStyle': 'website' if style == 'legacy' else style,
                'sourceNode': origin, 'codeId': selected['codeId'] if style == 'legacy' else '',
                'configId': code['configId'], 'queueName': code['queueName'], 'siteHost': 'deployed.example.com',
                'directoryTemplate': template, 'entryPoint': 'configured-entry.py',
                'nodes': [{'id': 'entry', 'parentId': '', 'kind': 'file', 'name': 'configured-entry.py',
                    'repoId': selected['repoId'], 'sourcePath': selected['storagePath'], 'sourceType': 'file', 'gitCommit': selected['gitCommit']}]})
            runtime = self.request(route + '/runtime-configurations', {'deploymentId': config['deploymentId'],
                'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'], 'environment': environment, 'concurrency': 1})
            self.assertEqual(runtime['assignment']['directoryTemplate'], target)
            self.assertEqual(runtime['assignment']['processorType'], 'deployment-entry')
            self.assertEqual(runtime['assignment']['deliveryPath'], 'configured-entry.py')
            with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(runtime['assignment']['releaseDigest']))) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                self.assertEqual(manifest['directoryTemplate'], target)
                self.assertEqual(manifest['entry'], 'configured-entry.py')

    def test_repository_directories_save_node_code_and_preserve_historical_locations(self):
        route = '/api/runner-management'
        initial = self.request(route + '/site-scripts/publish', {'configId': 'dir-node', 'queueName': 'news_list',
            'configType': '90', 'codeType': 'site', 'siteHost': 'example.com', 'code': 'def scrape(url):\n    return []\n'})
        repo = self.request(route + '/settings/code-repos')[0]
        directory_route = route + '/settings/code-repos/' + repo['repoId'] + '/directories'
        first = self.request(directory_route, {'name': '网页列表', 'configType': '90', 'configTypeName': '网页抓取', 'path': '抓取/列表'})
        self.assertTrue((Path(repo['path']) / '抓取/列表/.gitkeep').exists())
        dirs = self.request(directory_route)
        self.assertEqual(dirs[0]['directoryId'], 'default')
        self.assertEqual(dirs[1]['directoryId'], first['directoryId'])
        payload = {'configId': 'dir-node', 'queueName': 'news_list', 'configType': '90', 'codeType': 'site', 'siteHost': 'example.com',
            'repositoryId': repo['repoId'], 'directoryId': first['directoryId'], 'code': 'def scrape(url):\n    return [{"title":"first"}]\n'}
        saved = self.request(route + '/site-scripts/publish', payload)
        self.assertEqual(saved['codeId'], initial['codeId'])
        self.assertEqual(saved['directoryId'], first['directoryId'])
        self.assertEqual(saved['storagePath'], '抓取/列表/example.com.py')
        self.assertEqual((Path(repo['path']) / saved['storagePath']).read_text(encoding='utf-8'), payload['code'])
        files_route = route + '/settings/code-repos/' + repo['repoId'] + '/files'
        files = self.request(files_route + '?directoryId=' + first['directoryId'])['items']
        self.assertEqual([item['path'] for item in files], [saved['storagePath']])
        self.assertTrue(files[0]['managed']); self.assertFalse(files[0]['canDelete'])
        with self.assertRaises(HTTPError) as protected:
            with urlopen(Request(self.url + files_route + '?path=' + quote(saved['storagePath']), method='DELETE')):
                pass
        self.assertEqual(protected.exception.code, 409)
        second = self.request(directory_route, {'name': '其他列表', 'configType': '90', 'configTypeName': '网页抓取', 'path': '抓取/其他'})
        moved = self.request(route + '/site-scripts/publish', {**payload, 'directoryId': second['directoryId']})
        self.assertEqual(moved['codeId'], initial['codeId'])
        versions = self.request(route + '/site-scripts/versions?configId=dir-node&queueName=news_list')
        old = next(row for row in versions if row['scriptDigest'] == initial['scriptDigest'])
        previous = next(row for row in versions if row['scriptDigest'] == saved['scriptDigest'])
        self.assertEqual(old['storagePath'], initial['storagePath'])
        self.assertEqual(previous['storagePath'], saved['storagePath'])
        self.assertEqual(previous['directoryId'], first['directoryId'])
        # Omitting new fields remains compatible and retains the chosen directory.
        compatible = self.request(route + '/site-scripts/publish', {key: value for key, value in payload.items() if key != 'directoryId'})
        self.assertEqual(compatible['directoryId'], second['directoryId'])
        self.assertEqual(compatible['storagePath'], moved['storagePath'])
        with self.assertRaises(HTTPError) as referenced:
            with urlopen(Request(self.url + directory_route + '/' + first['directoryId'] + '?revision=' + first['revision'], method='DELETE')):
                pass
        self.assertEqual(referenced.exception.code, 409)

    def test_repository_directory_management_validates_type_status_path_and_revision(self):
        route = '/api/runner-management'
        repo = self.request(route + '/settings/code-repos')[0]
        directory_route = route + '/settings/code-repos/' + repo['repoId'] + '/directories'
        payload = {'name': '网页代码', 'configType': '90', 'configTypeName': '网页抓取', 'path': 'web'}
        row = self.request(directory_route, payload)
        for changes in ({'path': '../outside'}, {'path': 'E:/outside'}, {'path': '.git/hooks'}, {'path': 'web/child'}, {'path': 'default'}, {'path': 'web', 'name': '重复'}):
            with self.assertRaises(HTTPError):
                self.request(directory_route, {**payload, **changes})
        updated = self.request(directory_route + '/' + row['directoryId'], {**row, 'name': '网页专用代码', 'status': 'DISABLED'})
        with self.assertRaises(HTTPError) as stale:
            self.request(directory_route + '/' + row['directoryId'], row)
        self.assertEqual(stale.exception.code, 409)
        publish = {'configId': 'dir-status', 'queueName': 'list', 'configType': '90', 'codeType': 'default',
            'repositoryId': repo['repoId'], 'directoryId': row['directoryId'], 'code': 'def scrape(url):\n    return []\n'}
        with self.assertRaises(HTTPError) as disabled:
            self.request(route + '/site-scripts/publish', publish)
        self.assertEqual(disabled.exception.code, 409)
        updated = self.request(directory_route + '/' + row['directoryId'], {**updated, 'status': 'ACTIVE'})
        with self.assertRaises(HTTPError) as wrong_type:
            self.request(route + '/site-scripts/publish', {**publish, 'configType': '150'})
        self.assertEqual(wrong_type.exception.code, 409)
        upload = self.request(route + '/settings/code-repos/' + repo['repoId'] + '/files', {'directoryId': row['directoryId'],
            'files': [{'name': 'sample.py', 'data': base64.b64encode(b'print(1)').decode()}], 'overwrite': False})
        self.assertEqual(upload['files'][0]['path'], 'web/sample.py')
        with urlopen(Request(self.url + directory_route + '/' + row['directoryId'] + '?revision=' + updated['revision'], method='DELETE')) as response:
            self.assertTrue(json.load(response)['ok'])
        self.assertTrue((Path(repo['path']) / 'web/sample.py').exists(), 'Removing a directory configuration preserves files')

    def test_configured_entry_runs_selected_program_and_reports_two_instances(self):
        _, _, mapped, _ = self.directory_fixture()
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repo['path'])
        (root / 'processor/run.py').write_text(
            'import os, sys, time\nfrom pathlib import Path\nfrom helper import value\n'
            'Path("started-" + str(os.getpid())).write_text(value + "|" + os.getcwd() + "|" + sys.executable)\n'
            'while True: time.sleep(.1)\n', encoding='utf-8')
        (root / 'processor/helper.py').write_text('value = "configured-program"\n', encoding='utf-8')
        (root / 'processor/other.py').write_text('raise RuntimeError("must not start")\n', encoding='utf-8')
        subprocess.run(['git', 'add', '.'], cwd=root, check=True, capture_output=True)
        subprocess.run(['git', 'commit', '-m', 'configured entry fixture'], cwd=root, check=True, capture_output=True)
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        config = self.request('/api/runner-management/deployment-configurations', {'name': '按选择启动',
            'pathStyle': 'custom', 'directoryTemplate': 'selected-program', 'entryPoint': 'app/run.py',
            'nodes': [{'id': 'program', 'parentId': '', 'kind': 'folder', 'name': 'app', 'repoId': repo['repoId'],
                       'sourcePath': 'processor', 'sourceType': 'directory', 'gitCommit': commit}]})
        self.runner = Runner(Path(self.tmp.name) / 'configured-runner', self.url); self.runner.enroll()
        runtime = self.request('/api/runner-management/runtime-configurations', {'deploymentId': config['deploymentId'],
            'layoutRevision': config['revision'], 'runnerId': self.runner.identity['runnerId'], 'environment': 'test', 'concurrency': 2})
        self.assertEqual(runtime['assignment']['processorType'], 'deployment-entry')
        self.assertFalse(runtime['assignment']['enabled'])
        self.assertEqual(runtime['entryPoint'], 'app/run.py')
        with self.app.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM releases WHERE name='newslink_nourl'").fetchone()[0], 0)
        control = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        with self.assertRaises(HTTPError) as missing:
            self.request(control + '/start', {'revision': runtime['revision']})
        self.assertEqual(missing.exception.code, 422)
        self.request('/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/'
                     + self.runner.identity['runnerId'] + '/deliver', {'revision': config['revision']})
        self.runner.deliver_pending()
        runtime = next(item for item in self.request('/api/runner-management/runtime-configurations') if item['runtimeId'] == runtime['runtimeId'])
        runtime = self.request(control + '/start', {'revision': runtime['revision']})
        self.runner.tick()
        self.assertEqual(len(self.runner.processes), 2)
        workers = next(row for row in self.request('/api/runner-management/runners') if row['runnerId'] == self.runner.identity['runnerId'])['workerProcesses']
        self.assertEqual(len(workers), 2)
        expected = self.runner.directory / 'selected-program'
        for worker in workers:
            self.assertEqual(Path(worker['entry']), expected / 'app/run.py')
            self.assertEqual(Path(worker['workingDirectory']), expected)
        markers = list(expected.glob('started-*'))
        self.assertEqual(len(markers), 2)
        self.assertTrue(all(path.read_text().startswith('configured-program|') for path in markers))
        self.assertTrue(all(Path(path.read_text().rsplit('|', 1)[1]) == Path(sys.executable) for path in markers))
        self.assertTrue((expected / 'version.json').exists())
        runtime = next(item for item in self.request('/api/runner-management/runtime-configurations') if item['runtimeId'] == runtime['runtimeId'])
        self.request(control + '/stop', {'revision': runtime['revision']})
        self.runner.tick()
        self.assertEqual(self.runner.processes, {})
        if self.runner.delivery_thread:
            self.runner.delivery_thread.join(timeout=5)
        # A damaged local dependency must not be silently repaired or executed.
        (expected / 'app/helper.py').write_text('value = "changed"\n', encoding='utf-8')
        runtime = next(item for item in self.request('/api/runner-management/runtime-configurations') if item['runtimeId'] == runtime['runtimeId'])
        self.request(control + '/start', {'revision': runtime['revision']})
        self.runner.tick()
        self.assertEqual(self.runner.processes, {})
        self.assertIn('helper.py', next(row for row in self.request('/api/runner-management/runners') if row['runnerId'] == self.runner.identity['runnerId'])['lastError'])

    def test_old_shell_binding_explicit_save_adopts_entry_and_old_runner_cannot_start(self):
        code, _, mapped, _ = self.directory_fixture()
        self.runner = Runner(Path(self.tmp.name) / 'migrate-program', self.url); self.runner.enroll()
        legacy = self.request('/api/runner-management/assignments', {'runnerId': self.runner.identity['runnerId'],
            'scriptDigest': code['scriptDigest'], 'environment': 'test', 'concurrency': 1})
        config = self.request('/api/runner-management/deployment-configurations', {**mapped, 'name': '迁移启动方式',
            'pathStyle': 'custom', 'directoryTemplate': 'configured-root'})
        old = next(row for row in self.request('/api/runner-management/runtime-configurations') if row['assignmentId'] == legacy['assignmentId'])
        payload = {'runtimeId': old['runtimeId'], 'revision': old['revision'], 'deploymentId': config['deploymentId'],
            'layoutRevision': config['revision'], 'runnerId': self.runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1}
        runtime = self.request('/api/runner-management/runtime-configurations', payload)
        self.assertEqual(runtime['assignmentId'], legacy['assignmentId'])
        self.assertEqual(runtime['assignment']['processorType'], 'deployment-entry')
        self.assertFalse(runtime['assignment']['enabled'])
        self.assertNotEqual(runtime['assignment']['releaseDigest'], legacy['releaseDigest'])
        route = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        self.runner.post('/api/runners/me/heartbeat', {'runnerDigest': 'old-version'})
        with self.assertRaises(HTTPError) as unsupported:
            self.request(route + '/start', {'revision': runtime['revision']})
        self.assertIn('升级 Runner', json.load(unsupported.exception)['message'])
        self.runner.post('/api/runners/me/heartbeat', self.runner.heartbeat_payload())
        self.request('/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/'
                     + self.runner.identity['runnerId'] + '/deliver', {'revision': config['revision']})
        self.runner.deliver_pending()
        runtime = next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        started = self.request(route + '/start', {'revision': runtime['revision']})
        self.assertTrue(started['assignment']['enabled'])
        # An edited deployment does not change the adopted entry shown for this
        # machine, nor the signed program that a subsequent restart executes.
        alternate = {**mapped['nodes'][0], 'id': 'alternate-entry', 'parentId': '', 'name': 'alternate.py',
                     'kind': 'file', 'sourceType': 'file', 'sourcePath': 'processor/main.py'}
        changed = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'],
            {**config, 'entryPoint': 'alternate.py', 'nodes': [*config['nodes'], alternate]})
        current = next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        self.assertEqual(current['entryPoint'], config['entryPoint'])
        self.assertEqual(current['assignment']['releaseDigest'], started['assignment']['releaseDigest'])
        updated = self.request('/api/runner-management/runtime-configurations', {**payload, 'runtimeId': current['runtimeId'],
            'revision': current['revision'], 'layoutRevision': changed['revision']})
        self.assertEqual(updated['entryPoint'], 'alternate.py')
        self.assertFalse(updated['assignment']['enabled'])
        with self.assertRaises(HTTPError) as undelivered:
            self.request(route + '/start', {'revision': updated['revision']})
        self.assertEqual(undelivered.exception.code, 422)

    def test_runtime_program_commands_control_actual_worker_and_keep_binding(self):
        config = self.request('/api/runner-management/deployment-configurations', {'name': '手工启停验收', 'pathStyle': 'custom',
            'directoryTemplate': 'program-control', 'entryPoint': '', 'nodes': []})
        self.runner = Runner(Path(self.tmp.name) / 'controlled-runner', self.url); self.runner.enroll()
        processor = self.request('/api/runner-management/releases/processors', {'processorType': 'probe'})
        assignment = self.request('/api/runner-management/assignments', {'runnerId': self.runner.identity['runnerId'], 'queue': 'control_probe',
            'processorType': 'probe', 'releaseDigest': processor['digest'], 'concurrency': 1, 'environment': 'test'})
        old = self.request('/api/runner-management/runtime-configurations')[0]
        payload = {'runtimeId': old['runtimeId'], 'revision': old['revision'], 'deploymentId': config['deploymentId'],
            'layoutRevision': config['revision'], 'runnerId': self.runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1}
        bound = self.request('/api/runner-management/runtime-configurations', payload)
        route = '/api/runner-management/runtime-configurations/' + bound['runtimeId']
        self.runner.tick()
        child = self.runner.processes[assignment['assignmentId']][1]
        self.assertIsNone(child.poll())
        stopped = self.request(route + '/stop', {'revision': bound['revision']})
        self.assertFalse(stopped['assignment']['enabled'])
        self.assertIsNotNone(stopped['binding'])
        self.assertEqual(self.runner.get('/api/runners/me/assignments'), [])
        with self.assertRaises(HTTPError) as stale:
            self.request(route + '/start', {'revision': bound['revision']})
        self.assertEqual(stale.exception.code, 409)
        # An edit preserves the stopped state and the same assignment identity.
        stopped = self.request('/api/runner-management/runtime-configurations', {**payload, 'runtimeId': stopped['runtimeId'], 'revision': stopped['revision']})
        self.assertFalse(stopped['assignment']['enabled'])
        self.runner.tick()
        self.assertIsNotNone(child.poll())
        self.assertEqual(self.runner.processes, {})
        machines = self.request('/api/runner-management/runners')
        self.assertEqual(machines[0]['workerProcesses'], [])
        started = self.request(route + '/start', {'revision': stopped['revision']})
        self.assertTrue(started['assignment']['enabled'])
        self.assertEqual(started['assignmentId'], assignment['assignmentId'])
        self.runner.tick()
        self.assertIsNone(self.runner.processes[assignment['assignmentId']][1].poll())
        self.assertEqual(self.request('/api/runner-management/runners')[0]['workerProcesses'][0]['assignmentId'], assignment['assignmentId'])
        if self.runner.delivery_thread:
            self.runner.delivery_thread.join(timeout=5)

    def test_runtime_start_restores_saved_snapshot_and_rejects_conflicting_deployment(self):
        code, config, runner, runtime, payload = self.configured_runtime_fixture()
        runtime = self.deliver_runtime_fixture(config, runner)
        started = self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': runtime['revision']})
        self.assertEqual(started['assignment']['releaseDigest'], runtime['scriptDigest'])
        other = self.request('/api/runner-management/deployment-configurations', {**config, 'name': '另一个目录', 'directoryTemplate': 'other'})
        with self.assertRaises(HTTPError) as conflict:
            self.request('/api/runner-management/runtime-configurations', {**payload, 'deploymentId': other['deploymentId'], 'layoutRevision': other['revision']})
        self.assertEqual(conflict.exception.code, 409)
        with self.assertRaises(HTTPError) as missing:
            self.request('/api/runner-management/runtime-configurations/missing/start', {'revision': ''})
        self.assertEqual(missing.exception.code, 404)

    def test_start_validation_reports_entry_delivery_stage_and_version_cause(self):
        _, config, runner, runtime, payload = self.configured_runtime_fixture()
        self.runner = runner
        route = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        delivery_route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + runner.identity['runnerId']
        def current():
            return next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        def error_contains(*parts):
            with self.assertRaises(HTTPError) as error:
                self.request(route + '/start', {'revision': current()['revision']})
            self.assertEqual(error.exception.code, 422)
            message = json.load(error.exception)['message']
            for part in parts:
                self.assertIn(part, message)
            self.assertNotIn('请先下发当前机器配置采用的代码', message)
            self.assertFalse(current()['assignment']['enabled'])
            self.assertEqual(runner.processes, {})
            return message
        error_contains('尚未下发代码', '「下发代码」')
        job = self.request(delivery_route + '/deliver', {'revision': config['revision']})
        old_digest = job['artifactDigest']
        error_contains('等待 Runner 处理')
        job_route = '/api/runners/me/directory-deliveries/' + job['deliveryId']
        self.request(job_route + '/claim', {}, token=runner.identity['token'])
        error_contains('正在下发')
        self.request(job_route + '/result', {'status': 'failed', 'error': '文件被占用。'}, token=runner.identity['token'])
        message = error_contains('下发失败：文件被占用。', '运行日志')
        self.assertNotIn('。。', message)
        config_route = '/api/runner-management/deployment-configurations/' + config['deploymentId']
        nodes = [{**node, 'name': 'renamed'} if node['id'] == 'main' else node for node in config['nodes']]
        changed = self.request(config_route, {**config, 'name': '已更新配置', 'nodes': nodes, 'entryPoint': 'renamed/main.py'})
        job = self.request(delivery_route + '/deliver', {'revision': changed['revision']})
        job_route = '/api/runners/me/directory-deliveries/' + job['deliveryId']
        self.request(job_route + '/claim', {}, token=runner.identity['token'])
        self.request(job_route + '/result', {'status': 'success', 'installedPath': str(runner.directory / 'configured')}, token=runner.identity['token'])
        error_contains('已下发代码与当前启动配置不匹配', '编辑 → 保存配置', '无需重新下发')
        adopted = self.request('/api/runner-management/runtime-configurations', {
            **payload, 'runtimeId': runtime['runtimeId'], 'revision': current()['revision'], 'layoutRevision': changed['revision']})
        with self.app.store.connect() as db:
            db.execute('UPDATE directory_deliveries SET layout_revision=?,artifact_digest=? WHERE delivery_id=?', (config['revision'], old_digest, job['deliveryId']))
        error_contains('已采用新版本', '上次下发的仍是其他版本', '重新下发代码')
        changed = self.request(config_route, {**changed, 'name': '再次修改配置', 'directoryTemplate': 'other-root'})
        error_contains('已下发代码与机器采用的配置版本不一致', '编辑 → 保存配置')
        # Older saved bindings can have an assignment but no adopted entry.
        with self.app.store.connect() as db:
            key = 'runtime-config:' + runtime['runtimeId']
            document = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key,)).fetchone()['setting_value'])
            document['executionEntry'] = ''
            db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (json.dumps(document), key))
        error_contains('尚未采用启动文件「' + changed['entryPoint'] + '」', '编辑 → 保存配置')
        self.request(config_route, {**changed, 'entryPoint': '', 'clearEntryPoint': True})
        error_contains('未设置启动文件', '设为执行入口')
        self.assertEqual(current()['assignment']['releaseDigest'], adopted['assignment']['releaseDigest'])

    def test_existing_delivered_file_can_be_selected_as_entry_without_redelivery(self):
        _, config, runner, runtime, payload = self.configured_runtime_fixture()
        self.runner = runner
        def current():
            return next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        repository = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repository['path'])
        (root / 'processor/main.py').write_text('import time\ntime.sleep(60)\n', encoding='utf-8')
        (root / 'processor/alternate.py').write_text('import time\ntime.sleep(61)\n', encoding='utf-8')
        self.app.git(root, 'add', '--', 'processor')
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Two runnable entries')
        commit = self.app.git(root, 'rev-parse', 'HEAD').strip()
        nodes = [{**node, 'gitCommit': commit} if node['id'] == 'main' else node for node in config['nodes']]
        config_route = '/api/runner-management/deployment-configurations/' + config['deploymentId']
        config = self.request(config_route, {**config, 'nodes': nodes, 'entryPoint': '', 'clearEntryPoint': True})
        runtime = self.request('/api/runner-management/runtime-configurations', {
            **payload, 'runtimeId': runtime['runtimeId'], 'revision': current()['revision'], 'layoutRevision': config['revision'], 'concurrency': 1})
        runtime = self.deliver_runtime_fixture(config, runner)
        delivery_id = runtime['binding']['delivery']['deliveryId']
        version_file = runner.directory / 'configured/version.json'
        installed_version = version_file.read_bytes()
        config = self.request(config_route, {**config, 'entryPoint': 'news/alternate.py'})
        runtime = self.request('/api/runner-management/runtime-configurations', {
            **payload, 'runtimeId': runtime['runtimeId'], 'revision': current()['revision'], 'layoutRevision': config['revision'], 'concurrency': 1})
        self.assertNotEqual(runtime['appliedRevision'], runtime['binding']['delivery']['layoutRevision'])
        self.assertTrue(runtime['deliveredCodeMatches'])
        self.assertTrue(runtime['latestCodeMatchesDelivery'])
        route = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        started = self.request(route + '/start', {'revision': runtime['revision']})
        runner.tick()
        self.assertEqual(len(runner.processes), 1)
        self.assertTrue(next(iter(runner.process_info.values()))['entry'].endswith('alternate.py'))
        self.assertEqual(version_file.read_bytes(), installed_version)
        self.assertEqual(started['binding']['delivery']['deliveryId'], delivery_id)
        stopped = self.request(route + '/stop', {'revision': started['revision']})
        runner.tick()
        # No rewrite is needed for metadata changes; a changed directory is real.
        config = self.request(config_route, {**config, 'name': '仅修改名称'})
        stopped = self.request('/api/runner-management/runtime-configurations', {
            **payload, 'runtimeId': stopped['runtimeId'], 'revision': current()['revision'], 'layoutRevision': config['revision'], 'concurrency': 1})
        self.assertTrue(stopped['deliveredCodeMatches'])
        # Actual local tampering remains a Runner-side failure, never overwritten.
        target = runner.directory / 'configured/news/alternate.py'
        target.write_text('tampered = True\n', encoding='utf-8')
        started = self.request(route + '/start', {'revision': stopped['revision']})
        runner.tick()
        self.assertEqual(runner.processes, {})
        reported = next(row for row in self.request('/api/runner-management/runners') if row['runnerId'] == runner.identity['runnerId'])
        self.assertIn('alternate.py', reported['lastError'])
        self.assertEqual(target.read_text(encoding='utf-8'), 'tampered = True\n')
        stopped = self.request(route + '/stop', {'revision': started['revision']})
        config = self.request(config_route, {**config, 'directoryTemplate': 'new-root'})
        stopped = self.request('/api/runner-management/runtime-configurations', {
            **payload, 'runtimeId': stopped['runtimeId'], 'revision': current()['revision'], 'layoutRevision': config['revision'], 'concurrency': 1})
        self.assertFalse(stopped['deliveredCodeMatches'])
        with self.assertRaises(HTTPError) as changed_root:
            self.request(route + '/start', {'revision': stopped['revision']})
        self.assertIn('重新下发代码', json.load(changed_root.exception)['message'])

    def test_deployment_source_node_is_persisted_and_cannot_be_rebound(self):
        code, _, mapped, _ = self.directory_fixture()
        route = '/api/runner-management/deployment-configurations'
        origin = {'flowId': 'flow123', 'flowName': '新闻流程', 'stepId': 'step123',
                  'nodeName': '列表抓取', 'configId': mapped['configId']}
        saved = self.request(route, {**mapped, 'name': '节点部署配置', 'pathStyle': 'config',
                                    'sourceNode': origin, 'codeId': code['codeId'], 'directoryTemplate': '{configId}/prod'})
        self.assertEqual(saved['sourceNode'], origin)
        self.assertIsNotNone(datetime.fromisoformat(saved['updatedAt']))
        self.assertEqual(saved['codeId'], code['codeId'])
        endpoint = route + '/' + saved['deploymentId']
        self.assertEqual(self.request(endpoint)['sourceNode'], origin)
        changed = self.request(endpoint, {**saved, 'pathStyle': 'queue', 'directoryTemplate': '{queue}', 'updatedAt': 'invented'})
        self.assertIsNotNone(datetime.fromisoformat(changed['updatedAt']))
        self.assertEqual(changed['sourceNode'], origin)
        self.assertEqual(changed['codeId'], code['codeId'])
        # Existing clients may omit new metadata; preserve it on edit.
        without_origin = {key: value for key, value in changed.items() if key != 'sourceNode'}
        changed = self.request(endpoint, without_origin)
        self.assertEqual(changed['sourceNode'], origin)
        for updates in ({'configId': 'other'}, {'sourceNode': None},
                        {'sourceNode': {**origin, 'stepId': 'other'}}):
            with self.assertRaises(HTTPError):
                self.request(endpoint, {**changed, **updates})
        self.assertEqual(self.request(endpoint)['sourceNode'], origin)

    def test_deployment_reuse_keeps_shared_machine_binding_when_one_queue_is_removed(self):
        code, config, runner, runtime, payload = self.configured_runtime_fixture('first')
        second = self.request('/api/runner-management/deployment-configurations', {**config, 'name': '第二目录', 'directoryTemplate': 'second', 'queueName': 'second_queue'})
        other = self.request('/api/runner-management/runtime-configurations', {**payload, 'deploymentId': second['deploymentId'], 'layoutRevision': second['revision']})
        self.assertEqual(len(self.request('/api/runner-management/runtime-configurations')), 2)
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/remove', {'revision': runtime['revision']})
        remaining = self.request('/api/runner-management/runtime-configurations')
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]['runtimeId'], other['runtimeId'])
        self.assertIsNotNone(remaining[0]['binding'])

    def test_named_deployment_migration_reuses_successful_partial_delivery_baseline(self):
        code, route, mapped, _ = self.directory_fixture()
        mapped['directoryTemplate'] = '{configId}/prod'
        self.request(route, mapped)
        runner = Runner(Path(self.tmp.name) / 'baseline-migration-runner', self.url); runner.enroll()
        self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'], 'scriptDigest': code['scriptDigest'], 'environment': 'test', 'concurrency': 1})
        old_route = '/api/runner-management/directory-bindings/config/mapped123/' + runner.identity['runnerId']
        preview = self.request(old_route + '/delivery-preview')
        first = self.request(old_route + '/deliver', {'revision': preview['revision'], 'scope': 'all'})
        from backend.runner_management.directory_download import install_delivery
        installed = Path(install_delivery(runner, first))
        job_route = '/api/runners/me/directory-deliveries/' + first['deliveryId']
        self.request(job_route + '/claim', {}, token=runner.identity['token'])
        self.request(job_route + '/result', {'status': 'success', 'installedPath': str(installed)}, token=runner.identity['token'])
        config = self.request('/api/runner-management/deployment-configurations')[0]
        config = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'], {**config, 'name': '兼容旧下发记录'})
        new_route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + runner.identity['runnerId']
        preview = self.request(new_route + '/delivery-preview')
        self.assertEqual(preview['baselineDigest'], first['artifactDigest'])
        second = self.request(new_route + '/deliver', {'revision': preview['revision'], 'scope': 'selected', 'paths': ['shared'], 'baselineDigest': preview['baselineDigest']})
        self.assertEqual(Path(install_delivery(runner, second)), installed)
        self.assertTrue((installed / 'news/main.py').exists())
        self.assertTrue((installed / 'shared/helper.py').exists())
        self.assertEqual(self.request('/api/runner-management/assignments')[0]['scriptDigest'], code['scriptDigest'])

    def test_unified_runtime_preserves_existing_processor_queue_without_node_code(self):
        config = self.request('/api/runner-management/deployment-configurations', {'name': '连接检查配置', 'pathStyle': 'custom',
            'directoryTemplate': 'connection-check', 'entryPoint': '', 'nodes': []})
        runner = Runner(Path(self.tmp.name) / 'existing-processor-runner', self.url); runner.enroll()
        processor = self.request('/api/runner-management/releases/processors', {'processorType': 'probe'})
        assignment = self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'], 'queue': 'existing_probe',
            'processorType': 'probe', 'releaseDigest': processor['digest'], 'concurrency': 1, 'environment': 'test'})
        old = self.request('/api/runner-management/runtime-configurations')[0]
        bound = self.request('/api/runner-management/runtime-configurations', {'runtimeId': old['runtimeId'], 'revision': old['revision'],
            'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'],
            'environment': 'test', 'concurrency': 3})
        self.assertEqual(bound['assignment']['assignmentId'], assignment['assignmentId'])
        self.assertEqual(bound['assignment']['processorType'], 'probe')
        self.assertEqual(bound['assignment']['releaseDigest'], processor['digest'])
        self.assertEqual(bound['assignment']['concurrency'], 3)
        self.assertEqual(len(self.request('/api/runner-management/runtime-configurations')), 1)

    def test_named_deployment_configurations_have_independent_ids_and_search(self):
        _, _, mapped, _ = self.directory_fixture()
        mapped.update(name='新闻抓取生产配置', pathStyle='config', directoryTemplate='{configId}/prod')
        route = '/api/runner-management/deployment-configurations'
        saved = self.request(route, mapped)
        self.assertEqual(len(saved['deploymentId']), 32)
        self.assertNotEqual(saved['deploymentId'], mapped['configId'])
        self.assertEqual(saved['name'], '新闻抓取生产配置')
        self.assertEqual(saved['nodes'], mapped['nodes'])
        self.assertEqual(self.request(route + '?keyword=' + quote('抓取生产')), [saved])
        renamed = self.request(route + '/' + saved['deploymentId'], {**saved, 'name': '新闻采集正式环境'})
        self.assertEqual(renamed['deploymentId'], saved['deploymentId'])
        self.assertNotEqual(renamed['revision'], saved['revision'])
        self.assertEqual(self.request(route + '?keyword=' + saved['deploymentId']), [renamed])
        with self.assertRaises(HTTPError) as stale:
            self.request(route + '/' + saved['deploymentId'], saved)
        self.assertEqual(stale.exception.code, 409)
        for change in ({'name': ''}, {'directoryTemplate': '../outside'}, {'directoryTemplate': '{queue}', 'queueName': ''}):
            with self.assertRaises(HTTPError) as invalid:
                self.request(route, {**mapped, **change})
            self.assertEqual(invalid.exception.code, 400)

    def test_deployment_runtime_binding_uses_complete_tree_and_environment(self):
        code, config, runner, runtime, payload = self.configured_runtime_fixture('{configId}/test')
        self.assertEqual(runtime['assignment']['directoryTemplate'], 'mapped123/test')
        self.assertEqual(runtime['assignment']['concurrency'], 2)
        self.assertEqual(runtime['assignment']['environment'], 'test')
        self.assertFalse(runtime['assignment']['enabled'])
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(runtime['assignment']['releaseDigest']))) as archive:
            self.assertIn('news/main.py', archive.namelist())
            self.assertIn('shared/helper.py', archive.namelist())
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['entry'], 'news/main.py')
            self.assertEqual(manifest['registryKey'], '@deployment:' + config['deploymentId'])
        self.assertFalse((runner.directory / 'mapped123/test/news/main.py').exists())
        partial = self.deliver_runtime_fixture(config, runner, 'selected', ['shared'])
        self.assertTrue((runner.directory / 'mapped123/test/shared/helper.py').exists())
        self.assertFalse((runner.directory / 'mapped123/test/news/main.py').exists())
        route = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        started = self.request(route + '/start', {'revision': partial['revision']})
        cache, program = runner.prepare(started['assignment']['releaseDigest'])
        with self.assertRaises(ValueError): runner.program_directory(cache, program)
        self.request(route + '/stop', {'revision': started['revision']})
        current = self.deliver_runtime_fixture(config, runner)
        started = self.request(route + '/start', {'revision': current['revision']})
        self.assertEqual(runner.program_directory(cache, program), runner.directory / 'mapped123/test')
        changed = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'], {**config, 'name': '修改后目录', 'directoryTemplate': '{configId}/prod'})
        current = next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        self.assertEqual(current['directoryTemplate'], 'mapped123/test')
        updated = self.request('/api/runner-management/runtime-configurations', {**payload, 'runtimeId': current['runtimeId'], 'revision': current['revision'], 'layoutRevision': changed['revision']})
        self.assertFalse(updated['assignment']['enabled'])
        self.assertEqual(updated['directoryTemplate'], 'mapped123/prod')

    def test_deployment_public_directory_binding_and_manual_delivery(self):
        _, _, mapped, _ = self.directory_fixture()
        config = self.request('/api/runner-management/deployment-configurations', {**mapped, 'name': '公共模块', 'pathStyle': 'custom',
                              'directoryTemplate': 'shared/python', 'entryPoint': ''})
        runner = Runner(Path(self.tmp.name) / 'public-config-runner', self.url); runner.enroll()
        runtime = self.request('/api/runner-management/runtime-configurations', {'deploymentId': config['deploymentId'],
            'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1})
        self.assertIsNone(runtime['assignment'])
        with self.assertRaises(HTTPError) as directory_only:
            self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': runtime['revision']})
        self.assertEqual(directory_only.exception.code, 422)
        with self.assertRaises(HTTPError) as duplicate:
            self.request('/api/runner-management/runtime-configurations', {'deploymentId': config['deploymentId'],
                'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1})
        self.assertEqual(duplicate.exception.code, 409)
        self.assertEqual(self.request('/api/runners/me/assignments', token=runner.identity['token']), [])
        route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + runner.identity['runnerId']
        preview = self.request(route + '/delivery-preview')
        self.assertEqual(preview['targetPath'], 'shared/python')
        job = self.request(route + '/deliver', {'revision': preview['revision'], 'scope': 'selected', 'paths': ['shared'], 'baselineDigest': None})
        from backend.runner_management.directory_download import install_delivery
        installed = Path(install_delivery(runner, job))
        self.assertTrue((installed / 'shared/helper.py').exists())
        self.assertFalse((installed / 'news/main.py').exists())
        self.assertTrue((installed / 'version.json').exists())

    def test_deployment_projection_keeps_old_assignments_until_explicit_save(self):
        code, route, mapped, _ = self.directory_fixture()
        mapped['directoryTemplate'] = '{configId}/prod'
        self.request(route, mapped)
        runner = Runner(Path(self.tmp.name) / 'legacy-config-runner', self.url); runner.enroll()
        assignment = self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'],
            'scriptDigest': code['scriptDigest'], 'environment': 'production', 'concurrency': 1})
        tables = ('settings', 'assignments', 'code_runtime_bindings', 'directory_runner_bindings')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        configs = self.request('/api/runner-management/deployment-configurations')
        rows = self.request('/api/runner-management/runtime-configurations')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['assignment']['assignmentId'], assignment['assignmentId'])
        with self.app.store.connect() as db:
            self.assertEqual(before, {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables})
        config = next(item for item in configs if item['legacyOwner'] == code['configId'])
        edited = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'],
                              {**config, 'name': '已命名的旧配置', 'directoryTemplate': '{configId}/alternate'})
        current = self.request('/api/runner-management/runtime-configurations')[0]
        self.assertEqual(current['binding']['bindingType'], 'deployment')
        delivery_route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + runner.identity['runnerId']
        preview = self.request(delivery_route + '/delivery-preview')
        self.assertEqual(preview['targetPath'], 'mapped123/alternate')
        job = self.request(delivery_route + '/deliver', {'revision': preview['revision'], 'scope': 'all'})
        from backend.runner_management.directory_download import install_delivery
        installed = Path(install_delivery(runner, job))
        self.assertTrue((installed / 'shared/helper.py').is_file())
        registry = json.loads((installed / 'version.json').read_text(encoding='utf-8'))
        self.assertIn('mapped123|news_list|', registry['current'])
        job_route = '/api/runners/me/directory-deliveries/' + job['deliveryId']
        self.request(job_route + '/claim', {}, token=runner.identity['token'])
        self.request(job_route + '/result', {'status': 'success', 'installedPath': str(installed)}, token=runner.identity['token'])
        self.assertEqual(self.request('/api/runner-management/assignments')[0]['scriptDigest'], code['scriptDigest'])
        config = edited
        rows = self.request('/api/runner-management/runtime-configurations')
        migrated = self.request('/api/runner-management/runtime-configurations', {'runtimeId': rows[0]['runtimeId'], 'revision': rows[0]['revision'],
            'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'],
            'codeId': code['codeId'], 'environment': 'production', 'concurrency': 1})
        self.assertEqual(migrated['assignment']['assignmentId'], assignment['assignmentId'])
        self.assertEqual(len(self.request('/api/runner-management/runtime-configurations')), 1)

    def test_node_binding_uses_selected_entry_without_guessing_code_and_preserves_assignment(self):
        code, _, mapped, _ = self.directory_fixture()
        origin = {'flowId': 'flow1', 'flowName': '流程', 'stepId': 'step1', 'nodeName': '节点', 'configId': mapped['configId']}
        config = self.request('/api/runner-management/deployment-configurations', {**mapped, 'codeId': '', 'sourceNode': origin, 'name': '节点入口', 'pathStyle': 'config', 'directoryTemplate': '{configId}/test'})
        runner = Runner(Path(self.tmp.name) / 'node-runner', self.url); runner.enroll()
        route = '/api/runner-management/runtime-configurations'
        payload = {'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1}
        runtime = self.request(route, payload)
        self.assertEqual(runtime['assignment']['codeId'], '')
        self.assertEqual(runtime['entryPoint'], 'news/main.py')
        self.assertEqual(runtime['assignment']['processorType'], 'deployment-entry')
        updated = self.request(route, {**payload, 'runtimeId': runtime['runtimeId'], 'revision': runtime['revision'], 'concurrency': 3})
        self.assertEqual(updated['assignmentId'], runtime['assignmentId'])
        self.assertEqual(updated['assignment']['concurrency'], 3)
        self.assertFalse(updated['assignment']['enabled'])

    def test_node_binding_missing_matching_code_does_not_start_another_node(self):
        _, _, mapped, _ = self.directory_fixture()
        config = self.request('/api/runner-management/deployment-configurations', {**mapped, 'name': '缺失入口', 'pathStyle': 'custom', 'directoryTemplate': 'missing', 'entryPoint': 'missing.py'})
        runner = Runner(Path(self.tmp.name) / 'missing-entry-runner', self.url); runner.enroll()
        with self.assertRaises(HTTPError) as invalid:
            self.request('/api/runner-management/runtime-configurations', {'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1})
        self.assertEqual(invalid.exception.code, 422)
        self.assertIn('启动文件', json.load(invalid.exception)['message'])
        self.assertEqual(self.request('/api/runner-management/runtime-configurations'), [])
        self.assertEqual(self.request('/api/runner-management/assignments'), [])

    def test_deployment_runtime_failures_roll_back_and_other_environment_stays_active(self):
        code, config, runner, runtime, payload = self.configured_runtime_fixture()
        route = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        self.request(route + '/remove', {'revision': runtime['revision']})
        self.request('/api/runner-management/site-scripts/bind', {'configId': code['configId'], 'queueName': code['queueName'], 'environment': 'prd', 'scriptDigest': code['scriptDigest']})
        for change in ({'runnerId': 'missing'}, {'codeId': 'missing'}, {'concurrency': 0}, {'layoutRevision': 'stale'}):
            with self.assertRaises(HTTPError): self.request('/api/runner-management/runtime-configurations', {**payload, **change})
            self.assertEqual(self.request('/api/runner-management/runtime-configurations'), [])
            self.assertEqual(self.request('/api/runner-management/assignments'), [])
        runtime = self.request('/api/runner-management/runtime-configurations', payload)
        production = self.request('/api/runner-management/site-scripts/bindings?configId=mapped123&queueName=news_list&environment=prd')
        self.assertEqual(production[0]['scriptDigest'], code['scriptDigest'])
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/remove', {'revision': runtime['revision']})
        self.assertEqual(self.request('/api/runner-management/runtime-configurations'), [])
        self.assertEqual(self.request('/api/runner-management/assignments'), [])

    def test_named_directory_views_are_independent_and_support_shared_folders(self):
        _, _, mapped, _ = self.directory_fixture()
        site_code = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'mapped123', 'queueName': 'news_list', 'siteHost': 'www.example.com',
            'codeType': 'site', 'code': 'def scrape(url):\n    return []\n',
        })
        config_route = '/api/runner-management/directory-layouts/configs/mapped123'
        queue_route = '/api/runner-management/directory-layouts/queues/news_list'
        config, queue = self.request(config_route), self.request(queue_route)
        website_route = '/api/runner-management/directory-layouts/website?owner=WWW.EXAMPLE.COM'
        custom_route = '/api/runner-management/directory-layouts/custom?owner=shared%2Fpython'
        website, custom = self.request(website_route), self.request(custom_route)
        self.assertTrue(website['isNew']); self.assertTrue(custom['isNew'])
        self.assertEqual(self.request('/api/runner-management/directory-layouts/owners'), [])
        self.assertEqual(website['ownerId'], 'www.example.com')
        self.assertEqual(website['codeId'], site_code['codeId'])
        self.assertEqual(website['entryPoint'], site_code['deliveryPath'])
        self.assertTrue(website['nodes'], 'The website view should reuse its existing code mapping')
        self.assertEqual(custom['directoryTemplate'], 'shared/python')
        self.assertEqual(custom['codeId'], '')
        custom.update(nodes=mapped['nodes'], entryPoint='', directoryTemplate='shared/python/prod')
        saved = self.request(custom_route, custom)
        self.assertFalse(saved['isNew'])
        self.assertEqual(saved['nodes'], mapped['nodes'])
        self.assertEqual(saved['entryPoint'], '')
        self.assertEqual(self.request(custom_route), saved)
        self.assertEqual(self.request('/api/runner-management/directory-layouts/custom?owner=SHARED%2FPYTHON'), saved)
        website['directoryTemplate'] = '{website}/test'
        saved_website = self.request(website_route, website)
        self.assertEqual(self.request(website_route), saved_website)
        self.assertEqual(self.request(config_route), config)
        self.assertEqual(self.request(queue_route), queue)
        self.assertEqual(self.request('/api/runner-management/directory-layouts/owners'), [
            {'bindingType': 'custom', 'ownerId': 'shared/python'},
            {'bindingType': 'website', 'ownerId': 'www.example.com'}])
        with self.assertRaises(HTTPError) as conflict:
            self.request(custom_route, custom)
        self.assertEqual(conflict.exception.code, 409)
        for change in ({'ownerId': 'other/path'}, {'queueName': 'news_list'},
                       {'directoryTemplate': '{configId}/shared'}, {'directoryTemplate': '{website}/shared'},
                       {'directoryTemplate': '../outside'}, {'entryPoint': None}):
            with self.assertRaises(HTTPError) as invalid:
                self.request(custom_route, {**saved, **change})
            self.assertEqual(invalid.exception.code, 400)
        for binding_type, owner in [('website', 'https://www.example.com/list'), ('website', 'example..com'),
                                    ('custom', '../outside'), ('custom', 'E:/runner'), ('custom', 'logs/shared'),
                                    ('custom', 'shared/{queue}')]:
            with self.assertRaises(HTTPError) as invalid:
                self.request('/api/runner-management/directory-layouts/' + binding_type + '?owner=' + quote(owner, safe=''))
            self.assertEqual(invalid.exception.code, 400)
        with self.app.store.connect() as db:
            keys = [row['setting_key'] for row in db.execute("SELECT setting_key FROM settings WHERE setting_key LIKE 'directory-layout:%'").fetchall()]
        self.assertTrue(all(len(key) <= 100 for key in keys))

    def test_deployment_entry_survives_added_mapping_and_omitted_or_empty_entry(self):
        _, _, mapped, _ = self.directory_fixture()
        saved = self.request('/api/runner-management/deployment-configurations', {
            **mapped, 'name': '保留执行入口', 'pathStyle': 'custom', 'directoryTemplate': 'entry-preservation'})
        route = '/api/runner-management/deployment-configurations/' + saved['deploymentId']
        main = next(node for node in saved['nodes'] if node['id'] == 'main')
        added = {**main, 'id': 'added', 'kind': 'file', 'name': 'extra.py',
                 'sourceType': 'file', 'sourcePath': 'processor/main.py'}
        payload = {**saved, 'nodes': [*saved['nodes'], added]}
        payload.pop('entryPoint')
        saved = self.request(route, payload)
        self.assertEqual(saved['entryPoint'], 'news/main.py')
        self.assertEqual(saved['nodes'][-1], added)
        saved = self.request(route, {**saved, 'entryPoint': '',
            'nodes': [*saved['nodes'], {'id': 'assets', 'parentId': '', 'name': 'assets', 'kind': 'folder'}]})
        self.assertEqual(saved['entryPoint'], 'news/main.py')
        renamed = [{**node, 'name': 'crawler'} if node['id'] == 'main' else node for node in saved['nodes']]
        saved = self.request(route, {**saved, 'entryPoint': '', 'nodes': renamed})
        self.assertEqual(saved['entryPoint'], 'crawler/main.py')
        # Clearing is a deliberate operation, and the action itself is never stored.
        cleared = self.request(route, {**saved, 'entryPoint': '', 'clearEntryPoint': True})
        self.assertEqual(cleared['entryPoint'], '')
        self.assertNotIn('clearEntryPoint', cleared)
        saved = self.request(route, {**cleared, 'entryPoint': saved['entryPoint']})
        removed = self.request(route, {**saved, 'entryPoint': '',
            'nodes': [node for node in saved['nodes'] if node['id'] != 'main']})
        self.assertEqual(removed['entryPoint'], '')
        self.assertTrue(any(node['id'] == 'added' for node in removed['nodes']))

    def test_switching_to_directory_only_deployment_does_not_keep_old_entry_program(self):
        _, original, runner, runtime, payload = self.configured_runtime_fixture()
        self.runner = runner
        other = self.request('/api/runner-management/deployment-configurations', {
            **original, 'name': '仅下发目录', 'entryPoint': '', 'directoryTemplate': 'shared-modules'})
        switched = self.request('/api/runner-management/runtime-configurations', {
            **payload, 'runtimeId': runtime['runtimeId'], 'revision': runtime['revision'],
            'deploymentId': other['deploymentId'], 'layoutRevision': other['revision']})
        self.assertEqual(switched['entryPoint'], '')
        self.assertIsNone(switched['assignment'])
        self.assertEqual(switched['assignmentId'], '')
        self.assertEqual(self.request('/api/runner-management/assignments'), [])
        self.assertEqual(self.request('/api/runner-management/deployment-configurations/' + original['deploymentId'])['entryPoint'], original['entryPoint'])
        with self.assertRaises(HTTPError) as error:
            self.request('/api/runner-management/runtime-configurations/' + switched['runtimeId'] + '/start', {'revision': switched['revision']})
        self.assertEqual(error.exception.code, 422)

    def test_named_directory_bindings_create_views_atomically_and_keep_execution_unchanged(self):
        self.directory_fixture()
        first = Runner(Path(self.tmp.name) / 'named-runner-one', self.url)
        second = Runner(Path(self.tmp.name) / 'named-runner-two', self.url)
        first.enroll(); second.enroll()
        first_id, second_id = first.identity['runnerId'], second.identity['runnerId']
        route = '/api/runner-management/directory-bindings'
        tables = ('releases', 'code_versions', 'code_runtime_bindings', 'assignments')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        with self.assertRaises(HTTPError) as missing:
            self.request(route, {'bindingType': 'custom', 'ownerId': 'shared/python', 'runnerId': 'missing'})
        self.assertEqual(missing.exception.code, 404)
        self.assertEqual(self.request('/api/runner-management/directory-layouts/owners'), [])
        custom = self.request(route, {'bindingType': 'custom', 'ownerId': 'shared/python', 'runnerId': first_id})
        website = self.request(route, {'bindingType': 'website', 'ownerId': 'WWW.EXAMPLE.COM', 'runnerId': first_id})
        self.assertEqual(website['ownerId'], 'www.example.com')
        self.request(route, {'bindingType': 'custom', 'ownerId': 'SHARED/PYTHON', 'runnerId': second_id})
        self.assertEqual(len(self.request(route)), 3)
        for kind, owner in [('custom', 'SHARED/PYTHON'), ('website', 'www.example.com')]:
            with self.assertRaises(HTTPError) as duplicate:
                self.request(route, {'bindingType': kind, 'ownerId': owner, 'runnerId': first_id})
            self.assertEqual(duplicate.exception.code, 409)
        views = first.get('/api/runners/me/directory-layouts')
        self.assertEqual({(view['bindingType'], view['ownerId']) for view in views},
                         {('custom', 'shared/python'), ('website', 'www.example.com')})
        self.assertEqual([view['ownerId'] for view in second.get('/api/runners/me/directory-layouts')], ['shared/python'])
        custom_route = '/api/runner-management/directory-layouts/custom?owner=shared%2Fpython'
        saved = self.request(custom_route)
        saved['directoryTemplate'] = 'shared/python/test'
        saved = self.request(custom_route, saved)
        self.assertEqual(second.get('/api/runners/me/directory-layouts'), [saved])
        self.assertEqual(next(row for row in self.request(route) if row['runnerId'] == first_id and row['bindingType'] == 'custom')['directoryTemplate'], 'shared/python/test')
        with urlopen(Request(self.url + route + '/custom/shared%2Fpython/' + first_id, method='DELETE')) as response:
            self.assertEqual(json.load(response), {'ok': True})
        self.assertEqual(first.get('/api/runners/me/directory-layouts'), [self.request('/api/runner-management/directory-layouts/website?owner=www.example.com')])
        self.assertEqual(self.request(custom_route), saved, 'Removing a target must preserve its directory view')
        with self.app.store.connect() as db:
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        self.assertEqual(after, before)
        self.assertEqual(custom['directoryTemplate'], 'shared/python')

    def test_module_entrypoint_preserves_directory_api_errors(self):
        with socket.socket() as port_socket:
            port_socket.bind(('127.0.0.1', 0))
            port = port_socket.getsockname()[1]
        env = {key: value for key, value in os.environ.items() if not key.startswith('RUNNER_DB_')}
        env.update(RUNNER_PORT=str(port), RUNNER_HOST='127.0.0.1', RUNNER_DEV_MODE='1',
                   RUNNER_DATA_DIR=str(Path(self.tmp.name) / 'module-data'),
                   RUNNER_SITE_SCRIPT_REPO=str(Path(self.tmp.name) / 'module-repo'))
        child = subprocess.Popen([sys.executable, '-m', 'backend.runner_management.server'],
                                 cwd=Path(__file__).parents[2], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urlopen(f'http://127.0.0.1:{port}/health', timeout=1) as response:
                        self.assertEqual(response.status, 200)
                    break
                except OSError:
                    if child.poll() is not None or time.monotonic() >= deadline:
                        self.fail('module server failed to start')
                    time.sleep(.05)
            request = Request(f'http://127.0.0.1:{port}/api/runner-management/directory-layouts/' + 'f' * 32 + '/publish',
                              data=json.dumps({'revision': 'missing', 'environment': 'default'}).encode(),
                              headers={'Content-Type': 'application/json'}, method='POST')
            with self.assertRaises(HTTPError) as missing:
                urlopen(request, timeout=5)
            self.assertEqual(missing.exception.code, 404)
            self.assertIn('不存在', json.loads(missing.exception.read())['message'])
        finally:
            child.terminate()
            child.communicate(timeout=5)

    def directory_fixture(self):
        code = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'mapped123', 'queueName': 'news_list', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n',
        })
        repository = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repository['path'])
        (root / 'processor').mkdir()
        (root / 'processor' / 'main.py').write_text("from shared.helper import title\ndef scrape(url):\n    return [{'title': title(), 'url': url}]\n", encoding='utf-8')
        self.app.git(root, 'add', '--', 'processor')
        self.app.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'main')
        main_commit = self.app.git(root, 'rev-parse', 'HEAD').strip()
        shared = self.request('/api/runner-management/settings/code-repos', {
            'name': 'Common', 'path': str(Path(self.tmp.name) / 'common'), 'remoteUrl': '', 'branch': 'main',
        })
        shared_root = Path(shared['path'])
        (shared_root / 'helpers').mkdir()
        (shared_root / 'helpers' / 'helper.py').write_text("def title():\n    return 'snapshot-v1'\n", encoding='utf-8')
        self.app.git(shared_root, 'add', '--', 'helpers')
        self.app.git(shared_root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'shared')
        shared_commit = self.app.git(shared_root, 'rev-parse', 'HEAD').strip()
        route = '/api/runner-management/directory-layouts/' + code['codeId']
        layout = self.request(route)
        self.assertEqual(layout['directoryTemplate'], '{configId}')
        layout.update(directoryTemplate='{environment}/{queue}/{configId}', entryPoint='news/main.py', nodes=[
            {'id': 'main', 'parentId': '', 'name': 'news', 'kind': 'folder', 'repoId': repository['repoId'],
             'sourcePath': 'processor', 'sourceType': 'directory', 'gitCommit': main_commit},
            {'id': 'shared', 'parentId': '', 'name': 'shared', 'kind': 'folder', 'repoId': shared['repoId'],
             'sourcePath': 'helpers', 'sourceType': 'directory', 'gitCommit': shared_commit},
            {'id': 'empty', 'parentId': '', 'name': 'resources', 'kind': 'folder'},
        ])
        return code, route, layout, shared_root

    def test_directory_draft_conflicts_and_invalid_tree(self):
        code, route, layout, _ = self.directory_fixture()
        runner = Runner(Path(self.tmp.name) / 'save-layout-instance', self.url)
        runner.enroll()
        self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'],
            'scriptDigest': code['scriptDigest'], 'environment': 'test', 'concurrency': 1})
        self.request('/api/runner-management/site-scripts/bind', {'configId': code['configId'],
            'queueName': code['queueName'], 'environment': 'prd', 'scriptDigest': code['scriptDigest']})
        tables = ('releases', 'code_versions', 'code_runtime_bindings', 'assignments')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()]
                      for table in tables}
        saved = self.request(route, layout)
        self.assertEqual(self.request(route), saved)
        self.assertNotEqual(saved['revision'], layout['revision'])
        self.assertEqual(len(self.request('/api/runner-management/site-scripts/catalog')), 1)
        with self.app.store.connect() as db:
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()]
                     for table in tables}
        self.assertEqual(after, before, 'Saving a directory view must not publish code or update runtime bindings')
        with self.assertRaises(HTTPError) as stale:
            self.request(route, layout)
        self.assertEqual(stale.exception.code, 409)
        for path in ('../outside', 'E:/outside', 'versions/{configId}', 'code/{configId}', '/absolute'):
            with self.assertRaises(HTTPError) as invalid:
                self.request(route, {**saved, 'directoryTemplate': path})
            self.assertEqual(invalid.exception.code, 400)
        cycle = json.loads(json.dumps(saved))
        cycle['nodes'][0]['parentId'] = 'main'
        with self.assertRaises(HTTPError):
            self.request(route, cycle)
        for name in ('version.json', 'Version.JSON'):
            with self.assertRaises(HTTPError) as reserved:
                self.request(route, {**saved, 'nodes': [*saved['nodes'],
                    {'id': 'reserved', 'parentId': '', 'name': name, 'kind': 'file',
                     'repoId': saved['nodes'][0]['repoId'], 'sourcePath': 'processor/main.py',
                     'sourceType': 'file', 'gitCommit': saved['nodes'][0]['gitCommit']}]})
            self.assertEqual(reserved.exception.code, 400)
        self.assertEqual(self.request(route)['revision'], saved['revision'])

    def test_config_directory_view_reuses_saved_tree_and_isolates_configs_on_shared_queue(self):
        code, legacy_route, layout, _ = self.directory_fixture()
        old = self.request(legacy_route, layout)
        alternate = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'mapped123', 'queueName': 'news_list', 'siteHost': 'www.example.com',
            'codeType': 'site', 'code': 'def scrape(url):\n    return []\n',
        })
        alternate_route = '/api/runner-management/directory-layouts/' + alternate['codeId']
        alternate_draft = self.request(alternate_route)
        alternate_draft = self.request(alternate_route, {**alternate_draft, 'directoryTemplate': '{configId}/alternate'})
        other = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'other456', 'queueName': 'news_list', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n',
        })
        route = '/api/runner-management/directory-layouts/configs/mapped123'
        other_route = '/api/runner-management/directory-layouts/configs/other456'
        initial = self.request(route)
        self.assertEqual({key: value for key, value in initial.items() if key not in ('bindingType', 'revision')},
                         {key: value for key, value in old.items() if key != 'revision'})
        self.assertEqual(initial['bindingType'], 'config')
        self.assertNotIn('runnerIds', initial)
        self.assertEqual(self.request(other_route)['codeId'], other['codeId'])
        self.assertEqual(self.request(other_route)['directoryTemplate'], '{configId}')
        tables = ('releases', 'code_versions', 'code_runtime_bindings', 'assignments')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()]
                      for table in tables}
        saved = self.request(route, {**initial, 'directoryTemplate': '{configId}/prod/{queue}'})
        self.assertEqual(self.request(route), saved)
        self.assertEqual(saved['configId'], 'mapped123')
        self.assertEqual(self.request(other_route)['directoryTemplate'], '{configId}')
        self.assertEqual(self.request(legacy_route), old)
        self.assertEqual(self.request(alternate_route), alternate_draft)
        with self.app.store.connect() as db:
            stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                                ('config-directory-layout:mapped123',)).fetchone()
            self.assertEqual(json.loads(stored['setting_value']), saved)
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()]
                     for table in tables}
        self.assertEqual(after, before)
        for value, status in ((old, 409), ({**saved, 'configId': 'other456'}, 400),
                              ({**saved, 'codeId': other['codeId']}, 400)):
            with self.assertRaises(HTTPError) as invalid:
                self.request(route, value)
            self.assertEqual(invalid.exception.code, status)
        with self.assertRaises(HTTPError) as missing:
            self.request('/api/runner-management/directory-layouts/configs/missing789')
        self.assertEqual(missing.exception.code, 404)
        self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'mapped123', 'queueName': 'another_queue', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n',
        })
        self.assertEqual(self.request(route), saved)

    def test_directory_editor_preserves_runner_bindings_and_runner_reads_only_own_configs(self):
        _, _, _, _ = self.directory_fixture()
        other = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'other456', 'queueName': 'news_list', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n',
        })
        first = Runner(Path(self.tmp.name) / 'binding-first', self.url)
        second = Runner(Path(self.tmp.name) / 'binding-second', self.url)
        first.enroll(); second.enroll()
        first_id, second_id = first.identity['runnerId'], second.identity['runnerId']
        self.assertEqual(first.get('/api/runners/me/configs'), [])
        self.assertEqual(second.get('/api/runners/me/configs'), [])
        route = '/api/runner-management/directory-layouts/configs/mapped123'
        initial = self.request(route)
        with self.app.store.connect() as db:
            for runner_id in (first_id, second_id):
                db.execute('INSERT INTO config_runner_bindings VALUES (?,?,?)', ('mapped123', runner_id, 'existing'))
            db.execute('INSERT INTO config_runner_bindings VALUES (?,?,?)', ('other456', first_id, 'existing'))
            db.execute('INSERT INTO settings VALUES (?,?)', ('config-directory-layout:mapped123',
                       json.dumps({**initial, 'runnerIds': [first_id, second_id]})))
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()]
                      for table in ('releases', 'code_versions', 'code_runtime_bindings', 'assignments', 'config_runner_bindings')}
        self.assertEqual(self.request(route), initial, 'Runner targets cannot affect the editor revision')
        saved = self.request(route, {**initial, 'directoryTemplate': '{configId}/test', 'runnerIds': []})
        self.assertNotIn('runnerIds', saved)
        self.assertEqual(self.request(route), saved)
        self.assertEqual({view['configId'] for view in first.get('/api/runners/me/configs')}, {'mapped123', 'other456'})
        second_views = second.get('/api/runners/me/configs')
        self.assertEqual(len(second_views), 1)
        self.assertEqual(second_views[0]['configId'], 'mapped123')
        self.assertEqual(second_views[0]['runnerIds'], sorted([first_id, second_id]))
        self.assertEqual(second_views[0]['directoryTemplate'], '{configId}/test')
        other_route = '/api/runner-management/directory-layouts/configs/' + other['configId']
        self.request(other_route, {**self.request(other_route), 'directoryTemplate': '{configId}/prod'})
        self.assertEqual({view['configId'] for view in first.get('/api/runners/me/configs')}, {'mapped123', 'other456'})
        with self.assertRaises(HTTPError) as anonymous:
            self.request('/api/runners/me/configs')
        self.assertEqual(anonymous.exception.code, 401)
        with self.app.store.connect() as db:
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()]
                     for table in before}
        self.assertEqual(after, before, 'Directory editing must not change Runner targets or runtime data')
        with self.app.store.connect() as db:
            metadata = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                                            ('config-directory-layout:mapped123',)).fetchone()['setting_value'])
        self.assertEqual(metadata['runnerIds'], [first_id, second_id])

    def test_directory_save_preserves_legacy_explicit_unbinding_without_resurrecting_target(self):
        code, _, _, _ = self.directory_fixture()
        runner = Runner(Path(self.tmp.name) / 'binding-existing-queue', self.url)
        runner.enroll()
        assignment = self.request('/api/runner-management/assignments', {
            'runnerId': runner.identity['runnerId'], 'scriptDigest': code['scriptDigest'],
            'environment': 'test', 'concurrency': 1,
        })
        route = '/api/runner-management/directory-layouts/configs/mapped123'
        layout = self.request(route)
        with self.app.store.connect() as db:
            db.execute('DELETE FROM config_runner_bindings WHERE config_id=?', ('mapped123',))
            db.execute('INSERT INTO settings VALUES (?,?)', ('config-directory-layout:mapped123',
                       json.dumps({**layout, 'runnerIds': []})))
        self.request(route, {**layout, 'directoryTemplate': '{configId}/custom'})
        self.assertNotIn('runnerIds', self.request(route))
        self.assertEqual(runner.get('/api/runners/me/configs'), [])
        self.assertEqual(self.request('/api/runner-management/assignments'), [assignment])

    def test_queue_directory_view_is_independent_of_configs_and_does_not_change_runtime(self):
        code, legacy_route, layout, _ = self.directory_fixture()
        old = self.request(legacy_route, layout)
        config_route = '/api/runner-management/directory-layouts/configs/mapped123'
        config = self.request(config_route, {**self.request(config_route), 'directoryTemplate': '{configId}/prod/{queue}'})
        other = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'other456', 'queueName': 'news_list', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n',
        })
        other_route = '/api/runner-management/directory-layouts/configs/other456'
        other_config = self.request(other_route)
        runner = Runner(Path(self.tmp.name) / 'queue-view-runner', self.url)
        runner.enroll()
        self.request('/api/runner-management/assignments', {
            'runnerId': runner.identity['runnerId'], 'scriptDigest': code['scriptDigest'], 'environment': 'test', 'concurrency': 1})
        tables = ('releases', 'code_versions', 'code_runtime_bindings', 'assignments', 'config_runner_bindings')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        route = '/api/runner-management/directory-layouts/queues/news_list'
        initial = self.request(route)
        self.assertEqual(initial['bindingType'], 'queue')
        self.assertEqual(initial['configId'], '')
        self.assertEqual(initial['queueName'], 'news_list')
        self.assertEqual(initial['directoryTemplate'], '{queue}')
        self.assertNotIn('runnerIds', initial)
        saved = self.request(route, {**initial, 'directoryTemplate': '{queue}/prod'})
        self.assertEqual(self.request(route), saved)
        self.assertEqual(self.request(config_route), config)
        self.assertEqual(self.request(other_route), other_config)
        self.assertEqual(self.request(legacy_route), old)
        for value, status in ((initial, 409), ({**saved, 'directoryTemplate': '{configId}/{queue}'}, 400),
                              ({**saved, 'queueName': 'other_queue'}, 400), ({**saved, 'configId': 'mapped123'}, 400),
                              ({**saved, 'bindingType': 'config'}, 400), ({**saved, 'codeId': 'f' * 32}, 400)):
            with self.assertRaises(HTTPError) as invalid:
                self.request(route, value)
            self.assertEqual(invalid.exception.code, status)
        self.assertEqual(self.request(route), saved)
        with self.app.store.connect() as db:
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        self.assertEqual(after, before)
        self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'third789', 'queueName': 'news_list', 'codeType': 'default', 'code': 'def scrape(url):\n    return []\n'})
        self.assertEqual(self.request(route), saved, 'Publishing another config cannot replace the saved queue view')
        with self.assertRaises(HTTPError) as missing:
            self.request('/api/runner-management/directory-layouts/queues/missing_queue')
        self.assertEqual(missing.exception.code, 404)

    def test_queue_directory_view_supports_full_length_queue_names_and_separate_queue_storage(self):
        self.directory_fixture()
        queue = 'q' * 120
        self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'mapped123', 'queueName': queue, 'codeType': 'default', 'code': 'def scrape(url):\n    return []\n'})
        route = '/api/runner-management/directory-layouts/queues/' + queue
        initial = self.request(route)
        saved = self.request(route, {**initial, 'directoryTemplate': '{queue}/test'})
        self.assertEqual(self.request(route), saved)
        self.assertEqual(self.request('/api/runner-management/directory-layouts/queues/news_list')['directoryTemplate'], '{queue}')
        with self.app.store.connect() as db:
            keys = [row['setting_key'] for row in db.execute("SELECT setting_key FROM settings WHERE setting_key LIKE 'queue-directory-layout:%'").fetchall()]
        self.assertEqual(len(keys), 1)
        self.assertLessEqual(len(keys[0]), 100)

    def test_runtime_binding_api_supports_config_queue_targets_without_changing_execution(self):
        code, _, _, _ = self.directory_fixture()
        self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'other456', 'queueName': 'news_list', 'codeType': 'default', 'code': 'def scrape(url):\n    return []\n'})
        first = Runner(Path(self.tmp.name) / 'runtime-binding-one', self.url)
        second = Runner(Path(self.tmp.name) / 'runtime-binding-two', self.url)
        first.enroll(); second.enroll()
        first_id, second_id = first.identity['runnerId'], second.identity['runnerId']
        self.request('/api/runner-management/assignments', {
            'runnerId': first_id, 'scriptDigest': code['scriptDigest'], 'concurrency': 1, 'environment': 'test'})
        route = '/api/runner-management/directory-bindings'
        initial = self.request(route)
        self.assertEqual(len(initial), 1)
        self.assertEqual((initial[0]['bindingType'], initial[0]['ownerId'], initial[0]['runnerId']), ('config', 'mapped123', first_id))
        config_route = '/api/runner-management/directory-layouts/configs/mapped123'
        queue_route = '/api/runner-management/directory-layouts/queues/news_list'
        config = self.request(config_route)
        queue = self.request(queue_route)
        tables = ('releases', 'code_versions', 'code_runtime_bindings', 'assignments')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        self.request(route, {'bindingType': 'config', 'ownerId': 'mapped123', 'runnerId': second_id})
        queue_binding = self.request(route, {'bindingType': 'queue', 'ownerId': 'news_list', 'runnerId': first_id})
        self.assertEqual(queue_binding['directoryTemplate'], '{queue}')
        self.request(route, {'bindingType': 'config', 'ownerId': 'other456', 'runnerId': first_id})
        self.assertEqual(len(self.request(route)), 4)
        self.assertEqual(self.request(config_route), config, 'Target changes cannot change the editor revision')
        self.assertEqual(self.request(queue_route), queue)
        own = first.get('/api/runners/me/directory-layouts')
        self.assertEqual({(view['bindingType'], view['configId'], view['queueName']) for view in own},
                         {('config', 'mapped123', 'news_list'), ('config', 'other456', 'news_list'), ('queue', '', 'news_list')})
        self.assertEqual(second.get('/api/runners/me/directory-layouts'), [config])
        for input, status in (({'bindingType': 'config', 'ownerId': 'mapped123', 'runnerId': first_id}, 409),
                              ({'bindingType': 'queue', 'ownerId': 'news_list', 'runnerId': first_id}, 409),
                              ({'bindingType': 'invalid', 'ownerId': 'mapped123', 'runnerId': first_id}, 400),
                              ({'bindingType': 'config', 'ownerId': 'missing', 'runnerId': first_id}, 404),
                              ({'bindingType': 'queue', 'ownerId': 'missing', 'runnerId': first_id}, 404),
                              ({'bindingType': 'queue', 'ownerId': 'news_list', 'runnerId': 'missing-runner'}, 404)):
            with self.assertRaises(HTTPError) as invalid:
                self.request(route, input)
            self.assertEqual(invalid.exception.code, status)
        request = Request(self.url + route + '/config/mapped123/' + first_id, method='DELETE')
        with urlopen(request) as response:
            self.assertEqual(json.load(response), {'ok': True})
        self.assertEqual({(view['bindingType'], view['configId']) for view in first.get('/api/runners/me/directory-layouts')},
                         {('config', 'other456'), ('queue', '')})
        self.assertEqual(self.request(config_route), config, 'Explicit unbinding must leave the directory tree untouched')
        self.assertEqual([view['configId'] for view in first.get('/api/runners/me/configs')], ['other456'])
        with urlopen(Request(self.url + route + '/queue/news_list/' + first_id, method='DELETE')) as response:
            self.assertEqual(json.load(response), {'ok': True})
        self.assertEqual([view['configId'] for view in first.get('/api/runners/me/directory-layouts')], ['other456'])
        self.assertEqual(second.get('/api/runners/me/directory-layouts'), [config])
        with self.assertRaises(HTTPError) as removed:
            urlopen(Request(self.url + route + '/queue/news_list/' + first_id, method='DELETE'))
        self.assertEqual(removed.exception.code, 404)
        with self.app.store.connect() as db:
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        self.assertEqual(after, before, 'Directory target bindings must not affect running queues or create releases')

    def test_runtime_binding_api_requires_admin_and_runner_identity(self):
        self.directory_fixture()
        route = '/api/runner-management/directory-bindings'
        with patch.dict(os.environ, {'RUNNER_DEV_MODE': '0', 'RUNNER_AUTH_URL': self.url + '/test-auth'}):
            for method in ('GET', 'POST', 'DELETE'):
                path = route + '/config/mapped123/missing' if method == 'DELETE' else route
                request = Request(self.url + path, method=method, data=b'{}' if method == 'POST' else None,
                                  headers={'Content-Type': 'application/json'})
                with self.assertRaises(HTTPError) as unauthorized:
                    urlopen(request)
                self.assertEqual(unauthorized.exception.code, 401)
            with patch('backend.runner_management.server.urlopen', side_effect=lambda *args, **kwargs:
                       io.BytesIO(json.dumps({'code': '0', 'data': {'roles': ['viewer']}}).encode())):
                with urlopen(Request(self.url + route, headers={'Access-Token': 'test-viewer'})) as response:
                    self.assertEqual(json.load(response), [])
                for method in ('POST', 'DELETE'):
                    path = route + '/config/mapped123/missing' if method == 'DELETE' else route
                    request = Request(self.url + path, method=method, data=b'{}' if method == 'POST' else None,
                                      headers={'Content-Type': 'application/json', 'Access-Token': 'test-viewer'})
                    with self.assertRaises(HTTPError) as forbidden:
                        urlopen(request)
                    self.assertEqual(forbidden.exception.code, 403)
        with self.assertRaises(HTTPError) as anonymous:
            self.request('/api/runners/me/directory-layouts')
        self.assertEqual(anonymous.exception.code, 401)

    def test_directory_package_pins_two_repos_and_executes_on_runner(self):
        code, route, layout, shared_root = self.directory_fixture()
        tree = self.request('/api/runner-management/settings/code-repos/' + layout['nodes'][1]['repoId'] + '/tree')
        self.assertIn('helpers', [item['path'] for item in tree['items'] if item['kind'] == 'directory'])
        self.request('/api/runner-management/site-scripts/bind', {'configId': 'mapped123', 'queueName': 'news_list',
            'environment': 'prd', 'scriptDigest': code['scriptDigest']})
        runner = Runner(Path(self.tmp.name) / 'directory-instance', self.url)
        runner.enroll()
        old_assignment = self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'],
            'scriptDigest': code['scriptDigest'], 'environment': 'test', 'concurrency': 1})
        saved = self.request(route, layout)
        # Worktree and HEAD move forward; selected common-code snapshot stays pinned.
        (shared_root / 'helpers' / 'helper.py').write_text("def title():\n    return 'snapshot-v2'\n")
        self.app.git(shared_root, 'add', '--', 'helpers')
        self.app.git(shared_root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'next')
        version = self.request(route + '/publish', {'revision': saved['revision'], 'environment': 'test'})
        repeated = self.request(route + '/publish', {'revision': saved['revision'], 'environment': 'test'})
        self.assertEqual(repeated['scriptDigest'], version['scriptDigest'])
        self.assertEqual(len(self.request('/api/runner-management/site-scripts/catalog')), 2)
        self.assertEqual(version['storagePath'], 'processor/main.py')
        production = self.request('/api/runner-management/site-scripts/bindings?configId=mapped123&queueName=news_list&environment=prd')
        self.assertEqual(production[0]['scriptDigest'], code['scriptDigest'])
        assignment = runner.get('/api/runners/me/assignments')[0]
        self.assertEqual(assignment['scriptDigest'], version['scriptDigest'])
        # Current source already supports bundles, so repeated publish retains its worker digest.
        self.assertEqual(assignment['releaseDigest'], old_assignment['releaseDigest'])
        loader_path = Path(__file__).parents[1] / 'legacy_qinlongclaw/link_extractor/core/managed_script.py'
        spec = importlib.util.spec_from_file_location('mapped_loader', loader_path)
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        env = {'RUNNER_WORKER_TOKEN': assignment['workerToken'], 'RUNNER_MANAGEMENT_URL': self.url,
               'RUNNER_PUBLIC_KEY': runner.identity['publicKey'], 'RUNNER_QUEUE': 'news_list',
               'RUNNER_ENVIRONMENT': 'test', 'RUNNER_SCRIPT_CACHE': str(runner.directory / 'code'),
               'RUNNER_INSTANCE_DIR': str(runner.directory)}
        with patch.dict(os.environ, env):
            downloaded = loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'})
            self.assertEqual(downloaded, runner.directory / 'test/news_list/mapped123/news/main.py')
            package = downloaded.parent.parent
            self.assertTrue((package / 'resources').is_dir())
            self.assertIn('snapshot-v1', (package / 'shared/helper.py').read_text())
            self.assertEqual(loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'}), downloaded)
            registry = json.loads((package / 'version.json').read_text(encoding='utf-8'))
            self.assertEqual(registry['current'], {'mapped123|news_list|': version['scriptDigest']})
            self.assertEqual(len(registry['versions']), 1)
            self.assertEqual(len(registry['versions'][0]['sources']), 2)
            self.assertFalse((package / version['scriptDigest'][7:]).exists())
            legacy = Path(__file__).parents[1] / 'legacy_qinlongclaw'
            script = "import sys;sys.path[:0]=[sys.argv[1],sys.argv[1]+'/link_extractor'];from core.site_script_loader import run_site_script;from pathlib import Path;print(run_site_script(Path(sys.argv[2]),'https://example.com/news'))"
            result = subprocess.run([sys.executable, '-c', script, str(legacy), str(downloaded)], env=os.environ.copy(),
                                    capture_output=True, text=True, check=True, timeout=15)
            self.assertIn('snapshot-v1', result.stdout)
            # Old queued tasks retain their explicit immutable script version.
            old = loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news', 'ScriptDigest': code['scriptDigest']})
            self.assertIn(b'return []', old._managed_bundle['files'][old._managed_bundle['manifest']['entry']])
            # A running task keeps the bytes it resolved, even when its entry
            # is renamed and the fixed directory is updated before execution.
            ready, go = runner.directory / 'ready', runner.directory / 'go'
            held_script = """import json,sys,time
from pathlib import Path
sys.path[:0]=[sys.argv[1],sys.argv[1]+'/link_extractor']
from core.managed_script import resolve
from core.site_script_loader import run_site_script
path=resolve({'ConfigId':'mapped123','Url':'https://example.com/news'})
Path(sys.argv[2]).write_text('ready')
deadline=time.monotonic()+20
while not Path(sys.argv[3]).exists():
    if time.monotonic()>deadline: raise TimeoutError('test update did not complete')
    time.sleep(.02)
print(json.dumps(run_site_script(path,'https://example.com/news')))
"""
            held = subprocess.Popen([sys.executable, '-c', held_script, str(legacy), str(ready), str(go)],
                                    env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 15
                while not ready.exists() and held.poll() is None and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(ready.exists(), 'waiting task failed to resolve its signed snapshot')
                next_layout = json.loads(json.dumps(saved))
                next_layout['nodes'][0]['name'] = 'news_v2'
                next_layout['entryPoint'] = 'news_v2/main.py'
                next_layout['nodes'][1]['gitCommit'] = self.app.git(shared_root, 'rev-parse', 'HEAD').strip()
                next_saved = self.request(route, next_layout)
                next_version = self.request(route + '/publish', {'revision': next_saved['revision'], 'environment': 'test'})
                updated = loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'})
                self.assertEqual(updated, package / 'news_v2/main.py')
                self.assertFalse((package / 'news').exists())
                self.assertIn('snapshot-v2', (package / 'shared/helper.py').read_text())
                registry = json.loads((package / 'version.json').read_text(encoding='utf-8'))
                self.assertEqual(registry['current'], {'mapped123|news_list|': next_version['scriptDigest']})
                self.assertEqual(len(registry['versions']), 2)
                go.write_text('go')
                output, errors = held.communicate(timeout=15)
                self.assertEqual(held.returncode, 0, errors)
                self.assertIn('snapshot-v1', output)
            finally:
                if held.poll() is None:
                    held.kill(); held.communicate(timeout=5)
            historical_script = """import json,sys
sys.path[:0]=[sys.argv[1],sys.argv[1]+'/link_extractor']
from core.managed_script import resolve
from core.site_script_loader import run_site_script
path=resolve({'ConfigId':'mapped123','Url':'https://example.com/news','ScriptDigest':sys.argv[2]})
print(json.dumps(run_site_script(path,'https://example.com/news')))
"""
            result = subprocess.run([sys.executable, '-c', historical_script, str(legacy), version['scriptDigest']],
                                    env=os.environ.copy(), capture_output=True, text=True, check=True, timeout=15)
            self.assertIn('snapshot-v1', result.stdout)
            self.assertIn('snapshot-v2', (package / 'shared/helper.py').read_text())
            # Rollback restores the same fixed path and reuses its history row.
            self.request('/api/runner-management/site-scripts/bind', {'configId': 'mapped123', 'queueName': 'news_list',
                'environment': 'test', 'scriptDigest': version['scriptDigest']})
            self.assertEqual(loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'}), downloaded)
            self.assertFalse((package / 'news_v2').exists())
            self.assertIn('snapshot-v1', (package / 'shared/helper.py').read_text())
            registry = json.loads((package / 'version.json').read_text(encoding='utf-8'))
            self.assertEqual(registry['current'], {'mapped123|news_list|': version['scriptDigest']})
            self.assertEqual(len(registry['versions']), 2)
            (package / 'shared/helper.py').write_text('tampered')
            with self.assertRaisesRegex(ValueError, '缓存被修改'):
                loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'})

    def test_default_directory_publishes_without_creating_runtime_bindings(self):
        code, route, layout, _ = self.directory_fixture()
        saved = self.request(route, {**layout, 'directoryTemplate': '{configId}'})
        version = self.request(route + '/publish', {'revision': saved['revision'], 'environment': 'default'})
        self.assertEqual(version['environment'], 'default')
        self.assertEqual(version['directoryLayout']['directoryTemplate'], '{configId}')
        for environment in ('prd', 'test'):
            self.assertEqual(self.request('/api/runner-management/site-scripts/bindings?configId=mapped123&queueName=news_list&environment=' + environment), [])
        with self.app.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM code_runtime_bindings WHERE environment='default'").fetchone()[0], 0)
        self.assertNotEqual(version['scriptDigest'], code['scriptDigest'])

    def test_config_first_directory_templates_publish_and_install_in_requested_order(self):
        code, route, layout, _ = self.directory_fixture()
        workers = {}
        for environment in ('test', 'production'):
            runner = Runner(Path(self.tmp.name) / ('config-first-' + environment), self.url)
            runner.enroll()
            self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'],
                'scriptDigest': code['scriptDigest'], 'environment': environment, 'concurrency': 1})
            workers['prd' if environment == 'production' else 'test'] = runner
        loader_path = Path(__file__).parents[1] / 'legacy_qinlongclaw/link_extractor/core/managed_script.py'
        spec = importlib.util.spec_from_file_location('config_first_loader', loader_path)
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        for environment, template, expected in (
            ('prd', '{configId}/prod', 'mapped123/prod'),
            ('test', '{configId}/test', 'mapped123/test'),
            ('default', '{configId}/{queue}', 'mapped123/news_list'),
            ('prd', '{configId}/prod/{queue}', 'mapped123/prod/news_list'),
            ('test', '{configId}/{queue}/test', 'mapped123/news_list/test'),
        ):
            with self.subTest(template=template):
                saved = self.request(route, {**layout, 'directoryTemplate': template})
                layout = saved
                version = self.request(route + '/publish', {'revision': saved['revision'], 'environment': environment})
                runner = workers['test' if environment == 'default' else environment]
                assignment = runner.get('/api/runners/me/assignments')[0]
                env = {'RUNNER_WORKER_TOKEN': assignment['workerToken'], 'RUNNER_MANAGEMENT_URL': self.url,
                       'RUNNER_PUBLIC_KEY': runner.identity['publicKey'], 'RUNNER_QUEUE': 'news_list',
                       'RUNNER_ENVIRONMENT': 'test' if environment == 'default' else environment,
                       'RUNNER_SCRIPT_CACHE': str(runner.directory / 'code'), 'RUNNER_INSTANCE_DIR': str(runner.directory)}
                with patch.dict(os.environ, env):
                    path = loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'})
                self.assertEqual(path, runner.directory / expected / 'news/main.py')
                registry = json.loads((runner.directory / expected / 'version.json').read_text(encoding='utf-8'))
                self.assertEqual(registry['current']['mapped123|news_list|'], version['scriptDigest'])

    def test_legacy_script_default_root_matches_editor_without_packages(self):
        loader_path = Path(__file__).parents[1] / 'legacy_qinlongclaw/link_extractor/core/managed_script.py'
        spec = importlib.util.spec_from_file_location('legacy_root_loader', loader_path)
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        legacy = {'kind': 'script', 'configId': '123', 'entry': 'news.py'}
        self.assertEqual(loader.effective_manifest(legacy)['directoryTemplate'], '{configId}')
        self.assertNotIn('directoryTemplate', legacy)
        published = {**legacy, 'layoutSchema': 2, 'directoryTemplate': 'packages/{configId}'}
        self.assertEqual(loader.effective_manifest(published)['directoryTemplate'], 'packages/{configId}')

    def test_default_directory_updates_existing_bindings_and_resolves_without_environment_prefix(self):
        code, route, layout, _ = self.directory_fixture()
        assignments = []
        for environment in ('test', 'production'):
            runner = Runner(Path(self.tmp.name) / ('neutral-' + environment), self.url)
            runner.enroll()
            self.request('/api/runner-management/assignments', {'runnerId': runner.identity['runnerId'],
                'scriptDigest': code['scriptDigest'], 'environment': environment, 'concurrency': 1})
            assignments.append((runner, environment))
        unrelated = self.request('/api/runner-management/site-scripts/publish', {
            'configId': 'other123', 'queueName': 'news_other', 'codeType': 'default',
            'code': 'def scrape(url):\n    return []\n',
        })
        self.request('/api/runner-management/site-scripts/bind', {'configId': 'other123', 'queueName': 'news_other',
            'environment': 'prd', 'scriptDigest': unrelated['scriptDigest']})
        saved = self.request(route, {**layout, 'directoryTemplate': 'custom/{configId}/{queue}'})
        version = self.request(route + '/publish', {'revision': saved['revision'], 'environment': 'default'})
        loader_path = Path(__file__).parents[1] / 'legacy_qinlongclaw/link_extractor/core/managed_script.py'
        spec = importlib.util.spec_from_file_location('neutral_loader', loader_path)
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        for runner, environment in assignments:
            assignment = runner.get('/api/runners/me/assignments')[0]
            self.assertEqual(assignment['scriptDigest'], version['scriptDigest'])
            env = {'RUNNER_WORKER_TOKEN': assignment['workerToken'], 'RUNNER_MANAGEMENT_URL': self.url,
                   'RUNNER_PUBLIC_KEY': runner.identity['publicKey'], 'RUNNER_QUEUE': 'news_list',
                   'RUNNER_ENVIRONMENT': 'prd' if environment == 'production' else 'test',
                   'RUNNER_SCRIPT_CACHE': str(runner.directory / 'code'), 'RUNNER_INSTANCE_DIR': str(runner.directory)}
            with patch.dict(os.environ, env):
                path = loader.resolve({'ConfigId': 'mapped123', 'Url': 'https://example.com/news'})
            self.assertEqual(path, runner.directory / 'custom/mapped123/news_list/news/main.py')
            self.assertTrue((path.parent.parent / 'version.json').is_file())
        other = self.request('/api/runner-management/site-scripts/bindings?configId=other123&queueName=news_other&environment=prd')
        self.assertEqual(other[0]['scriptDigest'], unrelated['scriptDigest'])

    def test_directory_publish_rejects_collisions_and_missing_entry_atomically(self):
        _, route, layout, _ = self.directory_fixture()
        saved = self.request(route, {**layout, 'entryPoint': 'missing.py'})
        with self.assertRaises(HTTPError) as missing:
            self.request(route + '/publish', {'revision': saved['revision'], 'environment': 'test'})
        self.assertEqual(missing.exception.code, 422)
        collision = {**saved, 'entryPoint': 'news/main.py', 'nodes': [*saved['nodes'],
            {'id': 'collision', 'parentId': 'main', 'name': 'main.py', 'kind': 'file',
             'repoId': saved['nodes'][0]['repoId'], 'gitCommit': saved['nodes'][0]['gitCommit'],
             'sourcePath': 'processor/main.py', 'sourceType': 'file'}]}
        saved = self.request(route, collision)
        with self.assertRaises(HTTPError) as duplicate:
            self.request(route + '/publish', {'revision': saved['revision'], 'environment': 'test'})
        self.assertEqual(duplicate.exception.code, 409)
        self.assertEqual(len(self.request('/api/runner-management/site-scripts/catalog')), 1)
        self.assertEqual(self.request('/api/runner-management/site-scripts/bindings?configId=mapped123&queueName=news_list&environment=test'), [])

    def configured_runtime_fixture(self, directory='configured', code_id=None):
        code, _, mapped, _ = self.directory_fixture()
        config = self.request('/api/runner-management/deployment-configurations', {**mapped, 'name': '配置入口测试', 'pathStyle': 'custom', 'directoryTemplate': directory})
        runner = Runner(Path(self.tmp.name) / 'configured-fixture', self.url); runner.enroll()
        payload = {'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'], 'runnerId': runner.identity['runnerId'], 'environment': 'test', 'concurrency': 2}
        if code_id is not None: payload['codeId'] = code_id
        runtime = self.request('/api/runner-management/runtime-configurations', payload)
        return code, config, runner, runtime, payload

    def deliver_runtime_fixture(self, config, runner, scope='all', paths=None):
        route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + runner.identity['runnerId']
        preview = self.request(route + '/delivery-preview')
        self.request(route + '/deliver', {'revision': config['revision'], 'scope': scope, 'paths': paths or [], 'baselineDigest': preview['baselineDigest']})
        runner.deliver_pending()
        return next(row for row in self.request('/api/runner-management/runtime-configurations') if row['deploymentId'] == config['deploymentId'] and row['runnerId'] == runner.identity['runnerId'])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Application(Path(self.tmp.name) / "data", site_script_repo=Path(self.tmp.name) / "site-scripts")
        handler = type("TestHandler", (Handler,), {"application": self.app})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.dev_mode = patch.dict(os.environ, {"RUNNER_DEV_MODE": "1"})
        self.dev_mode.start()
        self.runner = None
        self.bootstrapper = None

    def tearDown(self):
        if self.runner:
            self.runner.close()
        if self.bootstrapper:
            self.bootstrapper.stop()
            if self.bootstrapper.client.logs.thread:
                self.bootstrapper.client.logs.thread.join(timeout=5)
        self.dev_mode.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def request(self, path, payload=None, token=""):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(self.url + path, data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers, method="POST" if payload is not None else "GET")
        with urlopen(req, timeout=5) as response:
            return json.load(response)

    def test_local_development_auto_enrollment(self):
        runner = Runner(Path(self.tmp.name) / "auto-instance", self.url)
        with patch.dict(os.environ, {"RUNNER_DEV_MODE": "0"}):
            with self.assertRaises(RuntimeError) as denied:
                runner.enroll()
            self.assertIn("登记码", str(denied.exception))
        self.assertEqual(os.environ.get("RUNNER_DEV_MODE"), "1")
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        runner.enroll()
        self.assertTrue(runner.identity["runnerId"])

    def load_folder_launcher(self):
        spec = importlib.util.spec_from_file_location('copied_identity_launcher', Path(__file__).parents[1] / 'runner_management/start.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_copied_legacy_identity_enrolls_independent_directory_and_restart_reuses_it(self):
        original = Runner(Path(self.tmp.name) / 'original-instance', self.url)
        original.enroll()
        original.post('/api/runners/me/heartbeat', {'runnerDigest': 'source-local', 'runnerPid': 1234})
        original_bytes = original.identity_path.read_bytes()
        before = self.request('/api/runner-management/runners')[0]
        copied = Path(self.tmp.name) / 'copied-instance'; copied.mkdir()
        legacy = {key: value for key, value in original.identity.items() if key != 'installDirectory'}
        (copied / 'identity.json').write_text(json.dumps(legacy), encoding='utf-8')
        self.assertEqual(original.get('/api/runners/me/status')['installDirectory'], str(original.directory))
        self.assertFalse(Runner(copied, self.url).identity_matches_directory())
        launcher = self.load_folder_launcher()
        with patch.object(sys, 'argv', ['start.py', '--dir', str(copied), '--server', self.url]), patch.object(launcher, 'Bootstrapper') as bootstrap:
            launcher.main()
            bootstrap.return_value.serve.assert_called_once()
        renewed = Runner(copied, self.url)
        self.assertNotEqual(renewed.identity['runnerId'], original.identity['runnerId'])
        self.assertEqual(renewed.identity['installDirectory'], str(copied.resolve()))
        self.assertTrue(renewed.identity_matches_directory())
        renewed.post('/api/runners/me/heartbeat', {'runnerDigest': 'source-local', 'runnerPid': 5678})
        rows = self.request('/api/runner-management/runners')
        self.assertEqual(len(rows), 2)
        self.assertEqual(next(row for row in rows if row['runnerId'] == original.identity['runnerId']), before)
        self.assertEqual(original.identity_path.read_bytes(), original_bytes)
        with patch.object(sys, 'argv', ['start.py', '--dir', str(copied), '--server', self.url]), patch.object(launcher, 'Bootstrapper'):
            launcher.main()
        self.assertEqual(Runner(copied, self.url).identity['runnerId'], renewed.identity['runnerId'])
        self.assertEqual(len(self.request('/api/runner-management/runners')), 2)

    def test_copied_identity_failed_enrollment_preserves_credentials_and_original_instance(self):
        original = Runner(Path(self.tmp.name) / 'original-protected', self.url); original.enroll()
        copied = Path(self.tmp.name) / 'copy-protected'; copied.mkdir()
        identity = copied / 'identity.json'; identity.write_bytes(original.identity_path.read_bytes())
        saved = identity.read_bytes()
        launcher = self.load_folder_launcher()
        with patch.object(sys, 'argv', ['start.py', '--dir', str(copied), '--server', self.url, '--enroll-code', 'invalid']), patch.object(launcher, 'Bootstrapper') as bootstrap:
            with self.assertRaisesRegex(RuntimeError, '登记码'):
                launcher.main()
            bootstrap.assert_not_called()
        self.assertEqual(identity.read_bytes(), saved)
        self.assertEqual(len(self.request('/api/runner-management/runners')), 1)

    def test_same_directory_legacy_identity_is_preserved(self):
        runner = Runner(Path(self.tmp.name) / 'legacy-own-directory', self.url); runner.enroll()
        legacy = {key: value for key, value in runner.identity.items() if key != 'installDirectory'}
        runner.identity_path.write_text(json.dumps(legacy), encoding='utf-8')
        original = runner.identity_path.read_bytes()
        existing = Runner(runner.directory, self.url)
        self.assertTrue(existing.identity_matches_directory())
        self.assertEqual(existing.identity_path.read_bytes(), original)

    def test_explicit_advertised_ip_overrides_network_detection(self):
        with patch.dict(os.environ, {"RUNNER_ADVERTISE_IP": "192.168.1.36"}):
            self.assertEqual(machine_ip("http://127.0.0.1:8092"), "192.168.1.36")
        with patch.dict(os.environ, {"RUNNER_ADVERTISE_IP": "127.0.0.1"}):
            with self.assertRaisesRegex(ValueError, "可访问"):
                machine_ip("http://127.0.0.1:8092")

    def test_runner_offline_after_missed_heartbeats_and_recovers(self):
        runner = Runner(Path(self.tmp.name) / "heartbeat-instance", self.url)
        runner.enroll()
        runner.post("/api/runners/me/heartbeat", {
            "ipAddress": runner.ip_address, "runnerDigest": "source-local",
            "workerDigests": "", "lastError": "",
        })
        runner_id = runner.identity["runnerId"]
        fresh = (datetime.now(timezone.utc) - timedelta(seconds=8)).isoformat(timespec="seconds")
        stale = (datetime.now(timezone.utc) - timedelta(seconds=18)).isoformat(timespec="seconds")
        with self.app.store.connect() as db:
            db.execute("UPDATE runners SET last_heartbeat=? WHERE runner_id=?", (fresh, runner_id))
        self.assertEqual(self.request("/api/runner-management/runners")[0]["status"], "online")
        with self.app.store.connect() as db:
            db.execute("UPDATE runners SET last_heartbeat=? WHERE runner_id=?", (stale, runner_id))
        self.assertEqual(self.request("/api/runner-management/runners")[0]["status"], "offline")
        self.assertEqual(runner.get("/api/runners/me/status")["status"], "offline")
        runner.post("/api/runners/me/heartbeat", {
            "ipAddress": runner.ip_address, "runnerDigest": "source-local",
            "workerDigests": "", "lastError": "",
        })
        self.assertEqual(self.request("/api/runner-management/runners")[0]["status"], "online")

    def test_runner_process_report_validation_and_legacy_heartbeat(self):
        runner = Runner(Path(self.tmp.name) / 'process-report', self.url); runner.enroll()
        base = {'runnerDigest': 'source-local', 'workerDigests': '', 'lastError': ''}
        route = '/api/runners/me/heartbeat'
        worker = {'assignmentId': 'a-1', 'queue': 'news_list', 'slot': 0, 'pid': 3456}
        self.request(route, {**base, 'runnerPid': 1234, 'workerProcesses': [worker]}, token=runner.identity['token'])
        row = self.request('/api/runner-management/runners')[0]
        self.assertEqual(row['runnerPid'], 1234)
        self.assertEqual(row['workerProcesses'], [worker])
        for fields in ({'runnerPid': True}, {'runnerPid': -1}, {'runnerPid': '123'},
                       {'workerProcesses': 'bad'}, {'workerProcesses': [{**worker, 'pid': 0}]},
                       {'workerProcesses': [{**worker, 'slot': -1}]}, {'workerProcesses': [worker, worker]}):
            with self.assertRaises(HTTPError) as invalid:
                self.request(route, {**base, **fields}, token=runner.identity['token'])
            self.assertEqual(invalid.exception.code, 400)
        self.assertEqual(self.request('/api/runner-management/runners')[0]['workerProcesses'], [worker])
        self.request(route, {**base, 'runnerPid': 1235, 'workerProcesses': []}, token=runner.identity['token'])
        self.assertEqual(self.request('/api/runner-management/runners')[0]['workerProcesses'], [])
        self.request(route, base, token=runner.identity['token'])
        row = self.request('/api/runner-management/runners')[0]
        self.assertIsNone(row['runnerPid'])
        self.assertIsNone(row['workerProcesses'])

    def test_runner_release_usage_counts_actual_installed_instances(self):
        release = self.request('/api/runner-management/releases/runners', {})
        first = Runner(Path(self.tmp.name) / 'version-count-first', self.url); first.enroll()
        second = Runner(Path(self.tmp.name) / 'version-count-second', self.url); second.enroll()
        heartbeat = {'runnerDigest': release['digest'], 'lastError': ''}
        first.post('/api/runners/me/heartbeat', heartbeat)
        second.post('/api/runners/me/heartbeat', heartbeat)
        def usage():
            return next(row['usedBy'] for row in self.request('/api/runner-management/releases') if row['digest'] == release['digest'])
        self.assertEqual(usage(), 2)
        second.post('/api/runners/me/heartbeat', {**heartbeat, 'runnerDigest': 'source-local'})
        self.request('/api/runner-management/runners/' + second.identity['runnerId'] + '/desired-runner', {'digest': release['digest']})
        self.assertEqual(usage(), 1)  # Planned upgrades do not count as installed.
        processor = self.request('/api/runner-management/releases/processors', {'processorType': 'probe'})
        self.request('/api/runner-management/assignments', {'runnerId': first.identity['runnerId'], 'queue': 'usage_probe',
            'processorType': 'probe', 'releaseDigest': processor['digest'], 'concurrency': 2, 'environment': 'test'})
        self.assertEqual(next(row['usedBy'] for row in self.request('/api/runner-management/releases') if row['digest'] == processor['digest']), 1)

    def test_existing_runner_store_adds_process_fields_without_changing_identity(self):
        path = Path(self.tmp.name) / 'old-runners.sqlite'
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE runners (runner_id TEXT PRIMARY KEY, name TEXT, ip_address TEXT, '
                       'install_directory TEXT, platform TEXT, capabilities TEXT, token_hash TEXT, '
                       'status TEXT, last_heartbeat TEXT, desired_digest TEXT, actual_digest TEXT, last_error TEXT)')
            db.execute("INSERT INTO runners (runner_id,name,ip_address,install_directory,capabilities,token_hash,status) "
                       "VALUES ('old-runner','original','10.0.0.1','/opt/runner','[]','original-token','offline')")
        db.close()
        store = Store(path); Store(path)
        with store.connect() as db:
            row = dict(db.execute("SELECT * FROM runners WHERE runner_id='old-runner'").fetchone())
        self.assertEqual(row['token_hash'], 'original-token')
        self.assertEqual(row['install_directory'], '/opt/runner')
        self.assertIsNone(row['runner_pid'])
        self.assertIsNone(row['worker_processes'])
        self.assertIsNone(row['os_type'])
        self.assertIsNone(row['os_version'])

    def test_operating_system_enrollment_heartbeat_and_legacy_compatibility(self):
        self.runner = Runner(Path(self.tmp.name) / 'os-report-instance', self.url)
        self.runner.enroll()
        runner_id = self.runner.identity['runnerId']
        row = self.request('/api/runner-management/runners')[0]
        self.assertEqual(row['osType'], self.runner.os_info['osType'])
        self.assertEqual(row['osVersion'], self.runner.os_info['osVersion'] or None)
        report = self.runner.heartbeat_payload()
        self.assertEqual(report['osType'], row['osType'])
        self.runner.post('/api/runners/me/heartbeat', {**report, 'osType': 'Linux', 'osVersion': 'Ubuntu 24.04 LTS · 6.8.0'})
        row = self.request('/api/runner-management/runners')[0]
        self.assertEqual((row['osType'], row['osVersion']), ('Linux', 'Ubuntu 24.04 LTS · 6.8.0'))
        self.runner.post('/api/runners/me/heartbeat', {'runnerDigest': 'old-runner'})
        legacy = self.request('/api/runner-management/runners')[0]
        self.assertEqual(legacy['runnerId'], runner_id)
        self.assertEqual((legacy['osType'], legacy['osVersion']), (row['osType'], row['osVersion']))
        for fields in ({'osType': True}, {'osVersion': {'version': 'bad'}}, {'osType': 'x' * 65}, {'osVersion': 'x' * 256}, {'osVersion': 'bad\nversion'}):
            with self.assertRaisesRegex(RuntimeError, '无效'):
                self.runner.post('/api/runners/me/heartbeat', {**report, **fields})
        current = self.request('/api/runner-management/runners')[0]
        self.assertEqual(current['osVersion'], row['osVersion'])

    def test_runner_reports_pid_when_assignment_fetch_fails(self):
        self.runner = Runner(Path(self.tmp.name) / 'error-heartbeat-pid', self.url)
        self.runner.enroll()
        with patch.object(self.runner, 'get', side_effect=RuntimeError('任务接口暂时不可用')), \
                patch('backend.runner_management.runner.time.sleep', side_effect=lambda _: setattr(self.runner, 'running', False)):
            self.runner.serve()
        row = self.request('/api/runner-management/runners')[0]
        self.assertEqual(row['runnerPid'], os.getpid())
        self.assertEqual(row['workerProcesses'], [])
        self.assertEqual(row['status'], 'error')

    def test_two_instances_same_ip_distinct_directories_and_signed_worker(self):
        enrollment_a = self.request("/api/runner-management/runners/enrollment-codes", {})
        enrollment_b = self.request("/api/runner-management/runners/enrollment-codes", {})
        self.runner = Runner(Path(self.tmp.name) / "instance-a", self.url, 0.5)
        self.runner.enroll(enrollment_a["code"], "127.0.0.1")
        runner_b = Runner(Path(self.tmp.name) / "instance-b", self.url, 0.5)
        runner_b.enroll(enrollment_b["code"], "127.0.0.1")
        rows = self.request("/api/runner-management/runners")
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["runnerId"], rows[1]["runnerId"])
        self.assertNotEqual(rows[0]["installDirectory"], rows[1]["installDirectory"])

        published = self.request("/api/runner-management/releases/processors", {"processorType": "probe"})
        assignment = self.request("/api/runner-management/assignments", {
            "runnerId": self.runner.identity["runnerId"], "queue": "test-queue",
            "processorType": "probe", "releaseDigest": published["digest"],
            "concurrency": 2, "environment": "test", "enabled": True,
        })
        self.runner.tick()
        child = self.runner.processes[assignment["assignmentId"]][1]
        self.assertIsNone(child.poll())
        self.assertIsNone(self.runner.processes[assignment["assignmentId"] + ":1"][1].poll())
        for _ in range(20):
            if "READY queue=test-queue" in (self.runner.directory / "logs" / f"{assignment['assignmentId']}.log").read_text(errors="replace"):
                break
            time.sleep(0.1)
        self.assertIn("READY queue=test-queue", (self.runner.directory / "logs" / f"{assignment['assignmentId']}.log").read_text(errors="replace"))
        runner_rows = self.request("/api/runner-management/runners")
        report = next(row for row in runner_rows if row['runnerId'] == self.runner.identity['runnerId'])
        self.assertTrue(report['lastHeartbeat'])
        self.assertEqual(report['runnerPid'], os.getpid())
        self.assertEqual(report['workerProcesses'], [
            {'assignmentId': assignment['assignmentId'], 'queue': 'test-queue', 'slot': slot,
             'pid': self.runner.processes[assignment['assignmentId'] if slot == 0 else assignment['assignmentId'] + ':1'][1].pid}
            for slot in range(2)
        ])

        data = self.app.artifacts.read(published["digest"])
        verify_artifact(data, published["digest"], published["signature"], self.app.artifacts.public_key)
        with self.assertRaises(ValueError):
            verify_artifact(data + b"tamper", published["digest"], published["signature"], self.app.artifacts.public_key)
        extracted = self.runner.directory / "versions" / published["digest"][7:] / "probe_worker.py"
        extracted.write_text("print('tampered')", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "被修改"):
            self.runner.prepare(published["digest"])
        with self.app.store.connect() as db:
            db.execute('UPDATE assignments SET enabled=0 WHERE assignment_id=?', (assignment['assignmentId'],))
        self.runner.tick()
        stopped = next(row for row in self.request('/api/runner-management/runners') if row['runnerId'] == self.runner.identity['runnerId'])
        self.assertEqual(stopped['workerProcesses'], [])
        self.assertIsNotNone(child.poll())

    def test_copied_folder_can_run_without_project_parent(self):
        source = Path(__file__).parents[1] / "runner_management"
        copied = Path(self.tmp.name) / "arbitrarily-named-runner"
        shutil.copytree(source, copied, ignore=shutil.ignore_patterns("__pycache__", "instance"))
        enrollment = self.request("/api/runner-management/runners/enrollment-codes", {})
        instance = copied / "instance"
        enrolled = Runner(instance, self.url)
        enrolled.enroll(enrollment["code"], "127.0.0.1")
        child = subprocess.Popen([
            sys.executable, str(copied / "start.py"), "--worker", "--dir", str(instance), "--server", self.url,
        ], cwd=copied, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(30):
                status = enrolled.get("/api/runners/me/status")
                if status["actualDigest"] == "source-local" and status["status"] == "online":
                    reported = next(row for row in self.request('/api/runner-management/runners') if row['runnerId'] == enrolled.identity['runnerId'])
                    self.assertEqual(reported['runnerPid'], child.pid)
                    self.assertEqual(reported['workerProcesses'], [])
                    break
                if child.poll() is not None:
                    self.fail("复制后的 Runner 进程提前退出")
                time.sleep(0.1)
            else:
                self.fail("复制后的 Runner 未上报心跳")
        finally:
            child.terminate()
            child.wait(timeout=5)

    def test_publish_then_adopt_script_preserves_old_binding_until_adoption(self):
        body = {"configId": "123", "fileName": "www.realcan.cn.py", "code": "def scrape(url):\n    return []\n", "prompt": "test", "url": "https://www.realcan.cn"}
        published = self.request("/api/runner-management/site-scripts/publish", body)
        self.assertEqual(self.request("/api/runner-management/configs/123/script-release"), None)
        bound = self.request("/api/runner-management/configs/123/script-release", {"scriptDigest": published["scriptDigest"]})
        self.assertEqual(bound["scriptDigest"], published["scriptDigest"])
        self.assertTrue(bound["gitCommit"])

        code_path = (Path(__file__).parents[1] / "legacy_qinlongclaw" / "link_extractor" / "core" / "managed_script.py")
        spec = importlib.util.spec_from_file_location("managed_script_test", code_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        enrollment = self.request("/api/runner-management/runners/enrollment-codes", {})
        runner = Runner(Path(self.tmp.name) / "script-instance", self.url)
        runner.enroll(enrollment["code"], "127.0.0.1")
        probe = self.request("/api/runner-management/releases/processors", {"processorType": "probe"})
        self.request("/api/runner-management/assignments", {
            "runnerId": runner.identity["runnerId"], "queue": "script-test", "processorType": "probe",
            "releaseDigest": probe["digest"], "concurrency": 1, "environment": "test",
        })
        worker_token = runner.get("/api/runners/me/assignments")[0]["workerToken"]
        with patch.dict(os.environ, {
            "RUNNER_WORKER_TOKEN": worker_token, "RUNNER_MANAGEMENT_URL": self.url,
            "RUNNER_PUBLIC_KEY": runner.identity["publicKey"],
            "RUNNER_SCRIPT_CACHE": str(Path(self.tmp.name) / "script-cache"),
            "RUNNER_QUEUE": "script-test", "RUNNER_ENVIRONMENT": "test",
        }):
            path = module.resolve({"ConfigId": "123", "ScriptDigest": published["scriptDigest"]})
            self.assertEqual(path.name, "www.realcan.cn.py")
            self.assertEqual(path.read_text(), body["code"])
            worker_root = Path(__file__).parents[1] / "legacy_qinlongclaw"
            smoke = subprocess.run([
                sys.executable, "-c",
                "import sys; sys.path[:0]=[sys.argv[1],sys.argv[1]+'/link_extractor']; "
                "from core.site_script_loader import run_site_script; "
                "print(run_site_script(__import__('pathlib').Path(sys.argv[2]),'https://www.realcan.cn'))",
                str(worker_root), str(path),
            ], env=os.environ.copy(), capture_output=True, text=True, timeout=15, check=True)
            self.assertIn("[]", smoke.stdout)
            with self.assertRaisesRegex(ValueError, "版本.*不一致"):
                module.resolve({"ConfigId": "123", "ScriptDigest": "sha256:wrong"})

    def test_legacy_site_repo_moves_out_of_runtime_and_repairs_git_urls(self):
        published = self.request("/api/runner-management/site-scripts/publish", {
            "configId": "123", "queueName": "news_list", "fileName": "www.realcan.cn.py",
            "codeType": "site", "siteHost": "www.realcan.cn", "code": "def scrape(url):\n    return []\n",
            "prompt": "抓列表", "url": "https://www.realcan.cn/news",
        })
        target = Path(self.tmp.name) / "site-scripts"
        legacy = Path(self.tmp.name) / "data" / "git" / "site-scripts"
        legacy.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(legacy))
        with self.app.store.connect() as db:
            for table in ("code_versions", "releases"):
                db.execute(f"UPDATE {table} SET git_url=? WHERE digest=?", (
                    published["gitUrl"].replace(target.as_uri(), legacy.as_uri()), published["scriptDigest"],
                ))
        migrated = Application(Path(self.tmp.name) / "data", site_script_repo=target)
        self.assertFalse(legacy.exists())
        self.assertTrue((target / published["storagePath"]).is_file())
        with migrated.store.connect() as db:
            for table in ("code_versions", "releases"):
                row = db.execute(f"SELECT git_url FROM {table} WHERE digest=?", (published["scriptDigest"],)).fetchone()
                self.assertTrue(row["git_url"].startswith(target.as_uri() + "#"))

    def test_site_repo_path_can_be_changed_in_system_settings(self):
        published = self.request("/api/runner-management/site-scripts/publish", {
            "configId": "123", "queueName": "news_list", "fileName": "www.realcan.cn.py",
            "codeType": "site", "siteHost": "www.realcan.cn", "code": "def scrape(url):\n    return []\n",
            "prompt": "抓列表", "url": "https://www.realcan.cn/news",
        })
        original = Path(self.tmp.name) / "site-scripts"
        target = Path(self.tmp.name) / "configured-site-code"
        self.assertEqual(self.request("/api/runner-management/settings/site-code-repo")["path"], str(original))
        changed = self.request("/api/runner-management/settings/site-code-repo", {"path": str(target)})
        self.assertEqual(changed["path"], str(target))
        self.assertFalse(original.exists())
        self.assertTrue((target / published["storagePath"]).is_file())
        version = self.request("/api/runner-management/site-scripts/catalog")[0]
        self.assertTrue(version["gitUrl"].startswith(target.as_uri() + "#"))
        with self.app.store.connect() as db:
            release = db.execute("SELECT git_url FROM releases WHERE digest=?", (published["scriptDigest"],)).fetchone()
            self.assertTrue(release["git_url"].startswith(target.as_uri() + "#"))
        restarted = Application(Path(self.tmp.name) / "data")
        self.assertEqual(restarted.site_script_repo, target)
        self.assertEqual(self.request("/api/runner-management/settings/site-code-repo")["path"], str(target))

        occupied = Path(self.tmp.name) / "occupied"
        occupied.mkdir()
        with self.assertRaises(HTTPError) as rejected:
            self.request("/api/runner-management/settings/site-code-repo", {"path": str(occupied)})
        self.assertEqual(rejected.exception.code, 409)
        self.assertEqual(self.app.site_script_repo, target)

    def test_site_git_remote_setting_pushes_existing_and_new_code(self):
        base = {"configId": "123", "queueName": "news_list", "fileName": "www.realcan.cn.py",
                "codeType": "site", "siteHost": "www.realcan.cn", "prompt": "抓列表",
                "url": "https://www.realcan.cn/news"}
        first = self.request("/api/runner-management/site-scripts/publish", {
            **base, "code": "def scrape(url):\n    return []\n",
        })
        bare = Path(self.tmp.name) / "remote.git"
        subprocess.run(["git", "init", "--bare", str(bare)], capture_output=True, check=True)
        remote_url = bare.as_uri()
        setting = self.request("/api/runner-management/settings/site-code-git", {
            "remoteUrl": remote_url, "branch": "main",
        })
        self.assertEqual(setting["remoteUrl"], remote_url)
        self.assertEqual(setting["branch"], "main")
        self.assertEqual(subprocess.run(["git", "--git-dir", str(bare), "rev-parse", "refs/heads/main"],
                                       capture_output=True, text=True, check=True).stdout.strip(), first["gitCommit"])
        version = self.request("/api/runner-management/site-scripts/catalog")[0]
        self.assertTrue(version["gitUrl"].startswith(remote_url + "#"))

        second = self.request("/api/runner-management/site-scripts/publish", {
            **base, "code": "def scrape(url):\n    return [{'title': 'new'}]\n",
        })
        self.assertTrue(second["gitUrl"].startswith(remote_url + "#"))
        self.assertEqual(subprocess.run(["git", "--git-dir", str(bare), "rev-parse", "refs/heads/main"],
                                       capture_output=True, text=True, check=True).stdout.strip(), second["gitCommit"])
        restarted = Application(Path(self.tmp.name) / "data", site_script_repo=Path(self.tmp.name) / "site-scripts")
        self.assertEqual(restarted.site_script_git_remote, remote_url)
        self.assertEqual(restarted.site_script_git_branch, "main")

        with self.assertRaises(HTTPError) as push_failed:
            self.request("/api/runner-management/settings/site-code-git", {
                "remoteUrl": (Path(self.tmp.name) / "missing.git").as_uri(), "branch": "main",
            })
        self.assertEqual(push_failed.exception.code, 502)
        self.assertEqual(self.app.site_script_git_remote, remote_url)
        self.assertEqual(subprocess.run(["git", "-C", str(self.app.site_script_repo), "remote", "get-url", "origin"],
                                       capture_output=True, text=True, check=True).stdout.strip(), remote_url)

        with self.assertRaises(HTTPError) as rejected:
            self.request("/api/runner-management/settings/site-code-git", {
                "remoteUrl": "https://user:secret@example.com/repo.git", "branch": "main",
            })
        self.assertEqual(rejected.exception.code, 400)
        self.assertEqual(self.app.site_script_git_remote, remote_url)

    def test_code_repositories_classify_new_code_by_config_type(self):
        repos_api = "/api/runner-management/settings/code-repos"

        def expect_status(status, path, payload):
            with self.assertRaises(HTTPError) as failed:
                self.request(path, payload)
            self.assertEqual(failed.exception.code, status)

        def publish(config_id, config_type, body="return []"):
            return self.request("/api/runner-management/site-scripts/publish", {
                "configId": config_id, "queueName": "news_list", "fileName": "www.realcan.cn.py",
                "codeType": "site", "siteHost": "www.realcan.cn", "configType": config_type,
                "code": f"def scrape(url):\n    {body}\n", "prompt": "", "url": "",
            })

        [default] = self.request(repos_api)
        self.assertTrue(default["isDefault"])
        self.assertEqual(default["path"], str(Path(self.tmp.name) / "site-scripts"))

        web_path = Path(self.tmp.name) / "web-code"
        web = self.request(repos_api, {"name": "网页抓取代码", "path": str(web_path), "branch": "main"})
        self.assertTrue((web_path / ".git").is_dir())
        self.assertEqual((web["status"], web["isDefault"], web["codeCount"]), ("ACTIVE", False, 0))
        expect_status(409, repos_api, {"name": "网页抓取代码", "path": str(Path(self.tmp.name) / "other")})
        expect_status(400, repos_api, {"name": "嵌套", "path": str(web_path / "nested")})
        occupied = Path(self.tmp.name) / "occupied"
        occupied.mkdir()
        (occupied / "readme.txt").write_text("x")
        expect_status(409, repos_api, {"name": "非空目录", "path": str(occupied)})

        rules_api = "/api/runner-management/settings/code-repo-rules"
        self.assertEqual(self.request(rules_api, {"rules": [{"configType": "90", "repoId": web["repoId"]}]}),
                         [{"configType": "90", "repoId": web["repoId"]}])
        classified = publish("123", "90")
        self.assertEqual((classified["repoId"], classified["repoName"]), (web["repoId"], "网页抓取代码"))
        self.assertTrue((web_path / classified["storagePath"]).is_file())
        self.assertTrue(classified["gitUrl"].startswith(web_path.as_uri() + "#"))
        unclassified = publish("456", "150")
        self.assertEqual(unclassified["repoId"], default["repoId"])

        # 改分类后已有代码不搬动，新版本仍提交到原仓库。
        self.request(rules_api, {"rules": [{"configType": "90", "repoId": ""}]})
        self.assertEqual(self.request(rules_api), [])
        second = publish("123", "90", "return [{'title': 'new'}]")
        self.assertEqual(second["repoId"], web["repoId"])
        self.assertEqual(subprocess.run(["git", "-C", str(web_path), "rev-parse", "HEAD"],
                                        capture_output=True, text=True, check=True).stdout.strip(), second["gitCommit"])
        self.assertEqual(publish("789", "90")["repoId"], default["repoId"])

        repo_api = f"{repos_api}/{web['repoId']}"
        self.request(rules_api, {"rules": [{"configType": "90", "repoId": web["repoId"]}]})
        expect_status(409, repo_api, {"status": "DISABLED"})
        expect_status(409, f"{repos_api}/{default['repoId']}", {"status": "DISABLED"})
        self.request(rules_api, {"rules": [{"configType": "90", "repoId": ""}]})
        self.assertEqual(self.request(repo_api, {"status": "DISABLED"})["status"], "DISABLED")
        expect_status(409, "/api/runner-management/site-scripts/publish", {
            "configId": "123", "queueName": "news_list", "codeType": "site", "siteHost": "www.realcan.cn",
            "configType": "90", "code": "def scrape(url):\n    return [1]\n",
        })
        expect_status(409, rules_api, {"rules": [{"configType": "90", "repoId": web["repoId"]}]})
        expect_status(409, f"{repo_api}/default", {})

        self.request(repo_api, {"status": "ACTIVE", "name": "网页代码"})
        promoted = self.request(f"{repo_api}/default", {})
        self.assertTrue(promoted["isDefault"])
        self.assertEqual(self.app.site_script_repo, web_path)
        catalog = {row["configId"]: row["repoName"] for row in self.request("/api/runner-management/site-scripts/catalog")}
        self.assertEqual(catalog, {"123": "网页代码", "456": "默认仓库", "789": "默认仓库"})
        restarted = Application(Path(self.tmp.name) / "data")
        self.assertEqual(restarted.site_script_repo, web_path)

    def test_same_config_type_can_choose_multiple_repositories_per_version(self):
        api = "/api/runner-management/settings/code-repos"
        path_a = Path(self.tmp.name) / "web-a"
        path_b = Path(self.tmp.name) / "web-b"
        first = self.request(api, {"name": "网页仓库 A", "configType": "90", "path": str(path_a)})
        second = self.request(api, {"name": "网页仓库 B", "configType": "90", "path": str(path_b)})
        self.assertEqual([repo["configType"] for repo in self.request(api) if repo["name"].startswith("网页仓库")], ["90", "90"])
        payload = {
            "configId": "123", "queueName": "news_list", "codeType": "site", "siteHost": "www.realcan.cn",
            "configType": "90", "code": "def scrape(url):\n    return []\n", "url": "https://www.realcan.cn/news",
            "prompt": "抓取新闻",
        }
        published_a = self.request("/api/runner-management/site-scripts/publish", {**payload, "repositoryId": first["repoId"]})
        published_b = self.request("/api/runner-management/site-scripts/publish", {
            **payload, "repositoryId": second["repoId"],
        })
        self.assertNotEqual(published_a["scriptDigest"], published_b["scriptDigest"])
        self.assertTrue((path_a / published_a["storagePath"]).is_file())
        self.assertTrue((path_b / published_b["storagePath"]).is_file())
        versions = self.request("/api/runner-management/site-scripts/versions?configId=123&queueName=news_list")
        self.assertEqual({row["repoId"] for row in versions}, {first["repoId"], second["repoId"]})
        with self.assertRaises(HTTPError) as rejected:
            self.request("/api/runner-management/site-scripts/publish", {
                **payload, "configType": "150", "repositoryId": first["repoId"],
            })
        self.assertEqual(rejected.exception.code, 409)

    def test_repository_verification_checks_local_and_remote_without_changing_code(self):
        bare = Path(self.tmp.name) / "remote.git"
        subprocess.run(["git", "init", "--bare", str(bare)], capture_output=True, check=True)
        repo = self.request("/api/runner-management/settings/code-repos", {
            "name": "验证仓库", "path": str(Path(self.tmp.name) / "verify-local"),
            "remoteUrl": bare.as_uri(), "branch": "main", "configType": "90",
        })
        verify_url = f"/api/runner-management/settings/code-repos/{repo['repoId']}/verify"
        before = self.request(verify_url, {})
        self.assertEqual(before["status"], "warning")
        self.assertIn("分支尚不存在", next(item["message"] for item in before["checks"] if item["name"] == "remote"))
        self.request("/api/runner-management/site-scripts/publish", {
            "configId": "123", "queueName": "news_list", "codeType": "site", "siteHost": "www.realcan.cn",
            "configType": "90", "repositoryId": repo["repoId"], "code": "def scrape(url):\n    return []\n",
        })
        after = self.request(verify_url, {})
        self.assertEqual(after["status"], "ok")
        self.assertEqual(next(item["status"] for item in after["checks"] if item["name"] == "remote"), "ok")
        self.assertEqual(next(item["status"] for item in after["checks"] if item["name"] == "push"), "ok")
        with self.app.store.connect() as db:
            db.execute("UPDATE code_repositories SET local_path=? WHERE repo_id=?",
                       (str(Path(self.tmp.name) / "missing"), repo["repoId"]))
        self.assertEqual(self.request(verify_url, {})["status"], "error")

    def test_upload_repository_files_commits_pushes_and_rejects_unsafe_paths(self):
        bare = Path(self.tmp.name) / "upload-remote.git"
        subprocess.run(["git", "init", "--bare", str(bare)], capture_output=True, check=True)
        local = Path(self.tmp.name) / "upload-local"
        repo = self.request("/api/runner-management/settings/code-repos", {
            "name": "上传仓库", "path": str(local), "remoteUrl": bare.as_uri(), "branch": "main",
        })
        url = f"/api/runner-management/settings/code-repos/{repo['repoId']}/files"

        def upload(name="README.txt", content=b"hello", overwrite=False):
            return self.request(url, {"overwrite": overwrite,
                                      "files": [{"name": name, "data": base64.b64encode(content).decode()}]})

        first = upload()
        self.assertEqual(repo["uploadDirectory"], "default")
        self.assertTrue(first["pushed"])
        self.assertTrue(first["changed"])
        self.assertEqual(first["files"][0]["path"], "default/README.txt")
        self.assertEqual((local / "default" / "README.txt").read_bytes(), b"hello")
        remote_content = subprocess.run(["git", "--git-dir", str(bare), "show", "main:default/README.txt"],
                                        capture_output=True, check=True).stdout
        self.assertEqual(remote_content, b"hello")

        with self.assertRaises(HTTPError) as rejected_batch:
            self.request(url, {"overwrite": False, "files": [
                {"name": "new.txt", "data": base64.b64encode(b"new").decode()},
                {"name": "README.txt", "data": base64.b64encode(b"collision").decode()},
            ]})
        self.assertEqual(rejected_batch.exception.code, 409)
        self.assertFalse((local / "default" / "new.txt").exists())

        batch = self.request(url, {"overwrite": False, "files": [
            {"name": "a.txt", "data": base64.b64encode(b"a").decode()},
            {"name": "b.txt", "data": base64.b64encode(b"b").decode()},
        ]})
        self.assertEqual([file["path"] for file in batch["files"]], ["default/a.txt", "default/b.txt"])
        self.assertEqual(subprocess.run(["git", "--git-dir", str(bare), "show", "main:default/b.txt"],
                                        capture_output=True, check=True).stdout, b"b")

        for name, overwrite, status in [("README.txt", False, 409), ("../escape", False, 400)]:
            with self.assertRaises(HTTPError) as rejected:
                upload(name, overwrite=overwrite)
            self.assertEqual(rejected.exception.code, status)
        with self.assertRaises(HTTPError) as wrong_folder:
            self.request(url, {"directory": "manual", "files": [{"name": "x.txt", "data": "eA=="}]})
        self.assertEqual(wrong_folder.exception.code, 400)
        self.assertEqual((local / "default" / "README.txt").read_bytes(), b"hello")

        updated = upload(content=b"changed", overwrite=True)
        self.assertNotEqual(updated["gitCommit"], first["gitCommit"])
        self.assertEqual((local / "default" / "README.txt").read_bytes(), b"changed")
        self.assertEqual(subprocess.run(["git", "--git-dir", str(bare), "show", "main:default/README.txt"],
                                        capture_output=True, check=True).stdout, b"changed")

        listing = self.request(url)
        self.assertEqual(listing["uploadDirectory"], "default")
        self.assertEqual(listing["total"], 3)
        self.assertEqual(self.request(url + "?keyword=README")["total"], 1)
        self.assertTrue(all(item["canDelete"] for item in listing["items"]))
        preview = self.request(url + "/content?path=" + quote("default/README.txt"))
        self.assertEqual(preview["content"], "changed")
        with self.assertRaises(HTTPError) as unsafe_preview:
            self.request(url + "/content?path=" + quote("../secret.txt"))
        self.assertEqual(unsafe_preview.exception.code, 400)
        delete = Request(self.url + url + "?path=" + quote("default/README.txt"), method="DELETE")
        with urlopen(delete, timeout=5) as response:
            deleted = json.load(response)
        self.assertEqual(deleted["path"], "default/README.txt")
        self.assertFalse((local / "default" / "README.txt").exists())
        self.assertEqual(self.request(url)["total"], 2)
        with self.assertRaises(HTTPError) as protected:
            urlopen(Request(self.url + url + "?path=code/x.py", method="DELETE"), timeout=5)
        self.assertEqual(protected.exception.code, 400)

        typed = self.request("/api/runner-management/settings/code-repos", {
            "name": "网页类型仓库", "path": str(Path(self.tmp.name) / "typed-local"),
            "configType": "90", "configTypeName": "网页抓取",
        })
        typed_url = f"/api/runner-management/settings/code-repos/{typed['repoId']}/files"
        self.assertEqual(typed["uploadDirectory"], "网页抓取")
        typed_file = self.request(typed_url, {"files": [{"name": "sample.py", "data": base64.b64encode(b"print(1)").decode()}]})
        self.assertEqual(typed_file["files"][0]["path"], "网页抓取/sample.py")
        source_code = "def scrape(url):\n    return [{'url': url}]\n"
        source_file = self.request(typed_url, {"files": [{"name": "scraper.py", "data": base64.b64encode(source_code.encode()).decode()}]})
        source_path = source_file["files"][0]["path"]
        snapshot = self.request(typed_url + "/content?path=" + quote(source_path))
        self.assertEqual(snapshot["content"], source_code)
        self.assertEqual(snapshot["gitCommit"], source_file["gitCommit"])
        import_payload = {"configId": "node123", "queueName": "news_list", "fileName": "www.example.com.py",
                          "codeType": "site", "siteHost": "www.example.com", "configType": "90",
                          "repositoryId": typed["repoId"], "code": source_code,
                          "sourceFilePath": source_path, "sourceGitCommit": snapshot["gitCommit"]}
        with self.assertRaises(HTTPError) as stale_source:
            self.request("/api/runner-management/site-scripts/publish", {**import_payload,
                         "sourceGitCommit": "0" * 40})
        self.assertEqual(stale_source.exception.code, 409)
        imported = self.request("/api/runner-management/site-scripts/publish", import_payload)
        self.assertEqual(imported["sourceRepoPath"], source_path)
        self.assertEqual(imported["sourceGitCommit"], snapshot["gitCommit"])
        self.assertTrue((Path(typed["path"]) / imported["storagePath"]).is_file())
        again = self.request("/api/runner-management/site-scripts/publish", import_payload)
        self.assertEqual(again["scriptDigest"], imported["scriptDigest"])

    def test_folder_upload_preserves_nested_paths_and_pushes_to_selected_directory(self):
        bare = Path(self.tmp.name) / 'folder-remote.git'
        subprocess.run(['git', 'init', '--bare', str(bare)], check=True, capture_output=True)
        local = Path(self.tmp.name) / 'folder-local'
        repo = self.request('/api/runner-management/settings/code-repos', {
            'name': '目录上传测试', 'path': str(local), 'remoteUrl': bare.as_uri(), 'branch': 'main'})
        directory = self.request('/api/runner-management/settings/code-repos/' + repo['repoId'] + '/directories', {
            'name': '公共模块', 'configType': '', 'configTypeName': '', 'path': 'shared/python'})
        route = '/api/runner-management/settings/code-repos/' + repo['repoId'] + '/files'
        def item(path, content=b'x'):
            return {'name': path.rsplit('/', 1)[-1], 'relativePath': path, 'data': base64.b64encode(content).decode()}
        files = [item('处理程序/a/main.py', b'first'), item('处理程序/b/main.py', b'second'),
                 *[item('处理程序/utils/file' + str(index) + '.py') for index in range(23)]]
        payload = {'uploadType': 'folder', 'directoryId': directory['directoryId'], 'overwrite': False, 'files': files}
        result = self.request(route, payload)
        self.assertTrue(result['pushed'])
        self.assertEqual(len(result['files']), 25)
        self.assertEqual((local / 'shared/python/处理程序/a/main.py').read_bytes(), b'first')
        self.assertEqual((local / 'shared/python/处理程序/b/main.py').read_bytes(), b'second')
        self.assertEqual(subprocess.check_output(['git', '--git-dir', str(bare), 'show', 'main:shared/python/处理程序/b/main.py']), b'second')
        snapshot = self.request(route + '/content?path=' + quote('shared/python/处理程序/a/main.py'))
        self.assertEqual(snapshot['content'], 'first')
        self.assertEqual(self.request(route + '?directoryId=' + directory['directoryId'])['total'], 25)
        with self.assertRaises(HTTPError) as collision:
            self.request(route, {**payload, 'files': [item('处理程序/new.py'), item('处理程序/a/main.py', b'changed')]})
        self.assertEqual(collision.exception.code, 409)
        self.assertFalse((local / 'shared/python/处理程序/new.py').exists())
        changed = self.request(route, {**payload, 'overwrite': True, 'files': [item('处理程序/a/main.py', b'changed')]})
        self.assertNotEqual(changed['gitCommit'], result['gitCommit'])
        self.assertEqual(subprocess.check_output(['git', '--git-dir', str(bare), 'show', 'main:shared/python/处理程序/a/main.py']), b'changed')
        self.request(route, {**payload, 'files': [item('处理程序/block')]})
        with self.assertRaises(HTTPError) as blocked_parent:
            self.request(route, {**payload, 'files': [item('处理程序/new.py'), item('处理程序/block/child.py')]})
        self.assertEqual(blocked_parent.exception.code, 409)
        self.assertFalse((local / 'shared/python/处理程序/new.py').exists())
        invalid_batches = [
            [item('../escape.py')], [item('/escape.py')], [item('C:/escape.py')],
            [item('处理程序/../escape.py')], [item('处理程序/.git/config')], [item('处理程序//bad.py')],
            [item('处理程序/a.py'), item('处理程序/A.py')],
            [item('处理程序/prefix'), item('处理程序/prefix/child.py')],
            [{'name': 'wrong.py', 'relativePath': '处理程序/main.py', 'data': 'eA=='}],
        ]
        for invalid in invalid_batches:
            with self.subTest(paths=[file['relativePath'] for file in invalid]):
                with self.assertRaises(HTTPError) as unsafe:
                    self.request(route, {**payload, 'overwrite': True, 'files': invalid})
                self.assertEqual(unsafe.exception.code, 400)
        self.assertFalse((local / 'escape.py').exists())

    def test_assignment_selects_node_code_and_worker_downloads_it(self):
        source_code = "def scrape(url):\n    return [{'title': 'selected', 'url': url}]\n"
        code = self.request("/api/runner-management/site-scripts/publish", {
            "configId": "node123", "queueName": "news_list", "fileName": "news_list.py",
            "codeType": "default", "code": source_code,
        })
        runner = Runner(Path(self.tmp.name) / "selected-code-instance", self.url)
        runner.enroll()
        assignment = self.request("/api/runner-management/assignments", {
            "runnerId": runner.identity["runnerId"], "scriptDigest": code["scriptDigest"],
            "concurrency": 3, "environment": "production",
        })
        self.assertEqual(assignment["queue"], "news_list")
        self.assertEqual(assignment["configId"], "node123")
        self.assertEqual(assignment["codeId"], code["codeId"])
        self.assertEqual(assignment["scriptDigest"], code["scriptDigest"])
        self.assertEqual(assignment["deliveryPath"], "news_list.py")
        self.assertEqual(assignment["gitCommit"], code["gitCommit"])
        self.assertEqual(assignment["concurrency"], 3)
        self.assertNotEqual(assignment["releaseDigest"], code["scriptDigest"])
        releases = self.request("/api/runner-management/releases")
        processor = next(row for row in releases if row["digest"] == assignment["releaseDigest"])
        self.assertEqual(processor["kind"], "processor")
        self.assertEqual(processor["name"], "newslink_nourl")
        self.assertEqual(self.request("/api/runner-management/assignments"), [assignment])
        bindings = self.request("/api/runner-management/site-scripts/bindings?configId=node123&queueName=news_list&environment=prd")
        self.assertEqual(bindings[0]["scriptDigest"], code["scriptDigest"])
        worker_assignment = runner.get("/api/runners/me/assignments")[0]
        self.assertEqual(worker_assignment["scriptDigest"], code["scriptDigest"])
        loader_path = Path(__file__).parents[1] / "legacy_qinlongclaw" / "link_extractor" / "core" / "managed_script.py"
        spec = importlib.util.spec_from_file_location("selected_code_loader", loader_path)
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        with patch.dict(os.environ, {
            "RUNNER_WORKER_TOKEN": worker_assignment["workerToken"], "RUNNER_MANAGEMENT_URL": self.url,
            "RUNNER_PUBLIC_KEY": runner.identity["publicKey"], "RUNNER_QUEUE": "news_list",
            "RUNNER_ENVIRONMENT": "prd", "RUNNER_SCRIPT_CACHE": str(Path(self.tmp.name) / "worker-code"),
        }):
            downloaded = loader.resolve({"ConfigId": "node123", "Url": "https://example.com/news"})
        self.assertEqual(downloaded.read_text(), source_code)

    def test_assignment_keeps_active_version_until_explicit_node_publish(self):
        base = {"configId": "node123", "queueName": "news_list", "fileName": "news_list.py", "codeType": "default"}
        first = self.request("/api/runner-management/site-scripts/publish", {
            **base, "code": "def scrape(url):\n    return [{'title': 'v1'}]\n",
        })
        runner_a = Runner(Path(self.tmp.name) / "version-instance-a", self.url)
        runner_a.enroll()
        runner_b = Runner(Path(self.tmp.name) / "version-instance-b", self.url)
        runner_b.enroll()
        assignment_a = self.request("/api/runner-management/assignments", {
            "runnerId": runner_a.identity["runnerId"], "scriptDigest": first["scriptDigest"], "environment": "test",
        })
        second = self.request("/api/runner-management/site-scripts/publish", {
            **base, "code": "def scrape(url):\n    return [{'title': 'v2'}]\n",
        })
        payload = {"runnerId": runner_b.identity["runnerId"], "scriptDigest": second["scriptDigest"], "environment": "test"}
        with self.assertRaises(HTTPError) as active_conflict:
            self.request("/api/runner-management/assignments", payload)
        self.assertEqual(active_conflict.exception.code, 409)
        self.assertEqual(len(self.request("/api/runner-management/assignments")), 1)
        self.assertEqual(runner_a.get("/api/runners/me/assignments")[0]["scriptDigest"], first["scriptDigest"])
        self.request("/api/runner-management/site-scripts/bind", {
            "configId": "node123", "queueName": "news_list", "environment": "test", "scriptDigest": second["scriptDigest"],
        })
        assignment_b = self.request("/api/runner-management/assignments", payload)
        self.assertEqual(assignment_b["releaseDigest"], assignment_a["releaseDigest"])
        rows = self.request("/api/runner-management/assignments")
        self.assertEqual({row["scriptDigest"] for row in rows}, {second["scriptDigest"]})
        self.assertEqual({row["gitCommit"] for row in rows}, {second["gitCommit"]})
        with self.assertRaises(HTTPError) as duplicate:
            self.request("/api/runner-management/assignments", {**payload, "scriptDigest": first["scriptDigest"]})
        self.assertEqual(duplicate.exception.code, 409)
        self.assertEqual(runner_a.get("/api/runners/me/assignments")[0]["scriptDigest"], second["scriptDigest"])
        runner_c = Runner(Path(self.tmp.name) / "version-instance-c", self.url)
        runner_c.enroll()
        production = self.request("/api/runner-management/assignments", {
            "runnerId": runner_c.identity["runnerId"], "scriptDigest": first["scriptDigest"], "environment": "production",
        })
        self.assertEqual(production["scriptDigest"], first["scriptDigest"])
        self.assertEqual(runner_a.get("/api/runners/me/assignments")[0]["scriptDigest"], second["scriptDigest"])
        with self.assertRaises(HTTPError) as invalid:
            self.request("/api/runner-management/assignments", {**payload, "scriptDigest": "sha256:missing"})
        self.assertEqual(invalid.exception.code, 400)
        self.assertEqual(len(self.request("/api/runner-management/assignments")), 3)

    def test_existing_assignment_store_migrates_without_losing_rows(self):
        path = Path(self.tmp.name) / "old-assignments.sqlite"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE assignments (assignment_id TEXT PRIMARY KEY, runner_id TEXT, queue TEXT, "
                       "processor_type TEXT, release_digest TEXT, concurrency INTEGER, enabled INTEGER, environment TEXT)")
            db.execute("INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?)", (
                "legacy-id", "runner-id", "old-queue", "probe", "old-digest", 2, 1, "test",
            ))
        db.close()
        store = Store(path)
        with store.connect() as db:
            row = db.execute("SELECT * FROM assignments WHERE assignment_id='legacy-id'").fetchone()
        self.assertEqual(row["queue"], "old-queue")
        self.assertEqual(row["concurrency"], 2)
        self.assertEqual(row["code_id"], "")

    def test_environment_bindings_use_site_code_then_queue_default(self):
        default_code = "def scrape(url):\n    return [{'title': 'default'}]\n"
        site_code = "def scrape(url):\n    return [{'title': 'site'}]\n"
        base = {"configId": "123", "queueName": "news_list", "prompt": "抓列表", "url": "https://www.realcan.cn/news"}
        generic = self.request("/api/runner-management/site-scripts/publish", {
            **base, "fileName": "news_list.py", "codeType": "default", "code": default_code,
        })
        specialized = self.request("/api/runner-management/site-scripts/publish", {
            **base, "fileName": "www.realcan.cn.py", "codeType": "site",
            "siteHost": "www.realcan.cn", "code": site_code,
        })
        self.assertEqual(generic["deliveryPath"], "news_list.py")
        self.assertEqual(specialized["deliveryPath"], "sites/www.realcan.cn.py")
        again = self.request("/api/runner-management/site-scripts/publish", {
            **base, "fileName": "www.realcan.cn.py", "codeType": "site",
            "siteHost": "www.realcan.cn", "code": site_code,
        })
        self.assertEqual(again["scriptDigest"], specialized["scriptDigest"])
        self.assertEqual(again["codeId"], specialized["codeId"])
        self.assertTrue((Path(self.tmp.name) / "site-scripts" / generic["storagePath"]).is_file())
        self.assertIn((Path(self.tmp.name) / "site-scripts").as_uri(), generic["gitUrl"])
        self.assertNotIn("test", generic["storagePath"])
        versions = self.request("/api/runner-management/site-scripts/versions?configId=123&queueName=news_list")
        self.assertEqual({row["scriptDigest"] for row in versions}, {generic["scriptDigest"], specialized["scriptDigest"]})
        self.assertEqual(self.request("/api/runner-management/site-scripts/code?digest=" + specialized["scriptDigest"])["code"], site_code)

        for release in (generic, specialized):
            self.request("/api/runner-management/site-scripts/bind", {
                "configId": "123", "queueName": "news_list", "environment": "test",
                "scriptDigest": release["scriptDigest"],
            })
        self.request("/api/runner-management/site-scripts/bind", {
            "configId": "123", "queueName": "news_list", "environment": "prd",
            "scriptDigest": generic["scriptDigest"],
        })
        bindings = self.request("/api/runner-management/site-scripts/bindings?configId=123&queueName=news_list&environment=test")
        self.assertEqual(len(bindings), 2)
        catalog = self.request("/api/runner-management/site-scripts/catalog")
        self.assertEqual(len(catalog), 2)
        self.assertIn("test", next(row for row in catalog if row["siteHost"])["environments"])

        runner = Runner(Path(self.tmp.name) / "site-instance", self.url)
        runner.enroll()
        probe = self.request("/api/runner-management/releases/processors", {"processorType": "probe"})
        self.request("/api/runner-management/assignments", {
            "runnerId": runner.identity["runnerId"], "queue": "news_list", "processorType": "probe",
            "releaseDigest": probe["digest"], "concurrency": 1, "environment": "test",
        })
        worker_token = runner.get("/api/runners/me/assignments")[0]["workerToken"]
        code_path = Path(__file__).parents[1] / "legacy_qinlongclaw" / "link_extractor" / "core" / "managed_script.py"
        spec = importlib.util.spec_from_file_location("managed_site_test", code_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        instance = Path(self.tmp.name) / "runner_management" / "instance"
        with patch.dict(os.environ, {
            "RUNNER_WORKER_TOKEN": worker_token, "RUNNER_MANAGEMENT_URL": self.url,
            "RUNNER_PUBLIC_KEY": runner.identity["publicKey"],
            "RUNNER_SCRIPT_CACHE": str(instance / "code"),
            "RUNNER_QUEUE": "news_list", "RUNNER_ENVIRONMENT": "test",
        }):
            site_path = module.resolve({"ConfigId": "123", "Url": "https://www.realcan.cn/news"})
            self.assertEqual(site_path.read_text(), site_code)
            self.assertEqual(site_path.name, "www.realcan.cn.py")
            self.assertEqual(site_path, instance / "123/sites/www.realcan.cn.py")
            default_path = module.resolve({"ConfigId": "123", "Url": "https://other.example.com/news"})
            self.assertEqual(default_path.read_text(), default_code)
            self.assertEqual(default_path.name, "news_list.py")
            registry = json.loads((instance / '123/version.json').read_text(encoding='utf-8'))
            self.assertEqual(registry['current'], {'123|news_list|www.realcan.cn': specialized['scriptDigest'],
                                                  '123|news_list|': generic['scriptDigest']})
            self.assertEqual(len(registry['versions']), 2)
            self.assertEqual(module.resolve({"ConfigId": "456", "Url": "https://www.realcan.cn"}), None)

    def test_signed_runner_release_bootstraps_and_reports_actual_version(self):
        enrollment = self.request("/api/runner-management/runners/enrollment-codes", {})
        self.runner = Runner(Path(self.tmp.name) / "upgrade-instance", self.url)
        self.runner.enroll(enrollment["code"], "127.0.0.1")
        release = self.request("/api/runner-management/releases/runners", {})
        self.request(f"/api/runner-management/runners/{self.runner.identity['runnerId']}/desired-runner", {"digest": release["digest"]})
        self.bootstrapper = Bootstrapper(self.runner.directory, self.url)
        self.bootstrapper.current_digest = "source-local"
        self.bootstrapper.process = self.bootstrapper.start("source-local")
        self.bootstrapper.switch(release["digest"])
        self.assertEqual(json.loads(self.bootstrapper.current_path.read_text())["digest"], release["digest"])
        status = self.runner.get("/api/runners/me/status")
        self.assertEqual(status["actualDigest"], release["digest"])
        broken_digest, broken_signature = self.app.artifacts.publish({
            "runner_management/__init__.py": b"",
            "runner_management/runner.py": b"raise SystemExit(3)\n",
        }, {"kind": "runner", "entryModule": "runner_management.runner"})
        with self.app.store.connect() as db:
            db.execute("INSERT INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)", (
                broken_digest, "runner", "broken", "any", "local", "published", "2026-10-05", broken_signature,
                "runner_management.runner", "local-source",
            ))
        self.request(f"/api/runner-management/runners/{self.runner.identity['runnerId']}/desired-runner", {"digest": broken_digest})
        with self.assertRaisesRegex(RuntimeError, "已恢复上一版本"):
            self.bootstrapper.switch(broken_digest)
        self.assertEqual(json.loads(self.bootstrapper.current_path.read_text())["digest"], release["digest"])
        self.assertIsNone(self.bootstrapper.process.poll())

    def test_repeated_runner_publish_reuses_same_release(self):
        first = self.request("/api/runner-management/releases/runners", {})
        second = self.request("/api/runner-management/releases/runners", {})

        self.assertEqual(first["digest"], second["digest"])
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        releases = self.request("/api/runner-management/releases")
        self.assertEqual(1, len([item for item in releases if item["kind"] == "runner"]))


if __name__ == "__main__":
    unittest.main()
