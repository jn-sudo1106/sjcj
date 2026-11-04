"""Default resources by node type/environment and pinned, pull-based deployments."""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath
from .deployment_mapping import mapping, relative_directory, archive_root

RULE_KEY = 'deployment-resource-rules'
CHOICE_PREFIX = 'node-deployment-resource:'
WAITING = ('waiting_resource', 'queued')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def environment(value):
    from .server import ApiError
    if value not in ('test', 'production'):
        raise ApiError('部署环境只能为测试或生产')
    return value


def supports(rule, env):
    return rule['environment'] in (env, 'both')


def rule_environments(value):
    return ('test', 'production') if value == 'both' else (environment(value),)


def rules(db):
    from .directory_layout import revision
    row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (RULE_KEY,)).fetchone()
    items = json.loads(row['setting_value']) if row else []
    # Existing one-resource rules remain the default without a data rewrite.
    items = [{**{key: item.get(key) for key in ('configType', 'configTypeName', 'environment', 'runnerId', 'enabled')},
              'deploymentDirectory': item.get('deploymentDirectory') or '',
              'entryPoint': item.get('entryPoint') or '',
              'resourceId': item.get('resourceId') or uuid.uuid5(uuid.NAMESPACE_URL,
               'ce:deployment-resource:' + json.dumps([item['configType'], item['environment'], item['runnerId']])).hex,
              'isDefault': item.get('isDefault', True), 'resourceName': item.get('resourceName', '')} for item in items]
    return {'items': items, 'revision': revision({'items': items})}


def entry_names(db, result):
    """Display adopted runtime entries without making them resource defaults."""
    from .deployment_configuration import RUNTIME_PREFIX
    entries = {item['resourceId']: set() for item in result['items']}
    by_id = {item['resourceId']: item for item in result['items']}
    for row in db.execute('SELECT payload FROM deployment_jobs').fetchall():
        job = json.loads(row['payload'])
        rule = by_id.get(job.get('resourceId'))
        if not rule or rule['runnerId'] != job.get('runnerId') or rule['configType'] != job.get('configType') or not supports(rule, job.get('environment')):
            continue
        stored = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (RUNTIME_PREFIX + job.get('runtimeId', ''),)).fetchone()
        runtime = json.loads(stored['setting_value']) if stored else {}
        if runtime.get('deploymentId') == job.get('deploymentId') and runtime.get('executionEntry'):
            entries[rule['resourceId']].add(runtime['executionEntry'])
    return {**result, 'items': [{**item, 'entryPoints': sorted(entries[item['resourceId']])} for item in result['items']]}


