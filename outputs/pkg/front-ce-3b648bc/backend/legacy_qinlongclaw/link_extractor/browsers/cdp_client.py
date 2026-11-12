# -*- coding: utf-8 -*-
import json
import base64
import logging
import os
import subprocess
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional
import websocket
from utils.http_page_validator import HttpPageError, detect_http_error_page

CDP_PORT = 9222
_cdp_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
MAX_OPEN_PAGE_TABS = 5
CDP_HOSTS = [f"http://127.0.0.1:{CDP_PORT}", f"http://[::1]:{CDP_PORT}", f"http://localhost:{CDP_PORT}"]


def find_chrome() -> Optional[str]:
    """查找系统中的 Chrome 可执行文件路径"""
    candidates = [
        r"E:\qinlongchrome\qinlong.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def get_cdp_base_url() -> Optional[str]:
    """返回可用的 Chrome CDP 基础地址"""
    for base in CDP_HOSTS:
        try:
            req = urllib.request.Request(f"{base}/json/version", headers={"Host": "localhost"})
            with _cdp_opener.open(req, timeout=2) as resp:
                if resp.status == 200:
                    return base
        except Exception:
            continue
    return None


def launch_chrome(chrome_path: str, port: int = CDP_PORT, user_data_dir: Optional[str] = None):
    """后台启动 Chrome 并开启远程调试端口"""
    if not user_data_dir:
        user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\chrome-cdp-session")
    os.makedirs(user_data_dir, exist_ok=True)
    cmd = [
        chrome_path,
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=*",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        # 该兼容启动入口同样属于默认直连 CDP，禁止继承系统代理。
        "--no-proxy-server",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        "--window-size=1280,800",
        "--window-position=100,100",
        "--start-minimized",
    ]
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class CDPLocator:
    """对应 Playwright Locator，基于 CDP / DOM 原生 XPath 操作封装"""

    def __init__(self, page: "CDPPage", raw_xpath: str):
        self.page = page
        self.raw_xpath = self._clean_xpath(raw_xpath)

    @staticmethod
    def _clean_xpath(xpath: str) -> str:
        if xpath.startswith("xpath="):
            return xpath[6:]
        return xpath

    def count(self) -> int:
        js = f"""
        (() => {{
            try {{
                const res = document.evaluate({json.dumps(self.raw_xpath)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                return res.snapshotLength;
            }} catch(e) {{
                return 0;
            }}
        }})
        """
        res = self.page.evaluate(js)
        return int(res) if res is not None else 0

    def get_attribute(self, name: str) -> Optional[str]:
        js = f"""
        (() => {{
            try {{
                const res = document.evaluate({json.dumps(self.raw_xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = res.singleNodeValue;
                return el ? el.getAttribute({json.dumps(name)}) : null;
            }} catch(e) {{
                return null;
            }}
        }})
        """
        return self.page.evaluate(js)

    def text_content(self) -> str:
        js = f"""
        (() => {{
            try {{
                const res = document.evaluate({json.dumps(self.raw_xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = res.singleNodeValue;
                return el ? (el.textContent || '').trim() : '';
            }} catch(e) {{
                return '';
            }}
        }})
        """
        res = self.page.evaluate(js)
        return str(res or "").strip()

    def evaluate(self, js_func: str, *args) -> Any:
        args_json = ", ".join(json.dumps(a) for a in args)
        if args_json:
            args_json = ", " + args_json
        js = f"""
        (() => {{
            try {{
                const res = document.evaluate({json.dumps(self.raw_xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = res.singleNodeValue;
                if (!el) return null;
                const fn = ({js_func});
                return fn(el{args_json});
            }} catch(e) {{
                return null;
            }}
        }})
        """
        return self.page.evaluate(js)

    @property
    def first(self) -> "CDPLocator":
        return CDPLocator(self.page, f"({self.raw_xpath})[1]")

    def all(self) -> List["CDPLocator"]:
        c = self.count()
        return [CDPLocator(self.page, f"({self.raw_xpath})[{i}]") for i in range(1, c + 1)]

    def locator(self, sub_xpath: str) -> "CDPLocator":
        sub_raw = self._clean_xpath(sub_xpath)
        if sub_raw.startswith("xpath="):
            sub_raw = sub_raw[6:]
        if sub_raw.startswith("/"):
            combined = f"({self.raw_xpath})[1]{sub_raw}"
        elif sub_raw.startswith("."):
            combined = f"({self.raw_xpath})[1]/{sub_raw.lstrip('.')}"
        else:
            combined = f"({self.raw_xpath})[1]/{sub_raw}"
        return CDPLocator(self.page, combined)


class CDPPage:
    """纯原生 CDP WebSocket 控制页面类 (代替 Playwright Page)"""

    def __init__(self, ws_url: str, port: int = CDP_PORT):
        self.ws_url = ws_url
        self.port = urllib.parse.urlsplit(ws_url).port or port
        self.target_id = str(ws_url).rstrip("/").rsplit("/", 1)[-1]
        self.frame_url = ""
        self.browser_rendered_oopif = False
        # 调试通道不经过系统/环境代理；网页出口仍由 Chrome 启动参数控制。
        self.ws = websocket.create_connection(ws_url, timeout=30, http_no_proxy=["*"])
        self.cmd_id = 0
        self.cdp_events: List[Dict[str, Any]] = []
        self.network_responses: Dict[str, Dict[str, Any]] = {}
        self.network_finished = set()
        self.network_inflight = set()
        self.last_document_status = 0
        self.last_document_status_text = ""
        self.last_document_url = ""
        self.proxy_auth_username = ""
        self.proxy_auth_password = ""
        self.frame_contexts: Dict[str, int] = {}
        self._init_cdp()

    def enable_stealth(self) -> None:
        """注入 Page.addScriptToEvaluateOnNewDocument 隐藏 Selenium / CDP 自动化标记，绕过 WAF JS 盾挑战。"""
        stealth_js = """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
        """
        try:
            self.send_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": stealth_js})
        except Exception:
            pass

    def _init_cdp(self):
        self.send_cmd("Page.enable")
        self.send_cmd("Runtime.enable")
        self.send_cmd("DOM.enable")
        # 必须在 Page.navigate 之前启用。启动参数覆盖新启动的 Chrome，
        # CDP Security 命令同时覆盖已经运行、随后新建的业务标签页。
        self.send_cmd("Security.enable")
        self.send_cmd("Security.setIgnoreCertificateErrors", {"ignore": True})
        self.enable_stealth()
        # 导航前开启网络监听。响应只在无 A 标签的字段分支中读取。
        self.send_cmd("Network.enable", {
            "maxTotalBufferSize": 50 * 1024 * 1024,
            "maxResourceBufferSize": 10 * 1024 * 1024,
        })

    def _store_event(self, event: Dict[str, Any]) -> None:
        method = str(event.get("method") or "")
        params = event.get("params") or {}
        self.cdp_events.append(event)
        if len(self.cdp_events) > 2000:
            del self.cdp_events[:500]
        if method == "Network.requestWillBeSent":
            request_id = str(params.get("requestId") or "")
            if request_id:
                self.network_inflight.add(request_id)
        elif method == "Fetch.authRequired":
            request_id = str(params.get("requestId") or "")
            challenge = params.get("authChallenge") or {}
            is_proxy = str(challenge.get("source") or "").lower() == "proxy"
            if request_id:
                if is_proxy and self.proxy_auth_username:
                    response = {
                        "response": "ProvideCredentials",
                        "username": self.proxy_auth_username,
                        "password": self.proxy_auth_password,
                    }
                else:
                    response = {"response": "Default"}
                self._send_async_command("Fetch.continueWithAuth", {
                    "requestId": request_id,
                    "authChallengeResponse": response,
                })
        elif method == "Fetch.requestPaused":
            request_id = str(params.get("requestId") or "")
            if request_id:
                self._send_async_command(
                    "Fetch.continueRequest", {"requestId": request_id}
                )
        elif method == "Network.responseReceived":
            resource_type = str(params.get("type") or "")
            if resource_type == "Document":
                response = params.get("response") or {}
                self.last_document_status = int(float(response.get("status") or 0))
                self.last_document_status_text = str(response.get("statusText") or "")
                self.last_document_url = str(response.get("url") or "")
            if resource_type in {"XHR", "Fetch"}:
                request_id = str(params.get("requestId") or "")
                if request_id:
                    self.network_responses[request_id] = {
                        "requestId": request_id,
                        "type": resource_type,
                        "response": params.get("response") or {},
                    }
        elif method == "Network.loadingFinished":
            request_id = str(params.get("requestId") or "")
            if request_id:
                self.network_finished.add(request_id)
                self.network_inflight.discard(request_id)
        elif method == "Network.loadingFailed":
            request_id = str(params.get("requestId") or "")
            if request_id:
                self.network_inflight.discard(request_id)
        elif method == "Runtime.executionContextCreated":
            context = params.get("context") or {}
            aux_data = context.get("auxData") or {}
            frame_id = str(aux_data.get("frameId") or "")
            context_id = context.get("id")
            if frame_id and context_id is not None and aux_data.get("isDefault", True):
                self.frame_contexts[frame_id] = int(context_id)
        elif method == "Runtime.executionContextDestroyed":
            destroyed_id = params.get("executionContextId")
            self.frame_contexts = {
                frame_id: context_id
                for frame_id, context_id in self.frame_contexts.items()
                if context_id != destroyed_id
            }
        elif method == "Runtime.executionContextsCleared":
            self.frame_contexts.clear()

    def get_network_inflight_count(self) -> int:
        return len(self.network_inflight)

    def _send_async_command(self, method: str, params: Dict[str, Any]) -> None:
        """事件回调中直接发送 CDP 命令，避免递归等待造成 WebSocket 死锁。"""
        self.cmd_id += 1
        self.ws.send(json.dumps({
            "id": self.cmd_id,
            "method": method,
            "params": params,
        }))

    def enable_proxy_auth(self, username: str, password: str) -> None:
        """使用 CDP Fetch 处理代理 407 认证，不依赖浏览器扩展。"""
        self.proxy_auth_username = str(username or "")
        self.proxy_auth_password = str(password or "")
        if not self.proxy_auth_username:
            return
        self.send_cmd("Fetch.enable", {
            "handleAuthRequests": True,
            "patterns": [{"urlPattern": "*", "requestStage": "Request"}],
        })

    def send_cmd(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 30) -> Dict[str, Any]:
        self.cmd_id += 1
        cid = self.cmd_id
        msg = {"id": cid, "method": method}
        if params:
            msg["params"] = params
        self.ws.send(json.dumps(msg))

        start_time = time.time()
        while time.time() - start_time < timeout:
            resp_str = self.ws.recv()
            if not resp_str:
                continue
            resp = json.loads(resp_str)
            if resp.get("id") == cid:
                return resp
            if resp.get("method"):
                self._store_event(resp)
        raise TimeoutError(f"CDP 命令执行超时: {method}")

    def get_network_json_responses(self) -> List[Dict[str, Any]]:
        """返回已捕获且能解析为 JSON 的 XHR/Fetch 响应。"""
        results = []
        for request_id, meta in list(self.network_responses.items()):
            if request_id not in self.network_finished:
                continue
            response = meta.get("response") or {}
            try:
                body_result = self.send_cmd(
                    "Network.getResponseBody", {"requestId": request_id}, timeout=10
                )
                if body_result.get("error"):
                    continue
                body_data = body_result.get("result") or {}
                body = str(body_data.get("body") or "")
                if body_data.get("base64Encoded"):
                    body = base64.b64decode(body).decode("utf-8", errors="replace")
                payload = json.loads(body)
            except (ValueError, TypeError, TimeoutError):
                continue
            results.append({
                "url": str(response.get("url") or ""),
                "status": response.get("status"),
                "mimeType": str(response.get("mimeType") or ""),
                "payload": payload,
            })
        return results

    @property
    def url(self) -> str:
        res = self.evaluate("() => window.location.href")
        return str(res or "")

    def content(self) -> str:
        """返回当前页面完整 HTML，与 Playwright Page.content() 接口保持一致。"""
        res = self.evaluate(
            "() => document.documentElement ? document.documentElement.outerHTML : ''"
        )
        return str(res or "")

    @staticmethod
    def _is_script_security_redirect(source: str) -> bool:
        """识别以错误状态返回、随后依靠 JS 携验证参数跳转的过渡页。"""
        lowered = str(source or "").lower()
        return any(marker in lowered for marker in (
            "yunsuoautojump",
            "security_verify_data",
            "security_verify_",
        ))

    def goto(self, url: str, wait_until: str = "domcontentloaded", timeout: int = 30000):
        from queue_url_history import record_url
        record_url(url, f'CDPNavigate(port={self.port})')
        self.last_document_status = 0
        self.last_document_status_text = ""
        self.last_document_url = ""
        self.send_cmd("Page.navigate", {"url": url})
        # 等待 DOM 加载完成
        start_time = time.time()
        timeout_sec = timeout / 1000.0
        loaded = False
        security_redirect_seen = False
        while time.time() - start_time < timeout_sec:
            try:
                state = self.evaluate("() => document.readyState")
                if state in ("interactive", "complete"):
                    # 若遇到 WAF JS 挑战盾 (如 521 加速乐 / 503 / 403 挑战)，浏览器会自动计算 Cookie 并刷新
                    # 此时需等待二次请求完成收到最终 200 响应
                    if self.last_document_status in (521, 503, 403, 429):
                        time.sleep(0.5)
                        continue
                    # 云锁等安全组件会故意以 404 返回一段极短脚本，再用
                    # security_verify_data 跳转到真实页面。这里若立即把 404
                    # 当终态，50ms 后的跳转永远没有机会执行。
                    if 400 <= self.last_document_status <= 599:
                        current_source = self.evaluate(
                            "() => document.documentElement ? "
                            "document.documentElement.outerHTML : ''"
                        )
                        if self._is_script_security_redirect(current_source):
                            if not security_redirect_seen:
                                logging.info(
                                    "[HTTP] 检测到安全验证脚本过渡页，"
                                    "忽略当前 HTTP %s 并等待跳转",
                                    self.last_document_status,
                                )
                                security_redirect_seen = True
                            time.sleep(0.2)
                            continue
                    loaded = True
                    break
            except Exception:
                pass
            time.sleep(0.3)
        if not loaded and self.last_document_status == 200:
            loaded = True
        if not loaded:
            raise TimeoutError(f"CDP 页面加载超时 ({timeout}ms): {url}")
        if 400 <= self.last_document_status <= 599:
            # 针对前端 SPA 单页应用（因 Nginx 未配 try_files 对子路由返回 404 但前端 JS 仍正常渲染页面）：
            # 只有当页面确实呈现为服务器错误页时才抛出异常；若前端已渲染出实际业务内容则允许继续识别。
            try:
                html_source = self.evaluate("() => document.documentElement.outerHTML")
                error = detect_http_error_page(html_source)
                if not error:
                    body_text_len = self.evaluate("() => (document.body && document.body.innerText || '').trim().length") or 0
                    if body_text_len >= 50:
                        return
            except Exception:
                pass
            status_text = f" {self.last_document_status_text}" if self.last_document_status_text else ""
            raise HttpPageError(
                f"目标网页返回 HTTP {self.last_document_status}{status_text}，"
                f"不进入列表识别: {self.last_document_url or url}",
                status=self.last_document_status,
            )

    def evaluate(self, js_code: str, *args, timeout_ms: int = 30000) -> Any:
        return self.evaluate_in_context(
            None, js_code, *args, timeout_ms=timeout_ms
        )

    def evaluate_in_context(
        self, context_id: Optional[int], js_code: str, *args,
        timeout_ms: int = 30000
    ) -> Any:
        if args:
            args_json = ", ".join(json.dumps(a) for a in args)
            expr = f"({js_code})({args_json})"
        else:
            expr = f"({js_code})()" if js_code.strip().startswith("(") or js_code.strip().startswith("function") else js_code

        params = {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True,
        }
        if context_id is not None:
            params["contextId"] = int(context_id)
        resp = self.send_cmd(
            "Runtime.evaluate",
            params,
            timeout=timeout_ms / 1000.0,
        )
        exception_details = (resp.get("result") or {}).get("exceptionDetails")
        if exception_details:
            description = (
                ((exception_details.get("exception") or {}).get("description"))
                or exception_details.get("text")
                or "JavaScript evaluation failed"
            )
            logging.warning(
                "[CDP][Runtime] %s (line=%s, column=%s)",
                description,
                exception_details.get("lineNumber"),
                exception_details.get("columnNumber"),
            )
            return None
        result = resp.get("result", {}).get("result", {})
        if result.get("type") == "undefined":
            return None
        return result.get("value")

    def get_frame_pages(self) -> List["CDPFramePage"]:
        """返回 Chrome 已渲染的普通 frame 与跨进程 OOPIF，不触发导航。"""
        response = self.send_cmd("Page.getFrameTree")
        root = (response.get("result") or {}).get("frameTree") or {}
        frames = []

        def walk(tree):
            frame = tree.get("frame") or {}
            frame_id = str(frame.get("id") or "")
            parent_id = str(frame.get("parentId") or "")
            context_id = self.frame_contexts.get(frame_id)
            if parent_id and context_id is not None:
                frames.append(CDPFramePage(
                    self,
                    frame_id=frame_id,
                    context_id=context_id,
                    frame_url=str(frame.get("url") or ""),
                ))
            for child in tree.get("childFrames") or []:
                walk(child)

        walk(root)

        # 跨站 iframe 可能被 Chrome 隔离成独立 Target（OOPIF），不会出现
        # 在父 Target 的 Runtime executionContext 中。Target.getTargets 会
        # 通过 parentId 保留真实嵌套关系；只连接当前 Target 的后代，读取
        # 浏览器已经渲染好的 DOM，绝不重新请求 iframe URL。
        try:
            targets = (
                self.send_cmd("Target.getTargets").get("result", {})
                .get("targetInfos", [])
            )
            descendants = []
            parent_ids = {self.target_id}
            remaining = list(targets)
            while parent_ids:
                next_parent_ids = set()
                for target in remaining[:]:
                    if str(target.get("parentId") or "") not in parent_ids:
                        continue
                    remaining.remove(target)
                    target_id = str(target.get("targetId") or "")
                    if target_id:
                        next_parent_ids.add(target_id)
                    if str(target.get("type") or "") == "iframe":
                        descendants.append(target)
                parent_ids = next_parent_ids

            known_frame_ids = {frame.frame_id for frame in frames}
            parsed_ws = urllib.parse.urlsplit(self.ws_url)
            for target in descendants:
                target_id = str(target.get("targetId") or "")
                if not target_id or target_id in known_frame_ids:
                    continue
                ws_url = urllib.parse.urlunsplit((
                    parsed_ws.scheme or "ws",
                    parsed_ws.netloc,
                    f"/devtools/page/{target_id}",
                    "",
                    "",
                ))
                child = CDPPage(ws_url, port=self.port)
                child.frame_url = str(target.get("url") or "")
                child.browser_rendered_oopif = True
                frames.append(child)
        except Exception as ex:
            logging.info("[CDP][OOPIF] 读取已渲染子 Target 失败: %s", ex)
        return frames

    def add_init_script(self, js_code: str):
        self.send_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": js_code})
        try:
            self.evaluate(js_code)
        except Exception:
            pass

    def locator(self, xpath_expr: str) -> CDPLocator:
        return CDPLocator(self, xpath_expr)

    def close(self):
        try:
            self.send_cmd("Page.close")
        except Exception:
            pass
        try:
            self.ws.close()
        except Exception:
            pass

    @classmethod
    def _reserve_global_tab_slot(
        cls, base_url: str, max_tabs: int = MAX_OPEN_PAGE_TABS
    ) -> None:
        """统一限制 CDP 普通网页标签；任何调用方新建页面都不能绕过。"""
        def list_business_pages() -> List[Dict[str, Any]]:
            req = urllib.request.Request(
                f"{base_url}/json/list", headers={"Host": "localhost"}
            )
            with _cdp_opener.open(req, timeout=5) as resp:
                targets = json.loads(
                    resp.read().decode("utf-8", errors="replace")
                )
            return [
                target for target in targets
                if str(target.get("type") or "") == "page"
                and not str(target.get("url") or "").startswith((
                    "chrome://", "devtools://", "chrome-extension://"
                ))
            ]

        def request_close(target_id: str) -> None:
            if not target_id:
                return
            close_req = urllib.request.Request(
                f"{base_url}/json/close/{target_id}",
                headers={"Host": "localhost"},
            )
            with _cdp_opener.open(close_req, timeout=5):
                pass

        pages = list_business_pages()
        # Chrome 的 /json/list 通常按最近标签在前返回，保留最近4个，
        # 为即将创建的标签腾出一个位置。关闭目标是异步的，必须等待
        # 它真正从 /json/list 消失，不能关闭请求返回后立刻判定失败。
        keep_count = max(0, max_tabs - 1)
        pending_close_ids = [
            str(target.get("id") or "") for target in pages[keep_count:]
        ]
        for target_id in pending_close_ids:
            try:
                request_close(target_id)
            except Exception:
                pass

        remaining_pages = pages
        for attempt in range(20):
            remaining_pages = list_business_pages()
            if len(remaining_pages) < max_tabs:
                if pages and len(remaining_pages) < len(pages):
                    print(
                        f"[CDP] 已释放旧业务标签: "
                        f"{len(pages)} -> {len(remaining_pages)}"
                    )
                return
            # 关闭请求可能因页面正忙而第一次未生效；每秒重试一次
            # 当前最旧目标，同时给Chrome处理 Target 销毁的时间。
            if attempt in {4, 8, 12, 16} and remaining_pages:
                try:
                    request_close(str(remaining_pages[-1].get("id") or ""))
                except Exception:
                    pass
            time.sleep(0.25)

        if len(remaining_pages) >= max_tabs:
            raise RuntimeError(
                f"CDP 业务标签已达到上限 {max_tabs}，等待5秒并重试关闭后仍未释放"
            )

    def ensure_minimized_window(self) -> bool:
        """确保浏览器窗口处于最小化运行状态，避免前台遮挡操作。"""
        try:
            res = self.send_cmd("Browser.getWindowForTarget")
            result = res.get("result", {}) if isinstance(res, dict) else {}
            win_id = result.get("windowId")
            bounds = result.get("bounds", {})
            if win_id and bounds.get("windowState") != "minimized":
                self.send_cmd("Browser.setWindowBounds", {
                    "windowId": win_id,
                    "bounds": {"windowState": "minimized"},
                })
                return True
        except Exception:
            pass
        return False

    def ensure_normal_window(self, width: int = 1280, height: int = 800) -> bool:
        """兼容保留方法，按最小化规则处理。"""
        return self.ensure_minimized_window()

    @classmethod
    def create_new_page(cls, base_url: str = f"http://127.0.0.1:{CDP_PORT}") -> "CDPPage":
        """在 CDP 调试浏览器中新建一个标签页并建立 WebSocket 连接"""
        cls._reserve_global_tab_slot(base_url, MAX_OPEN_PAGE_TABS)
        req = urllib.request.Request(f"{base_url}/json/new", method="PUT")
        with _cdp_opener.open(req, timeout=5) as resp:
            target = json.loads(resp.read().decode("utf-8"))
        ws_url = target["webSocketDebuggerUrl"]
        page = cls(ws_url)
        page.ensure_minimized_window()
        return page


class CDPFramePage:
    """在父标签的 iframe 默认执行上下文中复用页面提取接口。"""

    def __init__(
        self, parent: CDPPage, frame_id: str, context_id: int, frame_url: str
    ):
        self.parent = parent
        self.frame_id = frame_id
        self.context_id = context_id
        self.frame_url = frame_url

    @property
    def network_responses(self):
        return self.parent.network_responses

    @property
    def network_finished(self):
        return self.parent.network_finished

    @property
    def cdp_events(self):
        return self.parent.cdp_events

    @property
    def url(self) -> str:
        try:
            return str(self.evaluate("() => location.href") or self.frame_url)
        except Exception:
            return self.frame_url

    def evaluate(self, js_code: str, *args, timeout_ms: int = 30000) -> Any:
        return self.parent.evaluate_in_context(
            self.context_id, js_code, *args, timeout_ms=timeout_ms
        )

    def content(self) -> str:
        return str(self.evaluate(
            "() => document.documentElement ? document.documentElement.outerHTML : ''"
        ) or "")

    def locator(self, xpath_expr: str) -> CDPLocator:
        return CDPLocator(self, xpath_expr)

    def get_network_inflight_count(self) -> int:
        return self.parent.get_network_inflight_count()

    def get_network_json_responses(self):
        return self.parent.get_network_json_responses()

    def goto(self, *_args, **_kwargs):
        raise RuntimeError("iframe 上下文禁止导航；应保持外层页面并重新获取 frame")

    def close(self):
        """frame 与父标签共用连接，不能单独关闭。"""
        return None
