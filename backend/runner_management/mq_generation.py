"""Consume the existing CODE_CONFIG/201 contract through the business MQ gateway."""
import hashlib
import json
import os
import re
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener
from .business_node_types import NoRedirect
from .directory_layout import store_layout

PREFIX = 'mq-code-job:'
LOCK = threading.RLock()
ACTIVE = set()


def business_base():
    from .server import ApiError
    from .code_servers import endpoint
    value = os.getenv('RUNNER_NODE_TYPE_BACKEND', '').strip()
    if not value:
        raise ApiError('尚未配置现有业务后台地址',503)
    return endpoint(value).rstrip('/')


def fetch_json(path, body=None, headers=None, query=None):
    from .server import ApiError
    url = business_base()+path+('?' + urlencode(query) if query else '')
    forwarded = {'Accept':'application/json'}
    if path.startswith('/rest/'):
        app_id=os.getenv('RUNNER_BUSINESS_APP_ID','')
        app_key=os.getenv('RUNNER_BUSINESS_APP_KEY','')
        if not app_id or not app_key:raise ApiError('尚未接入现有业务 API 应用凭据，请在管理服务部署配置中复用现有取数 API 配置',503)
        forwarded.update(app=app_id,sign=app_key)
    for key in ('Cookie','Access-Token'):
        value=(headers or {}).get(key)
        if value: forwarded[key]=value
    if body is not None:forwarded['Content-Type']='application/json'
    request=Request(url,data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None,headers=forwarded,
                    method='POST' if body is not None else 'GET')
    try:
        with build_opener(NoRedirect()).open(request,timeout=15) as response: raw=response.read(2*1024*1024+1)
        if len(raw)>2*1024*1024:raise ValueError()
        data=json.loads(raw)
        if isinstance(data,dict) and (data.get('success') is False or data.get('code') not in (None,'',0,'0')):
            raise ApiError('业务后台拒绝 MQ 请求：'+str(data.get('msg') or data.get('message') or '请检查现有 API 凭据')[:300],502)
        return data
    except ApiError:raise
    except Exception as error:
        status=getattr(error,'code',None)
        if status in (301,302,401,403):raise ApiError('业务后台拒绝 MQ 请求，请检查现有接口访问配置',401) from error
        raise ApiError('业务后台 MQ 接口请求失败',502) from error


def save_binding(app,server_id,body,headers):
    with LOCK:
        return _save_binding(app,server_id,body,headers)


def _save_binding(app,server_id,body,headers):
    from .server import ApiError
    from . import code_servers
    config_id=str(body.get('configId') or '')
    with code_servers.LOCK:
        row=code_servers.read(app,server_id)
        old=row.get('mqGeneration')
    # Never silently abandon a consumed job when changing a worker's queue.
    if any(r['status'] in ('queued','running') or not r.get('callbackSent') for r in records(app,server_id)):
        raise ApiError('该实例还有未完成或待回执的代码生成任务，请完成后再修改派发配置',409)
    binding=None
    if config_id:
        response=fetch_json('/api/v1/source/codeConfigOptions',headers=headers)
        options=response.get('data') if isinstance(response,dict) else response
        if not isinstance(options,list):raise ApiError('代码生成派发配置查询失败',502)
        option=next((o for o in options if str(o.get('configId'))==config_id),None)
        if not option:raise ApiError('请选择现有启用的 201 类型派发配置',409)
        queue=str(option.get('topic') or '').strip()
        if not queue or len(queue.encode('utf8'))>255 or any(char in queue for char in (',','，')) or any(ord(char)<32 for char in queue):
            raise ApiError('所选派发配置没有有效的单个 TOPIC 队列')
        binding={'configId':config_id,'queue':queue,'name':option.get('name') or config_id}
    with code_servers.LOCK:
        row=code_servers.read(app,server_id)
        if row.get('mqGeneration')!=old:raise ApiError('消费配置已变化，请刷新后重试',409)
        if binding and any(other['serverId']!=server_id and (other.get('mqGeneration') or {}).get('queue')==binding['queue'] for other in code_servers.listing(app)['items']):
            raise ApiError('此队列已绑定其他代码生成服务器，请选择该机器的专用派发配置',409)
        row['mqGeneration']=binding
        with app.store.connect() as db:code_servers.write(db,row)
    return binding