def save_rules(app, body, headers=None):
    from .server import ApiError, GIT_LOCK
    from .directory_layout import store_layout
    raw = body.get('items')
    if not isinstance(raw, list) or len(raw) > 500:
        raise ApiError('部署资源配置无效')
    with GIT_LOCK, app.store.connect() as db:
        if body.get('revision') != rules(db)['revision']:
            raise ApiError('默认部署资源已修改，请刷新后再保存', 409)
        items, keys, identifiers, defaults, destinations = [], set(), set(), set(), []
        for item in raw:
            if not isinstance(item, dict): raise ApiError('部署资源配置无效')
            kind = app.valid_config_type(item.get('configType'))
            if not kind: raise ApiError('请选择节点类型')
            env = item.get('environment')
            environments = rule_environments(env)
            runner_id = item.get('runnerId')
            runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (runner_id,)).fetchone() if isinstance(runner_id, str) else None
            if not runner:
                raise ApiError('请选择已登记的 Runner 实例')
            directory = item.get('deploymentDirectory', '')
            from .directory_layout import safe_path
            entry = item.get('entryPoint', '')
            if not isinstance(entry, str):
                raise ApiError('入口文件须为部署目录内的相对 Python 文件路径')
            entry = safe_path(entry.strip().replace('\\', '/')) if entry.strip() else ''
            if entry and not entry.lower().endswith('.py'):
                raise ApiError('入口文件必须是 Python 文件')
            relative = relative_directory(directory, runner)
            normalized = relative.casefold() if PureWindowsPath(runner['install_directory']).drive else relative
            identity = (kind, env, runner_id, normalized)
            if identity in keys: raise ApiError('相同的部署资源映射不能重复添加')
            keys.add(identity)
            resource_id = item.get('resourceId') or uuid.uuid5(uuid.NAMESPACE_URL,
                'ce:deployment-resource:' + json.dumps(list(identity))).hex
            if not isinstance(resource_id, str) or not re.fullmatch(r'[0-9a-f]{32}', resource_id) or resource_id in identifiers:
                raise ApiError('部署资源标识无效或重复')
            identifiers.add(resource_id)
            enabled = item.get('enabled', True)
            if type(enabled) is not bool: raise ApiError('启用状态无效')
            is_default = item.get('isDefault', True)
            if type(is_default) is not bool: raise ApiError('默认资源标记无效')
            resource_name = item.get('resourceName', '')
            if not isinstance(resource_name, str) or len(resource_name) > 100 or any(ord(char) < 32 for char in resource_name):
                raise ApiError('资源名称须为不超过 100 字的单行文本')
            if is_default and enabled:
                for target_env in environments:
                    if (kind, target_env) in defaults: raise ApiError('同一节点类型和环境只能设置一个启用的默认资源')
                    defaults.add((kind, target_env))
            if enabled:
                if any(previous_runner == runner_id and previous_env != env and previous_path == normalized
                       for previous_runner, previous_env, previous_path in destinations):
                    raise ApiError('同一 Runner 的测试与生产环境需要不同部署目录或不同实例')
                destinations.append((runner_id, env, normalized))
            name = app.repository_type_name(db, kind, str(item.get('configTypeName') or kind), headers)
            items.append({'resourceId': resource_id, 'configType': kind, 'configTypeName': name, 'environment': env, 'runnerId': runner_id,
                          'deploymentDirectory': '' if relative == '.' else directory.strip(), 'entryPoint': entry,
                          'enabled': enabled, 'isDefault': is_default, 'resourceName': resource_name.strip()})
        if any(item['enabled'] and (item['configType'], env) not in defaults for item in items for env in rule_environments(item['environment'])):
            raise ApiError('每个有启用资源的节点类型和环境都需要指定一个默认资源')
        store_layout(db, RULE_KEY, items)
        return entry_names(db, rules(db))


def choice_key(context):
    return CHOICE_PREFIX + hashlib.sha256(json.dumps(owner(context)).encode()).hexdigest()


def read_choice(db, context):
    from .directory_layout import revision
    row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (choice_key(context),)).fetchone()
    item = json.loads(row['setting_value']) if row else {
        **{key: context.get(key, '') for key in ('sourceId', 'flowId', 'stepId', 'flowVersionId', 'configId', 'configType', 'environment')},
        'resourceId': ''}
    return {**item, 'revision': revision(item)}


