"""CodeServer release/upgrade control using the existing Runner artifact store."""
import ast
import hashlib
import hmac
import json
from pathlib import Path
import re
import uuid

from . import code_servers
from .directory_layout import store_layout

PREFIX = 'code-server-upgrade:'


def releases(app):
    with app.store.connect() as db:
        rows = db.execute("SELECT digest,name,published_at FROM releases WHERE kind='code-server' AND status='published' ORDER BY published_at DESC").fetchall()
    return [{'digest': row['digest'], 'version': row['name'], 'publishedAt': row['published_at']} for row in rows]


def publish(app):
    from .server import now
    source = Path(__file__).resolve().parents[1] / 'code_generation_server'
    text = (source / 'service.py').read_text(encoding='utf8')
    version = next(ast.literal_eval(node.value) for node in ast.parse(text).body
                   if isinstance(node, ast.Assign) and any(isinstance(name, ast.Name) and name.id=='VERSION' for name in node.targets))
    files = {'code_generation_server/service.py': (source / 'service.py').read_bytes(), 'code_generation_server/__init__.py': b''}
    files['code_generation_server/mq_worker.py']=(source/'mq_worker.py').read_bytes()
    digest, signature = app.artifacts.publish(files, {'kind': 'code-server', 'entryModule': 'code_generation_server.service', 'version': version})
    with app.store.connect() as db:
        inserted = db.execute('INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)',
                              (digest,'code-server',version,'any','local-source','published',now(),signature,'code_generation_server.service','local-source'))
    return {'digest': digest, 'version': version, 'created': inserted.rowcount > 0}


def read(app, server_id):
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?',(PREFIX+server_id,)).fetchone()
    return json.loads(row['setting_value']) if row else None


def schedule(app, body):
    from .server import ApiError,now
    ids,digest=body.get('serverIds'),body.get('digest')
    if (not isinstance(ids,list) or not 1<=len(ids)<=100 or any(not isinstance(item,str) for item in ids)
            or len(set(ids))!=len(ids) or not isinstance(digest,str) or not re.fullmatch(r'sha256:[a-f0-9]{64}',digest)):
        raise ApiError('请选择实例和有效的 CodeServer 版本')
    with code_servers.LOCK:
        rows=[code_servers.read(app,item) for item in ids]
        if any(not row.get('upgradeCapable') for row in rows):
            raise ApiError('所选实例尚未接入自动升级，请先下载升级接入包替换程序并启动一次',409)
        with app.store.connect() as db:
            if not db.execute("SELECT 1 FROM releases WHERE digest=? AND kind='code-server' AND status='published'",(digest,)).fetchone():
                raise ApiError('CodeServer 发布版本不存在')
            requested=[]
            for row in rows:
                previous=read(app,row['serverId'])
                if previous and previous['status'] in ('pending','waiting','upgrading'):
                    if previous['digest']!=digest:
                        raise ApiError('实例已有升级任务，请等待完成后再切换版本',409)
                    requested.append(previous)
                    continue
                item={'serverId':row['serverId'],'digest':digest,'previousDigest':row.get('actualDigest','source-local'),
                      'requestId':uuid.uuid4().hex,'status':'pending','message':'等待实例检查升级','requestedAt':now(),'updatedAt':now()}
                if row.get('actualDigest')==digest and code_servers.public(row)['status']=='online':
                    item.update(status='succeeded',message='当前实例已运行该版本')
                store_layout(db,PREFIX+row['serverId'],item)
                requested.append(item)
    return {'items':requested}


def authenticate(app, headers):
    from .server import ApiError
    server_id=headers.get('X-Code-Server-ID','')
    if not re.fullmatch(r'[a-f0-9-]{36}',server_id):
        raise ApiError('代码生成服务器实例凭据无效',401)
    row=code_servers.read(app,server_id)
    token=headers.get('Authorization','').removeprefix('Bearer ')
    if not token or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(),row['tokenHash']):
        raise ApiError('代码生成服务器实例凭据无效',401)
    return row


def observe_heartbeat(app, row):
    """A reconnecting instance may already run the requested version."""
    from .server import now
    upgrade=read(app,row['serverId'])
    if (upgrade and upgrade['status'] in ('pending','waiting') and row.get('upgradeCapable')
            and upgrade.get('previousDigest')==upgrade['digest']==row.get('actualDigest')):
        upgrade.update(status='succeeded',message='实例已恢复在线并运行目标版本',updatedAt=now())
        with app.store.connect() as db:
            store_layout(db,PREFIX+row['serverId'],upgrade)


def personal(handler,app,method,path,body):
    from .server import ApiError,RESPONSE_SENT,now
    row=authenticate(app,handler.headers)
    if path.startswith(('/api/code-servers/me/tasks/', '/api/code-servers/me/mq/')):
        # The old route remains an alias so installed workers can switch to
        # database polling immediately, without reading the old Rabbit queue.
        from .database_generation import personal as task_personal
        return task_personal(handler,app,method,path,body,row)
    server_id=row['serverId']
    upgrade=read(app,server_id)
    if method=='GET' and path=='/api/code-servers/me/status':
        return {'status':code_servers.public(row)['status'],'actualDigest':row.get('actualDigest','source-local'),
                'pid':row.get('pid'),'publicKey':app.artifacts.public_key,'upgrade':upgrade}
    if method=='GET' and path=='/api/code-servers/me/desired':
        from .generation_workspaces import server_busy
        active=bool(upgrade and upgrade['status'] not in ('failed','succeeded'))
        busy=server_busy(server_id)
        return {'digest':upgrade['digest'] if active and not busy else None,
                'requestId':upgrade['requestId'] if upgrade else None, 'waiting':active and busy}
    if method=='POST' and path=='/api/code-servers/me/upgrade-result':
        with code_servers.LOCK:
            upgrade=read(app,server_id)
            if not upgrade or body.get('requestId')!=upgrade['requestId']:
                raise ApiError('升级指令已变化，请重新检查',409)
            status=body.get('status')
            if status not in ('waiting','upgrading','succeeded','failed'):
                raise ApiError('升级状态无效')
            if status=='succeeded' and (row.get('actualDigest')!=upgrade['digest'] or code_servers.public(row)['status']!='online'):
                raise ApiError('目标版本尚未通过心跳校验',409)
            message=body.get('message','')
            if not isinstance(message,str) or len(message)>1500:
                raise ApiError('升级状态说明无效')
            upgrade.update(status=status,message=message,updatedAt=now())
            with app.store.connect() as db:
                store_layout(db,PREFIX+server_id,upgrade)
        return {'ok':True}
    artifact=re.fullmatch(r'/api/code-servers/me/artifacts/(sha256:[a-f0-9]{64})',path)
    if method=='GET' and artifact:
        digest=artifact.group(1)
        allowed={row.get('actualDigest')}
        if upgrade:
            allowed.update((upgrade['digest'],upgrade.get('previousDigest')))
        with app.store.connect() as db:
            release=db.execute("SELECT signature FROM releases WHERE digest=? AND kind='code-server' AND status='published'",(digest,)).fetchone()
        if digest not in allowed or not release:
            raise ApiError('无权下载该 CodeServer 制品',403)
        data=app.artifacts.read(digest)
        handler.send_response(200)
        handler.send_header('Content-Type','application/zip')
        handler.send_header('Content-Length',str(len(data)))
        handler.send_header('X-Artifact-Signature',release['signature'])
        handler.send_header('Cache-Control','no-store')
        handler.end_headers();handler.wfile.write(data)
        return RESPONSE_SENT
    raise ApiError('接口不存在',404)
