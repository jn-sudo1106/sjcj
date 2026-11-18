import unittest
from unittest.mock import patch
from backend.runner_management.generation_continuation import history, render
from backend.runner_management.server import ApiError


class GenerationContinuationTest(unittest.TestCase):
    def record(self, **changes):
        return {'taskId': 'child', 'sourceId': 'source', 'flowId': 'flow', 'stepId': 'step', 'configId': 'config',
                'status': 'failed', 'input': {'url': 'https://example.com/news', 'userPrompt': '采集要求'}, **changes}

    def test_foreign_source_and_cycles_cannot_be_replayed_as_the_same_conversation(self):
        child = self.record(parentTaskId='parent')
        for parent in (self.record(taskId='parent', sourceId='other'), self.record(taskId='child')):
            with patch('backend.runner_management.database_generation.read', return_value=parent), self.assertRaises(ApiError):
                history(None, child)

    def test_failed_provider_response_is_context_rather_than_a_new_prepare_failure(self):
        turns = history(None, self.record(output='{"success":false,"message":"HTTP 403"}'))
        self.assertIn('HTTP 403', turns[0]['assistant'])

    def test_large_history_and_code_are_bounded_and_truncation_is_explicit(self):
        turn = {'taskId': 'previous', 'attempt': 1, 'status': 'failed', 'user': 'u' * 12000, 'assistant': 'a' * 8000}
        context = render([turn] * 6, 'c' * 200000)
        self.assertLess(len(context), 130000)
        self.assertIn('仅展示前 64000 字', context)
        self.assertIn('历史上下文结束', context)

    def test_latest_process_output_is_replayed_verbatim_as_the_previous_agent_reply(self):
        raw = '{"reply":"' + '真实过程输出' * 4000 + '"}'
        record = self.record(stages=['开始生成', '连接模型'], output=raw)
        turns = history(None, record)
        self.assertEqual(turns[0]['assistant'], '开始生成\n连接模型\n\n' + raw)
        self.assertIn(turns[0]['assistant'], render(turns, 'previous_code'))
