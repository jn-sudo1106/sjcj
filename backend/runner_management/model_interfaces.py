"""Configured code-generation adapters; credentials never come from the browser."""
import functools
import codecs
import importlib.util
import ipaddress
import json
import re
import threading
import time
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

KEY = 'ai_model_interfaces_v1'
LOCK = threading.Lock()
MAX_RESPONSE = 2 * 1024 * 1024


def cdp_port(value=9223):
    from .server import ApiError
    if type(value) is not int or not 1 <= value <= 65535:
        raise ApiError('cdp_port 须为 1–65535 的整数')
    return value


def defaults():
    common = dict(enabled=True, timeoutSeconds=300, prjDir='', inputFileDir='', codeDir='', outputFileDir='', stream=True)
    return [
        dict(common, id='legacy', name='现有 Gemini 服务', kind='site-script', model='',
             endpoint='http://127.0.0.1:8091/api/ai/site-script/generate', isDefault=True, timeoutSeconds=120),
        dict(common, id='workbuddy-agent-hy3', name='Agent · hy3', kind='agent', model='hy3',
             endpoint='http://192.168.1.171:6000/wb/agent', isDefault=False, prjDir=r'D:\aicode',
             codeDir=r'D:\aicode\code', outputFileDir=r'D:\aicode\output', cdpPort=9223),
        dict(common, id='workbuddy-chat-hy3', name='Chat · hy3', kind='chat', model='hy3',
             endpoint='http://192.168.1.171:6000/workbuudy/chat', isDefault=False),
    ]


def host(value):
    value = str(value or '').lower().rstrip('.')
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return value


def resolve_servers(items, servers):
    """Resolve configured model addresses without issuing inference/probe requests."""
    for item in items:
        mode = item.get('generationServerMode') or ('manual' if item.get('generationServerId') else 'auto')
        item['generationServerMode'] = mode
        item['generationServerMatch'] = 'direct'
        if mode == 'manual':
            item['generationServerMatch'] = 'manual' if any(server['serverId'] == item.get('generationServerId') for server in servers) else 'missing'
            continue
        item['generationServerId'] = ''
        if mode == 'direct':
            continue
        address = host(urlsplit(item['endpoint']).hostname)
        try:
            local = ipaddress.ip_address(address).is_loopback or ipaddress.ip_address(address).is_unspecified
        except ValueError:
            local = address == 'localhost'
        if local:
            item['generationServerMatch'] = 'local'
            continue
        candidates = [server for server in servers if address and address in
                      (host(server.get('ipAddress')), host(urlsplit(server.get('endpoint', '')).hostname))]
        online = [server for server in candidates if server['status'] == 'online']
        candidates = online or candidates
        if len(candidates) == 1:
            item['generationServerId'] = candidates[0]['serverId']
            item['generationServerMatch'] = 'matched' if online else 'offline'
        else:
            item['generationServerMatch'] = 'ambiguous' if candidates else 'unmatched'


def listing(app, servers=None):
    with app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (KEY,)).fetchone()
    result = json.loads(row['setting_value']) if row else {'items': defaults(), 'revision': 0}
    for item in result['items']:
        item.setdefault('prjDir', r'D:\aicode' if item['kind'] in ('agent', 'gemini-agent') else '')
        item.setdefault('title', '')
        item.setdefault('generationServerId', '')
        if item['kind'] == 'agent':
            item.setdefault('cdpPort', 9223)
    if servers is None:
        from .code_servers import registry
        servers = registry(app)
    resolve_servers(result['items'], servers)
    return result


