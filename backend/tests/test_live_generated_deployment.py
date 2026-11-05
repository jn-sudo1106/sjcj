import copy
import base64
import hashlib
import json
import unittest
from backend.tests import test_deployment_resources as baseline
from backend.runner_management import deployment_resources as resources, generated_archives


class LiveGeneratedDeploymentTest(unittest.TestCase):
    setUp = baseline.DeploymentResourcesTest.setUp
    tearDown = baseline.DeploymentResourcesTest.tearDown
    request = baseline.DeploymentResourcesTest.request
    fixture = baseline.DeploymentResourcesTest.fixture
    archive = baseline.DeploymentResourcesTest.archive
    save_rules = baseline.DeploymentResourcesTest.save_rules
    jobs = baseline.DeploymentResourcesTest.jobs
    route = baseline.DeploymentResourcesTest.route

    def test_new_source_script_reuses_config_and_does_not_restart_existing_process(self):
        self.fixture()
        source = b'import time\nwhile True:\n    time.sleep(0.1)\n'
        archive = self.archive(content=source,include_helper=False); self.save_rules(self.runner)
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        old = self.jobs()[0]
        with self.app.store.connect() as db:
            runtime = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?',('runtime-config:'+old['runtimeId'],)).fetchone()['setting_value'])
            db.execute('UPDATE assignments SET enabled=1 WHERE assignment_id=?',(runtime['assignmentId'],))
        self.runner.tick()
        if self.runner.delivery_thread: self.runner.delivery_thread.join(timeout=3)
        digest, child, _ = next(iter(self.runner.processes.values()))
        pid=child.pid; target=self.runner.directory/'test/default/1401218'; inode=target.stat().st_ino
        modified=(target/'main.py').stat().st_mtime_ns
        uploaded = self.app.upload_repository_files(self.repo['repoId'],{'directoryId':'default','uploadType':'folder','files':[
            {'name':'www.mkky.cn.py','relativePath':'1401218/www.mkky.cn.py','data':base64.b64encode(b'VALUE=2\n').decode()}]},owner_config_id='1401218')
        newer=copy.deepcopy(archive)
        newer.update(archiveId='new-source',taskId='new-source',gitCommit=uploaded['gitCommit'])
        newer['sourceContext']['sourceId']='430024909'
        newer['files'].append({'path':'default/1401218/www.mkky.cn.py','relativePath':'1401218/www.mkky.cn.py','sha256':hashlib.sha256(b'VALUE=2\n').hexdigest(),'size':8})
        generated_archives.store(self.app,newer); resources.dispatch(self.app)
        new=self.jobs()[0]
        self.assertEqual(new['status'],'delivering',new)
        self.assertEqual(new['deploymentId'],old['deploymentId'])
        self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'],'success')
        self.assertEqual((target/'www.mkky.cn.py').read_bytes(),b'VALUE=2\n')
        self.assertEqual(target.stat().st_ino,inode);self.assertEqual((target/'main.py').stat().st_mtime_ns,modified)
        self.assertIsNone(child.poll());self.assertEqual(child.pid,pid)
        with self.app.store.connect() as db:
            assignment=db.execute('SELECT enabled,release_digest FROM assignments WHERE assignment_id=?',(runtime['assignmentId'],)).fetchone()
        self.assertEqual(assignment['enabled'],1);self.assertEqual(assignment['release_digest'],digest)
        # A dependency/entry edit is still queued, rather than touching the live program.
        self.archive('changed-entry',content=b'VALUE=99\n',created='2026-11-05T03:00:00Z',include_helper=False)
        resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'],'queued')
        self.assertIn('main.py',self.jobs()[0]['message'])
        self.assertIsNone(child.poll())
