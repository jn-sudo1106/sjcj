import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from backend.runner_management import generated_archives, source_code_relations as relations
from backend.runner_management.server import ApiError
from backend.runner_management.store import Store, MySqlConnection


class SourceCodeRelationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = SimpleNamespace(store=Store(Path(self.tmp.name) / 'test.db'))

    def archive(self, **changes):
        return {'archiveId': 'archive-1', 'taskId': 'task-1', 'configId': '101', 'repoId': 'repo-1', 'directoryId': 'links',
                'sourceContext': {'sourceId': '430024910', 'flowId': '21000040', 'stepId': '41895', 'flowVersionId': 'v2'},
                'serverId': 'server-1', 'workspace': {'codeDir': r'D:\workspace\101\code'}, 'repositoryPrefix': '101',
                'queueName': 'news_list', 'createdAt': '2026-11-01T01:00:00Z', 'status': 'committed', 'pushed': True,
                'gitCommit': 'a' * 40, 'files': [
                    {'path': 'links/101/news.py', 'relativePath': '101/news.py', 'sha256': 'a' * 64, 'size': 20},
                    {'path': 'links/101/lib/util.py', 'relativePath': '101/lib/util.py', 'sha256': 'b' * 64, 'size': 10},
                ], **changes}

    def test_multiple_files_and_retry_are_transactional_and_idempotent(self):
        archive = self.archive(status='pending', gitCommit='', pushed=False)
        generated_archives.store(self.app, archive)
        archive.update(status='committed', gitCommit='c' * 40, pushed=True)
        generated_archives.store(self.app, archive)
        generated_archives.store(self.app, archive)
        result = relations.listing(self.app, {'sourceId': '430024910', 'configId': '101'})
        self.assertEqual(result['total'], 2)
        file = next(row for row in result['items'] if row['filePath'].endswith('/news.py'))
        self.assertEqual(file['serverPath'], r'D:\workspace\101\code\news.py')
        self.assertEqual((file['flowId'], file['stepId'], file['flowVersionId']), ('21000040', '41895', 'v2'))
        self.assertEqual((file['gitCommit'], file['archiveStatus'], file['pushed']), ('c' * 40, 'committed', True))
        self.assertEqual(file['sha256'], 'a' * 64)
        self.assertEqual(relations.listing(self.app, {'sourceId': '1'})['total'], 0)

    def test_new_archive_keeps_earlier_git_version_and_shared_config_source(self):
        generated_archives.store(self.app, self.archive())
        generated_archives.store(self.app, self.archive(archiveId='archive-2', gitCommit='d' * 40,
            sourceContext={'sourceId': '430024911', 'flowId': '21000040', 'stepId': '41895'}))
        self.assertEqual(relations.listing(self.app, {'configId': '101'})['total'], 4)
        self.assertEqual(relations.listing(self.app, {'sourceId': '430024910'})['items'][0]['gitCommit'], 'a' * 40)

    def test_unknown_source_is_not_inferred_from_config_or_directory(self):
        generated_archives.store(self.app, self.archive(sourceContext={}))
        self.assertEqual(relations.listing(self.app, {})['total'], 0)

    def test_latest_task_advances_on_submission_and_old_completion_never_replaces_it(self):
        archive = self.archive()
        with self.app.store.connect() as db:
            for task_id, stamp, state in (('task-1', '2026-11-01T00:00:00Z', 'running'), ('task-2', '2026-11-01T00:30:00Z', 'queued')):
                job = {'taskId': task_id, 'sourceId': '430024910', 'flowId': '21000040', 'stepId': '41895',
                       'configId': '101', 'createdAt': stamp}
                db.execute('INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',
                           (task_id, job['sourceId'], job['flowId'], job['configId'], 'model', state, '', stamp, 0, json.dumps(job)))
        generated_archives.store(self.app, archive)
        rows = relations.listing(self.app, {'sourceId': '430024910'})['items']
        self.assertTrue(all(row['taskId'] == 'task-1' and row['latestTaskId'] == 'task-2' for row in rows))
        with self.app.store.connect() as db:
            newer = {'taskId': 'task-3', 'sourceId': '430024910', 'flowId': '21000040', 'stepId': '41895',
                     'configId': '101', 'createdAt': '2026-11-01T00:45:00Z'}
            relations.note_task(db, newer)
            relations.note_task(db, {**newer, 'taskId': 'stale', 'createdAt': '2026-11-01T00:10:00Z'})
            # Neither a different node nor a different source sharing this config may overwrite it.
            relations.note_task(db, {**newer, 'taskId': 'other-node', 'stepId': '41896', 'createdAt': '2026-11-01T02:00:00Z'})
            db.execute('DELETE FROM generation_jobs')
        generated_archives.store(self.app, archive)
        rows = relations.listing(self.app, {'latestTaskId': 'task-3'})['items']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['taskId'] == 'task-1' for row in rows))

    def test_existing_relation_table_adds_latest_columns_without_rebuilding_rows(self):
        import sqlite3
        from backend.runner_management.source_code_schema import SQLITE_SCHEMA
        path = Path(self.tmp.name) / 'legacy.db'
        legacy = SQLITE_SCHEMA.replace(",\n    latest_task_id TEXT NOT NULL DEFAULT '', latest_task_created_at TEXT NOT NULL DEFAULT ''", '')
        with sqlite3.connect(path) as db:
            db.executescript(legacy)
        db.close()
        store = Store(path)
        Store(path)
        with store.connect() as db:
            columns = {row[1] for row in db.execute('PRAGMA table_info(source_code_relations)')}
        self.assertTrue({'latest_task_id', 'latest_task_created_at'} <= columns)

    def test_invalid_source_rolls_back_receipt_and_relation(self):
        archive = self.archive(sourceContext={'sourceId': 'bad', 'flowId': '2', 'stepId': '3'})
        with self.assertRaises(ApiError):
            generated_archives.store(self.app, archive)
        with self.app.store.connect() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM settings WHERE setting_key=?', ('generated-code-result:archive-1',)).fetchone())
        self.assertEqual(relations.listing(self.app, {})['total'], 0)

    def test_backfill_uses_historical_receipt_and_retains_relations_after_task_deletion(self):
        archive = self.archive(sourceContext={})
        generated_archives.store(self.app, archive)
        job = {'taskId': 'task-1', 'sourceId': '430024910', 'flowId': '21000040', 'stepId': '41895', 'configId': '101',
               'result': {'archive': {'archiveId': archive['archiveId']}}}
        with self.app.store.connect() as db:
            db.execute('INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',
                       ('task-1', '430024910', '21000040', '101', 'model', 'succeeded', 'server-1', '', 0, json.dumps(job)))
        self.assertEqual(relations.backfill(self.app)['filesProcessed'], 2)
        relations.backfill(self.app)
        with self.app.store.connect() as db:
            db.execute('DELETE FROM generation_jobs WHERE task_id=?', ('task-1',))
        self.assertEqual(relations.listing(self.app, {'taskId': 'task-1'})['total'], 2)
        generated_archives.store(self.app, archive)
        self.assertEqual(relations.listing(self.app, {})['total'], 2)

    def test_query_pagination_validation_and_mysql_table_mapping(self):
        generated_archives.store(self.app, self.archive())
        self.assertEqual(len(relations.listing(self.app, {'page': '2', 'size': '1'})['items']), 1)
        for query in ({'size': '101'}, {'page': '0'}, {'sourceId': ['1']}, {'page': 'invalid'}):
            with self.assertRaises(ApiError): relations.listing(self.app, query)
        class Connection:
            def cursor(self, _kind): return self
            def execute(self, sql, values): self.sql = sql
        raw = Connection()
        MySqlConnection(raw).execute('SELECT relation_id FROM source_code_relations WHERE config_id=?', ('101',))
        self.assertIn('ce_runner_source_code_relations', raw.sql)
        self.assertIn('config_id=%s', raw.sql)


if __name__ == '__main__': unittest.main()
