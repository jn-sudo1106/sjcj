import unittest
from unittest.mock import patch

from backend.runner_management.system_info import operating_system_info


class RunnerSystemInfoTest(unittest.TestCase):
    def setUp(self):
        operating_system_info.cache_clear()

    def tearDown(self):
        operating_system_info.cache_clear()

    def test_windows_edition_and_build_number(self):
        with patch('platform.system', return_value='Windows'), patch('platform.win32_ver', return_value=('11', '10.0.22631', '', '')), patch('platform.win32_edition', return_value='Professional'):
            self.assertEqual(operating_system_info(), {'osType': 'Windows', 'osVersion': '11 Professional · 10.0.22631'})

    def test_linux_distribution_and_kernel(self):
        with patch('platform.system', return_value='Linux'), patch('platform.freedesktop_os_release', return_value={'PRETTY_NAME': 'Ubuntu 24.04 LTS'}), patch('platform.release', return_value='6.8.0'):
            self.assertEqual(operating_system_info(), {'osType': 'Linux', 'osVersion': 'Ubuntu 24.04 LTS · 6.8.0'})

    def test_missing_linux_distribution_still_reports_kernel(self):
        with patch('platform.system', return_value='Linux'), patch('platform.freedesktop_os_release', side_effect=OSError('missing')), patch('platform.release', return_value='6.8.0'):
            self.assertEqual(operating_system_info(), {'osType': 'Linux', 'osVersion': '6.8.0'})

    def test_macos_uses_product_version(self):
        with patch('platform.system', return_value='Darwin'), patch('platform.mac_ver', return_value=('14.6', ('', '', ''), 'arm64')):
            self.assertEqual(operating_system_info(), {'osType': 'macOS', 'osVersion': '14.6'})

    def test_unavailable_version_does_not_prevent_runner_start(self):
        with patch('platform.system', return_value='Windows'), patch('platform.win32_ver', side_effect=OSError('unavailable')):
            self.assertEqual(operating_system_info(), {'osType': 'Windows', 'osVersion': ''})
