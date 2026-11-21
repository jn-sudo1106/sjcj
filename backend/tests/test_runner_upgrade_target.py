"""Runner upgrade targets and artifact grants share the instance row."""
from pathlib import Path
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.tests import test_runner_management as fixtures
from backend.runner_management.runner import Runner
from backend.runner_management.store import Store


class RunnerUpgradeTargetTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request

    def test_target_is_durable_on_runner_and_only_that_instance_can_download(self):
        a = Runner(Path(self.tmp.name) / 'instance-a', self.url)
        b = Runner(Path(self.tmp.name) / 'instance-b', self.url)
        a.enroll(); b.enroll()
        digest, signature = self.app.artifacts.publish({'runner.py': b'VALUE=1\n'}, {'kind': 'runner'})
        with self.app.store.connect() as db:
            db.execute('INSERT INTO releases (digest,kind,name,platform,git_commit,status,published_at,signature,entry,git_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (digest, 'runner', 'test', 'any', 'commit', 'published', 'now', signature, 'runner.py', 'local'))
        self.assertIsNone(a.get('/api/runners/me/desired-runner')['digest'])
        self.request('/api/runner-management/runners/' + a.identity['runnerId'] + '/desired-runner', {'digest': digest})
        self.assertEqual(a.get('/api/runners/me/desired-runner')['digest'], digest)
        self.assertIsNone(b.get('/api/runners/me/desired-runner')['digest'])
        reopened = Store(self.app.store.path)
        with reopened.connect() as db:
            row = db.execute('SELECT desired_digest FROM runners WHERE runner_id=?', (a.identity['runnerId'],)).fetchone()
            self.assertEqual(row['desired_digest'], digest)
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='runner_upgrades'").fetchone())
        with urlopen(Request(self.url + '/api/artifacts/' + digest, headers={'Authorization': 'Bearer ' + a.identity['token']})) as response:
            self.assertEqual(response.status, 200)
        with self.assertRaises(HTTPError) as denied:
            urlopen(Request(self.url + '/api/artifacts/' + digest, headers={'Authorization': 'Bearer ' + b.identity['token']}))
        self.assertEqual(denied.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
