import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from backend.runner_management import delivery_tasks, deployment_outputs, task_artifacts
from backend.runner_management.artifacts import ArtifactStore
from backend.runner_management.directory_delivery import runner_delivery
from backend.runner_management.release_records import register
from backend.runner_management.store import Store


class NodeArtifactOutputsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'
        self.store = Store(self.path); self.app = SimpleNamespace(store=self.store)
        self.packages = ArtifactStore(Path(self.tmp.name) / 'packages')
        self.files = {'sites/example.py': b'print(1)', 'requirements.txt': b'requests'}
        self.hashes = {name: hashlib.sha256(data).hexdigest() for name, data in self.files.items()}
        self.digest, self.signature = self.packages.publish(self.files, {'fileHashes': self.hashes,
            'sources': [{'gitCommit': 'c'*40, 'sourcePath': 'links/101/sites/example.py'}]})
        with self.store.connect() as db:
            register(db, self.packages, (self.digest,'script','site','any','c'*40,'published','date',self.signature,'','url'))
            for identifier in ('r1', 'r2'):
                db.execute('INSERT INTO runners(runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status) VALUES(?,?,?,?,?,?,?,?)',
                           (identifier, identifier, identifier, 'D:/Runner/instance','any','[]','hash','online'))

    def create(self, identifier, runner='r1', source='100', flow='200', step='300'):
        with self.store.connect() as db:
            job = delivery_tasks.create(db, dict(delivery_id=identifier,binding_type='deployment',owner_key='owner',owner_id='config',
                runner_id=runner,layout_revision='revision',artifact_digest=self.digest,signature=self.signature,target_path='links/101',
                status='pending',requested_at='2026-11-23T00:00:00+00:00',started_at=None,finished_at=None,error='',installed_path=''))
            job.update(sourceId=source,flowId=flow,stepId=step,configId='101',environment='test',archiveId='archive')
            db.execute("UPDATE jobs SET source_id=?,flow_id=?,step_id=?,config_id='101',environment='test',payload=? WHERE job_type='deployment' AND job_id=?",
                       (source,flow,step,json.dumps(job),job['jobId']))
        return job

    def finish(self, identifier, runner='r1', status='success'):
        runner_delivery(self.app,runner,identifier,'claim',{})
        return runner_delivery(self.app,runner,identifier,'finish',{'status':status,'installedPath':'D:/'+runner+'/links/101', 'error':'failed' if status=='failed' else ''})

    def query(self, **changes):
        return deployment_outputs.listing(self.app,dict(sourceId='100',flowId='200',stepId='300',configId='101',**changes))

    def test_multiple_runners_reused_package_get_independent_immutable_outputs(self):
        before = self.packages.read(self.digest)
        self.create('first'); self.create('second','r2')
        self.assertEqual(self.query()['total'],0)
        self.finish('first'); self.finish('second','r2')
        result = self.query(artifactType='deployment',environment='test')['items']
        self.assertEqual({item['serverId'] for item in result},{'r1','r2'})
        self.assertEqual({item['machinePath'] for item in result},{'D:/r1/links/101','D:/r2/links/101'})
        self.assertEqual({item['taskId'] for item in result},{'first','second'})
        self.assertEqual(len({item['artifactId'] for item in result}),2)
        for item in result:
            self.assertEqual({file['path']:file['sha256'] for file in item['outputFiles']}, self.hashes)
            self.assertTrue(item['inventoryKnown'])
        first = next(item for item in result if item['taskId']=='first')
        runner_delivery(self.app,'r1','first','finish',{'status':'success','installedPath':'D:/r1/links/101'})
        with self.store.connect() as db:
            task_artifacts.backfill_outputs(db)
            db.execute("DELETE FROM jobs WHERE job_type='deployment' AND job_id='first'")
        retained = next(item for item in self.query()['items'] if item['taskId']=='first')
        self.assertEqual(retained['artifactId'],first['artifactId'])
        self.assertEqual(retained['machinePath'],first['machinePath'])
        self.assertEqual(self.query()['total'],2)
        self.assertEqual(self.packages.read(self.digest),before)

    def test_failed_deployment_never_becomes_output(self):
        self.create('failed'); self.finish('failed',status='failed')
        self.assertEqual(self.query()['total'],0)

    def test_backfill_preserves_shared_historical_receipt_for_each_referencing_task(self):
        self.create('first');self.finish('first')
        self.create('second')
        with self.store.connect() as db:
            job=json.loads(db.execute("SELECT payload FROM jobs WHERE job_id='second'").fetchone()[0])
            job['deliveryHistory']=['first']
            db.execute("UPDATE jobs SET payload=? WHERE job_id='second'",(json.dumps(job),))
            task_artifacts.backfill_outputs(db)
        self.assertEqual({item['taskId'] for item in self.query()['items']},{'first','second'})
        self.assertEqual({item['serverId'] for item in self.query()['items']},{'r1'})

    def test_old_signed_package_without_inventory_is_hashed_without_rewriting_it(self):
        digest,signature=self.packages.publish({'old.py':b'old code'},{'kind':'script'})
        original=self.packages.read(digest)
        with self.store.connect() as db:
            register(db,self.packages,(digest,'script','old','any','commit','published','date',signature,'',''))
        self.digest=digest;self.signature=signature
        self.create('old');self.finish('old')
        item=self.query()['items'][0]
        self.assertEqual(item['outputFiles'],[{'path':'old.py','sha256':hashlib.sha256(b'old code').hexdigest()}])
        self.assertTrue(item['inventoryKnown'])
        self.assertEqual(self.packages.read(digest),original)

    def test_completion_and_output_are_one_transaction(self):
        self.create('atomic'); runner_delivery(self.app,'r1','atomic','claim',{})
        with patch.object(task_artifacts,'save',side_effect=RuntimeError('database unavailable')):
            with self.assertRaises(RuntimeError):
                runner_delivery(self.app,'r1','atomic','finish',{'status':'success','installedPath':'D:/r1/links/101'})
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT status FROM directory_deliveries WHERE delivery_id='atomic'").fetchone()[0],'running')
        self.assertEqual(self.query()['total'],0)

    def test_context_filtering_pagination_and_lists_do_not_touch_packages(self):
        self.create('own'); self.finish('own')
        self.create('other-source',source='999'); self.finish('other-source')
        self.create('other-flow',flow='999'); self.finish('other-flow')
        self.create('other-step',step='999'); self.finish('other-step')
        with patch.object(deployment_outputs,'manifest',side_effect=AssertionError('list opened ZIP')):
            self.assertEqual(self.query()['total'],1)
            self.assertEqual(self.query(serverId='r2')['total'],0)
            self.assertEqual(self.query(size=1,page=2)['items'],[])

    def test_old_schema_backfill_survives_restart_without_changing_jobs_or_packages(self):
        self.create('historical'); self.finish('historical')
        with self.store.connect() as db:
            original = dict(db.execute("SELECT * FROM jobs WHERE job_id='historical'").fetchone())
            db.execute("DELETE FROM artifacts WHERE artifact_type='deployment'")
            db.execute("DELETE FROM settings WHERE setting_key='artifact-node-outputs:v1'")
            for view in ('code_assets','releases'):
                for operation in ('insert','update','delete'):
                    db.execute('DROP TRIGGER '+view+'_artifact_'+operation)
            db.execute('DROP INDEX artifact_node_outputs')
            for field in ('source_id','flow_id','config_id','output_files'):
                db.execute('ALTER TABLE artifacts DROP COLUMN '+field)
        for _ in range(2):
            self.store=Store(self.path); self.app.store=self.store
            self.assertEqual(self.query()['total'],1)
            with self.store.connect() as db:
                self.assertEqual(dict(db.execute("SELECT * FROM jobs WHERE job_id='historical'").fetchone()),original)
                self.assertEqual(len(db.execute('PRAGMA table_info(artifacts)').fetchall()),17)
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])

    def test_generation_output_retains_exact_node_context_and_both_paths(self):
        with self.store.connect() as db:
            record=dict(archiveId='generated',taskId='gone',sourceContext=dict(sourceId='100',flowId='200',stepId='300'),
                configId='101',workspace={'codeDir':r'D:\coder\workspace\101\code'},repoId='repo',serverId='agent',
                createdAt='date',status='committed',gitCommit='c'*40,files=[dict(path='links/101/site.py',sourceRelativePath='site.py',sha256='a'*64)])
            task_artifacts.sync_archive(db,record)
        item=self.query(artifactType='code',status='committed')['items'][0]
        self.assertEqual(item['machinePath'],r'D:\coder\workspace\101\code\site.py')
        self.assertEqual(item['gitPath'],'links/101/site.py')
        self.assertEqual(item['serverId'],'agent')
        self.assertEqual(item['taskId'],'gone')


if __name__ == '__main__': unittest.main()