def node_choice(app, body, *, save=False):
    from .server import ApiError, GIT_LOCK
    from .source_code_relations import source_context
    from .generation_destinations import node_type
    from .directory_layout import store_layout
    context = source_context(body)
    config_id = body.get('configId')
    if not isinstance(config_id, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', config_id):
        raise ApiError('请提供有效的节点配置 ID')
    context.update(configId=config_id, environment=environment(body.get('environment')))
    with GIT_LOCK, app.store.connect() as db:
        kind = node_type(app, db, {'configId': config_id, 'configType': body.get('configType', '')})
        if not kind: raise ApiError('请先确定节点类型')
        context['configType'] = kind
        current = read_choice(db, context)
        options = [item for item in rules(db)['items'] if item['configType'] == kind and supports(item, context['environment'])]
        if save:
            if body.get('revision') != current['revision']: raise ApiError('节点部署资源已被修改，请刷新后再选择', 409)
            resource_id = body.get('resourceId', '')
            if not isinstance(resource_id, str) or (resource_id and not any(item['resourceId'] == resource_id and item['enabled'] for item in options)):
                raise ApiError('所选资源不属于当前节点类型和环境，或已经停用', 409)
            current = {**context, 'resourceId': resource_id}
            store_layout(db, choice_key(context), current)
            current = read_choice(db, context)
        default = next((item for item in options if item['enabled'] and item['isDefault']), None)
        effective_id = current.get('resourceId') or (default['resourceId'] if default else '')
        selected = next((item for item in options if item['enabled'] and item['resourceId'] == effective_id), None)
        # Returning the stored selection prevents a disabled/deleted explicit choice from silently falling back.
        return {**current, 'configType': kind, 'resources': options, 'defaultResourceId': default['resourceId'] if default else '',
                'effectiveResourceId': effective_id, **deployment_path(app, db, selected, context, body)}


def deployment_path(app, db, rule, context, body):
    """Preview the same target used by dispatch, in the target machine's path syntax."""
    from .server import ApiError
    from .generation_tasks import read_config
    from .generated_archives import PREFIX
    result = {'targetPath': '', 'deploymentDirectory': '', 'resourceDirectory': '', 'pathError': ''}
    if not rule:
        result['pathError'] = '待选择可用部署资源'
        return result
    runner = db.execute('SELECT install_directory FROM runners WHERE runner_id=?', (rule['runnerId'],)).fetchone()
    if not runner:
        result['pathError'] = '部署资源对应的 Runner 实例不存在'
        return result
    try:
        generation = read_config(app, context['configId']).get('generation') or {}
        queue = body.get('queueName') or generation.get('queueName', '')
        archive = {}
        archive_id = body.get('archiveId')
        if isinstance(archive_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', archive_id):
            row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + archive_id,)).fetchone()
            archive = json.loads(row['setting_value']) if row else {}
            if archive.get('configId') == context['configId']:
                # Deploying existing code retains the generation archive's queue snapshot.
                queue = archive.get('queueName', queue)
        if not isinstance(queue, str) or len(queue) > 120:
            raise ApiError('节点 MQ 主题无效，无法计算部署目录')
        if archive.get('configId') != context['configId']:
            from .generated_archives import destination
            archive = destination(app, {**generation, 'configId': context['configId'], 'configType': context['configType'],
                                         'queueName': queue, 'destinationMode': generation.get('destinationMode') or 'type'})
        mapped_paths = mapping(rule, archive, runner)
        relative = mapped_paths['targetPath']
        root = runner['install_directory']
        kind = PureWindowsPath if PureWindowsPath(root).drive else PurePosixPath
        result.update(targetPath=relative, deploymentDirectory=str(kind(root) / relative),
                      resourceDirectory=str(kind(root) / mapped_paths['resourceRoot']), **git_details(archive))
    except ApiError as error:
        result['pathError'] = str(error)
    return result


def selected_resource(db, job):
    choice = read_choice(db, job)
    available = [item for item in rules(db)['items'] if item['configType'] == job['configType'] and supports(item, job['environment'])]
    explicit = choice.get('resourceId')
    rule = next((item for item in available if item['enabled'] and
                 (item['resourceId'] == explicit if explicit else item['isDefault'])), None)
    return rule, bool(explicit)


def owner(job):
    return tuple(job[key] for key in ('sourceId', 'flowId', 'stepId', 'configId', 'environment'))


def git_details(archive):
    return {'repositoryId': archive.get('repoId', ''), 'gitDirectory': archive_root(archive) if archive.get('directoryPath') else ''}


def persist(db, job, *, insert=False):
    job['updatedAt'] = stamp()
    values = tuple(job[key] for key in ('sourceId', 'flowId', 'stepId', 'configId', 'configType', 'environment',
                                      'archiveId', 'taskId', 'gitCommit', 'status', 'runnerId', 'deploymentId', 'deliveryId', 'createdAt', 'updatedAt'))
    if insert:
        db.execute('INSERT INTO deployment_jobs VALUES (' + ','.join('?' for _ in range(17)) + ')',
                   (job['jobId'], *values, json.dumps(job, ensure_ascii=False)))
    else:
        db.execute('UPDATE deployment_jobs SET status=?,runner_id=?,deployment_id=?,delivery_id=?,updated_at=?,payload=? WHERE job_id=?',
                   (job['status'], job['runnerId'], job['deploymentId'], job['deliveryId'], job['updatedAt'], json.dumps(job, ensure_ascii=False), job['jobId']))


