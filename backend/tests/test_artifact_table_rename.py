import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from backend.runner_management.store import Store
from backend.runner_management import task_artifacts as records


class ArtifactTableRenameTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'store.sqlite';self.store=Store(self.path)

    def test_old_name_renames_with_rows_foreign_keys_views_and_writes_intact(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO jobs(job_type,job_id,status,created_at,payload) VALUES('generation','task','completed','date','{}')")
            records.save(db,'file','code',{'name':'main.py'},task_type='generation',task_id='task',name='main.py',
                         machine_path=r'D:\code\main.py',repo_id='repo',git_path='links/1/main.py',git_commit='commit',sha256='a'*64)
            records.save_asset(db,dict(code_id='code',config_id='1',queue_name='queue',storage_path='main.py',created_at='date'))
            records.save_release(db,dict(digest='sha256:'+'b'*64,kind='script',name='main',published_at='date',code_id='code'))
            db.execute("INSERT INTO runners(runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status) VALUES('r','runner','ip','root','any','[]','hash','online')")
            db.execute("INSERT INTO assignments VALUES('a','r','q','python',?,1,1,'test','')",('sha256:'+'b'*64,))
            before=[dict(row) for row in db.execute('SELECT * FROM artifacts ORDER BY artifact_id')]
            db.execute('ALTER TABLE artifacts RENAME TO task_artifacts')
            self.assertIn('task_artifacts',{row['table'] for row in db.execute('PRAGMA foreign_key_list(assignments)')})
        for _ in range(2):
            self.store=Store(self.path)
            with self.store.connect() as db:
                self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='task_artifacts'").fetchone())
                self.assertEqual([dict(row) for row in db.execute('SELECT * FROM artifacts ORDER BY artifact_id')],before)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM releases').fetchone()[0],1)
                self.assertEqual(db.execute('SELECT code_id FROM code_assets').fetchone()[0],'code')
                self.assertIn('artifacts',{row['table'] for row in db.execute('PRAGMA foreign_key_list(assignments)')})
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])
        with self.store.connect() as db:
            records.patch_asset(db,'code',storage_path='new/main.py')
            self.assertEqual(db.execute('SELECT storage_path FROM code_assets').fetchone()[0],'new/main.py')
            db.execute("DELETE FROM jobs WHERE job_type='generation' AND job_id='task'")
            row=db.execute("SELECT * FROM artifacts WHERE artifact_id='file'").fetchone()
            self.assertIsNone(row['task_id']);self.assertEqual(row['machine_path'],r'D:\code\main.py')

    def test_existing_two_names_are_not_silently_combined(self):
        with self.store.connect() as db:
            db.execute('CREATE TABLE task_artifacts(marker TEXT)')
            db.execute("INSERT INTO task_artifacts VALUES('preserve')")
        with self.assertRaisesRegex(ValueError,'同时存在'):Store(self.path)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT marker FROM task_artifacts').fetchone()[0],'preserve')
            self.assertIsNotNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='artifacts'").fetchone())


if __name__=='__main__':unittest.main()
