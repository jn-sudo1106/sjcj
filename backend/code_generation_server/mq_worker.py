"""Poll database tasks through the platform API (filename kept for package compatibility)."""
import json
import time
from urllib.request import Request


def run(service):
    while not service.stop.is_set():
        try:
            with service.request_lock:
                ready=bool(service.identity) and not service.draining
            if not ready:
                service.stop.wait(2);continue
            claim=service.platform_request('/api/code-servers/me/tasks/next',{},service.identity['token'])
            job=claim.get('job')
            if not job:
                service.stop.wait(2);continue
            task_id=job['taskId']
            with service.request_lock:
                if service.draining:continue
                service.active_requests+=1;service.mq_task_active=True
            try:
                service.logger.info('代码生成任务开始 TaskID=%s',task_id)
                payload=json.dumps({'taskId':task_id}).encode()
                request=Request(service.config['platform'].rstrip('/')+'/api/code-servers/me/tasks/execute',data=payload,
                    headers={'Content-Type':'application/json','Authorization':'Bearer '+service.identity['token'],
                             'X-Code-Server-ID':service.identity['serverId']})
                # Execution is tracked by the platform. A lost HTTP connection
                # retries the receipt rather than repeating model/Git work.
                from urllib.request import build_opener,ProxyHandler
                with build_opener(ProxyHandler({})).open(request,timeout=3600) as response:
                    for line in response:
                        if not line.strip():continue
                        event=json.loads(line)
                        if event['type']=='request':
                            req=event['request']
                            service.logger.info('TaskID=%s 模型请求 %s %s\n%s',task_id,req['method'],req['url'],json.dumps(req.get('body'),ensure_ascii=False,indent=2))
                        elif event['type']=='chunk':service.logger.info('TaskID=%s %s',task_id,event.get('text','').rstrip())
                        elif event['type']=='done':service.logger.info('代码生成任务结束 TaskID=%s status=%s %s',task_id,event.get('status'),event.get('message',''))
                        else:service.logger.info('TaskID=%s %s',task_id,event.get('message',''))
            finally:
                with service.request_lock:
                    service.active_requests-=1;service.mq_task_active=False;service.last_activity=time.monotonic()
        except Exception as error:
            # Never print platform credentials or connection URLs.
            detail=''
            if hasattr(error,'read'):
                try:detail=str(json.loads(error.read(4096)).get('message',''))[:500]
                except (ValueError,AttributeError):pass
            service.logger.error('任务领取或执行失败：%s%s %s',type(error).__name__,f' HTTP {error.code}' if hasattr(error,'code') else '',detail)
            service.stop.wait(5)
