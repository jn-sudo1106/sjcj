import json
from contextlib import closing
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from backend.runner_management.store import Store


class JobExecutionFieldsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'runner.sqlite3'

    def old_jobs(self):
        store=Store(self.path)
        with store.connect() as db:
            # The old executor-column schema predates the delivery projection.
            db.execute('DROP VIEW directory_deliveries')
            db.execute('DROP INDEX jobs_pending')
            db.execute('ALTER TABLE jobs DROP COLUMN executor_id')
            for name in ('interface_id','runner_id','deployment_id'):
                db.execute(f"ALTER TABLE jobs ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
            db.execute('CREATE INDEX jobs_pending ON jobs(job_type,status,interface_id,created_at)')
            for kind in ('generation','deployment'):
                db.execute('INSERT INTO jobs (job_type,job_id,status,created_at,interface_id,server_id,runner_id,deployment_id,payload) '
                           'VALUES (?,?,?,?,?,?,?,?,?)',
                           (kind,'same-id','queued','date','agent' if kind=='generation' else '',
                            'agent-host' if kind=='generation' else '', 'runner' if kind=='deployment' else '',
                            'layout' if kind=='deployment' else '',json.dumps({'unchanged':kind})))

    def test_old_unified_table_maps_both_identifiers_and_restarts_without_old_columns(self):
        self.old_jobs()
        for _ in range(2):
            store=Store(self.path)
            with store.connect() as db:
                columns={row['name'] for row in db.execute('PRAGMA table_info(jobs)')}
                self.assertEqual(len(columns),19)
                self.assertFalse({'interface_id','runner_id','deployment_id'} & columns)
                rows={row['job_type']:dict(row) for row in db.execute('SELECT * FROM jobs')}
                self.assertEqual((rows['generation']['executor_id'],rows['generation']['server_id']),('agent','agent-host'))
                self.assertEqual((rows['deployment']['executor_id'],rows['deployment']['server_id']),('layout','runner'))
                for kind,row in rows.items():self.assertEqual(json.loads(row['payload']),{'unchanged':kind})
                indexes={row['name'] for row in db.execute('PRAGMA index_list(jobs)')}
                self.assertTrue({'jobs_pending','jobs_owner','jobs_source','jobs_archive'} <= indexes)
        with closing(sqlite3.connect(self.path)) as db:self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_conflicting_machine_id_keeps_old_records(self):
        self.old_jobs()
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("UPDATE jobs SET server_id='different-machine' WHERE job_type='deployment'");db.commit()
        with self.assertRaisesRegex(ValueError,'机器冲突'):Store(self.path)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],2)
            self.assertIn('runner_id',{row[1] for row in db.execute('PRAGMA table_info(jobs)')})


if __name__=='__main__':unittest.main()
