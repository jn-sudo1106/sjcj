import sqlite3
import unittest

from backend.runner_management.deployment_configuration import with_source_nodes


class DeploymentOriginsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)

    def schema(self):
        self.db.executescript('''
            CREATE TABLE cs_flow (FLOW_ID INTEGER, FLOW_NAME TEXT, IS_DELETE INTEGER);
            CREATE TABLE cs_item_config (ITEM_CONFIG INTEGER, NAME TEXT, CONFIG_ID INTEGER,
                                         FLOW_ID INTEGER, IS_DELETE INTEGER);
            INSERT INTO cs_flow VALUES (10,'原流程',0),(11,'草稿流程',2),(12,'已删除',-1);
            INSERT INTO cs_item_config VALUES (100,'列表',123,10,0),(101,'草稿列表',123,11,0),
                (102,'删除节点',123,10,-1),(103,'已删流程的节点',123,12,0),(104,'无关节点',456,10,0);
        ''')

    def test_includes_all_live_versions_without_rebinding_or_mutating_revision(self):
        self.schema()
        item = {'configId': '123', 'revision': 'saved-revision'}
        result = with_source_nodes(self.db, [item])[0]
        self.assertEqual([(n['flowId'], n['stepId'], n['isDraft']) for n in result['relatedSourceNodes']],
                         [('10', '100', False), ('11', '101', True)])
        self.assertNotIn('sourceNode', result)
        self.assertEqual(result['revision'], item['revision'])
        self.assertNotIn('relatedSourceNodes', item)

    def test_keeps_explicit_origin_and_distinguishes_missing_nodes_from_public_deployment(self):
        self.schema()
        origin = {'flowId': '10', 'stepId': '100'}
        result = with_source_nodes(self.db, [{'configId': '123', 'sourceNode': origin},
                                            {'configId': '999'}, {'configId': ''}])
        self.assertEqual(result[0]['sourceNode'], origin)
        self.assertEqual(result[1]['relatedSourceNodes'], [])
        self.assertEqual(result[2]['relatedSourceNodes'], [])

    def test_standalone_install_without_business_tables_still_loads(self):
        self.assertEqual(with_source_nodes(self.db, [{'configId': '123'}]), [{'configId': '123'}])

    def test_unexpected_query_errors_are_not_hidden(self):
        self.db.execute('CREATE TABLE cs_item_config (CONFIG_ID INTEGER)')
        self.db.execute('CREATE TABLE cs_flow (FLOW_ID INTEGER)')
        with self.assertRaises(sqlite3.OperationalError):
            with_source_nodes(self.db, [{'configId': '123'}])


if __name__ == '__main__':
    unittest.main()
