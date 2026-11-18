import json
import unittest
from urllib.error import HTTPError
from backend.tests import test_runner_management as fixtures
from backend.runner_management import deployment_resources as resources
from backend.runner_management.directory_layout import revision
from backend.runner_management.runner import Runner
from pathlib import Path


class RunnerResourceIdentityTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request

    def test_legacy_node_and_task_targets_resolve_to_runner_without_rewriting_history(self):
        runner = Runner(Path(self.tmp.name) / 'runner', self.url)
        self.addCleanup(runner.close); runner.enroll()
        runner_id = runner.identity['runnerId']; legacy = 'a' * 32
        context = {'sourceId': '430024901', 'flowId': '21000040', 'stepId': '41895',
                   'configId': '1401218', 'configType': '90', 'environment': 'test'}
        choice = {**context, 'resourceId': legacy, 'resourceIds': [legacy], 'useDefault': False}
        with self.app.store.connect() as db:
            db.execute('INSERT INTO settings VALUES (?,?)', (resources.RULE_KEY, json.dumps([{
                'resourceId': legacy, 'resourceName': 'obsolete name', 'runnerId': runner_id,
                'configType': '90', 'configTypeName': '网页抓取', 'environment': 'both', 'enabled': True}])))
            db.execute('INSERT INTO settings VALUES (?,?)', (resources.choice_key(context), json.dumps(choice)))
        saved = self.request('/api/runner-management/deployment-resources')
        item = saved['items'][0]
        self.assertEqual(item['resourceId'], runner_id)
        self.assertNotEqual(item['resourceName'], 'obsolete name')
        self.assertIn(legacy, item['legacyResourceIds'])
        with self.app.store.connect() as db:
            selected = resources.read_choice(db, context)
            self.assertEqual(selected['resourceIds'], [runner_id])
            self.assertEqual(selected['revision'], revision(choice))
            rule, explicit = resources.selected_resource(db, {**context, 'targetResourceId': legacy})
            self.assertTrue(explicit); self.assertEqual(rule['runnerId'], runner_id)
            self.assertTrue(resources.same_target({'targetResourceId': legacy}, {'targetResourceId': runner_id}, db))
            self.assertEqual(json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?',
                             (resources.choice_key(context),)).fetchone()['setting_value']), choice)
        changed = self.request('/api/runner-management/deployment-resources', {
            **saved, 'items': [{**item, 'configType': '95', 'configTypeName': '文件下载', 'resourceName': 'ignored'}]})
        self.assertEqual(changed['items'][0]['resourceId'], runner_id)
        self.assertEqual(changed['items'][0]['resourceName'], item['resourceName'])
        with self.app.store.connect() as db:
            self.assertEqual(resources.canonical_id(db, legacy), runner_id)
        with self.assertRaises(HTTPError) as error:
            self.request('/api/runner-management/deployment-resources', {
                **changed, 'items': changed['items'] + [{**changed['items'][0], 'environment': 'test'}]})
        self.assertEqual(error.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
