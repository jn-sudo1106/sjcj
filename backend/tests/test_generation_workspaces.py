import threading
import unittest
from backend.runner_management import generation_workspaces as workspaces
from backend.runner_management.server import ApiError


class StableWorkspacesTest(unittest.TestCase):
    def test_modes_and_traversal_validation(self):
        self.assertEqual(workspaces.directory({'configId': '123'}), '123')
        self.assertEqual(workspaces.directory({'workspaceMode': 'queue', 'queueName': 'news_list'}), 'news_list')
        self.assertEqual(workspaces.directory({'workspaceMode': 'custom', 'workspacePath': 'news/cninfo'}), 'news/cninfo')
        for value in ('../escape', 'D:\\outside', '/outside', '.git/config', 'CON', 'news/../bad', ''):
            with self.subTest(value=value), self.assertRaises(ApiError):
                workspaces.directory({'workspaceMode': 'custom', 'workspacePath': value})
        with self.assertRaises(ApiError):
            workspaces.directory({'workspaceMode': 'queue', 'queueName': 'a,b'})

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
