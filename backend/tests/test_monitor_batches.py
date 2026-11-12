import json
import time
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management import monitor_batches as batches
from backend.runner_management.server import ApiError


class MonitorBatchesTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def fixture(self, count=1, missing_table=False):
        checks = {}
        calls = []
        receipt = [False]

        def upstream(path, headers, body=None, query=None, **options):
            calls.append((path, body, query))
            if path.endswith('/lastRun'): return {'data': ['2026-11-12 08:00:00']}
            if path.endswith('/sourcePaged'):
                return {'count': count, 'data': [{'sourceId': str(100 + index), 'sourceName': f'源{index}', 'entryTypeId': '1'} for index in range(count)]}
            if path.endswith('/queryEntryType'):
                return {'data': {'tableName': 'sense_data.news'}}
            if path.endswith('/check-one'):
                if missing_table: return {'success': False, 'msg': '表不存在'}
                return {'success': False, 'msg': '数据不通过\n\n上下文json:' + json.dumps({'sqlResult': '{"cnt":0,"maxId":null}'})}
            if path.endswith('/check/paged'):
                rows = checks.get(str(query['sourceId']), [])
                return {'count': len(rows), 'data': rows}
            if path.endswith('/check/add'):
                source_id = str(body['sourceId'])
                row = {**body, 'id': str(500 + len(checks)), 'isDelete': 0, 'state': 'C'}
                checks.setdefault(source_id, []).append(row)
                return {'code': 0, 'msg': '新增成功'}
            if path.endswith('/runNow'):
                receipt[0] = True
                return {'code': 0}
            if path.endswith('/paged-logs'):
                return {'count': 1 if receipt[0] else 0, 'data': [{'logId': '900', 'sourceId': query['sourceId'],
                    'createDt': '2026-11-12 08:00:02', 'state': 'E', 'logMsg': '没有新数据, 数量:0'}] if receipt[0] else []}
            raise AssertionError(path)

        self.mock_upstream = patch.object(batches, 'call', side_effect=upstream)
        self.mock_upstream.start()
        self.addCleanup(self.mock_upstream.stop)
        return checks, calls

    def create(self, source_ids=None):
        return self.request('/api/runner-management/monitor-batches', {
            'scope': {'sourceIds': source_ids or ['100']},
            'options': {'window': 'hours', 'hours': 24, 'schedule': '0 0 * * * ?'},
        })['batchId']

    def settle(self, batch_id):
        for _ in range(200):
            if (id(self.app), batch_id) not in batches.ACTIVE:
                return self.request('/api/runner-management/monitor-batches/' + batch_id)
            time.sleep(.01)
        self.fail('batch did not settle')

    def action(self, batch_id, action):
        self.request('/api/runner-management/monitor-batches/' + batch_id, {'action': action})
        return self.settle(batch_id)

    def test_unbound_source_preview_create_and_real_run_receipt(self):
        checks, calls = self.fixture()
        batch_id = self.create()
        preview = self.settle(batch_id)
        self.assertEqual(preview['counts'], {'ready': 1})
        self.assertEqual(preview['items'][0]['checkedCount'], 0)
        self.assertEqual(checks, {})
        created = self.action(batch_id, 'apply')
        self.assertEqual(created['counts'], {'created': 1})
        conf = json.loads(checks['100'][0]['checkConf'])
        self.assertEqual(conf['notifyOn'], 'none')
        self.assertEqual(conf['timeType'], 'C')
        self.assertEqual(conf['minSize'], 1)
        verified = self.action(batch_id, 'verify')
        self.assertEqual(verified['items'][0]['data'], 'abnormal')
        self.assertEqual(verified['items'][0]['exec'], 'succeeded')
        self.assertEqual(verified['items'][0]['logId'], '900')
        self.assertFalse(any('sourceSteps' in call[0] or 'nextConfig' in call[0] for call in calls))

    def test_positive_count_is_normal_only_after_formal_receipt(self):
        self.fixture()
        upstream = batches.call.side_effect
        def positive(path, *args, **kwargs):
            result = upstream(path, *args, **kwargs)
            if path.endswith('/check-one'): return {'data': {'sqlResult': {'cnt': 2}}}
            if path.endswith('/paged-logs'):
                for row in result['data']: row.update(state='C', logMsg='数量:2')
            return result
        batches.call.side_effect = positive
        batch_id = self.create()
        preview = self.settle(batch_id)
        self.assertEqual(preview['items'][0]['checkedCount'], 2)
        self.assertNotIn('exec', preview['items'][0])
        self.action(batch_id, 'apply')
        verified = self.action(batch_id, 'verify')
        self.assertEqual(verified['items'][0]['data'], 'normal')
        self.assertEqual(verified['items'][0]['exec'], 'succeeded')

    def test_second_batch_reuses_without_changing_existing_row(self):
        checks, calls = self.fixture()
        first = self.create()
        self.settle(first)
        self.action(first, 'apply')
        before = json.dumps(checks)
        second = self.create()
        self.assertEqual(self.settle(second)['counts'], {'existing': 1})
        self.action(second, 'apply')
        self.assertEqual(json.dumps(checks), before)
        self.assertEqual(sum(path.endswith('/check/add') for path, _, _ in calls), 1)

    def test_missing_or_stopped_source_is_explicitly_blocked(self):
        self.fixture()
        batch_id = self.create(['100', '999'])
        result = self.settle(batch_id)
        self.assertEqual(result['counts'], {'blocked': 1, 'ready': 1})
        self.assertIn('未在当前权限', next(item for item in result['items'] if item['sourceId'] == '999')['message'])

    def test_paused_progress_is_not_overwritten(self):
        self.fixture()
        batch_id = self.create()
        self.settle(batch_id)
        job = batches.read(self.app, batches.PREFIX + batch_id)
        self.request('/api/runner-management/monitor-batches/' + batch_id, {'action': 'pause'})
        job['status'] = 'preparing'
        self.assertFalse(batches.progress(self.app, job))
        self.assertEqual(self.request('/api/runner-management/monitor-batches/' + batch_id)['status'], 'paused')

    def test_dropped_create_response_can_recover_without_second_insert(self):
        checks, _ = self.fixture()
        original = batches.call.side_effect
        def fail_after_create(path, *args, **kwargs):
            result = original(path, *args, **kwargs)
            if path.endswith('/check/add'): raise ApiError('连接中断', 502)
            return result
        batches.call.side_effect = fail_after_create
        batch_id = self.create()
        self.settle(batch_id)
        result = self.action(batch_id, 'apply')
        self.assertEqual(result['counts'], {'create_unknown': 1})
        self.assertEqual(len(checks['100']), 1)
        batches.call.side_effect = original
        result = self.action(batch_id, 'resume')
        self.assertEqual(result['counts'], {'created': 1})
        self.assertEqual(len(checks['100']), 1)

    def test_sql_failure_is_blocked_instead_of_no_data(self):
        checks, _ = self.fixture(missing_table=True)
        batch_id = self.create()
        result = self.settle(batch_id)
        self.assertEqual(result['counts'], {'blocked': 1})
        self.action(batch_id, 'apply')
        self.assertEqual(checks, {})

    def test_existing_disabled_template_is_not_reenabled_or_duplicated(self):
        checks, _ = self.fixture()
        checks['100'] = [{'id': '42', 'sourceId': '100', 'isDelete': 1,
                          'checkConf': '{"templateCode":"ingestion_freshness"}'}]
        result = self.settle(self.create())
        self.assertEqual(result['counts'], {'blocked': 1})
        self.assertIn('停用', result['items'][0]['message'])
        self.assertEqual(len(checks['100']), 1)

    def test_preview_persists_no_credentials_and_is_owner_scoped(self):
        self.fixture()
        batch_id = self.create()
        self.settle(batch_id)
        with self.app.store.connect() as db:
            raw = str([dict(row) for row in db.execute('SELECT * FROM settings WHERE setting_key LIKE ?', ('monitor-batch:%',)).fetchall()])
        self.assertNotIn('Cookie', raw)
        self.assertNotIn('Access-Token', raw)
        with self.assertRaises(ApiError): batches.view(self.app, batch_id, {'userLoginName': 'another-user'})

    def test_unfinished_job_is_recoverable_after_server_restart(self):
        self.fixture()
        batch_id = self.create()
        self.settle(batch_id)
        record = batches.read(self.app, batches.PREFIX + batch_id)
        record['status'] = 'applying'
        record['action'] = 'apply'
        batches.write(self.app, batches.PREFIX + batch_id, record)
        result = self.request('/api/runner-management/monitor-batches/' + batch_id)
        self.assertEqual(result['status'], 'paused')
        self.assertIn('重启', result['message'])

    def test_overlapping_previews_do_not_create_duplicate_on_later_apply(self):
        checks, _ = self.fixture()
        first = self.create()
        self.settle(first)
        second = self.create()
        self.settle(second)
        self.action(first, 'apply')
        self.assertEqual(self.action(second, 'apply')['counts'], {'existing': 1})
        self.assertEqual(len(checks['100']), 1)

    def test_arbitrary_or_empty_scope_and_after_schedule_rejected(self):
        self.fixture()
        for payload in ({'scope': {}}, {'scope': {'sourceIds': ['1 OR 1=1']}, 'options': {'schedule': '0 0 * * * ?'}},
                        {'scope': {'sourceIds': ['100']}, 'options': {'schedule': 'AFTER:30'}}):
            with self.assertRaises(HTTPError) as caught:
                self.request('/api/runner-management/monitor-batches', payload)
            self.assertEqual(caught.exception.code, 400)