def save(app, body, update_test_prompts=False):
    from .server import ApiError
    if not isinstance(body, dict) or not isinstance(body.get('items'), list) or not 1 <= len(body['items']) <= 50:
        raise ApiError('请配置 1–50 个模型接口')
    rows, ids, names = [], set(), set()
    existing_ids = {item['id'] for item in listing(app)['items']} if not update_test_prompts else set()
    for raw in body['items']:
        if not isinstance(raw, dict):
            raise ApiError('模型接口格式无效')
        row = {}
        for field, limit in (('id', 80), ('name', 100), ('endpoint', 2000), ('model', 200),
                             ('prjDir', 2000), ('inputFileDir', 2000), ('codeDir', 2000), ('outputFileDir', 2000), ('title', 200), ('generationServerId', 80)):
            value = raw.get(field, r'D:\aicode' if field == 'prjDir' and raw.get('kind') in ('agent', 'gemini-agent') else '')
            if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value):
                raise ApiError(f'模型接口 {field} 无效')
            row[field] = value.strip()
        row['id'] = row['id'] or uuid.uuid4().hex
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', row['id']) or row['id'] in ids:
            raise ApiError('模型接口 ID 重复或无效')
        if not row['name'] or row['name'] in names:
            raise ApiError('模型接口名称不能为空或重复')
        ids.add(row['id']); names.add(row['name'])
        row['kind'] = raw.get('kind')
        row['generationServerMode'] = raw.get('generationServerMode') or ('manual' if row['generationServerId'] else 'auto')
        if row['generationServerMode'] not in ('auto', 'manual', 'direct'):
            raise ApiError('代码生成服务器关联方式无效')
        if row['generationServerMode'] != 'manual':
            row['generationServerId'] = ''
        elif not row['generationServerId']:
            raise ApiError('请选择手工关联的代码生成服务器')
        if row['generationServerId']:
            from .code_servers import read
            read(app, row['generationServerId'])
        if row['kind'] not in ('agent', 'gemini-agent', 'gemini-chat', 'chat', 'site-script'):
            raise ApiError('模型接口类型无效')
        for field in ('testSystemPrompt', 'testUserPrompt'):
            if field in raw and (update_test_prompts or raw.get('id') not in existing_ids):
                value = raw[field]
                if not isinstance(value, str) or len(value) > 12000:
                    raise ApiError('测试提示词格式无效或超过 12000 字')
                row[field] = value
        try:
            parsed = urlsplit(row['endpoint'])
            valid = parsed.scheme in ('http', 'https') and parsed.hostname and parsed.port != 0
        except ValueError:
            valid = False
        if not valid or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ApiError('接口地址必须为不带凭据、查询参数和片段的 HTTP(S) 地址')
        if row['kind'] in ('agent', 'chat', 'gemini-chat') and not row['model']:
            raise ApiError('请填写模型标识')
        if row['kind'] in ('agent', 'gemini-agent') and not row['prjDir']:
            raise ApiError('Agent 接口必须配置工作空间')
        for field in ('enabled', 'isDefault', 'stream'):
            if type(raw.get(field)) is not bool:
                raise ApiError(f'{field} 必须为布尔值')
            row[field] = raw[field]
        timeout = raw.get('timeoutSeconds')
        if type(timeout) is not int or not 10 <= timeout <= 1800:
            raise ApiError('超时须为 10–1800 秒的整数')
        row['timeoutSeconds'] = timeout
        if row['kind'] == 'agent':
            row['cdpPort'] = cdp_port(raw.get('cdpPort', 9223))
        if row['isDefault'] and not row['enabled']:
            raise ApiError('默认模型接口必须启用')
        rows.append(row)
    if sum(row['isDefault'] for row in rows) != 1:
        raise ApiError('请选择一个默认模型接口')
    with LOCK:
        current = listing(app)
        if type(body.get('revision')) is not int or current['revision'] != body['revision']:
            raise ApiError('模型接口配置已更新，请刷新后重试', 409)
        existing = {item['id']: item for item in current['items']}
        for row in rows:
            for field in ('testSystemPrompt', 'testUserPrompt'):
                if (not update_test_prompts or field not in row) and field in existing.get(row['id'], {}):
                    row[field] = existing[row['id']][field]
        result = {'items': rows, 'revision': current['revision'] + 1}
        with app.store.connect() as db:
            db.execute('DELETE FROM settings WHERE setting_key=?', (KEY,))
            db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)',
                       (KEY, json.dumps(result, ensure_ascii=False)))
    return listing(app)


