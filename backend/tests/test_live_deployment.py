import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.runner_management import bundle_install as install, live_deployment as policy
from backend.runner_management.artifacts import ArtifactStore


class LiveDeploymentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.target = self.root/'instance/links/101'; self.cache = self.root/'cache'
        self.artifacts = ArtifactStore(self.root/'artifacts')
        self.old = {'main.py': b'import time\ntime.sleep(100)\n', 'requirements.txt': b''}
        self.install(self.old)

    def install(self, files, programs=None, directories=None):
        manifest = {'kind':'script','layoutSchema':2,'configId':'101','queueName':'news','entry':'main.py','directories':directories or []}
        digest, signature = self.artifacts.publish(files,manifest)
        install.cache_bundle(self.cache,digest,self.artifacts.read(digest),signature)
        result = install.install_bundle(self.target,files,manifest,digest,self.cache,self.artifacts.public_key,protected_programs=programs)
        return digest, result

    def test_stopped_nested_file_update_keeps_locked_directory_and_rolls_back_on_failure(self):
        original = {**self.old, 'bin/newslink.py': b'OLD=1\n'}
        self.install(original, directories=['bin'])
        inode = self.target.stat().st_ino
        unchanged = (self.target/'main.py').stat().st_mtime_ns
        replace = install.os.replace
        def locked_directory(source, destination):
            if Path(source) == self.target: raise PermissionError('Windows directory is in use')
            return replace(source, destination)
        with patch.object(install.os, 'replace', side_effect=locked_directory):
            self.install({**original, 'bin/newslink.py': b'NEW=2\n'}, [], directories=['bin'])
        self.assertEqual(self.target.stat().st_ino, inode)
        self.assertEqual((self.target/'main.py').stat().st_mtime_ns, unchanged)
        self.assertEqual((self.target/'bin/newslink.py').read_bytes(), b'NEW=2\n')
        registry = (self.target/'version.json').read_bytes()
        write = install.atomic_write
        def fail_registry(path, data):
            if Path(path) == self.target/'version.json' and data != registry: raise OSError('disk full')
            return write(path, data)
        with patch.object(install, 'atomic_write', side_effect=fail_registry), self.assertRaises(OSError):
            self.install({**original, 'bin/newslink.py': b'BROKEN=3\n'}, [], directories=['bin'])
        self.assertEqual((self.target/'bin/newslink.py').read_bytes(), b'NEW=2\n')
        self.assertEqual((self.target/'version.json').read_bytes(), registry)

    def test_standalone_script_is_written_without_swapping_directory_or_unchanged_files(self):
        inode = self.target.stat().st_ino; before = (self.target/'main.py').stat().st_mtime_ns
        original = install.atomic_write; writes=[]
        def capture(path, data): writes.append(Path(path)); return original(path,data)
        with patch.object(install,'atomic_write',side_effect=capture):
            digest, registry = self.install({**self.old,'www.mkky.cn.py':b'VALUE=2\n'},[self.old])
        self.assertEqual(self.target.stat().st_ino,inode)
        self.assertEqual((self.target/'main.py').stat().st_mtime_ns,before)
        self.assertNotIn(self.target/'main.py',writes)
        self.assertTrue((self.target/'www.mkky.cn.py').is_file())
        self.assertIn(digest,registry['current'].values())
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_stopped_full_update_removes_managed_files_without_renaming_locked_root(self):
        original = {**self.old, 'bin/newslink.exe': b'OLD EXE', 'bin/txt/old.txt': b'old sample'}
        self.install(original, directories=['bin', 'bin/txt'])
        (self.target/'bin/txt/runtime-new.txt').write_bytes(b'KEEP RUNTIME DATA')
        root_inode = self.target.stat().st_ino
        replace = install.os.replace
        def reject_root_rename(source, destination):
            if Path(source) == self.target: raise PermissionError('Windows directory is in use')
            return replace(source, destination)
        with patch.object(install.os, 'replace', side_effect=reject_root_rename):
            digest, registry = self.install({**self.old, 'bin/newslink.exe': b'NEW EXE'}, [], directories=['bin'])
        self.assertEqual(self.target.stat().st_ino, root_inode)
        self.assertEqual((self.target/'bin/newslink.exe').read_bytes(), b'NEW EXE')
        self.assertFalse((self.target/'bin/txt/old.txt').exists())
        self.assertEqual((self.target/'bin/txt/runtime-new.txt').read_bytes(), b'KEEP RUNTIME DATA')
        self.assertIn(digest, registry['current'].values())

    def test_stopped_removal_and_replacement_roll_back_together_if_registry_write_fails(self):
        original = {**self.old, 'bin/newslink.exe': b'OLD EXE', 'bin/txt/old.txt': b'old sample'}
        self.install(original, directories=['bin', 'bin/txt'])
        receipt = (self.target/'version.json').read_bytes()
        write = install.atomic_write
        def fail_receipt(path, data):
            if Path(path) == self.target/'version.json' and data != receipt: raise OSError('disk full')
            return write(path, data)
        with patch.object(install, 'atomic_write', side_effect=fail_receipt), self.assertRaises(OSError):
            self.install({**self.old, 'bin/newslink.exe': b'NEW EXE'}, [], directories=['bin'])
        self.assertEqual((self.target/'bin/newslink.exe').read_bytes(), b'OLD EXE')
        self.assertEqual((self.target/'bin/txt/old.txt').read_bytes(), b'old sample')
        self.assertEqual((self.target/'version.json').read_bytes(), receipt)
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_failed_locked_file_write_does_not_rewrite_unchanged_locked_file_during_recovery(self):
        original = {**self.old, 'bin/newslink.exe': b'OLD EXE'}
        self.install(original, directories=['bin'])
        receipt = (self.target/'version.json').read_bytes()
        write = install.atomic_write
        def reject_locked_file(path, data):
            if Path(path) == self.target/'bin/newslink.exe': raise PermissionError('file is in use')
            return write(path, data)
        with patch.object(install, 'atomic_write', side_effect=reject_locked_file), self.assertRaises(PermissionError):
            self.install({**self.old, 'bin/newslink.exe': b'NEW EXE'}, [], directories=['bin'])
        self.assertEqual((self.target/'bin/newslink.exe').read_bytes(), b'OLD EXE')
        self.assertEqual((self.target/'version.json').read_bytes(), receipt)
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_large_executable_rollback_accepts_journal_larger_than_thirty_megabytes(self):
        payload = b'X' * (24 * 1024 * 1024)
        original = {**self.old, 'bin/newslink.exe': payload}
        self.install(original, directories=['bin'])
        receipt = (self.target/'version.json').read_bytes()
        write = install.atomic_write
        def fail_receipt(path, data):
            if Path(path) == self.target/'version.json' and data != receipt: raise OSError('disk full')
            return write(path, data)
        with patch.object(install, 'atomic_write', side_effect=fail_receipt), self.assertRaises(OSError):
            self.install({**self.old, 'bin/newslink.exe': b'NEW'}, [], directories=['bin'])
        self.assertEqual((self.target/'bin/newslink.exe').read_bytes(), payload)
        self.assertEqual((self.target/'version.json').read_bytes(), receipt)
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_shared_dependency_modification_removal_and_module_shadowing_are_blocked(self):
        for after in ({**self.old,'main.py':b'changed=1'}, {**self.old,'requirements.txt':b'new-package'},
                      {'main.py':self.old['main.py']}, {**self.old,'time.py':b'VALUE=1'}, {**self.old,'lib/helper.py':b'VALUE=1'}):
            with self.subTest(after=tuple(after)), self.assertRaises(ValueError): policy.validate(self.old,after,[self.old])
        self.assertEqual((self.target/'main.py').read_bytes(),self.old['main.py'])

    def test_failure_rolls_back_added_file_and_version_receipt(self):
        (self.target/'sites').mkdir()
        registry = (self.target/'version.json').read_bytes(); original = install.atomic_write
        def fail(path,data):
            if Path(path)==self.target/'version.json' and data!=registry: raise OSError('disk full')
            return original(path,data)
        with patch.object(install,'atomic_write',side_effect=fail), self.assertRaises(OSError):
            self.install({**self.old,'sites/www.mkky.cn.py':b'VALUE=2'},[self.old])
        self.assertFalse((self.target/'sites/www.mkky.cn.py').exists())
        self.assertEqual((self.target/'version.json').read_bytes(),registry)

    def test_interrupted_live_update_is_recovered_before_next_install(self):
        original = install.atomic_write
        def crash(path,data):
            if Path(path)==self.target/'version.json': raise KeyboardInterrupt()
            return original(path,data)
        with patch.object(install,'atomic_write',side_effect=crash), self.assertRaises(KeyboardInterrupt):
            self.install({**self.old,'www.mkky.cn.py':b'VALUE=2'},[self.old])
        self.assertTrue(install.live_journal(self.target,self.cache).exists())
        self.install({**self.old,'www.mkky.cn.py':b'VALUE=3'},[self.old])
        self.assertEqual((self.target/'www.mkky.cn.py').read_bytes(),b'VALUE=3')
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_signed_legacy_bytecode_is_not_treated_as_a_running_dependency(self):
        from types import SimpleNamespace
        digest, signature = self.artifacts.publish({**self.old,'__pycache__/main.pyc':b'old cache'}, {'kind':'processor','executionSchema':2})
        db = SimpleNamespace(execute=lambda *args: SimpleNamespace(fetchone=lambda: {'digest':digest,'signature':signature}))
        programs = policy.server_programs(SimpleNamespace(artifacts=self.artifacts),db,[{'assignmentId':'test'}])
        self.assertEqual(programs,[self.old])

    def test_unreferenced_website_script_can_be_updated_again_while_old_program_runs(self):
        self.install({**self.old,'www.mkky.cn.py':b'VALUE=2'},[self.old])
        before=(self.target/'main.py').stat().st_mtime_ns
        self.install({**self.old,'www.mkky.cn.py':b'VALUE=3'},[self.old])
        self.assertEqual((self.target/'www.mkky.cn.py').read_bytes(),b'VALUE=3')
        self.assertEqual((self.target/'main.py').stat().st_mtime_ns,before)
