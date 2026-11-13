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
        self.app.upload_repository_files(self.repo['repoId'], {'directoryId': 'default', 'uploadType': 'folder', 'files': [
            {'name': 'existing.example.py', 'relativePath': '1401218/sites/existing.example.py',
             'data': base64.b64encode(b'VALUE=1\n').decode()}]}, owner_config_id='1401218')
        source = b'import time\nwhile True:\n    time.sleep(0.1)\n'
        archive = self.archive(content=source,include_helper=False)
        rules = self.save_rules(self.runner)
        self.request(self.route, {**rules, 'items': [{**rules['items'][0], 'entryPoint': 'main.py'}]})
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
        site_path = '1401218/sites/www.mkky.cn.py'
        uploaded = self.app.upload_repository_files(self.repo['repoId'],{'directoryId':'default','uploadType':'folder','overwrite':True,'files':[
            {'name':'www.mkky.cn.py','relativePath':site_path,'data':base64.b64encode(b'VALUE=2\n').decode()},
            {'name':'existing.example.py','relativePath':'1401218/sites/existing.example.py','data':base64.b64encode(b'VALUE=999\n').decode()},
            {'name':'main.py','relativePath':'1401218/main.py','data':base64.b64encode(b'UNRELATED_EDIT=True\n').decode()},
            {'name':'demo.py','relativePath':'1401218/demo.py','data':base64.b64encode(b'REFERENCE_ONLY=True\n').decode()},
        ]},owner_config_id='1401218')
        newer=copy.deepcopy(archive)
        newer.update(archiveId='new-source',taskId='new-source',gitCommit=uploaded['gitCommit'])
        newer['sourceContext']['sourceId']='430024909'
        newer['files'] = [{'path':'default/'+site_path,'relativePath':site_path,'sha256':hashlib.sha256(b'VALUE=2\n').hexdigest(),'size':8}]
        heartbeat = self.runner.heartbeat_payload()
        self.runner.post('/api/runners/me/heartbeat', {**heartbeat, 'liveFileDeploymentSchema': 1})
        generated_archives.store(self.app,newer); resources.dispatch(self.app)
        waiting = self.jobs()[0]
        self.assertEqual(waiting['status'], 'queued')
        self.assertEqual(waiting['deploymentId'], old['deploymentId'])
        self.assertIn('等待 Runner 升级', waiting['message'])
        self.runner.post('/api/runners/me/heartbeat', heartbeat)
        resources.dispatch(self.app)
        new=self.jobs()[0]
        self.assertEqual(new['status'],'delivering',new)
        self.assertEqual(new['deploymentId'],old['deploymentId'])
        self.assertEqual(new['deploymentScope'], 'task-files')
        self.assertEqual(new['selectedPaths'], ['sites/www.mkky.cn.py'])
        self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'],'success')
        self.assertEqual((target/'sites/www.mkky.cn.py').read_bytes(),b'VALUE=2\n')
        self.assertEqual((target/'sites/existing.example.py').read_bytes(),b'VALUE=1\n')
        self.assertEqual((target/'main.py').read_bytes(),source)
        self.assertFalse((target/'demo.py').exists())
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
