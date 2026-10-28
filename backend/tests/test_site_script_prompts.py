import importlib.util
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import unittest
import threading
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.tests import test_runner_management as baseline

service_path = Path(__file__).parents[1] / 'legacy_qinlongclaw/site-script-service/server.py'
spec = importlib.util.spec_from_file_location('site_script_prompts_service', service_path)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class SiteScriptPromptGenerationTest(unittest.TestCase):
    def generate(self, payload):
        calls = []
        def model(key, name, user, system):
            calls.append({'system': system, 'user': user})
            return 'def scrape(url):\n    return []\n'
        with patch.dict(os.environ, {'SITE_SCRIPT_AI_API_KEY': 'fake-test-key'}):
            service.generate({'prompt': '旧用户需求', 'url': 'https://example.com/list', 'sampleId': service.SAMPLE_ID, **payload}, model)
        return calls[0]

    def test_custom_prompts_are_sent_in_distinct_roles_with_url_and_sample_context(self):
        result = self.generate({'systemPrompt': '系统：只返回可运行代码', 'userPrompt': '用户：提取标题和时间'})
        self.assertEqual(result['system'], '系统：只返回可运行代码')
        self.assertIn('用户：提取标题和时间', result['user'])
        self.assertNotIn('旧用户需求', result['user'])
        self.assertIn('https://example.com/list', result['user'])
        self.assertIn(service.SAMPLE, result['user'])

    def test_legacy_prompt_uses_existing_system_default(self):
        result = self.generate({})
        self.assertEqual(result['system'], service.SYSTEM_PROMPT)
        self.assertIn('旧用户需求', result['user'])

    def test_chat_adapter_uses_separate_system_and_user_messages(self):
        calls = []
        def model(endpoint, key, body):
            calls.append(body)
            return {'choices': [{'message': {'content': 'def scrape(url):\n    return []\n'}}]}
        with patch.dict(os.environ, {'SITE_SCRIPT_AI_API_KEY': 'fake-test-key'}):
            service.generate({'systemPrompt': '系统规则', 'userPrompt': '用户要求', 'url': 'https://example.com', 'sampleId': service.SAMPLE_ID}, model)
        self.assertEqual(calls[0]['messages'][0], {'role': 'system', 'content': '系统规则'})
        self.assertEqual(calls[0]['messages'][1]['role'], 'user')
        self.assertIn('用户要求', calls[0]['messages'][1]['content'])

    def test_http_generation_accepts_two_chinese_prompts_over_32kb(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        payload = {'systemPrompt': '系统' * 3000, 'userPrompt': '用户' * 3000,
                   'url': 'https://example.com', 'sampleId': service.SAMPLE_ID}
        data = json.dumps(payload).encode()
        self.assertGreater(len(data), 32 * 1024)
        try:
            with patch.dict(os.environ, {'SITE_SCRIPT_AI_API_KEY': 'fake-test-key', 'SITE_SCRIPT_AUTH_URL': ''}), patch.object(service, 'call_model', return_value='def scrape(url):\n    return []\n') as model:
                result = json.load(urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/ai/site-script/generate', data=data, headers={'Content-Type': 'application/json'}), timeout=5))
                self.assertIn('scrape(url)', result['code'])
                self.assertEqual(model.call_args.args[3], payload['systemPrompt'])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)

    def test_invalid_prompts_fail_before_model_request(self):
        for fields in ({'systemPrompt': ''}, {'systemPrompt': []}, {'systemPrompt': 'x' * 12001}, {'userPrompt': ''}, {'userPrompt': 123}, {'userPrompt': 'x' * 12001}):
            with self.assertRaises(service.GenerationError):
                self.generate(fields)


class SiteScriptPromptPersistenceTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def test_prompts_are_versioned_and_legacy_code_versions_remain_readable(self):
        payload = {'configId': '123', 'queueName': 'news_list', 'codeType': 'default',
                   'fileName': 'news_list.py', 'code': 'def scrape(url):\n    return []\n',
                   'prompt': '旧提示词', 'url': 'https://example.com/list'}
        legacy = self.request('/api/runner-management/site-scripts/publish', payload)
        self.assertEqual(legacy['systemPrompt'], '')
        first = self.request('/api/runner-management/site-scripts/publish', {
            **payload, 'systemPrompt': '系统规则一', 'userPrompt': '用户抓取要求'})
        second = self.request('/api/runner-management/site-scripts/publish', {
            **payload, 'systemPrompt': '系统规则二', 'userPrompt': '用户抓取要求'})
        self.assertNotEqual(first['scriptDigest'], second['scriptDigest'])
        self.assertEqual(first['codeId'], second['codeId'])
        self.assertEqual(first['gitCommit'], second['gitCommit'])
        for saved, system, user in ((legacy, '', '旧提示词'), (first, '系统规则一', '用户抓取要求'), (second, '系统规则二', '用户抓取要求')):
            result = self.request('/api/runner-management/site-scripts/code?digest=' + saved['scriptDigest'])
            self.assertEqual((result['systemPrompt'], result['userPrompt'], result['prompt']), (system, user, user))
        for fields in ({'systemPrompt': []}, {'systemPrompt': 'x' * 12001}, {'userPrompt': False}):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/runner-management/site-scripts/publish', {**payload, **fields})
            self.assertEqual(error.exception.code, 400)

    def test_large_code_and_both_prompts_fit_the_publish_request_limit(self):
        payload = {'configId': '123', 'queueName': 'large_prompt', 'codeType': 'default',
                   'fileName': 'large_prompt.py', 'code': '# ' + 'x' * 180000 + '\ndef scrape(url):\n    return []\n',
                   'prompt': '用户' * 5000, 'userPrompt': '用户' * 5000, 'systemPrompt': '系统' * 5000,
                   'url': 'https://example.com/list'}
        self.assertGreater(len(json.dumps(payload).encode()), 256 * 1024)
        result = self.request('/api/runner-management/site-scripts/publish', payload)
        self.assertEqual(result['systemPrompt'], payload['systemPrompt'])
        self.assertEqual(result['userPrompt'], payload['userPrompt'])
