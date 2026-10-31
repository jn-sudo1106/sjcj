import io
import base64
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen
import zipfile

from backend.tests import test_runner_management as baseline
from backend.tests.test_code_generation_servers import CodeServerTest
from backend.runner_management import code_servers,generation_workspaces
from backend.code_generation_server.bootstrapper import CodeServerBootstrapper


class CodeServerUpgradeTest(unittest.TestCase):
    setUp=baseline.ManagementIntegrationTest.setUp
    tearDown=CodeServerTest.tearDown
    request=baseline.ManagementIntegrationTest.request
    start_remote=CodeServerTest.start_remote

    def test_adapters_share_launcher_lifecycle_and_fresh_package_pins_selected_release(self):
        from backend.runner_management.bootstrapper import Bootstrapper
        from backend.runner_management.program_launcher import ProgramLauncher
        self.assertIs(Bootstrapper.start,ProgramLauncher.start)
        self.assertIs(CodeServerBootstrapper.start,ProgramLauncher.start)
        self.assertIs(Bootstrapper.healthy,CodeServerBootstrapper.healthy)
        self.assertIs(Bootstrapper.stop,CodeServerBootstrapper.stop)
        release=self.request('/api/runner-management/code-servers/releases',{})
        with zipfile.ZipFile(io.BytesIO(code_servers.package(self.app,self.url,digest=release['digest']))) as archive:
            self.assertIn('runner_management/program_launcher.py',archive.namelist())
            self.assertEqual(json.loads(archive.read('current.json'))['digest'],release['digest'])
            self.assertIn('code-server-versions/'+release['digest'][7:]+'.sig',archive.namelist())
        from backend.runner_management.server import ApiError
        runner=self.app.publish_runner()
        with self.assertRaises(ApiError):code_servers.package(self.app,self.url,digest=runner['digest'])

    @unittest.skipUnless(os.name == 'nt', 'Windows venv redirector regression')
    def test_windows_venv_worker_pid_matches_real_service_and_upgrade_health(self):
        import venv
        root=Path(self.tmp.name)/'venv-worker';root.mkdir()
        environment=root/'venv';venv.EnvBuilder(with_pip=False).create(environment)
        venv_python=environment/'Scripts/python.exe'
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1',0));port=reserved.getsockname()[1]
        config={'platform':self.url,'workspace':'workspace','host':'127.0.0.1','port':port,
                'advertiseUrl':f'http://127.0.0.1:{port}',
                'enrollCode':self.request('/api/runner-management/code-servers/enrollment-code',{})['code']}
        (root/'config.json').write_text(json.dumps(config))
        bootstrap=CodeServerBootstrapper(root,config)
        def cleanup():
            bootstrap.stop()
            for logger in (bootstrap.client.logs.logger,bootstrap.client.service.logger):
                for handler in logger.handlers[:]:handler.close();logger.removeHandler(handler)
        self.addCleanup(cleanup)
        with patch('backend.code_generation_server.bootstrapper.sys.executable',str(venv_python)):
            bootstrap.current_digest='source-local';bootstrap.process=bootstrap.start('source-local')
            self.assertTrue(bootstrap.healthy('source-local',timeout=10))
            self.assertEqual(bootstrap.process.pid,bootstrap.client.control('status')['pid'])
            release=self.request('/api/runner-management/code-servers/releases',{})
            sid=bootstrap.client.identity['serverId']
            self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[sid],'digest':release['digest']})
            bootstrap.client.get('/api/runners/me/desired-runner')
            bootstrap.switch(release['digest'])
            self.assertEqual(bootstrap.process.pid,bootstrap.client.control('status')['pid'])
            self.assertEqual(json.loads(bootstrap.current_path.read_text())['digest'],release['digest'])

    def test_release_is_deterministic_legacy_requires_setup_and_artifact_is_scoped(self):
        service,endpoint,identity,payload=self.start_remote()
        first=self.request('/api/runner-management/code-servers/releases',{})
        second=self.request('/api/runner-management/code-servers/releases',{})
        self.assertEqual(first['digest'],second['digest'])
        self.assertTrue(first['created']);self.assertFalse(second['created'])
        with self.assertRaises(HTTPError) as denied:
            self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[identity['serverId']],'digest':first['digest']})
        self.assertEqual(denied.exception.code,409)
        code_servers.heartbeat(self.app,{'Authorization':'Bearer '+identity['token']},{**payload,'serverId':identity['serverId'],'pid':1234,'upgradeSchema':1,'actualDigest':'source-local'})
        headers={'Authorization':'Bearer '+identity['token'],'X-Code-Server-ID':identity['serverId']}
        artifact=self.url+'/api/code-servers/me/artifacts/'+first['digest']
        with self.assertRaises(HTTPError) as denied: urlopen(Request(artifact,headers=headers))
        self.assertEqual(denied.exception.code,403)
        job=self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[identity['serverId']],'digest':first['digest']})['items'][0]
        repeated=self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[identity['serverId']],'digest':first['digest']})['items'][0]
        self.assertEqual(job['requestId'],repeated['requestId'])
        with urlopen(Request(artifact,headers=headers)) as response:
            self.assertTrue(response.headers['X-Artifact-Signature'])
            self.assertTrue(response.read().startswith(b'PK'))
        with generation_workspaces.serialized(identity['serverId'],'workspace',1):
            with urlopen(Request(self.url+'/api/code-servers/me/desired',headers=headers)) as response:
                desired=json.load(response)
            self.assertIsNone(desired['digest']);self.assertTrue(desired['waiting'])
        # A worker cannot claim success before its target digest is observed.
        request=Request(self.url+'/api/code-servers/me/upgrade-result',headers={**headers,'Content-Type':'application/json'},data=json.dumps({'requestId':job['requestId'],'status':'succeeded'}).encode())
        with self.assertRaises(HTTPError) as denied:urlopen(request)
        self.assertEqual(denied.exception.code,409)
        with self.assertRaises(HTTPError) as denied:urlopen(Request(self.url+'/api/code-servers/me/status',headers={**headers,'Authorization':'Bearer bad'}))
        self.assertEqual(denied.exception.code,401)
        with zipfile.ZipFile(io.BytesIO(code_servers.package(self.app,self.url,existing=True))) as archive:
            self.assertNotIn('config.json',archive.namelist());self.assertNotIn('identity.json',archive.namelist())
            self.assertIn('runner_management/bootstrapper.py',archive.namelist())
            self.assertIn('service.py',archive.namelist());self.assertIn('requirements.txt',archive.namelist())
        # An offline instance already on this digest completes when it reconnects.
        with self.app.store.connect() as db:
            current=code_servers.read(self.app,identity['serverId'])
            current.update(actualDigest=first['digest'],lastHeartbeat='2020-01-01T00:00:00+00:00')
            code_servers.write(db,current)
        request=Request(self.url+'/api/code-servers/me/upgrade-result',headers={**headers,'Content-Type':'application/json'},data=json.dumps({'requestId':job['requestId'],'status':'failed'}).encode())
        with urlopen(request):pass
        scheduled=self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[identity['serverId']],'digest':first['digest']})['items'][0]
        self.assertEqual(scheduled['status'],'pending')
        code_servers.heartbeat(self.app,{'Authorization':'Bearer '+identity['token']},{**payload,'serverId':identity['serverId'],'pid':1234,'upgradeSchema':1,'actualDigest':first['digest']})
        self.assertEqual(self.request('/api/runner-management/code-servers')['items'][0]['upgrade']['status'],'succeeded')

    def test_signed_upgrade_health_failure_rolls_back_and_preserves_instance(self):
        root=Path(self.tmp.name)/'supervised';root.mkdir()
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
        config={'platform':self.url,'host':'127.0.0.1','port':port,'workspace':'./workspace',
                'advertiseUrl':f'http://127.0.0.1:{port}','enrollCode':self.request('/api/runner-management/code-servers/enrollment-code',{})['code']}
        config_file=root/'config.json';config_file.write_text(json.dumps(config))
        bootstrap=CodeServerBootstrapper(root,config)
        def cleanup():
            bootstrap.stop()
            for logger in (bootstrap.client.logs.logger,bootstrap.client.service.logger):
                for handler in logger.handlers[:]:
                    handler.close();logger.removeHandler(handler)
        self.addCleanup(cleanup)
        identity=(root/'identity.json').read_bytes()
        (root/'workspace/keep.py').write_text('KEEP = True')
        bootstrap.current_digest='source-local';bootstrap.process=bootstrap.start('source-local')
        self.assertTrue(bootstrap.healthy('source-local'))
        old_pid=bootstrap.process.pid
        release=self.request('/api/runner-management/code-servers/releases',{})
        server_id=bootstrap.client.identity['serverId']
        self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[server_id],'digest':release['digest']})
        self.assertEqual(bootstrap.client.get('/api/runners/me/desired-runner')['digest'],release['digest'])
        bootstrap.switch(release['digest'])
        self.assertNotEqual(old_pid,bootstrap.process.pid)
        self.assertEqual(json.loads(bootstrap.current_path.read_text())['digest'],release['digest'])
        self.assertEqual((root/'identity.json').read_bytes(),identity)
        self.assertEqual(json.loads(config_file.read_text()),config)
        self.assertEqual((root/'workspace/keep.py').read_text(),'KEEP = True')
        broken,signature=self.app.artifacts.publish({'code_generation_server/__init__.py':b'', 'code_generation_server/service.py':b'raise SystemExit(3)\n'},
            {'kind':'code-server','entryModule':'code_generation_server.service'})
        with self.app.store.connect() as db:
            db.execute('INSERT INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)',(broken,'code-server','broken','any','local','published','2026-10-28',signature,'code_generation_server.service','local'))
        self.request('/api/runner-management/code-servers/upgrades',{'serverIds':[server_id],'digest':broken})
        bootstrap.client.get('/api/runners/me/desired-runner')
        with self.assertRaisesRegex(RuntimeError,'已恢复上一版本'):bootstrap.switch(broken)
        self.assertTrue(bootstrap.healthy(release['digest']))
        self.assertEqual(json.loads(bootstrap.current_path.read_text())['digest'],release['digest'])
        item=self.request('/api/runner-management/code-servers')['items'][0]
        self.assertEqual(item['upgrade']['status'],'failed')
        # Tampered cache must be rejected without stopping the healthy worker.
        pid=bootstrap.process.pid
        cached=root/'code-server-versions'/release['digest'][7:]/'code_generation_server/service.py'
        signature_path=cached.parents[1].with_suffix('.sig')
        signature_before=signature_path.read_bytes()
        signature_path.write_bytes(base64.b64encode(b'0'*64))
        with self.assertRaises(Exception):bootstrap.download(release['digest'])
        signature_path.write_bytes(signature_before)
        extra=cached.parent/'unexpected.py';extra.write_text('raise SystemExit(99)')
        with self.assertRaisesRegex(ValueError,'未签名文件'):bootstrap.download(release['digest'])
        extra.unlink()
        cached.write_text('raise SystemExit(99)')
        with self.assertRaisesRegex(ValueError,'被修改'):bootstrap.download(release['digest'])
        self.assertIsNone(bootstrap.process.poll());self.assertEqual(pid,bootstrap.process.pid)

    def test_downloaded_package_starts_without_project_imports(self):
        root=Path(self.tmp.name)/'portable';root.mkdir()
        release=self.request('/api/runner-management/code-servers/releases',{})
        with zipfile.ZipFile(io.BytesIO(code_servers.package(self.app,self.url,digest=release['digest']))) as archive:
            archive.extractall(root)
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1',0));port=reserved.getsockname()[1]
        config=json.loads((root/'config.json').read_text())
        config.update(host='127.0.0.1',port=port,advertiseUrl=f'http://127.0.0.1:{port}')
        (root/'config.json').write_text(json.dumps(config))
        log=(root/'launch-output.log').open('wb')
        environment=dict(os.environ);environment.pop('PYTHONPATH',None)
        child=subprocess.Popen([sys.executable,str(root/'start.py')],cwd=root,env=environment,stdout=log,stderr=log,
                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=='nt' else 0)
        try:
            until=time.monotonic()+25
            ready=None
            while time.monotonic()<until and child.poll() is None:
                items=self.request('/api/runner-management/code-servers')['items']
                ready=next((item for item in items if item['installDirectory']==str(root) and item.get('upgradeCapable')),None)
                if ready:break
                time.sleep(0.25)
            self.assertIsNotNone(ready,'Portable supervisor did not report an upgrade-capable worker')
            self.assertEqual(ready['actualDigest'],release['digest'])
            from backend.runner_management.program_launcher import LAUNCHER_VERSION
            self.assertEqual(ready['launcherVersion'],LAUNCHER_VERSION)
            self.assertTrue((root/'identity.json').is_file())
        finally:
            if child.poll() is None:
                child.send_signal(signal.CTRL_BREAK_EVENT if os.name=='nt' else signal.SIGTERM)
                try:child.wait(timeout=20)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
            log.close()