def enqueue_archive(db, archive):
    """Atomic outbox with the successful Git receipt; never deploy unknown sources."""
    if archive.get('status') != 'committed' or not archive.get('sourceContext') or not archive.get('files'):
        return None
    # A configured remote must have been pushed successfully before deployment.
    repo = db.execute('SELECT remote_url FROM code_repositories WHERE repo_id=?', (archive['repoId'],)).fetchone()
    if repo and repo['remote_url'] and not archive.get('pushed'): return None
    return enqueue(db, archive, 'test', automatic=True)


def enqueue(db, archive, env, *, automatic=False, parent='', rollback=False):
    from .server import ApiError
    from .source_code_relations import source_context, task_stamp
    context = source_context(archive.get('sourceContext'))
    if not context: raise ApiError('生成结果缺少源和流程节点关联，不能自动部署', 422)
    if not re.fullmatch(r'[0-9a-f]{40}', archive.get('gitCommit', '')):
        raise ApiError('生成结果缺少固定 Git 提交版本', 422)
    identifier = uuid.uuid4().hex if rollback else uuid.uuid5(uuid.NAMESPACE_URL, 'ce:generated-deploy:' + archive['archiveId'] + ':' + env).hex
    existing = db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (identifier,)).fetchone()
    if existing: return json.loads(existing['payload'])
    origin = db.execute('SELECT created_at FROM generation_jobs WHERE task_id=?', (archive.get('taskId', ''),)).fetchone()
    created = stamp()
    job = {**context, 'jobId': identifier, 'configId': archive['configId'], 'configType': str(archive.get('configType') or ''),
           'environment': env, 'archiveId': archive['archiveId'], 'taskId': archive.get('taskId', ''), 'gitCommit': archive['gitCommit'],
           'status': 'waiting_resource', 'runnerId': '', 'deploymentId': '', 'deliveryId': '', 'runtimeId': '',
           'targetPath': '', 'installedPath': '', 'message': '等待匹配节点类型和环境的部署资源',
           'createdAt': created, 'updatedAt': created, 'automatic': automatic, 'parentJobId': parent, 'rollback': rollback,
           'taskCreatedAt': task_stamp(origin['created_at'] if origin else archive.get('createdAt', created)),
           'archive': archive, **git_details(archive)}
    repository = db.execute('SELECT name FROM code_repositories WHERE repo_id=?', (archive.get('repoId', ''),)).fetchone()
    job['repositoryName'] = repository['name'] if repository else ''
    if automatic:
        others = db.execute("SELECT payload FROM deployment_jobs WHERE source_id=? AND flow_id=? AND step_id=? AND config_id=? AND environment=?",
                            owner(job)).fetchall()
        for row in others:
            old = json.loads(row['payload'])
            if not old.get('automatic'): continue
            if (old.get('taskCreatedAt', ''), old['taskId']) > (job['taskCreatedAt'], job['taskId']):
                job.update(status='superseded', message='已有更新的生成任务结果，本次不覆盖新代码')
            elif old['status'] in WAITING:
                old.update(status='superseded', message='已由更新的生成结果替代'); persist(db, old)
    persist(db, job, insert=True)
    return job


def listing(app, query):
    from .server import ApiError
    clauses, values = [], []
    for key, column in (('sourceId', 'source_id'), ('flowId', 'flow_id'), ('stepId', 'step_id'), ('configId', 'config_id'),
                        ('environment', 'environment'), ('status', 'status')):
        if query.get(key): clauses.append(column + '=?'); values.append(query[key])
    try: page, size = int(query.get('page', 1)), int(query.get('size', 20))
    except (ValueError, TypeError): raise ApiError('分页参数无效')
    if page < 1 or not 1 <= size <= 100: raise ApiError('分页参数无效')
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    with app.store.connect() as db:
        total = db.execute('SELECT COUNT(*) n FROM deployment_jobs' + where, values).fetchone()['n']
        rows = db.execute('SELECT payload FROM deployment_jobs' + where + ' ORDER BY created_at DESC,job_id DESC LIMIT ? OFFSET ?',
                          (*values, size, (page - 1) * size)).fetchall()
        return {'items': [view(json.loads(row['payload'])) for row in rows], 'total': total}


def view(job):
    return {**git_details(job.get('archive') or {}), **{key: value for key, value in job.items() if key != 'archive'}}


