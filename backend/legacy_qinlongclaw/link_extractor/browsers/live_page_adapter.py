import json
from typing import Any

from browsers.cdp_client import CDPLocator


class LiveBrowserPageAdapter:
    """把 DrissionPage/ruyipage 的真实页面适配为现有提取器页面接口。"""

    def __init__(self, page: Any, browser_name: str):
        self.page = page
        self.browser_name = browser_name
        # 无 A 列表用该属性区分真实页面与 set_content 静态快照。
        # Firefox/Drission 的点击请求仍可由页面内的 fetch/XHR 拦截脚本捕获。
        self.network_responses = {}
        self.network_finished = set()

    @property
    def url(self) -> str:
        try:
            return str(self.page.url or "")
        except Exception:
            return ""

    def content(self) -> str:
        try:
            return str(self.page.html or "")
        except Exception:
            return ""

    def evaluate(self, js_code: str, *args, timeout_ms: int = 30000):
        source = str(js_code or "").strip()
        timeout_seconds = max(1, timeout_ms / 1000.0)
        function_prefix = source.split("{", 1)[0]
        if "=>" in function_prefix or source.startswith(("function", "async function")):
            serialized_args = ", ".join(
                json.dumps(value, ensure_ascii=False) for value in args
            )
            expression = f"({source})({serialized_args})"
            return self.page.run_js(
                expression, as_expr=True, timeout=timeout_seconds
            )
        return self.page.run_js(source, as_expr=True, timeout=timeout_seconds)

    def locator(self, xpath_expr: str) -> CDPLocator:
        return CDPLocator(self, xpath_expr)

    def goto(
        self, url: str, wait_until: str = "domcontentloaded", timeout: int = 30000
    ):
        del wait_until
        timeout_seconds = max(1, timeout / 1000.0)
        try:
            return self.page.get(url, timeout=timeout_seconds)
        except TypeError:
            return self.page.get(url)

    def get_network_inflight_count(self) -> int:
        return 0

    def get_network_json_responses(self):
        return []
