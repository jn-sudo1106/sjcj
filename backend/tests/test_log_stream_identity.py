import json
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.runner_management.store import Store
from backend.runner_management import log_records


class LogStreamIdentityTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'runner.sqlite3';self.store=Store(self.path)

    def legacy(self):
        with self.store.connect() as db:
            db.execute("ALTER TABLE logs ADD COLUMN stream_id TEXT NOT NULL DEFAULT ''")
            stream=log_records.empty('stream','a'*32);stream.update(seq=8,byte_count=1234,record_id='record')
            log_records.insert(db,stream)
            value=log_records.empty('collection','b'*64)
            value.update(record_id='record',business_task_id='73864132',payload=json.dumps({'topic':'news','configId':'1401218'}))
            log_records.insert(db,value)
            db.execute("UPDATE logs SET stream_id=?",('a'*32,))

    def test_stream_id_is_log_id_and_collection_link_survives_restarts(self):
        self.legacy()
        for _ in range(2):
            self.store=Store(self.path)
            with self.store.connect() as db:
                columns={row['name'] for row in db.execute('PRAGMA table_info(logs)')}
                self.assertEqual(len(columns),14);self.assertFalse({'stream_id','server_id','executor_id'} & columns)
                stream=db.execute(log_records.STREAM_SELECT+' AND log_id=?',('a'*32,)).fetchone()
                self.assertEqual((stream['stream_id'],stream['last_seq'],stream['byte_count']),('a'*32,8,1234))
                item=db.execute("SELECT * FROM logs WHERE log_type='collection'").fetchone()
                self.assertEqual(json.loads(item['payload']),{'topic':'news','configId':'1401218','streamId':'a'*32})
                self.assertEqual((item['log_id'],item['business_task_id']),('b'*64,'73864132'))

    def test_conflicting_stream_identity_keeps_old_column_and_data(self):
        self.legacy()
        with self.store.connect() as db:db.execute("UPDATE logs SET stream_id=? WHERE log_type='stream'",('c'*32,))
        with self.assertRaisesRegex(ValueError,'不一致'):Store(self.path)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertIn('stream_id',{row[1] for row in db.execute('PRAGMA table_info(logs)')})
            self.assertEqual(db.execute("SELECT stream_id FROM logs WHERE log_type='stream'").fetchone()[0],'c'*32)

    def test_actor_columns_are_removed_without_losing_unassociated_snapshots(self):
        self.legacy()
        with self.store.connect() as db:
            for name in ('server_id','executor_id'):db.execute(f"ALTER TABLE logs ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
            db.execute("UPDATE logs SET server_id='old-machine',executor_id='old-executor' WHERE log_type='collection'")
        self.store=Store(self.path)
        with self.store.connect() as db:
            value=json.loads(db.execute("SELECT payload FROM logs WHERE log_type='collection'").fetchone()['payload'])
            self.assertEqual((value['serverId'],value['executorId'],value['streamId']),('old-machine','old-executor','a'*32))
            self.assertEqual(len(db.execute('PRAGMA table_info(logs)').fetchall()),14)


if __name__=='__main__':unittest.main()