def deploy_existing(app, body):
    from .server import ApiError, GIT_LOCK
    from .generated_archives import PREFIX
    from .source_code_relations import source_context
    identifier = body.get('archiveId')
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', identifier):
        raise ApiError('请选择有效的生成归档')
    expected = source_context(body)
    with GIT_LOCK, app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + identifier,)).fetchone()
        if not row: raise ApiError('生成归档不存在', 404)
        archive = json.loads(row['setting_value'])
        if not archive.get('sourceContext'):
            origin = db.execute('SELECT payload FROM generation_jobs WHERE task_id=?', (archive.get('taskId', ''),)).fetchone()
            original = json.loads(origin['payload']) if origin else {}
            if original.get('configId') == archive.get('configId'):
                archive['sourceContext'] = {key: original.get(key, '') for key in ('sourceId', 'flowId', 'stepId', 'flowVersionId')}
            else:
                relation = db.execute('SELECT source_id,flow_id,step_id,flow_version_id FROM source_code_relations '
                                      'WHERE archive_id=? AND config_id=? AND source_id=? AND flow_id=? AND step_id=? LIMIT 1',
                                      (identifier, body.get('configId'), expected['sourceId'], expected['flowId'], expected['stepId'])).fetchone()
                if relation:
                    archive['sourceContext'] = {'sourceId': relation['source_id'], 'flowId': relation['flow_id'],
                                                'stepId': relation['step_id'], 'flowVersionId': relation['flow_version_id']}
        actual = source_context(archive.get('sourceContext'))
        if not actual or any(actual[key] != expected[key] for key in ('sourceId', 'flowId', 'stepId')) or archive.get('configId') != body.get('configId'):
            raise ApiError('生成代码不属于当前源和流程节点，不能部署', 409)
        if archive.get('status') != 'committed' or not archive.get('files'):
            raise ApiError('请先将生成代码成功提交仓库', 409)
        repo = db.execute('SELECT remote_url FROM code_repositories WHERE repo_id=?', (archive['repoId'],)).fetchone()
        if not repo or repo['remote_url'] and not archive.get('pushed'):
            raise ApiError('生成代码尚未成功推送远程仓库', 409)
        return view(manual_enqueue(db, archive, 'test'))


def manual_enqueue(db, archive, env, parent=''):
    """An explicit deployment may move the same code to a newly selected resource."""
    latest = db.execute('SELECT payload FROM deployment_jobs WHERE archive_id=? AND environment=? ORDER BY created_at DESC,job_id DESC LIMIT 1',
                        (archive['archiveId'], env)).fetchone()
    if latest:
        previous = json.loads(latest['payload'])
        if previous['status'] in (*WAITING, 'delivering', 'failed'):
            return previous
        rule, _ = selected_resource(db, previous)
        runner = db.execute('SELECT install_directory FROM runners WHERE runner_id=?', (rule['runnerId'],)).fetchone() if rule else None
        if previous['status'] == 'success' and rule and runner and previous['runnerId'] == rule['runnerId'] and previous['targetPath'] == target(rule, previous, runner):
            return previous
        return enqueue(db, archive, env, parent=parent or previous['jobId'], rollback=True)
    return enqueue(db, archive, env, parent=parent)


