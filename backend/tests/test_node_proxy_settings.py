import unittest
from urllib.error import HTTPError
from backend.tests import test_runner_management as fixtures
from backend.runner_management import node_proxy_settings as proxy


class NodeProxySettingsTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request

    def test_proxy_is_shared_by_config_encrypted_and_restored_after_reload(self):
        route = '/api/runner-management/node-proxy-settings'
        before = self.request(route + '?configId=1401218')
        self.assertFalse(before['configured'])
        body = {'configId': '1401218', 'revision': 0, 'useProxy': True, 'proxyDetail': {
            'ip': 'proxy.example.com', 'port': 31100, 'account': 'test-user', 'password': 'not-a-real-secret'}}
        saved = self.request(route, body)
        self.assertEqual(self.request(route + '?configId=1401218'), saved)
        self.assertFalse(self.request(route + '?configId=1401219')['configured'])
        with self.app.store.connect() as db:
            raw = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (proxy.PREFIX + '1401218',)).fetchone()['setting_value']
        self.assertNotIn('not-a-real-secret', raw)
        self.assertNotIn('test-user', raw)
        with self.assertRaises(HTTPError) as error: self.request(route, body)
        self.assertEqual(error.exception.code, 409)
        disabled = self.request(route, {'configId': '1401218', 'revision': saved['revision'], 'useProxy': False})
        self.assertFalse(disabled['useProxy']); self.assertNotIn('proxyDetail', disabled)

    def test_invalid_proxy_never_persists(self):
        with self.assertRaises(HTTPError):
            self.request('/api/runner-management/node-proxy-settings', {'configId': '1401218', 'revision': 0, 'useProxy': True,
                'proxyDetail': {'ip': 'bad/host', 'port': 99999}})
        self.assertFalse(proxy.read(self.app, '1401218')['configured'])
