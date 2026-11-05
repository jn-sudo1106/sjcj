import json
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
