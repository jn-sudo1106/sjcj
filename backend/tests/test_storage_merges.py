import json
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from backend.runner_management.store import Store
from backend.runner_management import database_generation, generation_dispatcher
from backend.runner_management.artifacts import ArtifactStore
from backend.runner_management.release_records import backfill, register


class StorageMergesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'runner.sqlite3'

    def legacy(self):
        from backend.runner_management.job_schema import GENERATION_COLUMNS, DEPLOYMENT_COLUMNS
        db = sqlite3.connect(self.path)
        db.executescript("""
        CREATE TABLE releases(digest TEXT PRIMARY KEY,kind TEXT,name TEXT,platform TEXT,git_commit TEXT,
          status TEXT,published_at TEXT,signature TEXT,entry TEXT,git_url TEXT);
        CREATE TABLE code_assets(code_id TEXT PRIMARY KEY,config_id TEXT,queue_name TEXT,site_host TEXT,
          storage_path TEXT,created_at TEXT,repo_id TEXT);
        CREATE TABLE code_versions(digest TEXT PRIMARY KEY REFERENCES releases(digest),code_id TEXT REFERENCES code_assets(code_id),
          git_commit TEXT,git_url TEXT,delivery_path TEXT,prompt TEXT,source_url TEXT,published_at TEXT);
        CREATE TABLE code_runtime_bindings(environment TEXT,config_id TEXT,queue_name TEXT,site_host TEXT,
          digest TEXT REFERENCES code_versions(digest),PRIMARY KEY(environment,config_id,queue_name,site_host));
        INSERT INTO releases VALUES('sha256:old','script','news','any','commit','published','old-release-date','signature','main.py','git');
        INSERT INTO code_assets VALUES('asset','101','news','','main.py','date','repo');
        INSERT INTO code_versions VALUES('sha256:old','asset','commit','git','main.py','prompt','https://site','version-date');
        INSERT INTO code_runtime_bindings VALUES('test','101','news','','sha256:old');
        """)
        for table, columns in (('generation_jobs', GENERATION_COLUMNS), ('deployment_jobs', DEPLOYMENT_COLUMNS)):
            db.execute('CREATE TABLE ' + table + '(' + ','.join(name + (' REAL' if name == 'lease_until' else ' TEXT') for name in columns) + ')')
        generation = dict.fromkeys(GENERATION_COLUMNS, '')
        generation.update(task_id='a' * 32, interface_id='agent-interface',server_id='agent-machine',status='claimed', lease_until=123.5,
                          payload=json.dumps({'taskId': 'a'*32, 'status': 'claimed', 'result': None}))
        deployment = dict.fromkeys(DEPLOYMENT_COLUMNS, '')
        deployment.update(job_id='a'*32, task_id='parent-generation',runner_id='runner-machine',deployment_id='deployment-config',status='delivering', delivery_id='delivery',
                          payload=json.dumps({'jobId': 'a'*32, 'deliveryHistory': ['old-delivery'], 'executionEvents': [{'stage': 'verify'}]}))
        for table, row in (('generation_jobs', generation), ('deployment_jobs', deployment)):
            db.execute('INSERT INTO ' + table + ' VALUES(' + ','.join('?' for _ in row) + ')', tuple(row.values()))
        db.commit(); db.close()
        return generation, deployment

    def test_existing_versions_and_both_job_types_survive_and_old_tables_stay_absent(self):
        generation, deployment = self.legacy()
        for _ in range(2):
            store = Store(self.path)
            with store.connect() as db:
                tables = {row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertFalse({'code_versions', 'generation_jobs', 'deployment_jobs'} & tables)
                row = db.execute("SELECT * FROM releases WHERE digest='sha256:old'").fetchone()
                self.assertEqual((row['prompt'], row['repo_id'], row['published_at']), ('prompt','repo','version-date'))
                self.assertEqual(db.execute('PRAGMA foreign_key_list(code_runtime_bindings)').fetchone()['table'], 'task_artifacts')
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')), [])
                gen = db.execute("SELECT * FROM jobs WHERE job_type='generation'").fetchone()
                dep = db.execute("SELECT * FROM jobs WHERE job_type='deployment'").fetchone()
                self.assertEqual(gen['job_id'], dep['job_id'])
                self.assertEqual((gen['executor_id'],gen['server_id']),('agent-interface','agent-machine'))
                self.assertEqual((dep['executor_id'],dep['server_id']),('deployment-config','runner-machine'))
                self.assertEqual((gen['payload'], gen['lease_until']), (generation['payload'],123.5))
                expected_payload = json.loads(deployment['payload']); expected_payload.pop('executionEvents')
                self.assertEqual((json.loads(dep['payload']),dep['parent_task_id'],dep['delivery_id']),
                                 (expected_payload,'parent-generation','delivery'))
                saved_event = db.execute("SELECT payload FROM logs WHERE log_type='event' AND task_type='deployment' AND task_id=?",(dep['job_id'],)).fetchone()
                self.assertEqual(json.loads(saved_event['payload'])['stage'],'verify')

    def test_version_conflict_does_not_drop_the_original_tables(self):
        self.legacy()
        db = sqlite3.connect(self.path)
        db.execute("UPDATE releases SET kind='runner'"); db.commit(); db.close()
        with self.assertRaisesRegex(ValueError, '类型错误'):
            Store(self.path)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM code_versions').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM generation_jobs').fetchone()[0],1)

    def test_generation_update_delete_and_dispatch_do_not_touch_deployment_with_same_id(self):
        self.legacy(); app = SimpleNamespace(store=Store(self.path))
        with app.store.connect() as db:
            before = dict(db.execute("SELECT * FROM jobs WHERE job_type='deployment'").fetchone())
        record = database_generation.read(app, 'a'*32)
        record.update(status='failed', serverId='agent')
        database_generation.put(app, record)
        database_generation.remove(app, {'taskId': 'a'*32})
        with app.store.connect() as db:
            self.assertEqual(dict(db.execute("SELECT * FROM jobs WHERE job_type='deployment'").fetchone()),before)
            db.execute("UPDATE jobs SET status='claimed',lease_until=0 WHERE job_type='deployment'")
        with patch('backend.runner_management.code_servers.registry', side_effect=AssertionError('must not contact servers')):
            generation_dispatcher.dispatch(app)

    def test_artifact_paths_are_recorded_and_historical_paths_are_backfilled(self):
        app = SimpleNamespace(store=Store(self.path), artifacts=ArtifactStore(Path(self.tmp.name)/'artifacts'))
        digest,signature = app.artifacts.publish({'main.py':b'print(1)'},{'kind':'script'})
        with app.store.connect() as db:
            register(db,app.artifacts,(digest,'script','news','any','git','published','date',signature,'main.py','git'))
            path = db.execute('SELECT artifact_path FROM releases WHERE digest=?',(digest,)).fetchone()['artifact_path']
            self.assertEqual(Path(path).read_bytes(),app.artifacts.read(digest))
            db.execute("UPDATE releases SET artifact_path=''")
        backfill(app); backfill(app)
        with app.store.connect() as db:
            self.assertEqual(db.execute('SELECT artifact_path FROM releases WHERE digest=?',(digest,)).fetchone()['artifact_path'],path)


if __name__ == '__main__':
    unittest.main()
