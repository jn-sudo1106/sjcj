# -*- coding: utf-8 -*-
"""独立 Chrome/CDP 进程管理入口。

默认只负责启动并守护浏览器，不运行新闻提取算法。可通过显式诊断参数
重试 error_open_url.txt 中的网站并保存浏览器返回的原始 HTML。
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path


DEFAULT_PORT = 9222
DEFAULT_PROFILE = Path(os.path.expandvars(r"%LOCALAPPDATA%\qinlong-cdp-browser"))
MAX_OPEN_TABS = 5
PROXY_ENV_NAME = "QINLONG_BROWSER_PROXY"

# 本地调试连接始终直连，与浏览器访问目标网站的显式代理配置无关。
_cdp_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def find_chrome() -> str | None:
    candidates = [
        r"E:\qinlongchrome\qinlong.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    return next((path for path in candidates if os.path.exists(path)), None)


def cdp_ready(port: int) -> bool:
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/json/version",
            headers={"Host": "localhost"},
        )
        with _cdp_opener.open(request, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def list_page_targets(port: int = DEFAULT_PORT) -> list[dict]:
    """读取 CDP 中所有普通网页标签；Chrome 内部页不计入任务标签。"""
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/json/list",
        headers={"Host": "localhost"},
    )
    with _cdp_opener.open(request, timeout=5) as response:
        targets = json.loads(response.read().decode("utf-8", errors="replace"))
    return [
        target for target in targets
        if str(target.get("type") or "") == "page"
        and not str(target.get("url") or "").startswith((
            "chrome://", "devtools://", "chrome-extension://"
        ))
    ]


def reserve_global_tab_slot(
    port: int = DEFAULT_PORT, max_tabs: int = MAX_OPEN_TABS
) -> None:
    """新建网页前关闭最早标签，使新页面创建后最多保留 max_tabs 个。"""
    targets = list_page_targets(port)
    # /json/list 按最近标签在前返回；保留最近 max_tabs-1 个，为新页面留一个槽位。
    keep_count = max(0, max_tabs - 1)
    for target in targets[keep_count:]:
        close_target(str(target.get("id") or ""), port)


def ensure_browser_window_minimized(port: int = DEFAULT_PORT) -> None:
    """确保 CDP 浏览器窗口处于最小化状态。"""
    try:
        project_dir = Path(__file__).resolve().parent
        if str(project_dir) not in sys.path:
            sys.path.insert(0, str(project_dir))
        from browsers.cdp_client import CDPPage
        targets = list_page_targets(port)
        if targets:
            ws_url = str(targets[0].get("webSocketDebuggerUrl") or "")
            if ws_url:
                page = CDPPage(ws_url, port=port)
                page.ensure_minimized_window()
                try:
                    page.ws.close()
                except Exception:
                    pass
    except Exception:
        pass


def ensure_browser_window_normal(port: int = DEFAULT_PORT) -> None:
    """兼容旧名称，统一执行最小化。"""
    ensure_browser_window_minimized(port)


def open_url(url: str, port: int = DEFAULT_PORT) -> dict:
    """只让 CDP Chrome 新建网页标签，不读取页面内容。"""
    normalized_url = str(url or "").strip().rstrip("，,")
    if not normalized_url:
        raise ValueError("URL 为空")
    if not cdp_ready(port):
        raise RuntimeError(f"CDP 浏览器未就绪: http://127.0.0.1:{port}")
    reserve_global_tab_slot(port, MAX_OPEN_TABS)
    encoded_url = urllib.parse.quote(normalized_url, safe="")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/json/new?{encoded_url}",
        method="PUT",
        headers={"Host": "localhost"},
    )
    with _cdp_opener.open(request, timeout=10) as response:
        payload = response.read().decode("utf-8", errors="replace")
    target = json.loads(payload)
    ensure_browser_window_normal(port)
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    if ws_url:
        parsed_ws = urllib.parse.urlsplit(ws_url)
        # Chrome 在 Host=localhost 时可能返回不带调试端口的 ws 地址。
        target["webSocketDebuggerUrl"] = urllib.parse.urlunsplit((
            parsed_ws.scheme or "ws",
            f"127.0.0.1:{port}",
            parsed_ws.path,
            parsed_ws.query,
            parsed_ws.fragment,
        ))
    return target


def close_target(target_id: str, port: int = DEFAULT_PORT) -> bool:
    """关闭指定 CDP 标签页；目标已经不存在也视为成功。"""
    if not target_id:
        return True
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/json/close/{target_id}",
            headers={"Host": "localhost"},
        )
        with _cdp_opener.open(request, timeout=5) as response:
            return response.status == 200
    except urllib.error.HTTPError as ex:
        return ex.code == 404
    except Exception:
        return False


def wait_for_complete_html(
    target: dict, port: int = DEFAULT_PORT, timeout_seconds: int = 60
) -> tuple[str, str]:
    """等待目标页完整且 DOM稳定，返回最终 URL和完整 HTML；不关闭标签页。"""
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    if not ws_url:
        raise RuntimeError("CDP 新标签页没有 WebSocket 地址")
    project_dir = Path(__file__).resolve().parent
    if str(project_dir) not in sys.path:
        sys.path.insert(0, str(project_dir))
    from browsers.cdp_client import CDPPage

    page = CDPPage(ws_url, port=port)
    deadline = time.monotonic() + max(1, timeout_seconds)
    previous_signature = None
    stable_count = 0
    html = ""
    try:
        while time.monotonic() < deadline:
            state = page.evaluate("() => document.readyState")
            snapshot = page.evaluate("""
                () => ({
                    html: document.documentElement
                        ? document.documentElement.outerHTML : '',
                    nodes: document.getElementsByTagName('*').length
                })
            """) or {}
            html = str(snapshot.get("html") or "")
            signature = (len(html), int(snapshot.get("nodes") or 0))
            if state == "complete" and html.strip() and signature == previous_signature:
                stable_count += 1
            else:
                stable_count = 0
            if state == "complete" and stable_count >= 3:
                final_url = page.url
                if final_url.startswith("chrome-error://"):
                    raise RuntimeError(f"浏览器错误页: {final_url}")
                return final_url, html
            previous_signature = signature
            time.sleep(0.5)
        raise TimeoutError(f"等待完整 HTML 超时（{timeout_seconds}秒）")
    finally:
        # 只断开控制连接，保留已经打开的标签页。
        try:
            page.ws.close()
        except Exception:
            pass


def read_proxy_url(cli_proxy: str = "") -> str:
    """按命令行、环境变量、私有 txt 配置的优先级读取浏览器代理。"""
    proxy_url = str(cli_proxy or "").strip()
    if not proxy_url:
        proxy_url = str(os.environ.get(PROXY_ENV_NAME) or "").strip()
    project_root = Path(__file__).resolve().parents[1]
    proxy_file = project_root / "txt" / "browser_proxy.txt"
    proxy_file.parent.mkdir(parents=True, exist_ok=True)
    proxy_file.touch(exist_ok=True)
    if not proxy_url:
        for line in proxy_file.read_text(encoding="utf-8-sig").splitlines():
            value = line.strip()
            if value and not value.startswith("#"):
                proxy_url = value
                break
    if proxy_url and "://" not in proxy_url:
        proxy_url = f"http://{proxy_url}"
    return proxy_url


def prepare_proxy_extension(profile: Path, proxy_url: str) -> tuple[str, Path | None]:
    """解析代理；认证代理生成 Chrome 扩展，密码不会写入项目目录。"""
    if not proxy_url:
        return "", None
    parsed = urllib.parse.urlsplit(proxy_url)
    if not parsed.hostname or not parsed.port:
        raise ValueError("代理格式错误，应为 http://[账号:密码@]主机:端口")
    scheme = (parsed.scheme or "http").lower()
    server = f"{scheme}://{parsed.hostname}:{parsed.port}"
    username = urllib.parse.unquote(parsed.username or "")
    password = urllib.parse.unquote(parsed.password or "")
    if not username:
        return server, None

    extension_dir = profile / "proxy_auth_extension"
    extension_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "manifest_version": 3,
        "name": "Qinlong Browser Proxy",
        "version": "1.0.0",
        "permissions": ["proxy", "storage", "webRequest", "webRequestAuthProvider"],
        "host_permissions": ["<all_urls>"],
        "background": {"service_worker": "background.js"},
    }
    proxy_config = {
        "mode": "fixed_servers",
        "rules": {
            "singleProxy": {
                "scheme": scheme,
                "host": parsed.hostname,
                "port": parsed.port,
            },
            "bypassList": ["localhost", "127.0.0.1"],
        },
    }
    # Manifest V3 中不再支持普通扩展使用旧的 ``blocking`` 模式。
    # 代理认证必须通过 webRequestAuthProvider 的 asyncBlocking 回调返回，
    # 否则 Chrome 会忽略扩展提供的凭据并反复显示原生认证弹窗。
    background = (
        "chrome.proxy.settings.set({value: "
        + json.dumps(proxy_config, ensure_ascii=False)
        + ", scope: 'regular'});\n"
        + "chrome.webRequest.onAuthRequired.addListener("
        + "(details, callback) => callback(details.isProxy ? {authCredentials: "
        + json.dumps({"username": username, "password": password}, ensure_ascii=False)
        + "} : {}), {urls: ['<all_urls>']}, ['asyncBlocking']);\n"
    )
    (extension_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (extension_dir / "background.js").write_text(background, encoding="utf-8")
    return server, extension_dir


def build_command(
    chrome: str,
    port: int,
    profile: Path,
    headless: bool,
    proxy_url: str = "",
) -> list[str]:
    command = [
        chrome,
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=*",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        "--window-size=1280,800",
        "--window-position=100,100",
        "--start-minimized",
    ]
    if headless:
        command.append("--headless=new")
    proxy_server, proxy_extension = prepare_proxy_extension(profile, proxy_url)
    if proxy_server:
        command.append(f"--proxy-server={proxy_server}")
    else:
        # 9222 默认浏览器必须真正直连，禁止继承 Windows/Chrome 系统代理。
        # 只有 BrowserManager 显式传入 --proxy-url 启动 9223 时才使用代理。
        command.append("--no-proxy-server")
    if proxy_extension:
        command.extend([
            f"--disable-extensions-except={proxy_extension}",
            f"--load-extension={proxy_extension}",
        ])
    return command


def read_open_error_urls(error_file: Path) -> list[str]:
    """读取错误文件中的 URL: 行，保持顺序并去重。"""
    if not error_file.exists():
        error_file.parent.mkdir(parents=True, exist_ok=True)
        error_file.touch()
        return []
    urls = []
    seen = set()
    for raw_line in error_file.read_text(encoding="utf-8-sig").splitlines():
        if not raw_line.startswith("URL:"):
            continue
        url = raw_line.split(":", 1)[1].strip().rstrip("，,")
        if url and url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def retry_open_error_urls(port: int, timeout_seconds: int) -> tuple[int, int]:
    """逐个打开浏览器层失败 URL，仅保存 HTML，不运行列表提取算法。"""
    project_root = Path(__file__).resolve().parents[1]
    error_file = project_root / "txt" / "error_open_url.txt"
    web_dir = project_root / "web"
    web_dir.mkdir(parents=True, exist_ok=True)
    urls = read_open_error_urls(error_file)
    if not urls:
        print(f"[RetryOpen] 没有待检查 URL: {error_file}")
        return 0, 0

    link_extractor_dir = Path(__file__).resolve().parent
    if str(link_extractor_dir) not in sys.path:
        sys.path.insert(0, str(link_extractor_dir))
    from browsers.cdp_client import CDPPage

    success_count = 0
    print(f"[RetryOpen] 开始检查 {len(urls)} 个 URL")
    for index, url in enumerate(urls, start=1):
        page = None
        try:
            reserve_global_tab_slot(port, MAX_OPEN_TABS)
            page = CDPPage.create_new_page(f"http://127.0.0.1:{port}")
            print(f"[RetryOpen] ({index}/{len(urls)}) 打开: {url}")
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_seconds * 1000)
            final_url = page.url
            html = page.content()
            if final_url.startswith("chrome-error://") or not html.strip():
                raise RuntimeError(f"浏览器错误页或 HTML 为空，最终地址: {final_url}")
            hostname = urllib.parse.urlsplit(url).hostname or "unknown-site"
            safe_name = "".join(
                char if char.isalnum() or char in ".-_" else "_"
                for char in hostname
            )
            html_file = web_dir / f"{safe_name}.html"
            html_file.write_text(html, encoding="utf-8")
            success_count += 1
            print(
                f"[RetryOpen][OK] HTML={len(html)} 字符; "
                f"最终地址={final_url}; 文件={html_file}"
            )
        except Exception as ex:
            print(f"[RetryOpen][FAIL] {url}: {ex}", file=sys.stderr)
        finally:
            if page:
                try:
                    page.close()
                except Exception:
                    pass
    print(f"[RetryOpen] 完成: 成功 {success_count}，失败 {len(urls) - success_count}")
    return success_count, len(urls) - success_count


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    parser = argparse.ArgumentParser(description="启动并守护独立 CDP Chrome")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument(
        "--proxy-url",
        default="",
        help=(
            "浏览器代理，例如 http://user:pass@host:port；也可使用环境变量 "
            f"{PROXY_ENV_NAME} 或 txt/browser_proxy.txt"
        ),
    )
    parser.add_argument(
        "--retry-error-urls",
        action="store_true",
        help="逐个检查 txt/error_open_url.txt，并把可获取的 HTML 保存到 web 目录",
    )
    parser.add_argument("--retry-timeout", type=int, default=30, help="单个 URL 超时秒数")
    args = parser.parse_args()

    # 默认 9222 是真正的直连浏览器，不能因为 txt/browser_proxy.txt 中存在
    # 代理配置就被静默改成代理出口。代理重试浏览器（9223）会由
    # BrowserManager 显式传入 --proxy-url，此时才启用代理。
    proxy_url = read_proxy_url(args.proxy_url) if str(args.proxy_url or "").strip() else ""
    if cdp_ready(args.port):
        print(f"CDP 浏览器已在运行: http://127.0.0.1:{args.port}")
        if proxy_url:
            print("注意：代理仅在浏览器启动时生效；当前进程需重启才能应用新代理")
        if args.retry_error_urls:
            retry_open_error_urls(args.port, max(1, args.retry_timeout))
        return 0

    chrome = find_chrome()
    if not chrome:
        print("未找到 Chrome 可执行文件", file=sys.stderr)
        return 1

    args.profile.mkdir(parents=True, exist_ok=True)
    try:
        command = build_command(
            chrome, args.port, args.profile, args.headless, proxy_url=proxy_url
        )
    except ValueError as ex:
        print(f"代理配置无效: {ex}", file=sys.stderr)
        return 3
    process = subprocess.Popen(command)

    stopping = False

    def stop_browser(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True
        if process.poll() is None:
            process.terminate()

    signal.signal(signal.SIGINT, stop_browser)
    signal.signal(signal.SIGTERM, stop_browser)

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and process.poll() is None:
        if cdp_ready(args.port):
            print(f"CDP 浏览器已启动: http://127.0.0.1:{args.port}")
            ensure_browser_window_normal(args.port)
            print(f"用户目录: {args.profile}")
            if proxy_url:
                parsed_proxy = urllib.parse.urlsplit(proxy_url)
                print(
                    "浏览器代理已启用: "
                    f"{parsed_proxy.scheme}://{parsed_proxy.hostname}:{parsed_proxy.port}; "
                    f"认证={'是' if parsed_proxy.username else '否'}"
                )
            break
        time.sleep(0.5)
    else:
        stop_browser()
        print("Chrome 启动失败或 CDP 端口未就绪", file=sys.stderr)
        return 2

    if args.retry_error_urls:
        retry_open_error_urls(args.port, max(1, args.retry_timeout))

    while not stopping and process.poll() is None:
        time.sleep(1)
    return process.returncode or 0


if __name__ == "__main__":
    raise SystemExit(main())
