"""Fixed-directory upgrades: signed metadata, shared ownership and recovery."""
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from backend.runner_management.artifacts import ArtifactStore

SCRIPT = Path(__file__).parents[1] / 'legacy_qinlongclaw/link_extractor/core/managed_script.py'
spec = importlib.util.spec_from_file_location('directory_versions', SCRIPT)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class DirectoryVersionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.target = self.root / 'instance/packages/shared'
        self.cache = self.root / 'instance/code'
        self.artifacts = ArtifactStore(self.root / 'artifacts')

    def tearDown(self):
        self.tmp.cleanup()

    def bundle(self, config='a', files=None, directories=None):
        files = files or {config + '.py': b'def scrape(url): return []\n'}
        manifest = {'kind': 'script', 'layoutSchema': 2, 'codeId': config,
                    'configId': config, 'queueName': 'news', 'siteHost': '',
                    'entry': next(name for name in files if name.endswith('.py')),
                    'directoryTemplate': 'packages/shared', 'versionFile': 'version.json',
                    'sources': [{'repoId': 'repo', 'gitCommit': 'a' * 40}],
                    'directories': directories or []}
        digest, signature = self.artifacts.publish(files, manifest)
        loader.cache_bundle(self.cache, digest, self.artifacts.read(digest), signature)
        cached_files, cached_manifest = loader.cached_bundle(self.cache, digest, self.artifacts.public_key)
        return cached_files, cached_manifest, digest

    def install(self, bundle, current=True):
        files, manifest, digest = bundle
        return loader.install_bundle(self.target, files, manifest, digest, self.cache,
                                     self.artifacts.public_key, make_current=current)

    def test_shared_directory_updates_preserve_other_nodes_and_user_files(self):
        a = self.bundle(files={'a.py': b'v1', 'old/data.txt': b'old', 'shared/util.py': b'common'}, directories=['empty'])
        b = self.bundle('b', {'b.py': b'b', 'shared/util.py': b'common'})
        self.install(a); self.install(b)
        (self.target / 'user.txt').write_text('user data')
        (self.target / 'user-empty').mkdir()
        v2 = self.bundle(files={'a.py': b'v2', 'shared/util.py': b'common'})
        self.install(v2)
        self.assertEqual((self.target / 'a.py').read_bytes(), b'v2')
        self.assertEqual((self.target / 'b.py').read_bytes(), b'b')
        self.assertEqual((self.target / 'user.txt').read_text(), 'user data')
        self.assertTrue((self.target / 'user-empty').is_dir())
        self.assertFalse((self.target / 'old').exists())
        self.assertFalse((self.target / 'empty').exists())
        self.assertEqual(loader.read_registry(self.target)['current'], {'a|news|': v2[2], 'b|news|': b[2]})
        self.assertEqual(len(loader.read_registry(self.target)['versions']), 3)
        self.assertFalse(any(path.is_dir() for path in (self.cache / 'artifacts').iterdir()))
        self.install(a)
        self.assertEqual((self.target / 'a.py').read_bytes(), b'v1')
        self.assertTrue((self.target / 'old/data.txt').is_file())
        self.assertEqual(len(loader.read_registry(self.target)['versions']), 3)

    def test_conflicting_shared_file_leaves_current_directory_unchanged(self):
        a = self.bundle(files={'a.py': b'a', 'common.py': b'common'})
        self.install(a)
        before = (self.target / 'version.json').read_bytes()
        conflict = self.bundle('b', {'b.py': b'b', 'common.py': b'conflict'})
        with self.assertRaisesRegex(ValueError, '其他节点代码占用'):
            self.install(conflict)
        self.assertEqual((self.target / 'version.json').read_bytes(), before)
        self.assertFalse((self.target / 'b.py').exists())
        (self.target / 'user.txt').write_bytes(b'unmanaged')
        with self.assertRaisesRegex(ValueError, '未托管'):
            self.install(self.bundle(files={'a.py': b'a', 'user.txt': b'overwrite'}))
        self.assertEqual((self.target / 'user.txt').read_bytes(), b'unmanaged')

    def test_failed_directory_swap_restores_old_files_and_version_record(self):
        a = self.bundle(); self.install(a)
        before = (self.target / 'version.json').read_bytes()
        v2 = self.bundle(files={'a.py': b'new'})
        original_replace = os.replace
        def failed_replace(source, destination):
            if '.incoming-' in Path(source).name:
                raise OSError('simulated directory swap failure')
            return original_replace(source, destination)
        with patch.object(loader.os, 'replace', side_effect=failed_replace):
            with self.assertRaisesRegex(OSError, 'swap failure'):
                self.install(v2)
        self.assertEqual((self.target / 'version.json').read_bytes(), before)
        self.assertEqual((self.target / 'a.py').read_bytes(), a[0]['a.py'])
        self.assertEqual(list(self.target.parent.glob('*.backup')), [])
        self.assertEqual(list(self.target.parent.glob('*.incoming-*')), [])

    def test_crash_backup_is_recovered_or_cleaned_after_verification(self):
        a = self.bundle(); self.install(a)
        backup = self.target.parent / '.shared.update.backup'
        os.replace(self.target, backup)
        self.install(a)
        self.assertTrue((self.target / 'a.py').is_file())
        shutil.copytree(self.target, backup)
        self.install(a)
        self.assertFalse(backup.exists())

    def test_concurrent_downloads_do_not_duplicate_versions(self):
        a = self.bundle()
        with ThreadPoolExecutor(max_workers=4) as pool:
            registries = list(pool.map(lambda _: self.install(a), range(4)))
        self.assertTrue(all(len(value['versions']) == 1 for value in registries))
        self.assertEqual(loader.read_registry(self.target)['current'], {'a|news|': a[2]})

    def test_historical_download_keeps_current_files_and_version(self):
        a = self.bundle(); v2 = self.bundle(files={'a.py': b'v2'})
        self.install(v2)
        registry = self.install(a, current=False)
        self.assertEqual(registry['current'], {'a|news|': v2[2]})
        self.assertEqual(len(registry['versions']), 2)
        self.assertEqual((self.target / 'a.py').read_bytes(), b'v2')
        self.install(a, current=False)
        self.assertEqual(len(loader.read_registry(self.target)['versions']), 2)

    def test_modified_version_record_or_cache_is_rejected(self):
        a = self.bundle(); self.install(a)
        registry = loader.read_registry(self.target)
        registry['versions'][0]['sources'][0]['gitCommit'] = 'b' * 40
        (self.target / 'version.json').write_text(json.dumps(registry), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '签名版本不一致'):
            self.install(a)
        cached = self.cache / 'artifacts' / (a[2][7:] + '.zip')
        cached.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '摘要校验失败'):
            self.install(a)


if __name__ == '__main__':
    unittest.main()
