import io
import json
import unittest
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.tests import test_runner_management as fixtures
from backend.runner_management.server import ApiError


class RepositoryDownloadTest(unittest.TestCase):
    tearDown = fixtures.ManagementIntegrationTest.tearDown

    def setUp(self):
        fixtures.ManagementIntegrationTest.setUp(self)
        repo = self.app.list_repositories()[0]
        self.repo_id = repo['repoId']; self.root = Path(repo['path'])
        self.root.mkdir(parents=True, exist_ok=True)
        self.app.git(self.root, 'init', '-b', 'main')
        self.files = {'links/1401218/sites/新闻.py': 'VALUE = "新闻"\n'.encode(),
                      'links/1401218/requirements.txt': b'requests\n',
                      'bin/data.exe': bytes(range(256)) * 300, 'empty.txt': b''}
        for name, data in self.files.items():
            file = self.root / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(data)
        self.app.git(self.root, 'add', '.')
        self.app.git(self.root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Download fixture')
        self.head = self.app.git(self.root, 'rev-parse', 'HEAD').strip()
        self.route = self.url + '/api/runner-management/settings/code-repos/' + self.repo_id + '/files/download'

    def download(self, paths):
        request = Request(self.route, data=json.dumps({'paths': paths}).encode(), headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            return response.read(), response.headers

    def test_selected_files_preserve_paths_binary_and_pinned_git_bytes(self):
        (self.root / 'links/1401218/sites/新闻.py').write_text('LOCAL_UNCOMMITTED = True\n', encoding='utf8')
        selected = ['links/1401218/sites/新闻.py', 'bin/data.exe', 'empty.txt']
        with patch.object(self.app, 'authenticate_admin', return_value={'roles': ['reader']}) as auth:
            data, headers = self.download([*selected, selected[0]])
        self.assertFalse(auth.call_args.kwargs['write'])
        self.assertEqual(headers['Content-Type'], 'application/zip')
        self.assertIn(self.head[:12], headers['Content-Disposition'])
        self.assertEqual(int(headers['Content-Length']), len(data))
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(set(archive.namelist()), set(selected))
            for name in selected: self.assertEqual(archive.read(name), self.files[name])
        self.assertEqual(self.app.git(self.root, 'rev-parse', 'HEAD').strip(), self.head)
        self.assertIn('LOCAL_UNCOMMITTED', (self.root / selected[0]).read_text())

    def test_invalid_missing_and_non_file_selections_fail_without_a_partial_download(self):
        for paths in ([], None, ['../secret'], ['.git/config'], ['/absolute'], ['D:/outside'], ['bin\\data.exe'], ['links'], ['missing.py'], [None]):
            with self.subTest(paths=paths), self.assertRaises(HTTPError) as error: self.download(paths)
            self.assertIn(error.exception.code, (400, 404, 422))
            self.assertIn('application/json', error.exception.headers['Content-Type'])
        with patch('backend.runner_management.repository_download.MAX_CODE_BYTES', 1):
            with self.assertRaises(HTTPError) as too_large: self.download(['bin/data.exe'])
        self.assertEqual(too_large.exception.code, 413)

    def test_symlink_blob_and_unauthorized_download_are_rejected(self):
        blob = self.app.git(self.root, 'rev-parse', 'HEAD:empty.txt').strip()
        self.app.git(self.root, 'update-index', '--add', '--cacheinfo', '120000,' + blob + ',external-link')
        self.app.git(self.root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'Link fixture')
        with self.assertRaises(HTTPError) as link: self.download(['external-link'])
        self.assertEqual(link.exception.code, 422)
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('请先登录', 401)):
            with self.assertRaises(HTTPError) as denied: self.download(['empty.txt'])
        self.assertEqual(denied.exception.code, 401)