def save_test_prompts(app, body):
    from .server import ApiError
    current = listing(app)
    selected = next((row for row in current['items'] if row['id'] == body.get('interfaceId')), None)
    if selected is None:
        raise ApiError('模型接口不存在', 404)
    system, user = body.get('systemPrompt'), body.get('userPrompt')
    if not isinstance(system, str) or len(system) > 12000:
        raise ApiError('系统提示词须为不超过 12000 字的文本')
    if not isinstance(user, str) or len(user) > 12000:
        raise ApiError('用户提示词须为不超过 12000 字的文本')
    selected['testSystemPrompt'], selected['testUserPrompt'] = system, user
    return save(app, {'items': current['items'], 'revision': body.get('revision')}, update_test_prompts=True)


@functools.lru_cache(maxsize=1)
def script_service():
    path = Path(__file__).parents[1] / 'legacy_qinlongclaw/site-script-service/server.py'
    spec = importlib.util.spec_from_file_location('configured_site_script_service', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def content(value):
    """Accept plain code, common JSON envelopes and OpenAI-compatible chunks."""
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ''
    if value.get('error') or value.get('success') is False:
        from .server import ApiError
        raise ApiError('模型服务返回失败：' + str(value.get('message') or value.get('error'))[:500], 502)
    choices = value.get('choices')
    if isinstance(choices, list) and choices:
        choice = choices[0]
        return content(choice.get('delta') or choice.get('message') or choice)
    for key in ('code', 'content', 'text', 'response', 'answer', 'result', 'data'):
        candidate = value.get(key)
        if isinstance(candidate, (str, dict)):
            text = content(candidate)
            if text:
                return text
    return ''


def decode_response(raw, mime):
    from .server import ApiError
    text = raw.decode('utf-8-sig')
    if 'event-stream' in mime or text.lstrip().startswith('data:'):
        parts, event = [], []
        def append():
            data = '\n'.join(event).strip()
            if not data or data == '[DONE]':
                return
            try:
                parts.append(content(json.loads(data)))
            except json.JSONDecodeError:
                parts.append(data)
        for line in text.splitlines() + ['']:
            if line.startswith('data:'):
                event.append(line[5:].lstrip())
            elif not line:
                append(); event = []
        return ''.join(parts)
    try:
        return content(json.loads(text))
    except json.JSONDecodeError:
        if 'json' in mime:
            raise ApiError('模型接口返回的 JSON 无效', 502)
        return text


def agent_directories(selected, task_id=None):
    from .server import ApiError
    root = selected.get('prjDir', '').strip()
    if not root:
        raise ApiError('请填写工作空间')
    instance_id = selected.get('generationServerId') or selected.get('id', '')
    if task_id is None:
        task_id = uuid.uuid4().hex
    elif type(task_id) is int:
        task_id = str(task_id)
    if any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value) for value in (instance_id, task_id)):
        raise ApiError('实例 ID 或任务 ID 无效')
    path_type = PureWindowsPath if '\\' in root or re.match(r'^[A-Za-z]:', root) else PurePosixPath
    base = path_type(root) / selected.get('_workspaceDirectory', '')
    code = selected.get('_codeDirectory') or str(base / 'code')
    from .generation_workspaces import output_subdirectory
    suffix = output_subdirectory({'outputSubdirectory': selected.get('_codeSubdirectory', '')})
    if suffix:
        code = str(path_type(code).joinpath(*suffix.split('/')))
    return {'instanceId': instance_id, 'taskId': task_id, 'prjDir': str(base),
            'inputFileDir': str(base / 'input'), 'codeDir': code, 'outputFileDir': str(base / 'output'),
            'taskRecordPath': str(base / 'tasks' / (task_id + '.json'))}


