import base64
import copy
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode

from backend.tests import test_deployment_resources as baseline
from backend.runner_management import deployment_resources as resources, generated_archives


class DeploymentFilesTest(unittest.TestCase):
    setUp = baseline.DeploymentResourcesTest.setUp
    tearDown = baseline.DeploymentResourcesTest.tearDown
    request = baseline.DeploymentResourcesTest.request
    fixture = baseline.DeploymentResourcesTest.fixture
    archive = baseline.DeploymentResourcesTest.archive
    save_rules = baseline.DeploymentResourcesTest.save_rules
    jobs = baseline.DeploymentResourcesTest.jobs
    route = baseline.DeploymentResourcesTest.route

    def test_reads_exact_successful_snapshot_including_retained_files_after_git_and_runner_files_change(self):
        self.fixture(); original = self.archive(include_helper=False); self.save_rules(self.runner)
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        older = self.jobs()[0]
        uploaded = self.app.upload_repository_files(self.repo['repoId'], {'directoryId': 'default', 'uploadType': 'folder', 'files': [
            {'name': 'new.example.com.py', 'relativePath': '1401218/sites/new.example.com.py', 'data': base64.b64encode(b'NEW=1\n').decode()}]}, owner_config_id='1401218')
        record = copy.deepcopy(original)
        record.update(archiveId='file-preview', taskId='file-preview', gitCommit=uploaded['gitCommit'], files=uploaded['files'])
        generated_archives.store(self.app, record)
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        newer = next(job for job in self.jobs() if job['archiveId'] == record['archiveId'])
        path = '/api/runner-management/deployment-jobs/' + newer['jobId'] + '/files'
        listing = self.request(path)
        self.assertEqual([file['path'] for file in listing['files'] if file['taskFile']], ['sites/new.example.com.py'])
        self.assertIn('main.py', [file['path'] for file in listing['files']])
        self.assertEqual(listing['deliveryId'], newer['deliveryId'])
        root = Path(self.repo['path'])
        (root / 'default/1401218/sites/new.example.com.py').write_text('NEW=999\n')
        self.app.git(root, 'add', '.'); self.app.git(root, 'commit', '-m', 'Newer repository content')
        (self.runner.directory / 'test/default/1401218/sites/new.example.com.py').write_text('LOCAL=999\n')
        self.assertEqual(self.request(path + '?' + urlencode({'path': 'sites/new.example.com.py'}))['content'], 'NEW=1\n')
        self.assertEqual(self.request(path + '?' + urlencode({'path': 'main.py'}))['content'], 'VALUE = 1\n')
        old_path = '/api/runner-management/deployment-jobs/' + older['jobId'] + '/files'
        with self.assertRaises(HTTPError) as missing: self.request(old_path + '?' + urlencode({'path': 'sites/new.example.com.py'}))
        self.assertEqual(missing.exception.code, 404)
        with self.assertRaises(HTTPError) as traversal: self.request(path + '?' + urlencode({'path': '../identity.json'}))
        self.assertEqual(traversal.exception.code, 400)

    def test_pending_deployment_has_no_confirmed_file_snapshot(self):
        self.fixture(); self.archive(include_helper=False); self.save_rules(self.runner)
        resources.dispatch(self.app)
        pending = self.jobs()[0]
        with self.assertRaises(HTTPError) as error: self.request('/api/runner-management/deployment-jobs/' + pending['jobId'] + '/files')
        self.assertEqual(error.exception.code, 409)
