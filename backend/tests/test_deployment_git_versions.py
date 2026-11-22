"""Deployment version labels use receipts, never the current editable mapping."""
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.runner_management import deployment_git_versions as versions
from backend.runner_management.artifacts import ArtifactStore
from backend.runner_management.directory_bindings import owner_key
from backend.runner_management.store import Store


class DeploymentGitVersionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.app = SimpleNamespace(store=Store(root / 'data.db'), artifacts=ArtifactStore(root / 'artifacts'))
        self.repo_id, self.deployment_id = 'a' * 32, 'b' * 32
        self.deployed, self.mapped, self.latest = '1' * 40, '2' * 40, '3' * 40
        with self.app.store.connect() as db:
            for runner in ('runner-a', 'runner-b'):
                db.execute('INSERT INTO runners (runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status) VALUES (?,?,?,?,?,?,?,?)',
                           (runner, runner, '127.0.0.1', '/runner/' + runner, 'linux', '[]', runner, 'online'))
                doc = {'runtimeId': runner, 'runnerId': runner, 'deploymentId': self.deployment_id, 'executionDirectory': 'links/123'}
                db.execute('INSERT INTO settings VALUES (?,?)', ('runtime-config:' + runner, json.dumps(doc)))
            db.execute('INSERT INTO code_repositories VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                       (self.repo_id, 'repo', str(root), 'https://git.invalid/repo', 'main', 1, 'ACTIVE', 'now', 'now', '', ''))
            layout = {'deploymentId': self.deployment_id, 'directoryTemplate': 'links/123', 'configId': '123', 'queueName': '', 'siteHost': '',
                      'nodes': [{'id': 'sites', 'parentId': '', 'name': 'sites', 'kind': 'folder', 'repoId': self.repo_id,
                                 'sourcePath': 'links/123/sites', 'sourceType': 'directory', 'gitCommit': self.mapped}]}
            db.execute('INSERT INTO settings VALUES (?,?)', ('deployment-config:' + self.deployment_id, json.dumps(layout)))

    def deliver(self, identifier, runner, commit, date, status='success', extra=None, remember=True):
        sources = [{'repoId': self.repo_id, 'sourcePath': 'links/123/sites/a.py', 'gitCommit': commit}]
        if extra:
            sources.append({'repoId': self.repo_id, 'sourcePath': 'links/123/sites/b.py', 'gitCommit': extra})
        digest, signature = self.app.artifacts.publish({'sites/a.py': commit.encode()}, {'sources': sources})
        with self.app.store.connect() as db:
            db.execute('INSERT INTO directory_deliveries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (identifier, 'deployment', owner_key(self.deployment_id), self.deployment_id, runner, 'revision', digest, signature,
                        'links/123', status, date, date, date, '', '/runner/links/123'))
            if remember:
                versions.remember(db, digest, sources)
        return digest

    def read(self, *ids):
        with patch.object(versions, 'remote_version', return_value={'remoteCommit': self.latest, 'remoteStatus': 'ok', 'remoteError': '', 'checkedAt': 'now'}):
            return versions.listing(self.app, {'runtimeId': list(ids)})['items']

    def test_latest_success_is_per_machine_and_newer_failure_does_not_replace_it(self):
        self.deliver('older', 'runner-a', '0' * 40, '2026-11-18')
        self.deliver('success', 'runner-a', self.deployed, '2026-11-19')
        self.deliver('failed', 'runner-a', self.latest, '2026-11-20', 'failed')
        self.deliver('other-machine', 'runner-b', '4' * 40, '2026-11-20')
        items = {item['runtimeId']: item for item in self.read('runner-a', 'runner-b')}
        self.assertEqual(items['runner-a']['deliveryId'], 'success')
        self.assertEqual(items['runner-a']['sources'][0]['deployedCommits'], [self.deployed])
        self.assertEqual(items['runner-b']['sources'][0]['deployedCommits'], ['4' * 40])
        self.assertEqual(items['runner-a']['sources'][0]['remoteCommit'], self.latest)

    def test_sql_metadata_does_not_reread_the_artifact_on_version_queries(self):
        self.deliver('saved', 'runner-a', self.deployed, '2026-11-19')
        with patch.object(self.app.artifacts, 'read', side_effect=AssertionError('Metadata was already saved')):
            self.assertEqual(self.read('runner-a')[0]['sources'][0]['deployedCommits'], [self.deployed])

    def test_historical_manifest_is_verified_once_and_mixed_commits_are_retained(self):
        self.deliver('history', 'runner-a', self.deployed, '2026-11-19', extra=self.mapped, remember=False)
        with patch.object(self.app.artifacts, 'read', wraps=self.app.artifacts.read) as read:
            for _ in range(2):
                self.assertEqual(self.read('runner-a')[0]['sources'][0]['deployedCommits'], [self.deployed, self.mapped])
            self.assertEqual(read.call_count, 1)

    def test_no_successful_delivery_never_uses_the_configured_commit(self):
        self.deliver('failed', 'runner-a', self.deployed, '2026-11-19', 'failed')
        item = self.read('runner-a')[0]
        self.assertEqual(item['deployedStatus'], 'not_delivered')
        self.assertEqual(item['sources'][0]['deployedCommits'], [])

    def test_remote_query_is_shared_and_cached_for_multiple_machine_rows(self):
        with patch.object(versions, 'remote_version', return_value={'remoteCommit': self.latest, 'remoteStatus': 'ok'}) as query:
            for _ in range(2):
                versions.listing(self.app, {'runtimeId': ['runner-a', 'runner-b']})
            self.assertEqual(query.call_count, 1)

    def test_git_check_only_reads_the_configured_remote_branch_and_redacts_errors(self):
        repo = {'local_path': self.tmp.name, 'remote_url': 'https://user:secret@git.invalid/repo', 'branch': 'main'}
        result = SimpleNamespace(returncode=0, stdout=self.latest + '\trefs/heads/main\n', stderr='')
        with patch.object(versions.subprocess, 'run', return_value=result) as run:
            self.assertEqual(versions.remote_version(repo)['remoteCommit'], self.latest)
            args, options = run.call_args
            self.assertEqual(args[0][1], 'ls-remote')
            self.assertEqual(args[0][-1], 'refs/heads/main')
            self.assertEqual(options['timeout'], 8)
            self.assertNotIn('fetch', args[0])
        with patch.object(versions.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['git', repo['remote_url']], 8)):
            error = versions.remote_version(repo)
            self.assertEqual(error['remoteStatus'], 'error')
            self.assertNotIn('secret', json.dumps(error))

    def test_real_git_remote_ref_is_read_without_changing_the_worktree(self):
        working = Path(self.tmp.name) / 'working'
        origin = Path(self.tmp.name) / 'origin.git'
        working.mkdir()
        def git(*args, cwd=working):
            return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()
        git('init', '-b', 'main')
        (working / 'file.py').write_text('VALUE=1\n')
        git('add', 'file.py')
        git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'first')
        git('init', '--bare', str(origin))
        git('push', str(origin), 'main')
        expected = git('rev-parse', 'HEAD')
        (working / 'file.py').write_text('LOCAL_EDIT=1\n')
        result = versions.remote_version({'local_path': str(working), 'remote_url': origin.as_uri(), 'branch': 'main'})
        self.assertEqual(result['remoteCommit'], expected)
        self.assertEqual(git('rev-parse', 'HEAD'), expected)
        self.assertEqual((working / 'file.py').read_text(), 'LOCAL_EDIT=1\n')

    def test_file_comparison_distinguishes_origin_history_from_actual_changes(self):
        working = Path(self.tmp.name) / 'compare'
        working.mkdir()
        def git(*args):
            return subprocess.run(['git', *args], cwd=working, capture_output=True, text=True, check=True).stdout.strip()
        def commit(message):
            git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message)
            return git('rev-parse', 'HEAD')
        git('init', '-b', 'main')
        (working / 'file.py').write_text('VALUE=1\n')
        git('add', 'file.py'); old = commit('deployed file')
        (working / 'other.txt').write_text('unrelated new file\n')
        git('add', 'other.txt'); latest = commit('unrelated commit')
        repo = {'repo_id': 'compare', 'local_path': str(working)}
        sources = [{'repoId': 'compare', 'sourcePath': 'file.py', 'gitCommit': old}]
        # Thousands of deployed files must not spawn thousands of Git commands.
        with patch.object(versions.subprocess, 'run', wraps=versions.subprocess.run) as run:
            result = versions.compare_sources(self.app, repo, latest, sources * 1000)
            self.assertEqual(result['contentStatus'], 'same')
            self.assertEqual(result['comparedFiles'], 1)
            self.assertEqual(run.call_count, 2)
        (working / 'file.py').write_text('VALUE=2\n')
        git('add', 'file.py'); changed = commit('actual file change')
        result = versions.compare_sources(self.app, repo, changed, sources)
        self.assertEqual(result['contentStatus'], 'different')
        self.assertEqual(result['differentPaths'], ['file.py'])
        git('rm', 'file.py'); deleted = commit('delete deployed file')
        self.assertEqual(versions.compare_sources(self.app, repo, deleted, sources)['contentStatus'], 'different')

    def test_unavailable_commit_never_claims_files_are_different(self):
        repo = {'repo_id': 'missing', 'local_path': self.tmp.name}
        result = versions.compare_sources(self.app, repo, self.latest, [{'repoId': 'missing', 'sourcePath': 'file.py', 'gitCommit': self.deployed}])
        self.assertEqual(result['contentStatus'], 'unknown')
        self.assertTrue(result['contentError'])

    def test_directory_with_unresolved_delivery_exclusions_does_not_claim_a_file_difference(self):
        repo = {'repo_id': 'folder', 'local_path': self.tmp.name}
        source = {'repoId': 'folder', 'sourcePath': 'folder', 'gitCommit': self.deployed}
        with patch.object(versions, 'git_tree', side_effect=[{'folder/cache.pyc': 'new'}, {'folder/cache.pyc': 'old'}]):
            result = versions.compare_sources(self.app, repo, self.latest, [source])
        self.assertEqual(result['contentStatus'], 'unknown')
        self.assertEqual(result['differentPaths'], [])


if __name__ == '__main__':
    unittest.main()
