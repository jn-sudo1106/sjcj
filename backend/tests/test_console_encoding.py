import io
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from backend.runner_management.runtime_logs import ConsoleCapture


class ConsoleEncodingTest(unittest.TestCase):
    def capture(self, pipe):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = []
        queue = SimpleNamespace(root=Path(temporary.name), active_files=set(), lock=threading.RLock(),
                                reserve=lambda size: True, output=lambda run, stream, text: output.append(text), flush=Mock())
        capture = ConsoleCapture(queue, 'runtime-1', 'run-1')
        capture.attach(pipe)
        capture.thread.join(timeout=5)
        self.assertFalse(capture.thread.is_alive(), 'console reader must finish')
        capture.close()
        self.assertFalse(queue.active_files)
        return output, (capture.directory / 'console-0001.log').read_text(encoding='utf-8')

    def test_utf8_gbk_and_gb18030_are_uploaded_and_stored_as_readable_chinese(self):
        for encoding, text in [('utf-8', '任务执行失败：HTTP 403，采集程序退出 🔎'),
                               ('gbk', '任务执行失败：HTTP 403，采集程序退出'),
                               ('gb18030', '新闻标题：𠀀')]:
            with self.subTest(encoding=encoding):
                output, stored = self.capture(io.BytesIO((text + '\r\n').encode(encoding)))
                self.assertEqual(output, [text])
                self.assertEqual(stored, text + '\n')

    def test_ascii_utf8_and_legacy_lines_can_share_a_console_stream(self):
        output, stored = self.capture(io.BytesIO(b'Traceback:\n' + '旧程序错误\n'.encode('gbk') + '新程序日志\n'.encode('utf-8')))
        self.assertEqual(output, ['Traceback:', '旧程序错误', '新程序日志'])
        self.assertNotIn('\ufffd', stored)

    def test_bounded_reads_keep_multibyte_characters_split_at_fragment_boundary(self):
        for encoding, chinese in [('utf-8', '中文日志😀'), ('gbk', '中文日志'), ('gb18030', '𠀀中文')]:
            for newline in ('', '\n'):
                with self.subTest(encoding=encoding, newline=bool(newline)):
                    text = 'A' * 11999 + chinese
                    output, stored = self.capture(io.BytesIO((text + newline).encode(encoding)))
                    self.assertEqual(''.join(output), text)
                    self.assertNotIn('\ufffd', stored)

    def test_invalid_bytes_do_not_stop_reading_later_log_lines(self):
        output, _ = self.capture(io.BytesIO(b'broken \xff\n' + '后续日志\n'.encode('gbk')))
        self.assertIn('\ufffd', output[0])
        self.assertEqual(output[-1], '后续日志')

    def test_real_legacy_child_process_output_is_read_as_gbk(self):
        process = subprocess.Popen([sys.executable, '-c',
            "import sys; sys.stdout.buffer.write('旧程序中文输出\\n'.encode('gbk')); sys.stderr.buffer.write('中文异常\\n'.encode('gbk'))"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        output, stored = self.capture(process.stdout)
        self.assertEqual(process.wait(timeout=5), 0)
        self.assertCountEqual(output, ['旧程序中文输出', '中文异常'])
        self.assertNotIn('\ufffd', stored)


if __name__ == '__main__':
    unittest.main()
