import io
import json
import copy
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from backend.tests import test_runner_management as fixtures
from backend.runner_management import model_interfaces, prompt_editing


class PromptEditingTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request

    def models(self):
        from backend.runner_management.model_interfaces import defaults
        items = defaults()
        chat = next(item for item in items if item['kind'] == 'chat')
        agent = next(item for item in items if item['kind'] == 'agent')
        for item in (chat, agent): item.setdefault('title', '')
        return chat, agent

    def test_chat_only_preserves_prompt_and_conversation_without_generation_jobs(self):
        chat, agent = self.models()
        body = {'interfaceId': chat['id'], 'basePrompt': '采集 {{url}}' + '约束' * 5900,
                'variableCatalog': [{'name': 'use_proxy', 'description': '节点是否启用代理'}, {'name': 'proxy_url', 'description': '完整代理 URL'}],
                'messages': [{'role': 'user', 'content': '只取当前页'},
                             {'role': 'assistant', 'content': '{"reply":"已修改","userPrompt":"完整提示词"}'},
                             {'role': 'user', 'content': '保留发布日期'}]}
        with patch.object(model_interfaces, 'listing', return_value={'items': [chat, agent]}):
            selected, request = prompt_editing.prepare(self.app, body)
            payload = json.loads(request.data)
            self.assertEqual(selected['kind'], 'chat')
            self.assertIn(body['basePrompt'], payload['prompt'])
            self.assertIn('只取当前页', payload['prompt'])
            self.assertIn('保留发布日期', payload['prompt'])
            self.assertIn('{{use_proxy}}：节点是否启用代理', payload['prompt'])
            self.assertIn('{{proxy_url}}：完整代理 URL', payload['prompt'])
            self.assertLess(payload['prompt'].index('用户要求：'), payload['prompt'].index('代码生成常用变量（'))
            with self.assertRaises(Exception): prompt_editing.prepare(self.app, {**body, 'variableCatalog': [{'name': 'unsupported', 'description': 'unknown'}]})
            with self.assertRaises(Exception): prompt_editing.prepare(self.app, {**body, 'interfaceId': agent['id']})
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) total FROM generation_jobs').fetchone()['total'], 0)

    def test_http_stream_relays_chat_reply_and_rejects_agent_or_invalid_messages(self):
        chat, agent = self.models()
        body = {'interfaceId': chat['id'], 'basePrompt': '采集 {{url}}', 'messages': [{'role': 'user', 'content': '只取当前页'}]}
        reply = {'reply': '已修改', 'userPrompt': '只取当前页 {{url}}'}
        upstream = io.BytesIO(json.dumps({'reply': json.dumps(reply, ensure_ascii=False)}, ensure_ascii=False).encode())
        upstream.code = 200
        upstream.headers = {'Content-Type': 'application/json'}
        with patch.object(model_interfaces, 'listing', return_value={'items': [chat, agent]}), patch.object(model_interfaces, 'urlopen', return_value=upstream):
            with urlopen(Request(self.url + '/api/runner-management/prompt-edits/chat',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}), timeout=5) as response:
                events = [json.loads(line) for line in response.read().decode().splitlines()]
            self.assertEqual(events[-1]['type'], 'done')
            content = ''.join(event['text'] for event in events if event['type'] == 'chunk')
            self.assertEqual(json.loads(json.loads(content)['reply']), reply)
            for bad in ({**body, 'interfaceId': agent['id']}, {**body, 'messages': []},
                        {**body, 'messages': [{'role': 'assistant', 'content': '没有用户要求'}]}):
                with self.assertRaises(HTTPError): self.request('/api/runner-management/prompt-edits/chat', bad)

    def test_system_prompt_editing_targets_system_instructions_and_rejects_unknown_type(self):
        chat, agent = self.models()
        body = {'interfaceId': chat['id'], 'promptType': 'system', 'basePrompt': '系统约束 {{url}}',
                'messages': [{'role': 'user', 'content': '禁止输出待验证的代码'}]}
        with patch.object(model_interfaces, 'listing', return_value={'items': [chat, agent]}):
            _, request = prompt_editing.prepare(self.app, body)
            payload = json.loads(request.data)
            self.assertIn('原系统提示词：\n系统约束 {{url}}', payload['prompt'])
            self.assertIn('修改系统提示词', payload['prompt'])
            self.assertNotIn('修改用户提示词', payload['prompt'])
            with self.assertRaises(Exception):
                prompt_editing.prepare(self.app, {**body, 'promptType': 'unknown'})

    def test_automatic_chat_falls_back_when_preferred_port_is_busy_and_releases_lease(self):
        from backend.runner_management import agent_pool
        chat, agent = self.models()
        other = {**copy.deepcopy(chat), 'id': 'spare-chat', 'name': '空闲 Chat', 'cdpPort': (chat.get('cdpPort') or 9222) + 1}
        body = {'automatic': True, 'interfaceId': chat['id'], 'basePrompt': '采集 {{url}}',
                'messages': [{'role': 'user', 'content': '仅采集当前页'}]}
        self.assertTrue(agent_pool.acquire(self.app, chat, 'occupied'))
        upstream = io.BytesIO(json.dumps({'reply': '完成', 'userPrompt': '仅采集当前页 {{url}}'}).encode())
        upstream.code = 200; upstream.headers = {'Content-Type': 'application/json'}
        try:
            with patch.object(model_interfaces, 'listing', return_value={'items': [agent, chat, other]}), patch.object(model_interfaces, 'urlopen', return_value=upstream):
                with urlopen(Request(self.url + '/api/runner-management/prompt-edits/chat', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json'}), timeout=5) as response:
                    events = [json.loads(line) for line in response.read().decode().splitlines()]
            self.assertEqual(events[0]['type'], 'connecting')
            self.assertEqual(events[0]['interfaceId'], other['id'])
            self.assertEqual(events[0]['interfaceName'], other['name'])
            self.assertEqual(events[-1]['type'], 'done')
            self.assertTrue(agent_pool.acquire(self.app, other, 'available-after-chat'))
            with patch.object(model_interfaces, 'listing', return_value={'items': [agent, chat, other]}), patch.object(model_interfaces, 'urlopen') as call:
                with self.assertRaises(HTTPError) as caught: self.request('/api/runner-management/prompt-edits/chat', body)
                self.assertEqual(caught.exception.code, 409)
                call.assert_not_called()
        finally:
            agent_pool.release(self.app, chat, 'occupied')
            agent_pool.release(self.app, other, 'available-after-chat')

    def test_stream_identifies_real_relay_machine_without_exposing_server_credentials(self):
        from backend.runner_management import code_servers
        chat, _ = self.models()
        chat['generationServerId'] = 'machine-173'
        class Handler:
            wfile = io.BytesIO()
            def send_response(self, status): pass
            def send_header(self, name, value): pass
            def end_headers(self): pass
        handler = Handler()
        upstream = io.BytesIO(b'{}'); upstream.code = 200; upstream.headers = {'Content-Type': 'application/json'}
        with patch.object(code_servers, 'read', return_value={'name': 'home173', 'ipAddress': '192.168.1.173', 'token': 'private-token'}), patch.object(model_interfaces, 'urlopen', return_value=upstream):
            model_interfaces._stream_test(handler, self.app, {}, (chat, Request(chat['endpoint'])))
        events = [json.loads(line) for line in handler.wfile.getvalue().decode().splitlines()]
        self.assertEqual(events[0]['serverId'], 'machine-173')
        self.assertEqual(events[0]['serverName'], 'home173')
        self.assertEqual(events[0]['serverAddress'], '192.168.1.173')
        self.assertNotIn('private-token', handler.wfile.getvalue().decode())


del fixtures