def key(task_id):return PREFIX+hashlib.sha256(task_id.encode()).hexdigest()


def records(app,server_id):
    with app.store.connect() as db:
        index=db.execute('SELECT setting_value FROM settings WHERE setting_key=?',('mq-code-pending:'+server_id,)).fetchone()
        ids=json.loads(index['setting_value']) if index else []
        rows=[db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(key(task_id),)).fetchone() for task_id in ids]
    return [json.loads(row['setting_value']) for row in rows if row]


def put(app,record):
    with LOCK,app.store.connect() as db:
        previous=db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(key(record['taskId']),)).fetchone()
        old_server=json.loads(previous['setting_value']).get('serverId','') if previous else record['serverId']
        if old_server!=record['serverId']:
            old_index='mq-code-pending:'+old_server
            old=db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(old_index,)).fetchone()
            store_layout(db,old_index,[value for value in (json.loads(old['setting_value']) if old else []) if value!=record['taskId']])
        store_layout(db,key(record['taskId']),record)
        index_key='mq-code-pending:'+record['serverId']
        existing=db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(index_key,)).fetchone()
        ids=json.loads(existing['setting_value']) if existing else []
        pending=record['status'] in ('queued','running') or not record.get('callbackSent')
        ids=[task_id for task_id in ids if task_id!=record['taskId']]
        if pending:ids.append(record['taskId'])
        store_layout(db,index_key,ids)


def read(app,task_id):
    from .server import ApiError
    with app.store.connect() as db:row=db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(key(task_id),)).fetchone()
    if not row:raise ApiError('MQ 代码生成任务不存在',404)
    return json.loads(row['setting_value'])


def summaries(app, task_ids):
    """Read execution states for one business task page without returning model output."""
    from .server import ApiError
    if not 1 <= len(task_ids) <= 100 or any(not re.fullmatch(r'[A-Za-z0-9{}_-]{1,100}', value) for value in task_ids):
        raise ApiError('请提供 1 至 100 个有效 TaskID')
    keys = list(dict.fromkeys(key(value) for value in task_ids))
    with app.store.connect() as db:
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key IN (' + ','.join('?' for _ in keys) + ')', keys).fetchall()
    fields = ('taskId', 'serverId', 'configId', 'queue', 'status', 'callbackSent', 'message')
    return {'items': [{**{field: record.get(field) for field in fields},
                       **({'modelCall': record['modelCall']} if record.get('modelCall') else {})}
                      for record in (json.loads(row['setting_value']) for row in rows)]}


def normalize(message,binding):
    from .server import ApiError
    task=message.get('Task') if isinstance(message,dict) else None
    if not isinstance(task,dict):raise ApiError('MQ 消息缺少 Task')
    task_id=str(task.get('TaskID') or '')
    if not re.fullmatch(r'[A-Za-z0-9{}_-]{1,100}',task_id):raise ApiError('MQ TaskID 无效')
    params=task.get('Param') or {}
    if isinstance(params,str):
        try:params=json.loads(params)
        except ValueError:raise ApiError('代码生成任务 Param 不是有效 JSON')
    if not isinstance(params,dict) or params.get('taskKind')!='CODE_CONFIG':raise ApiError('此消费者只接受 CODE_CONFIG 任务')
    if str(task.get('ConfigId'))!=binding['configId']:raise ApiError('MQ 任务派发配置与绑定的 201 配置不一致')
    owner=str(task.get('StepConfigId') or params.get('stepConfigId') or '')
    if not re.fullmatch(r'[1-9][0-9]*',owner):raise ApiError('MQ 任务缺少有效 StepConfigId')
    return task_id,owner,task,params


