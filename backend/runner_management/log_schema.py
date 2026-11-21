"""Unified log metadata and verified, resumable migration of four legacy tables."""
import json
from .log_records import FIELDS,migrated_row

LEGACY = {'event':('runtime_events','event_id'), 'stream':('runtime_log_streams','stream_id'),
          'collection':('business_task_executions',None), 'model_call':('model_interface_calls','call_id')}
SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS logs (
 log_type TEXT NOT NULL CHECK(log_type IN ('event','stream','collection','model_call')),log_id TEXT NOT NULL,
 record_id TEXT NOT NULL DEFAULT '',task_type TEXT,task_id TEXT,business_task_id TEXT NOT NULL DEFAULT '',
 occurred_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '',
 message TEXT NOT NULL DEFAULT '',seq INTEGER NOT NULL DEFAULT 0,line_index INTEGER NOT NULL DEFAULT 0,
 byte_count INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL,
 PRIMARY KEY(log_type,log_id),FOREIGN KEY(task_type,task_id) REFERENCES jobs(job_type,job_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS log_record ON logs(log_type,record_id,occurred_at,log_id);
CREATE INDEX IF NOT EXISTS log_time ON logs(log_type,occurred_at,log_id);
CREATE INDEX IF NOT EXISTS log_business_task ON logs(log_type,business_task_id,occurred_at);
CREATE INDEX IF NOT EXISTS log_retention ON logs(log_type,updated_at);
CREATE INDEX IF NOT EXISTS log_task ON logs(task_type,task_id);
"""
MYSQL_SCHEMA = """
CREATE TABLE IF NOT EXISTS ce_runner_logs (
 log_type VARCHAR(20) NOT NULL,log_id VARCHAR(64) NOT NULL,
 record_id VARCHAR(32) NOT NULL DEFAULT '',task_type VARCHAR(20) NULL,task_id VARCHAR(80) NULL,
 business_task_id VARCHAR(128) NOT NULL DEFAULT '',
 occurred_at VARCHAR(50) NOT NULL DEFAULT '',updated_at VARCHAR(50) NOT NULL DEFAULT '',status VARCHAR(30) NOT NULL DEFAULT '',
 message TEXT NOT NULL,seq BIGINT NOT NULL DEFAULT 0,line_index INT NOT NULL DEFAULT 0,
 byte_count BIGINT NOT NULL DEFAULT 0,payload LONGTEXT NOT NULL,PRIMARY KEY(log_type,log_id),
 INDEX log_record(log_type,record_id,occurred_at,log_id),INDEX log_time(log_type,occurred_at,log_id),
 INDEX log_business_task(log_type,business_task_id,occurred_at),INDEX log_retention(log_type,updated_at),INDEX log_task(task_type,task_id),
 FOREIGN KEY(task_type,task_id) REFERENCES ce_runner_jobs(job_type,job_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


def contexts(execute):
    records={row['record_id']:{'_server_id':row['runner_id'],'_executor_id':row['deployment_id']}
             for row in execute('SELECT record_id,runner_id,deployment_id FROM runtime_operations').fetchall()}
    generations=set()
    for job in execute('SELECT job_type,job_id,delivery_id,payload FROM jobs ORDER BY created_at,job_id').fetchall():
        if job['job_type']=='generation':generations.add(job['job_id']);continue
        data=json.loads(job['payload']);deliveries=list(data.get('deliveryHistory') or [])
        if job['delivery_id']:deliveries.append(job['delivery_id'])
        for identifier in deliveries:
            item=records.setdefault(identifier,{})
            if '_task_id' not in item:item.update(_task_type='deployment',_task_id=job['job_id'])
    return records,generations


def normalized(kind,row,records,generations):
    row=dict(row)
    row.update(records.get(row.get('record_id'),{}))
    if kind=='model_call':
        identifier=json.loads(row['payload']).get('taskId')
        if identifier in generations:row.update(_task_type='generation',_task_id=identifier)
    return migrated_row(kind,row)


def sqlite_migrate(db):
    from .log_stream_schema import sqlite_migrate as migrate_stream
    migrate_stream(db)
    existing={row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not any(table in existing for table,_ in LEGACY.values()):return
    records,generations=contexts(db.execute)
    for kind,(table,_) in LEGACY.items():
        if table not in existing:continue
        count=0
        reader=db.execute('SELECT * FROM '+table)
        while batch:=reader.fetchmany(200):
            for row in batch:
                value=normalized(kind,row,records,generations)
                db.execute('INSERT OR IGNORE INTO logs ('+','.join(FIELDS)+') VALUES ('+','.join('?' for _ in FIELDS)+')',tuple(value[name] for name in FIELDS))
                actual=db.execute('SELECT * FROM logs WHERE log_type=? AND log_id=?',(kind,value['log_id'])).fetchone()
                if dict(actual)!=value:raise ValueError('日志迁移校验失败：'+kind+'/'+value['log_id'])
                count+=1
        if db.execute('SELECT COUNT(*) n FROM logs WHERE log_type=?',(kind,)).fetchone()['n']!=count:raise ValueError('日志迁移数量不一致：'+kind)
    for table,_ in LEGACY.values():
        if table in existing:db.execute('DROP TABLE '+table)


def mysql_migrate(cursor):
    from .log_stream_schema import mysql_migrate as migrate_stream
    migrate_stream(cursor)
    class Result:
        def fetchall(self):
            names=[item[0] for item in cursor.description]
            return [dict(zip(names,row)) for row in cursor.fetchall()]
    def execute(sql):
        import re
        cursor.execute(re.sub(r'\b(runtime_operations|jobs)\b',lambda match:'ce_runner_'+match.group(),sql))
        return Result()
    cursor.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()')
    existing={row[0] for row in cursor.fetchall()}
    if not any('ce_runner_'+table in existing for table,_ in LEGACY.values()):return
    records,generations=contexts(execute)
    copied=[]
    for kind,(table,key) in LEGACY.items():
        table='ce_runner_'+table
        if table not in existing:continue
        last='';count=0
        while True:
            sql='SELECT * FROM '+table+((' WHERE '+key+'>%s ORDER BY '+key+' LIMIT 400') if key else '')
            cursor.execute(sql,(last,) if key else None)
            names=[item[0] for item in cursor.description]
            batch=[dict(zip(names,row)) for row in cursor.fetchall()]
            if not batch:break
            values=[normalized(kind,row,records,generations) for row in batch]
            cursor.executemany('INSERT IGNORE INTO ce_runner_logs ('+','.join(FIELDS)+') VALUES ('+','.join('%s' for _ in FIELDS)+')',
                               [tuple(value[name] for name in FIELDS) for value in values])
            cursor.execute('SELECT * FROM ce_runner_logs WHERE log_type=%s AND log_id IN ('+','.join('%s' for _ in values)+')',
                           (kind,*(value['log_id'] for value in values)))
            names=[item[0] for item in cursor.description]
            actual={row['log_id']:row for row in (dict(zip(names,item)) for item in cursor.fetchall())}
            if any(actual.get(value['log_id'])!=value for value in values):raise ValueError('日志迁移校验失败：'+kind)
            count+=len(batch)
            if not key:break
            last=batch[-1][key]
        cursor.execute('SELECT COUNT(*) FROM ce_runner_logs WHERE log_type=%s',(kind,))
        if cursor.fetchone()[0]!=count:raise ValueError('日志迁移数量不一致：'+kind)
        copied.append(table)
        cursor.connection.commit()
    for table in copied:cursor.execute('DROP TABLE '+table)
