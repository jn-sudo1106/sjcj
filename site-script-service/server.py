"""Generate a downloadable site scraper from a fixed sample and a user prompt."""

import ast
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


SAMPLE_ID = "www.realcan.cn.py"
SAMPLE = (Path(__file__).parent / "samples" / SAMPLE_ID).read_text(encoding="utf-8")
MAX_BODY = 32 * 1024
MAX_CODE = 200 * 1024
SYSTEM_PROMPT = (
    "你是 Python 网站采集脚本开发者。参考给定样例的接口和代码风格，"
    "为目标列表页编写完整、可独立保存的 Python 代码。只返回代码，不要 Markdown 围栏或解释。"
    "必须提供 scrape(url) 函数并返回 list[dict]；每条尽量包含 title/date/url/summary/content。"
    "不要生成 MQ、数据库、文件上传或流程调度代码。导入模块时不能发起网站请求。"
    "不要照搬样例站点的域名、页面选择器和专用解析逻辑。"
)


class GenerationError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def file_name_for_url(value):
    try:
        parsed = urlparse(value.strip())
        host = (parsed.hostname or "").lower()
    except (ValueError, AttributeError):
        raise GenerationError("请输入有效的 http(s) 列表 URL")
    if parsed.scheme not in ("http", "https") or not re.fullmatch(
        r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", host
    ) or "." not in host or ".." in host:
        raise GenerationError("请输入有效的 http(s) 列表 URL")
    return f"{host}.py"


def normalize_code(text):
    code = text.strip()
    fenced = re.fullmatch(r"```(?:python|py)?\s*\n(.*?)\n```", code, re.I | re.S)
    if fenced:
        code = fenced.group(1).strip()
    return code + "\n"


def validate_code(code):
    if not code.strip() or len(code.encode("utf-8")) > MAX_CODE:
        raise GenerationError("生成代码为空或超过 200 KB", 422)
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise GenerationError(f"生成的 Python 语法错误：第 {exc.lineno} 行 {exc.msg}", 422) from exc
    scrape = next(
        (node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "scrape"),
        None,
    )
    if scrape is None or not scrape.args.args or scrape.args.args[0].arg != "url":
        raise GenerationError("生成代码必须包含 scrape(url) 函数", 422)
    return code


def generate(payload, request_json=None):
    if not isinstance(payload, dict):
        raise GenerationError("请求体必须是 JSON 对象")
    prompt = payload.get("prompt")
    url = payload.get("url")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 12000:
        raise GenerationError("请填写 1–12000 字的抓取提示词")
    if not isinstance(url, str):
        raise GenerationError("请输入列表 URL")
    if payload.get("sampleId") != SAMPLE_ID:
        raise GenerationError("样例代码标识无效")
    file_name = file_name_for_url(url)
    endpoint = os.getenv("SITE_SCRIPT_AI_ENDPOINT", "").strip()
    model = os.getenv("SITE_SCRIPT_AI_MODEL", "").strip()
    key = os.getenv("SITE_SCRIPT_AI_API_KEY", "").strip()
    if not endpoint or not model or not key:
        raise GenerationError("代码生成服务尚未配置模型地址、模型名称或密钥", 503)
    if not endpoint.startswith("https://") and not endpoint.startswith("http://"):
        raise GenerationError("模型接口地址无效", 503)
    body = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": (
                f"目标列表 URL：{url.strip()}\n\n用户要求：\n{prompt.strip()}\n\n"
                f"参考样例（{SAMPLE_ID}）：\n```python\n{SAMPLE}\n```"
            )},
        ],
    }
    if request_json is None:
        request_json = call_model
    result = request_json(endpoint, key, body)
    try:
        text = result["choices"][0]["message"]["content"]
        if isinstance(text, list):
            text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
        if not isinstance(text, str):
            raise TypeError("missing content")
    except (KeyError, IndexError, TypeError) as exc:
        raise GenerationError("模型未返回代码内容", 502) from exc
    code = validate_code(normalize_code(text))
    return {"fileName": file_name, "code": code, "warnings": []}


def call_model(endpoint, key, body):
    request = Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            return json.load(response)
    except HTTPError as exc:
        raise GenerationError(f"模型服务请求失败（HTTP {exc.code}）", 502) from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GenerationError("模型服务不可用或响应无效", 502) from exc


def check_auth(headers):
    """Production gateway validates the caller against the existing user-info contract."""
    auth_url = os.getenv("SITE_SCRIPT_AUTH_URL", "").strip()
    if not auth_url:
        return
    forwarded = {}
    for name in ("Cookie", "Access-Token"):
        value = headers.get(name)
        if value:
            forwarded[name] = value
    if not forwarded:
        raise GenerationError("请先登录", 401)
    request = Request(auth_url, headers=forwarded, method="GET")
    try:
        with urlopen(request, timeout=5) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise GenerationError("登录状态验证失败", 401) from exc
    if not isinstance(payload, dict) or str(payload.get("code")) != "0" or not payload.get("data"):
        raise GenerationError("请先登录", 401)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/ai/site-script/generate":
            self.send_error(404)
            return
        try:
            if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
                raise GenerationError("请求必须使用 application/json", 415)
            check_auth(self.headers)
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise GenerationError("请求体为空或超过 32 KB", 413)
            payload = json.loads(self.rfile.read(size))
            result = generate(payload)
            self.respond(200, result)
        except GenerationError as exc:
            self.respond(exc.status, {"message": str(exc)})
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.respond(400, {"message": "请求 JSON 无效"})
        except Exception:
            self.respond(500, {"message": "代码生成服务内部错误"})

    def respond(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    host = os.getenv("SITE_SCRIPT_HOST", "127.0.0.1")
    port = int(os.getenv("SITE_SCRIPT_PORT", "8091"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()