def model_call_info(app, record, selected=None):
    """Capture resolved interface identity without credentials or sending a model request."""
    from .generation_tasks import read_config
    from .model_interfaces import listing
    from .code_servers import registry
    from .server import now
    if selected is None:
        source = read_config(app, record['configId']).get('generation') or {}
        orchestration = record['params'].get('orchestration') or {}
        override = orchestration.get('aiGeneration') if isinstance(orchestration, dict) else None
        interface_id = override.get('interfaceId', source.get('interfaceId')) if isinstance(override, dict) else source.get('interfaceId')
        selected = next((item for item in listing(app)['items'] if item['id'] == interface_id), None)
    if not selected: return None
    address = urlsplit(selected['endpoint'])
    endpoint = address.scheme + '://' + address.netloc.rsplit('@', 1)[-1] + address.path
    server = next((item for item in registry(app) if item['serverId'] == selected.get('generationServerId')), {})
    return {'interfaceId': selected['id'], 'name': selected['name'], 'kind': selected['kind'], 'model': selected['model'],
            'endpoint': endpoint, 'method': 'GET' if selected['kind'] == 'chat' else 'POST',
            'timeoutSeconds': selected['timeoutSeconds'], 'serverId': selected.get('generationServerId', ''),
            'serverName': server.get('name', ''), 'serverAddress': server.get('ipAddress', ''), 'capturedAt': now()}


def target_server(app, record):
    """An absent/offline model machine delays execution; the ingress queue has no affinity."""
    from .generation_tasks import read_config
    from .model_interfaces import listing
    from . import code_servers
    source=read_config(app,record['configId']).get('generation') or {}
    snapshot=record['params'].get('orchestration') or {}
    override=snapshot.get('aiGeneration') if isinstance(snapshot,dict) else None
    interface_id=override.get('interfaceId',source.get('interfaceId')) if isinstance(override,dict) else source.get('interfaceId')
    # Invalid/missing generation settings retain the existing explicit failure contract.
    if not interface_id:return None,''
    selected=next((item for item in listing(app)['items'] if item['id']==interface_id and item['enabled']),None)
    if not selected:return '','等待所选模型启用或恢复配置'
    server_id=selected.get('generationServerId') or ''
    machine=next((row for row in code_servers.registry(app) if row['serverId']==server_id),None)
    if not machine:return '','等待匹配所选模型的代码生成服务器上线'
    if machine['status']!='online':return '','等待所选模型的代码生成服务器恢复在线'
    if not machine.get('mqCapable'):return '','等待所选模型的代码生成服务器升级以支持任务消费'
    return server_id,''


def park(app,record,message):
    record.update(serverId='',message=message or '等待所选模型的代码生成服务器领取任务')
    put(app,record)


