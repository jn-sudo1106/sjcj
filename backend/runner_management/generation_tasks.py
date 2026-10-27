"""Platform-owned, persistent source code-generation jobs.

The browser submits a snapshot of the published flow topology, using its existing
flow routing. Model requests run here, never in the remote code file service.
"""
import copy
import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

LOCK = threading.RLock()
CONFIG_PREFIX = 'node-ai-generation:'
TASK_PREFIX = 'source-code-task:'


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def key(owner):
    from .generated_archives import config_id
    return CONFIG_PREFIX + hashlib.sha256(config_id(owner).encode()).hexdigest()


def read_config(app, owner):
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (key(owner),)).fetchone()
    return json.loads(row['setting_value']) if row else {'configId': owner, 'enabled': False, 'generation': None}


def save_config(app, body):
    from .server import ApiError
    from .directory_layout import store_layout
    owner = body.get('configId')
    record_key = key(owner)
    with LOCK:
        record = read_config(app, owner)
        if 'enabled' in body:
            if type(body['enabled']) is not bool:
                raise ApiError('是否启用代码生成须为布尔值')
            record['enabled'] = body['enabled']
        if 'generation' in body:
            incoming = body['generation']
            if incoming is None:
                record['generation'] = None
            else:
                if not isinstance(incoming, dict):
                    raise ApiError('AI 生成配置无效')
                fields = ('interfaceId', 'repositoryId', 'directoryId', 'configType', 'queueName',
                          'systemPrompt', 'userPrompt', 'url', 'fileNameMode')
                data = {name: incoming.get(name, '') for name in fields}
                if any(not isinstance(value, str) for value in data.values()):
                    raise ApiError('AI 生成配置字段无效')
                if not data['interfaceId'] or not data['userPrompt'].strip() or not data['systemPrompt'].strip():
                    raise ApiError('请选择模型并填写系统、用户提示词')
                if any(len(data[name]) > 12000 for name in ('systemPrompt', 'userPrompt')):
                    raise ApiError('每份提示词不能超过 12000 字')
                if any(len(data[name]) > 2000 for name in fields if 'Prompt' not in name):
                    raise ApiError('AI 生成配置字段过长')
                if data['fileNameMode'] not in ('website', 'queue'):
                    raise ApiError('文件命名方式无效')
                from .generated_archives import destination
                destination(app, {**data, 'configId': owner})
                from .model_interfaces import listing
                if not any(row['id'] == data['interfaceId'] and row['enabled'] for row in listing(app)['items']):
                    raise ApiError('所选模型接口不存在或已停用')
                record['generation'] = data
        record['updatedAt'] = stamp()
        with app.store.connect() as db:
            store_layout(db, record_key, record)
    return record


def records(app):
    with app.store.connect() as db:
        rows = db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (TASK_PREFIX + '%',)).fetchall()
    return [json.loads(row['setting_value']) for row in rows]


def public(record):
    return {name: value for name, value in record.items() if name != 'input'}


def listing(app):
    return [public(row) for row in sorted(records(app), key=lambda row: row['createdAt'], reverse=True)[:200]]


def put(app, record):
    from .directory_layout import store_layout
    with app.store.connect() as db:
        store_layout(db, TASK_PREFIX + record['taskId'], record)


