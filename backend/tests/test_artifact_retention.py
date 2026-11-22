import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import time
import unittest

from backend.runner_management.artifacts import ArtifactStore
from backend.runner_management.artifact_retention import inventory
from backend.runner_management.store import Store


class ArtifactRetentionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.app = SimpleNamespace(store=Store(root / 'db'), artifacts=ArtifactStore(root / 'artifacts'))

    def package(self, name, *, age=172800, **manifest):
        digest, signature = self.app.artifacts.publish({name: b'content'}, {'kind': 'script', **manifest})
        path = self.app.artifacts.root / (digest[7:] + '.zip')
        os.utime(path, (time.time() - age, time.time() - age))
        return digest, signature

    def root(self, digest):
        with self.app.store.connect() as db:
            db.execute('INSERT INTO settings VALUES (?,?)', ('pinned', json.dumps({'current': digest})))

    def test_only_old_unreferenced_packages_are_candidates_and_signing_key_is_untouched(self):
        used, _ = self.package('used.py')
        unused, _ = self.package('unused.py')
        recent, _ = self.package('recent.py', age=60)
        self.root(used)
        result = inventory(self.app)
        self.assertEqual([item['name'] for item in result['candidates']], [unused[7:] + '.zip'])
        self.assertIn(recent[7:], result['protectedDigests'])
        self.assertTrue((self.app.artifacts.root / 'signing-key.pem').is_file())

    def test_retained_file_origins_are_followed_transitively(self):
        child, _ = self.package('child.py')
        parent, _ = self.package('parent.py', retainedFiles={'file.py': {'digest': child, 'path': 'child.py'}})
        top, _ = self.package('top.py', baseDigest=parent)
        self.package('unused.py')
        self.root(top)
        result = inventory(self.app)
        self.assertEqual(result['dependencyKept'], 2)
        self.assertIn(child[7:], result['protectedDigests'])
        self.assertIn(parent[7:], result['protectedDigests'])
        self.assertEqual(result['candidateCount'], 1)

    def test_recent_uncommitted_parent_also_protects_old_dependencies(self):
        old, _ = self.package('old.py')
        self.package('publishing.py', age=1, baseDigest=old)
        self.assertEqual(inventory(self.app)['candidateCount'], 0)

    def test_unreadable_referenced_manifest_blocks_cleanup(self):
        broken = 'a' * 64
        (self.app.artifacts.root / (broken + '.zip')).write_bytes(b'broken zip')
        self.root('sha256:' + broken)
        self.package('orphan.py')
        result = inventory(self.app)
        self.assertTrue(result['blockedByUnreadableDependency'])
        self.assertEqual(result['candidateCount'], 0)

    def test_published_releases_are_preserved_even_without_an_active_process(self):
        digest, signature = self.package('published.py')
        with self.app.store.connect() as db:
            db.execute('INSERT INTO releases (digest,kind,name,platform,git_commit,status,published_at,signature,entry,git_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (digest, 'script', 'history', 'any', 'commit', 'published', 'old', signature, 'published.py', 'local'))
        result = inventory(self.app)
        self.assertEqual(result['candidateCount'], 0)
        self.assertIn('artifacts.artifact_id', result['referenceColumns'])


if __name__ == '__main__':
    unittest.main()
