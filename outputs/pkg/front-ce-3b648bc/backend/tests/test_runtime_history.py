"""Real HTTP + native child processes; no external DB, Git remote, or MQ."""
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.runner_management.server import Application, Handler
from backend.runner_management.runner import Runner
from backend.runner_management.runtime_logs import LogQueue
from backend.runner_management.runtime_history import ingest_event, cleanup, insert_record


class RuntimeHistoryTest(unittest.TestCase):
    def test_all_time_keeps_old_records_while_missing_since_still_defaults_to_24_hours(self):
        route = '/api/runner-management/runtime-operations?kind=stop'
        old_id, recent_id = uuid.uuid4().hex, uuid.uuid4().hex
        with self.app.store.connect() as db:
            insert_record(db, old_id, {}, 'stop', {'name': '历史停止记录'}, status='success',
                          date=(datetime.now(timezone.utc) - timedelta(days=10)).isoformat())
            insert_record(db, recent_id, {}, 'stop', {'name': '近期停止记录'}, status='success',
                          date=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat())
        recent = self.request(route)
        self.assertEqual(recent['total'], 1)
        self.assertEqual([row['recordId'] for row in recent['items']], [recent_id])
        all_time = self.request(route + '&since=')
        self.assertEqual(all_time['total'], 2)
        self.assertEqual({row['recordId'] for row in all_time['items']}, {old_id, recent_id})
        explicit = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        from urllib.parse import urlencode
        self.assertEqual(self.request(route + '&' + urlencode({'since': explicit}))['total'], 1)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'RUNNER_DEV_MODE': '1'}); self.env.start()
        self.ip = patch('backend.runner_management.runner.machine_ip', return_value='127.0.0.1'); self.ip.start()
        self.app = Application(Path(self.tmp.name) / 'data', site_script_repo=Path(self.tmp.name) / 'repo')
        handler = type('QuietHandler', (Handler,), {'application': self.app, 'log_message': lambda *args: None})
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.runner = Runner(Path(self.tmp.name) / 'instance', self.url); self.runner.enroll()

    def tearDown(self):
        self.runner.close()
        for thread in (self.runner.delivery_thread, self.runner.logs.thread):
            if thread: thread.join(timeout=5)
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)
        self.ip.stop(); self.env.stop(); self.tmp.cleanup()

    def request(self, path, payload=None, token=''):
        headers = {'Content-Type': 'application/json'}
        if token: headers['Authorization'] = 'Bearer ' + token
        with urlopen(Request(self.url + path, headers=headers, data=json.dumps(payload).encode() if payload is not None else None), timeout=5) as response:
            return json.load(response)

    def fixture(self, source='import time\nprint("hello history", flush=True)\nprint("password=hidden-secret", flush=True)\ntime.sleep(60)\n', concurrency=2):
        route = '/api/runner-management'
        repo = self.request(route + '/settings/code-repos')[0]
        root = Path(repo['path']); root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        uploaded = self.request(route + '/settings/code-repos/' + repo['repoId'] + '/files', {'files': [
            {'name': 'main.py', 'data': base64.b64encode(source.encode()).decode()}]})
        config = self.request(route + '/deployment-configurations', {'name': '日志联调测试', 'pathStyle': 'custom',
            'directoryTemplate': 'program', 'entryPoint': 'main.py', 'nodes': [
                {'id': 'entry', 'parentId': '', 'name': 'main.py', 'kind': 'file', 'repoId': repo['repoId'],
                 'sourcePath': uploaded['files'][0]['path'], 'sourceType': 'file', 'gitCommit': uploaded['gitCommit']}]})
        runtime = self.request(route + '/runtime-configurations', {'deploymentId': config['deploymentId'], 'layoutRevision': config['revision'],
            'runnerId': self.runner.identity['runnerId'], 'environment': 'test', 'concurrency': concurrency})
        self.config, self.runtime = config, runtime
        return runtime

    def latest_runtime(self):
        return next(r for r in self.request('/api/runner-management/runtime-configurations') if r['runtimeId'] == self.runtime['runtimeId'])

    def configure_retry(self, policy):
        current = self.latest_runtime()
        return self.request('/api/runner-management/runtime-configurations', {'runtimeId': current['runtimeId'],
            'revision': current['revision'], 'deploymentId': self.config['deploymentId'], 'layoutRevision': self.config['revision'],
            'runnerId': self.runner.identity['runnerId'], 'concurrency': 1, 'retryPolicy': policy})

    def start(self, deliver=True):
        if deliver:
            route = '/api/runner-management/directory-bindings/deployment/' + self.config['deploymentId'] + '/' + self.runner.identity['runnerId']
            self.delivery = self.request(route + '/deliver', {'revision': self.config['revision']})
            self.runner.deliver_pending()
        runtime = self.latest_runtime()
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/start', {'revision': runtime['revision']})
        self.runner.tick()
        self.drain()

    def drain(self):
        if self.runner.logs.thread: self.runner.logs.thread.join(timeout=5)
        self.runner.logs.upload()
        self.assertFalse(self.runner.logs.last_error, self.runner.logs.last_error)

    def records(self):
        return self.request('/api/runner-management/runtime-operations?since=&runtimeId=' + self.runtime['runtimeId'])['items']

    def test_process_logs_match_runner_assignment_pid_and_slot(self):
        self.fixture(); self.start(); self.runner.tick(); self.drain()
        items = self.request('/api/runner-management/processes')['items']
        self.assertEqual(len(items), 2)
        for worker in items:
            self.assertTrue(worker['runId'])
            suffix = ('?since=&runnerId=' + worker['runnerId'] + '&assignmentId=' + worker['assignmentId']
                      + '&processPid=' + str(worker['pid']) + '&processSlot=' + str(worker['slot']))
            result = self.request('/api/runner-management/runtime-operations' + suffix)
            self.assertEqual(result['total'], 1)
            self.assertEqual(result['items'][0]['recordId'], worker['runId'])
            info = self.request('/api/runner-management/runtime-operations/' + worker['runId'])
            self.assertEqual((info['run']['pid'], info['run']['slot']), (worker['pid'], worker['slot']))
            wrong = self.request('/api/runner-management/runtime-operations' + suffix + '&kind=stop')
            self.assertEqual(wrong['total'], 0)
            wrong = self.request('/api/runner-management/runtime-operations' + suffix.replace(worker['runnerId'], 'another-runner'))
            self.assertEqual(wrong['total'], 0)
        for query in ('processPid=bad', 'processPid=0', 'processSlot=-1', 'processSlot=100'):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/runtime-operations?' + query)
            self.assertEqual(error.exception.code, 400)

    def test_log_upload_orders_equal_timestamps_by_batch_sequence(self):
        sent = []
        def online(endpoint, body):
            sent.append(body['seq']); return {'ack': body['seq']}
        queue = LogQueue(Path(self.tmp.name) / 'same-clock', online)
        # UUID lexical order is the inverse of the batch order, as observed on Windows.
        for suffix, sequence in [('a', 13), ('b', 12)]:
            (queue.spool / ('01791820783824494100-' + suffix + '.json')).write_text(json.dumps({
                'endpoint': '/api/runners/me/log-batches', 'payload': {'recordId': 'r', 'streamId': 's', 'seq': sequence}}))
        queue.upload()
        self.assertEqual(sent, [12, 13])
        self.assertFalse(list(queue.spool.glob('*.json')))

    def test_conflicting_stream_remains_queued_without_blocking_new_run(self):
        sent = []
        def online(endpoint, body):
            if body.get('streamId') == 'missing-earlier':
                error = RuntimeError('日志序号不连续'); error.http_status = 409; raise error
            sent.append(body); return {'ack': body.get('seq', 0)}
        queue = LogQueue(Path(self.tmp.name) / 'blocked-stream', online)
        for seq in range(13, 133):
            queue.enqueue('/api/runners/me/log-batches', {'recordId': 'old', 'streamId': 'missing-earlier', 'seq': seq})
        queue.event('new-run', 'created')
        queue.enqueue('/api/runners/me/log-batches', {'recordId': 'new-run', 'streamId': 'new-stream', 'seq': 1})
        queue.upload()
        self.assertEqual([item['recordId'] for item in sent], ['new-run', 'new-run'])
        retained = list(queue.spool.glob('*.json'))
        self.assertEqual(len(retained), 120)
        self.assertEqual(json.loads(retained[0].read_text())['payload']['streamId'], 'missing-earlier')
        self.assertIn('日志序号不连续', queue.last_error)

    def test_real_delivery_concurrent_runs_stop_and_redacted_console(self):
        self.fixture()
        with self.assertRaises(HTTPError): self.start(deliver=False)
        self.assertEqual(self.records()[0]['status'], 'failed')
        self.start()
        records = self.records()
        self.assertEqual(len([r for r in records if r['kind'] == 'run']), 2)
        delivery = self.request('/api/runner-management/runtime-operations/' + self.delivery['deliveryId'])
        self.assertEqual(delivery['status'], 'success')
        self.assertIn('install', [e['stage'] for e in delivery['events']])
        slots, streams = [], []
        for record in [r for r in records if r['kind'] == 'run']:
            detail = self.request('/api/runner-management/runtime-operations/' + record['recordId'])
            self.assertEqual(detail['status'], 'running')
            self.assertGreater(detail['run']['pid'], 0)
            self.assertTrue(detail['run']['entry'].endswith('main.py'))
            slots.append(detail['run']['slot']); streams.append(detail['streams'][0]['streamId'])
            page = self.request('/api/runner-management/log-streams/' + streams[-1] + '/entries')
            text = '\n'.join(e['text'] for e in page['entries'])
            self.assertIn('hello history', text); self.assertNotIn('hidden-secret', text)
            download = self.request('/api/runner-management/log-streams/' + streams[-1] + '/download')
            self.assertIn('password=***', download['content'])
        self.assertEqual(sorted(slots), [0, 1]); self.assertNotEqual(*streams)
        runtime = self.latest_runtime()
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/stop', {'revision': runtime['revision']})
        self.runner.tick(); self.drain()
        self.assertEqual([r['status'] for r in self.records() if r['kind'] == 'run'], ['stopped', 'stopped'])
        self.assertTrue(list((self.runner.directory / 'logs/programs').glob('*/*/console-0001.log')))

    def test_start_failure_history_traceback_backoff_and_pause(self):
        self.fixture('raise RuntimeError("expected startup error")\n', concurrency=1)
        self.start()
        self.assertEqual(self.runner.processes, {})
        record = next(r for r in self.records() if r['kind'] == 'run')
        detail = self.request('/api/runner-management/runtime-operations/' + record['recordId'])
        self.assertEqual(detail['status'], 'failed'); self.assertNotEqual(detail['run']['exit_code'], 0)
        self.assertGreater(detail['run']['pid'], 0)
        self.assertIn('Traceback', detail['events'][-1]['detail'])
        before = len([r for r in self.records() if r['kind'] == 'run'])
        self.runner.tick(); self.drain()
        self.assertEqual(len([r for r in self.records() if r['kind'] == 'run']), before)
        for _ in range(4):
            for retry in self.runner.retries.values(): retry['nextAt'] = 0
            self.runner.tick(); self.drain()
        self.assertFalse(self.latest_runtime()['assignment']['enabled'])
        self.assertIn('paused', [r['status'] for r in self.records()])
        self.assertEqual(len([r for r in self.records() if r['kind'] == 'run']), 5)
        self.assertEqual(self.request('/api/runner-management/runtime-operations/' + record['recordId'])['status'], 'failed')
        paused = next(r for r in self.records() if r['status'] == 'paused')
        paused_detail = self.request('/api/runner-management/runtime-operations/' + paused['recordId'])
        failure = next(e for e in paused_detail['events'] if e['stage'] == 'failed')
        self.assertEqual(paused_detail['run']['exit_code'], 1)
        self.assertEqual(paused_detail['run']['ended_at'], failure['time'])
        self.assertEqual(paused_detail['run']['reason'], failure['message'])

    def test_log_ownership_idempotency_out_of_order_and_late_start(self):
        self.fixture(concurrency=1); self.start()
        record = next(r for r in self.records() if r['kind'] == 'run')
        detail = self.request('/api/runner-management/runtime-operations/' + record['recordId'])
        stream = uuid.uuid4().hex
        payload = {'streamId': stream, 'recordId': record['recordId'], 'seq': 1, 'entries': [{'text': '<script>literal</script>', 'source': 'stdout'}]}
        post = lambda p: self.request('/api/runners/me/log-batches', p, self.runner.identity['token'])
        self.assertEqual(post(payload), {'ack': 1}); self.assertEqual(post(payload), {'ack': 1})
        self.assertEqual(len(self.request('/api/runner-management/log-streams/' + stream + '/entries')['entries']), 1)
        with self.assertRaises(HTTPError) as missing: post({**payload, 'seq': 3})
        self.assertEqual(missing.exception.code, 409)
        other = Runner(Path(self.tmp.name) / 'other-instance', self.url); other.enroll()
        with self.assertRaises(HTTPError) as forbidden:
            self.request('/api/runners/me/log-batches', payload, other.identity['token'])
        self.assertEqual(forbidden.exception.code, 403)
        event = {'eventId': uuid.uuid4().hex, 'recordId': record['recordId'], 'action': 'failed', 'message': 'reported failure'}
        ingest_event(self.app, self.runner.identity['runnerId'], event)
        ingest_event(self.app, self.runner.identity['runnerId'], event)
        ingest_event(self.app, self.runner.identity['runnerId'], {**event, 'eventId': uuid.uuid4().hex, 'action': 'started', 'pid': 99})
        self.assertEqual(self.request('/api/runner-management/runtime-operations/' + record['recordId'])['status'], 'failed')
        with self.assertRaises(HTTPError): self.request('/api/runner-management/log-streams/../../runner/entries')

    def test_durable_upload_retry_survives_queue_recreation(self):
        sent = []
        def offline(*args): raise OSError('network unavailable')
        queue = LogQueue(Path(self.tmp.name) / 'offline-logs', offline)
        identifier = uuid.uuid4().hex
        queue.event(identifier, 'created', 'first')
        queue.output(identifier, uuid.uuid4().hex, 'message'); queue.flush(); queue.upload()
        self.assertTrue(queue.last_error); self.assertEqual(len(list(queue.spool.glob('*.json'))), 2)
        def online(path, body): sent.append((path, body)); return {'ack': body.get('seq', 0)}
        recovered = LogQueue(Path(self.tmp.name) / 'offline-logs', online); recovered.upload()
        self.assertEqual(len(sent), 2); self.assertFalse(list(recovered.spool.glob('*.json')))

    def test_local_quota_reports_dropped_output_after_recovery(self):
        sent = []
        def online(path, body): sent.append(body); return {'ack': body.get('seq', 0)}
        directory = Path(self.tmp.name) / 'full-cache'
        queue = LogQueue(directory, online); queue.local_limit = 512
        record_id, stream_id = uuid.uuid4().hex, uuid.uuid4().hex
        queue.output(record_id, stream_id, 'x' * 2000); queue.flush()
        self.assertTrue(queue.drop_path.exists())
        self.assertFalse(list(queue.spool.glob('*.json')))
        recovered = LogQueue(directory, online)
        recovered.upload(); recovered.upload()
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['seq'], 1)
        self.assertIn('[日志截断]', sent[0]['entries'][0]['text'])
        self.assertFalse(recovered.drops)

    def test_expired_output_keeps_cursor_for_late_upload_and_summary_for_retained_logs(self):
        record_id, stream_id = uuid.uuid4().hex, uuid.uuid4().hex
        ingest_event(self.app, self.runner.identity['runnerId'], {'eventId': uuid.uuid4().hex,
            'recordId': record_id, 'action': 'created', 'kind': 'runner'})
        payload = {'streamId': stream_id, 'recordId': record_id, 'seq': 1, 'entries': [{'text': 'old output'}]}
        post = lambda p: self.request('/api/runners/me/log-batches', p, self.runner.identity['token'])
        post(payload)
        with self.app.store.connect() as db:
            db.execute('UPDATE runtime_log_streams SET updated_at=? WHERE stream_id=?',
                       ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(), stream_id))
        cleanup(self.app)
        page = self.request('/api/runner-management/log-streams/' + stream_id + '/entries')
        self.assertTrue(page['expired']); self.assertEqual(page['entries'], []); self.assertEqual(page['lastSeq'], 1)
        self.assertEqual(post({**payload, 'seq': 2, 'entries': [{'text': 'late output'}]}), {'ack': 2})
        self.assertEqual(post(payload), {'ack': 2})
        page = self.request('/api/runner-management/log-streams/' + stream_id + '/entries')
        self.assertFalse(page['expired']); self.assertEqual(page['earliestSeq'], 2)
        self.assertFalse(page['hasEarlier']); self.assertEqual([e['text'] for e in page['entries']], ['late output'])
        with self.app.store.connect() as db:
            db.execute("UPDATE runtime_operations SET status='exited',updated_at=? WHERE record_id=?",
                       ((datetime.now(timezone.utc) - timedelta(days=91)).isoformat(), record_id))
        cleanup(self.app)
        self.assertEqual(self.request('/api/runner-management/runtime-operations/' + record_id)['recordId'], record_id)

    def test_runtime_crash_preserves_exit_code_and_offline_is_unknown(self):
        self.fixture('import time\nprint("before crash", flush=True)\ntime.sleep(2)\nraise RuntimeError("runtime crash")\n', concurrency=1)
        self.start()
        record = next(r for r in self.records() if r['kind'] == 'run')
        with self.app.store.connect() as db:
            db.execute("UPDATE runners SET worker_processes='[]' WHERE runner_id=?", (self.runner.identity['runnerId'],))
        uncertain = self.request('/api/runner-management/runtime-operations?since=&status=unknown')['items']
        self.assertIn(record['recordId'], [r['recordId'] for r in uncertain])
        running = self.request('/api/runner-management/runtime-operations?since=&status=running')['items']
        self.assertNotIn(record['recordId'], [r['recordId'] for r in running])
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET last_heartbeat=? WHERE runner_id=?', ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), self.runner.identity['runnerId']))
        unknown = self.request('/api/runner-management/runtime-operations?since=&status=unknown')['items']
        self.assertIn(record['recordId'], [r['recordId'] for r in unknown])
        self.assertEqual(self.request('/api/runner-management/runtime-operations/' + record['recordId'])['status'], 'unknown')
        child = next(iter(self.runner.processes.values()))[1]; child.wait(timeout=5)
        self.runner.tick(); self.drain()
        result = self.request('/api/runner-management/runtime-operations/' + record['recordId'])
        self.assertEqual(result['status'], 'failed'); self.assertEqual(result['run']['exit_code'], 1)
        entries = self.request('/api/runner-management/log-streams/' + result['streams'][0]['streamId'] + '/entries')['entries']
        self.assertIn('runtime crash', '\n'.join(e['text'] for e in entries))

    def test_preflight_failure_without_pid_and_upload_after_unbinding(self):
        self.fixture(concurrency=1)
        # Capture an authorized start context, then exercise delayed upload after the binding is removed.
        self.start()
        context = self.runner.get('/api/runners/me/assignments')[0]
        record_id = uuid.uuid4().hex
        runtime = self.latest_runtime()
        self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/remove', {'revision': runtime['revision']})
        ingest_event(self.app, self.runner.identity['runnerId'], {'eventId': uuid.uuid4().hex, 'recordId': record_id, 'action': 'created',
            'assignmentId': context['assignmentId'], 'releaseDigest': context['releaseDigest'], 'operationId': context['operationId'], 'slot': 0})
        ingest_event(self.app, self.runner.identity['runnerId'], {'eventId': uuid.uuid4().hex, 'recordId': record_id, 'action': 'failed', 'message': '入口检查失败'})
        result = self.request('/api/runner-management/runtime-operations/' + record_id)
        self.assertEqual(result['status'], 'failed'); self.assertIsNone(result['run']['pid'])
        self.assertEqual(result['runtimeId'], context['runtimeId'])

    def test_log_policy_validates_root_and_preserves_existing_stream_location(self):
        policy = self.request('/api/runner-management/log-settings')
        self.assertEqual(policy['retentionDays'], 30)
        changed = self.request('/api/runner-management/log-settings', {**policy, 'retentionDays': 7, 'quotaMb': 64})
        self.assertEqual(changed['retentionDays'], 7)
        with self.assertRaises(HTTPError):
            self.request('/api/runner-management/log-settings', {**changed, 'directory': str(self.app.default_site_script_repo)})
        self.fixture(concurrency=1); self.start()
        with self.assertRaises(HTTPError) as moved:
            self.request('/api/runner-management/log-settings', {**changed, 'directory': str(Path(self.tmp.name) / 'another-log-root')})
        self.assertEqual(moved.exception.code, 409)

    def test_early_delivery_event_keeps_snapshot_without_duplicate_creation(self):
        self.fixture(concurrency=1)
        from backend.runner_management.directory_delivery import request_delivery
        def fast_runner(*args):
            result = request_delivery(*args)
            ingest_event(self.app, self.runner.identity['runnerId'], {'eventId': uuid.uuid4().hex,
                'recordId': result['deliveryId'], 'action': 'stage', 'stage': 'received', 'message': 'early stage'})
            return result
        route = '/api/runner-management/directory-bindings/deployment/' + self.config['deploymentId'] + '/' + self.runner.identity['runnerId']
        with patch('backend.runner_management.directory_delivery.request_delivery', side_effect=fast_runner):
            result = self.request(route + '/deliver', {'revision': self.config['revision']})
        detail = self.request('/api/runner-management/runtime-operations/' + result['deliveryId'])
        self.assertEqual(detail['runtimeId'], self.runtime['runtimeId'])
        self.assertEqual(detail['snapshot']['name'], '日志联调测试')
        self.assertEqual([e['stage'] for e in detail['events']], ['requested', 'received'])

    def test_machine_retry_policy_round_trip_validation_and_old_client_preservation(self):
        self.fixture(concurrency=1)
        custom = {'enabled': True, 'maxAttempts': 2, 'windowSeconds': 60, 'delaysSeconds': [2, 7]}
        changed = self.configure_retry(custom)
        self.assertEqual(changed['retryPolicy'], custom)
        self.assertNotEqual(changed['revision'], self.runtime['revision'])
        with self.app.store.connect() as db:
            saved = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                                         ('runtime-config:' + changed['runtimeId'],)).fetchone()['setting_value'])
        self.assertEqual(saved['retryPolicy'], custom)
        omitted = self.request('/api/runner-management/runtime-configurations', {'runtimeId': changed['runtimeId'],
            'revision': changed['revision'], 'deploymentId': self.config['deploymentId'], 'layoutRevision': self.config['revision'],
            'runnerId': self.runner.identity['runnerId'], 'concurrency': 1})
        self.assertEqual(omitted['retryPolicy'], custom)
        for bad in ({'maxAttempts': 0}, {'maxAttempts': True}, {'windowSeconds': 30}, {'enabled': 'false'},
                    {'delaysSeconds': []}, {'delaysSeconds': [0]}, {'delaysSeconds': [1.5]}):
            with self.subTest(bad=bad), self.assertRaises(HTTPError) as invalid:
                self.configure_retry({**custom, **bad})
            self.assertEqual(invalid.exception.code, 422)
            self.assertEqual(self.latest_runtime()['retryPolicy'], custom)

    def test_configured_retry_limit_intervals_and_manual_restart(self):
        self.fixture('raise RuntimeError("configured retry")\n', concurrency=1)
        policy = {'enabled': True, 'maxAttempts': 2, 'windowSeconds': 60, 'delaysSeconds': [13, 29]}
        self.configure_retry(policy)
        self.start()
        context = self.runner.get('/api/runners/me/assignments')[0]
        self.assertEqual(context['retryPolicy'], policy)
        retry = next(iter(self.runner.retries.values()))
        self.assertAlmostEqual(retry['nextAt'] - retry['failures'][-1], 13, delta=.2)
        self.runner.tick(); self.drain()
        self.assertEqual(len([r for r in self.records() if r['kind'] == 'run']), 1)
        retry['nextAt'] = 0
        self.runner.tick(); self.drain()
        self.assertFalse(self.latest_runtime()['assignment']['enabled'])
        self.assertEqual(len([r for r in self.records() if r['kind'] == 'run']), 2)
        paused = next(r for r in self.records() if r['status'] == 'paused')
        self.assertEqual(paused['snapshot']['retryPolicy'], policy)
        self.assertIn('2 次尝试上限', paused['error'])
        self.start(deliver=False)
        self.assertTrue(self.latest_runtime()['assignment']['enabled'])
        self.assertEqual(len([r for r in self.records() if r['kind'] == 'run']), 3)
        # A new generation retains the previously failed attempts in history.
        self.assertEqual(len([r for r in self.records() if r['status'] == 'paused']), 1)

    def test_disabling_auto_retry_only_attempts_once_and_requires_supported_runner(self):
        self.fixture('raise RuntimeError("no retry")\n', concurrency=1)
        self.configure_retry({'enabled': False})
        self.start()
        self.assertFalse(self.latest_runtime()['assignment']['enabled'])
        self.runner.tick(); self.drain()
        self.assertEqual(len([r for r in self.records() if r['kind'] == 'run']), 1)
        self.assertIn('自动重试已关闭', next(r for r in self.records() if r['status'] == 'paused')['error'])
        with self.app.store.connect() as db:
            db.execute("UPDATE runners SET capabilities=? WHERE runner_id=?", (json.dumps(['deployment-entry', 'runtime-logs']), self.runner.identity['runnerId']))
        current = self.latest_runtime()
        with self.assertRaises(HTTPError) as old:
            self.request('/api/runner-management/runtime-configurations/' + current['runtimeId'] + '/start', {'revision': current['revision']})
        self.assertEqual(old.exception.code, 422)
        self.assertIn('重试策略', json.load(old.exception)['message'])
