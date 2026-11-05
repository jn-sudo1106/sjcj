"""Manage public node prompt templates in the existing business database."""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
import re
import uuid

from .store import MySqlConnection


@contextmanager
def connection():
    from .server import ApiError
    import pymysql
    if any(not os.getenv('NODE_PROMPT_DB_' + key) for key in ('HOST', 'NAME', 'USER', 'PASSWORD')):
        raise ApiError('提示词数据库尚未配置，请配置管理服务 NODE_PROMPT_DB_*', 503)
    db = pymysql.connect(host=os.environ['NODE_PROMPT_DB_HOST'], port=int(os.getenv('NODE_PROMPT_DB_PORT', '8102')),
        database=os.environ['NODE_PROMPT_DB_NAME'], user=os.environ['NODE_PROMPT_DB_USER'],
        password=os.environ['NODE_PROMPT_DB_PASSWORD'], charset='utf8mb4', connect_timeout=5, read_timeout=10, write_timeout=10)
    try:
        yield MySqlConnection(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def read(db, body, *, lock=False):
    from .server import ApiError
    identifier = body.get('promptId')
    if isinstance(identifier, bool) or not re.fullmatch(r'[1-9][0-9]{0,17}', str(identifier)):
        raise ApiError('提示词 ID 无效')
    use = body.get('templateUse')
    kind, name = body.get('sourceType'), body.get('nodeTypeName')
    if use not in ('script', 'config') or not isinstance(kind, str) or not re.fullmatch(r'[0-9]{1,10}', kind) or not isinstance(name, str) or not name or len(name) > 200:
        raise ApiError('请提供当前节点类型和模板用途')
    suffix = ' FOR UPDATE' if lock and isinstance(db, MySqlConnection) else ''
    row = db.execute('SELECT * FROM cfg_llm_node_prompt WHERE prompt_id=?' + suffix, (int(identifier),)).fetchone()
    row = normalize(row) if row else None
    if not row or int(row.get('is_delete') or 0) < 0:
        raise ApiError('提示词模板不存在或已删除，请刷新', 404)
    if row['template_use'] != use or (str(row['node_type']) != kind and row['node_type_name'] != name):
        raise ApiError('提示词不属于当前节点类型和用途', 409)
    revision = row_revision(row)
    selections_exist = not isinstance(db, MySqlConnection) or db.execute(
        'SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',
        ('cfg_llm_node_prompt_selection',)).fetchone()['total'] > 0
    refs = db.execute('SELECT COUNT(*) total FROM cfg_llm_node_prompt_selection WHERE prompt_id=?', (int(identifier),)).fetchone()['total'] if selections_exist else 0
    reason = '请先将其他模板设为默认，再删除当前默认模板' if row['is_default'] else f'有 {refs} 个节点正在选择此模板，请先更换节点的提示词模板' if refs else ''
    return row, {'promptId': int(identifier), 'promptName': row['prompt_name'], 'revision': revision,
                 'referenceCount': refs, 'canDelete': not reason, 'reason': reason}


def preview(app, body):
    with connection() as db:
        return read(db, body)[1]


def remove(app, body):
    from .server import ApiError, GIT_LOCK
    with GIT_LOCK, connection() as db:
        row, current = read(db, body, lock=True)
        if body.get('revision') != current['revision']:
            raise ApiError('提示词已被修改，请刷新后重新确认删除', 409)
        if not current['canDelete']:
            raise ApiError(current['reason'], 409)
        folder = app.data_dir / 'node-prompt-trash'
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        backup = folder / (str(current['promptId']) + '-' + uuid.uuid4().hex + '.json')
        with backup.open('x', encoding='utf8') as output:
            os.chmod(backup, 0o600)
            json.dump({'deletedAt': datetime.now(timezone.utc).isoformat(), 'prompt': row}, output, ensure_ascii=False, default=str)
        db.execute('DELETE FROM cfg_llm_node_prompt WHERE prompt_id=?', (current['promptId'],))
        return {'deleted': True, 'promptId': current['promptId']}


def normalize(row):
    return {key.lower(): value for key, value in dict(row).items()}


def row_revision(row):
    return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def public(row):
    fields = ('prompt_id', 'prompt_name', 'node_type', 'node_type_name', 'category', 'template_use', 'system_prompt',
              'user_prompt_template', 'output_schema', 'parameters', 'example_input', 'example_output',
              'is_active', 'is_default', 'created_at', 'updated_at', 'created_by', 'updated_by')
    result = {}
    for key in fields:
        head, *tail = key.split('_')
        value = row.get(key)
        result[head + ''.join(part.title() for part in tail)] = value.isoformat() if isinstance(value, datetime) else value
    result['promptName'] = result['promptName'] or str(row['node_type_name']) + '提示词 ' + str(row['prompt_id'])
    result['revision'] = row_revision(row)
    return result


def legacy_revision(row):
    # Accept the revision of an already-open Java editor without discarding its text.
    values = public(row)
    values.pop('revision')
    values['promptName'] = row.get('prompt_name')
    for key in ('createdAt', 'updatedAt'):
        value = values.get(key)
        if value:
            date = datetime.fromisoformat(value)
            if date.tzinfo is None: date = date.replace(tzinfo=timezone(timedelta(hours=8)))
            values[key] = int(date.timestamp() * 1000)
    return hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def type_name(db, kind):
    from .server import ApiError
    if not isinstance(kind, str) or not re.fullmatch(r'[0-9]{1,10}', kind):
        raise ApiError('节点类型 ID 无效')
    row = db.execute('SELECT TYPE_NAME type_name FROM cfg_source_type WHERE SOURCE_TYPE=?', (kind,)).fetchone()
    if not row or not row['type_name']:
        raise ApiError('节点类型不存在，请刷新节点类型列表', 404)
    return row['type_name']


def scoped_rows(db, body):
    from .server import ApiError
    use = body.get('templateUse')
    if use not in ('config', 'script'):
        raise ApiError('模板用途无效')
    kind = body.get('sourceType')
    name = type_name(db, kind) if kind else body.get('nodeTypeName')
    if not isinstance(name, str) or not name:
        raise ApiError('请选择节点类型')
    rows = db.execute('SELECT * FROM cfg_llm_node_prompt WHERE template_use=? AND (node_type=? OR node_type_name=?)', (use, kind or '', name)).fetchall()
    return sorted((normalize(row) for row in rows if int(normalize(row).get('is_delete') or 0) >= 0), key=lambda row: (-int(row['is_default']), row['prompt_id']))


def listing(app, body):
    with connection() as db:
        return [public(row) for row in scoped_rows(db, body) if not body.get('category') or row.get('category') == body['category']]


def save(app, body, actor='management-service'):
    from .server import ApiError, GIT_LOCK
    def text(key, limit, required=False):
        value = body.get(key, '')
        if value is None: value = ''
        if not isinstance(value, str) or len(value) > limit or required and not value.strip():
            raise ApiError(key + ' 不能为空或超出长度限制')
        return value.strip()
    def flag(key):
        value = body.get(key)
        if type(value) is not int or value not in (0, 1): raise ApiError(key + ' 状态无效')
        return value
    name, system, user = text('promptName', 100, True), text('systemPrompt', 12000, True), text('userPromptTemplate', 12000)
    category, example = text('category', 50, True), text('exampleOutput', 12000)
    active, default = flag('isActive'), flag('isDefault')
    if default and not active: raise ApiError('默认模板必须启用')
    extras = []
    for key in ('outputSchema', 'parameters', 'exampleInput'):
        value = body.get(key)
        if value in (None, ''): extras.append(None); continue
        try:
            encoded = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            if len(encoded) > 60000: raise ValueError()
            json.loads(encoded)
        except (TypeError, ValueError): raise ApiError(key + ' 必须是有效 JSON（最多 60000 字）')
        extras.append(encoded)
    identifier = body.get('promptId', 0)
    if type(identifier) is not int or not 0 <= identifier < 10**18: raise ApiError('提示词 ID 无效')
    with GIT_LOCK, connection() as db:
        kind = body.get('sourceType')
        actual_name = type_name(db, kind)
        use = body.get('templateUse')
        # Lock this type for writes made by either management service.
        if isinstance(db, MySqlConnection):
            db.execute('SELECT SOURCE_TYPE FROM cfg_source_type WHERE SOURCE_TYPE=? FOR UPDATE', (kind,)).fetchone()
        rows = scoped_rows(db, {**body, 'nodeTypeName': actual_name})
        current = next((row for row in rows if row['prompt_id'] == identifier), None)
        if identifier and not current: raise ApiError('模板不存在或不属于当前节点类型和用途', 404)
        if current and body.get('revision') not in (row_revision(current), legacy_revision(current)): raise ApiError('模板已被修改，请刷新后重试', 409)
        if any(row['prompt_id'] != identifier and row['prompt_name'] == name for row in rows): raise ApiError('该类型下已存在同名提示词，请修改名称', 409)
        if default:
            for row in rows:
                if row['is_default'] and row['prompt_id'] != identifier:
                    db.execute('UPDATE cfg_llm_node_prompt SET is_default=0 WHERE prompt_id=?', (row['prompt_id'],))
        values = (name, category, system, user, *extras, example, active, default, actor[:50])
        if current:
            db.execute('UPDATE cfg_llm_node_prompt SET prompt_name=?,category=?,system_prompt=?,user_prompt_template=?,output_schema=?,parameters=?,example_input=?,example_output=?,is_active=?,is_default=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE prompt_id=?', (*values, identifier))
        else:
            cursor = db.execute('INSERT INTO cfg_llm_node_prompt (prompt_name,category,system_prompt,user_prompt_template,output_schema,parameters,example_input,example_output,is_active,is_default,updated_by,node_type,node_type_name,template_use,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (*values, kind, actual_name, use, actor[:50]))
            identifier = cursor.lastrowid
        return public(normalize(db.execute('SELECT * FROM cfg_llm_node_prompt WHERE prompt_id=?', (identifier,)).fetchone()))