def claim(app,server):
    from .server import now
    binding=server.get('mqGeneration')
    with LOCK:
        for record in sorted(records(app,''),key=lambda r:r['createdAt']):
            if record.get('deletedAt'):
                record['serverId'] = server['serverId']; put(app, record)
                return {'job': {'taskId': record['taskId']}, 'binding': binding}
            target,message=target_server(app,record)
            if target==server['serverId']:
                record.update(serverId=server['serverId'],message='已匹配生成机器，等待执行');put(app,record)
                return {'job':{'taskId':record['taskId']},'binding':binding}
            if message and record.get('message')!=message:record['message']=message;put(app,record)
        for record in sorted(records(app,server['serverId']),key=lambda r:r['createdAt']):
            if record['status']=='running' and record['taskId'] not in ACTIVE:
                record.update(status='failed',message='生成服务中断，结果待核对；请检查仓库后重新派发新的生成任务',finishedAt=now());put(app,record)
            if record['status']=='queued':
                target,message=target_server(app,record)
                if target is not None and target!=server['serverId']:
                    park(app,record,message);continue
            if record['status']=='queued' or (record['status']!='running' and not record.get('callbackSent')):
                return {'job':{'taskId':record['taskId']},'binding':binding}
        if not binding:return {'job':None,'binding':None}
        # The existing gateway receives from RabbitMQ; it requires no AMQP address on this service.
        message=fetch_json('/rest/api/v1/rmq/basic-get',{},query={'queue':binding['queue'],'client':'CodeServer-'+server['serverId']})
        if message in (-1,'-1',None):return {'job':None,'binding':binding}
        try:task_id,owner,task,params=normalize(message,binding)
        except Exception as error:
            # The legacy basic-get gateway acknowledges on receive. Retain an
            # unexpected envelope for diagnosis instead of silently discarding it.
            rejected={'serverId':server['serverId'],'queue':binding['queue'],'receivedAt':now(),'message':message,'error':str(error)}
            digest=hashlib.sha256(json.dumps(rejected,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            with app.store.connect() as db:store_layout(db,'mq-code-rejected:'+digest,rejected)
            from .server import ApiError
            raise ApiError('队列消息不符合 CODE_CONFIG 契约，已保留原消息供核对，未执行模型',409) from error
        try:old=read(app,task_id)
        except Exception as error:
            if getattr(error,'status',None)!=404:raise
            old=None
        if old:
            from .mq_task_management import marker, apply_deleted
            deleted = marker(app, task_id)
            if deleted and old['status'] != 'running':
                apply_deleted(old, deleted)
                if not old.get('callbackSent'): old['serverId'] = server['serverId']
                put(app, old)
                return {'job': {'taskId': task_id} if not old.get('callbackSent') else None, 'binding': binding}
            if old['serverId']!=server['serverId']:return {'job':None,'binding':binding}
            return {'job':{'taskId':task_id} if not old.get('callbackSent') else None,'binding':binding}
        record={'taskId':task_id,'serverId':server['serverId'],'queue':binding['queue'],'configId':owner,
                'task':task,'params':params,'status':'queued','createdAt':now(),'finishedAt':'','message':'',
                'callbackSent':False,'stages':[],'output':'','result':None}
        put(app,record)
        from .mq_task_management import marker, apply_deleted
        deleted = marker(app, task_id)
        if deleted:
            apply_deleted(record, deleted); put(app, record)
            return {'job': {'taskId': task_id}, 'binding': binding}
        info = model_call_info(app, record)
        if info:
            record['modelCall'] = info
            put(app, record)
        target,message=target_server(app,record)
        if target is not None and target!=server['serverId']:
            park(app,record,message)
            return {'job':None,'binding':binding}
        return {'job':{'taskId':task_id},'binding':binding}


def generation_input(app,record):
    from .server import ApiError
    from .generation_tasks import read_config
    from .model_interfaces import listing
    source=read_config(app,record['configId']).get('generation')
    if not source:raise ApiError('目标步骤尚未保存 AI 生成配置，请先在编排配置中选择模型、仓库并填写提示词',409)
    data=dict(source)
    snapshot=record['params'].get('orchestration') or {}
    override=snapshot.get('aiGeneration') if isinstance(snapshot,dict) else None
    if isinstance(override,dict):
        for field in ('interfaceId','repositoryId','directoryId','destinationMode','systemPrompt','userPrompt','workspaceMode','workspacePath','codeDirectory','fileName'):
            if field in override:data[field]=override[field]
    selected=next((i for i in listing(app)['items'] if i['id']==data.get('interfaceId') and i['enabled']),None)
    if not selected or selected.get('generationServerId')!=record['serverId']:
        raise ApiError('目标节点选择的模型未绑定当前代码生成服务器',409)
    record['modelCall'] = model_call_info(app, record, selected)
    url=str(record['task'].get('Url') or '')
    if source.get('url') and source['url']!=url:
        for field in ('userPrompt','systemPrompt'):data[field]=data.get(field,'').replace(source['url'],url)
    for field in ('userPrompt','systemPrompt'):
        for name,value in {'url':url,'sourceUrl':url,'sourceId':str(record['task'].get('SourceId') or record['params'].get('sourceId') or ''),
                           'configId':record['configId'],'taskId':record['taskId']}.items():
            data[field]=data.get(field,'').replace('{{'+name+'}}',value).replace('${'+name+'}',value)
    record_id=record['taskId'] if re.fullmatch(r'[A-Za-z0-9_-]{1,100}',record['taskId']) else hashlib.sha256(record['taskId'].encode()).hexdigest()
    data.update(configId=record['configId'],url=url,taskId=record_id,
                sampleId='www.realcan.cn.py',autoCommit=True,deferCommit=False,prompt=data.get('userPrompt',''))
    return data


def callback(app,record):
    from .server import ApiError
    result=fetch_json('/rest/api/v1/rmq/basic-ret',{'IsSuccess':'true' if record['status']=='succeeded' else 'false',
        'StrTaskId':record['taskId'],'ErrorMessage':record['message'],'Mark':'代码生成'})
    if result!=1:raise ApiError('代码生成已结束，但任务回执发送失败，将重试回执',502)
    record['callbackSent']=True;put(app,record)


def execute(handler,app,server,task_id):
    from .server import ApiError,RESPONSE_SENT,now
    from .model_interfaces import generate
    with LOCK:
        record=read(app,task_id)
        if record['serverId']!=server['serverId']:raise ApiError('无权执行其他服务器的任务',403)
        if task_id in ACTIVE:raise ApiError('任务正在执行',409)
        if record['status']=='running':raise ApiError('任务结果待核对，不能自动重复执行',409)
        run=record['status']=='queued'
        if run:
            target,message=target_server(app,record)
            if target is not None and target!=server['serverId']:
                park(app,record,message)
                return {'type':'done','status':'queued','message':record['message'],'result':None}
        if run:record.update(status='running');put(app,record)
        ACTIVE.add(task_id)
    connected=True
    try:
        handler.send_response(200);handler.send_header('Content-Type','application/x-ndjson; charset=utf-8')
        handler.send_header('Connection','close');handler.send_header('X-Accel-Buffering','no');handler.end_headers()
    except OSError:connected=False
    handler.close_connection=True
    last_saved=0
    def emit(kind,**fields):
        nonlocal connected,last_saved
        if kind=='chunk':record['output']=(record['output']+fields.get('text',''))[-262144:]
        elif kind=='request':record['request']=fields['request']
        elif kind=='progress':record['stages']=(record['stages']+[fields.get('message','')])[-40:]
        if time.monotonic()-last_saved>=0.5 or kind=='request':
            put(app,record);last_saved=time.monotonic()
        if not connected:return
        try:handler.wfile.write((json.dumps({'type':kind,**fields},ensure_ascii=False)+'\n').encode());handler.wfile.flush()
        except OSError:connected=False
    try:
        if run:
            try:
                generation = generation_input(app, record)
                put(app, record)  # Keep model identity even if workspace preparation fails.
                result=generate(app,generation,emit)
                archive=result.get('archive') or {}
                record.update(result=result,status='failed' if archive.get('status')=='failed' else 'succeeded',
                              message=archive.get('message') or '代码已生成并提交 Git',finishedAt=now())
            except Exception as error:
                record.update(status='failed',message=str(error)[:1500],finishedAt=now());emit('error',message=record['message'])
            put(app,record)
        if not record['callbackSent']:callback(app,record)
        emit('done',status=record['status'],message=record['message'],result=record['result'])
    except Exception as error:emit('error',message=str(error))
    finally:
        with LOCK:ACTIVE.discard(task_id)
    return RESPONSE_SENT


def personal(handler,app,method,path,body,server):
    from .server import ApiError
    if method=='POST' and path.endswith('/next'):return claim(app,server)
    if method=='POST' and path.endswith('/execute'):
        task_id=body.get('taskId')
        if not isinstance(task_id,str) or not re.fullmatch(r'[A-Za-z0-9{}_-]{1,100}',task_id):raise ApiError('TaskID 无效')
        return execute(handler,app,server,task_id)
    raise ApiError('接口不存在',404)
