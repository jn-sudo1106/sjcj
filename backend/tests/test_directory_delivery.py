"""Contracts for manual delivery, Runner materialization and runtime isolation."""
import json
import io
import zipfile
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
import unittest
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management.runner import Runner


class DirectoryDeliveryTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request
    directory_fixture = baseline.ManagementIntegrationTest.directory_fixture

    def fixture(self, kind='custom', owner='shared/python', root=None):
        _, _, mapped, shared = self.directory_fixture()
        self.runner = Runner(Path(self.tmp.name) / 'instance', self.url)
        self.runner.enroll()
        if kind == 'website':
            self.request('/api/runner-management/site-scripts/publish', {
                'configId': 'mapped123', 'queueName': 'news_list', 'siteHost': owner,
                'codeType': 'site', 'code': 'def scrape(url):\n    return []\n'})
        route = ('/api/runner-management/directory-layouts/configs/' + owner if kind == 'config' else
                 '/api/runner-management/directory-layouts/queues/' + owner if kind == 'queue' else
                 '/api/runner-management/directory-layouts/' + kind + '?owner=' + quote(owner, safe=''))
        view = self.request(route)
        view.update(nodes=mapped['nodes'], entryPoint='' if kind == 'custom' else 'news/main.py')
        if root:
            view['directoryTemplate'] = root
        view = self.request(route, view)
        binding = self.request('/api/runner-management/directory-bindings', {
            'bindingType': kind, 'ownerId': owner, 'runnerId': self.runner.identity['runnerId']})
        delivery = '/api/runner-management/directory-bindings/' + kind + '/' + quote(owner, safe='') + '/' + self.runner.identity['runnerId'] + '/deliver'
        return route, view, binding, delivery, shared

    def latest(self):
        return self.request('/api/runner-management/directory-bindings')[0]['delivery']

    def preview(self, route):
        return self.request(route.removesuffix('/deliver') + '/delivery-preview')

    def selected(self, route, preview, paths):
        return self.request(route, {'revision': preview['revision'], 'scope': 'selected',
                                   'baselineDigest': preview['baselineDigest'], 'paths': paths})

    def change_helper(self, view_route, view, shared, value='hash-v2'):
        (shared / 'helpers/helper.py').write_text("def title(): return '" + value + "'\n", encoding='utf-8')
        self.app.git(shared, 'add', '--', 'helpers')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Hash changes')
        nodes = [{**node, 'gitCommit': self.app.git(shared, 'rev-parse', 'HEAD').strip()} if node['id'] == 'shared' else node for node in view['nodes']]
        return self.request(view_route, {**view, 'nodes': nodes})

    def test_delivery_uses_pinned_nested_gitignore_even_for_tracked_files(self):
        view_route, view, _, route, shared = self.fixture()
        content = {
            '.gitignore': '\n*.txt\n/helpers/root_block.py\n/helpers/blocked/\n!helpers/说明.txt\n!helpers/reference.log\n',
            'helpers/.gitignore': '*.json\n!config.json\n!root_block.py\n!blocked/keep.py\n',
            'helpers/config.json': '{"enabled":true}',
            'helpers/secret.json': '{"private":true}',
            'helpers/root_block.py': 'VALUE = 1\n',
            'helpers/说明.txt': 'runtime resource',
            'helpers/drop.txt': 'not a resource',
            'helpers/template.html': '<p>runtime template</p>',
            'helpers/debug.log': 'do not ship',
            'helpers/reference.log': 'explicitly retained runtime resource',
            'helpers/session.tmp': 'do not ship',
            'helpers/.venv/lib/site.py': 'do not ship',
            'helpers/blocked/keep.py': 'cannot unignore beneath an excluded directory',
            'helpers/__pycache__/helper.cpython-312.pyc': 'do not ship',
        }
        for name, value in content.items():
            target = shared / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(value, encoding='utf-8')
        self.app.git(shared, 'add', '-f', '--', '.')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Pinned ignore rules')
        commit = self.app.git(shared, 'rev-parse', 'HEAD').strip()
        view = self.request(view_route, {**view, 'nodes': [{**node, 'gitCommit': commit} if node['id'] == 'shared' else node for node in view['nodes']]})
        # Ignore rules from HEAD, the worktree or server-local info/exclude must
        # never change a configuration pinned to an earlier commit.
        (shared / '.gitignore').write_text('*\n', encoding='utf-8')
        (shared / '.git/info/exclude').write_text('*\n', encoding='utf-8')
        self.app.git(shared, 'add', '-f', '--', '.gitignore')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Later rules')
        expected = {'news/main.py', 'shared/helper.py', 'shared/config.json',
                    'shared/root_block.py', 'shared/说明.txt', 'shared/template.html', 'shared/reference.log'}
        preview = self.preview(route)
        self.assertEqual({item['path'] for item in preview['items'] if item['kind'] == 'file'}, expected)
        self.assertFalse(any('blocked' in item['path'] or '.venv' in item['path'] for item in preview['items']))
        delivery = self.request(route, {'revision': view['revision']})
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(delivery['artifactDigest']))) as archive:
            self.assertEqual(set(archive.namelist()), expected | {'manifest.json'})
        self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'success')
        installed = self.runner.directory / 'shared/python'
        self.assertEqual({path.relative_to(installed).as_posix() for path in installed.rglob('*') if path.is_file()},
                         expected | {'version.json'})
        # Packaging for the selected Python entry uses the same exclusions.
        from backend.runner_management.deployment_configuration import program_snapshot
        with self.app.store.connect() as db:
            program = {**view, 'entryPoint': 'news/main.py', 'deploymentId': 'ignored-fixture'}
            digest = program_snapshot(self.app, program, db)
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(digest))) as archive:
            self.assertEqual(set(archive.namelist()), expected | {'manifest.json'})

    def test_ignored_explicit_file_cannot_be_delivered_under_another_name(self):
        view_route, view, _, route, shared = self.fixture()
        (shared / '.gitignore').write_text('helpers/helper.py\n', encoding='utf-8')
        self.app.git(shared, 'add', '--', '.gitignore')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Exclude tracked source')
        commit = self.app.git(shared, 'rev-parse', 'HEAD').strip()
        node = next(node for node in view['nodes'] if node['id'] == 'shared')
        view = self.request(view_route, {**view, 'nodes': [{**node, 'gitCommit': commit, 'name': 'renamed.py',
                    'sourcePath': 'helpers/helper.py', 'kind': 'file', 'sourceType': 'file'}]})
        for path, payload in [(route.removesuffix('/deliver') + '/delivery-preview', None),
                              (route, {'revision': view['revision']})]:
            with self.assertRaises(HTTPError) as error:
                self.request(path, payload)
            self.assertEqual(error.exception.code, 422)
            self.assertIn('忽略规则', error.exception.read().decode('utf-8'))
        self.assertEqual(self.runner.get('/api/runners/me/directory-deliveries'), [])

    def test_changed_gitignore_full_delivery_removes_old_owned_file(self):
        view_route, view, _, route, shared = self.fixture()
        self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        (shared / '.gitignore').write_text('helpers/helper.py\n', encoding='utf-8')
        self.app.git(shared, 'add', '--', '.gitignore')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Exclude deployed source')
        commit = self.app.git(shared, 'rev-parse', 'HEAD').strip()
        view = self.request(view_route, {**view, 'nodes': [{**node, 'gitCommit': commit} if node['id'] == 'shared' else node for node in view['nodes']]})
        self.assertNotIn('shared/helper.py', {item['path'] for item in self.preview(route)['items']})
        second = self.request(route, {'revision': view['revision'], 'scope': 'all'})
        self.assertFalse(second.get('unchanged', False))
        self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'success')
        self.assertFalse((self.runner.directory / 'shared/python/shared/helper.py').exists())
        self.assertTrue((self.runner.directory / 'shared/python/news/main.py').is_file())

    def test_git_metadata_change_without_file_hash_change_does_not_redeliver(self):
        view_route, view, _, route, shared = self.fixture()
        first = self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        (shared / 'note.txt').write_text('Unmapped repository metadata', encoding='utf-8')
        self.app.git(shared, 'add', '--', 'note.txt')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Unrelated file')
        commit = self.app.git(shared, 'rev-parse', 'HEAD').strip()
        view = self.request(view_route, {**view, 'nodes': [{**node, 'gitCommit': commit} if node['id'] == 'shared' else node for node in view['nodes']]})
        self.assertTrue(all(item['status'] == 'unchanged' for item in self.preview(route)['items']))
        result = self.request(route, {'revision': view['revision'], 'scope': 'all'})
        self.assertTrue(result['unchanged'])
        self.assertEqual(result['deliveryId'], first['deliveryId'])
        self.assertEqual(self.runner.get('/api/runners/me/directory-deliveries'), [])

    def test_signed_file_hash_list_must_match_actual_content(self):
        _, view, _, route, _ = self.fixture()
        first = self.request(route, {'revision': view['revision']})
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(first['artifactDigest']))) as archive:
            files = {name: archive.read(name) for name in archive.namelist() if name != 'manifest.json'}
            manifest = json.loads(archive.read('manifest.json'))
        manifest['fileHashes']['news/main.py'] = '0' * 64
        digest, signature = self.app.artifacts.publish(files, manifest)
        from backend.runner_management.snapshot_reader import read_snapshot
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            read_snapshot(lambda value: (self.app.artifacts.read(value), signature), digest, self.app.artifacts.public_key)

    def test_per_file_hash_full_sync_transfers_only_changes_and_noop_creates_no_job_or_log(self):
        view_route, view, _, route, shared = self.fixture()
        first = self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        target = self.runner.directory / 'shared/python'
        stamp = (target / 'news/main.py').stat().st_mtime_ns
        before = self.preview(route)
        for item in before['items']:
            if item['kind'] == 'file':
                self.assertEqual(item['sha256'], hashlib.sha256((target / item['path']).read_bytes()).hexdigest())
                self.assertEqual(item['sha256'], item['previousSha256'])
        view = self.change_helper(view_route, view, shared)
        preview = self.preview(route)
        modified = next(item for item in preview['items'] if item['path'] == 'shared/helper.py')
        self.assertNotEqual(modified['sha256'], modified['previousSha256'])
        second = self.request(route, {'revision': view['revision'], 'scope': 'all', 'baselineDigest': preview['baselineDigest']})
        self.assertEqual(second['transferredFileCount'], 1)
        self.assertEqual(second['unchangedFileCount'], 1)
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(second['artifactDigest']))) as archive:
            self.assertEqual(set(archive.namelist()), {'shared/helper.py', 'manifest.json'})
            manifest = json.loads(archive.read('manifest.json'))
        self.assertEqual(manifest['retainedFiles']['news/main.py']['digest'], first['artifactDigest'])
        from backend.runner_management import directory_download
        with patch.object(directory_download, 'urlopen', wraps=directory_download.urlopen) as downloaded:
            self.runner.deliver_pending()
        self.assertEqual(len(downloaded.call_args_list), 1)
        self.assertTrue(downloaded.call_args.args[0].full_url.endswith(second['artifactDigest']))
        self.assertEqual((target / 'news/main.py').stat().st_mtime_ns, stamp)
        registry = json.loads((target / 'version.json').read_text(encoding='utf-8'))
        self.assertEqual(registry['versions'][-1]['files'], manifest['fileHashes'])
        with self.app.store.connect() as db:
            jobs = [dict(row) for row in db.execute('SELECT * FROM directory_deliveries')]
            logs = [dict(row) for row in db.execute('SELECT * FROM runtime_operations')]
        unchanged = self.request(route, {'revision': view['revision'], 'scope': 'all'})
        self.assertTrue(unchanged['unchanged'])
        self.assertEqual(unchanged['deliveryId'], second['deliveryId'])
        self.assertEqual(self.runner.get('/api/runners/me/directory-deliveries'), [])
        with self.app.store.connect() as db:
            self.assertEqual([dict(row) for row in db.execute('SELECT * FROM directory_deliveries')], jobs)
            self.assertEqual([dict(row) for row in db.execute('SELECT * FROM runtime_operations')], logs)
        # Even selected folders omit unchanged files from the sparse package.
        self.assertTrue(self.selected(route, self.preview(route), ['news', 'shared'])['unchanged'])
        view = self.change_helper(view_route, view, shared, 'hash-v3')
        partial = self.selected(route, self.preview(route), ['news', 'shared'])
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(partial['artifactDigest']))) as archive:
            self.assertEqual(set(archive.namelist()), {'shared/helper.py', 'manifest.json'})
        self.runner.deliver_pending()
        self.assertEqual((target / 'news/main.py').stat().st_mtime_ns, stamp)

    def test_full_redelivery_recovers_empty_folder_and_failed_start_explains_delivery_error(self):
        _, _, mapped, _ = self.directory_fixture()
        config = self.request('/api/runner-management/deployment-configurations', {
            **mapped, 'name': '恢复空目录', 'pathStyle': 'custom', 'directoryTemplate': 'selected-program'})
        self.runner = Runner(Path(self.tmp.name) / 'recover-directory', self.url); self.runner.enroll()
        runtime = self.request('/api/runner-management/runtime-configurations', {
            'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'],
            'runnerId': self.runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1})
        route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + self.runner.identity['runnerId'] + '/deliver'
        first = self.request(route, {'revision': config['revision'], 'scope': 'all'})
        self.runner.deliver_pending()
        target = self.runner.directory / 'selected-program'
        self.assertTrue((target / 'resources').is_dir())
        (target / 'resources').rmdir()
        config = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'],
                              {**config, 'nodes': [*config['nodes'], {'id': 'extra', 'parentId': '', 'name': 'extra', 'kind': 'folder'}]})
        self.selected(route, self.preview(route), ['extra'])
        self.runner.deliver_pending()
        current = next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        self.assertEqual(current['binding']['delivery']['status'], 'failed')
        self.assertIn('resources', current['binding']['delivery']['error'])
        with self.assertRaises(HTTPError) as blocked:
            self.request('/api/runner-management/runtime-configurations/' + current['runtimeId'] + '/start', {'revision': current['revision']})
        self.assertIn('resources', json.load(blocked.exception)['message'])
        retry = self.request(route, {'revision': config['revision'], 'scope': 'all'})
        self.assertEqual(retry['transferredFileCount'], 0)
        self.runner.deliver_pending()
        current = next(row for row in self.request('/api/runner-management/runtime-configurations') if row['runtimeId'] == runtime['runtimeId'])
        self.assertEqual(current['binding']['delivery']['status'], 'success')
        self.assertFalse(current['assignment']['enabled'])
        self.assertTrue((target / 'resources').is_dir())
        self.assertEqual(len(json.loads((target / 'version.json').read_text(encoding='utf-8'))['versions']), 2)

    def test_selected_first_delivery_expands_folder_and_cumulative_updates_keep_signed_origins(self):
        _, view, _, route, _ = self.fixture()
        first = self.preview(route)
        self.assertIsNone(first['baselineDigest'])
        self.assertTrue(all(item['status'] == 'added' for item in first['items']))
        one = self.selected(route, first, ['shared'])
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(one['artifactDigest']))) as archive:
            self.assertEqual(set(archive.namelist()), {'shared/helper.py', 'manifest.json'})
        self.runner.deliver_pending()
        target = self.runner.directory / 'shared/python'
        self.assertTrue((target / 'shared/helper.py').is_file())
        self.assertFalse((target / 'news').exists())
        stamp = (target / 'shared/helper.py').stat().st_mtime_ns
        two = self.selected(route, self.preview(route), ['news', 'resources'])
        self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'success')
        self.assertEqual((target / 'shared/helper.py').stat().st_mtime_ns, stamp)
        self.assertTrue((target / 'news/main.py').is_file())
        self.assertTrue((target / 'resources').is_dir())
        third = self.selected(route, self.preview(route), ['resources'])
        self.runner.deliver_pending()
        self.assertTrue(third['unchanged'])
        self.assertEqual(third['deliveryId'], two['deliveryId'])
        self.assertEqual(self.latest()['status'], 'success')
        registry = json.loads((target / 'version.json').read_text(encoding='utf-8'))
        self.assertEqual(len(registry['versions']), 2)
        self.assertEqual(set(registry['versions'][-1]['files']), {'shared/helper.py', 'news/main.py'})
        self.assertTrue(all(item['status'] == 'unchanged' for item in self.preview(route)['items']))

    def test_preview_detects_pinned_change_and_partial_preserves_unselected_removed_file(self):
        view_route, view, _, route, shared = self.fixture()
        self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        target = self.runner.directory / 'shared/python'
        old_main = (target / 'news/main.py').read_bytes()
        old_stamp = (target / 'news/main.py').stat().st_mtime_ns
        helper = shared / 'helpers/helper.py'
        helper.write_text("def title(): return 'snapshot-v2'\n", encoding='utf-8')
        self.app.git(shared, 'add', '--', 'helpers')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'v2')
        # HEAD alone never changes a saved view's pinned files.
        self.assertTrue(all(item['status'] == 'unchanged' for item in self.preview(route)['items']))
        changed = json.loads(json.dumps(view))
        changed['nodes'] = [node for node in changed['nodes'] if node['id'] != 'main']
        changed['nodes'][0]['gitCommit'] = self.app.git(shared, 'rev-parse', 'HEAD').strip()
        self.request(view_route, changed)
        preview = self.preview(route)
        self.assertEqual([item['path'] for item in preview['items'] if item['kind'] == 'file' and item['status'] != 'unchanged'], ['shared/helper.py'])
        self.selected(route, preview, ['shared/helper.py']); self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'success')
        self.assertEqual((target / 'news/main.py').read_bytes(), old_main)
        self.assertEqual((target / 'news/main.py').stat().st_mtime_ns, old_stamp)
        self.assertIn('snapshot-v2', (target / 'shared/helper.py').read_text())
        current = self.request(view_route)
        self.request(route, {'revision': current['revision'], 'scope': 'all'}); self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'success')
        self.assertFalse((target / 'news').exists())

    def test_selection_rejects_stale_baseline_unknown_paths_and_changed_local_version(self):
        view_route, view, _, route, shared = self.fixture()
        original = self.preview(route)
        for paths in ([], ['../outside'], ['version.json'], ['missing.py']):
            with self.assertRaises(HTTPError) as invalid:
                self.selected(route, original, paths)
            self.assertEqual(invalid.exception.code, 400)
        full = self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        with self.assertRaises(HTTPError) as stale:
            self.selected(route, original, ['news'])
        self.assertEqual(stale.exception.code, 409)
        self.change_helper(view_route, view, shared)
        self.selected(route, self.preview(route), ['shared'])
        # Server's successful baseline cannot overwrite a different local current version.
        target = self.runner.directory / 'shared/python'
        registry = target / 'version.json'
        value = json.loads(registry.read_text(encoding='utf-8'))
        value['current'] = {}
        registry.write_text(json.dumps(value), encoding='utf-8')
        before = registry.read_bytes()
        self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'failed')
        self.assertIn('本地版本已变化', self.latest()['error'])
        self.assertEqual(registry.read_bytes(), before)

    def test_retained_signed_cache_tamper_fails_atomically(self):
        view_route, view, _, route, shared = self.fixture()
        full = self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        target = self.runner.directory / 'shared/python'
        before = (target / 'version.json').read_bytes()
        self.change_helper(view_route, view, shared)
        self.selected(route, self.preview(route), ['shared'])
        (self.runner.directory / 'code/artifacts' / (full['artifactDigest'][7:] + '.zip')).write_bytes(b'tampered')
        self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'failed')
        self.assertIn('摘要校验失败', self.latest()['error'])
        self.assertEqual((target / 'version.json').read_bytes(), before)
        self.assertIn('snapshot-v1', (target / 'shared/helper.py').read_text())

    def test_manual_snapshot_and_redelivery_preserve_runtime_and_version_history(self):
        _, view, _, route, shared = self.fixture()
        tables = ('releases', 'code_versions', 'code_runtime_bindings', 'assignments')
        with self.app.store.connect() as db:
            before = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        self.assertIsNone(self.latest())
        self.assertEqual(self.runner.get('/api/runners/me/directory-deliveries'), [])
        job = self.request(route, {'revision': view['revision']})
        self.assertEqual(job['status'], 'pending')
        self.assertFalse((self.runner.directory / 'shared/python').exists())
        (shared / 'helpers/helper.py').write_text("def title():\n    return 'new-HEAD'\n", encoding='utf-8')
        self.app.git(shared, 'add', '--', 'helpers')
        self.app.git(shared, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'changed')
        self.runner.deliver_pending()
        target = self.runner.directory / 'shared/python'
        self.assertIn('snapshot-v1', (target / 'shared/helper.py').read_text())
        self.assertTrue((target / 'resources').is_dir())
        self.assertEqual(self.latest()['status'], 'success')
        self.assertEqual(self.latest()['installedPath'], str(target))
        registry = json.loads((target / 'version.json').read_text(encoding='utf-8'))
        self.assertEqual(len(registry['versions']), 1)
        self.assertFalse((target / 'versions').exists())
        repeat = self.request(route, {'revision': view['revision']})
        self.assertTrue(repeat['unchanged'])
        self.assertEqual(repeat['deliveryId'], job['deliveryId'])
        self.assertEqual(repeat['artifactDigest'], job['artifactDigest'])
        self.runner.deliver_pending()
        self.assertEqual(self.latest()['deliveryId'], repeat['deliveryId'])
        self.assertEqual(len(json.loads((target / 'version.json').read_text(encoding='utf-8'))['versions']), 1)
        with self.app.store.connect() as db:
            after = {table: [dict(row) for row in db.execute('SELECT * FROM ' + table).fetchall()] for table in tables}
        self.assertEqual(before, after)

    def test_config_queue_and_website_use_their_own_root_templates(self):
        for kind, owner, template, expected in [('config', 'mapped123', '{configId}/{queue}/prod', 'mapped123/news_list/prod'),
                                                  ('queue', 'news_list', '{queue}/test', 'news_list/test'),
                                                  ('website', 'www.example.com', '{website}/prod', 'www.example.com/prod')]:
            with self.subTest(kind=kind):
                # Fixtures create fresh repositories; isolate each binding type.
                if kind != 'config':
                    self.tearDown(); self.setUp()
                _, view, _, route, _ = self.fixture(kind, owner, template)
                self.request(route, {'revision': view['revision']})
                self.runner.deliver_pending()
                self.assertEqual(self.latest()['status'], 'success')
                self.assertTrue((self.runner.directory / expected / 'news/main.py').is_file())

    def test_runner_authorization_claim_and_pending_unbinding(self):
        _, view, _, route, _ = self.fixture()
        job = self.request(route, {'revision': view['revision']})
        other = Runner(Path(self.tmp.name) / 'other', self.url); other.enroll()
        self.assertEqual(other.get('/api/runners/me/directory-deliveries'), [])
        artifact = self.url + '/api/artifacts/' + job['artifactDigest']
        with self.assertRaises(HTTPError) as denied:
            urlopen(Request(artifact, headers={'Authorization': 'Bearer ' + other.identity['token']}))
        self.assertEqual(denied.exception.code, 403)
        with self.assertRaises(RuntimeError):
            other.post('/api/runners/me/directory-deliveries/' + job['deliveryId'] + '/claim', {})
        with self.assertRaises(HTTPError) as conflict:
            self.request(route, {'revision': view['revision']})
        self.assertEqual(conflict.exception.code, 409)
        with urlopen(Request(self.url + route.removesuffix('/deliver'), method='DELETE')) as response:
            self.assertTrue(json.load(response)['ok'])
        self.assertEqual(self.runner.get('/api/runners/me/directory-deliveries'), [])
        with self.assertRaises(HTTPError) as gone:
            self.request(route, {'revision': view['revision']})
        self.assertEqual(gone.exception.code, 404)

    def test_save_after_request_is_frozen_and_requires_another_manual_delivery(self):
        view_route, view, _, route, _ = self.fixture()
        job = self.request(route, {'revision': view['revision']})
        view = self.request(view_route, {**view, 'directoryTemplate': 'shared/python/test'})
        self.runner.deliver_pending()
        self.assertTrue((self.runner.directory / 'shared/python/news/main.py').is_file())
        self.assertFalse((self.runner.directory / 'shared/python/test').exists())
        self.assertEqual(self.latest()['layoutRevision'], job['layoutRevision'])
        self.assertEqual(self.runner.get('/api/runners/me/directory-deliveries'), [])
        with self.assertRaises(HTTPError) as stale:
            self.request(route, {'revision': job['layoutRevision']})
        self.assertEqual(stale.exception.code, 409)
        self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        self.assertTrue((self.runner.directory / 'shared/python/test/news/main.py').is_file())

    def test_unmanaged_collision_reports_failure_and_manual_retry_succeeds(self):
        view_route, view, _, route, shared = self.fixture()
        target = self.runner.directory / 'shared/python/news/main.py'
        target.parent.mkdir(parents=True); target.write_text('local file')
        self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'failed')
        self.assertIn('未托管', self.latest()['error'])
        self.assertEqual(target.read_text(), 'local file')
        target.unlink()
        self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'success')
        target.write_text('changed signed code')
        view = self.change_helper(view_route, view, shared)
        self.request(route, {'revision': view['revision']}); self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'failed')
        self.assertIn('被修改', self.latest()['error'])
        self.assertEqual(target.read_text(), 'changed signed code')

    def test_claim_is_exclusive_results_are_idempotent_and_timeout_allows_manual_retry(self):
        _, view, _, route, _ = self.fixture()
        job = self.request(route, {'revision': view['revision']})
        runner_route = '/api/runners/me/directory-deliveries/' + job['deliveryId']
        self.runner.post(runner_route + '/claim', {})
        with self.assertRaises(RuntimeError):
            self.runner.post(runner_route + '/claim', {})
        with self.assertRaises(HTTPError) as busy:
            urlopen(Request(self.url + route.removesuffix('/deliver'), method='DELETE'))
        self.assertEqual(busy.exception.code, 409)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat(timespec='seconds')
        with self.app.store.connect() as db:
            db.execute('UPDATE directory_deliveries SET started_at=? WHERE delivery_id=?', (cutoff, job['deliveryId']))
        self.assertEqual(self.latest()['status'], 'failed')
        retry = self.request(route, {'revision': view['revision']})
        self.runner.deliver_pending()
        result = self.runner.post('/api/runners/me/directory-deliveries/' + retry['deliveryId'] + '/result',
                                  {'status': 'success', 'installedPath': self.latest()['installedPath']})
        self.assertEqual(result['status'], 'success')

    def test_empty_view_and_incomplete_environment_do_not_queue_jobs(self):
        view_route, view, _, route, _ = self.fixture()
        view = self.request(view_route, {**view, 'nodes': [], 'entryPoint': ''})
        with self.assertRaises(HTTPError) as empty:
            self.request(route, {'revision': view['revision']})
        self.assertEqual(empty.exception.code, 422)
        mapped = self.request('/api/runner-management/directory-layouts/configs/mapped123')
        view = self.request(view_route, {**view, 'nodes': mapped['nodes'], 'directoryTemplate': 'shared/{environment}'})
        with self.assertRaises(HTTPError) as environment:
            self.request(route, {'revision': view['revision']})
        self.assertEqual(environment.exception.code, 400)
        self.assertIsNone(self.latest())

    def test_failed_queue_worker_does_not_block_heartbeat_or_manual_delivery(self):
        _, view, _, route, _ = self.fixture()
        self.request(route, {'revision': view['revision']})
        original_get = self.runner.get
        def get(path):
            if path.endswith('/assignments'):
                return [{'assignmentId': 'broken', 'concurrency': 1, 'releaseDigest': 'sha256:broken'}]
            return original_get(path)
        with patch.object(self.runner, 'get', side_effect=get), patch.object(self.runner, 'start', side_effect=RuntimeError('worker missing dependencies')):
            self.runner.tick()
            self.runner.delivery_thread.join(timeout=5)
        self.assertEqual(self.latest()['status'], 'success')
        status = self.runner.get('/api/runners/me/status')
        self.assertIsNotNone(status['lastHeartbeat'])
        self.assertEqual(status['status'], 'error')

    def test_tampered_download_fails_without_materializing_code(self):
        _, view, _, route, _ = self.fixture()
        job = self.request(route, {'revision': view['revision']})
        from backend.runner_management import directory_download
        import io
        class CorruptDownload(io.BytesIO):
            headers = {'X-Artifact-Signature': 'invalid'}
        with patch.object(directory_download, 'urlopen', return_value=CorruptDownload(b'corrupt code')):
            self.runner.deliver_pending()
        self.assertEqual(self.latest()['status'], 'failed')
        self.assertIn('摘要校验失败', self.latest()['error'])
        self.assertFalse((self.runner.directory / 'shared/python').exists())

if __name__ == '__main__':
    unittest.main()
