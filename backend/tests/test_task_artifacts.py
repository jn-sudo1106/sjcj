import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.runner_management.store import Store
from backend.runner_management import task_artifacts as artifacts
from backend.runner_management.release_records import register, attach_code
from backend.runner_management.artifacts import ArtifactStore


class TaskArtifactsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'store.sqlite'
        self.store = Store(self.path)

    def job(self, db, kind, identifier):
        db.execute('INSERT INTO jobs (job_type,job_id,status,created_at,payload) VALUES (?,?,?,?,?)',
                   (kind, identifier, 'completed', 'date', '{}'))

    def test_generated_file_has_both_locations_hash_and_exact_task_link(self):
        with self.store.connect() as db:
            self.job(db, 'generation', 'task')
            self.job(db, 'deployment', 'task')
            record = {'archiveId': 'archive', 'taskId': 'task', 'workspace': {'codeDir': r'D:\coder\workspace\1401218\code\sites'},
                      'repoId': 'repo', 'repositoryPrefix': 'sites', 'gitCommit': 'commit', 'createdAt': 'date',
                      'files': [{'path': 'links/1401218/sites/example.py', 'relativePath': 'sites/example.py',
                                 'sha256': 'a'*64, 'data': 'must-not-persist'}]}
            artifacts.sync_archive(db, record)
            artifacts.sync_archive(db, {**record, 'gitCommit': 'commit-2'})
            row = db.execute("SELECT * FROM artifacts WHERE artifact_type='code'").fetchone()
            self.assertEqual((row['task_type'], row['task_id']), ('generation', 'task'))
            self.assertEqual(row['machine_path'], r'D:\coder\workspace\1401218\code\sites\example.py')
            self.assertEqual((row['repo_id'], row['git_path'], row['git_commit']), ('repo','links/1401218/sites/example.py','commit-2'))
            self.assertEqual(row['sha256'], 'a'*64)
            self.assertNotIn('data', json.loads(row['payload']))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM artifacts WHERE artifact_type='code'").fetchone()[0], 1)
            db.execute("DELETE FROM jobs WHERE job_type='deployment' AND job_id='task'")
            self.assertIsNotNone(db.execute('SELECT task_id FROM artifacts').fetchone()['task_id'])
            db.execute("DELETE FROM jobs WHERE job_type='generation' AND job_id='task'")
            row = db.execute('SELECT * FROM artifacts').fetchone()
            self.assertIsNone(row['task_id']); self.assertIsNone(row['task_type'])
            self.assertTrue(row['machine_path']); self.assertTrue(row['git_path'])

    def test_unmatched_legacy_task_is_not_fabricated(self):
        with self.store.connect() as db:
            artifacts.sync_archive(db, {'archiveId':'old','taskId':'gone','files':[{'path':'old.py'}]})
            row = db.execute('SELECT * FROM artifacts').fetchone()
            self.assertIsNone(row['task_id'])
            self.assertEqual(json.loads(row['payload'])['sourceTaskId'], 'gone')

    def test_package_reuse_links_each_task_without_changing_signed_bytes_or_version(self):
        package_store = ArtifactStore(Path(self.tmp.name) / 'packages')
        digest, signature = package_store.publish({'main.py': b'print(1)'}, {'kind':'script'})
        original = package_store.read(digest)
        with self.store.connect() as db:
            register(db, package_store, (digest,'script','site','any','commit','published','date',signature,'main.py','url'))
            artifacts.save_asset(db, dict(code_id='code',config_id='101',queue_name='news',site_host='',storage_path='old/main.py',created_at='date',repo_id='repo'))
            attach_code(db, digest, code_id='code', repo_id='repo', repository_storage_path='old/main.py')
            artifacts.patch_asset(db, 'code', storage_path='new/main.py')
            db.execute("INSERT INTO runners(runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status) VALUES ('r','r','ip','root','any','[]','hash','online')")
            db.execute("INSERT INTO directory_deliveries(delivery_id,binding_type,owner_key,owner_id,runner_id,layout_revision,artifact_digest,signature,target_path,status,requested_at,installed_path) VALUES ('d','deployment','key','owner','r','rev',?,?,'dir','success','date','D:/Runner/dir')", (digest, signature))
            for identifier in ('first', 'second'):
                self.job(db, 'deployment', identifier)
                artifacts.sync_delivery(db, {'jobId':identifier,'deliveryId':'d','createdAt':'date'})
            outputs = db.execute("SELECT * FROM artifacts WHERE task_type='deployment' ORDER BY task_id").fetchall()
            self.assertEqual([row['task_id'] for row in outputs], ['first', 'second'])
            self.assertEqual({row['sha256'] for row in outputs}, {digest[7:]})
            self.assertEqual(db.execute('SELECT repository_storage_path FROM releases').fetchone()[0], 'old/main.py')
            self.assertEqual(db.execute('SELECT storage_path FROM code_assets').fetchone()[0], 'new/main.py')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM releases').fetchone()[0], 1)
        self.assertEqual(package_store.read(digest), original)

    def test_restart_keeps_one_physical_table_and_valid_foreign_keys(self):
        for _ in range(2):
            self.store = Store(self.path)
            with self.store.connect() as db:
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn('artifacts', tables)
                self.assertFalse({'releases','code_assets'} & tables)
                self.assertEqual(len(db.execute('PRAGMA table_info(artifacts)').fetchall()), 17)
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')), [])
                for table in ('assignments', 'code_runtime_bindings'):
                    self.assertIn('artifacts', {row['table'] for row in db.execute('PRAGMA foreign_key_list('+table+')')})


if __name__ == '__main__':
    unittest.main()
