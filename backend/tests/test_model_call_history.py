import io
import json
import unittest
from urllib.request import Request
from unittest.mock import patch
from backend.tests import test_runner_management as fixtures
from backend.runner_management import model_call_history as calls, model_interfaces as models
from backend.runner_management.server import ApiError


class ModelCallHistoryTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request

    def selected(self, interface='agent-9222', port=9222):
        return {'id':interface,'name':'测试智能体','kind':'agent','model':'hy3','endpoint':'http://192.168.1.175:6000/wb/agent',
                'cdpPort':port,'timeoutSeconds':30,'generationServerId':''}

    def test_actual_interface_port_running_final_status_and_readonly_pagination(self):
        selected=self.selected()
        with calls.track(self.app,selected,{'userPrompt':'private prompt must not be recorded'},'generation') as call:
            self.assertEqual(calls.listing(self.app,selected['id'],{})['items'][0]['status'],'running')
            call.data['httpStatus']=200
        with calls.track(self.app,self.selected('agent-9223',9223),{},'test'): pass
        with patch.object(self.app,'authenticate_admin',wraps=self.app.authenticate_admin) as auth:
            result=self.request('/api/runner-management/model-interfaces/agent-9222/calls?page=1&pageSize=1')
            self.assertFalse(auth.call_args.kwargs['write'])
        self.assertEqual(result['total'],1)
        row=result['items'][0]
        self.assertEqual((row['interfaceId'],row['cdpPort'],row['status'],row['httpStatus']),('agent-9222',9222,'succeeded',200))
        self.assertGreaterEqual(row['durationMs'],0)
        self.assertNotIn('private prompt',json.dumps(row))
        self.assertEqual(calls.listing(self.app,'agent-9223',{})['items'][0]['cdpPort'],9223)

    def test_failed_generation_keeps_error_only_and_sanitizes_credentials(self):
        selected=self.selected(); selected['endpoint']='http://user:secret@host:6000/agent?token=private'
        with patch.object(models,'_generate_impl',side_effect=ApiError('password=private 网络错误\nextra stack material',502)):
            with self.assertRaises(ApiError): models._generate(self.app,{'systemPrompt':'private system','userPrompt':'private user'},selected)
        row=calls.listing(self.app,selected['id'],{})['items'][0]
        self.assertEqual(row['status'],'failed')
        self.assertEqual(row['endpoint'],'http://host:6000/agent')
        self.assertNotIn('private',json.dumps(row)); self.assertNotIn('stack material',json.dumps(row))

    def test_streamed_prompt_edit_and_http_test_failures_are_recorded(self):
        selected=self.selected(); selected['kind']='chat'
        class Handler:
            def __init__(self): self.wfile=io.BytesIO()
            def send_response(self,status): pass
            def send_header(self,name,value): pass
            def end_headers(self): pass
        response=io.BytesIO(b'upstream unavailable'); response.code=503; response.headers={'Content-Type':'text/plain'}
        with patch.object(models,'urlopen',return_value=response):
            models._stream_test(Handler(),self.app,{'basePrompt':'draft','messages':[]},(selected,Request(selected['endpoint'])))
        row=calls.listing(self.app,selected['id'],{})['items'][0]
        self.assertEqual((row['purpose'],row['status'],row['httpStatus']),('prompt-edit','failed',503))
        with patch.object(models,'_test_interface_impl',return_value={'ok':False,'status':401,'responseText':'private output'}):
            models._test_interface(self.app,{},(selected,Request(selected['endpoint'])))
        result=calls.listing(self.app,selected['id'],{'pageSize':['1']})
        self.assertEqual(result['total'],2)
        self.assertEqual((result['items'][0]['purpose'],result['items'][0]['httpStatus']),('test',401))
        self.assertNotIn('private output',json.dumps(result))

    def test_historical_generation_backfill_is_idempotent_and_does_not_guess_chat_calls(self):
        model={'interfaceId':'old-agent','name':'旧智能体','kind':'agent','endpoint':'http://host/agent','model':'hy3'}
        job={'taskId':'completed-task','modelCall':model,'status':'succeeded','startedAt':'2026-11-18T01:00:00Z','finishedAt':'2026-11-18T01:00:02Z','configId':'1401218','message':'已完成'}
        with self.app.store.connect() as db:
            db.execute("INSERT INTO jobs (job_type,job_id,source_id,flow_id,config_id,executor_id,status,server_id,created_at,lease_until,payload) VALUES ('generation',?,?,?,?,?,?,?,?,?,?)",('completed-task','','','1401218','old-agent','succeeded','','2026-11-18T01:00:00Z',0,json.dumps(job)))
        self.assertEqual(calls.backfill(self.app),1)
        self.assertEqual(calls.backfill(self.app),0)
        row=calls.listing(self.app,'old-agent',{})['items'][0]
        self.assertEqual(row['durationMs'],2000)
        self.assertTrue(row['historical']); self.assertTrue(row['taskRecorded'])
        self.assertIsNone(row['cdpPort'])
        self.assertEqual(calls.listing(self.app,'old-chat',{})['total'],0)

    def test_restart_does_not_leave_an_unfinished_call_permanently_running(self):
        call=calls.Call(self.app,self.selected(),{},'generation')
        calls.recover_interrupted(self.app)
        row=calls.listing(self.app,self.selected()['id'],{})['items'][0]
        self.assertEqual(row['callId'],call.data['callId'])
        self.assertEqual(row['status'],'interrupted')
        self.assertIn('最终结果未能确认',row['message'])


del fixtures
