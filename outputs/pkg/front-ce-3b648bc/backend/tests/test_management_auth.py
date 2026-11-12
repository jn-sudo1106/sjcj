import io
import json
import os
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from backend.runner_management.server import Application, ApiError


class ManagementAuthTest(unittest.TestCase):
    def setUp(self):
        self.app = Application.__new__(Application)
        self.env = patch.dict(os.environ, {'RUNNER_AUTH_URL': 'http://business.test/api/user-info.htm', 'RUNNER_ADMIN_TOKEN': '', 'RUNNER_DEV_MODE': '0'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.headers = {'Cookie': 'SESSION=test-only-session', 'Access-Token': 'test-only-token'}

    def test_valid_identity_keeps_cookie_and_token_and_enforces_admin(self):
        for roles, write, allowed in [(['viewer'], False, True), (['viewer'], True, False), (['admin'], True, True)]:
            with patch('backend.runner_management.server.urlopen', return_value=io.BytesIO(json.dumps({'code': '0', 'data': {'roles': roles}}).encode())) as upstream:
                if allowed:
                    self.app.authenticate_admin(self.headers, '192.168.1.36', write=write)
                else:
                    with self.assertRaises(ApiError) as denied:
                        self.app.authenticate_admin(self.headers, '192.168.1.36', write=write)
                    self.assertEqual(denied.exception.status, 403)
                request = upstream.call_args.args[0]
                self.assertEqual(request.full_url, 'http://business.test/api/user-info.htm')
                self.assertEqual(request.get_header('Cookie'), self.headers['Cookie'])
                self.assertEqual(request.get_header('Access-token'), self.headers['Access-Token'])

    def test_wrong_html_path_or_network_error_does_not_expire_user_session(self):
        for failure in (ValueError('HTML is not JSON'), URLError('offline'), TimeoutError(), HTTPError('http://business.test', 500, 'error', {}, None)):
            with patch('backend.runner_management.server.urlopen', side_effect=failure), self.assertRaises(ApiError) as failed:
                self.app.authenticate_admin(self.headers, '192.168.1.36')
            self.assertEqual(failed.exception.status, 502)
        for payload in (b'<html>login</html>', b'[]', b'{"code":"0","data":"wrong"}'):
            with patch('backend.runner_management.server.urlopen', return_value=io.BytesIO(payload)), self.assertRaises(ApiError) as failed:
                self.app.authenticate_admin(self.headers, '192.168.1.36')
            self.assertEqual(failed.exception.status, 502)

    def test_real_expired_session_still_returns_401(self):
        with patch('backend.runner_management.server.urlopen', return_value=io.BytesIO(b'{"code":"-1","data":null}')), self.assertRaises(ApiError) as denied:
            self.app.authenticate_admin(self.headers, '192.168.1.36')
        self.assertEqual(denied.exception.status, 401)

        with patch('backend.runner_management.server.urlopen', side_effect=HTTPError('http://business.test', 401, 'unauthorized', {}, None)), self.assertRaises(ApiError) as denied:
            self.app.authenticate_admin(self.headers, '192.168.1.36')
        self.assertEqual(denied.exception.status, 401)

    def test_admin_role_works_for_non_admin_login_name_and_returns_audit_identity(self):
        user = {'roles':['admin'], 'userLoginName':'muyan'}
        with patch('backend.runner_management.server.urlopen', return_value=io.BytesIO(json.dumps({'code':'0','data':user}).encode())):
            self.assertEqual(self.app.authenticate_admin(self.headers,'192.168.1.36',write=True), user)
