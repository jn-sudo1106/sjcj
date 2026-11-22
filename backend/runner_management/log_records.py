"""Common storage for process events, stream cursors, collection facts and model calls."""
import hashlib
import json

FIELDS = ('log_type','log_id','record_id','task_type','task_id','business_task_id',
          'occurred_at','updated_at','status','message','seq','line_index','byte_count','payload')
STREAM_SELECT = ("SELECT log_id AS stream_id,record_id,seq AS last_seq,byte_count,updated_at "
                 "FROM logs WHERE log_type='stream'")


def collection_id(task_id, record_id, stream_id):
    return hashlib.sha256(json.dumps([task_id,record_id,stream_id],separators=(',',':')).encode()).hexdigest()


def empty(kind, identifier):
    return {name: None if name in ('task_type','task_id') else 0 if name in ('seq','line_index','byte_count') else '{}' if name=='payload' else
            kind if name=='log_type' else identifier if name=='log_id' else '' for name in FIELDS}


def encode(data):
    return json.dumps(data,ensure_ascii=False,separators=(',',':'))


def migrated_row(kind, row):
    row=dict(row)
    identifier = (row['event_id'] if kind=='event' else row['stream_id'] if kind=='stream' else row['call_id'] if kind=='model_call'
                  else collection_id(row['task_id'],row['record_id'],row['stream_id']))
    value=empty(kind,identifier)
    value.update(task_type=row.get('_task_type'),task_id=row.get('_task_id'))
    if kind=='event':
        value.update(record_id=row['record_id'],occurred_at=row['occurred_at'],updated_at=row['occurred_at'],
                     message=row['message'],payload=encode({key:row[key] for key in ('stage','level','detail')}))
    elif kind=='stream':
        value.update(record_id=row['record_id'],seq=row['last_seq'],byte_count=row['byte_count'],
                     occurred_at=row['updated_at'],updated_at=row['updated_at'],
                     payload=encode({'serverId':row['runner_id']}) if row['runner_id'] and row.get('_server_id')!=row['runner_id'] else '{}')
    elif kind=='collection':
        value.update(record_id=row['record_id'],business_task_id=row['task_id'],seq=row['seq'],line_index=row['line_index'],
                     occurred_at=row['occurred_at'],updated_at=row['occurred_at'],status=row['status'],
                     payload=encode({'topic':row['topic'],'configId':row['config_id'],'streamId':row['stream_id']}))
    elif kind=='model_call':
        data=json.loads(row['payload'])
        value.update(occurred_at=row['started_at'],updated_at=data.get('finishedAt') or row['started_at'],status=row['status'],
                     message=str(data.get('message') or ''),payload=row['payload'])
    else:
        raise ValueError('未知日志类型')
    return value


def insert(db, value, *, ignore=False):
    return db.execute(('INSERT OR IGNORE' if ignore else 'INSERT')+' INTO logs ('+','.join(FIELDS)+') VALUES ('+
                      ','.join('?' for _ in FIELDS)+')',tuple(value[name] for name in FIELDS))


def context(db, record_id):
    row=db.execute('SELECT runner_id,deployment_id,kind FROM runtime_operations WHERE record_id=?',(record_id,)).fetchone()
    result={'_server_id':row['runner_id'],'_executor_id':row['deployment_id']} if row else {}
    if row and row['kind']!='delivery':return result
    job=db.execute("SELECT job_id FROM jobs WHERE job_type='deployment' AND delivery_id=? ORDER BY created_at,job_id LIMIT 1",(record_id,)).fetchone()
    if not job:
        from .delivery_tasks import owner
        attempt = owner(db, record_id)
        if attempt:
            job = {'job_id': attempt['job_id']}
    if not job:
        previous=db.execute("SELECT task_id FROM logs WHERE log_type='event' AND record_id=? AND task_type='deployment' AND task_id IS NOT NULL LIMIT 1",(record_id,)).fetchone()
        if previous:result.update(_task_type='deployment',_task_id=previous['task_id'])
    if job:result.update(_task_type='deployment',_task_id=job['job_id'])
    return result


def event(row):
    data=json.loads(row['payload'])
    return {'event_id':row['log_id'],'record_id':row['record_id'],'occurred_at':row['occurred_at'],
            'message':row['message'],**{key:data.get(key,'') for key in ('stage','level','detail')}}


def events(db, identifiers):
    if not identifiers:return []
    rows=db.execute("SELECT log_id,record_id,occurred_at,message,payload FROM logs WHERE log_type='event' AND record_id IN ("+
                    ','.join('?' for _ in identifiers)+') ORDER BY occurred_at,log_id',tuple(identifiers)).fetchall()
    return [event(row) for row in rows]


def insert_call(db, data, *, ignore=False):
    job=db.execute("SELECT job_id FROM jobs WHERE job_type='generation' AND job_id=?",(data.get('taskId') or '',)).fetchone()
    return insert(db,migrated_row('model_call',{'call_id':data['callId'],'interface_id':data['interfaceId'],
                  'started_at':data['startedAt'],'status':data['status'],'payload':json.dumps(data,ensure_ascii=False),
                  '_task_type':'generation' if job else None,'_task_id':job['job_id'] if job else None}),ignore=ignore)


def update_call(db, data):
    db.execute("UPDATE logs SET status=?,updated_at=?,message=?,payload=? WHERE log_type='model_call' AND log_id=?",
               (data['status'],data.get('finishedAt') or data['startedAt'],data.get('message') or '',json.dumps(data,ensure_ascii=False),data['callId']))


def link_delivery(db, job):
    identifiers = set(job.get('deliveryHistory') or []) | set((job.get('deliveryAttempts') or {}).keys())
    if job.get('deliveryId'):identifiers.add(job['deliveryId'])
    identifiers = sorted(identifier for identifier in identifiers if isinstance(identifier,str) and identifier)
    if identifiers:
        db.execute("UPDATE logs SET task_type='deployment',task_id=? WHERE log_type IN ('event','stream') AND record_id IN ("+
                   ','.join('?' for _ in identifiers)+') AND task_id IS NULL', (job['jobId'],*identifiers))


def interface_expression(db):
    from .store import MySqlConnection
    if isinstance(db,MySqlConnection):
        return "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.executorId')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.interfaceId')))"
    return "COALESCE(json_extract(payload,'$.executorId'),json_extract(payload,'$.interfaceId'))"
