import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from backend.runner_management.store import Store
from backend.runner_management import deployment_configuration as configs, directory_bindings, runtime_history
from backend.runner_management import directory_delivery  # Bind its owner_layout import before mocking it below.


class ConfigurationLookupCostTest(unittest.TestCase):
    def test_saved_config_is_one_exact_lookup_not_a_full_registry_read(self):
        with TemporaryDirectory() as tmp:
            store=Store(Path(tmp)/'test.db')
            app=SimpleNamespace(store=store)
            identifier='a'*32
            saved={'deploymentId':identifier,'registryKey':'@deployment:'+identifier,'revision':'saved','name':'目标配置','nodes':[]}
            with store.connect() as db:
                db.execute('INSERT INTO settings VALUES (?,?)',(configs.DEPLOYMENT_PREFIX+identifier,json.dumps(saved)))
                db.execute('INSERT INTO settings VALUES (?,?)',('generated-code-result:unrelated','x'*200000))
                recording=Mock(wraps=db)
                with patch.object(configs,'configurations',side_effect=AssertionError('Do not load all deployment configurations')):
                    self.assertEqual(configs.get_configuration(app,identifier,recording),saved)
                self.assertEqual(recording.execute.call_count,1)
                self.assertIn('WHERE setting_key=?',recording.execute.call_args.args[0])

    def test_registry_only_loads_layout_setting_prefixes(self):
        with TemporaryDirectory() as tmp:
            store=Store(Path(tmp)/'test.db')
            with store.connect() as db:
                db.execute('INSERT INTO settings VALUES (?,?)',('generated-code-result:unrelated','x'*200000))
                recording=Mock(wraps=db)
                self.assertEqual(configs.configurations(SimpleNamespace(store=store),recording),{})
                for call in recording.execute.call_args_list:
                    sql=call.args[0]
                    if 'FROM settings' in sql:self.assertIn('WHERE setting_key',sql)

    def test_binding_list_reuses_preloaded_layouts(self):
        identifier='b'*32
        layout={'directoryTemplate':'links/123','entryPoint':'main.py','revision':'saved'}
        db=Mock()
        def query(sql,*args):
            values=[{'binding_type':'deployment','owner_id':identifier,'runner_id':'runner','created_at':'now'}] if sql=='SELECT * FROM directory_runner_bindings' else []
            return Mock(fetchall=Mock(return_value=values))
        db.execute.side_effect=query
        with patch.object(directory_bindings,'owner_layout',side_effect=AssertionError('Do not query the same layout again')):
            result=directory_bindings.list_bindings(None,db,layouts={identifier:layout})
        self.assertEqual(result[0]['ownerId'],identifier)
        self.assertEqual(result[0]['layoutRevision'],'saved')

    def test_empty_assignments_do_not_load_the_platform_configuration_registry(self):
        with patch.object(configs,'runtime_rows',side_effect=AssertionError('No assignments need no runtime context')):
            self.assertEqual(runtime_history.assignment_contexts(None,None,[]),[])
