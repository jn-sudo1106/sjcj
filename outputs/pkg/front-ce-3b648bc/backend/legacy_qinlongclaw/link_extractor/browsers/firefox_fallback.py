# -*- coding: utf-8 -*-
"""Chrome 无法取得正文时，用 ruyipage Firefox 获取渲染后的列表页 HTML。"""

import logging
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from lxml import html as lxml_html


class FirefoxDependencyError(RuntimeError):
    """当前运行抓取程序的 Python 缺少 Firefox 抓取依赖。"""


def find_firefox() -> str | None:
    candidates = [
        Path(r"D:\firefox\firefox.exe"),
        Path(os.path.expandvars(r"%LOCALAPPDATA%\Mozilla Firefox\firefox.exe")),
        Path(r"C:\Program Files\Mozilla Firefox\firefox.exe"),
        Path(r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe"),
    ]
    return next((str(path) for path in candidates if path.exists()), None)


def configure_firefox_proxy(options, proxy_url: str = ""):
    """默认强制直连；只有明确提供代理地址时才启用代理。"""
    options.set_pref("network.proxy.autoconfig_url", "")
    options.set_pref("network.proxy.auto_detect", False)
    options.set_proxy(proxy_url or None)
    options.set_pref("network.proxy.type", 1 if proxy_url else 0)
    return options


def fetch_firefox_html_direct(
    url: str,
    timeout_seconds: int = 60,
    ready_callback: Callable[..., None] | None = None,
    decision_file: str = "",
    command_file: str = "",
    response_file: str = "",
    use_proxy: bool = False,
) -> tuple[str, str]:
    """worker 内打开列表页并返回 (最终地址, 渲染后 HTML)。"""
    firefox_path = find_firefox()
    if not firefox_path:
        raise RuntimeError("未找到 Firefox，可执行文件应位于 D:\\firefox\\firefox.exe")

    from ruyipage import FirefoxOptions, FirefoxPage
    from ruyipage._bidi import browser_module as bidi_browser

    project_root = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    parent_root = project_root.parent
    if str(parent_root) not in sys.path:
        sys.path.insert(0, str(parent_root))
    options = FirefoxOptions()
    options.set_browser_path(firefox_path)
    if not use_proxy:
        # worker 退出也不能带走供人工检查的直连错误页。
        options.close_on_exit(False)

    if use_proxy:
        from browser_process import read_proxy_url

        proxy_url = read_proxy_url()
        if not proxy_url:
            raise RuntimeError("Firefox 代理重试未配置代理")
        configure_firefox_proxy(options, proxy_url)
        logging.info("[Firefox][Proxy] 已配置 Firefox 代理")
    else:
        # Firefox 的默认代理模式可能跟随操作系统设置。直连重试必须显式
        # 使用 DIRECT，避免系统代理影响；代理重试分支的 set_proxy() 会将
        # network.proxy.type 覆盖为手动代理模式。
        configure_firefox_proxy(options)
        logging.info("[Firefox][Direct] 已强制禁用系统代理")

    page = None
    close_page = use_proxy
    navigation_error = ""
    def is_safeline_challenge(source: str) -> bool:
        lower = str(source or "").lower()
        return any(marker in lower for marker in (
            "/.safeline/",
            "safelinechallenge(",
            "challenge.rivers.chaitin.cn",
            'id="slg-bg"',
            'id="sl-box"',
            "dynamic decrypting",
            "protected by safeline",
            "网页被保护，正在解密中",
            "黑龙江大数据产业发展有限公司waf",
        ))

    def business_dom_signature(source: str, current_url: str) -> tuple | None:
        """只有 head 的过渡页不算业务 DOM；返回可用于稳定判断的签名。"""
        value = str(source or "")
        body_match = re.search(r"<body\b[^>]*>(.*?)</body\s*>", value, re.I | re.S)
        if not body_match:
            return None
        body = body_match.group(1)
        anchor_count = len(re.findall(r"<a\b", body, re.I))
        list_count = len(re.findall(r"<(?:li|article)\b", body, re.I))
        div_count = len(re.findall(r"<div\b", body, re.I))
        clean_body = re.sub(
            r"<(?:script|style|template|noscript)\b[^>]*>.*?</(?:script|style|template|noscript)\s*>",
            " ", body, flags=re.I | re.S,
        )
        clean_body = re.sub(r"<[^>]+>", " ", clean_body)
        text_length = len(re.sub(r"\s+", "", clean_body))
        if not (anchor_count >= 2 or list_count >= 3 or div_count >= 3 or text_length >= 50):
            return None
        try:
            document = lxml_html.fromstring(value)
        except Exception:
            return None

        excluded_tags = {"header", "nav", "footer", "aside"}
        excluded_semantics = (
            "header", "footer", "nav", "menu", "sidebar",
            "breadcrumb", "phone_nav", "phonenav",
        )
        ignored_tags = {
            "script", "style", "template", "noscript", "link", "meta", "source"
        }

        def excluded_region(node) -> bool:
            current = node
            for _ in range(10):
                if current is None or not isinstance(current.tag, str):
                    break
                tag = current.tag.lower()
                semantic = (
                    f"{current.get('class', '')} {current.get('id', '')} "
                    f"{current.get('role', '')}"
                ).lower()
                if tag in excluded_tags or any(key in semantic for key in excluded_semantics):
                    return True
                current = current.getparent()
            return False

        def stable_class(node) -> str:
            ignored = re.compile(
                r"^(?:odd|even|show|shown|visible|animated|active|aos-init|aos-animate|"
                r"wow|fade|fadein|fadeout|slide|zoom|bounce)$", re.I,
            )
            return ".".join(sorted(
                token for token in str(node.get("class") or "").split()
                if token and not ignored.match(token)
            ))

        repeated_evidence = []
        for parent in document.iter():
            if not isinstance(parent.tag, str) or excluded_region(parent):
                continue
            children = [
                child for child in parent
                if isinstance(child.tag, str) and child.tag.lower() not in ignored_tags
                and not excluded_region(child)
            ]
            groups = {}
            for child in children:
                key = (child.tag.lower(), stable_class(child))
                groups.setdefault(key, []).append(child)
            for (tag, class_name), items in groups.items():
                if len(items) < 3:
                    continue
                texts = [re.sub(r"\s+", "", "".join(item.itertext())) for item in items]
                meaningful = [text for text in texts if 4 <= len(text) <= 1000]
                if len(meaningful) / len(items) < 0.6:
                    continue
                hrefs = []
                linked_items = 0
                for item in items:
                    item_hrefs = [
                        str(anchor.get("href") or "").strip()
                        for anchor in item.iter("a")
                    ]
                    item_hrefs = [
                        href for href in item_hrefs
                        if href and href != "#" and not href.lower().startswith("javascript:")
                    ]
                    if item_hrefs:
                        linked_items += 1
                        hrefs.extend(item_hrefs)
                semantic = f"{class_name} {parent.get('class', '')} {parent.get('id', '')}".lower()
                has_list_semantic = any(
                    key in semantic for key in ("news", "list", "article", "item", "content")
                )
                if not (
                    (linked_items / len(items) >= 0.6 and len(set(hrefs)) >= 2)
                    or has_list_semantic
                ):
                    continue
                repeated_evidence.append((tag, class_name, len(items), len(set(hrefs))))
        if not repeated_evidence:
            return None
        return (
            str(current_url or ""), len(value), anchor_count,
            list_count, div_count, text_length, tuple(repeated_evidence),
        )

    try:
        logging.info("[Firefox] Chrome 未取得正文，正在启动 Firefox: %s", firefox_path)
        page = FirefoxPage(options)
        # 在导航前创建接受不安全证书的隔离上下文。这样过期、域名不匹配
        # 或自签名证书不会停在 about:certerror，而会继续加载业务页面。
        insecure_context = bidi_browser.create_user_context(
            page.browser._driver, accept_insecure_certs=True
        ).get("userContext")
        if not insecure_context:
            raise RuntimeError("Firefox 无法创建忽略证书错误的浏览器上下文")
        page = page.new_tab(user_context=insecure_context)
        logging.info("[Firefox] 已启用忽略 HTTPS 证书错误")
        # 必须在导航前注入，覆盖页面最早发起的 fetch/XHR。每次 SafeLine
        # 跳转到新文档时预加载脚本也会重新执行。
        page.add_preload_script(r"""() => {
            if (window.__qinlongNetworkTrackerInstalled) return;
            window.__qinlongNetworkTrackerInstalled = true;
            window.__qinlongPendingRequests = 0;
            const increase = () => { window.__qinlongPendingRequests++; };
            const decrease = () => {
                window.__qinlongPendingRequests = Math.max(
                    0, window.__qinlongPendingRequests - 1
                );
            };
            if (typeof window.fetch === 'function') {
                const originalFetch = window.fetch;
                window.fetch = function(...args) {
                    increase();
                    try {
                        return originalFetch.apply(this, args).finally(decrease);
                    } catch (error) {
                        decrease();
                        throw error;
                    }
                };
            }
            if (window.XMLHttpRequest) {
                const originalSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.send = function(...args) {
                    increase();
                    let settled = false;
                    const finish = () => {
                        if (settled) return;
                        settled = true;
                        decrease();
                    };
                    this.addEventListener('loadend', finish, {once: true});
                    try {
                        return originalSend.apply(this, args);
                    } catch (error) {
                        finish();
                        throw error;
                    }
                };
            }
        }""")

        def get_network_state() -> dict:
            try:
                state = page.run_js(r"""({
                    pending: Number(window.__qinlongPendingRequests || 0),
                    resources: performance.getEntriesByType('resource').length,
                    readyState: document.readyState
                })""", timeout=5)
                return state if isinstance(state, dict) else {}
            except Exception:
                return {}

        try:
            page.get(str(url).replace("amp;", ""), timeout=timeout_seconds)
        except Exception as ex:
            navigation_error = str(ex)
            current_html = str(page.html or "")
            if is_safeline_challenge(current_html) or "468" in navigation_error:
                logging.warning(
                    "[Firefox] 检测到 SafeLine/468 验证，保持页面继续加载: %s", ex
                )
            else:
                logging.warning(
                    "[Firefox] 页面加载异常，停止继续加载并读取当前 DOM: %s", ex
                )
                try:
                    page.stop_loading()
                except Exception:
                    pass

        # SafeLine 会先返回完整的 468 验证 HTML，再由 JS 完成挑战并跳转。
        # 不能固定等待3秒后立即抓取，必须等验证特征真正消失。
        challenge_deadline = time.monotonic() + max(10, timeout_seconds)
        challenge_seen = False
        html = str(page.html or "")
        while is_safeline_challenge(html) and time.monotonic() < challenge_deadline:
            if not challenge_seen:
                logging.info("[Firefox] SafeLine 验证进行中，等待真实业务页面...")
                challenge_seen = True
            time.sleep(1)
            html = str(page.html or "")
        if is_safeline_challenge(html):
            logging.warning(
                "[Firefox] WAF 验证等待超时（%s秒），未取得业务页面",
                max(10, timeout_seconds),
            )
            raise RuntimeError(
                "Firefox WAF 验证等待超时，当前仍是挑战页"
            )
        else:
            if challenge_seen:
                logging.info(
                    "[Firefox][OK] SafeLine 验证已结束，开始等待业务 DOM 稳定"
                )
            else:
                logging.info("[Firefox] 正在等待业务 DOM 完整加载")

            # 检测并自动处理阿里云 / ESA 等滑动验证码
            try:
                from browsers.slider_drag import AliyunSliderSolver
                AliyunSliderSolver.solve(page)
            except Exception as ex_slider:
                logging.debug("[Firefox] 滑块验证检查异常: %s", ex_slider)

            # BODY 必须真实存在且包含正文/链接/列表；只有 HEAD 的导航过渡页
            # 即使长度稳定也不能返回。
            previous_signature = None
            stable_count = 0
            stable_deadline = time.monotonic() + max(15, timeout_seconds)
            while time.monotonic() < stable_deadline and stable_count < 3:
                time.sleep(0.5)
                html = str(page.html or "")
                if is_safeline_challenge(html):
                    stable_count = 0
                    previous_signature = None
                    continue
                current_url = str(page.url or url)
                signature = business_dom_signature(html, current_url)
                network_state = get_network_state()
                pending_requests = int(network_state.get("pending") or 0)
                resource_count = int(network_state.get("resources") or 0)
                document_ready = str(network_state.get("readyState") or "") == "complete"
                if signature is not None:
                    signature = signature + (resource_count,)
                network_idle = document_ready and pending_requests == 0
                if network_idle and signature is not None and signature == previous_signature:
                    stable_count += 1
                else:
                    stable_count = 0
                previous_signature = signature
            if stable_count < 3:
                logging.warning(
                    "[Firefox] 业务 DOM 等待超时（%s秒）: HTML=%s字符, URL=%s",
                    max(15, timeout_seconds), len(html), str(page.url or url),
                )
            else:
                logging.info(
                    "[Firefox][OK] 业务 DOM 与网络均已稳定: HTML=%s字符, URL=%s",
                    len(html), str(page.url or url),
                )
        final_url = str(page.url or url)
        if final_url.startswith((
            "about:", "moz-extension:", "view-source:",
        )):
            suffix = f"; 导航异常={navigation_error}" if navigation_error else ""
            raise RuntimeError(f"Firefox 未进入目标网站，停留在: {final_url}{suffix}")
        if len(html.strip()) < 200:
            raise RuntimeError(f"Firefox 返回 HTML 过短: {len(html)} 字符")
        logging.info(
            "[Firefox][OK] 已取得页面 HTML: URL=%s, HTML=%s字符",
            final_url,
            len(html),
        )
        if ready_callback:
            ready_callback(final_url, html, str(page.browser.address or ""))
        if decision_file:
            decision_path = Path(decision_file)
            command_path = Path(command_file) if command_file else None
            response_path = Path(response_file) if response_file else None
            last_command_id = ""
            # 主进程提取字段期间保持同一个 Firefox 页面，不提前 quit。
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                if decision_path.exists():
                    decision = decision_path.read_text(
                        encoding="utf-8", errors="replace"
                    ).strip().lower()
                    if decision == "keep":
                        logging.warning("[Firefox] 收到保留指令，当前页面不关闭")
                        while True:
                            time.sleep(60)
                    if decision == "close":
                        close_page = True
                        break
                if command_path and command_path.exists():
                    try:
                        command = json.loads(command_path.read_text(
                            encoding="utf-8", errors="replace"
                        ))
                        command_id = str(command.get("id") or "")
                        if command_id and command_id != last_command_id:
                            last_command_id = command_id
                            method = str(command.get("method") or "")
                            params = command.get("params") or {}
                            if method == "evaluate":
                                result = page.run_js(
                                    str(params.get("script") or ""),
                                    *(params.get("args") or []),
                                    as_expr=bool(params.get("as_expr")),
                                    timeout=float(params.get("timeout") or 30),
                                )
                            elif method == "goto":
                                page.get(
                                    str(params.get("url") or ""),
                                    timeout=float(params.get("timeout") or 30),
                                )
                                result = str(page.url or "")
                            elif method == "url":
                                result = str(page.url or "")
                            elif method == "html":
                                result = str(page.html or "")
                            else:
                                raise ValueError(f"不支持的 Firefox worker 命令: {method}")
                            response = {
                                "id": command_id,
                                "ok": True,
                                "result": result,
                            }
                            if response_path:
                                response_path.write_text(
                                    json.dumps(response, ensure_ascii=False),
                                    encoding="utf-8",
                                )
                    except Exception as ex:
                        if response_path and last_command_id:
                            response_path.write_text(
                                json.dumps({
                                    "id": last_command_id,
                                    "ok": False,
                                    "error": f"{type(ex).__name__}: {ex}",
                                }, ensure_ascii=False),
                                encoding="utf-8",
                            )
                time.sleep(0.05)
        if not decision_file:
            close_page = True
        return final_url, html
    finally:
        if page is not None and close_page:
            try:
                page.quit(timeout=5, force=True)
            except Exception:
                pass
        elif page is not None:
            logging.warning("[Firefox][Direct] 保留当前直连页面，不自动关闭: %s", url)


def _terminate_process_tree(process: subprocess.Popen) -> None:
    """只终止本次 Firefox worker 及其子进程。"""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
    else:
        process.kill()


@dataclass
class FirefoxFetchSession:
    process: subprocess.Popen
    output_path: Path
    decision_path: Path
    command_path: Path
    response_path: Path
    address: str = ""

    def rpc(
        self, method: str, params: dict | None = None, timeout: float = 35
    ):
        """在 worker 持有的同一个真实 Firefox 页面执行命令。"""
        if self.process.poll() is not None:
            raise RuntimeError(
                f"Firefox worker 已退出，退出码={self.process.returncode}"
            )
        request_id = f"{os.getpid()}-{time.time_ns()}"
        self.response_path.unlink(missing_ok=True)
        self.command_path.write_text(
            json.dumps({
                "id": request_id,
                "method": str(method),
                "params": params or {},
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        deadline = time.monotonic() + max(1, float(timeout))
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(
                    f"Firefox worker 执行命令时退出，退出码={self.process.returncode}"
                )
            if self.response_path.exists():
                try:
                    response = json.loads(self.response_path.read_text(
                        encoding="utf-8", errors="replace"
                    ))
                except json.JSONDecodeError:
                    time.sleep(0.02)
                    continue
                if str(response.get("id") or "") != request_id:
                    time.sleep(0.02)
                    continue
                if not response.get("ok"):
                    raise RuntimeError(str(
                        response.get("error") or "Firefox worker 命令执行失败"
                    ))
                return response.get("result")
            time.sleep(0.02)
        raise TimeoutError(f"Firefox worker 命令超时: {method}")

    def close(self) -> None:
        self.decision_path.write_text("close", encoding="utf-8")
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _terminate_process_tree(self.process)
        self._cleanup()

    def keep(self) -> None:
        self.decision_path.write_text("keep", encoding="utf-8")
        # 不等待、不终止 worker；它会连同当前 Firefox 页面持续保留。

    def _cleanup(self) -> None:
        for path in (
            self.output_path, self.decision_path,
            self.command_path, self.response_path,
        ):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


class FirefoxWorkerPageProxy:
    """供 LiveBrowserPageAdapter 控制 worker 内真实 Firefox 页面的代理。"""

    def __init__(self, session: FirefoxFetchSession):
        self.session = session

    @property
    def url(self) -> str:
        return str(self.session.rpc("url", timeout=10) or "")

    @property
    def html(self) -> str:
        return str(self.session.rpc("html", timeout=15) or "")

    def run_js(
        self, script: str, *args, as_expr: bool = False, timeout: float = 30
    ):
        return self.session.rpc("evaluate", {
            "script": str(script or ""),
            "args": list(args),
            "as_expr": bool(as_expr),
            "timeout": float(timeout or 30),
        }, timeout=max(5, float(timeout or 30) + 5))

    def get(self, url: str, timeout: float = 30):
        return self.session.rpc("goto", {
            "url": str(url or ""),
            "timeout": float(timeout or 30),
        }, timeout=max(5, float(timeout or 30) + 5))


def fetch_firefox_html(
    url: str, timeout_seconds: int = 60, use_proxy: bool = False
) -> tuple[str, str, FirefoxFetchSession]:
    """通过隔离 worker 获取 HTML，启动和导航均受硬超时保护。"""
    if importlib.util.find_spec("ruyipage") is None:
        raise FirefoxDependencyError(
            "当前 Python 缺少 ruyipage；请在目标机器执行: "
            f'"{sys.executable}" -m pip install -r '
            f'"{Path(__file__).resolve().parents[2] / "requirements.txt"}"'
        )
    output_path = ""
    decision_path = ""
    command_path = ""
    response_path = ""
    process = None
    handed_off = False
    try:
        with tempfile.NamedTemporaryFile(
            prefix="qinlong_firefox_", suffix=".json", delete=False
        ) as stream:
            output_path = stream.name
        Path(output_path).write_text("", encoding="utf-8")
        with tempfile.NamedTemporaryFile(
            prefix="qinlong_firefox_decision_", suffix=".txt", delete=False
        ) as stream:
            decision_path = stream.name
        Path(decision_path).unlink(missing_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix="qinlong_firefox_command_", suffix=".json", delete=False
        ) as stream:
            command_path = stream.name
        Path(command_path).unlink(missing_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix="qinlong_firefox_response_", suffix=".json", delete=False
        ) as stream:
            response_path = stream.name
        Path(response_path).unlink(missing_ok=True)
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        process = subprocess.Popen(
            [
                sys.executable,
                "-u",
                "-m",
                "browsers.firefox_worker",
                str(url),
                output_path,
                str(max(1, timeout_seconds)),
                decision_path,
                command_path,
                response_path,
                "proxy" if use_proxy else "direct",
            ],
            cwd=str(Path(__file__).resolve().parents[1]),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
        )
        # worker 取得 HTML 后不会退出；轮询结果文件，不能再 communicate 等退出。
        hard_timeout = max(20, timeout_seconds + 10)
        deadline = time.monotonic() + hard_timeout
        payload = None
        while time.monotonic() < deadline:
            if process.poll() is not None and not Path(output_path).read_text(
                encoding="utf-8", errors="replace"
            ).strip():
                raise RuntimeError(
                    f"Firefox worker 提前退出，退出码={process.returncode}"
                )
            raw_payload = Path(output_path).read_text(
                encoding="utf-8", errors="replace"
            ).strip()
            if raw_payload:
                try:
                    payload = json.loads(raw_payload)
                    break
                except json.JSONDecodeError:
                    pass
            time.sleep(0.2)
        if payload is None:
            raise TimeoutError(f"Firefox worker 总超时（{hard_timeout}秒）")
        try:
            payload = dict(payload)
        except Exception as ex:
            raise RuntimeError(
                f"Firefox worker 未生成有效结果，退出码={process.returncode}"
            ) from ex
        if not payload.get("ok"):
            worker_error = str(payload.get("error") or
                f"Firefox worker 未返回 HTML，退出码={process.returncode}")
            if "No module named 'ruyipage'" in worker_error:
                raise FirefoxDependencyError(
                    "Firefox worker 缺少 ruyipage；请执行: "
                    f'"{sys.executable}" -m pip install -r '
                    f'"{Path(__file__).resolve().parents[2] / "requirements.txt"}"'
                )
            raise RuntimeError(worker_error)
        session = FirefoxFetchSession(
            process=process,
            output_path=Path(output_path),
            decision_path=Path(decision_path),
            command_path=Path(command_path),
            response_path=Path(response_path),
            address=str(payload.get("address") or ""),
        )
        handed_off = True
        return (
            str(payload.get("url") or url),
            str(payload.get("html") or ""),
            session,
        )
    finally:
        if not handed_off and process is not None and process.poll() is None:
            if use_proxy:
                _terminate_process_tree(process)
            else:
                # 只终止超时的 Python worker，不杀它已打开的 Firefox 子进程。
                process.terminate()
                logging.warning("[Firefox][Direct] worker 失败/超时，保留浏览器供人工检查: %s", url)
        if output_path and not handed_off:
            try:
                Path(output_path).unlink(missing_ok=True)
            except OSError:
                pass
        if decision_path and not handed_off:
            try:
                Path(decision_path).unlink(missing_ok=True)
            except OSError:
                pass
        for rpc_path in (command_path, response_path):
            if rpc_path and not handed_off:
                try:
                    Path(rpc_path).unlink(missing_ok=True)
                except OSError:
                    pass
