import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend.queue_processors import newslink


class NewslinkTests(unittest.TestCase):
    def test_runtime_settings_come_from_code_without_any_config_file(self):
        with patch.dict(os.environ, {}, clear=True), patch.multiple(newslink, MQ_USER='demo-user', MQ_PASSWORD='demo-password'):
            settings = newslink.read_settings()
        self.assertEqual(settings['mq'], {'host': '192.168.0.221', 'port': 9672, 'vhost': '/', 'user': 'demo-user', 'password': 'demo-password'})
        self.assertEqual(settings['save_url'], 'http://192.168.1.32:9102/api/v1/saver/save')
        self.assertEqual(settings['sites_directory'], 'sites')
        self.assertEqual(settings['_directory'], str(newslink.HERE))
        with patch.dict(os.environ, {'RUNNER_QUEUE': 'assigned_queue'}, clear=True), patch.multiple(newslink, MQ_USER='demo-user', MQ_PASSWORD='demo-password'):
            self.assertEqual(newslink.read_settings()['queue'], 'assigned_queue')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'sites').mkdir()
        self.settings = {
            '_directory': str(self.root),
            'save_url': 'http://saver.invalid/save',
        }
        self.task = {'TaskID': 123, 'SourceId': 7, 'ConfigId': 42, 'ParentID': 0,
                     'Url': 'https://one.example/news'}

    def script(self, host, title, field_id='1'):
        path = self.root / 'sites' / (host + '.py')
        path.write_text(
            "if __name__ == '__main__':\n    raise RuntimeError('must not run listener')\n"
            f"def scrape(url):\n    print('采集输出')\n    return [{{{field_id!r}: {title!r}, '2': '', '3': 'https://{host}/article'}}]\n",
            encoding='utf-8',
        )
        return path

    def test_dispatches_two_hosts_in_fresh_processes_and_reloads_updated_script(self):
        self.script('one.example', 'First')
        self.script('two.example', 'Second')
        for host, title in [('one.example', 'First'), ('two.example', 'Second')]:
            url = 'https://' + host + '/news'
            rows = newslink.run_scraper(newslink.site_script(url, self.settings), url)
            self.assertEqual(rows[0]['1'], title)
        self.script('one.example', 'Changed')
        url = self.task['Url']
        self.assertEqual(newslink.run_scraper(newslink.site_script(url, self.settings), url)[0]['1'], 'Changed')

    def test_missing_script_and_path_escape_are_explicit_failures(self):
        with self.assertRaisesRegex(FileNotFoundError, '缺少网站脚本'):
            newslink.site_script(self.task['Url'], self.settings)
        self.settings['host_scripts'] = {'one.example': '../escape.py'}
        with self.assertRaisesRegex(ValueError, '脚本路径'):
            newslink.site_script(self.task['Url'], self.settings)

    def test_validates_field_id_keys_without_transforming_or_deduplicating_values(self):
        rows = [{'11': '  标题  ', '22': '', '33': 0, '44': False, '55': None, '66': ['中文']}] * 2
        self.assertIs(newslink.validate_rows(rows), rows)
        self.assertEqual(rows[0]['33'], 0)
        self.assertEqual(rows[0]['44'], False)
        self.assertEqual(len(rows), 2)
        self.assertEqual(newslink.task_url(self.task, self.settings), self.task['Url'])
        self.assertEqual(newslink.task_url(dict(self.task, ConfigId=99), self.settings), self.task['Url'])
        for invalid in ([{'title': 'news'}], [{'1': 'news', 'url': '/article'}], [{1: 'news'}], [{}]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                newslink.validate_rows(invalid)

    def test_full_task_dispatch_saves_mapped_rows_then_returns_success(self):
        self.script('one.example', 'Actual news')
        response = Mock()
        response.json.return_value = {'success': True}
        channel = Mock()
        with patch('requests.post', return_value=response) as post:
            newslink.handle_message(channel, Mock(delivery_tag=9), json.dumps({'Task': self.task}), self.settings)
        payload = json.loads(post.call_args.kwargs['data'])
        self.assertEqual(payload['configId'], 42)
        self.assertEqual(payload['datas'], [{'1': 'Actual news', '2': '', '3': 'https://one.example/article'}])
        self.assertEqual(json.loads(channel.basic_publish.call_args.kwargs['body'])['IsSuccess'], 'true')
        channel.basic_ack.assert_called_once_with(delivery_tag=9)

    def test_different_sites_supply_their_own_ids_without_central_mapping(self):
        self.script('one.example', 'First', field_id='9001')
        self.script('two.example', 'Second', field_id='8001')
        response = Mock()
        response.json.return_value = {'success': True}
        # Legacy configuration must not reinterpret a site's final output.
        self.settings['field_mapping'] = {'title': '99999'}
        with patch('requests.post', return_value=response) as post:
            for config, host in [(42, 'one.example'), (99, 'two.example')]:
                newslink.process_task(dict(self.task, ConfigId=config, Url='https://' + host), self.settings)
        first, second = [json.loads(call.kwargs['data']) for call in post.call_args_list]
        self.assertEqual(first['configId'], 42)
        self.assertEqual(second['configId'], 99)
        self.assertEqual(first['datas'][0]['9001'], 'First')
        self.assertEqual(second['datas'][0]['8001'], 'Second')
        self.assertNotIn('99999', first['datas'][0])

    def test_logical_field_output_reports_failure_and_does_not_save(self):
        self.script('one.example', 'unused')
        channel = Mock()
        with patch.object(newslink, 'run_scraper', return_value=[{'title': 'not mapped'}]), patch('requests.post') as post:
            newslink.handle_message(channel, Mock(delivery_tag=7), json.dumps({'Task': self.task}), self.settings)
        post.assert_not_called()
        result = json.loads(channel.basic_publish.call_args.kwargs['body'])
        self.assertEqual(result['IsSuccess'], 'false')
        self.assertIn('网站脚本中完成字段映射', result['ErrorMessage'])
        channel.basic_ack.assert_called_once_with(delivery_tag=7)

    def test_worker_rejects_integer_keys_before_json_can_coerce_them(self):
        path = self.root / 'sites/one.example.py'
        path.write_text('def scrape(url):\n    return [{9001: "title"}]\n', encoding='utf8')
        with self.assertRaisesRegex(RuntimeError, '字段 ID 字符串'):
            newslink.run_scraper(path, self.task['Url'])

    def test_save_preserves_protocol_and_batches(self):
        response = Mock()
        response.json.return_value = {'success': True}
        with patch('requests.post', return_value=response) as post:
            newslink.save(self.task, [{'1': 'a'}] * 51, self.settings)
        self.assertEqual(post.call_count, 2)
        payload = json.loads(post.call_args.kwargs['data'])
        self.assertEqual(payload, {'sourceId': 7, 'configId': 42, 'parentId': 0,
                                  'taskId': 123, 'forceCommit': 'true', 'datas': [{'1': 'a'}]})
        response.json.return_value = {'success': False, 'msg': 'denied'}
        with patch('requests.post', return_value=response), self.assertRaisesRegex(RuntimeError, '未确认成功'):
            newslink.save(self.task, [{'1': 'a'}], self.settings)

    def test_success_and_failure_receipts_precede_ack_without_requeue(self):
        for error in (None, FileNotFoundError('缺少网站脚本'), RuntimeError('保存失败')):
            with self.subTest(error=error):
                channel = Mock()
                with patch.object(newslink, 'process_task', return_value=1, side_effect=error):
                    newslink.handle_message(channel, Mock(delivery_tag=8), json.dumps({'Task': self.task}), self.settings)
                receipt = json.loads(channel.basic_publish.call_args.kwargs['body'])
                self.assertEqual(receipt['IsSuccess'], 'false' if error else 'true')
                self.assertEqual(channel.basic_publish.call_args.kwargs['routing_key'], 'biz_msg_ret')
                self.assertTrue(channel.basic_publish.call_args.kwargs['mandatory'])
                self.assertEqual([call[0] for call in channel.mock_calls], ['basic_publish', 'basic_ack'])
                channel.basic_nack.assert_not_called()

    def test_failed_receipt_never_acknowledges_input(self):
        channel = Mock()
        channel.basic_publish.side_effect = RuntimeError('connection lost')
        with patch.object(newslink, 'process_task', return_value=1), self.assertRaisesRegex(RuntimeError, 'connection lost'):
            newslink.handle_message(channel, Mock(delivery_tag=8), json.dumps({'Task': self.task}), self.settings)
        channel.basic_ack.assert_not_called()

    def test_timeout_and_invalid_scraper_contract(self):
        path = self.root / 'sites' / 'one.example.py'
        path.write_text('import time\ndef scrape(url):\n    time.sleep(10)\n', encoding='utf-8')
        with self.assertRaises(newslink.subprocess.TimeoutExpired):
            newslink.run_scraper(path, self.task['Url'], timeout=0.2)
        path.write_text('def scrape(url):\n    return {}\n', encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, r'list\[dict\]'):
            newslink.run_scraper(path, self.task['Url'])


if __name__ == '__main__':
    unittest.main()
