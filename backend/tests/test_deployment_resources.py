"""Real Git -> durable job -> authenticated Runner -> verified install contracts."""
import base64
import hashlib
import json
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management import deployment_resources as resources, generated_archives
from backend.runner_management.runner import Runner


class DeploymentResourcesTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    request = baseline.ManagementIntegrationTest.request
    route = '/api/runner-management/deployment-resources'

    def tearDown(self):
        if getattr(self, 'other', None): self.other.close()
        baseline.ManagementIntegrationTest.tearDown(self)

    def fixture(self):
        self.repo = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(self.repo['path']); root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        self.runner = Runner(Path(self.tmp.name) / 'test-instance', self.url); self.runner.enroll()
        self.runner.post('/api/runners/me/heartbeat', self.runner.heartbeat_payload())
        other = Runner(Path(self.tmp.name) / 'production-instance', self.url); other.enroll()
        self.other = other
        other.post('/api/runners/me/heartbeat', other.heartbeat_payload())
        return other

    def archive(self, identifier='archive-1', content=b'VALUE = 1\n', created='2026-11-02T01:00:00Z', include_helper=True):
        contents = {'1401218/main.py': content, '1401218/lib/helper.py': b'HELPER = True\n', '1401218/requirements.txt': b''}
        if not include_helper:
            del contents['1401218/lib/helper.py']
        uploaded = self.app.upload_repository_files(self.repo['repoId'], {
            'directoryId': 'default', 'uploadType': 'folder', 'overwrite': True,
            'files': [{'name': path.rsplit('/', 1)[-1], 'relativePath': path, 'data': base64.b64encode(data).decode()} for path, data in contents.items()]}, owner_config_id='1401218')
        record = {'archiveId': identifier, 'configId': '1401218', 'configType': '90', 'taskId': identifier, 'repoId': self.repo['repoId'],
                  'directoryId': 'default', 'directoryPath': 'default', 'repositoryPrefix': '1401218',
                  'sourceContext': {'sourceId': '430024910', 'flowId': '21000040', 'stepId': '41895'}, 'serverId': '',
                  'queueName': 'announcement.list', 'gitCommit': uploaded['gitCommit'], 'status': 'committed', 'pushed': False,
                  'createdAt': created, 'files': [{'path': 'default/' + path, 'relativePath': path,
                     'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)} for path, data in contents.items()]}
        generated_archives.store(self.app, record)
        return record

    def save_rules(self, test=None, production=None):
        current = self.request(self.route)
        rows = []
        for env, runner in (('test', test), ('production', production)):
            if runner:
                rows.append({'configType': '90', 'configTypeName': '网页抓取', 'environment': env,
                             'runnerId': runner.identity['runnerId'], 'deploymentDirectory': 'test' if env == 'test' else 'prod', 'enabled': True})
        return self.request(self.route, {**current, 'items': rows})

    def jobs(self):
        return self.request('/api/runner-management/deployment-jobs?configId=1401218')['items']

    def act(self, job, action):
        return self.request('/api/runner-management/deployment-jobs/' + job['jobId'] + '/' + action, {})

    def pool(self, other):
        current = self.request(self.route)
        base = {'configType': '90', 'configTypeName': '网页抓取', 'environment': 'test',
                'deploymentDirectory': 'test', 'enabled': True}
        rows = [
            {**base, 'resourceId': '1' * 32, 'runnerId': self.runner.identity['runnerId'], 'isDefault': True},
            {**base, 'resourceId': '2' * 32, 'runnerId': other.identity['runnerId'], 'isDefault': False},
            {**base, 'resourceId': '3' * 32, 'runnerId': other.identity['runnerId'], 'isDefault': True, 'environment': 'production', 'deploymentDirectory': 'prod'},
            {**base, 'resourceId': '4' * 32, 'runnerId': other.identity['runnerId'], 'isDefault': True, 'configType': '95'},
        ]
        return self.request(self.route, {**current, 'items': rows})

    def context(self, **changes):
        return {'sourceId': '430024910', 'flowId': '21000040', 'stepId': '41895', 'configId': '1401218',
                'configType': '90', 'environment': 'test', **changes}

    def choice(self, **changes):
        return self.request('/api/runner-management/node-deployment-resource?' + urlencode(self.context(**changes)))

    def choose(self, resource_id, **changes):
        current = self.choice(**changes)
        return self.request('/api/runner-management/node-deployment-resource', {**self.context(**changes), 'revision': current['revision'], 'resourceId': resource_id})

    def mapped_resource(self, deployment_directory='test/links'):
        current = self.request(self.route)
        item = {'resourceId': '5' * 32, 'resourceName': '直接映射资源', 'configType': '90', 'configTypeName': '网页抓取',
                'environment': 'test', 'runnerId': self.runner.identity['runnerId'], 'isDefault': True, 'enabled': True,
                'deploymentDirectory': deployment_directory}
        return self.request(self.route, {**current, 'items': [item]})

    def test_both_environments_share_one_resource_and_disabling_removes_both_matches(self):
        self.fixture()
        current = self.request(self.route)
        item = {'resourceId': '6' * 32, 'resourceName': '通用资源', 'configType': '90', 'configTypeName': '网页抓取',
                'environment': 'both', 'runnerId': self.runner.identity['runnerId'], 'enabled': True, 'isDefault': True}
        saved = self.request(self.route, {**current, 'items': [item]})
        self.assertEqual(len(saved['items']), 1)
        for env in ('test', 'production'):
            selected = self.choice(environment=env)
            self.assertEqual(selected['effectiveResourceId'], item['resourceId'])
            self.assertEqual(len(selected['resources']), 1)
            with self.app.store.connect() as db:
                resolved, explicit = resources.selected_resource(db, self.context(environment=env))
                self.assertEqual(resolved['resourceId'], item['resourceId'])
        with self.assertRaises(HTTPError) as error:
            self.request(self.route, {**saved, 'items': [item, {**item, 'resourceId': '7' * 32, 'runnerId': self.other.identity['runnerId'], 'environment': 'production'}]})
        self.assertEqual(error.exception.code, 400)
        self.request(self.route, {**saved, 'items': [{**item, 'enabled': False}]})
        for env in ('test', 'production'):
            self.assertEqual(self.choice(environment=env)['effectiveResourceId'], '')

    def test_single_python_file_becomes_entry_and_stays_stopped_after_deploy(self):
        self.fixture(); self.mapped_resource(); self.archive(include_helper=False)
        resources.dispatch(self.app)
        job = self.jobs()[0]
        self.assertEqual(job['status'], 'delivering', job)
        rows = self.request('/api/runner-management/runtime-configurations')
        row = next(item for item in rows if item['runtimeId'] == job['runtimeId'])
        self.assertEqual(row['entryPoint'], 'main.py')
        self.assertFalse(row['assignment']['enabled'])
        self.runner.deliver_pending(); resources.dispatch(self.app)
        row = next(item for item in self.request('/api/runner-management/runtime-configurations') if item['runtimeId'] == job['runtimeId'])
        started = self.request('/api/runner-management/runtime-configurations/' + row['runtimeId'] + '/start', {'revision': row['revision']})
        self.assertTrue(started['assignment']['enabled'])

    def test_multiple_files_require_explicit_entry_no_redelivery_and_revision_guard(self):
        self.fixture(); self.mapped_resource(); self.archive()
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        job = self.jobs()[0]
        route = '/api/runner-management/runtime-configurations/' + job['runtimeId'] + '/entry'
        choices = self.request(route)
        self.assertEqual(choices['files'], ['lib/helper.py', 'main.py'])
        self.assertEqual(choices['entryPoint'], '')
        with self.assertRaises(HTTPError):
            self.request(route, {**choices, 'entryPoint': '../escape.py'})
        selected = self.request(route, {**choices, 'entryPoint': 'main.py'})
        self.assertEqual(selected['entryPoint'], 'main.py')
        self.assertFalse(selected['assignment']['enabled'])
        with self.assertRaises(HTTPError) as conflict:
            self.request(route, {**choices, 'entryPoint': 'lib/helper.py'})
        self.assertEqual(conflict.exception.code, 409)
        started = self.request('/api/runner-management/runtime-configurations/' + job['runtimeId'] + '/start', {'revision': selected['revision']})
        self.assertTrue(started['assignment']['enabled'])
        with self.assertRaises(HTTPError):
            self.request(route, {**self.request(route), 'entryPoint': 'lib/helper.py'})

    def test_resource_entry_is_persisted_validated_and_used_for_multiple_files(self):
        self.fixture(); saved = self.mapped_resource()
        item = {**saved['items'][0], 'entryPoint': 'lib/helper.py'}
        saved = self.request(self.route, {**saved, 'items': [item]})
        self.assertEqual(saved['items'][0]['entryPoint'], 'lib/helper.py')
        for invalid in ('../run.py', '/tmp/run.py', 'D:/run.py', 'run.txt'):
            with self.assertRaises(HTTPError):
                self.request(self.route, {**saved, 'items': [{**item, 'entryPoint': invalid}]})
        self.archive(); resources.dispatch(self.app)
        job = self.jobs()[0]
        self.assertEqual(job['status'], 'delivering', job)
        row = next(item for item in self.request('/api/runner-management/runtime-configurations') if item['runtimeId'] == job['runtimeId'])
        self.assertEqual(row['entryPoint'], 'lib/helper.py')
        self.assertFalse(row['assignment']['enabled'])

    def test_resource_entry_missing_from_config_fails_without_partial_runtime(self):
        self.fixture(); saved = self.mapped_resource()
        self.request(self.route, {**saved, 'items': [{**saved['items'][0], 'entryPoint': 'missing.py'}]})
        self.archive(); resources.dispatch(self.app)
        job = self.jobs()[0]
        self.assertEqual(job['status'], 'failed', job)
        self.assertIn('missing.py', job['message'])
        self.assertEqual(self.request('/api/runner-management/runtime-configurations'), [])

    def test_resource_list_shows_actual_adopted_entry_without_changing_revision(self):
        self.fixture(); saved = self.mapped_resource(); self.archive(include_helper=False)
        resources.dispatch(self.app)
        displayed = self.request(self.route)
        self.assertEqual(displayed['items'][0]['entryPoints'], ['main.py'])
        self.assertEqual(displayed['items'][0]['entryPoint'], '')
        self.assertEqual(displayed['revision'], saved['revision'])

    def test_waiting_resource_then_real_install_and_same_commit_production(self):
        production = self.fixture()
        archive = self.archive()
        resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'waiting_resource')
        self.assertEqual(len(self.jobs()), 1)
        with self.assertRaises(HTTPError) as blocked: self.act(self.jobs()[0], 'publish')
        self.assertEqual(blocked.exception.code, 409)
        self.save_rules(self.runner, production)
        resources.dispatch(self.app)
        test_job = self.jobs()[0]
        self.assertEqual(test_job['status'], 'delivering', test_job)
        self.assertEqual(test_job['targetPath'], 'test/default/1401218')
        self.assertEqual(test_job['runnerId'], self.runner.identity['runnerId'])
        self.runner.deliver_pending(); resources.dispatch(self.app)
        test_job = self.jobs()[0]
        self.assertEqual(test_job['status'], 'success', test_job)
        self.assertEqual((self.runner.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')
        self.assertTrue((self.runner.directory / 'test/default/1401218/lib/helper.py').is_file())
        # HEAD can change after testing. Production still receives the tested commit.
        root = Path(self.repo['path']); (root / 'default/1401218/main.py').write_bytes(b'VALUE = 999\n')
        self.app.git(root, 'add', '--', 'default/1401218/main.py'); self.app.git(root, 'commit', '-m', 'unrelated newer HEAD')
        published = self.act(test_job, 'publish')
        self.assertEqual(published['gitCommit'], archive['gitCommit'])
        resources.dispatch(self.app); production.deliver_pending(); resources.dispatch(self.app)
        prod = next(item for item in self.jobs() if item['environment'] == 'production')
        self.assertEqual(prod['status'], 'success', prod)
        self.assertEqual(prod['runnerId'], production.identity['runnerId'])
        self.assertEqual((production.directory / 'prod/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM assignments').fetchone()['n'], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM runtime_operations WHERE kind=?', ('delivery',)).fetchone()['n'], 2)
        # Environment-specific copies do not make the orchestration's own binding ambiguous.
        node = self.request('/api/runner-management/deployment-configurations/from-node', {
            'sourceNode': {'flowId': '21000040', 'flowName': '新闻流程', 'stepId': '41895', 'nodeName': '智能采集', 'configId': '1401218'},
            'queueName': 'announcement.list'})
        self.assertNotIn('managedBy', node)

    def test_offline_waits_and_default_can_be_reassigned_before_delivery(self):
        other = self.fixture(); self.archive()
        self.save_rules(self.runner)
        with self.app.store.connect() as db: db.execute("UPDATE runners SET status='offline' WHERE runner_id=?", (self.runner.identity['runnerId'],))
        resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'waiting_resource')
        self.save_rules(other); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['runnerId'], other.identity['runnerId'])
        self.assertFalse(self.runner.get('/api/runners/me/directory-deliveries'))
        other.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'success')

    def test_receipt_retry_restart_recovery_and_incremental_files(self):
        self.fixture(); archive = self.archive(); self.save_rules(self.runner)
        generated_archives.store(self.app, archive); resources.dispatch(self.app); resources.dispatch(self.app)
        self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(len(self.runner.get('/api/runners/me/directory-deliveries')), 1)
        self.runner.deliver_pending(); resources.dispatch(self.app)
        self.archive('archive-2', b'VALUE = 2\n', '2026-11-02T02:00:00Z')
        resources.dispatch(self.app)
        newest = self.jobs()[0]
        with self.app.store.connect() as db:
            row = db.execute('SELECT artifact_digest FROM directory_deliveries WHERE delivery_id=?', (newest['deliveryId'],)).fetchone()
        import io, zipfile
        with zipfile.ZipFile(io.BytesIO(self.app.artifacts.read(row['artifact_digest']))) as bundle:
            self.assertEqual(set(bundle.namelist()) - {'manifest.json'}, {'main.py'})
        self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual((self.runner.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE = 2\n')
        self.assertTrue((self.runner.directory / 'test/default/1401218/requirements.txt').exists())
        old = next(job for job in self.jobs() if job['archiveId'] == 'archive-1')
        self.act(old, 'rollback'); resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual((self.runner.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')

    def test_late_older_result_cannot_replace_newer_queued_result(self):
        self.fixture()
        self.archive('new-task', b'VALUE=2\n', '2026-11-02T02:00:00Z')
        self.archive('old-task', b'VALUE=1\n', '2026-11-02T01:00:00Z')
        old = next(job for job in self.jobs() if job['archiveId'] == 'old-task')
        self.assertEqual(old['status'], 'superseded')
        self.save_rules(self.runner); resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual((self.runner.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE=2\n')

    def test_rules_revision_unique_environment_and_auth(self):
        self.fixture(); saved = self.save_rules(self.runner)
        with self.assertRaises(HTTPError) as stale: self.request(self.route, {**saved, 'revision': 'old'})
        self.assertEqual(stale.exception.code, 409)
        with self.assertRaises(HTTPError): self.request(self.route, {**saved, 'items': saved['items'] * 2})
        with self.assertRaises(HTTPError): self.request(self.route, {**saved, 'items': [{**saved['items'][0], 'deploymentDirectory': '{configId}'}]})
        self.assertEqual(self.request(self.route), saved)
        with patch.dict('os.environ', {'RUNNER_DEV_MODE': '0', 'RUNNER_AUTH_URL': 'http://127.0.0.1:1'}):
            with self.assertRaises(HTTPError) as denied: self.request(self.route)
        self.assertIn(denied.exception.code, (401, 403))

    def test_running_process_waits_and_failed_delivery_has_logs_and_retry(self):
        self.fixture(); self.archive(); self.save_rules(self.runner)
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET worker_processes=? WHERE runner_id=?',
                       (json.dumps([{'workingDirectory': str(self.runner.directory / 'test/default/1401218'), 'pid': 123}]), self.runner.identity['runnerId']))
        resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'queued')
        self.assertFalse(self.runner.get('/api/runners/me/directory-deliveries'))
        self.runner.post('/api/runners/me/heartbeat', self.runner.heartbeat_payload()); resources.dispatch(self.app)
        job = self.jobs()[0]
        path = '/api/runners/me/directory-deliveries/' + job['deliveryId']
        self.runner.post(path + '/claim', {}); self.runner.post(path + '/result', {'status': 'failed', 'error': '磁盘空间不足'})
        resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'failed'); self.assertEqual(self.jobs()[0]['message'], '磁盘空间不足')
        self.act(self.jobs()[0], 'retry'); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'delivering', self.jobs()[0])

    def test_superseded_failure_cannot_retry_and_foreign_root_is_preserved(self):
        self.fixture(); self.archive(); self.save_rules(self.runner)
        foreign = self.request('/api/runner-management/deployment-configurations', {
            'name': '现有手工部署', 'configId': '1401218', 'pathStyle': 'config', 'directoryTemplate': 'test/default/{configId}', 'entryPoint': '', 'nodes': []})
        self.request('/api/runner-management/runtime-configurations', {'deploymentId': foreign['deploymentId'],
                     'layoutRevision': foreign['revision'], 'runnerId': self.runner.identity['runnerId'], 'concurrency': 1})
        resources.dispatch(self.app)
        old = self.jobs()[0]
        self.assertEqual(old['status'], 'failed'); self.assertIn('目标目录已被其他部署配置使用', old['message'])
        self.assertFalse(self.runner.get('/api/runners/me/directory-deliveries'))
        self.archive('new-task', b'VALUE=2\n', '2026-11-02T02:00:00Z')
        with self.assertRaises(HTTPError) as blocked: self.act(old, 'retry')
        self.assertEqual(blocked.exception.code, 409)

    def test_existing_archive_manual_deploy_checks_source_and_does_not_regenerate(self):
        self.fixture(); archive = self.archive()
        with self.app.store.connect() as db:
            db.execute('DELETE FROM deployment_jobs')
            # Old receipts can predate sourceContext, while file provenance survives task deletion.
            legacy = {key: value for key, value in archive.items() if key != 'sourceContext'}
            db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?',
                       (json.dumps(legacy), 'generated-code-result:' + archive['archiveId']))
        body = {'archiveId': archive['archiveId'], 'configId': '1401218', **archive['sourceContext']}
        with self.assertRaises(HTTPError) as wrong_source:
            self.request('/api/runner-management/deployment-jobs', {**body, 'sourceId': '430024911'})
        self.assertEqual(wrong_source.exception.code, 409)
        result = self.request('/api/runner-management/deployment-jobs', body)
        self.assertEqual(result['gitCommit'], archive['gitCommit'])
        self.assertEqual(result, self.request('/api/runner-management/deployment-jobs', body))
        self.assertEqual(len(self.jobs()), 1)
        self.save_rules(self.runner); resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'success')

    def test_node_choice_is_scoped_validated_and_does_not_modify_global_defaults(self):
        other = self.fixture(); rules = self.pool(other)
        initial = self.choice()
        self.assertEqual(initial['resourceId'], '')
        self.assertEqual(initial['effectiveResourceId'], '1' * 32)
        self.assertEqual({item['resourceId'] for item in initial['resources']}, {'1' * 32, '2' * 32})
        for wrong in ('3' * 32, '4' * 32, 'missing'):
            with self.assertRaises(HTTPError) as bad: self.choose(wrong)
            self.assertEqual(bad.exception.code, 409)
        saved = self.choose('2' * 32)
        self.assertEqual(saved['effectiveResourceId'], '2' * 32)
        self.assertEqual(self.choice()['resourceId'], '2' * 32)
        self.assertEqual(self.choice(environment='production')['resourceId'], '')
        self.assertEqual(self.choice(stepId='41896')['resourceId'], '')
        with self.assertRaises(HTTPError) as conflict:
            self.request('/api/runner-management/node-deployment-resource', {**self.context(), 'revision': initial['revision'], 'resourceId': ''})
        self.assertEqual(conflict.exception.code, 409)
        self.assertEqual(self.request(self.route), rules)
        self.archive(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['runnerId'], other.identity['runnerId'])
        # Selecting a different resource cannot move an already-submitted delivery.
        self.choose(''); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['runnerId'], other.identity['runnerId'])
        other.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'success')

    def test_default_changes_follow_inheritance_but_explicit_choice_waits_if_disabled(self):
        other = self.fixture(); rules = self.pool(other)
        rules['items'][0]['isDefault'] = False; rules['items'][1]['isDefault'] = True
        rules = self.request(self.route, rules)
        self.assertEqual(self.choice()['effectiveResourceId'], '2' * 32)
        self.choose('1' * 32)
        self.assertEqual(self.choice()['effectiveResourceId'], '1' * 32)
        rules['items'][0]['enabled'] = False
        self.request(self.route, rules)
        self.archive(); resources.dispatch(self.app)
        job = self.jobs()[0]
        self.assertEqual(job['status'], 'waiting_resource'); self.assertIn('已停用', job['message'])
        self.assertEqual(self.choice()['resourceId'], '1' * 32)
        self.choose(''); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['runnerId'], other.identity['runnerId'])

    def test_same_generated_version_can_be_deployed_to_new_node_resource(self):
        other = self.fixture(); self.pool(other); archive = self.archive()
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        original = self.jobs()[0]
        self.assertEqual(original['status'], 'success')
        self.choose('2' * 32)
        body = {'archiveId': archive['archiveId'], 'configId': '1401218', **archive['sourceContext']}
        moved = self.request('/api/runner-management/deployment-jobs', body)
        self.assertNotEqual(moved['jobId'], original['jobId'])
        self.assertEqual(moved['gitCommit'], original['gitCommit'])
        self.assertEqual(self.request('/api/runner-management/deployment-jobs', body)['jobId'], moved['jobId'])
        resources.dispatch(self.app); other.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'success')
        self.assertEqual((other.directory / 'test/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')
        self.assertEqual(next(job for job in self.jobs() if job['jobId'] == original['jobId'])['runnerId'], self.runner.identity['runnerId'])

    def test_legacy_rule_is_default_and_multiple_defaults_are_rejected(self):
        other = self.fixture()
        legacy = {'configType': '90', 'configTypeName': '网页抓取', 'environment': 'test', 'runnerId': self.runner.identity['runnerId'], 'enabled': True, 'directoryTemplate': '{configId}/{environment}'}
        with self.app.store.connect() as db:
            from backend.runner_management.directory_layout import store_layout
            store_layout(db, resources.RULE_KEY, [legacy])
        first = self.request(self.route)
        self.assertTrue(first['items'][0]['isDefault'])
        self.assertEqual(first, self.request(self.route))
        with self.assertRaises(HTTPError):
            self.request(self.route, {**first, 'items': [*first['items'], {**legacy, 'runnerId': other.identity['runnerId'], 'isDefault': True}]})
        self.assertEqual(self.request(self.route), first)

    def test_resource_name_is_editable_without_changing_node_binding(self):
        other = self.fixture(); rules = self.pool(other)
        self.choose('2' * 32)
        original_revision = self.choice()['revision']
        rules['items'][1]['resourceName'] = '  网页抓取备用测试机  '
        saved = self.request(self.route, rules)
        self.assertEqual(saved['items'][1]['resourceName'], '网页抓取备用测试机')
        current = self.choice()
        self.assertEqual(current['revision'], original_revision)
        self.assertEqual(current['resourceId'], '2' * 32)
        self.assertEqual(next(item for item in current['resources'] if item['resourceId'] == current['resourceId'])['resourceName'], '网页抓取备用测试机')
        for invalid in ('a' * 101, '名称\n换行'):
            with self.assertRaises(HTTPError):
                self.request(self.route, {**saved, 'items': [{**item, 'resourceName': invalid} if item['resourceId'] == '2' * 32 else item for item in saved['items']]})
        self.assertEqual(self.request(self.route), saved)

    def test_preview_directory_matches_dispatch_rule_for_windows_linux_and_queue(self):
        other = self.fixture(); rules = self.pool(other)
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET install_directory=? WHERE runner_id=?', (r'D:\Runner2\instance', self.runner.identity['runnerId']))
            db.execute('UPDATE runners SET install_directory=? WHERE runner_id=?', ('/srv/runner/instance', other.identity['runnerId']))
        initial = self.choice()
        self.assertEqual(initial['targetPath'], 'test/default/1401218')
        self.assertEqual(initial['deploymentDirectory'], r'D:\Runner2\instance\test\default\1401218')
        rules['items'][1]['deploymentDirectory'] = 'jobs'
        self.request(self.route, rules)
        chosen = self.choose('2' * 32, queueName='news_list')
        self.assertEqual(chosen['targetPath'], 'jobs/default/1401218')
        self.assertEqual(chosen['deploymentDirectory'], '/srv/runner/instance/jobs/default/1401218')
        missing_queue = self.choice()
        self.assertEqual(missing_queue['deploymentDirectory'], chosen['deploymentDirectory'])
        self.assertEqual(missing_queue['pathError'], '')
        production = self.choice(environment='production')
        self.assertEqual(production['deploymentDirectory'], '/srv/runner/instance/prod/default/1401218')
        archive = self.archive()
        existing = self.choice(queueName='changed_ui_queue', archiveId=archive['archiveId'])
        self.assertEqual(existing['targetPath'], resources.target(rules['items'][1], {'archive': archive}, {'install_directory': '/srv/runner/instance'}))
        self.assertEqual(existing['deploymentDirectory'], '/srv/runner/instance/jobs/default/1401218')

    def test_git_directory_mapping_preserves_relative_config_files_and_preview(self):
        self.fixture()
        self.app.upload_repository_files(self.repo['repoId'], {'directoryId': 'default', 'uploadType': 'folder', 'overwrite': True,
            'files': [{'name': 'manual_dependency.py', 'relativePath': '1401218/manual_dependency.py', 'data': base64.b64encode(b'MANUAL = True\n').decode()}]}, owner_config_id='1401218')
        saved = self.mapped_resource()
        self.assertNotIn('directoryTemplate', saved['items'][0])
        before = self.choice()
        self.assertEqual(before['targetPath'], 'test/links/default/1401218')
        archive = self.archive()
        preview = self.choice(archiveId=archive['archiveId'])
        self.assertEqual(preview['deploymentDirectory'], str(self.runner.directory / 'test/links/default/1401218'))
        resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['targetPath'], preview['targetPath'])
        self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'success', self.jobs()[0])
        self.assertEqual((self.runner.directory / 'test/links/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')
        self.assertTrue((self.runner.directory / 'test/links/default/1401218/lib/helper.py').is_file())
        self.assertTrue((self.runner.directory / 'test/links/default/1401218/manual_dependency.py').is_file())
        self.assertFalse((self.runner.directory / 'test/links/main.py').exists())
        # Changing the fixed target can deploy the same pinned code again; runtime metadata follows it.
        saved['items'][0]['deploymentDirectory'] = 'test/new-location'
        self.request(self.route, saved)
        self.request('/api/runner-management/deployment-jobs', {'archiveId': archive['archiveId'], 'configId': '1401218', **archive['sourceContext']})
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertTrue((self.runner.directory / 'test/new-location/default/1401218/lib/helper.py').is_file())
        runtimes = self.request('/api/runner-management/runtime-configurations')
        self.assertEqual(runtimes[0]['directoryTemplate'], 'test/new-location/default/1401218')

    def test_resource_absolute_root_preserves_the_deployment_git_directory(self):
        self.fixture(); archive = self.archive()
        absolute = str(self.runner.directory / 'direct-news')
        self.mapped_resource(deployment_directory=absolute)
        preview = self.choice(archiveId=archive['archiveId'])
        self.assertEqual(preview['targetPath'], 'direct-news/default/1401218')
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.assertEqual(self.jobs()[0]['status'], 'success')
        self.assertTrue((self.runner.directory / 'direct-news/default/1401218/main.py').is_file())
        self.assertFalse((self.runner.directory / 'direct-news/main.py').exists())
        saved = self.request(self.route)
        for invalid in ('../escape', str(Path(self.tmp.name) / 'outside-runner'), 'news/{configId}'):
            with self.assertRaises(HTTPError):
                self.request(self.route, {**saved, 'items': [{**saved['items'][0], 'deploymentDirectory': invalid}]})
        self.assertEqual(self.request(self.route), saved)

    def test_environment_roots_are_isolated_and_git_is_not_resource_configuration(self):
        other = self.fixture(); self.archive(); saved = self.mapped_resource()
        base = saved['items'][0]
        with self.assertRaises(HTTPError):
            self.request(self.route, {**saved, 'items': [base, {**base, 'resourceId': '6' * 32, 'environment': 'production'}]})
        stripped = self.request(self.route, {**saved, 'items': [{**base, 'repositoryId': 'old-repo', 'gitDirectory': 'old-directory', 'directoryTemplate': 'old-template'}]})
        for key in ('repositoryId', 'gitDirectory', 'directoryTemplate'): self.assertNotIn(key, stripped['items'][0])
        production = {**base, 'resourceId': '6' * 32, 'environment': 'production', 'runnerId': other.identity['runnerId'], 'deploymentDirectory': 'prod/news'}
        self.request(self.route, {**saved, 'items': [base, production]})
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        self.act(self.jobs()[0], 'publish'); resources.dispatch(self.app); other.deliver_pending(); resources.dispatch(self.app)
        published = next(job for job in self.jobs() if job['environment'] == 'production')
        self.assertEqual(published['status'], 'success', published)
        self.assertEqual(published['targetPath'], 'prod/news/default/1401218')
        self.assertEqual((other.directory / 'prod/news/default/1401218/main.py').read_bytes(), b'VALUE = 1\n')

    def test_instance_is_default_root_and_git_information_is_persisted_per_deployment(self):
        self.fixture()
        saved = self.mapped_resource(deployment_directory=str(self.runner.directory))
        self.assertEqual(saved['items'][0]['deploymentDirectory'], '')
        self.assertEqual(self.mapped_resource(deployment_directory=''), saved)
        for field in ('repositoryId', 'gitDirectory'): self.assertNotIn(field, saved['items'][0])
        archive = self.archive()
        pending = self.jobs()[0]
        self.assertEqual(pending['gitDirectory'], 'default/1401218')
        self.assertEqual(pending['repositoryId'], self.repo['repoId'])
        preview = self.choice(archiveId=archive['archiveId'])
        self.assertEqual(preview['deploymentDirectory'], str(self.runner.directory / 'default/1401218'))
        resources.dispatch(self.app); self.runner.deliver_pending(); resources.dispatch(self.app)
        job = self.jobs()[0]
        self.assertEqual(job['status'], 'success', job)
        self.assertEqual(job['resourceDirectory'], str(self.runner.directory))
        self.assertEqual(job['gitDirectory'], 'default/1401218')
        self.assertEqual((self.runner.directory / 'default/1401218/main.py').read_bytes(), b'VALUE = 1\n')
        with self.app.store.connect() as db:
            stored = json.loads(db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (job['jobId'],)).fetchone()['payload'])
        self.assertEqual(stored['gitDirectory'], job['gitDirectory'])
        self.assertEqual(stored['repositoryId'], job['repositoryId'])


if __name__ == '__main__': unittest.main()