def workbuddy_request(selected, prompt, task_id=None):
    from .server import ApiError
    params = {'model': selected['model'], 'prompt': prompt}
    if selected['kind'] == 'gemini-chat':
        return Request(selected['endpoint'], data=json.dumps(params, ensure_ascii=False).encode('utf-8'),
                       headers={'Content-Type': 'application/json', 'Accept': 'text/plain, application/json, text/event-stream'}, method='POST')
    if selected['kind'] in ('agent', 'gemini-agent'):
        workspace = agent_directories(selected, task_id)
        params.update(prj_dir=workspace['prjDir'], input_file_dir=workspace['inputFileDir'],
                      code_dir=workspace['codeDir'], output_file_dir=workspace['outputFileDir'])
        if selected['kind'] == 'gemini-agent':
            params.pop('model', None)
            params['title'] = selected.get('title', '')
        else:
            params['cdp_port'] = cdp_port(selected.get('cdpPort', 9223))
        request = Request(selected['endpoint'], data=json.dumps(params, ensure_ascii=False).encode('utf-8'),
                          headers={'Content-Type': 'application/json; charset=utf-8',
                                   'Accept': 'text/plain, application/json, text/event-stream'}, method='POST')
        request.generation_workspace = workspace
        return request
    params['stream'] = '1' if selected['stream'] else '0'
    parsed = urlsplit(selected['endpoint'])
    return Request(urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(params), '')),
                   headers={'Accept': 'text/plain, application/json, text/event-stream'})


def generation_request_details(request):
    """Expose the resolved model request, excluding transport credentials."""
    parsed = urlsplit(request.full_url)
    query = [(key, '***' if re.search(r'(?i)token|password|secret|api[_-]?key|authorization|access[_-]?key',key) else value)
             for key,value in parse_qsl(parsed.query,keep_blank_values=True)]
    url = urlunsplit((parsed.scheme,parsed.netloc,parsed.path,urlencode(query),''))
    headers = {key.title():value for key,value in request.header_items() if key.lower() in ('content-type','accept')}
    return {'method':request.get_method(),'url':url,'headers':headers,
            'body':json.loads(request.data.decode('utf8')) if request.data else None}


def prepare_test(app, body):
    """Send only explicit test parameters; never mutate the saved interface."""
    from .server import ApiError
    selected = next((dict(row) for row in listing(app)['items'] if row['id'] == body.get('interfaceId')), None)
    if not selected or not selected['enabled']:
        raise ApiError('所选模型接口不存在或已停用')
    prompt = body.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 12000:
        raise ApiError('请填写 1–12000 字的提示词')
    prompt = prompt.strip()
    if selected['kind'] == 'site-script':
        service = script_service()
        url, system = body.get('url'), body.get('systemPrompt', service.SYSTEM_PROMPT)
        if not isinstance(system, str) or not system.strip() or len(system) > 12000:
            raise ApiError('请填写 1–12000 字的系统提示词')
        try:
            service.file_name_for_url(url)
        except service.GenerationError as exc:
            raise ApiError(str(exc), exc.status) from exc
        payload = {'prompt': prompt, 'userPrompt': prompt, 'systemPrompt': system.strip(),
                   'url': url, 'sampleId': service.SAMPLE_ID}
        request = Request(selected['endpoint'], data=json.dumps(payload, ensure_ascii=False).encode('utf8'),
                          headers={'Content-Type': 'application/json'}, method='POST')
    else:
        for field in ('model', 'prjDir', 'inputFileDir', 'codeDir', 'outputFileDir', 'title'):
            value = body.get(field, selected[field])
            if not isinstance(value, str) or len(value) > (200 if field in ('model', 'title') else 2000) or any(ord(c) < 32 for c in value):
                raise ApiError(f'测试参数 {field} 无效')
            selected[field] = value.strip()
        if selected['kind'] in ('agent', 'chat', 'gemini-chat') and not selected['model']:
            raise ApiError('请填写模型标识')
        if selected['kind'] == 'agent':
            selected['cdpPort'] = cdp_port(body.get('cdpPort', selected.get('cdpPort', 9223)))
        if selected['kind'] == 'chat':
            stream = body.get('stream', selected['stream'])
            if type(stream) is not bool:
                raise ApiError('stream 必须为布尔值')
            selected['stream'] = stream
        system = body.get('systemPrompt', '')
        if not isinstance(system, str) or len(system) > 12000:
            raise ApiError('系统提示词须为不超过 12000 字的文本')
        if system.strip():
            prompt = f'系统要求：\n{system.strip()}\n\n用户要求：\n{prompt}'
        request = workbuddy_request(selected, prompt, body.get('taskId'))
    from .code_servers import model_request
    selected['_workspace'] = getattr(request, 'generation_workspace', None)
    return selected, model_request(app, selected, request)


