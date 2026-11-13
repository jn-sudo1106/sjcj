import unittest

from backend.runner_management.python_dependency_contract import imports, merge_requirements


class PythonDependencyContractTest(unittest.TestCase):
    def test_aliases_pins_and_standard_library(self):
        modules = imports('import json, requests\nfrom bs4 import BeautifulSoup\nfrom .local import helper\n')
        self.assertEqual(modules, {'requests', 'bs4'})
        original = '# Keep constraints\nrequests>=2.31,<3\nbeautifulsoup4==4.12.3\n'
        self.assertEqual(merge_requirements(original, modules), original)
        self.assertEqual(merge_requirements('requests>=2.31,<3\n', modules),
                         'requests>=2.31,<3\nbeautifulsoup4\n')

    def test_no_guessing_for_unknown_imports_or_invalid_code(self):
        self.assertEqual(imports('import unknown_private_sdk\n'), set())
        self.assertEqual(imports('plain text is not code!'), set())

    def test_preflight_covers_unknown_imports_but_skips_optional_and_type_only(self):
        code = ('import private_sdk\ntry:\n import bs4\nexcept ImportError:\n pass\n'
                'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n import type_only_sdk\n')
        self.assertEqual(imports(code, known_only=False), {'private_sdk', 'typing'})
