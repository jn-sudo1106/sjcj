import json
import base64
import hashlib
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch
from backend.tests import test_runner_management as baseline
from backend.runner_management.runner import Runner
from backend.runner_management import runner_files as files


class RunnerFilesTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def fixture(self):
        self.runner = Runner(Path(self.tmp.name) / 'instance', self.url); self.runner.enroll()
        self.runner.post('/api/runners/me/heartbeat', self.runner.heartbeat_payload())
        folder = self.runner.directory / 'links/1401218'; folder.mkdir(parents=True)
        (folder / 'main.py').write_text('print("hello")', encoding='utf8')
        return '/api/runner-management/runners/' + self.runner.identity['runnerId'] + '/files'

    def test_http_round_trip_lists_and_reads_real_instance_files(self):
        route = self.fixture()
        created = self.request(route, {'action':'list','path':'links/1401218'})
        result = '/api/runner-management/runner-file-requests/' + created['requestId']
        self.assertEqual(self.request(result)['status'], 'pending')
        files.poll(self.runner)
        response = self.request(result)
        self.assertEqual(response['status'], 'success')
        self.assertEqual(response['result']['items'][0]['name'], 'main.py')
        read = self.request(route, {'action':'read','path':'links/1401218/main.py'})
        files.poll(self.runner)
        response = self.request('/api/runner-management/runner-file-requests/' + read['requestId'])
        self.assertEqual(response['result']['content'], 'print("hello")')

    def operation(self, route, body):
        created = self.request(route, body)
        state = '/api/runner-management/runner-file-requests/' + created['requestId']
        self.assertNotIn('files', self.request(state))
        files.poll(self.runner)
        return self.request(state)

    def test_mkdir_upload_delete_round_trip_changes_only_selected_instance(self):
        route = self.fixture()
        result = self.operation(route, {'action': 'mkdir', 'path': 'links/1401218/uploads'})
        self.assertEqual(result['status'], 'success', result)
        content = b'\x00\xffbinary upload\n'
        uploaded = self.operation(route, {'action': 'upload', 'path': 'links/1401218/uploads', 'files': [
            {'path': 'links/1401218/uploads/sample.bin', 'data': base64.b64encode(content).decode()}]})
        self.assertEqual(uploaded['status'], 'success', uploaded)
        target = self.runner.directory / 'links/1401218/uploads/sample.bin'
        self.assertEqual(target.read_bytes(), content)
        deleted = self.operation(route, {'action': 'delete', 'path': 'links/1401218/uploads/sample.bin',
                                       'expectedHash': hashlib.sha256(content).hexdigest()})
        self.assertEqual(deleted['status'], 'success', deleted)
        self.assertFalse(target.exists())
        deleted_folder = self.operation(route, {'action': 'delete', 'path': 'links/1401218/uploads'})
        self.assertEqual(deleted_folder['status'], 'success', deleted_folder)
        self.assertFalse(target.parent.exists())
        self.assertEqual((self.runner.directory / 'links/1401218/main.py').read_text(), 'print("hello")')

    def test_existing_upload_changed_file_and_nonempty_folder_are_not_removed(self):
        route = self.fixture()
        path = 'links/1401218/main.py'
        digest = hashlib.sha256((self.runner.directory / path).read_bytes()).hexdigest()
        result = self.operation(route, {'action': 'upload', 'path': 'links/1401218', 'files': [
            {'path': path, 'data': base64.b64encode(b'overwrite').decode()}]})
        self.assertEqual(result['status'], 'failed')
        (self.runner.directory / path).write_bytes(b'changed externally')
        result = self.operation(route, {'action': 'delete', 'path': path, 'expectedHash': digest})
        self.assertEqual(result['status'], 'failed')
        self.assertIn('文件已变化', result['error'])
        result = self.operation(route, {'action': 'delete', 'path': 'links/1401218'})
        self.assertEqual(result['status'], 'failed')
        self.assertIn('目录仍有内容', result['error'])
        self.assertEqual((self.runner.directory / path).read_bytes(), b'changed externally')

    def test_mutations_reject_private_paths_traversal_and_invalid_uploads(self):
        route = self.fixture()
        for body in (
            {'action': 'mkdir', 'path': ''}, {'action': 'delete', 'path': 'identity.json'},
            {'action': 'mkdir', 'path': '../outside'},
            {'action': 'upload', 'files': [{'path': 'logs/private', 'data': ''}]},
            {'action': 'upload', 'path': 'links', 'files': [{'path': 'outside.py', 'data': ''}]},
            {'action': 'upload', 'files': [{'path': 'links/bad.bin', 'data': 'invalid==base64'}]},
        ):
            with self.subTest(body=body), self.assertRaises(HTTPError): self.request(route, body)
        from backend.runner_management.runner_file_operations import mutate
        with patch('backend.runner_management.bundle_install.linked', return_value=True), self.assertRaises(ValueError):
            mutate(self.runner.directory, {'action': 'mkdir', 'path': 'links/new'})
        with self.assertRaises(ValueError): mutate(self.runner.directory, {'action': 'mkdir', 'path': 'links/NUL'})

    def test_browse_only_runner_cannot_receive_mutations(self):
        route = self.fixture()
        payload = self.runner.heartbeat_payload(); payload.pop('fileManagementSchema')
        self.runner.post('/api/runners/me/heartbeat', payload)
        self.assertIn('requestId', self.request(route, {'action': 'list', 'path': ''}))
        with self.assertRaises(HTTPError) as error: self.request(route, {'action': 'mkdir', 'path': 'new'})
        self.assertEqual(error.exception.code, 409)
        self.assertIn('升级', json.load(error.exception)['message'])

    def test_upload_uses_file_body_limit_and_mutations_require_admin(self):
        route = self.fixture()
        data = b'x' * (1024 * 1024)
        result = self.operation(route, {'action': 'upload', 'files': [
            {'path': 'large-upload.bin', 'data': base64.b64encode(data).decode()}]})
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual((self.runner.directory / 'large-upload.bin').read_bytes(), data)
        from backend.runner_management.server import ApiError
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('需要管理员权限', 403)) as auth:
            with self.assertRaises(HTTPError) as denied: self.request(route, {'action': 'delete', 'path': 'large-upload.bin'})
            self.assertEqual(denied.exception.code, 403)
            self.assertTrue(auth.call_args.kwargs['write'])
        self.assertTrue((self.runner.directory / 'large-upload.bin').is_file())

    def test_runner_private_files_and_traversal_are_never_browsable(self):
        self.fixture()
        root = files.local(self.runner.directory, 'list', '')
        self.assertNotIn('identity.json', [item['name'] for item in root['items']])
        for path in ('../outside','D:\\outside','/etc/passwd','identity.json','pip.json','.runtime/a','links/../identity.json','logs/server.log'):
            with self.subTest(path=path), self.assertRaises(ValueError): files.local(self.runner.directory, 'read', path)

    def test_links_binary_and_large_text_are_rejected(self):
        self.fixture(); folder = self.runner.directory / 'links/1401218'
        with patch('backend.runner_management.bundle_install.linked', return_value=True), self.assertRaises(ValueError):
            files.local(self.runner.directory,'read','links/1401218/main.py')
        (folder/'binary.bin').write_bytes(b'\x00abc');(folder/'large.py').write_bytes(b'x'*65537)
        for name in ('binary.bin','large.py'):
            with self.assertRaises(ValueError): files.local(self.runner.directory,'read','links/1401218/'+name)

    def test_offline_or_old_runner_returns_upgrade_or_offline_error(self):
        route = self.fixture()
        self.runner.post('/api/runners/me/heartbeat', {'runnerDigest':'old'})
        with self.assertRaises(HTTPError) as old: self.request(route, {'action':'list','path':''})
        self.assertEqual(old.exception.code,409)
        self.assertIn('升级',json.load(old.exception)['message'])
        with self.app.store.connect() as db: db.execute('UPDATE runners SET status=?',('offline',))
        with self.assertRaises(HTTPError): self.request(route, {'action':'list','path':''})

    def test_other_runner_cannot_complete_request_and_expired_requests_fail(self):
        route = self.fixture(); created = self.request(route, {'action':'list','path':''})
        other = Runner(Path(self.tmp.name)/'other',self.url);other.enroll()
        with self.assertRaises(RuntimeError): other.post('/api/runners/me/file-requests/'+created['requestId']+'/result',{'result':{}})
        other.close()
        with patch.object(files.time,'time',return_value=files.time.time()+120), self.assertRaises(HTTPError) as expired:
            self.request('/api/runner-management/runner-file-requests/'+created['requestId'])
        self.assertEqual(expired.exception.code,408)

    def test_file_browse_failure_does_not_block_code_delivery(self):
        self.fixture()
        with patch.object(files,'poll',side_effect=RuntimeError('unavailable')), patch.object(self.runner,'deliver_pending') as delivery:
            self.runner.delivery_cycle()
        delivery.assert_called_once()
