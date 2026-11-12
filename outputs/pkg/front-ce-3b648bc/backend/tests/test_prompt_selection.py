import unittest
from urllib.error import HTTPError
from backend.tests import test_runner_management as baseline


class PromptSelectionTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def publish(self, **extra):
        return self.request('/api/runner-management/site-scripts/publish', {
            'configId': '1401081', 'queueName': 'news_list', 'fileNameMode': 'website',
            'fileName': 'example.com.py', 'code': 'def scrape(url):\n    return []\n',
            'prompt': '用户要求', 'systemPrompt': '系统要求', 'url': 'https://example.com/list', **extra})

    def test_selection_and_prompt_snapshot_round_trip(self):
        first = self.publish(promptTemplateId=42)
        self.assertEqual(first['promptTemplateId'], 42)
        detail = self.request('/api/runner-management/site-scripts/code?digest=' + first['scriptDigest'])
        self.assertEqual(detail['promptTemplateId'], 42)
        self.assertEqual(detail['systemPrompt'], '系统要求')
        changed = self.publish(promptTemplateId=43)
        self.assertNotEqual(first['scriptDigest'], changed['scriptDigest'])
        self.assertEqual(changed['promptTemplateId'], 43)
        manual = self.publish()
        self.assertEqual(manual['promptTemplateId'], 0)
        for invalid in (-1, True, '42'):
            with self.assertRaises(HTTPError):
                self.publish(promptTemplateId=invalid)
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM code_versions').fetchone()['n'], 3)
