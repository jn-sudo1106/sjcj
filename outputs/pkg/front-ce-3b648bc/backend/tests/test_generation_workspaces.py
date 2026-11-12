import threading
import unittest
from backend.runner_management import generation_workspaces as workspaces
from backend.runner_management.server import ApiError


class StableWorkspacesTest(unittest.TestCase):
    def test_output_subdirectory_keeps_root_and_updates_windows_and_unix_code_paths(self):
        from backend.runner_management.model_interfaces import agent_directories
        for root, expected in [(r'D:\workspace', r'D:\workspace\101\code\sites'), ('/data/workspace', '/data/workspace/101/code/sites')]:
            selected = {'id': 'test', 'prjDir': root, '_workspaceDirectory': '101', '_codeSubdirectory': 'sites'}
            self.assertEqual(agent_directories(selected, 'test')['codeDir'], expected)
        self.assertEqual(workspaces.node_defaults({})['outputSubdirectory'], '')
        for value in ('../outside', '/absolute', r'D:\outside', 'a//b', '.git', 'CON', None):
            with self.subTest(value=value), self.assertRaises(ApiError):
                workspaces.node_defaults({'outputSubdirectory': value})
    def test_git_binding_match_uses_directory_boundaries_and_remote_os(self):
        from backend.runner_management.generation_git_bindings import match, relative_path
        server = {'workspace': r'D:\workspace', 'generationGitBindings': [
            {'path': '', 'repositoryId': 'root'}, {'path': '101/News/code', 'repositoryId': 'specific'}]}
        self.assertEqual(match(server, r'd:\WORKSPACE\101\news\code\nested')['repositoryId'], 'specific')
        self.assertEqual(match(server, r'D:\workspace\101\News\code-other')['repositoryId'], 'root')
        self.assertEqual(relative_path(server, '.hidden/code'), '.hidden/code')
        self.assertEqual(relative_path(server, ''), '')
        for value in ('../outside', r'D:\other'):
            with self.assertRaises(ApiError): relative_path(server, value)
        unix = {'workspace': '/data/workspace', 'generationGitBindings': [{'path': 'Code', 'repositoryId': 'one'}]}
        self.assertIsNone(match(unix, '/data/workspace/code'))

    def test_modes_and_traversal_validation(self):
        self.assertEqual(workspaces.directory({'configId': '123', 'queueName': 'news_list'}), '123')
        self.assertEqual(workspaces.directory({'configId': '123', 'queueName': 'news_list', 'workspaceMode': 'config-queue'}), '123')
        self.assertEqual(workspaces.directory({'configId': '123', 'workspaceMode': 'config'}), '123')
        self.assertEqual(workspaces.directory({'workspaceMode': 'queue', 'queueName': 'news_list'}), 'news_list')
        self.assertEqual(workspaces.directory({'workspaceMode': 'custom', 'workspacePath': 'news/cninfo'}), 'news/cninfo')
        for value in ('../escape', 'D:\\outside', '/outside', '.git/config', 'CON', 'news/../bad', ''):
            with self.subTest(value=value), self.assertRaises(ApiError):
                workspaces.directory({'workspaceMode': 'custom', 'workspacePath': value})
        with self.assertRaises(ApiError):
            workspaces.directory({'workspaceMode': 'queue', 'queueName': 'a,b'})
        self.assertEqual(workspaces.directory({'configId': '123'}), '123')

    def test_manual_code_paths_and_shared_code_directory_are_protected(self):
        for value in ('', 'shared/news', r'D:\workspace\manual\code', '/data/workspace/news/code'):
            self.assertEqual(workspaces.validate_code_directory(value), value)
        for value in ('../outside', r'D:\workspace\..\outside', '.git/config', None, 'C:relative'):
            with self.subTest(value=value), self.assertRaises(ApiError):
                workspaces.validate_code_directory(value)
        with workspaces.serialized_paths('server', ['/data/project-a', '/data/shared-code'], 1):
            with self.assertRaises(ApiError):
                with workspaces.serialized_paths('server', ['/data/project-b', '/data/shared-code'], .01):
                    self.fail('shared code directory was not serialized')
            with workspaces.serialized_paths('server', ['/data/project-c', '/data/other-code'], .01):
                pass
        self.assertEqual(workspaces._LOCKS, {})

    def test_same_directory_serializes_but_other_directories_are_independent(self):
        entered = threading.Event()
        finished = threading.Event()
        def second():
            entered.set()
            with workspaces.serialized('server', r'd:\workspace\123', 2):
                finished.set()
        with workspaces.serialized('server', r'D:\workspace\123', 2):
            thread = threading.Thread(target=second)
            thread.start()
            self.assertTrue(entered.wait(1))
            self.assertFalse(finished.wait(0.05))
            with workspaces.serialized('server', r'D:\workspace\456', 0.1):
                self.assertFalse(finished.is_set())
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertTrue(finished.is_set())
        self.assertEqual(workspaces._LOCKS, {})
