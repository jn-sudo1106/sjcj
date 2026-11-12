import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.runner_management import node_prompt_templates as prompts
from backend.runner_management.server import ApiError


class NodePromptDeletionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'prompts.sqlite3'
        self.app = SimpleNamespace(data_dir=Path(self.temp.name) / 'data')
        self.body = {'promptId': 10, 'sourceType': '90', 'nodeTypeName': '网页抓取', 'templateUse': 'script'}
        with self.connection() as db:
            db.execute('CREATE TABLE cfg_llm_node_prompt (prompt_id INTEGER PRIMARY KEY,prompt_name TEXT,node_type TEXT,node_type_name TEXT,template_use TEXT,IS_DELETE INTEGER DEFAULT 0,is_default INTEGER,system_prompt TEXT,category TEXT,user_prompt_template TEXT,output_schema TEXT,parameters TEXT,example_input TEXT,example_output TEXT,is_active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,created_by TEXT,updated_by TEXT,version INTEGER DEFAULT 1)')
            db.execute('CREATE TABLE cfg_source_type (SOURCE_TYPE TEXT PRIMARY KEY, TYPE_NAME TEXT)')
            db.execute('INSERT INTO cfg_source_type VALUES (?,?)', ('90','网页抓取'))
            db.execute('CREATE TABLE cfg_llm_node_prompt_selection (config_id TEXT,prompt_id INTEGER)')
            db.execute('INSERT INTO cfg_llm_node_prompt (prompt_id,prompt_name,node_type,node_type_name,template_use,is_delete,is_default,system_prompt) VALUES (10,?,?,?,?,?,?,?)', ('旧模板','90','网页抓取','script',0,0,'原始提示词'))
        self.mock = patch.object(prompts, 'connection', self.connection); self.mock.start()

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path); db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def tearDown(self):
        self.mock.stop(); self.temp.cleanup()

    def test_delete_exact_row_after_review_with_recoverable_backup(self):
        reviewed = prompts.preview(self.app, self.body)
        self.assertTrue(reviewed['canDelete'])
        result = prompts.remove(self.app, {**self.body, 'revision': reviewed['revision']})
        self.assertEqual(result, {'deleted': True, 'promptId': 10})
        with self.connection() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM cfg_llm_node_prompt WHERE prompt_id=10').fetchone())
        backups = list((self.app.data_dir / 'node-prompt-trash').glob('10-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text(encoding='utf8'))['prompt']['system_prompt'], '原始提示词')

    def test_default_and_current_references_block_deletion(self):
        for column in ('default', 'reference'):
            with self.connection() as db:
                db.execute('UPDATE cfg_llm_node_prompt SET is_default=?', (int(column == 'default'),))
                db.execute('DELETE FROM cfg_llm_node_prompt_selection')
                if column == 'reference': db.execute('INSERT INTO cfg_llm_node_prompt_selection VALUES (?,?)', ('1401218',10))
            reviewed = prompts.preview(self.app, self.body)
            self.assertFalse(reviewed['canDelete'])
            with self.assertRaises(ApiError): prompts.remove(self.app, {**self.body, 'revision': reviewed['revision']})

    def test_stale_revision_preserves_the_changed_prompt(self):
        reviewed = prompts.preview(self.app, self.body)
        with self.connection() as db: db.execute("UPDATE cfg_llm_node_prompt SET system_prompt='新的内容'")
        with self.assertRaises(ApiError) as raised: prompts.remove(self.app, {**self.body, 'revision': reviewed['revision']})
        self.assertEqual(raised.exception.status, 409)

    def test_reference_added_after_preview_still_blocks_delete(self):
        reviewed = prompts.preview(self.app, self.body)
        with self.connection() as db: db.execute('INSERT INTO cfg_llm_node_prompt_selection VALUES (?,?)', ('1401218',10))
        with self.assertRaises(ApiError): prompts.remove(self.app, {**self.body, 'revision': reviewed['revision']})

    def test_wrong_type_use_or_invalid_id_rejected(self):
        for changes in ({'sourceType':'95','nodeTypeName':'文件下载'}, {'templateUse':'config'}, {'promptId':True}, {'promptId':'10 OR 1=1'}):
            with self.subTest(changes=changes), self.assertRaises(ApiError): prompts.preview(self.app, {**self.body, **changes})

    def test_backup_failure_never_removes_the_row(self):
        reviewed = prompts.preview(self.app, self.body)
        with patch.object(prompts.json, 'dump', side_effect=OSError('disk full')), self.assertRaises(OSError):
            prompts.remove(self.app, {**self.body, 'revision': reviewed['revision']})
        with self.connection() as db: self.assertIsNotNone(db.execute('SELECT 1 FROM cfg_llm_node_prompt WHERE prompt_id=10').fetchone())

    def test_old_prompt_table_without_soft_delete_column_is_supported(self):
        with self.connection() as db: db.execute('ALTER TABLE cfg_llm_node_prompt DROP COLUMN is_delete')
        reviewed = prompts.preview(self.app, self.body)
        self.assertTrue(reviewed['canDelete'])
        self.assertTrue(prompts.remove(self.app, {**self.body, 'revision': reviewed['revision']})['deleted'])

    def template(self, **changes):
        return {'promptId':0,'sourceType':'90','templateUse':'script','promptName':'新模板','category':'collect',
                'systemPrompt':'系统提示词','userPromptTemplate':'用户 {{url}}','isActive':1,'isDefault':0, **changes}

    def test_save_and_reload_actual_prompt_content_and_actor(self):
        original = prompts.listing(self.app, self.body)[0]
        saved = prompts.save(self.app, self.template(**{**original, 'systemPrompt':'修改后的系统提示词\n第二行', 'category':'collect'}), 'muyan')
        self.assertEqual(saved['promptId'], 10)
        self.assertEqual(saved['updatedBy'], 'muyan')
        reloaded = prompts.listing(self.app, self.body)[0]
        self.assertEqual(reloaded['systemPrompt'], '修改后的系统提示词\n第二行')
        self.assertNotEqual(original['revision'], reloaded['revision'])
        with self.assertRaises(ApiError): prompts.save(self.app, self.template(**original), 'muyan')

    def test_creating_defaults_keeps_one_default_and_purpose_isolation(self):
        first = prompts.save(self.app, self.template(isDefault=1))
        second = prompts.save(self.app, self.template(promptName='第二模板',isDefault=1))
        rows = prompts.listing(self.app, self.body)
        self.assertEqual([row['promptId'] for row in rows if row['isDefault']], [second['promptId']])
        self.assertNotEqual(first['promptId'], second['promptId'])
        self.assertEqual(prompts.listing(self.app, {**self.body,'templateUse':'config'}), [])

    def test_invalid_json_disabled_default_unknown_type_and_duplicate_name_fail(self):
        for body in (self.template(parameters='{bad'), self.template(isActive=0,isDefault=1), self.template(sourceType='9999'), self.template(promptName='旧模板')):
            with self.assertRaises(ApiError): prompts.save(self.app, body)
        self.assertEqual(len(prompts.listing(self.app, self.body)), 1)

    def test_legacy_uppercase_delete_flag_is_respected(self):
        with self.connection() as db: db.execute('UPDATE cfg_llm_node_prompt SET IS_DELETE=-1')
        self.assertEqual(prompts.listing(self.app, self.body), [])
        with self.assertRaises(ApiError): prompts.preview(self.app, self.body)

    def test_open_java_editor_can_save_its_original_text_without_losing_changes(self):
        with self.connection() as db:
            current = prompts.normalize(db.execute('SELECT * FROM cfg_llm_node_prompt WHERE prompt_id=10').fetchone())
        saved = prompts.save(self.app, self.template(promptId=10,promptName='旧模板',revision=prompts.legacy_revision(current),systemPrompt='保留当前编辑的内容'))
        self.assertEqual(saved['systemPrompt'], '保留当前编辑的内容')
