import unittest
from backend.runner_management.deployment_resources import view
from backend.runner_management.deployment_file_summary import summarize


class DeploymentFileSummaryTest(unittest.TestCase):
    def test_list_summary_uses_exact_task_selection_and_limits_preview_size(self):
        result = view({'status': 'success', 'selectedPaths': ['sites/c.py', 'sites/a.py', 'sites/b.py'], 'archive': {}})
        self.assertEqual(result['fileSummary'], {'paths': ['sites/a.py', 'sites/b.py'], 'total': 3, 'scope': 'task-files'})

    def test_legacy_archive_paths_stay_relative_to_actual_configuration_directory(self):
        archive = {'configId': '1401218', 'repoId': 'repo', 'directoryPath': 'links/1401218/sites', 'files': [
            {'path': 'links/1401218/sites/example.py'}, {'path': 'links/1401218/sites/requirements.txt'}]}
        result = view({'status': 'success', 'archive': archive})
        self.assertEqual(result['fileSummary']['paths'], ['sites/example.py', 'sites/requirements.txt'])
        self.assertEqual(result['fileSummary']['total'], 2)

    def test_full_directory_inventory_is_saved_and_failed_tasks_do_not_claim_deployment(self):
        saved = summarize(['file-%04d.py' % i for i in range(1270)], 'configuration')
        result = view({'status': 'success', 'fileSummary': saved, 'archive': {}})
        self.assertEqual(result['fileSummary']['total'], 1270)
        self.assertEqual(len(result['fileSummary']['paths']), 2)
        self.assertIsNone(view({'status': 'failed', 'fileSummary': saved, 'archive': {}})['fileSummary'])
        self.assertEqual(view({'status': 'success', 'deploymentScope': 'configuration', 'archive': {}})['fileSummary'],
                         {'paths': [], 'total': None, 'scope': 'configuration'})
