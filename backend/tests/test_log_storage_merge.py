import json
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.runner_management.store import Store
from backend.runner_management import log_records
from backend.runner_management.runtime_history import insert_record,add_event


class LogStorageMergeTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'runner.sqlite3'
        self.store=Store(self.path)

    def legacy(self):
        identifier='a'*32;delivery='b'*32;run='c'*32
        with self.store.connect() as db:
            for kind,task in (('generation','gen'),('deployment','deploy')):
                db.execute('INSERT INTO jobs(job_type,job_id,delivery_id,status,created_at,payload) VALUES(?,?,?,?,?,?)',
                           (kind,task,delivery if kind=='deployment' else '','succeeded','date','{}'))
            for record in (delivery,run):insert_record(db,record,{'runnerId':'runner','deploymentId':'layout'},'run',{})
            db.executescript('''
CREATE TABLE runtime_events(event_id TEXT PRIMARY KEY,record_id TEXT,occurred_at TEXT,stage TEXT,level TEXT,message TEXT,detail TEXT);
CREATE TABLE runtime_log_streams(stream_id TEXT PRIMARY KEY,record_id TEXT,runner_id TEXT,last_seq INTEGER,byte_count INTEGER,updated_at TEXT);
CREATE TABLE business_task_executions(task_id TEXT,record_id TEXT,stream_id TEXT,seq INTEGER,line_index INTEGER,occurred_at TEXT,status TEXT,topic TEXT,config_id TEXT,PRIMARY KEY(task_id,record_id,stream_id));
CREATE TABLE model_interface_calls(call_id TEXT PRIMARY KEY,interface_id TEXT,started_at TEXT,status TEXT,payload TEXT);
''')
            db.execute('INSERT INTO runtime_events VALUES(?,?,?,?,?,?,?)',(identifier,delivery,'date','verify','error','错误摘要','详细内容\n中文'))
            db.execute('INSERT INTO runtime_log_streams VALUES(?,?,?,?,?,?)',(identifier,run,'runner',7,1234,'date'))
            db.execute('INSERT INTO business_task_executions VALUES(?,?,?,?,?,?,?,?,?)',('73864132',run,identifier,7,2,'date','completed','news','1401218'))
            payload=json.dumps({'callId':identifier,'interfaceId':'agent','taskId':'gen','serverId':'agent-host',
                                'startedAt':'date','finishedAt':'later','status':'failed','durationMs':25,'message':'失败原因'})
            db.execute('INSERT INTO model_interface_calls VALUES(?,?,?,?,?)',(identifier,'agent','date','failed',payload))
        return identifier,delivery,run,payload

    def test_all_four_types_migrate_with_task_foreign_keys_and_original_ids(self):
        identifier,delivery,run,payload=self.legacy()
        for _ in range(2):
            self.store=Store(self.path)
            with self.store.connect() as db:
                rows={row['log_type']:dict(row) for row in db.execute('SELECT * FROM logs')}
                self.assertEqual(set(rows),{'event','stream','collection','model_call'})
                self.assertEqual(len(rows['event']),14)
                self.assertEqual((rows['event']['task_type'],rows['event']['task_id']),('deployment','deploy'))
                self.assertEqual((rows['model_call']['task_type'],rows['model_call']['task_id']),('generation','gen'))
                self.assertEqual(rows['model_call']['payload'],payload)
                self.assertEqual(json.loads(rows['event']['payload'])['detail'],'详细内容\n中文')
                self.assertEqual((rows['stream']['seq'],rows['stream']['byte_count']),(7,1234))
                self.assertEqual(rows['collection']['business_task_id'],'73864132')
                self.assertEqual(json.loads(rows['collection']['payload'])['streamId'],identifier)
                self.assertIsNone(rows['collection']['task_id'])
                self.assertEqual(rows['collection']['log_id'],log_records.collection_id('73864132',run,identifier))
                tables={row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertFalse({'runtime_events','runtime_log_streams','business_task_executions','model_interface_calls'} & tables)
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])

    def test_deleting_task_keeps_log_and_clears_reference(self):
        self.legacy();self.store=Store(self.path)
        with self.store.connect() as db:
            db.execute("DELETE FROM jobs WHERE job_type='generation' AND job_id='gen'")
            row=db.execute("SELECT * FROM logs WHERE log_type='model_call'").fetchone()
            self.assertIsNone(row['task_id']);self.assertIsNone(row['task_type'])
            self.assertEqual(json.loads(row['payload'])['taskId'],'gen')
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM logs').fetchone()['n'],4)

    def test_conflict_does_not_drop_legacy_logs_or_replace_existing_data(self):
        identifier,delivery,_,_=self.legacy()
        with self.store.connect() as db:
            value=log_records.empty('event',identifier);value.update(record_id=delivery,message='different')
            log_records.insert(db,value)
        with self.assertRaisesRegex(ValueError,'日志迁移校验失败'):Store(self.path)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM runtime_events').fetchone()[0],1)
            self.assertEqual(db.execute("SELECT message FROM logs WHERE log_type='event'").fetchone()[0],'different')

    def test_delivery_events_link_after_dispatch_and_keep_original_task_on_retry(self):
        delivery='d'*32
        with self.store.connect() as db:
            for kind in ('generation','deployment'):
                db.execute('INSERT INTO jobs(job_type,job_id,status,created_at,payload) VALUES(?,?,?,?,?)',
                           (kind,'same-id','queued','date','{}'))
            insert_record(db,delivery,{'runnerId':'runner','deploymentId':'layout'},'delivery',{})
            add_event(db,delivery,'created','早于任务回写的事件')
            db.execute("UPDATE jobs SET delivery_id=? WHERE job_type='deployment'",(delivery,))
            log_records.link_delivery(db,{'jobId':'same-id','deliveryId':delivery})
            add_event(db,delivery,'verify','校验')
            db.execute("UPDATE jobs SET delivery_id='new-attempt' WHERE job_type='deployment'")
            add_event(db,delivery,'finished','重试期间收到的旧回执')
            rows=db.execute("SELECT task_type,task_id FROM logs WHERE log_type='event'").fetchall()
            self.assertEqual(len(rows),3)
            self.assertTrue(all((row['task_type'],row['task_id'])==('deployment','same-id') for row in rows))


if __name__=='__main__':unittest.main()