def test_interface(app, body):
    selected, request = prepare_test(app, body)
    started = time.monotonic()
    try:
        try:
            response = urlopen(request, timeout=selected['timeoutSeconds'])
        except HTTPError as error:
            response = error
        with response:
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ApiError('模型响应超过 2 MB', 502)
            status = response.code
            return {'ok': 200 <= status < 300, 'status': status,
                    'contentType': response.headers.get('Content-Type', ''),
                    'responseText': raw.decode('utf-8-sig', errors='replace'),
                    'workspace': selected.get('_workspace'),
                    'durationMs': round((time.monotonic() - started) * 1000)}
    except (URLError, TimeoutError, OSError) as exc:
        raise ApiError(f'{selected["name"]} 测试连接失败或超时，请检查接口地址和模型服务', 502) from exc


def stream_test(handler, app, body):
    """Relay upstream bytes as they arrive, without buffering the whole response."""
    from .server import RESPONSE_SENT
    selected, request = prepare_test(app, body)
    started = time.monotonic()
    handler.send_response(200)
    handler.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
    handler.send_header('Cache-Control', 'no-store, no-transform')
    handler.send_header('X-Accel-Buffering', 'no')
    handler.send_header('Connection', 'close')
    handler.end_headers()
    handler.close_connection = True

    def emit(kind, **fields):
        payload = {'type': kind, 'durationMs': round((time.monotonic() - started) * 1000), **fields}
        handler.wfile.write((json.dumps(payload, ensure_ascii=False) + '\n').encode('utf8'))
        handler.wfile.flush()

    try:
        emit('connecting')
        try:
            response = urlopen(request, timeout=selected['timeoutSeconds'])
        except HTTPError as error:
            response = error
        with response:
            emit('headers', status=response.code, ok=200 <= response.code < 300,
                 contentType=response.headers.get('Content-Type', ''))
            decoder = codecs.getincrementaldecoder('utf-8-sig')(errors='replace')
            size = 0
            while True:
                chunk = response.read1(4096)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_RESPONSE:
                    emit('error', message='模型响应超过 2 MB')
                    return RESPONSE_SENT
                text = decoder.decode(chunk, final=False)
                if text:
                    emit('chunk', text=text)
            tail = decoder.decode(b'', final=True)
            if tail:
                emit('chunk', text=tail)
            emit('done')
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        pass
    except (URLError, TimeoutError, OSError):
        try:
            emit('error', message=f'{selected["name"]} 测试连接失败或超时，已收到的内容保留')
        except OSError:
            pass
    except Exception:
        try:
            emit('error', message='模型响应中断，已收到的内容保留')
        except OSError:
            pass
    return RESPONSE_SENT


