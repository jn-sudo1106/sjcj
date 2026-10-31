"""Platform-owned, persistent source code-generation jobs.

The browser submits a snapshot of the published flow topology, using its existing
flow routing. CodeServer claims persisted tasks through the platform API.
"""
import copy
import hashlib
import json
import re
import threading
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
    record = json.loads(row['setting_value']) if row else {'configId': owner, 'enabled': False, 'generation': None}
    generation = record.get('generation')
    if generation:
        from .generation_workspaces import node_defaults
        record['generation'] = node_defaults(generation)
    return record


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
                from .generation_workspaces import node_defaults
                data = node_defaults(data)
                from .generation_destinations import mode
                data['destinationMode'] = mode(incoming)
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
                from .generation_workspaces import directory
                directory({**data, 'configId': owner})
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
    from .database_generation import read
    with app.store.connect() as db:
        rows = db.execute("SELECT task_id FROM generation_jobs WHERE status<>'deleted'").fetchall()
    return [read(app, row['task_id']) for row in rows]


def public(record):
    from .database_generation import public as view
    result = view(record)
    archive = (record.get('result') or {}).get('archive') or {}
    result.update(archiveId=archive.get('archiveId', record.get('archiveId', '')),
                  gitCommit=archive.get('gitCommit', record.get('gitCommit', '')))
    return result


def listing(app):
    return [public(row) for row in sorted(records(app), key=lambda row: row['createdAt'], reverse=True)[:200]]


def put(app, record):
    from .database_generation import put as persist
    persist(app, record)


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
                from .database_generation import create, read
                if not node.get('stepId'):
                    skipped.append({'sourceId': source_id, 'name': name, 'reason': f'配置 {owner} 缺少流程步骤 ID，请刷新流程后重试'})
                    continue
                try:
                    receipt = create(app, {'sourceId': source_id, 'sourceName': name, 'flowId': flow_id,
                                          'configId': owner, 'stepId': node['stepId'], 'nodeName': node.get('name', owner),
                                          'generation': {key: value for key, value in data.items() if isinstance(value, str)}})
                except ApiError as error:
                    skipped.append({'sourceId': source_id, 'name': name, 'reason': f'配置 {owner}：{error}'})
                    continue
                record = read(app, receipt['job']['taskId'])
                active.add(identity)
                created.append(public(record))
            if not count:
                skipped.append({'sourceId': source_id, 'name': name, 'reason': '没有保存 AI 生成配置的启用节点'})
    return {'created': created, 'skipped': skipped}


def ensure_worker(app):
    """Retained for source compatibility; CodeServer now claims tasks by API."""
    return


def recover(app):
    from .database_generation import recover as recover_database
    recover_database(app)
