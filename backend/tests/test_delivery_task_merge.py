import json
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from contextlib import closing

from backend.runner_management import delivery_tasks, log_records, task_artifacts
from backend.runner_management.artifacts import ArtifactStore
from backend.runner_management.directory_bindings import owner_key
from backend.runner_management.directory_delivery import runner_delivery, expire_deliveries
from backend.runner_management.release_records import register
from backend.runner_management.server import ApiError
from backend.runner_management.store import Store


LEGACY_SCHEMA = '''CREATE TABLE directory_deliveries (
 delivery_id TEXT PRIMARY KEY,binding_type TEXT NOT NULL,owner_key TEXT NOT NULL,owner_id TEXT NOT NULL,
 runner_id TEXT NOT NULL REFERENCES runners(runner_id),layout_revision TEXT NOT NULL,artifact_digest TEXT NOT NULL,
 signature TEXT NOT NULL,target_path TEXT NOT NULL,status TEXT NOT NULL,requested_at TEXT NOT NULL,
 started_at TEXT,finished_at TEXT,error TEXT NOT NULL,installed_path TEXT NOT NULL)'''


class DeliveryTaskMergeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'current.sqlite'
        self.store = Store(self.path)
        self.packages = ArtifactStore(Path(self.tmp.name) / 'packages')
        self.digest, self.signature = self.packages.publish({'main.py':b'print(1)'},{'kind':'script'})
        with self.store.connect() as db:
            db.execute("INSERT INTO runners(runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status) VALUES('runner','runner','ip','root','any','[]','hash','online')")
            register(db,self.packages,(self.digest,'script','main','any','commit','published','date',self.signature,'main.py','git'))
            for kind, identifier in (('generation','generation'),('deployment','parent-one'),('deployment','parent-two')):
                data = {'jobId':identifier,'deliveryHistory':['retry'] if identifier=='parent-one' else []}
                db.execute('INSERT INTO jobs(job_type,job_id,delivery_id,status,created_at,payload) VALUES(?,?,?,?,?,?)',
                           (kind,identifier,'shared' if kind=='deployment' else '','completed','date',json.dumps(data)))
            artifact = {'path':'site.py','sha256':'a'*64}
            task_artifacts.sync_archive(db,{'archiveId':'archive','taskId':'generation','files':[artifact]})
            event = log_records.empty('event','event'); event.update(task_type='generation',task_id='generation')
            log_records.insert(db,event)
            db.execute("INSERT INTO assignments VALUES('assignment','runner','queue','python',?,1,1,'test','')",(self.digest,))
            self.jobs = [dict(row) for row in db.execute('SELECT * FROM jobs ORDER BY job_type,job_id')]
            self.old_artifacts = [dict(row) for row in db.execute('SELECT * FROM artifacts ORDER BY artifact_id')]

    def record(self, identifier='new', **changes):
        result = dict(delivery_id=identifier,binding_type='deployment',owner_key=owner_key('owner'),owner_id='owner',
                      runner_id='runner',layout_revision='r'*64,artifact_digest=self.digest,signature=self.signature,
                      target_path='links/1401218',status='pending',requested_at='2026-11-21T00:00:00+00:00',
                      started_at=None,finished_at=None,error='',installed_path='')
        return {**result,**changes}

    def legacy(self, rows, *, restricted=True):
        path = Path(self.tmp.name) / 'legacy.sqlite'
        with self.store.connect() as db:
            statements = [statement for statement in db.iterdump()
                          if not statement.startswith(('CREATE VIEW directory_deliveries','CREATE TRIGGER deployment_attempt_'))]
        script = '\n'.join(statements)
        if restricted:
            script = script.replace("'generation','deployment','delivery'", "'generation','deployment'")
        with closing(sqlite3.connect(path)) as db:
            db.executescript(script)
            db.execute(LEGACY_SCHEMA)
            for row in rows:
                db.execute('INSERT INTO directory_deliveries VALUES('+','.join('?' for _ in delivery_tasks.FIELDS)+')',
                           tuple(row[name] for name in delivery_tasks.FIELDS))
            db.commit()
        return path

    def test_legacy_rows_shared_and_independent_keep_all_fields_and_incoming_foreign_keys(self):
        rows = [self.record('shared',status='success',started_at='start',finished_at='finish',installed_path=r'D:\Runner\links\1401218'),
                self.record('retry',status='failed',started_at='start',finished_at='finish',error='拒绝访问'),
                self.record('manual',binding_type='custom',owner_id='目录/'+'x'*100)]
        path = self.legacy(rows)
        for _ in range(2):
            store = Store(path)
            with store.connect() as db:
                for old in self.jobs:
                    actual = dict(db.execute('SELECT * FROM jobs WHERE job_type=? AND job_id=?',(old['job_type'],old['job_id'])).fetchone())
                    self.assertEqual({key:value for key,value in actual.items() if key!='payload'}, {key:value for key,value in old.items() if key!='payload'})
                    payload = json.loads(actual['payload']); payload.pop('deliveryAttempts',None)
                    self.assertEqual(payload,json.loads(old['payload']))
                actual = {row['delivery_id']:dict(row) for row in db.execute('SELECT * FROM directory_deliveries')}
                self.assertEqual(actual,{row['delivery_id']:row for row in rows})
                self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='directory_deliveries'").fetchone())
                self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs WHERE job_type='deployment'").fetchone()[0],3)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs WHERE job_type NOT IN ('generation','deployment')").fetchone()[0],0)
                parent = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id='parent-one'").fetchone()
                self.assertEqual(set(json.loads(parent['payload'])['deliveryAttempts']), {'shared','retry'})
                other = db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id='parent-two'").fetchone()
                self.assertEqual(json.loads(other['payload']),json.loads(self.jobs[1]['payload']))
                self.assertEqual(db.execute("SELECT task_id FROM logs WHERE log_id='event'").fetchone()[0],'generation')
                for old in self.old_artifacts:
                    self.assertEqual(dict(db.execute('SELECT * FROM artifacts WHERE artifact_id=?',(old['artifact_id'],)).fetchone()),old)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM assignments').fetchone()[0],1)
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])
                self.assertEqual(db.execute('PRAGMA foreign_keys').fetchone()[0],1)

    def test_claim_and_acknowledgement_are_authorized_idempotent_and_type_scoped(self):
        app = SimpleNamespace(store=self.store)
        with self.store.connect() as db:
            delivery_tasks.create(db,self.record('generation'))
        with self.assertRaises(ApiError):runner_delivery(app,'another-runner','generation','claim',{})
        self.assertEqual(runner_delivery(app,'runner','generation','claim',{})['status'],'running')
        with self.assertRaises(ApiError):runner_delivery(app,'runner','generation','claim',{})
        with self.assertRaises(ApiError):runner_delivery(app,'runner','generation','finish',{'status':'success'})
        payload = {'status':'success','installedPath':r'D:\Runner\links\1401218'}
        first = runner_delivery(app,'runner','generation','finish',payload)
        self.assertEqual(runner_delivery(app,'runner','generation','finish',payload),first)
        with self.store.connect() as db:
            self.assertEqual(dict(db.execute("SELECT * FROM jobs WHERE job_type='generation'").fetchone()),self.jobs[2])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM artifacts WHERE task_type='deployment' AND task_id='generation'").fetchone()[0],1)

    def test_expiry_only_changes_running_delivery_and_preserves_parent_associations(self):
        with self.store.connect() as db:
            delivery_tasks.create(db,self.record('expired',status='running',started_at='2020-01-01T00:00:00+00:00'))
            expire_deliveries(db)
            row = db.execute("SELECT * FROM jobs WHERE job_type='deployment' AND job_id='expired'").fetchone()
            self.assertEqual(row['status'],'failed')
            self.assertIn('expired',json.loads(row['payload'])['deliveryAttempts'])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs WHERE status='completed'").fetchone()[0],3)
            self.assertEqual(delivery_tasks.update(db,'expired',status='running',expected_status='pending').rowcount,0)

    def test_migration_conflict_preserves_original_delivery_table(self):
        with self.store.connect() as db:
            delivery_tasks.create(db,self.record('conflict',target_path='other'))
        # Remove the modern delivery view but retain its task row in the dump.
        path = self.legacy([self.record('conflict')],restricted=False)
        with self.assertRaisesRegex(ValueError,'合并校验失败'):
            Store(path)
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute("SELECT type FROM sqlite_master WHERE name='directory_deliveries'").fetchone()[0],'table')
            self.assertEqual(db.execute("SELECT target_path FROM directory_deliveries").fetchone()[0],'links/1401218')

    def test_retry_keeps_one_deployment_task_and_both_attempt_receipts(self):
        with self.store.connect() as db:
            original = self.record('a'*32,status='failed',finished_at='finish',error='旧错误')
            job = delivery_tasks.create(db,original)
            retried = delivery_tasks.retry(db,job)
            self.assertEqual(retried['jobId'],'a'*32)
            self.assertNotEqual(retried['deliveryId'],'a'*32)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],4)
            self.assertEqual(dict(db.execute("SELECT * FROM directory_deliveries WHERE delivery_id=?",('a'*32,)).fetchone()),original)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM directory_deliveries').fetchone()[0],2)
        app = SimpleNamespace(store=self.store)
        runner_delivery(app,'runner',retried['deliveryId'],'claim',{})
        runner_delivery(app,'runner',retried['deliveryId'],'finish',{'status':'success','installedPath':'D:/Runner/links/1401218'})
        with self.store.connect() as db:
            saved = db.execute("SELECT status,payload FROM jobs WHERE job_type='deployment' AND job_id=?",('a'*32,)).fetchone()
            self.assertEqual(saved['status'],'success')
            self.assertEqual(json.loads(saved['payload'])['deliveryAttempts']['a'*32]['error'],'旧错误')


if __name__ == '__main__':
    unittest.main()
