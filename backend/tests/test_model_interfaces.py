import copy
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management import model_interfaces as models


class ModelInterfacesTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def test_server_enrollment_resolves_model_addresses_and_lists_supported_models_without_probing(self):
        from backend.runner_management import code_servers
        config = models.listing(self.app)
        self.assertEqual(config['items'][1]['generationServerMatch'], 'unmatched')
        config = models.save(self.app, config)
        code = code_servers.enrollment_code(self.app)['code']
        identity = code_servers.enroll(self.app, {'code':code,'name':'home171','ipAddress':'192.168.1.171',
            'endpoint':'http://192.168.1.171:8093','installDirectory':'D:/codeserver','workspace':'D:/codeserver/workspace',
            'osType':'Windows','osVersion':'Windows 11','version':'source-local'})
        with patch.object(models, 'urlopen', side_effect=AssertionError('No model probe allowed')):
            loaded = models.listing(self.app)
            for item in loaded['items'][1:]:
                self.assertEqual(item['generationServerId'],identity['serverId'])
                self.assertEqual(item['generationServerMatch'],'matched')
            server = code_servers.listing(self.app)['items'][0]
        self.assertEqual({item['id'] for item in server['supportedModels']},{'workbuddy-agent-hy3','workbuddy-chat-hy3'})
        saved = models.save(self.app, loaded)
        self.assertEqual(saved['revision'],config['revision']+1)
        with self.app.store.connect() as db:
            stored = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(models.KEY,)).fetchone()['setting_value'])
        self.assertEqual(stored['items'][1]['generationServerId'],'')
        self.assertEqual(stored['items'][1]['generationServerMode'],'auto')
        # Re-saving a decorated auto result must not pin it to an instance.
        saved['items'][1]['endpoint']='http://192.168.1.172:6000/wb/agent'
        changed=models.save(self.app,saved)['items'][1]
        self.assertEqual(changed['generationServerId'],'')
        self.assertEqual(changed['generationServerMatch'],'unmatched')

    def test_address_matching_ambiguity_manual_direct_loopback_and_offline(self):
        servers=[{'serverId':'one','ipAddress':'192.168.1.171','endpoint':'http://CODE.HOST:8093','status':'online'}]
        cases=[
            ({'endpoint':'http://192.168.1.171:6000/wb/agent'},servers,'one','matched'),
            ({'endpoint':'http://code.host.:6000/gemini/chat'},servers,'one','matched'),
            ({'endpoint':'http://localhost:6000/wb/agent'},servers,'','local'),
            ({'endpoint':'http://127.0.0.2:6000/wb/agent'},servers,'','local'),
            ({'endpoint':'http://[::1]:6000/wb/agent'},servers,'','local'),
            ({'endpoint':'http://192.168.1.171:6000/wb/agent'},[{**servers[0],'status':'offline'}],'one','offline'),
            ({'endpoint':'http://192.168.1.171:6000/wb/agent'},[servers[0],{**servers[0],'serverId':'two'}],'','ambiguous'),
            ({'endpoint':'http://192.168.1.171:6000/wb/agent'},[servers[0],{**servers[0],'serverId':'two','status':'offline'}],'one','matched'),
            ({'endpoint':'http://other:6000/agent','generationServerId':'one'},servers,'one','manual'),
            ({'endpoint':'http://other:6000/agent','generationServerId':'deleted'},servers,'deleted','missing'),
            ({'endpoint':'http://192.168.1.171:6000/wb/agent','generationServerMode':'direct'},servers,'','direct'),
        ]
        for item,registry,expected,state in cases:
            with self.subTest(endpoint=item['endpoint'],state=state):
                models.resolve_servers([item],registry)
                self.assertEqual(item['generationServerId'],expected)
                self.assertEqual(item['generationServerMatch'],state)

    def test_generation_request_snapshot_has_actual_agent_body_without_auth_headers(self):
        config=models.listing(self.app)['items'][1]
        config.update(prjDir=r'D:\aicode',endpoint='http://192.168.1.171:6000/wb/agent',cdpPort=9223)
        request=models.workbuddy_request(config,'系统要求：\n角色\n\n用户要求：\n生成教学页面','trace-task')
        request.add_header('Authorization','Bearer private-token')
        request.add_header('Access-Token','private-token')
        details=models.generation_request_details(request)
        self.assertEqual(details['method'],'POST')
        self.assertEqual(details['url'],config['endpoint'])
        self.assertEqual(details['body'],json.loads(request.data))
        self.assertEqual(details['body']['prj_dir'],r'D:\aicode')
        self.assertEqual(details['body']['cdp_port'],9223)
        self.assertEqual(details['headers']['Content-Type'],'application/json; charset=utf-8')
        self.assertNotIn('private-token',json.dumps(details))

    def test_generation_stream_emits_before_completion_and_preserves_utf8(self):
        release=threading.Event()
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                self.send_response(200);self.send_header('Content-Type','text/plain; charset=utf-8');self.end_headers()
                word='你好'.encode('utf8')
                self.wfile.write(b'# first '+word[:2]);self.wfile.flush()
                release.wait(5)
                self.wfile.write(word[2:]+b'\ndef scrape(url):\n    return []\n');self.wfile.flush()
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        thread=threading.Thread(target=upstream.serve_forever,daemon=True);thread.start()
        try:
            config=models.listing(self.app)
            config['items'][2]['endpoint']=f'http://127.0.0.1:{upstream.server_port}/chat'
            models.save(self.app,config)
            payload={'interfaceId':'workbuddy-chat-hy3','prompt':'生成代码','url':'https://example.com','sampleId':'www.realcan.cn.py','responseStream':True}
            request=Request(self.url+'/api/runner-management/model-interfaces/generate',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
            with urlopen(request,timeout=4) as response:
                self.assertIn('application/x-ndjson',response.headers['Content-Type'])
                events=[]
                while True:
                    event=json.loads(response.readline());events.append(event)
                    if event['type']=='chunk':break
                self.assertIn('first',events[-1]['text']);self.assertFalse(release.is_set())
                release.set()
                events.extend(json.loads(line) for line in response if line.strip())
            self.assertIn('你好',''.join(e['text'] for e in events if e['type']=='chunk'))
            self.assertEqual(events[-1]['type'],'result')
            self.assertIn('def scrape(url)',events[-1]['result']['code'])
            trace=next(e['request'] for e in events if e['type']=='request')
            self.assertTrue(trace['url'].startswith(f'http://127.0.0.1:{upstream.server_port}/chat?'))
            self.assertEqual(trace['method'],'GET')
        finally:
            release.set();upstream.shutdown();upstream.server_close();thread.join(timeout=5)

    def test_generation_disconnect_does_not_abort_server_side_completion(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        completed=[]
        def generate(app,body,emit):
            emit('chunk',text='first');completed.append('archive completed')
            return {'fileName':'example.com.py','code':'def scrape(url): return []','warnings':[]}
        handler=Mock();handler.wfile=SimpleNamespace(write=Mock(side_effect=BrokenPipeError()),flush=Mock())
        with patch.object(models,'generate',side_effect=generate):
            models.stream_generate(handler,self.app,{})
        self.assertEqual(completed,['archive completed'])
        self.assertEqual(handler.wfile.write.call_count,1)

    def test_agent_directories_use_instance_task_and_cross_platform_roots(self):
        from backend.runner_management.server import ApiError
        selected = {'id': 'interface-1', 'generationServerId': 'server-1', 'prjDir': r'D:\aicode'}
        paths = models.agent_directories(selected, 'task-1')
        self.assertEqual(paths['codeDir'], r'D:\aicode\code')
        self.assertEqual(paths['inputFileDir'], r'D:\aicode\input')
        self.assertEqual(paths['outputFileDir'], r'D:\aicode\output')
        self.assertEqual(paths['prjDir'], r'D:\aicode')
        self.assertEqual(paths['taskRecordPath'], r'D:\aicode\tasks\task-1.json')
        self.assertNotEqual(models.agent_directories(selected)['taskId'], models.agent_directories(selected)['taskId'])
        self.assertEqual(models.agent_directories({**selected, 'prjDir': '/data/aicode'}, 123)['codeDir'], '/data/aicode/code')
        self.assertEqual(models.agent_directories({**selected, 'generationServerId': ''}, 'task-1')['instanceId'], 'interface-1')
        for bad in ('../escape', 'a/b', '', True, 'a\\b'):
            with self.subTest(taskId=bad), self.assertRaises(ApiError):
                models.agent_directories(selected, bad)

    def test_agent_cdp_port_defaults_persists_overrides_and_validates(self):
        from backend.runner_management.server import ApiError
        config = models.listing(self.app)
        agent = config['items'][1]
        self.assertEqual(agent['cdpPort'], 9223)
        agent.pop('cdpPort')
        saved = models.save(self.app, config)
        self.assertEqual(saved['items'][1]['cdpPort'], 9223)
        saved['items'][1]['cdpPort'] = 9333
        models.save(self.app, saved)
        current = models.listing(self.app)
        self.assertEqual(current['items'][1]['cdpPort'], 9333)
        request = models.workbuddy_request(current['items'][1], '生成代码')
        self.assertEqual(json.loads(request.data)['cdp_port'], 9333)
        _, request = models.prepare_test(self.app, {'interfaceId': agent['id'], 'prompt': '测试', 'cdpPort': 9444})
        self.assertEqual(json.loads(request.data)['cdp_port'], 9444)
        self.assertEqual(models.listing(self.app), current)
        for invalid in (True, None, '9223', 0, 65536, 9223.5):
            with self.subTest(port=invalid):
                broken = copy.deepcopy(current)
                broken['items'][1]['cdpPort'] = invalid
                with self.assertRaises(ApiError):
                    models.save(self.app, broken)
                with self.assertRaises(ApiError):
                    models.prepare_test(self.app, {'interfaceId': agent['id'], 'prompt': '测试', 'cdpPort': invalid})

    def test_gemini_chat_uses_post_json_prompt_and_model_only(self):
        config = models.listing(self.app)
        item = {**config['items'][2], 'id': 'gemini-chat', 'name': 'Gemini Chat', 'kind': 'gemini-chat',
                'model': 'gemini-3.5-flash-lite', 'endpoint': 'http://127.0.0.1:6000/gemini/chat'}
        config['items'].append(item); models.save(self.app, config)
        _, request = models.prepare_test(self.app, {'interfaceId': item['id'], 'prompt': '帮我写个瑟比夫循环？'})
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.full_url, item['endpoint'])
        self.assertEqual(json.loads(request.data), {'prompt': '帮我写个瑟比夫循环？', 'model': item['model']})
        with self.assertRaises(HTTPError):
            self.request('/api/runner-management/model-interfaces/test', {'interfaceId': item['id'], 'prompt': '测试', 'model': ''})

    def test_gemini_agent_sends_title_without_model_for_generation_and_testing(self):
        config = models.listing(self.app)
        gemini = {**config['items'][1], 'id': 'gemini-agent', 'name': 'Gemini Agent', 'kind': 'gemini-agent',
                  'model': '', 'title': '代码优化测试', 'inputFileDir': r'G:\pythonProject\frida\client.py',
                  'endpoint': 'http://127.0.0.1:6000/gemini/agent', 'isDefault': False}
        config['items'].append(gemini)
        models.save(self.app, config)
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.code = 200
        response.headers = {'Content-Type': 'text/plain'}
        response.read.return_value = b'def scrape(url):\n    return []\n'
        with patch.object(models, 'urlopen', return_value=response) as upstream:
            models.test_interface(self.app, {'interfaceId': 'gemini-agent', 'prompt': '优化代码', 'title': '临时标题'})
            request = upstream.call_args.args[0]
            self.assertEqual(request.get_method(), 'POST')
            self.assertEqual(request.full_url, gemini['endpoint'])
            body = json.loads(request.data)
            self.assertNotIn('model', body)
            self.assertNotIn('cdp_port', body)
            self.assertEqual(body['title'], '临时标题')
            self.assertEqual(body['input_file_dir'], r'D:\aicode\input')
            self.assertEqual(body['prj_dir'], r'D:\aicode')
            models.generate(self.app, {'interfaceId': 'gemini-agent', 'prompt': '抓取新闻', 'url': 'https://example.com', 'sampleId': 'www.realcan.cn.py'})
            generated = json.loads(upstream.call_args.args[0].data)
            self.assertEqual(generated['title'], gemini['title'])
            self.assertNotIn('model', generated)

    def test_saved_test_prompts_persist_without_changing_other_parameters(self):
        before = models.listing(self.app)
        payload = {'interfaceId': 'workbuddy-agent-hy3', 'revision': before['revision'],
                   'systemPrompt': '系统角色\n只返回代码', 'userPrompt': '用户要求\n提取新闻'}
        saved = self.request('/api/runner-management/settings/model-interfaces/test-prompts', payload)
        self.assertEqual(saved, self.request('/api/runner-management/settings/model-interfaces'))
        self.assertEqual(saved['revision'], before['revision'] + 1)
        for old, new in zip(before['items'], saved['items']):
            self.assertEqual(old, {key: new[key] for key in old})
        agent = next(row for row in saved['items'] if row['id'] == payload['interfaceId'])
        self.assertEqual(agent['testSystemPrompt'], payload['systemPrompt'])
        self.assertEqual(agent['testUserPrompt'], payload['userPrompt'])
        with self.assertRaises(HTTPError) as stale:
            self.request('/api/runner-management/settings/model-interfaces/test-prompts', payload)
        self.assertEqual(stale.exception.code, 409)
        # Older full-configuration clients must not erase the newly saved prompts.
        config = copy.deepcopy(saved)
        for item in config['items']:
            item.pop('testSystemPrompt', None); item.pop('testUserPrompt', None)
        retained = models.save(self.app, config)
        self.assertEqual(retained['items'][1]['testUserPrompt'], payload['userPrompt'])
        stale_form = copy.deepcopy(retained)
        stale_form['items'][1]['testSystemPrompt'] = ''
        stale_form['items'][1]['testUserPrompt'] = '旧表单内容'
        retained = models.save(self.app, stale_form)
        self.assertEqual(retained['items'][1]['testSystemPrompt'], payload['systemPrompt'])
        self.assertEqual(retained['items'][1]['testUserPrompt'], payload['userPrompt'])
        retained = self.request('/api/runner-management/settings/model-interfaces/test-prompts',
                                {**payload, 'revision': retained['revision'], 'systemPrompt': '', 'userPrompt': ''})
        self.assertEqual(retained['items'][1]['testUserPrompt'], '')
        for change in ({'userPrompt': []}, {'systemPrompt': []}, {'userPrompt': 'x' * 12001}):
            with self.assertRaises(HTTPError):
                self.request('/api/runner-management/settings/model-interfaces/test-prompts',
                             {**payload, 'revision': retained['revision'], **change})

    def test_streaming_delivers_first_output_before_upstream_finishes_and_preserves_utf8(self):
        release = threading.Event()
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers()
                chinese = '你好'.encode('utf8')
                self.wfile.write(b'first' + chinese[:2]); self.wfile.flush()
                release.wait(5)
                self.wfile.write(chinese[2:]); self.wfile.flush()
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            config = models.listing(self.app)
            config['items'][2]['endpoint'] = f'http://127.0.0.1:{upstream.server_port}/chat'
            models.save(self.app, config)
            request = Request(self.url + '/api/runner-management/model-interfaces/test',
                              data=json.dumps({'interfaceId': 'workbuddy-chat-hy3', 'prompt': 'hello', 'responseStream': True}).encode(),
                              headers={'Content-Type': 'application/json'})
            with urlopen(request, timeout=3) as response:
                self.assertIn('application/x-ndjson', response.headers['Content-Type'])
                events = []
                while True:
                    event = json.loads(response.readline()); events.append(event)
                    if event['type'] == 'chunk': break
                self.assertEqual(events[0]['type'], 'connecting')
                self.assertEqual(events[-1]['text'], 'first')
                self.assertFalse(release.is_set())
                release.set()
                events.extend(json.loads(line) for line in response if line.strip())
                self.assertEqual(''.join(e['text'] for e in events if e['type'] == 'chunk'), 'first你好')
                self.assertEqual(events[-1]['type'], 'done')
        finally:
            release.set(); upstream.shutdown(); upstream.server_close(); thread.join(timeout=5)

    def test_old_saved_interfaces_receive_workspace_default_without_losing_configuration(self):
        original = {'revision': 9, 'items': models.defaults()}
        for item in original['items']:
            item.pop('prjDir', None)
        original['items'][1]['endpoint'] = 'http://192.168.1.171:6000/wb/agent'
        with self.app.store.connect() as db:
            db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)',
                       (models.KEY, json.dumps(original)))
        loaded = models.listing(self.app)
        self.assertEqual(loaded['revision'], 9)
        self.assertEqual(loaded['items'][1]['prjDir'], r'D:\aicode')
        for old, new in zip(original['items'], loaded['items']):
            self.assertEqual({key: new[key] for key in old}, old)

    def test_testing_uses_saved_endpoint_temporary_parameters_and_raw_response(self):
        calls = []
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                calls.append(parse_qs(urlsplit(self.path).query, keep_blank_values=True))
                code = 503 if calls[-1].get('prompt') == ['fail'] else 200
                self.send_response(code); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
                self.wfile.write(('暂时繁忙' if code == 503 else '约300公里').encode('utf8'))
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                self.server.test_case.assertIn('application/json', self.headers['Content-Type'])
                self.server.test_case.assertEqual(urlsplit(self.path).query, '')
                calls.append({key: [value] for key, value in payload.items()})
                self.send_response(200); self.end_headers(); self.wfile.write('测试成功'.encode('utf8'))
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        upstream.test_case = self
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            config = models.listing(self.app)
            for row in config['items']:
                row['endpoint'] = f'http://127.0.0.1:{upstream.server_port}/' + row['kind']
            original = models.save(self.app, config)
            payload = {'interfaceId': 'workbuddy-chat-hy3', 'prompt': '南京 & 上海', 'model': 'temporary', 'stream': False,
                       'endpoint': 'http://not-allowed.invalid/', 'kind': 'agent'}
            result = self.request('/api/runner-management/model-interfaces/test', payload)
            self.assertTrue(result['ok']); self.assertEqual(result['responseText'], '约300公里')
            self.assertEqual(calls[-1], {'model': ['temporary'], 'prompt': ['南京 & 上海'], 'stream': ['0']})
            self.request('/api/runner-management/model-interfaces/test', {**payload, 'systemPrompt': '请简短回答'})
            self.assertEqual(calls[-1]['prompt'], ['系统要求：\n请简短回答\n\n用户要求：\n南京 & 上海'])
            self.assertEqual(models.listing(self.app), original)
            failed = self.request('/api/runner-management/model-interfaces/test', {**payload, 'prompt': 'fail'})
            self.assertFalse(failed['ok']); self.assertEqual(failed['status'], 503)
            self.assertEqual(failed['responseText'], '暂时繁忙')
            self.request('/api/runner-management/model-interfaces/test', {**payload, 'interfaceId': 'workbuddy-agent-hy3',
                         'taskId': 'test-task-1', 'prjDir': r'D:\test', 'inputFileDir': r'G:\pythonProject\frida\client.py', 'codeDir': r'D:\test\code', 'outputFileDir': r'D:\test\out', 'systemPrompt': '角色要求'})
            self.assertEqual(calls[-1]['code_dir'], [r'D:\test\code'])
            self.assertEqual(calls[-1]['prj_dir'], [r'D:\test'])
            self.assertEqual(calls[-1]['input_file_dir'], [r'D:\test\input'])
            self.assertEqual(calls[-1]['prompt'], ['系统要求：\n角色要求\n\n用户要求：\n南京 & 上海'])
            self.assertEqual(models.listing(self.app), original)
            for change in ({'prompt': ''}, {'model': ''}, {'stream': '1'}, {'interfaceId': 'missing'}, {'systemPrompt': []}, {'systemPrompt': 'x' * 12001}):
                with self.assertRaises(HTTPError):
                    self.request('/api/runner-management/model-interfaces/test', {**payload, **change})
        finally:
            upstream.shutdown(); upstream.server_close(); thread.join(timeout=5)

    def test_persistence_defaults_validation_and_stale_updates(self):
        config = self.request('/api/runner-management/settings/model-interfaces')
        self.assertEqual(len(config['items']), 3)
        agent = config['items'][1]
        self.assertEqual(agent['codeDir'], r'D:\aicode\code')
        agent['name'] = '自选模型'
        for item in config['items']:
            item['isDefault'] = item is agent
        result = self.request('/api/runner-management/settings/model-interfaces', config)
        self.assertEqual(result['revision'], 1)
        self.assertEqual(self.request('/api/runner-management/settings/model-interfaces'), result)
        with self.assertRaises(HTTPError) as stale:
            self.request('/api/runner-management/settings/model-interfaces', config)
        self.assertEqual(stale.exception.code, 409)
        for field, value in [('endpoint', 'file:///tmp/a'), ('endpoint', 'http://x/api?prompt=foo'),
                             ('endpoint', 'http://user:pass@x/api'), ('timeoutSeconds', True),
                             ('enabled', False), ('model', ''), ('prjDir', '')]:
            invalid = copy.deepcopy(result)
            invalid['items'][1][field] = value
            with self.assertRaises(HTTPError):
                self.request('/api/runner-management/settings/model-interfaces', invalid)
        self.assertEqual(self.request('/api/runner-management/settings/model-interfaces'), result)

    def test_real_http_agent_chat_and_legacy_adapters(self):
        calls = []
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                calls.append((urlsplit(self.path).path, query, dict(self.headers)))
                self.send_response(200)
                if self.path.startswith('/chat'):
                    self.send_header('Content-Type', 'text/event-stream')
                    text = 'data: ' + json.dumps({'choices': [{'delta': {'content': '```python\ndef scrape(url):\n'}}]}) + '\n\n'
                    text += 'data: ' + json.dumps({'choices': [{'delta': {'content': '    return []\n```'}}]}) + '\n\ndata: [DONE]\n\n'
                else:
                    self.send_header('Content-Type', 'text/plain; charset=utf-8')
                    text = '已保存代码：\n```python\ndef scrape(url):\n    return []\n```'
                self.end_headers(); self.wfile.write(text.encode('utf8'))
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append((urlsplit(self.path).path, payload, dict(self.headers)))
                raw = json.dumps({'code': 'def scrape(url):\n    return []\n'}).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(raw)
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            config = self.request('/api/runner-management/settings/model-interfaces')
            for row in config['items']:
                row['endpoint'] = f'http://127.0.0.1:{upstream.server_port}/' + ('legacy' if row['kind'] == 'site-script' else row['kind'])
            self.request('/api/runner-management/settings/model-interfaces', config)
            payload = {'prompt': '不要翻页 & 提取新闻\n\n【当前节点 MQ 主题】\nMQ 主题：auto_snatch_web_link\n【MQ 主题结束】', 'systemPrompt': '系统角色', 'url': 'https://example.com/news?a=1&b=2', 'sampleId': 'www.realcan.cn.py'}
            for row in config['items']:
                result = self.request('/api/runner-management/model-interfaces/generate', {**payload, 'interfaceId': row['id']})
                self.assertIn('def scrape(url)', result['code'])
                self.assertEqual(result['fileName'], 'example.com.py')
                self.assertEqual(result['interfaceId'], row['id'])
            agent = calls[1][1]
            self.assertEqual(calls[1][0], '/agent')
            self.assertEqual(agent['model'], 'hy3')
            self.assertEqual(agent['prj_dir'], r'D:\aicode')
            self.assertEqual(agent['input_file_dir'], r'D:\aicode\input')
            self.assertEqual(agent['code_dir'], agent['input_file_dir'].removesuffix('input') + 'code')
            self.assertIn('application/json', calls[1][2]['Content-Type'])
            self.assertTrue(agent['prompt'].endswith('系统要求：\n系统角色\n\n用户要求：\n' + payload['prompt']))
            self.assertTrue(agent['prompt'].endswith('【MQ 主题结束】'))
            self.assertNotIn('参考样例', agent['prompt'])
            self.assertIn('目标列表 URL：' + payload['url'], agent['prompt'])
            self.assertIn('生成文件名：example.com.py', agent['prompt'])
            self.assertIn('代码保存目录：' + agent['code_dir'], agent['prompt'])
            self.assertEqual(calls[2][1]['stream'], ['1'])
            self.assertNotIn('Access-Token', calls[1][2])
            with self.assertRaises(HTTPError):
                self.request('/api/runner-management/model-interfaces/generate', {**payload, 'interfaceId': 'missing'})
        finally:
            upstream.shutdown(); upstream.server_close(); thread.join(timeout=5)

    def test_bad_output_and_disabled_model_do_not_silently_fall_back(self):
        from backend.runner_management.server import ApiError
        payload = {'interfaceId': 'workbuddy-chat-hy3', 'prompt': '需求', 'url': 'https://example.com', 'sampleId': 'www.realcan.cn.py'}
        with patch.object(models, 'urlopen', side_effect=TimeoutError):
            with self.assertRaisesRegex(ApiError, '超时'):
                models.generate(self.app, payload)
        config = models.listing(self.app)
        config['items'][2]['enabled'] = False
        models.save(self.app, config)
        with patch.object(models, 'urlopen') as upstream:
            with self.assertRaisesRegex(ApiError, '停用'):
                models.generate(self.app, payload)
            upstream.assert_not_called()
        with self.assertRaisesRegex(ApiError, 'JSON'):
            models.decode_response(b'{bad', 'application/json')
        with self.assertRaisesRegex(ApiError, '失败'):
            models.decode_response(b'{"success":false,"message":"busy"}', 'application/json')
