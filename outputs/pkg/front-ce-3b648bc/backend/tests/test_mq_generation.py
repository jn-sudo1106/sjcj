"""Regression tests for retained historical MQ records; production workers now use database_generation."""
import io
import json
import threading
import time
import unittest
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from unittest.mock import patch

from backend.tests.test_generated_archives import GeneratedArchivesTest
from backend.runner_management import mq_generation as mq, generation_tasks as jobs, code_servers
from backend.runner_management.server import ApiError


class MqGenerationTest(unittest.TestCase):
    setUp=GeneratedArchivesTest.setUp
    tearDown=GeneratedArchivesTest.tearDown
    request=GeneratedArchivesTest.request
    start_remote=GeneratedArchivesTest.start_remote
    fixture=GeneratedArchivesTest.fixture

    def test_batch_summaries_exclude_prompts_code_and_unclaimed_tasks(self):
        record = {'taskId':'501','serverId':'server-1','configId':'101','queue':'code_mq','status':'running',
                  'callbackSent':False,'message':'生成中','task':{'Param':'private'},'params':{'prompt':'private'},
                  'output':'large model response','request':{'body':{'prompt':'private'}},'result':{'code':'private'}}
        mq.put(self.app,record)
        result = self.request('/api/runner-management/mq-code-jobs/summaries?taskIds=501,502')
        self.assertEqual(result['items'],[{field:record[field] for field in ('taskId','serverId','configId','queue','status','callbackSent','message')}])
        self.assertEqual(mq.summaries(self.app,['502']),{'items':[]})
        with self.assertRaises(ApiError):mq.summaries(self.app,['bad id'])
        with self.assertRaises(ApiError):mq.summaries(self.app,['501']*101)

    def configure(self,ret_failures=0):
        service,repo,origin,payload,calls=self.fixture()
        self.request('/api/code-servers/me/heartbeat',{**service.report(),'serverId':service.identity['serverId'],
            'endpoint':code_servers.read(self.app,service.identity['serverId'])['endpoint']},service.identity['token'])
        generation={k:payload[k] for k in ('interfaceId','repositoryId','directoryId','configType','queueName','url')}
        generation.update(systemPrompt='编写可靠代码',userPrompt='生成处理程序',fileNameMode='website')
        jobs.save_config(self.app,{'configId':'101','generation':generation})
        task={'Task':{'TaskID':'501','ConfigId':'201001','StepConfigId':'101','Url':'https://example.com/news',
                      'Param':json.dumps({'taskKind':'CODE_CONFIG','stepConfigId':101,'orchestration':{}})}}
        messages=[task];returns=[];gets=[];failures=[ret_failures]
        class Business(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                data={'code':0,'data':[{'configId':'201001','name':'代码生成','topic':'code_generation'}]}
                self.send_response(200);self.end_headers();self.wfile.write(json.dumps(data).encode())
            def do_POST(self):
                payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
                if self.headers.get('app')!='fixture-app' or self.headers.get('sign')!='fixture-key':
                    data={'code':-1,'success':False,'msg':'权限校验失败'}
                elif urlsplit(self.path).path.endswith('/basic-get'):
                    gets.append(parse_qs(urlsplit(self.path).query));data=messages.pop(0) if messages else '-1'
                else:
                    returns.append(payload)
                    data=-1 if failures[0] else 1
                    failures[0]=max(0,failures[0]-1)
                self.send_response(200);self.end_headers();self.wfile.write(json.dumps(data).encode())
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Business)
        threading.Thread(target=upstream.serve_forever,daemon=True).start()
        self.addCleanup(upstream.server_close);self.addCleanup(upstream.shutdown)
        env=patch.dict('os.environ',{'RUNNER_NODE_TYPE_BACKEND':f'http://127.0.0.1:{upstream.server_port}',
                                    'RUNNER_BUSINESS_APP_ID':'fixture-app','RUNNER_BUSINESS_APP_KEY':'fixture-key'})
        env.start();self.addCleanup(env.stop)
        self.request('/api/runner-management/code-servers/'+service.identity['serverId']+'/mq-binding',{'configId':'201001'})
        return service,origin,calls,returns,messages,gets

    def test_model_identity_survives_workspace_failure_before_any_model_request(self):
        service, origin, calls, returns, messages, gets = self.configure()
        job = self.personal(service, 'next', {})['job']
        claimed = mq.read(self.app, '501')
        self.assertEqual(claimed['modelCall']['interfaceId'], 'workbuddy-agent-hy3')
        self.assertTrue(claimed['modelCall']['endpoint'].endswith('/wb/agent'))
        self.assertEqual(claimed['modelCall']['serverId'], service.identity['serverId'])
        with patch('backend.runner_management.model_interfaces.generate', side_effect=ApiError('tasks 目录拒绝访问', 403)):
            self.personal(service, 'execute', job)
        record = mq.read(self.app, '501')
        self.assertEqual(record['status'], 'failed')
        self.assertEqual(record['modelCall']['method'], 'POST')
        self.assertNotIn('request', record)
        self.assertFalse(calls)

    def test_model_metadata_omits_query_credentials_and_does_not_affect_routing(self):
        service, origin, calls, returns, messages, gets = self.configure()
        from backend.runner_management import model_interfaces
        selected = next(item for item in model_interfaces.listing(self.app)['items'] if item['id'] == 'workbuddy-agent-hy3')
        selected['endpoint'] = 'http://model/wb/agent?api_key=private-value&token=private-token'
        info = mq.model_call_info(self.app, {'configId': '101', 'params': {}}, selected)
        self.assertEqual(info['endpoint'], 'http://model/wb/agent')
        self.assertNotIn('private', json.dumps(info))
        self.assertNotIn('token', info)
        self.assertFalse(calls)

    def personal(self,service,action,body):
        # Exercise the retired transport directly. Public worker routes are
        # intentionally covered by DatabaseGenerationTest instead.
        handler=SimpleNamespace(send_response=lambda *args: None, send_header=lambda *args: None,
                                end_headers=lambda: None, wfile=io.BytesIO())
        row=code_servers.read(self.app,service.identity['serverId'])
        result=mq.personal(handler,self.app,'POST','/legacy/'+action,body,row)
        if action!='execute':return result
        lines=handler.wfile.getvalue().splitlines()
        return [json.loads(line) for line in lines] if lines else [result]

    def test_mq_snapshot_preserves_manual_code_directory_and_archives_results(self):
        service,origin,calls,returns,messages,gets=self.configure()
        messages[0]['Task']['Param']=json.dumps({'taskKind':'CODE_CONFIG','stepConfigId':101,
            'orchestration':{'aiGeneration':{'codeDirectory':'manual-snapshot/code'}}})
        job=self.personal(service,'next',{})['job']
        self.personal(service,'execute',job)
        self.assertEqual(calls[0]['code_dir'],str(service.workspace.root/'manual-snapshot'/'code'))
        self.assertEqual(calls[0]['prj_dir'],str(service.workspace.root/'101'))
        self.assertTrue(mq.read(self.app,'501')['callbackSent'])
        self.assertEqual(self.app.git(origin,'show','main:default/101/newslink.py').strip(),'VALUE = 1')

    def test_missing_machine_is_parked_and_later_executes_without_own_ingress_queue(self):
        from backend.runner_management import model_interfaces
        service,origin,calls,returns,messages,gets=self.configure()
        config=model_interfaces.listing(self.app)
        agent=config['items'][1]
        agent.update(generationServerMode='auto',generationServerId='')
        model_interfaces.save(self.app,config)
        self.assertIsNone(self.personal(service,'next',{})['job'])
        record=mq.read(self.app,'501')
        self.assertEqual(record['status'],'queued');self.assertEqual(record['serverId'],'')
        self.assertFalse(record['callbackSent']);self.assertFalse(calls);self.assertFalse(returns)
        self.assertEqual(len(mq.records(self.app,'')),1)
        self.assertEqual(mq.records(self.app,service.identity['serverId']),[])
        # The task survives while its selected model has no matching machine.
        self.assertIsNone(self.personal(service,'next',{})['job'])
        config=model_interfaces.listing(self.app)
        config['items'][1].update(generationServerMode='manual',generationServerId=service.identity['serverId'])
        model_interfaces.save(self.app,config)
        self.request('/api/runner-management/code-servers/'+service.identity['serverId']+'/mq-binding',{'configId':''})
        job=self.personal(service,'next',{})['job']
        self.assertEqual(job,{'taskId':'501'})
        self.assertEqual(mq.records(self.app,''),[])
        self.personal(service,'execute',job)
        self.assertEqual(len(calls),1);self.assertEqual(returns[0]['StrTaskId'],'501')
        self.assertTrue(mq.read(self.app,'501')['callbackSent'])

    def test_model_machine_disappears_after_claim_keeps_task_waiting_without_failure_receipt(self):
        from backend.runner_management import model_interfaces
        service,origin,calls,returns,messages,gets=self.configure()
        job=self.personal(service,'next',{})['job']
        config=model_interfaces.listing(self.app)
        config['items'][1].update(generationServerMode='auto',generationServerId='')
        model_interfaces.save(self.app,config)
        events=self.personal(service,'execute',job)
        self.assertEqual(events[0]['status'],'queued')
        record=mq.read(self.app,'501')
        self.assertEqual(record['status'],'queued');self.assertEqual(record['serverId'],'')
        self.assertFalse(calls);self.assertFalse(returns);self.assertFalse(record['callbackSent'])

    def test_wrong_ingress_worker_does_not_execute_another_models_task(self):
        from backend.runner_management import model_interfaces
        service,origin,calls,returns,messages,gets=self.configure()
        actual=code_servers.read(self.app,service.identity['serverId'])
        other={**actual,'serverId':'other-model-server','mqGeneration':None}
        with self.app.store.connect() as db:code_servers.write(db,other)
        config=model_interfaces.listing(self.app)
        config['items'][1].update(generationServerMode='manual',generationServerId=other['serverId'])
        model_interfaces.save(self.app,config)
        self.assertIsNone(self.personal(service,'next',{})['job'])
        self.assertEqual(mq.read(self.app,'501')['status'],'queued')
        self.assertFalse(calls);self.assertFalse(returns)
        self.assertEqual(mq.claim(self.app,other)['job'],{'taskId':'501'})
        self.assertEqual(mq.read(self.app,'501')['serverId'],other['serverId'])

    def test_legacy_201_queue_record_archives_and_returns_original_task_id(self):
        service,origin,calls,returns,messages,gets=self.configure()
        job=self.personal(service,'next',{})['job']
        self.personal(service,'execute',job)
        self.assertEqual(len(calls),1)
        self.assertEqual(returns[0]['StrTaskId'],'501');self.assertEqual(returns[0]['IsSuccess'],'true')
        self.assertEqual(gets[0]['queue'],['code_generation'])
        self.assertEqual(self.app.git(origin,'show','main:default/101/newslink.py').strip(),'VALUE = 1')
        record=mq.read(self.app,'501');self.assertTrue(record['callbackSent']);self.assertEqual(record['status'],'succeeded')
        self.assertIn('request',record);self.assertTrue(record['result']['archive']['gitCommit'])
        self.assertEqual(service.active_requests,0);self.assertFalse(service.mq_task_active)

    def test_callback_retry_and_duplicate_message_never_repeat_model_or_git(self):
        service,origin,calls,returns,messages,gets=self.configure(ret_failures=1)
        duplicate=dict(messages[0])
        job=self.personal(service,'next',{})['job'];self.personal(service,'execute',job)
        self.assertEqual(mq.read(self.app,'501')['status'],'succeeded')
        self.assertFalse(mq.read(self.app,'501')['callbackSent'])
        again=self.personal(service,'next',{})['job'];self.personal(service,'execute',again)
        self.assertEqual(len(calls),1);self.assertEqual(len(returns),2)
        messages.append(duplicate)
        self.assertIsNone(self.personal(service,'next',{})['job'])
        self.assertEqual(len(calls),1)

    def test_interrupted_job_is_reported_failed_without_automatically_regenerating(self):
        service,origin,calls,returns,messages,gets=self.configure()
        self.personal(service,'next',{})
        record=mq.read(self.app,'501');record['status']='running';mq.put(self.app,record)
        job=self.personal(service,'next',{})['job'];self.personal(service,'execute',job)
        self.assertEqual(calls,[]);self.assertEqual(returns[0]['IsSuccess'],'false')
        self.assertEqual(mq.read(self.app,'501')['status'],'failed')

    def test_missing_configuration_and_foreign_worker_fail_without_model_execution(self):
        service,origin,calls,returns,messages,gets=self.configure()
        job=self.personal(service,'next',{})['job']
        jobs.save_config(self.app,{'configId':'101','generation':None})
        self.personal(service,'execute',job)
        self.assertFalse(calls);self.assertEqual(returns[0]['IsSuccess'],'false')
        with self.assertRaises(ApiError):mq.generation_input(self.app,{**mq.read(self.app,'501'),'serverId':'wrong'})
        with self.assertRaises(HTTPError):
            urlopen(Request(self.url+'/api/code-servers/me/mq/next',data=b'{}',headers={'Content-Type':'application/json'}))

    def test_only_code_config_identity_and_correct_dispatch_config_are_accepted(self):
        binding={'configId':'201001'}
        message={'Task':{'TaskID':'123','ConfigId':'201001','StepConfigId':'1401081','Param':json.dumps({'taskKind':'CODE_CONFIG'})}}
        self.assertEqual(mq.normalize(message,binding)[1],'1401081')
        for change in ({'ConfigId':'90'},{'StepConfigId':''},{'Param':'{}'},{'TaskID':'../escape'}):
            with self.subTest(change=change),self.assertRaises(ApiError):mq.normalize({'Task':{**message['Task'],**change}},binding)

    def test_bind_existing_catalog_refuses_unknown_type_and_queue_changes_during_job(self):
        service,origin,calls,returns,messages,gets=self.configure()
        route='/api/runner-management/code-servers/'+service.identity['serverId']+'/mq-binding'
        with self.assertRaises(HTTPError):self.request(route,{'configId':'90'})
        self.personal(service,'next',{})
        with self.assertRaises(HTTPError) as caught:self.request(route,{'configId':''})
        self.assertEqual(caught.exception.code,409)

    def test_existing_queue_name_contract_preserves_unicode_names(self):
        service,origin,calls,returns,messages,gets=self.configure()
        with patch.object(mq,'fetch_json',return_value={'data':[{'configId':'201001','name':'生成','topic':'网页代码生成'}]}):
            binding=mq.save_binding(self.app,service.identity['serverId'],{'configId':'201001'},{})
        self.assertEqual(binding['queue'],'网页代码生成')
