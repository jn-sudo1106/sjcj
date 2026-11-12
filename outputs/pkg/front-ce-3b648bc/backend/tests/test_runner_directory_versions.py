"""Apply the worker's rollback/shared-directory contract to the portable installer."""
from unittest.mock import patch

from backend.tests import test_directory_versions as contract
from backend.runner_management import bundle_install


class RunnerDirectoryVersionTest(contract.DirectoryVersionTest):
    def run(self, result=None):
        with patch.object(contract, 'loader', bundle_install):
            return super().run(result)

    def full_delivery(self, bundle):
        files, manifest, _ = bundle
        digest, signature = self.artifacts.publish(
            {name: data for name, data in files.items() if name != 'manifest.json'},
            {**manifest, 'deliverySchema': 1, 'deliveryRoot': 'packages/shared'})
        bundle_install.cache_bundle(self.cache, digest, self.artifacts.read(digest), signature)
        files, manifest = bundle_install.cached_bundle(self.cache, digest, self.artifacts.public_key)
        return files, manifest, digest

    def test_full_delivery_restores_missing_empty_directory_without_replacing_user_file(self):
        bundle = self.full_delivery(self.bundle(directories=['empty/nested']))
        self.install(bundle)
        (self.target / 'user.txt').write_bytes(b'user data')
        (self.target / 'empty/nested').rmdir()
        (self.target / 'empty').rmdir()
        with self.assertRaisesRegex(ValueError, 'empty/nested'):
            self.install(bundle, current=False)
        self.install(bundle)
        self.assertTrue((self.target / 'empty/nested').is_dir())
        self.assertEqual((self.target / 'user.txt').read_bytes(), b'user data')
        self.assertEqual(len(bundle_install.read_registry(self.target)['versions']), 1)
        (self.target / 'empty/nested').rmdir()
        (self.target / 'empty/nested').write_bytes(b'user file')
        with self.assertRaisesRegex(ValueError, '占用了目录位置'):
            self.install(bundle)
        self.assertEqual((self.target / 'empty/nested').read_bytes(), b'user file')

    def test_full_delivery_does_not_repair_other_configuration_directory(self):
        first = self.full_delivery(self.bundle(directories=['empty']))
        self.install(first)
        second = self.full_delivery(self.bundle('b'))
        (self.target / 'empty').rmdir()
        with self.assertRaisesRegex(ValueError, '对该配置重新下发全部代码'):
            self.install(second)
        self.assertFalse((self.target / 'b.py').exists())
