import json
import contextlib
from pathlib import Path
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from backend.tests import test_database_generation as fixture_module
from backend.runner_management import code_servers, database_generation as tasks, generation_dispatcher, model_interfaces
from backend.runner_management import generated_archives, generation_parallel, generation_workspaces


class ParallelGenerationTest(unittest.TestCase):
    setUp = fixture_module.DatabaseGenerationTest.setUp
    tearDown = fixture_module.DatabaseGenerationTest.tearDown
    request = fixture_module.DatabaseGenerationTest.request
    fixture = fixture_module.DatabaseGenerationTest.fixture
    start_remote = fixture_module.DatabaseGenerationTest.start_remote
    configured = fixture_module.DatabaseGenerationTest.configured
    handler = fixture_module.DatabaseGenerationTest.handler

    def test_direct_generation_can_finish_while_parallel_publication_waits_for_its_workspace(self):
        selected = {'generationServerId': 'server', 'timeoutSeconds': 2,
                    '_publishedWorkspace': {'prjDir': '/workspace/101', 'codeDir': '/workspace/101/code'}}
        waiting, direct_done = threading.Event(), threading.Event()
        original = generation_parallel.publishing
        @contextlib.contextmanager
        def observed(item):
            if item.get('_publishedWorkspace'): waiting.set()
            with original(item): yield
        with patch.object(generation_parallel, 'publishing', observed), patch.object(generated_archives, '_finish', return_value={}):
            with generation_workspaces.serialized_paths('server', ['/workspace/101', '/workspace/101/code'], 2):
                background = threading.Thread(target=generated_archives.finish, args=(self.app, selected, None, '', '', None))
                background.start(); self.assertTrue(waiting.wait(1))
                def finish_direct():
                    generated_archives.finish(self.app, {}, None, '', '', None)
                    direct_done.set()
                direct = threading.Thread(target=finish_direct); direct.start()
                succeeded = direct_done.wait(1)
            background.join(timeout=3); direct.join(timeout=3)
        self.assertTrue(succeeded, 'Publication must not hold the Git/archive locks while waiting for a direct generator')

    def test_no_jobs_does_not_contact_servers(self):
        with patch.object(code_servers, 'registry', side_effect=AssertionError('idle poll must not contact servers')):
            generation_dispatcher.dispatch(self.app)

    def test_draining_server_does_not_receive_new_tasks(self):
        service, _, body, _ = self.configured()
        job = tasks.create(self.app, body)['job']
        service.control('drain')
        generation_dispatcher.dispatch(self.app)
        self.assertEqual(tasks.read(self.app, job['taskId'])['status'], 'queued')
        self.assertFalse(generation_dispatcher.WORKERS)

    def test_same_server_two_ports_run_together_and_publish_only_their_own_files(self):
        service, origin, body, _ = self.configured()
        entered, release = threading.Event(), threading.Event()
        calls, guard = [], threading.Lock()

        class Model(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                name = next(name for name in ('first.py', 'second.py', 'third.py') if '生成文件名：' + name in payload['prompt'])
                with guard:
                    calls.append((name, payload['code_dir'], payload['cdp_port']))
                    if len(calls) >= 2:
                        entered.set()
                release.wait(15)
                root = Path(payload['code_dir']); root.mkdir(parents=True, exist_ok=True)
                (root / name).write_text('def scrape(url): return []\n')
                (root / 'requirements.txt').write_text('requests>=2.31\n' if name != 'second.py' else 'beautifulsoup4\n')
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"content":"generated"}')

        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        self.addCleanup(upstream.server_close); self.addCleanup(upstream.shutdown)
        endpoint = f'http://127.0.0.1:{upstream.server_port}'
        service.config['allowedModelOrigins'] = [endpoint]
        settings = model_interfaces.listing(self.app)
        agent = next(item for item in settings['items'] if item['id'] == 'workbuddy-agent-hy3')
        agent.update(endpoint=endpoint + '/wb/agent', cdpPort=9222)
        settings['items'].append({**agent, 'id': 'parallel-second', 'name': 'Second agent', 'isDefault': False, 'cdpPort': 9223})
        model_interfaces.save(self.app, settings)
        jobs = [tasks.create(self.app, {**body, 'sourceId': str(700 + index), 'generation': {
            'interfaceId': 'all', 'fileName': name}})['job'] for index, name in enumerate(('first.py', 'second.py', 'third.py'))]
        server = code_servers.read(self.app, service.identity['serverId'])
        # Simulate the old serial poller already working on the first task.
        first = tasks.claim(self.app, server)['job']
        worker = threading.Thread(target=tasks.execute, args=(self.handler(), self.app, server, first['taskId']))
        worker.start()
        try:
            generation_dispatcher.dispatch(self.app)
            self.assertTrue(entered.wait(8), [tasks.read(self.app, job['taskId'])['message'] for job in jobs])
            self.assertEqual(len(calls), 2)
            self.assertEqual({port for _, _, port in calls}, {9222, 9223})
            self.assertEqual(len({path for _, path, _ in calls}), 2)
            self.assertEqual(tasks.read(self.app, jobs[2]['taskId'])['status'], 'queued')
        finally:
            release.set(); worker.join(timeout=20)
            deadline = time.monotonic() + 20
            while generation_dispatcher.WORKERS and time.monotonic() < deadline:
                time.sleep(.05)
        for job, filename in zip(jobs[:2], ('first.py', 'second.py')):
            saved = tasks.read(self.app, job['taskId'])
            self.assertEqual(saved['status'], 'succeeded', saved['message'])
            names = {Path(file['path']).name for file in saved['result']['archive']['files']}
            self.assertEqual(names, {filename, 'requirements.txt'})
            self.assertEqual(saved['result']['workspace']['codeDir'], str(service.workspace.root / '101/code'))
            self.assertTrue((service.workspace.root / '101/tasks' / (job['taskId'] + '.json')).is_file())
        before_third = self.app.git(origin, 'show', 'main:default/101/requirements.txt')
        generation_dispatcher.dispatch(self.app)
        deadline = time.monotonic() + 20
        while generation_dispatcher.WORKERS and time.monotonic() < deadline:
            time.sleep(.05)
        third = tasks.read(self.app, jobs[2]['taskId'])
        self.assertEqual(third['status'], 'succeeded', third['message'])
        self.assertEqual({Path(file['path']).name for file in third['result']['archive']['files']}, {'third.py', 'requirements.txt'})
        contents = self.app.git(origin, 'show', 'main:default/101/requirements.txt')
        self.assertIn('requests>=2.31', contents); self.assertIn('beautifulsoup4', contents)
        self.assertEqual(contents, before_third)
        self.assertTrue((service.workspace.root / '101/code/first.py').is_file())
        self.assertTrue((service.workspace.root / '101/code/second.py').is_file())
