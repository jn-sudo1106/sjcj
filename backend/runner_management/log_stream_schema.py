"""Keep stream identity in log_id and derive actors from related records."""
import json
from .log_records import encode

REMOVED = ('stream_id','server_id','executor_id')


def compacted_payload(row):
    data=None
    def preserve(key,value):
        nonlocal data
        if data is None:data=json.loads(row['payload'])
        if not isinstance(data,dict) or data.get(key) not in (None,'',value):
            raise ValueError('日志关联冲突，不能删除旧字段')
        data[key]=value
    stream=row.get('stream_id') or ''
    if row['log_type']=='stream':
        if stream and stream!=row['log_id']:raise ValueError('日志流 ID 与日志记录 ID 不一致，不能删除旧字段')
    elif stream:preserve('streamId',stream)
    for column,key,derived in (('server_id','serverId','_derived_server'),('executor_id','executorId','_derived_executor')):
        value=row.get(column) or ''
        if value and value!=(row.get(derived) or ''):preserve(key,value)
    return encode(data) if data is not None else row['payload']


def candidate_query(columns,*,mysql=False):
    old=[name for name in REMOVED if name in columns]
    if not old:return None
    prefix='ce_runner_' if mysql else ''
    def extract(key):
        return f"JSON_UNQUOTE(JSON_EXTRACT(l.payload,'$.{key}'))" if mysql else f"json_extract(l.payload,'$.{key}')"
    server="CASE WHEN l.log_type='model_call' THEN COALESCE("+extract('serverId')+",'') ELSE COALESCE(NULLIF(o.runner_id,''),NULLIF(j.server_id,''),'') END"
    executor="CASE WHEN l.log_type='model_call' THEN COALESCE("+extract('executorId')+","+extract('interfaceId')+",'') ELSE COALESCE(NULLIF(o.deployment_id,''),NULLIF(j.executor_id,''),'') END"
    selected=','.join(('l.'+name if name in old else "''")+' AS '+name for name in REMOVED)
    clauses=[]
    if 'stream_id' in old:clauses.append("l.stream_id<>''")
    for name,derived in (('server_id',server),('executor_id',executor)):
        if name in old:clauses.append("(l."+name+"<>'' AND l."+name+'<>('+derived+'))')
    return ('SELECT l.log_type,l.log_id,l.payload,'+selected+','+server+' AS _derived_server,'+executor+' AS _derived_executor '
            'FROM '+prefix+'logs l LEFT JOIN '+prefix+'runtime_operations o ON o.record_id=l.record_id '
            'LEFT JOIN '+prefix+'jobs j ON j.job_type=l.task_type AND j.job_id=l.task_id WHERE '+' OR '.join(clauses))


def sqlite_migrate(db):
    columns={row['name'] for row in db.execute('PRAGMA table_info(logs)')}
    query=candidate_query(columns)
    if query:
        rows=[dict(row) for row in db.execute(query).fetchall()]
        changes=[(row,compacted_payload(row)) for row in rows]
        if not db.in_transaction:db.execute('BEGIN IMMEDIATE')
        for row,payload in changes:
            if payload!=row['payload']:db.execute('UPDATE logs SET payload=? WHERE log_type=? AND log_id=?',(payload,row['log_type'],row['log_id']))
            actual=db.execute('SELECT payload FROM logs WHERE log_type=? AND log_id=?',(row['log_type'],row['log_id'])).fetchone()
            if actual['payload']!=payload:raise ValueError('日志关联迁移后校验失败')
        db.execute('DROP INDEX IF EXISTS log_executor')
        for name in REMOVED:
            if name in columns:db.execute('ALTER TABLE logs DROP COLUMN '+name)
    db.execute('CREATE INDEX IF NOT EXISTS log_time ON logs(log_type,occurred_at,log_id)')


def mysql_migrate(cursor):
    cursor.execute('SHOW COLUMNS FROM ce_runner_logs');columns={row[0] for row in cursor.fetchall()}
    query=candidate_query(columns,mysql=True)
    if query:
        cursor.execute(query);names=[item[0] for item in cursor.description]
        rows=[dict(zip(names,row)) for row in cursor.fetchall()]
        changes=[(row,compacted_payload(row)) for row in rows]
        for row,payload in changes:
            if payload!=row['payload']:cursor.execute('UPDATE ce_runner_logs SET payload=%s WHERE log_type=%s AND log_id=%s',(payload,row['log_type'],row['log_id']))
            cursor.execute('SELECT payload FROM ce_runner_logs WHERE log_type=%s AND log_id=%s',(row['log_type'],row['log_id']))
            if cursor.fetchone()[0]!=payload:raise ValueError('日志关联迁移后校验失败')
        cursor.connection.commit()
        cursor.execute('SHOW INDEX FROM ce_runner_logs')
        if any(row[2]=='log_executor' for row in cursor.fetchall()):cursor.execute('DROP INDEX log_executor ON ce_runner_logs')
        cursor.execute('ALTER TABLE ce_runner_logs '+','.join('DROP COLUMN '+name for name in REMOVED if name in columns))
    cursor.execute('SHOW INDEX FROM ce_runner_logs')
    if not any(row[2]=='log_time' for row in cursor.fetchall()):cursor.execute('CREATE INDEX log_time ON ce_runner_logs(log_type,occurred_at,log_id)')
