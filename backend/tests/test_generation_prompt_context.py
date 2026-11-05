import unittest
from types import SimpleNamespace
from backend.runner_management import generation_prompt_context as context
from backend.runner_management.server import ApiError


class GenerationPromptContextTest(unittest.TestCase):
    def setUp(self):
        self.body = {'url':'https://www.mkky.cn/news','configId':'1401218','queueName':'auto_snatch_web_link','taskId':'task-1'}
        self.service = SimpleNamespace(file_name_for_url=lambda url: 'www.mkky.cn.py')
        self.workspace = {'prjDir':r'D:\codeserver\workspace\1401218','codeDir':r'D:\codeserver\workspace\1401218\code',
                          'inputFileDir':r'D:\codeserver\workspace\1401218\input','outputFileDir':r'D:\codeserver\workspace\1401218\output','taskId':'task-1'}

    def test_filename_follows_queue_when_no_explicit_filename_is_submitted(self):
        self.assertEqual(context.filename({**self.body,'fileNameMode':'queue'},self.service),'auto_snatch_web_link.py')
        self.assertEqual(context.filename(self.body,self.service),'www.mkky.cn.py')
        self.assertEqual(context.filename({**self.body,'fileName':'chosen.py'},self.service),'chosen.py')
        with self.assertRaises(ApiError): context.filename({**self.body,'fileNameMode':'queue','queueName':''},self.service)
        with self.assertRaises(ApiError): context.filename({**self.body,'fileName':'../invalid.py'},self.service)

    def test_runtime_variables_and_required_context_precede_user_mq_end_without_sample(self):
        values=context.variables(self.body,'www.mkky.cn.py',self.workspace)
        user='列表：{{url}}\n文件：{{file_name}}\n保存：{{code_file_path}}\n{{code_save_requirement}}\n【MQ 主题结束】'
        prompt=context.compose('目录 {{code_dir}}，配置 ${configId}',user,values)
        self.assertIn(r'D:\codeserver\workspace\1401218\code\www.mkky.cn.py',prompt)
        self.assertIn('生成文件名：www.mkky.cn.py',prompt)
        self.assertIn('配置 1401218',prompt)
        self.assertTrue(prompt.endswith('【MQ 主题结束】'))
        self.assertLess(prompt.index('【本次代码生成配置】'),prompt.index('用户要求：'))
        self.assertNotIn('www.realcan.cn',prompt);self.assertNotIn('参考样例',prompt)
        self.assertNotIn('{{file_name}}',prompt)

    def test_linux_paths_and_direct_chat_contract_are_not_invented_windows_paths(self):
        linux=context.variables(self.body,'site.py',{'codeDir':'/data/code/1401218/code'})
        self.assertEqual(linux['code_file_path'],'/data/code/1401218/code/site.py')
        chat=context.variables(self.body,'site.py')
        self.assertEqual(chat['code_dir'],'');self.assertEqual(chat['code_file_path'],'')
        self.assertIn('响应正文返回完整',chat['code_save_requirement'])

    def test_template_replacement_is_single_pass_and_preserves_unknown_tokens(self):
        self.assertEqual(context.fill('{{ url }} / {{unknown}}',{'url':'https://example.com/{{file_name}}'}),
                         'https://example.com/{{file_name}} / {{unknown}}')
