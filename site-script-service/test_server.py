import os
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import GenerationError, Handler, check_auth, file_name_for_url, generate, validate_code


class SiteScriptServiceTest(unittest.TestCase):
    def test_file_name_uses_url_host(self):
        self.assertEqual(file_name_for_url("https://www.realcan.cn/newscenter"), "www.realcan.cn.py")
        with self.assertRaises(GenerationError):
            file_name_for_url("javascript:alert(1)")

    def test_generate_sends_prompt_and_sample_and_validates_code(self):
        captured = {}

        def fake_model(endpoint, key, body):
            captured.update(body)
            return {"choices": [{"message": {"content": "```python\ndef scrape(url):\n    return []\n```"}}]}

        env = {
            "SITE_SCRIPT_AI_ENDPOINT": "https://example.test/v1/chat/completions",
            "SITE_SCRIPT_AI_MODEL": "test-model",
            "SITE_SCRIPT_AI_API_KEY": "test-key",
        }
        with patch.dict(os.environ, env):
            result = generate(
                {"prompt": "提取标题", "url": "https://www.realcan.cn/newscenter", "sampleId": "www.realcan.cn.py"},
                fake_model,
            )
        self.assertEqual(result["fileName"], "www.realcan.cn.py")
        self.assertEqual(result["code"], "def scrape(url):\n    return []\n")
        self.assertIn("提取标题", captured["messages"][1]["content"])
        self.assertIn("def scrape(", captured["messages"][1]["content"])

    def test_rejects_invalid_generated_python(self):
        for code in ("def scrape(url):\n  return (", "def other(url):\n  return []"):
            with self.assertRaises(GenerationError) as caught:
                validate_code(code)
            self.assertEqual(caught.exception.status, 422)

    def test_http_endpoint_returns_clear_configuration_error(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            body = json.dumps({
                "prompt": "提取标题",
                "url": "https://www.realcan.cn/newscenter",
                "sampleId": "www.realcan.cn.py",
            }).encode("utf-8")
            request = Request(
                f"http://127.0.0.1:{server.server_port}/api/ai/site-script/generate",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with patch.dict(os.environ, {
                "SITE_SCRIPT_AI_ENDPOINT": "",
                "SITE_SCRIPT_AI_MODEL": "",
                "SITE_SCRIPT_AI_API_KEY": "",
            }):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(request, timeout=3)
            self.assertEqual(caught.exception.code, 503)
            self.assertIn("尚未配置", json.load(caught.exception)["message"])
        finally:
            server.shutdown()
            server.server_close()

    def test_production_auth_rejects_requests_without_session(self):
        with patch.dict(os.environ, {"SITE_SCRIPT_AUTH_URL": "https://example.test/api/user-info.htm"}):
            with self.assertRaises(GenerationError) as caught:
                check_auth({})
        self.assertEqual(caught.exception.status, 401)


if __name__ == "__main__":
    unittest.main()