def stream_generate(handler, app, body):
    """Stream actual model output and stages; disconnects never skip Git archival."""
    from .server import RESPONSE_SENT, ApiError
    handler.send_response(200)
    handler.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
    handler.send_header('Cache-Control', 'no-store, no-transform')
    handler.send_header('X-Accel-Buffering', 'no')
    handler.send_header('Connection', 'close')
    handler.end_headers(); handler.close_connection = True
    connected = True
    started = time.monotonic()
    def emit(kind, **fields):
        nonlocal connected
        if not connected:
            return
        try:
            handler.wfile.write((json.dumps({'type':kind,'durationMs':round((time.monotonic()-started)*1000),**fields},ensure_ascii=False)+'\n').encode('utf8'))
            handler.wfile.flush()
        except OSError:
            connected = False
    try:
        emit('progress',message='正在检查生成配置…')
        result = generate(app, body, emit)
        emit('result',result=result)
    except Exception as error:
        emit('error',message=str(error) if isinstance(error,ApiError) else '代码生成失败，请检查生成服务日志')
    return RESPONSE_SENT


def generate(app, body, emit=None):
    from .server import ApiError
    selected = next((row for row in listing(app)['items'] if row['id'] == body.get('interfaceId')), None)
    if not selected or not selected['enabled']:
        raise ApiError('所选模型接口不存在或已停用')
    selected = dict(selected)
    from .generation_workspaces import output_subdirectory
    selected['_codeSubdirectory'] = output_subdirectory(body)
    if emit:
        selected['_emit'] = emit
    remote = selected.get('generationServerId') and selected['kind'] in ('agent', 'gemini-agent')
    if not remote:
        return _generate(app, body, selected)
    from . import generation_workspaces as workspaces
    from .code_servers import read, generation_root
    if body.get('configId'):
        body = workspaces.node_defaults(body)
        server = read(app, selected['generationServerId'])
        selected['prjDir'] = generation_root(server)
        selected['_workspaceDirectory'] = workspaces.directory(body)
    workspace = agent_directories(selected, body.get('taskId'))
    body = {**body, 'taskId': workspace['taskId']}
    if body.get('configId'):
        from .generation_git_bindings import match
        binding = match(server, workspace['codeDir'])
        if binding and body.get('destinationMode') != 'custom':
            body.update(repositoryId=binding['repositoryId'], directoryId=binding['directoryId'], destinationMode='custom')
    # Node generation always archives to its configured repository before releasing
    # the shared directory. A browser disconnect cannot skip the Git submission.
    if body.get('configId'):
        body.update(autoCommit=True, deferCommit=False)
    with workspaces.serialized_paths(selected['generationServerId'], [workspace['prjDir'], workspace['codeDir']], selected['timeoutSeconds']):
        if emit: emit('progress',message='正在准备代码生成工作空间…')
        started = workspaces.stamp()
        selected['_generationStartedAt'] = started
        common = {'configId': body.get('configId', ''), 'queueName': body.get('queueName', ''), 'startedAt': started}
        workspaces.receipt(app, selected['generationServerId'], workspace, **common, status='running')
        try:
            from .code_servers import operation
            from .generated_archives import relative_workspace_path
            code_path = relative_workspace_path(app, selected['generationServerId'], workspace['codeDir'])
            operation(app, selected['generationServerId'], {'action': 'mkdir', 'path': code_path})
            selected['_beforeCodeFiles'] = {item['path']: item['sha256'] for item in operation(
                app, selected['generationServerId'], {'action': 'export', 'paths': [code_path]})['files']}
            result = _generate(app, body, selected)
            archive = result.get('archive', {})
            workspaces.receipt(app, selected['generationServerId'], workspace, **common,
                               status='failed' if archive.get('status') == 'failed' else 'succeeded', finishedAt=workspaces.stamp(),
                               files=archive.get('files', []), gitCommit=archive.get('gitCommit', ''), pushed=archive.get('pushed', False),
                               message=archive.get('message', ''))
            return result
        except Exception as error:
            try:
                workspaces.receipt(app, selected['generationServerId'], workspace, **common,
                                   status='failed', finishedAt=workspaces.stamp(), message=str(error)[:1500])
            except Exception:
                pass
            raise