def action(app, identifier, operation):
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, app.store.connect() as db:
        row = db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (identifier,)).fetchone()
        if not row: raise ApiError('部署记录不存在', 404)
        job = json.loads(row['payload'])
        if operation == 'publish':
            if job['environment'] != 'test' or job['status'] != 'success':
                raise ApiError('请先完成该版本的测试环境部署，再发布生产', 409)
            return view(manual_enqueue(db, job['archive'], 'production', parent=identifier))
        if operation == 'rollback':
            if job['status'] != 'success': raise ApiError('只能重新部署曾经成功的版本', 409)
            active = db.execute("SELECT payload FROM deployment_jobs WHERE config_id=? AND environment=? AND status IN ('waiting_resource','queued','delivering')",
                                (job['configId'], job['environment'])).fetchall()
            if any(owner(json.loads(row['payload'])) == owner(job) for row in active):
                raise ApiError('该节点环境已有部署任务，请等待完成后再回滚', 409)
            return view(enqueue(db, job['archive'], job['environment'], parent=identifier, rollback=True))
        if operation == 'retry':
            if job['status'] not in ('failed', 'waiting_resource', 'queued'):
                raise ApiError('当前部署状态不能重试', 409)
            if job.get('automatic'):
                others = db.execute('SELECT payload FROM deployment_jobs WHERE source_id=? AND flow_id=? AND step_id=? AND config_id=? AND environment=?', owner(job)).fetchall()
                if any(other.get('automatic') and (other.get('taskCreatedAt', ''), other['taskId']) > (job.get('taskCreatedAt', ''), job['taskId'])
                       for other in (json.loads(row['payload']) for row in others)):
                    raise ApiError('该任务已被更新的生成结果替代，请在历史部署记录中明确选择部署此版本', 409)
            job.update(status='waiting_resource', runnerId='', deploymentId='', deliveryId='', runtimeId='', message='等待重新匹配默认部署资源')
            persist(db, job)
            return view(job)
        raise ApiError('部署操作无效')


def target(rule, job, runner=None):
    return mapping(rule, job['archive'], runner)['targetPath']


def layout_nodes(archive, source_base=None):
    """Map exactly the generated files at their pinned commit, including subfolders."""
    from .directory_layout import safe_path
    from .server import ApiError
    prefix = archive['directoryPath'].rstrip('/') + '/'
    original_base = prefix + (archive.get('repositoryPrefix', '').strip('/') + '/' if archive.get('repositoryPrefix') else '')
    base = source_base.rstrip('/') + '/' if source_base else original_base
    nodes, folders = [], {}
    for file in archive['files']:
        path = safe_path(file['path'])
        if not path.startswith(original_base): raise ApiError('生成文件不在归档的仓库目录内', 422)
        if not path.startswith(base): continue
        relative = safe_path(path[len(base):])
        parent = ''
        parts = relative.split('/')
        for index, name in enumerate(parts):
            local = '/'.join(parts[:index + 1])
            node_id = hashlib.sha256(local.encode()).hexdigest()
            if index < len(parts) - 1:
                if local not in folders:
                    folders[local] = node_id
                    nodes.append({'id': node_id, 'parentId': parent, 'name': name, 'kind': 'folder'})
            else:
                nodes.append({'id': node_id, 'parentId': parent, 'name': name, 'kind': 'file', 'sourceType': 'file',
                              'repoId': archive['repoId'], 'sourcePath': path, 'gitCommit': archive['gitCommit']})
            parent = node_id
    if not nodes: raise ApiError('生成结果没有可部署文件', 422)
    return nodes