def submit(app, body):
    from .server import ApiError
    sources = body.get('sources')
    if not isinstance(sources, list) or not 1 <= len(sources) <= 200:
        raise ApiError('请选择 1–200 个源')
    from .generated_archives import config_id
    # Validate the entire snapshot before persisting any task.
    for source in sources:
        if not isinstance(source, dict) or not str(source.get('sourceId', '')).isdigit() or not str(source.get('flowId', '')).isdigit():
            raise ApiError('源 ID 或流程 ID 无效')
        nodes = source.get('nodes', [])
        if not isinstance(nodes, list) or len(nodes) > 500 or any(not isinstance(node, dict) for node in nodes):
            raise ApiError('流程节点快照无效')
        for node in nodes:
            if node.get('configId'):
                config_id(node['configId'])
    created, skipped = [], []
    with LOCK:
        active = {(row['sourceId'], row['flowId'], row['configId']) for row in records(app)
                  if row['status'] in ('queued', 'running')}
        for source in sources:
            if not isinstance(source, dict):
                raise ApiError('源配置快照无效')
            source_id, flow_id = str(source.get('sourceId', '')), str(source.get('flowId', ''))
            if not source_id.isdigit() or not flow_id.isdigit():
                raise ApiError('源 ID 或流程 ID 无效')
            name = str(source.get('name', source_id))[:200]
            nodes = source.get('nodes', [])
            if not isinstance(nodes, list) or len(nodes) > 500 or any(not isinstance(node, dict) for node in nodes):
                raise ApiError('流程节点快照无效')
            roots = [node for node in nodes if node.get('isRoot') is True]
            if len(roots) != 1 or not roots[0].get('configId'):
                skipped.append({'sourceId': source_id, 'name': name, 'reason': '流程缺少唯一的首个配置节点'})
                continue
            if not read_config(app, roots[0]['configId'])['enabled']:
                skipped.append({'sourceId': source_id, 'name': name, 'reason': '首个配置节点未启用代码生成'})
                continue
            count = 0
            for node in nodes:
                owner = node.get('configId')
                if not owner or node.get('enabled') is False:
                    continue
                saved = read_config(app, owner)['generation']
                if not saved:
                    continue
                count += 1
                identity = (source_id, flow_id, owner)
                if identity in active:
                    skipped.append({'sourceId': source_id, 'name': name, 'reason': f'配置 {owner} 已有待处理任务'})
                    continue
                url = str(source.get('url', '')).strip()
                try:
                    parsed = urlsplit(url)
                    host = parsed.hostname if parsed.scheme in ('http', 'https') and not parsed.username and not parsed.password else None
                except ValueError:
                    host = None
                if not host:
                    skipped.append({'sourceId': source_id, 'name': name, 'reason': '源 URL 无效'})
                    continue
                data = copy.deepcopy(saved)
                from .generated_archives import state
                data.update(configId=owner, url=url, sampleId='www.realcan.cn.py', autoCommit=state(app, owner)['autoCommit'], deferCommit=False)
                for field in ('systemPrompt', 'userPrompt'):
                    # Templates may use source variables; existing concrete source URL is also rebound.
                    if saved.get('url') and saved['url'] != url:
                        data[field] = data[field].replace(saved['url'], url)
                    for variable, value in {'sourceUrl': url, 'url': url, 'sourceId': source_id, 'sourceName': name, 'configId': owner}.items():
                        data[field] = data[field].replace('{{' + variable + '}}', value).replace('${' + variable + '}', value)
                data['prompt'] = data['userPrompt']
                data['fileName'] = (data['queueName'] if data['fileNameMode'] == 'queue' else host) + '.py'
                if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*\.py', data['fileName']):
                    skipped.append({'sourceId': source_id, 'name': name, 'reason': '文件命名所需的队列或域名无效'})
                    continue
                task_id = uuid.uuid4().hex
                data['taskId'] = task_id
                record = {'taskId': task_id, 'sourceId': source_id, 'sourceName': name, 'flowId': flow_id,
                          'configId': owner, 'nodeName': str(node.get('name', owner))[:200],
                          'status': 'queued', 'createdAt': stamp(), 'startedAt': '', 'finishedAt': '',
                          'message': '', 'archiveId': '', 'gitCommit': '', 'input': data}
                put(app, record)
                active.add(identity)
                created.append(public(record))
            if not count:
                skipped.append({'sourceId': source_id, 'name': name, 'reason': '没有保存 AI 生成配置的启用节点'})
    ensure_worker(app)
    return {'created': created, 'skipped': skipped}


def run_one(app, record):
    record.update(status='running', startedAt=stamp())
    put(app, record)
    try:
        from .model_interfaces import generate
        data = record['input']
        result = generate(app, data)
        archive = result.get('archive')
        if archive:
            record.update(archiveId=archive['archiveId'], gitCommit=archive.get('gitCommit', ''))
            if archive['status'] == 'failed':
                raise RuntimeError(archive.get('message') or '生成文件归档失败')
            record['message'] = '已生成并提交 Git' if archive['status'] == 'committed' else '已生成，等待手工提交 Git'
        else:
            published = app.publish_site_code({**data, 'code': result['code'], 'codeType': 'site'})
            record.update(gitCommit=published.get('gitCommit', ''), message='已生成并保存到代码仓库')
        record['status'] = 'succeeded'
    except Exception as exc:
        record.update(status='failed', message=str(exc)[:1500])
    record['finishedAt'] = stamp()
    put(app, record)


def ensure_worker(app):
    with LOCK:
        if getattr(app, '_generation_worker', None) and app._generation_worker.is_alive():
            return
        def work():
            while True:
                with LOCK:
                    queued = sorted((row for row in records(app) if row['status'] == 'queued'), key=lambda row: row['createdAt'])
                    if not queued:
                        app._generation_worker = None
                        return
                    row = queued[0]
                run_one(app, row)
        app._generation_worker = threading.Thread(target=work, name='source-code-generation', daemon=True)
        app._generation_worker.start()


def recover(app):
    # Never repeat a possibly completed model/Git call after an unclean restart.
    with LOCK:
        for record in records(app):
            if record['status'] == 'running':
                record.update(status='failed', finishedAt=stamp(), message='管理服务重启，生成结果待核对；请检查仓库后重新创建任务')
                put(app, record)
    ensure_worker(app)
