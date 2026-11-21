"""Retired bindings stay absent while current deployment storage remains usable."""
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.runner_management.store import Store, MYSQL_SCHEMA, MYSQL_TABLES


RETIRED = {'script_bindings', 'code_repo_rules', 'config_runner_bindings', 'queue_runner_bindings', 'runner_upgrades',
           'code_versions', 'generation_jobs', 'deployment_jobs',
           'runtime_events','runtime_log_streams','business_task_executions','model_interface_calls'}


class RetiredRunnerTablesTest(unittest.TestCase):
    def test_new_and_restarted_sqlite_store_do_not_recreate_retired_tables(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'runner.db'
            for _ in range(2):
                store = Store(path)
                with store.connect() as db:
                    tables = {row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    self.assertFalse(RETIRED & tables)
                    self.assertTrue({'directory_runner_bindings', 'assignments', 'code_runtime_bindings', 'settings'} <= tables)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_mysql_installation_has_no_retired_table_definition_or_sql_alias(self):
        for name in RETIRED:
            with self.subTest(table=name):
                self.assertNotIn(name, MYSQL_TABLES)
                self.assertNotIn('ce_runner_' + name, MYSQL_SCHEMA)


if __name__ == '__main__':
    unittest.main()
