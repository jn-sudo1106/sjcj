import html

import logging

import os

import re

import subprocess

import sys

import time

import urllib.parse

import urllib.request

from datetime import datetime

from pathlib import Path

from browsers.cdp_client import CDPPage, get_cdp_base_url

from browsers.live_page_adapter import LiveBrowserPageAdapter

from browsers.slider_drag import AliyunSliderSolver, drag_slider

from browsers.firefox_fallback import (

    FirefoxDependencyError,

    FirefoxWorkerPageProxy,

    fetch_firefox_html,

    find_firefox,

)

from utils.runtime_files import ensure_runtime_txt_files

from utils.http_page_validator import (

    HttpPageError,

    HttpPageError,

    detect_http_error_page,

    ensure_successful_html,

)

from core.no_anchor_url_resolver import NoAnchorUrlResolver

from actions.extract_link_list_auto import ExtractLinkListAutoAction

from actions.extract_link_list import ExtractLinkListAction

from models.xpath_data import XpathData



STEALTH_JS = """

Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

window.navigator.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };

Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });

"""





class FirefoxContentExtractionError(RuntimeError):

    """Firefox 已取得有效 HTML，但后续列表字段提取失败。"""





class BrowserManager:

    """网页抓取连接器；只使用外部 CDP 浏览器，不管理浏览器进程。"""



    def __init__(self):

        self.runtime_files = ensure_runtime_txt_files()

        self.proxy_browser_process = None



    def start(self):

        """只检测独立浏览器服务；这里不再创建任何浏览器进程。"""

        base_url = get_cdp_base_url()

        if base_url:

            logging.info("[OK] 已连接独立 CDP 浏览器: %s", base_url)

        if not get_cdp_base_url():

            logging.warning("未检测到独立 CDP 浏览器，请先运行 link_extractor/browser_process.py")



    def close(self):

        """浏览器由独立进程管理，抓取程序退出时不能关闭它。"""

        logging.info("[Clean] 抓取管理器已释放；独立浏览器保持运行")



    @staticmethod

    def get_cdp_base_url() -> str | None:

        return get_cdp_base_url()



    @staticmethod

    def _record_url_error(url: str, reason: str, filename: str, label: str) -> None:

        """按错误类型记录 URL；同一错误文件内相同 URL 不重复追加。"""

        runtime_files = ensure_runtime_txt_files()

        error_file = (

            runtime_files["open_error"]

            if filename == "error_open_url.txt"

            else runtime_files["extract_error"]

        )

        normalized_url = str(url or "").strip().rstrip("，,")

        if not normalized_url:

            return

        try:

            existing = error_file.read_text(encoding="utf-8-sig") if error_file.exists() else ""

            existing_urls = {

                line[4:].strip() for line in existing.splitlines() if line.startswith("URL:")

            }

            if normalized_url in existing_urls:

                logging.info("[%s] URL 已存在，跳过重复记录: %s", label, normalized_url)

                return

            block = "\n".join([

                f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",

                f"URL: {normalized_url}",

                f"Reason: {str(reason or '未抓取到有效数据').strip()}",

                "",

            ])

            with error_file.open("a", encoding="utf-8") as stream:

                stream.write(block)

            logging.warning("[%s] 已记录 URL: %s", label, error_file)

        except OSError as ex:

            logging.exception("[%s] 记录 URL 异常: %s", label, ex)



    @classmethod

    def _record_error_url(cls, url: str, reason: str) -> None:

        """记录页面已打开、但内容提取算法失败的 URL。"""

        cls._record_url_error(url, reason, "errorurl.txt", "ErrorURL")



    @classmethod

    def _record_open_error_url(cls, url: str, reason: str) -> None:

        """记录 CDP 未连接、建页失败或导航失败等浏览器打开错误。"""

        cls._record_url_error(url, reason, "error_open_url.txt", "OpenErrorURL")



    @staticmethod

    def _record_firefox_url(url: str) -> None:

        """记录所有实际交给 Firefox 打开的 URL，同一地址只保留一次。"""

        normalized_url = str(url or "").strip().rstrip("，,")

        if not normalized_url:

            return

        firefox_file = ensure_runtime_txt_files()["firefox_urls"]

        try:

            existing_urls = {

                line.strip() for line in firefox_file.read_text(

                    encoding="utf-8-sig"

                ).splitlines() if line.strip()

            }

            if normalized_url in existing_urls:

                logging.info("[FirefoxURL] URL 已存在，跳过重复记录: %s", normalized_url)

                return

            with firefox_file.open("a", encoding="utf-8") as stream:

                stream.write(normalized_url + "\n")

            logging.info("[FirefoxURL] 已记录 Firefox 打开 URL: %s", normalized_url)

        except OSError as ex:

            logging.exception("[FirefoxURL] 记录 URL 失败: %s", ex)



    @staticmethod

    def _save_browser_html(url: str, html: str) -> Path:

        """把浏览器返回的 DOM 按网站域名覆盖保存到 web 目录。"""

        hostname = urllib.parse.urlsplit(str(url or "")).hostname or "unknown-site"

        safe_name = "".join(

            char if char.isalnum() or char in ".-_" else "_"

            for char in hostname

        )

        web_dir = Path(__file__).resolve().parents[2] / "web"

        web_dir.mkdir(parents=True, exist_ok=True)

        html_file = web_dir / f"{safe_name}.html"

        html_file.write_text(str(html or ""), encoding="utf-8")

        logging.info("[HTML] 已保存浏览器 DOM: %s", html_file)

        return html_file



    @staticmethod

    def _clean_plain_text(raw_text: str) -> str:

        """去除 HTML 标签与实体，保留纯文本并规范化空白。"""

        if not raw_text:

            return ""

        text = str(raw_text)

        text = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", "", text, flags=re.DOTALL | re.IGNORECASE)

        text = re.sub(r"<[^>]+>", " ", text)

        text = html.unescape(text)

        return " ".join(text.split()).strip()



    @staticmethod

    def _records_from_dataframe(df) -> list:

        records = []

        if df is None or df.empty:

            return records

        for _, row in df.iterrows():

            item_data = {

                "Text": " ".join(str(row["Text"]).split()),

                "Url": str(row["Url"]),

                "Xpath": str(row["Xpath"]),

                "Index": str(row["Index"]),

            }

            if ("Date" in row and row["Date"] is not None and

                    str(row["Date"]).strip() and str(row["Date"]).lower() != "nan"):

                item_data["Date"] = str(row["Date"]).strip()

            if ("Summary" in row and row["Summary"] is not None and

                    str(row["Summary"]).strip() and str(row["Summary"]).lower() != "nan"):

                cleaned_summary = BrowserManager._clean_plain_text(str(row["Summary"]))

                if cleaned_summary:

                    item_data["Summary"] = cleaned_summary

            if ("Content" in row and isinstance(row["Content"], str)
                    and row["Content"].strip()):
                item_data["Content"] = row["Content"].strip()
            records.append(item_data)
        return records



    @staticmethod

    def _decode_http_body(body: bytes, content_type: str = "") -> str:

        """按响应声明的字符集解码，并兼容常见中文旧站编码。"""

        declared = re.search(r"charset\s*=\s*['\"]?([\w.-]+)", content_type or "", re.I)

        encodings = [declared.group(1)] if declared else []

        encodings.extend(["utf-8", "gb18030"])

        for encoding in dict.fromkeys(encodings):

            try:

                return body.decode(encoding)

            except (LookupError, UnicodeDecodeError):

                continue

        return body.decode("utf-8", "replace")



    def _extract_with_urllib(self, url: str) -> list:

        """先以普通 HTTP 客户端抓取静态列表；未命中时由浏览器链路兜底。"""

        request = urllib.request.Request(url, headers={

            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "

                          "AppleWebKit/537.36 Chrome/131 Safari/537.36",

            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",

        })

        try:

            with urllib.request.urlopen(request, timeout=20) as response:

                final_url = response.geturl() or url

                source = self._decode_http_body(

                    response.read(), response.headers.get("Content-Type", "")

                )

        except Exception as ex:

            logging.info("[urllib] 直连请求失败，转浏览器链路: %s", ex)

            return []



        try:

            ensure_successful_html(source, final_url)

        except HttpPageError as ex:

            logging.info("[urllib] 返回错误页，转浏览器链路: %s", ex)

            return []



        # 站点专用静态结构的通用化处理：多个 dl.clearfix，每项由 h3/a、

        # p、span 和 img 组成。新联电子的公司新闻页即采用该结构。

        items = re.findall(r'<dl\b[^>]*\bclass=["\'][^"\']*\bclearfix\b[^"\']*["\'][^>]*>(.*?)</dl>',

                           source, re.I | re.S)

        records = []

        for index, item in enumerate(items, start=1):

            title_match = re.search(

                r'<h3\b[^>]*>\s*<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',

                item, re.I | re.S,

            )

            if not title_match:

                continue

            href, raw_title = title_match.groups()

            title = self._clean_plain_text(raw_title)

            if not title:

                continue

            summary_match = re.search(r'<p\b[^>]*>(.*?)</p>', item, re.I | re.S)

            date_match = re.search(r'<span\b[^>]*>\s*([\d]{4}[./-][\d]{1,2}[./-][\d]{1,2})\s*</span>',

                                   item, re.I | re.S)

            record = {

                "Text": title,

                "Url": urllib.parse.urljoin(final_url, html.unescape(href).strip()),

                "Xpath": "urllib:dl.clearfix",

                "Index": str(index),

            }

            if summary_match:

                summary = self._clean_plain_text(summary_match.group(1))

                if summary:

                    record["Summary"] = summary

            if date_match:

                record["Date"] = date_match.group(1)

            records.append(record)

        if records:

            logging.info("[urllib][OK] 静态新闻列表抓取成功，共 %s 条: %s", len(records), final_url)

            self._save_browser_html(url, source)

            return records

        logging.info("[urllib] 未命中可用静态列表，转浏览器链路: %s", final_url)

        return []



    def _extract_from_iframes(
        self,
        page,
        page_url: str,
        sample_xpath: str = "",
        require_detail_url: bool = True,
    ) -> list:
        """顶层 DOM 无列表时，在 iframe 自身 CDP 上下文运行提取算法。



        默认仅处理同源 iframe；同一主域名下仅有 ``www.`` 与 ``site.``

        前缀差异时也视为同一个网站。主域名不同的跨域 iframe 全部跳过。

        """

        get_frame_pages = getattr(page, "get_frame_pages", None)

        if not callable(get_frame_pages):

            logging.info("[Iframe] 当前浏览器适配器不支持 frame 上下文，跳过")

            return []

        frame_pages = get_frame_pages() or []

        page_host = (urllib.parse.urlsplit(page_url).hostname or "").lower()



        def normalized_site_host(host: str) -> str:

            value = str(host or "").lower().rstrip(".")

            for prefix in ("www.", "site."):

                if value.startswith(prefix):

                    return value[len(prefix):]

            return value



        candidates = []

        seen = set()

        for frame_page in frame_pages:

            iframe_url = urllib.parse.urljoin(

                page_url, str(getattr(frame_page, "frame_url", "") or frame_page.url)

            )

            parsed = urllib.parse.urlsplit(iframe_url)

            if parsed.scheme not in {"http", "https"}:

                continue

            iframe_host = (parsed.hostname or "").lower()

            same_origin = iframe_host == page_host

            browser_rendered_oopif = bool(

                getattr(frame_page, "browser_rendered_oopif", False)

            )

            same_website_alias = (

                not same_origin

                and normalized_site_host(page_host)

                == normalized_site_host(iframe_host)

            )

            if not same_origin and not same_website_alias and not browser_rendered_oopif:

                logging.info(

                    "[Iframe] 跳过未授权跨域 iframe: %s -> %s",

                    page_host,

                    iframe_host,

                )

                continue

            if browser_rendered_oopif and not same_origin and not same_website_alias:

                logging.info(

                    "[Iframe][OOPIF] 使用 Chrome 已渲染的跨进程 iframe DOM: %s",

                    iframe_url,

                )

            # 排除明显不是业务内容的安全验证、登录和广告 iframe；页面自身

            # 提供的同源 iframe 及同网站 www/site 别名 iframe 可直接提取。

            if re.search(

                r"captcha|challenge|verify|auth|login|advert|analytics|tracker",

                iframe_url,

                re.I,

            ):

                continue

            if iframe_url in seen:

                continue

            seen.add(iframe_url)

            candidates.append((iframe_url, frame_page))



        if not candidates:

            return []

        logging.info(

            "[Iframe] 顶层页面未识别出列表，发现 %s 个允许的业务 iframe",

            len(candidates),

        )

        for index, (iframe_url, frame_page) in enumerate(candidates[:5], start=1):

            try:

                logging.info(

                    "[Iframe] (%s/%s) 尝试识别: %s",

                    index,

                    min(len(candidates), 5),

                    iframe_url,

                )

                iframe_html = frame_page.content()

                ensure_successful_html(iframe_html, frame_page.url or iframe_url)

                if len(iframe_html.strip()) < 200:

                    continue

                self._save_browser_html(page_url, iframe_html)

                if sample_xpath and require_detail_url:
                    iframe_action = ExtractLinkListAction()
                    iframe_action.bind_operating_object(

                        XpathData(absolute_path=sample_xpath)

                    )

                else:
                    iframe_action = ExtractLinkListAutoAction(
                        require_detail_url=require_detail_url
                    )
                    iframe_action.source_url = iframe_url

                    iframe_action.initial_html = iframe_html

                if not iframe_action.run(frame_page):

                    logging.info(

                        "[Iframe] 未识别出列表: %s; 原因=%s",

                        iframe_url,

                        iframe_action.last_error_msg,

                    )

                    continue

                records = self._records_from_dataframe(iframe_action.run_result)

                if records:

                    logging.info(

                        "[Iframe][OK] iframe 列表抓取成功，共 %s 条: %s",

                        len(records),

                        iframe_url,

                    )

                    return records

            except Exception as ex:

                logging.warning("[Iframe] iframe 识别异常: %s; %s", iframe_url, ex)

        return []



    @staticmethod

    def _match_network_date(value) -> str:

        """从接口时间字段保留标准日期，兼容 ISO 时间戳和中文日期。"""

        raw = str(value or "").strip()

        match = re.search(r"\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}", raw)

        return match.group(0) if match else raw



    def _extract_from_initial_network_json(self, page, source_url: str) -> list:

        """DOM 列表识别失败后，从页面初始 XHR/Fetch JSON 直接恢复列表。"""

        resolver = NoAnchorUrlResolver(

            page=page,

            source_url=source_url,

            item_xpaths=[],

            title_plan=None,

            get_plan_value=lambda *_args: "",

            match_date_value=self._match_network_date,

        )

        mapped = resolver.capture_initial_network_map()

        # 同页还会加载菜单、路由和页脚配置 JSON。将候选按响应接口分组，

        # 只取可恢复新闻记录最多的一组，避免把“投资者关系”等导航项当新闻。

        grouped = {}

        for title, item in mapped.items():

            clean_title = " ".join(str(title or "").split())

            item_url = str(item.get("Url") or "").strip()

            source = str(item.get("SourceUrl") or "").strip()

            # 菜单/路由配置也常带有 name + url；只有接口地址本身具备新闻

            # 语义时才作为通用列表候选，避免误把导航菜单当抓取结果。

            source_is_list_api = re.search(

                r"news|notice|article|content|media|information", source, re.I

            )

            if clean_title and item_url and source_is_list_api:

                grouped.setdefault(source, []).append((clean_title, item))

        if not grouped:

            return []

        response_url, selected_items = max(

            grouped.items(), key=lambda pair: len(pair[1])

        )

        if len(selected_items) < 2:

            return []

        logging.info(

            "[Network][Fallback] 从 %s 个接口候选中选择 %s 条记录的列表接口: %s",

            len(grouped), len(selected_items), response_url,

        )

        records = []

        seen = set()

        for index, (clean_title, item) in enumerate(selected_items, start=1):

            item_url = str(item.get("Url") or "").strip()

            dedupe_key = (clean_title, item_url)

            if dedupe_key in seen:

                continue

            seen.add(dedupe_key)

            record = {

                "Text": clean_title,

                "Url": item_url,

                "Xpath": "network:XHR/Fetch",

                "Index": str(index),

            }

            if item.get("Date"):

                record["Date"] = str(item["Date"]).strip()

            if item.get("Summary"):

                record["Summary"] = self._clean_plain_text(item["Summary"])

            records.append(record)

        if records:

            logging.info(

                "[Network][Fallback][OK] DOM 未识别列表，已从初始接口恢复 %s 条: %s",

                len(records), source_url,

            )

        return records



    def _extract_with_firefox(
        self,
        url: str,
        sample_xpath: str = "",
        use_proxy: bool = False,
        require_detail_url: bool = True,
    ) -> list:
        """在 worker 持有的真实 Firefox 页面运行字段提取和点击捕获。"""

        self._record_firefox_url(url)
        from queue_url_history import record_url
        record_url(url, 'FirefoxProxy' if use_proxy else 'FirefoxDirect')

        final_url, firefox_html, firefox_session = fetch_firefox_html(

            url, timeout_seconds=20, use_proxy=use_proxy

        )

        self._save_browser_html(url, firefox_html)

        # 只有通过错误页校验的 HTML 才算 Firefox 直连获取成功。

        # 此前的导航/错误页异常仍允许上层换代理 Firefox。

        try:

            ensure_successful_html(firefox_html, final_url or url)

        except Exception:
            if use_proxy:
                firefox_session.close()
            else:
                firefox_session.keep()
                logging.warning("[Firefox][Direct] 访问失败，保留原始错误页面供检查")
            raise
        try:

            page = LiveBrowserPageAdapter(

                FirefoxWorkerPageProxy(firefox_session), "Firefox"

            )

            if sample_xpath and require_detail_url:
                action = ExtractLinkListAction()
                action.bind_operating_object(

                    XpathData(absolute_path=sample_xpath)

                )

            else:
                action = ExtractLinkListAutoAction(
                    require_detail_url=require_detail_url
                )
                action.source_url = final_url or url

                action.initial_html = firefox_html

            logging.info(

                "[Firefox] 正在使用真实 Firefox 页面运行列表提取算法"

            )

            if action.run(page):

                records = self._records_from_dataframe(action.run_result)

            else:

                records = self._extract_from_iframes(
                    page,
                    final_url or url,
                    sample_xpath,
                    require_detail_url=require_detail_url,
                )
                if not records:

                    raise RuntimeError(

                        "Firefox 已打开页面，但列表提取失败: "

                        f"{action.last_error_msg}"

                    )

            for record in records:
                raw_url = str(record.get("Url") or "").strip()
                record["Url"] = (
                    urllib.parse.urljoin(final_url or url, raw_url)
                    if raw_url else ""
                )
            if not records:

                raise RuntimeError("Firefox 页面未提取到有效列表数据")

            firefox_session.close()

            return records

        except Exception as ex:

            firefox_session.keep()

            logging.warning(

                "[Firefox] 页面已打开，但后续列表提取失败，"

                "保留同一个 Firefox 页面"

            )

            raise FirefoxContentExtractionError(str(ex)) from ex



    def _ensure_proxy_browser(self) -> str | None:

        """仅在直连失败后按需启动独立代理 Chrome，不改变默认浏览器出口。"""

        link_extractor_dir = Path(__file__).resolve().parents[1]

        if str(link_extractor_dir) not in sys.path:

            sys.path.insert(0, str(link_extractor_dir))

        from browser_process import cdp_ready, read_proxy_url



        proxy_url = read_proxy_url()

        if not proxy_url:

            logging.info(

                "[Proxy] 未配置代理，跳过代理重试；可填写 txt/browser_proxy.txt"

            )

            return None

        # 9223 可能仍在运行加载旧版认证扩展的浏览器；解包扩展修改后

        # Chrome 不保证热重载。改用独立端口/配置目录，确保本次代理抓取

        # 启动的是已修复的认证扩展，而不干扰保留给排查的旧标签页。

        proxy_port = 9224

        proxy_base_url = f"http://127.0.0.1:{proxy_port}"

        if cdp_ready(proxy_port):

            return proxy_base_url



        launcher = link_extractor_dir / "browser_process.py"

        proxy_profile = Path(os.path.expandvars(r"%LOCALAPPDATA%\qinlong-cdp-proxy-browser-v2"))

        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

        logging.warning("[Proxy] 直连打开失败，正在启动代理 Chrome 重试")

        self.proxy_browser_process = subprocess.Popen(

            [

                sys.executable,

                str(launcher),

                "--port", str(proxy_port),

                "--profile", str(proxy_profile),

                "--proxy-url", proxy_url,

            ],

            cwd=str(link_extractor_dir),

            creationflags=creation_flags,

        )

        deadline = time.monotonic() + 25

        while time.monotonic() < deadline:

            if cdp_ready(proxy_port):

                logging.info("[Proxy][OK] 代理 Chrome 已启动: %s", proxy_base_url)

                return proxy_base_url

            if self.proxy_browser_process.poll() is not None:

                raise RuntimeError(

                    "代理 browser_process.py 提前退出，退出码="

                    f"{self.proxy_browser_process.returncode}"

                )

            time.sleep(0.5)

        raise TimeoutError("代理 Chrome 启动超时（25秒）")



    @staticmethod

    def _wait_for_cdp_business_ready(page, timeout_seconds: int = 60) -> bool:

        """等待代理 Chrome 网络空闲且非导航正文列表真实出现。"""

        deadline = time.monotonic() + max(10, timeout_seconds)

        previous_signature = None

        stable_count = 0

        stable_inflight_same_html_count = 0

        about_blank_count = 0

        stalled_signature = None
        stalled_count = 0

        while time.monotonic() < deadline:

            try:

                try:

                    from utils.proxy_dialog_handler import handle_proxy_auth_dialog

                    handle_proxy_auth_dialog(timeout_seconds=0.1)

                except Exception:

                    pass



                state = page.evaluate(r"""

                    () => {

                        return {

                            readyState: document.readyState,

                            url: location.href,

                            title: document.title || '',

                            bodyText: document.body

                                ? String(document.body.innerText || '').slice(0, 500) : '',

                            htmlLength: document.documentElement

                                ? document.documentElement.outerHTML.length : 0,

                            nodeCount: document.getElementsByTagName('*').length,

                            resourceCount: performance.getEntriesByType('resource').length,

                            sameOriginIframeCount: [...document.querySelectorAll('iframe[src]')]

                                .filter(frame => {

                                    try {

                                        const target = new URL(frame.getAttribute('src'), location.href);

                                        return target.origin === location.origin &&

                                            /^https?:$/.test(target.protocol);

                                    } catch (_) {

                                        return false;

                                    }

                                }).length,

                            anchorCount: document.querySelectorAll('a[href]').length,

                            hasWafScript: Boolean(document.querySelector('script') && /_0x|jsl_clearance|geetest|waf|challenge/i.test(document.querySelector('script').textContent || ''))

                        };

                    }

                """) or {}

                current_url = str(state.get("url") or "")

                error_text = (

                    f"{state.get('title') or ''} {state.get('bodyText') or ''}"

                ).lower()

                title_is_http_error = bool(re.match(

                    r"^\s*[45]\d{2}(?:\.\d+)?\b",

                    str(state.get("title") or ""),

                ))

                if current_url.startswith("chrome-error://") or title_is_http_error or any(

                    marker in error_text for marker in (

                        "该网页无法正常运作", "无法访问此网站", "网页无法打开",

                        "this page isn’t working", "this site can’t be reached",

                        "err_connection_", "err_name_not_resolved", "err_timed_out",

                        "访问被拦截", "您的请求疑似攻击行为",

                        "the access is blocked", "appears to be an attack",

                        "网站暂时无法访问", "协议和端口未接入",

                        "temporarily inaccessible",

                        "验证失败", "请刷新", "网络不给力", "重新按住滑块",

                        "重新滑动", "哎呀，出错了", "滑动验证",

                    )

                ):

                    logging.warning(

                        "[BrowserReady] 检测到验证失败或错误页，停止等待立即切换代理/降级: URL=%s",

                        current_url,

                    )

                    return False

                inflight = page.get_network_inflight_count()

                signature = (

                    str(state.get("url") or ""),

                    int(state.get("htmlLength") or 0),

                    int(state.get("nodeCount") or 0),

                    inflight

                )

                logging.debug("htmlLength: %s", signature[1])

                logging.debug("nodeCount: %s", signature[2])

                logging.debug("inflight: %s", signature[3])



                # Page.navigate 失败或迟迟没有提交文档时，标签页会一直停留在

                # about:blank。此时空白 DOM 虽然非常稳定，但不可能成为业务页，

                # 无需继续等待完整的 60 秒超时。

                if current_url.lower() == "about:blank" and signature[1] <= 200:

                    about_blank_count += 1

                    if about_blank_count >= 30:

                        logging.warning(

                            "[BrowserReady] about:blank 且空白 DOM 连续出现 %s 次，"

                            "提前判定页面导航失败: htmlLength=%s, nodeCount=%s, inflight=%s",

                            about_blank_count, signature[1], signature[2], signature[3],

                        )

                        return False

                else:

                    about_blank_count = 0



                # 若检测到 JS 盾挑战页且当前无任何 A 标签，需等待 JS 解密跳转。

                # 不能只以 HTML 大于 200 字符作为业务页依据：Vue/React 的

                # 空挂载壳通常只有约 1KB、二十余节点，却会因此被误判为就绪。

                is_waf_challenge = state.get("anchorCount", 0) == 0 and state.get("hasWafScript", False)

                body_text_length = len(str(state.get("bodyText") or "").strip())

                business_evidence = (

                    not is_waf_challenge

                    and (

                        body_text_length >= 80

                        or signature[1] >= 5_000

                        or signature[2] >= 60

                        or state.get("sameOriginIframeCount", 0) > 0

                    )

                )

                ready = (

                    state.get("readyState") in ("interactive", "complete")

                    and business_evidence

                )



                if previous_signature is not None:

                    _, prev_html_len, _, prev_inflight = previous_signature

                    curr_html_len, curr_inflight = signature[1], signature[3]

                    if curr_html_len == prev_html_len and curr_inflight <= prev_inflight:

                        stable_inflight_same_html_count += 1

                        logging.debug(

                            "[BrowserReady] 连续 inflight (变小或不变) 且 htmlLength 稳定次数: %s",

                            stable_inflight_same_html_count

                        )

                    else:

                        stable_inflight_same_html_count = 0



                # 无业务内容且 DOM、正文、资源和请求数均无进展约 10 秒，
                # 提前判为未就绪，不把空壳当成功；验证页仍保留原等待预算。
                progress = (signature, state.get("resourceCount", 0),
                            state.get("readyState"), state.get("bodyText", ""))
                if not business_evidence and not is_waf_challenge:
                    stalled_count = stalled_count + 1 if progress == stalled_signature else 0
                    stalled_signature = progress
                    if stalled_count >= 20:
                        logging.warning(
                            "[BrowserReady] 页面无业务内容且连续 20 次无加载进展，提前结束等待: "
                            "HTML=%s, 节点=%s, 请求中=%s, URL=%s",
                            signature[1], signature[2], inflight, current_url,
                        )
                        return False
                else:
                    stalled_count = 0
                    stalled_signature = None

                if ready:

                    if inflight == 0:

                        if signature == previous_signature:

                            stable_count += 1

                            if stable_count >= 2:

                                logging.info(

                                    "[BrowserReady][OK] inflight=0 且网络与业务 DOM 已稳定: "

                                    "htmlLength=%s, nodeCount=%s",

                                    signature[1], signature[2]

                                )

                                return True

                        else:

                            stable_count = 0

                    else:

                        if stable_inflight_same_html_count >= 5:

                            logging.info(

                                "[BrowserReady][OK] 连续 %s 次 inflight(变小/不变) 且 htmlLength 稳定，跳过 inflight=0 等待: "

                                "请求中=%s, htmlLength=%s, nodeCount=%s",

                                stable_inflight_same_html_count, inflight, signature[1], signature[2]

                            )

                            return True



                        if signature == previous_signature:

                            stable_count += 1

                            if stable_count >= 3:

                                logging.info(

                                    "[BrowserReady][OK] 网络与业务 DOM 已稳定: "

                                    "请求中=%s, htmlLength=%s, nodeCount=%s",

                                    inflight, signature[1], signature[2]

                                )

                                return True

                        else:

                            stable_count = 0

                else:

                    stable_count = 0

                previous_signature = signature

            except Exception as ex:

                logging.debug("[Proxy] 等待网络与业务 DOM 异常: %s", ex)

                stalled_count = 0
                stalled_signature = None

                stable_count = 0

                stable_inflight_same_html_count = 0

                about_blank_count = 0

            time.sleep(0.5)

        logging.warning("[Proxy] 等待网络与业务 DOM 超时（%s秒）", timeout_seconds)

        return False



    @staticmethod

    def _wait_for_manual_aliyun_slider(page, timeout_seconds: int = 10) -> bool:

        """检测阿里云 ESA / 滑动验证，尝试自动拖动并等待验证完成。"""

        return AliyunSliderSolver.solve(page, timeout_seconds=timeout_seconds, humanize=True)





    @staticmethod

    def _keep_firefox_page_open(url: str) -> None:

        """Firefox 降级失败后保留可见页面，供人工检查 WAF/加载状态。"""

        firefox_path = find_firefox()

        if not firefox_path:

            logging.warning("[Firefox] 未找到 Firefox，无法保留失败页面")

            return

        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

        subprocess.Popen(

            [firefox_path, "-new-window", str(url).replace("amp;", "")],

            stdout=subprocess.DEVNULL,

            stderr=subprocess.DEVNULL,

            creationflags=creation_flags,

        )

        logging.warning("[Firefox] 抓取失败页面已保留，不自动关闭: %s", url)



    def _extract_with_proxy_chrome(
        self,
        url: str,
        sample_xpath: str = "",
        require_detail_url: bool = True,
    ) -> list:
        """直连失败后的代理 CDP 重试，复用同一套列表提取算法。"""

        proxy_base_url = self._ensure_proxy_browser()

        if not proxy_base_url:

            return []

        page = None

        proxy_success = False

        try:

            page = CDPPage.create_new_page(proxy_base_url)

            from browser_process import read_proxy_url

            proxy_config = urllib.parse.urlsplit(read_proxy_url())

            if proxy_config.username:

                page.enable_proxy_auth(

                    urllib.parse.unquote(proxy_config.username),

                    urllib.parse.unquote(proxy_config.password or ""),

                )

                logging.info("[Proxy] 已启用 CDP 原生代理认证")

            page.add_init_script(STEALTH_JS)

            logging.info("[Proxy] 正在通过代理访问目标网页：%s", url)

            page.goto(url, wait_until="domcontentloaded", timeout=60000)

            self._wait_for_manual_aliyun_slider(page)

            if not self._wait_for_cdp_business_ready(page, timeout_seconds=60):

                raise RuntimeError(

                    "代理 Chrome 未等到业务 DOM；页面可能停留在代理认证或前端空壳"

                )

            browser_html = page.content()

            ensure_successful_html(browser_html, page.url or url)

            if page.url.startswith("chrome-error://") or len(browser_html.strip()) < 200:

                raise RuntimeError(f"代理 Chrome 未取得有效正文: URL={page.url}")

            self._save_browser_html(url, browser_html)



            if sample_xpath and require_detail_url:
                action = ExtractLinkListAction()
                action.bind_operating_object(XpathData(absolute_path=sample_xpath))

            else:
                action = ExtractLinkListAutoAction(
                    require_detail_url=require_detail_url
                )
                action.source_url = url

                action.initial_html = browser_html

            if action.run(page):

                records = self._records_from_dataframe(action.run_result)

            else:

                if not sample_xpath and require_detail_url:
                    records = self._extract_from_initial_network_json(
                        page, page.url or url

                    )

                else:

                    records = []

                if not records:

                    records = self._extract_from_iframes(
                        page,
                        url,
                        sample_xpath,
                        require_detail_url=require_detail_url,
                    )
                if not records:

                    raise RuntimeError(f"代理页面列表提取失败: {action.last_error_msg}")

            if records:

                proxy_success = True

                logging.info("[Proxy][OK] 代理重试抓取成功，共 %s 条", len(records))

            return records

        finally:

            if page and proxy_success:

                page.close()

            elif page:

                logging.warning(

                    "[Proxy] 代理提取失败，保留当前代理 Chrome 标签页供人工检查和排查: %s", url

                )



    def _extract_with_drission(
        self,
        url: str,
        sample_xpath: str = "",
        use_proxy: bool = False,
        require_detail_url: bool = True,
    ) -> list:
        """Chrome 直连失败时，使用 DrissionPage 降级打开网页并提取列表字段。"""
        from queue_url_history import record_url
        record_url(url, 'DrissionPageProxy' if use_proxy else 'DrissionPageDirect')

        try:

            from DrissionPage import Chromium

            from DrissionPage._configs.chromium_options import ChromiumOptions

        except ImportError as ex:

            logging.warning("[DrissionPage] 未安装 DrissionPage 依赖: %s", ex)

            return []



        from browsers.cdp_client import find_chrome

        chrome_path = find_chrome()



        # 不读取本机 ini 中的代理/扩展配置；代理仅由 use_proxy 分支显式启用。
        co = ChromiumOptions(read_file=False)
        if chrome_path:

            co.set_browser_path(chrome_path)

        co.set_argument("--disable-gpu")

        co.set_argument("--window-size=1280,800")

        co.set_argument("--window-position=100,100")

        co.set_argument("--start-minimized")

        co.ignore_certificate_errors(on_off=True)



        if use_proxy:

            from browser_process import prepare_proxy_extension, read_proxy_url

            proxy_url = read_proxy_url()

            if not proxy_url:

                logging.warning("[DrissionPage][Proxy] 未配置代理，跳过代理 DrissionPage")

                return []

            proxy_profile = Path(os.path.expandvars(

                r"%LOCALAPPDATA%\qinlong-drission-proxy-browser-v2"

            ))

            proxy_server, proxy_extension = prepare_proxy_extension(

                proxy_profile, proxy_url

            )

            # 认证信息不能放进 --proxy-server；Chromium 只接受 scheme://host:port。

            # 与 9223 代理 Chrome 相同，认证交给 MV3 扩展完成。

            co.set_user_data_path(str(proxy_profile))

            co.set_local_port(5546)

            co.set_argument(f"--proxy-server={proxy_server}")

            if proxy_extension:

                co.add_extension(str(proxy_extension))

                co.set_argument(f"--disable-extensions-except={proxy_extension}")

                co.set_argument(f"--load-extension={proxy_extension}")

            logging.info(

                "[DrissionPage][Proxy] 已启用代理：%s；认证=%s",

                proxy_server, "是" if proxy_extension else "否",

            )

        else:

            co.set_local_port(5544)

            co.set_argument("--no-proxy-server")
            logging.info("[DrissionPage] 默认直连，已禁用系统代理")
        browser = Chromium(co)

        tab = browser.latest_tab
        if use_proxy:
            from browsers.proxy_auth import enable_drission_proxy_auth
            if enable_drission_proxy_auth(tab, proxy_url):
                logging.info("[DrissionPage][Proxy] 已在导航前启用原生代理认证")

        try:

            tab.set.window.mini()

        except Exception:

            pass

        tab.get(url)

        time.sleep(2.5)



        # 检查并自动求解滑动验证码

        try:

            from browsers.slider_drag import AliyunSliderSolver

            if AliyunSliderSolver.is_challenge_page(tab):

                logging.warning("[DrissionPage][Captcha] 检测到滑动验证码，正在自动求解...")

                AliyunSliderSolver.solve(tab)

                time.sleep(2.0)

        except Exception as ex:

            logging.warning("[DrissionPage][Captcha] 滑块处理异常: %s", ex)



        final_url = tab.url or url

        drission_html = tab.html or ""

        html_chars = len(drission_html)

        html_bytes = len(drission_html.encode("utf-8"))

        logging.info(

            "[DrissionPage] 页面加载完成: URL=%s, HTML 大小=%s 字符 (%s 字节 / %.2f KB)",

            final_url,

            f"{html_chars:,}",

            f"{html_bytes:,}",

            html_bytes / 1024,

        )

        ensure_successful_html(drission_html, final_url)

        if len(str(drission_html or "").strip()) < 200:

            raise RuntimeError(f"DrissionPage 未取得有效正文: URL={final_url}")



        self._save_browser_html(url, drission_html)

        live_page = LiveBrowserPageAdapter(tab, "DrissionPage")

        if sample_xpath and require_detail_url:
            action = ExtractLinkListAction()
            action.bind_operating_object(

                XpathData(absolute_path=sample_xpath)

            )

        else:
            action = ExtractLinkListAutoAction(
                require_detail_url=require_detail_url
            )
            action.source_url = final_url or url

            action.initial_html = drission_html

        logging.info(

            "[DrissionPage] 正在使用真实 Chromium 标签页运行列表提取算法"

        )

        if action.run(live_page):

            records = self._records_from_dataframe(action.run_result)

        else:

            if not sample_xpath:

                records = self._extract_from_initial_network_json(

                    live_page, final_url or url

                )

            else:

                records = []

            if not records:

                records = self._extract_from_iframes(

                    live_page,
                    final_url or url,
                    sample_xpath,
                    require_detail_url=require_detail_url,
                )

            if not records:

                raise RuntimeError(

                    "DrissionPage 已打开页面，但列表提取失败: "

                    f"{action.last_error_msg}"

                )

        for record in records:
            raw_url = str(record.get("Url") or "").strip()
            record["Url"] = (
                urllib.parse.urljoin(final_url or url, raw_url)
                if raw_url else ""
            )
        if records:

            logging.info(

                "[DrissionPage][OK] 真实标签页降级抓取成功，共 %s 条: %s",

                len(records),

                url,

            )

        return records



    def _ensure_cdp_browser(self) -> str | None:

        """确保独立 CDP 浏览器在线；若掉线或未启动，自动拉起 browser_process.py。"""

        link_extractor_dir = Path(__file__).resolve().parents[1]

        if str(link_extractor_dir) not in sys.path:

            sys.path.insert(0, str(link_extractor_dir))

        from browser_process import cdp_ready, DEFAULT_PORT



        base_url = get_cdp_base_url()

        if base_url:

            return base_url



        if cdp_ready(DEFAULT_PORT):

            return f"http://127.0.0.1:{DEFAULT_PORT}"



        launcher = link_extractor_dir / "browser_process.py"

        logging.warning("[Browser] 检测到独立 CDP 浏览器未启动或已退出，正在自动拉起守护进程: %s", launcher)

        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

        try:

            subprocess.Popen(

                [sys.executable, str(launcher)],

                cwd=str(link_extractor_dir),

                creationflags=creation_flags,

            )

            deadline = time.monotonic() + 25

            while time.monotonic() < deadline:

                if cdp_ready(DEFAULT_PORT):

                    base_url = get_cdp_base_url() or f"http://127.0.0.1:{DEFAULT_PORT}"

                    logging.info("[Browser][OK] 独立 CDP 浏览器已自动拉起并就绪: %s", base_url)

                    return base_url

                time.sleep(0.5)

        except Exception as ex:

            logging.error("[Browser] 自动拉起 CDP 浏览器异常: %s", ex)

        return None



    def extract_no_url_news(self, url: str) -> list:
        """按标题/正文结构抓取没有详情 URL 的新闻列表。"""
        return self.extract_links(url, require_detail_url=False)

    def extract_links(
        self,
        url: str,
        sample_xpath: str = "",
        require_detail_url: bool = True,
    ) -> list:
        """执行列表提取；可关闭详情 URL 要求以抓取纯内容新闻。"""
        self.last_extract_error = ""
        recent_file = ensure_runtime_txt_files()["recent"]

        try:

            recent_file.write_text(

                "\n".join([

                    f"URL: {url.strip().rstrip('，,')}",

                    "Status: ReceivedByMQOrBrowserManager",

                    "ContainerXPath: ",

                    "SampleXPath: ",

                    "ItemCount: 0",

                    "ItemXPaths:",

                    "",

                ]),

                encoding="utf-8",

            )

            logging.info("已记录本次抓取 URL 到: %s", recent_file)

        except OSError as ex:

            logging.exception("记录本次抓取 URL 失败: %s", ex)



        if require_detail_url:
            urllib_records = self._extract_with_urllib(url)
            if urllib_records:
                return urllib_records
        else:
            logging.info(
                "[NoUrl] 已跳过依赖 a[href] 的 urllib 静态列表提取"
            )


        parsed_url = urllib.parse.urlsplit(url)

        if (

            (parsed_url.hostname or "").lower() in {"sanbian.cn", "www.sanbian.cn"}

            and parsed_url.path.rstrip("/") == "/news"

        ):

            canonical_url = urllib.parse.urlunsplit((

                parsed_url.scheme or "https",

                parsed_url.netloc,

                "/zh/news",

                parsed_url.query,

                parsed_url.fragment,

            ))

            logging.info(

                "[Route] 三变旧新闻入口返回 404，改用实际中文路由: %s -> %s",

                url,

                canonical_url,

            )

            url = canonical_url



        datas = []

        last_error = ""



        # 确保 CDP 浏览器在线；若掉线自动拉起，若拉起失败则直接进入 DrissionPage 降级

        base_url = self._ensure_cdp_browser()



        page = None

        cdp_success = False

        page_opened = False

        chrome_open_failed = False

        http_page_error = False

        http_error_status = 0

        proxy_retry_allowed = False

        cdp_list_content_loaded = False

        try:

            if not base_url:

                raise RuntimeError("独立 CDP 浏览器未启动或无法连接，准备进入降级流程")

            page = CDPPage.create_new_page(base_url)

            from browser_process import read_proxy_url

            proxy_url = read_proxy_url()

            if proxy_url:

                proxy_config = urllib.parse.urlsplit(proxy_url)

                if proxy_config.username:

                    page.enable_proxy_auth(

                        urllib.parse.unquote(proxy_config.username),

                        urllib.parse.unquote(proxy_config.password or ""),

                    )

            logging.info(f"正在通过原生 CDP 访问目标网页：{url}")

            page.goto(url, wait_until="domcontentloaded", timeout=60000)

            page_opened = True

            self._wait_for_manual_aliyun_slider(page)

            if not self._wait_for_cdp_business_ready(page, timeout_seconds=60):

                logging.warning("[CDP] 直连 Chrome 页面等待超时（60秒），仍进行最后一次网页内容抓取...")

            browser_html = page.content()

            ensure_successful_html(browser_html, page.url or url)

            page_state = page.evaluate(r"""

                () => ({

                    bodyTextLength: document.body

                        ? (document.body.innerText || '').trim().length : 0,

                    bodyText: document.body

                        ? (document.body.innerText || '').trim().slice(0, 4000) : '',

                    validLinkCount: [...document.querySelectorAll('a[href]')].filter(a => {

                        const href = String(a.getAttribute('href') || '').trim();

                        return href && href !== '#' && !/^javascript:/i.test(href);

                    }).length,

                    challengeElementCount: document.querySelectorAll([

                        '#challenge-form', '#cf-challenge-running',

                        '.cf-challenge', '.challenge-platform',

                        'iframe[src*="captcha"]', 'iframe[src*="challenge"]',

                        '[class*="captcha-container"]', '[id*="captcha-container"]'

                    ].join(',')).length,

                    visibleDateCount: [...document.querySelectorAll('body *')]

                        .filter(node => node.children.length === 0 &&

                            /(?:20\d{2})[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2}/

                                .test(String(node.innerText || node.textContent || '')))

                        .length,

                    listNamedNodeCount: document.querySelectorAll([

                        'article', '[class*="news"]', '[class*="News"]',

                        '[class*="list"]', '[class*="List"]'

                    ].join(',')).length,

                    businessIframeCount: [...document.querySelectorAll('iframe[src]')]

                        .filter(frame => !/captcha|challenge|verify|auth|login|advert/i

                            .test(String(frame.src || ''))).length

                })

            """) or {}

            body_text_length = int(page_state.get("bodyTextLength") or 0)

            body_text = str(page_state.get("bodyText") or "").lower()

            valid_link_count = int(page_state.get("validLinkCount") or 0)

            challenge_element_count = int(

                page_state.get("challengeElementCount") or 0

            )

            visible_date_count = int(page_state.get("visibleDateCount") or 0)

            list_named_node_count = int(page_state.get("listNamedNodeCount") or 0)

            business_iframe_count = int(page_state.get("businessIframeCount") or 0)

            visible_challenge = any(marker in body_text for marker in (

                "正在进行安全验证", "执行安全验证", "验证您是真人",

                "安全验证", "人机验证", "verify you are human",

                "请先完成校验", "请输入验证码", "看不清楚，换一张",

                "checking your browser", "just a moment",

                "验证失败", "请刷新", "网络不给力", "请按住滑块", "滑动验证",

                "重新按住滑块", "哎呀，出错了",

            ))

            challenge_page = valid_link_count < 3 and (

                visible_challenge or challenge_element_count > 0

            )

            if (page.url.startswith("chrome-error://") or

                    len(str(browser_html or "").strip()) < 200 or

                    body_text_length == 0 or challenge_page):

                chrome_open_failed = True

                raise RuntimeError(

                    "Chrome 未取得有效网页正文: "

                    f"URL={page.url}, HTML={len(browser_html or '')}字符, "

                    f"正文={body_text_length}字符, 有效链接={valid_link_count}, "

                    f"安全验证页={challenge_page}"

                )

            cdp_list_content_loaded = bool(

                visible_date_count >= 2

                or list_named_node_count >= 3

                or business_iframe_count >= 1

            )

            if cdp_list_content_loaded:

                logging.info(

                    "[CDP] 页面已有列表内容证据：日期节点=%s，列表命名节点=%s，"

                    "业务iframe=%s",

                    visible_date_count,

                    list_named_node_count,

                    business_iframe_count,

                )

            self._save_browser_html(url, browser_html)



            if sample_xpath and require_detail_url:
                action = ExtractLinkListAction()
                xpath_config = XpathData(absolute_path=sample_xpath)

                action.bind_operating_object(xpath_config)

            else:
                action = ExtractLinkListAutoAction(
                    require_detail_url=require_detail_url
                )
                action.source_url = url

                action.initial_html = browser_html

                logging.info("正在原生 CDP 模式运行 ExtractLinkListAutoAction (全自动识别)...")



            action_succeeded = action.run(page)

            if action_succeeded:

                df = action.run_result

                if df is not None and not df.empty:

                    datas.extend(self._records_from_dataframe(df))

            else:

                last_error = action.last_error_msg



            # action.run() 的布尔值只表示算法执行过程没有报错，

            # 不代表一定产出了列表。顶层页是空壳、真实列表在 OOPIF 时，

            # 必须以 datas 是否为空作为继续兜底的判断条件。

            if not datas and not sample_xpath and require_detail_url:
                datas.extend(self._extract_from_initial_network_json(
                    page, page.url or url

                ))

            if not datas:

                datas.extend(
                    self._extract_from_iframes(
                        page,
                        url,
                        sample_xpath,
                        require_detail_url=require_detail_url,
                    )
                )


            cdp_success = bool(datas)

            if not cdp_success and isinstance(action, ExtractLinkListAutoAction):

                action.show_debug_panel_on_failure(page)

            if not cdp_success:

                logging.error(f"原生 CDP 重试也失败，原因: {action.last_error_msg}")

                if cdp_list_content_loaded:

                    logging.warning(

                        "[CDP] 网页及列表内容已加载，属于容器提取失败；"

                        "保留当前页面，不切换浏览器或代理"

                    )

        except HttpPageError as e:

            last_error = str(e)

            http_page_error = True

            http_error_status = e.status

            try:

                error_html = page.content() if page else ""

            except Exception:

                error_html = ""

            rendered_error = detect_http_error_page(error_html)

            if rendered_error and rendered_error[0] == 503:

                if e.status != 503:

                    logging.warning(

                        "[HTTP] 响应状态 %s 与错误页语义不一致，按 %s (%s) 处理",

                        e.status,

                        rendered_error[0],

                        rendered_error[1],

                    )

                http_error_status = rendered_error[0]

                if urllib.parse.urlsplit(url).scheme == "http":

                    parsed = urllib.parse.urlsplit(url)

                    https_url = urllib.parse.urlunsplit((

                        "https", parsed.netloc, parsed.path,

                        parsed.query, parsed.fragment,

                    ))

                    logging.warning(

                        "[Route] HTTP 协议未接入阿里云 WAF，"

                        "后续降级改用 HTTPS: %s -> %s",

                        url,

                        https_url,

                    )

                    url = https_url

            proxy_retry_allowed = http_error_status in {

                400, 403, 404, 405, 407, 418, 429, 468, 503, 505

            }

            if e.status == 407 or "407" in str(e):

                logging.warning(

                    "[HTTP 407] 目标网页返回 HTTP 407 Proxy Authentication Required，"

                    "正在自动触发模拟消息填写代理用户名和密码..."

                )

                try:

                    from utils.proxy_dialog_handler import handle_proxy_auth_dialog

                    handle_proxy_auth_dialog(timeout_seconds=2.0)

                except Exception as ex_dlg:

                    logging.warning("[HTTP 407] 填入代理用户名密码对话框异常: %s", ex_dlg)

            if page:

                try:

                    self._save_browser_html(url, page.content())

                except Exception:

                    logging.exception("[HTML] 保存 HTTP 错误页失败")

            logging.error("[HTTP] %s", e)

        except Exception as e:

            last_error = str(e)

            chrome_open_failed = True

            logging.error(f"原生 CDP 模式提取异常: {e}")

        finally:

            if page and cdp_success:
                page.close()

            elif page:

                logging.warning(

                    "CDP 提取失败，保留当前 Chrome 标签页，供检查容器和列表 XPath"

                )



        # ----------------------------------------------------

        # 降级阶段 1：CDP 页面打不开/无列表内容时尝试 DrissionPage。

        # 若已有明显列表结构而只是容器算法失败，保留当前页面供调整 XPath，

        # 不切换浏览器或代理，以免掩盖真正的容器问题。

        # ----------------------------------------------------

        drission_attempted = False

        if not datas and not cdp_list_content_loaded:

            drission_attempted = True

            try:

                logging.warning(

                    "[DrissionPage] CDP 未产出列表，尝试 DrissionPage 直连: %s",

                    url,

                )

                datas = self._extract_with_drission(
                    url,
                    sample_xpath,
                    use_proxy=False,
                    require_detail_url=require_detail_url,
                )
                if datas:

                    logging.info("[DrissionPage][OK] 降级抓取成功，共 %s 条", len(datas))

            except Exception as drission_ex:

                last_error = f"直连失败: {last_error}; DrissionPage直连失败: {drission_ex}"

                logging.warning("[DrissionPage] 降级抓取异常: %s", drission_ex)



        # ----------------------------------------------------

        # 降级阶段 2：DrissionPage 仍失败后，再走代理 Chrome

        # ----------------------------------------------------

        proxy_attempted = False

        if not datas and drission_attempted:

            proxy_attempted = True

            try:

                logging.warning("[Proxy] DrissionPage 直连未成功，改走代理 Chrome 重试: %s", url)

                datas = self._extract_with_proxy_chrome(
                    url,
                    sample_xpath,
                    require_detail_url=require_detail_url,
                )
            except Exception as ex:

                last_error = f"{last_error}; 代理失败: {ex}"

                logging.error("[Proxy] 代理重试失败: %s", ex)



        # ----------------------------------------------------

        # 降级阶段 3：代理 Chrome 仍失败后，用同样的代理配置换 DrissionPage。

        # ----------------------------------------------------

        drission_proxy_attempted = False

        if not datas and proxy_attempted:

            drission_proxy_attempted = True

            try:

                logging.warning(

                    "[DrissionPage][Proxy] 代理 Chrome 未成功，使用同一代理重试: %s",

                    url,

                )

                datas = self._extract_with_drission(
                    url,
                    sample_xpath,
                    use_proxy=True,
                    require_detail_url=require_detail_url,
                )
                if datas:

                    logging.info(

                        "[DrissionPage][Proxy][OK] 代理降级抓取成功，共 %s 条",

                        len(datas),

                    )

            except Exception as drission_proxy_ex:

                last_error = f"{last_error}; DrissionPage代理失败: {drission_proxy_ex}"

                logging.warning(

                    "[DrissionPage][Proxy] 代理降级异常: %s", drission_proxy_ex

                )



        # ----------------------------------------------------

        # 降级阶段 4：两个 Chromium 代理路径都失败后，最后换 Firefox 内核

        # ----------------------------------------------------

        # 前面的 Chromium 路径都没有数据就应进入 Firefox；不能再次依赖

        # “Chrome 是否打开失败”，否则 CDP 打开成功但提取失败会再次断链。

        firefox_retry_allowed = bool(

            drission_attempted or proxy_attempted or drission_proxy_attempted

        )

        if not datas and firefox_retry_allowed:

            try:

                logging.warning("[Firefox][Direct] Chrome/DrissionPage/代理均未成功，尝试 Firefox 直连")

                datas = self._extract_with_firefox(
                    url,
                    sample_xpath,
                    use_proxy=False,
                    require_detail_url=require_detail_url,
                )
                if not datas:

                    raise RuntimeError("Firefox 直连未抓取到有效数据")

                if datas:

                    logging.info(

                        "[Firefox][Direct][OK] 降级抓取成功，共 %s 条", len(datas)

                    )

            except FirefoxDependencyError as direct_ex:

                last_error = f"{last_error}; Firefox依赖缺失: {direct_ex}"

                logging.error(

                    "[Firefox] 运行环境缺少依赖，代理 Firefox 使用同一 Python，"

                    "跳过重复重试: %s",

                    direct_ex,

                )

            except Exception as direct_ex:

                logging.warning(

                    "[Firefox][Direct] 未取得列表或有效页面，改用代理 Firefox: %s",

                    direct_ex,

                )

                try:

                    datas = self._extract_with_firefox(
                        url,
                        sample_xpath,
                        use_proxy=True,
                        require_detail_url=require_detail_url,
                    )
                    if not datas:

                        raise RuntimeError("Firefox 代理未抓取到有效数据")

                    if datas:

                        logging.info(

                            "[Firefox][Proxy][OK] 代理降级抓取成功，共 %s 条",

                            len(datas),

                        )

                except Exception as proxy_ex:

                    last_error = (

                        f"{last_error}; Firefox直连失败: {direct_ex}; "

                        f"Firefox代理失败: {proxy_ex}"

                    )

                    logging.error("[Firefox][Proxy] 代理降级失败: %s", proxy_ex)



        if not datas:

            self.last_extract_error = last_error or "未抓取到有效的新闻标题或内容"

            if http_page_error:

                self._record_open_error_url(url, last_error)

            elif page_opened:

                self._record_error_url(url, last_error or "未抓取到有效的新闻标题或URL")

            else:

                self._record_open_error_url(url, last_error or "浏览器未能打开目标网页")

        return datas
