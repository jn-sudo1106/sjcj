import hashlib
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.tests import test_runner_management as fixture
from backend.runner_management.runner import Runner
from backend.runner_management.snapshot_reader import read_snapshot
from backend.runner_management.deployment_resources import layout_nodes


class LargeDeploymentTest(unittest.TestCase):
    setUp = fixture.ManagementIntegrationTest.setUp
    tearDown = fixture.ManagementIntegrationTest.tearDown

    def request(self, path, payload=None):
        request = Request(self.url + path, data=json.dumps(payload).encode() if payload is not None else None,
                          headers={'Content-Type': 'application/json'}, method='POST' if payload is not None else 'GET')
        with urlopen(request, timeout=90) as response: return json.load(response)

    def prepare(self):
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        source = Path(repo['path']); source.mkdir(parents=True, exist_ok=True)
        self.app.git(source, 'init', '-b', 'main')
        (source / 'runtime/bin').mkdir(parents=True)
        # Incompressible data also crosses the old 12 MiB network read limit.
        data = os.urandom(13 * 1024 * 1024)
        (source / 'runtime/bin/python.dll').write_bytes(data)
        (source / 'runtime/bin/extension.cp312-win_amd64.pyd').write_bytes(b'compiled-extension')
        (source / 'runtime/newslink.py').write_text('print("large-package")\n')
        for index in range(205): (source / f'runtime/bin/module{index}.py').write_text('VALUE=1\n')
        commit = self.commit(source)
        files = [{'path': path.relative_to(source).as_posix()} for path in (source / 'runtime').rglob('*') if path.is_file()]
        nodes = layout_nodes({'files': files, 'repoId': repo['repoId'], 'gitCommit': commit, 'directoryPath': 'runtime'}, 'runtime')
        config = self.request('/api/runner-management/deployment-configurations', {
            'name': 'Portable runtime', 'directoryTemplate': 'large-runtime', 'pathStyle': 'custom',
            'entryPoint': '', 'nodes': nodes})
        self.assertGreater(len(config['nodes']), 200)
        self.runner = Runner(Path(self.tmp.name) / 'instance', self.url); self.runner.enroll()
        self.request('/api/runner-management/directory-bindings', {
            'bindingType': 'deployment', 'ownerId': config['deploymentId'], 'runnerId': self.runner.identity['runnerId']})
        route = '/api/runner-management/directory-bindings/deployment/' + config['deploymentId'] + '/' + self.runner.identity['runnerId']
        return source, config, route, hashlib.sha256(data).hexdigest()

    def commit(self, source):
        self.app.git(source, 'add', '--', 'runtime')
        self.app.git(source, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'runtime snapshot')
        return self.app.git(source, 'rev-parse', 'HEAD').strip()

    def test_full_large_runtime_then_tiny_incremental_update_retains_binary(self):
        source, config, route, binary_hash = self.prepare()
        full = self.request(route + '/deliver', {'revision': config['revision'], 'scope': 'all'})
        self.assertGreater(len(self.app.artifacts.read(full['artifactDigest'])), 12 * 1024 * 1024)
        self.runner.deliver_pending()
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM directory_deliveries WHERE delivery_id=?', (full['deliveryId'],)).fetchone()['status'], 'success')
        target = self.runner.directory / 'large-runtime'
        self.assertEqual(hashlib.sha256((target / 'bin/python.dll').read_bytes()).hexdigest(), binary_hash)
        self.assertEqual((target / 'bin/extension.cp312-win_amd64.pyd').read_bytes(), b'compiled-extension')
        from backend.runner_management.deployment_configuration import program_snapshot
        with self.app.store.connect() as db:
            processor = program_snapshot(self.app, {**config, 'entryPoint': 'newslink.py'}, db)
        self.request('/api/runner-management/assignments', {'runnerId': self.runner.identity['runnerId'],
            'queue': 'large-runtime-check', 'processorType': 'deployment-entry', 'releaseDigest': processor,
            'concurrency': 1, 'environment': 'test'})
        prepared, manifest = self.runner.prepare(processor)
        self.assertEqual(manifest['entry'], 'newslink.py')
        self.assertEqual(hashlib.sha256((prepared / 'bin/python.dll').read_bytes()).hexdigest(), binary_hash)
        (source / 'runtime/newslink.py').write_text('print("incremental-update")\n')
        commit = self.commit(source)
        nodes = [{**node, 'gitCommit': commit} if node.get('sourcePath') == 'runtime/newslink.py' else node for node in config['nodes']]
        config = self.request('/api/runner-management/deployment-configurations/' + config['deploymentId'], {**config, 'nodes': nodes})
        preview = self.request(route + '/delivery-preview')
        partial = self.request(route + '/deliver', {'revision': config['revision'], 'scope': 'selected',
            'paths': ['newslink.py'], 'baselineDigest': preview['baselineDigest']})
        self.assertLess(len(self.app.artifacts.read(partial['artifactDigest'])), 100000)
        self.runner.deliver_pending()
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM directory_deliveries WHERE delivery_id=?', (partial['deliveryId'],)).fetchone()['status'], 'success')
        self.assertIn('incremental-update', (target / 'newslink.py').read_text())
        self.assertEqual(hashlib.sha256((target / 'bin/python.dll').read_bytes()).hexdigest(), binary_hash)

    def test_old_runner_gets_upgrade_message_before_delivery_is_created(self):
        _, config, route, _ = self.prepare()
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET capabilities=? WHERE runner_id=?', ('["python"]', self.runner.identity['runnerId']))
        with self.assertRaises(HTTPError) as failure:
            self.request(route + '/deliver', {'revision': config['revision'], 'scope': 'all'})
        self.assertEqual(failure.exception.code, 409)
        self.assertIn('Runner', failure.exception.read().decode())
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) total FROM directory_deliveries').fetchone()['total'], 0)

    def test_signed_bundles_still_enforce_expanded_and_manifest_limits(self):
        digest, signature = self.app.artifacts.publish({'bin/data.dll': b'x' * 2048}, {'kind': 'script', 'layoutSchema': 2})
        def read(value): return self.app.artifacts.read(value), signature
        with patch('backend.runner_management.snapshot_reader.MAX_CODE_BYTES', 1024), self.assertRaises(ValueError):
            read_snapshot(read, digest, self.app.artifacts.public_key)
        with patch('backend.runner_management.snapshot_reader.MAX_MANIFEST_BYTES', 10), self.assertRaises(ValueError):
            read_snapshot(read, digest, self.app.artifacts.public_key)

    def test_large_layout_metadata_can_be_saved_and_edited_via_http(self):
        payload = {'name': 'Large metadata', 'directoryTemplate': 'metadata', 'pathStyle': 'custom', 'entryPoint': '',
                   'nodes': [{'id': str(i), 'parentId': '', 'kind': 'folder', 'name': f'folder_{i}_' + 'x' * 100} for i in range(2000)]}
        self.assertGreater(len(json.dumps(payload).encode()), 256 * 1024)
        saved = self.request('/api/runner-management/deployment-configurations', payload)
        edited = self.request('/api/runner-management/deployment-configurations/' + saved['deploymentId'], {**saved, 'name': 'Edited large metadata'})
        self.assertEqual(edited['name'], 'Edited large metadata')
        self.assertEqual(len(edited['nodes']), 2000)