def prepare(app, db, job, rule, runner):
    from .server import ApiError
    from .directory_layout import store_layout
    from .deployment_configuration import configurations, save_configuration, RUNTIME_PREFIX
    from .directory_bindings import owner_key
    from .directory_delivery import request_delivery, target_path
    from .runtime_history import insert_record, add_event
    mapped_paths = mapping(rule, job['archive'], runner)
    root = mapped_paths['targetPath']
    kind = PureWindowsPath if PureWindowsPath(runner['install_directory']).drive else PurePosixPath
    absolute = kind(runner['install_directory']) / root
    for process in json.loads(runner['worker_processes'] or '[]'):
        directory = process.get('workingDirectory', '')
        if directory and (kind(directory) == absolute or absolute in kind(directory).parents or kind(directory) in absolute.parents):
            job.update(status='queued', message='目标目录中的处理程序正在运行，请先停止后部署'); return
    identity = owner(job)
    deployment_id = uuid.uuid5(uuid.NAMESPACE_URL, 'ce:auto-deployment:' + json.dumps(identity)).hex
    for item in configurations(app, db).values():
        if item['deploymentId'] == deployment_id: continue
        other = kind(target_path(item))
        target_root = kind(root)
        if other != target_root and other not in target_root.parents and target_root not in other.parents: continue
        if db.execute('SELECT 1 FROM directory_runner_bindings WHERE owner_id=? AND runner_id=?',
                      (item['deploymentId'], runner['runner_id'])).fetchone():
            raise ApiError('目标目录已被其他部署配置使用，请修改部署资源的部署目录', 409)
    current = configurations(app, db).get(deployment_id)
    archive = job['archive']
    if mapped_paths:
        # Deploy the configuration's complete Git folder at the pinned commit,
        # including manually maintained dependencies, without touching sibling configurations.
        from .directory_layout import git_files
        from .delivery_ignore import ignored_paths
        from .python_cache import is_python_cache
        repo = app.repository(db, archive['repoId'])
        tree = git_files(app, repo, archive['gitCommit'])
        excluded = ignored_paths(repo, archive['gitCommit'], tree)
        prefix = mapped_paths['sourceBase'].rstrip('/') + '/'
        archive = {**archive, 'files': [{'path': path} for path in sorted(tree) if path.startswith(prefix)
                                      and path not in excluded and not is_python_cache(path)]}
    nodes = layout_nodes(archive, mapped_paths['sourceBase'] if mapped_paths else None)
    payload = {'name': '配置 ' + job['configId'] + (' · 测试' if job['environment'] == 'test' else ' · 生产'),
               'directoryTemplate': root, 'configId': job['configId'], 'queueName': job['archive'].get('queueName', ''),
               'pathStyle': 'config', 'nodes': nodes, 'entryPoint': '', 'revision': current['revision'] if current else '',
               'sourceNode': {'flowId': job['flowId'], 'flowName': job['flowId'], 'stepId': job['stepId'],
                              'nodeName': job['stepId'], 'configId': job['configId']}}
    if rule.get('entryPoint'):
        from .runtime_entry import candidates
        if rule['entryPoint'] not in candidates(app, payload, db):
            raise ApiError('部署资源指定的入口文件不存在于当前代码配置：' + rule['entryPoint'], 422)
        payload['entryPoint'] = rule['entryPoint']
    elif not current or not current.get('entryPoint'):
        from .runtime_entry import candidates
        entries = candidates(app, payload, db)
        if len(entries) == 1:
            payload['entryPoint'] = entries[0]
    # An existing transfer of this owner must complete before its mapping changes.
    if db.execute("SELECT 1 FROM directory_deliveries WHERE owner_id=? AND status IN ('pending','running')", (deployment_id,)).fetchone():
        job.update(status='queued', message='等待该节点上一次代码下发完成'); return
    layout = save_configuration(app, payload, deployment_id if current else '', _db=db)
    if not current:
        db.execute('DELETE FROM settings WHERE setting_key=?', ('deployment-config:' + layout['deploymentId'],))
        layout['deploymentId'] = deployment_id; layout['registryKey'] = '@deployment:' + deployment_id
    from .directory_layout import revision
    layout.update(managedBy='generated-code', deploymentEnvironment=job['environment'])
    layout['revision'] = revision(layout)
    store_layout(db, 'deployment-config:' + deployment_id, layout)
    runner_id = runner['runner_id']
    db.execute('INSERT OR IGNORE INTO directory_runner_bindings VALUES (?,?,?,?,?)',
               ('deployment', owner_key(deployment_id), deployment_id, runner_id, stamp()))
    runtime_id = uuid.uuid5(uuid.NAMESPACE_URL, deployment_id + ':' + runner_id).hex
    runtime = {'runtimeId': runtime_id, 'deploymentId': deployment_id, 'runnerId': runner_id, 'assignmentId': '',
               'appliedRevision': layout['revision'], 'scriptDigest': '', 'executionEntry': '', 'executionDirectory': root}
    existing = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (RUNTIME_PREFIX + runtime_id,)).fetchone()
    if existing:
        # Preserve operator-managed entry, process and retry settings.
        saved_runtime = json.loads(existing['setting_value'])
        runtime = {**runtime, **saved_runtime} if saved_runtime.get('assignmentId') else {**saved_runtime, **runtime}
    store_layout(db, RUNTIME_PREFIX + runtime_id, runtime)
    if layout.get('entryPoint'):
        from .deployment_configuration import save_runtime, runtime_rows
        row = next(item for item in runtime_rows(app, db) if item['runtimeId'] == runtime_id)
        adopted = save_runtime(app, {'runtimeId': runtime_id, 'revision': row['revision'],
            'deploymentId': deployment_id, 'layoutRevision': layout['revision'], 'runnerId': runner_id,
            'environment': job['environment'], 'concurrency': (row.get('assignment') or {}).get('concurrency', 1),
            'retryPolicy': row.get('retryPolicy')}, _db=db)
        runtime['assignmentId'] = adopted['assignmentId']
    delivery = request_delivery(app, 'deployment', deployment_id, runner_id,
                                {'revision': layout['revision'], 'scope': 'all'}, _db=db)
    if not delivery.get('unchanged'):
        data = {'name': layout['name'], 'configId': job['configId'], 'ipAddress': runner['ip_address'],
                'runnerName': runner['name'], 'installDirectory': runner['install_directory'], 'directoryTemplate': root,
                'releaseDigest': delivery['artifactDigest'], 'sourceNode': layout['sourceNode'],
                'environment': job['environment'], 'generationTaskId': job['taskId'], 'gitCommit': job['gitCommit'],
                **git_details(job['archive']),
                'sources': [{key: node.get(key, '') for key in ('repoId', 'sourcePath', 'gitCommit', 'name')} for node in nodes if node.get('repoId')]}
        insert_record(db, delivery['deliveryId'], runtime, 'delivery', data)
        add_event(db, delivery['deliveryId'], 'requested', '生成代码部署：等待 Runner 领取')
    job.update(status='success' if delivery.get('unchanged') else 'delivering', runnerId=runner_id,
               runnerName=runner['name'], runnerIp=runner['ip_address'], instanceDirectory=runner['install_directory'],
               deploymentId=deployment_id, runtimeId=runtime_id, deliveryId=delivery['deliveryId'], targetPath=root,
               installedPath=delivery.get('installedPath', ''), artifactDigest=delivery['artifactDigest'],
               **git_details(job['archive']), resourceDirectory=str(kind(runner['install_directory']) / mapped_paths['resourceRoot']),
               repositoryName=repo['name'],
               message='代码未变化，已确认部署版本一致' if delivery.get('unchanged') else '等待 Runner 领取并部署')


