# -*- coding: utf-8 -*-
"""微信正式版解析器的无网络适配层。HTML 必须由调用方从 OSS 传入。"""

from __future__ import annotations

import importlib.util
import re
import threading
import warnings
from pathlib import Path
from types import ModuleType
from typing import Any

_MODULE: ModuleType | None = None
_LOCK = threading.Lock()


def _load_parser() -> ModuleType:
    """加载正式版函数；文件中的直接请求示例位于 __main__，不会执行。"""
    global _MODULE
    if _MODULE is not None:
        return _MODULE
    with _LOCK:
        if _MODULE is not None:
            return _MODULE
        source = Path(__file__).resolve().parents[1] / "scode" / "微信解析正式版.py"
        if not source.is_file():
            raise RuntimeError(f"微信正式版解析器不存在: {source}")
        spec = importlib.util.spec_from_file_location("qinlong_wechat_parser", source)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"无法加载微信正式版解析器: {source}")
        module = importlib.util.module_from_spec(spec)
        # 正式版沿用 <\WWIMAGE> 等历史输出标记，Python 会对字符串里的
        # ``\W`` 给出 SyntaxWarning，但标记本身是既有协议，加载时仅屏蔽警告。
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            spec.loader.exec_module(module)
        _MODULE = module
        return module


def _decode_html(value: str | bytes) -> str:
    if isinstance(value, str):
        return value
    for encoding in ("utf-8", "gb18030"):
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")


def extract_wechat_html(html_content: str | bytes) -> dict[str, Any]:
    """运行正式版全部解析规则；任何失败都返回空正文，不执行网络或通用兜底。"""
    empty = {
        "title": "", "report_time": "", "content": "", "nick_name": "",
        "writer": "", "appuin": "", "content_type": "0",
        "title_type": "0", "time_type": "0", "error": "",
    }
    source = _decode_html(html_content)
    if not source.strip():
        return empty
    try:
        parser = _load_parser()
        result = parser.parse_meta(source)
        rich_content = str(getattr(result, "source", "") or "")
        if not rich_content or re.match(
            r"^\s*<html>.*</html>\s*$", rich_content, re.I | re.S
        ):
            return {**empty, "error": "正式版未识别到正文"}
        body = parser.printContent(
            rich_content,
            '//div[@class="WW-EDIT"]',
            need_deletes=[],
            need_image=True,
            need_file=False,
        )
        body = "\n".join(
            line.strip() for line in str(body or "").splitlines() if line.strip()
        )
        if not body:
            return {**empty, "error": "正式版正文转换后为空"}
        title = str(getattr(result, "urltitle", "") or "").strip()
        appuin = str(getattr(result, "appuin", "") or "").strip()
        return {
            "title": title,
            "report_time": str(getattr(result, "urltime", "") or "").strip(),
            "content": (
                f"<WWTITLE>{title}<\\WWTITLE>\n"
                f"<WWBIZID>{appuin}<\\WWBIZID>\n{body}"
            ),
            "nick_name": str(getattr(result, "nick_name", "") or "").strip(),
            "writer": str(getattr(result, "writer", "") or "").strip(),
            "appuin": appuin,
            "content_type": str(getattr(result, "sreserved1", "") or "0"),
            "title_type": str(getattr(result, "nreserved1", "") or "0"),
            "time_type": str(getattr(result, "sreserved2", "") or "0"),
            "error": "",
        }
    except Exception as exc:
        return {**empty, "error": str(exc)}