def _generate(app, body, selected):
    from .server import ApiError
    service = script_service()
    remote_target = None
    if selected.get('generationServerId') and selected['kind'] in ('agent', 'gemini-agent') and body.get('configId'):
        from .generated_archives import destination
        remote_target = destination(app, body)
    # Reuse the legacy input, filename and Python output contract without calling its model.
    payload = {key: body[key] for key in ('prompt', 'userPrompt', 'systemPrompt', 'url', 'sampleId') if key in body}
    user, system = payload.get('userPrompt', payload.get('prompt')), payload.get('systemPrompt', service.SYSTEM_PROMPT)
    if not isinstance(user, str) or not user.strip() or len(user) > 12000:
        raise ApiError('请填写 1–12000 字的用户提示词')
    if not isinstance(system, str) or not system.strip() or len(system) > 12000:
        raise ApiError('请填写 1–12000 字的系统提示词')
    try:
        from .generation_prompt_context import filename, variables, fill, compose
        file_name = filename(body, service)
    except service.GenerationError as exc:
        raise ApiError(str(exc), exc.status) from exc
    if payload.get('sampleId') != service.SAMPLE_ID:
        raise ApiError('样例代码标识无效')
    task_id = body.get('taskId')
    workspace = agent_directories(selected, task_id) if selected['kind'] in ('agent', 'gemini-agent') else None
    if workspace: task_id = workspace['taskId']
    values = variables(body, file_name, workspace)
    if selected['kind'] == 'site-script':
        payload.update(systemPrompt=fill(system, values), userPrompt=fill(user, values), prompt=fill(user, values))
        request = Request(selected['endpoint'], data=json.dumps(payload, ensure_ascii=False).encode('utf8'),
                          headers={'Content-Type': 'application/json'}, method='POST')
    else:
        # Required execution context precedes user text; no fixed sample and no
        # hidden suffix after the user's final MQ/context block.
        request = workbuddy_request(selected, compose(system, user, values), task_id)
    from .code_servers import model_request
    selected['_workspace'] = getattr(request, 'generation_workspace', None)
    emit = selected.get('_emit')
    if emit:
        emit('request',request=generation_request_details(request))
    request = model_request(app, selected, request)
    try:
        if emit: emit('progress',message='正在连接模型服务，等待过程输出…')
        with urlopen(request, timeout=selected['timeoutSeconds']) as response:
            if emit:
                decoder = codecs.getincrementaldecoder('utf-8-sig')(errors='replace')
                parts, size = [], 0
                while True:
                    chunk = getattr(response,'read1',response.read)(4096)
                    if not chunk: break
                    parts.append(chunk); size += len(chunk)
                    if size > MAX_RESPONSE:
                        raise ApiError('模型响应超过 2 MB，请精简生成内容',502)
                    text_chunk = decoder.decode(chunk,final=False)
                    if text_chunk: emit('chunk',text=text_chunk)
                tail = decoder.decode(b'',final=True)
                if tail: emit('chunk',text=tail)
                raw = b''.join(parts)
            else:
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ApiError('模型响应超过 2 MB，请精简生成内容', 502)
            text = decode_response(raw, response.headers.get('Content-Type', ''))
        if remote_target:
            if emit: emit('progress',message='模型生成完成，正在收集文件并提交 Git…')
            from .generated_archives import finish
            return finish(app, selected, remote_target, text, file_name, service)
        if emit: emit('progress',message='正在检查生成代码…')
        code = service.validate_code(service.normalize_code(text))
    except service.GenerationError as exc:
        raise ApiError(f'{selected["name"]}：{exc}', exc.status) from exc
    except HTTPError as exc:
        raise ApiError(f'{selected["name"]} 请求失败（HTTP {exc.code}）', 502) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise ApiError(f'{selected["name"]} 连接失败或超时，请检查接口地址和模型服务', 502) from exc
    except (UnicodeError, ValueError) as exc:
        raise ApiError(f'{selected["name"]} 返回内容无效', 502) from exc
    return {'fileName': file_name, 'code': code, 'warnings': [], 'interfaceId': selected['id'], 'model': selected['model'], 'workspace': selected.get('_workspace')}