def dispatch(app):
    """Restart-safe sweep. Resource changes affect only work not yet submitted to a Runner."""
    from .server import GIT_LOCK
    from .directory_delivery import expire_deliveries
    with GIT_LOCK, app.store.connect() as db:
        expire_deliveries(db)
        rows = db.execute("SELECT job_id FROM deployment_jobs WHERE status IN ('waiting_resource','queued','delivering') ORDER BY created_at,job_id").fetchall()
    for row in rows:
        # Separate transaction per job; a corrupt/unavailable repository cannot starve other nodes.
        try:
            with GIT_LOCK, app.store.connect() as db:
                stored = db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (row['job_id'],)).fetchone()
                job = json.loads(stored['payload'])
                if job['status'] == 'delivering':
                    delivery = db.execute('SELECT status,error,installed_path FROM directory_deliveries WHERE delivery_id=?', (job['deliveryId'],)).fetchone()
                    if delivery and delivery['status'] in ('success', 'failed'):
                        job.update(status=delivery['status'], installedPath=delivery['installed_path'],
                                   message=delivery['error'] or '代码部署完成')
                    elif delivery and delivery['status'] == 'running': job['message'] = 'Runner 正在部署代码'
                elif job['status'] in WAITING:
                    rule, explicit = selected_resource(db, job)
                    runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (rule['runnerId'],)).fetchone() if rule else None
                    if not runner:
                        job.update(status='waiting_resource', message='节点所选部署资源已停用或不存在，请重新选择' if explicit else '尚未分配该节点类型和环境的默认部署资源')
                    elif runner['status'] != 'online':
                        job.update(status='waiting_resource', message=('所选' if explicit else '默认') + '部署资源离线，等待 Runner 恢复')
                    else:
                        job.update(resourceId=rule['resourceId'], resourceMode='selected' if explicit else 'default')
                        prepare(app, db, job, rule, runner)
                persist(db, job)
        except Exception as exc:
            with app.store.connect() as db:
                saved = db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (row['job_id'],)).fetchone()
                job = json.loads(saved['payload']); job.update(status='failed', message=str(exc)[:1500]); persist(db, job)
