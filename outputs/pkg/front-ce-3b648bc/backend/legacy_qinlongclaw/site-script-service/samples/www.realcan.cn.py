# -*- coding: utf-8 -*-
"""
瑞康医药集团股份有限公司 - 网站专用新闻抓取脚本
================================================

列表页: https://www.realcan.cn/newscenter
站点特征: 新闻数据直接内嵌在页面源码的 JS 变量中：
          window.MEApp.newslist = [ {...}, ... ]
          字段: name(标题) / pubdate(日期) / txtDiv(栏目)
                / htmlContent(base64 编码的 HTML 正文)
          注意: 该站 base64 省略了 '=' 填充，解码前需补齐到 4 的倍数；
                图片同时带 _src 与 src 属性（src 即为可用地址）。

接入约定:
- 入口为 scrape(url)，返回新闻字典列表（title/date/url/summary/content）。
- content 返回解码后的正文原始 HTML（保留图片标签与图文顺序），
  图片为绝对地址；WWIMAGE / WWTITLE 标记与上传由主程序统一处理。
- 导入本模块不会请求网站；独立测试代码在 if __name__ == "__main__" 中。
- 网络或解析异常抛出带原因的异常；无有效新闻返回空列表。

仅使用 Python 标准库；请求默认不继承系统 HTTP 代理。
"""

import base64
import json
import re
import ssl
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser

# --------------------------------------------------------------------------
# 配置
# --------------------------------------------------------------------------
REALCAN_PAGE = "https://www.realcan.cn/newscenter"
ALLOWED_HOSTS = {"www.realcan.cn", "realcan.cn"}

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": REALCAN_PAGE,
}
TIMEOUT = 60   # 单次请求超时（秒），页面较大（约 1.3MB）
RETRY = 3      # 失败重试次数
SUMMARY_LEN = 150

# 默认不继承系统代理：显式使用空 ProxyHandler 的 opener
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


# --------------------------------------------------------------------------
# 通用工具
# --------------------------------------------------------------------------
def http_get(url, extra_headers=None):
    """带 UA / 超时 / 有限重试 / SSL 容错的 GET，不继承系统代理。"""
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    last_err = None
    for attempt in range(1, RETRY + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            try:
                resp = _OPENER.open(req, timeout=TIMEOUT)
            except ssl.SSLError:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                resp = _OPENER.open(req, timeout=TIMEOUT, context=ctx)
            data = resp.read()
            charset = resp.headers.get_content_charset() or ""
            if not charset:
                m = re.search(rb'charset=["\']?([\w-]+)', data[:2048])
                charset = m.group(1).decode("ascii", "ignore") if m else "utf-8"
            try:
                return data.decode(charset, "replace")
            except LookupError:
                return data.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * attempt)
    raise RuntimeError(f"请求失败（已重试 {RETRY} 次）: {url} -> {last_err}")


class _TextExtractor(HTMLParser):
    """HTML -> 纯文本（仅用于生成摘要；正文原始 HTML 原样返回）。"""

    _SKIP = {"script", "style", "noscript"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._chunks = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in ("p", "br", "div", "li", "tr", "h1", "h2", "h3",
                     "h4", "h5", "h6", "section", "article"):
            self._chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag in ("p", "div", "li", "tr", "h1", "h2", "h3",
                     "h4", "h5", "h6", "section", "article"):
            self._chunks.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0 and data.strip():
            self._chunks.append(data)

    def text(self):
        raw = "".join(self._chunks)
        lines = [re.sub(r"[ \t\u3000\xa0]+", " ", ln).strip() for ln in raw.split("\n")]
        return "\n".join(ln for ln in lines if ln)


def html_to_text(html):
    if not html:
        return ""
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001
        text = re.sub(r"<[^>]+>", " ", html)
        return re.sub(r"\s{2,}", " ", text).strip()
    return parser.text()


def make_summary(text, limit=SUMMARY_LEN):
    flat = re.sub(r"\s+", " ", text or "").strip()
    return flat[:limit] + ("..." if len(flat) > limit else "")


def normalize_date(raw):
    """统一日期为 YYYY-MM-DD。"""
    if not raw:
        return ""
    m = re.search(r"(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})", str(raw))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return str(raw).strip()


def absolutize_images(html, base_url):
    """把正文中相对图片地址转为绝对地址，保留查询参数。
    兼容 src / data-src / data-original / data-lazy-src 属性；
    并把飞书导出的 _src 属性归一为 src。"""
    if not html:
        return html
    # _src="..." -> src="..."（该站图片 HTML 同时带 _src 与 src）
    html = re.sub(r'\b_src\s*=', 'src=', html)

    pattern = re.compile(
        r'((?:data-original|data-src|data-lazy-src|src)\s*=\s*)(["\'])([^"\']*)\2', re.I)

    def _fix(m):
        attr, quote, src = m.group(1), m.group(2), m.group(3).strip()
        if src and not urllib.parse.urlsplit(src).scheme:
            src = urllib.parse.urljoin(base_url, src)
        return f"{attr}{m.group(2)}{src}{m.group(2)}"

    return pattern.sub(_fix, html)


def decode_body_html(b64):
    """解码瑞康的 base64 正文（省略 '=' 填充），返回原始 HTML。"""
    b64 = re.sub(r"\s+", "", str(b64 or ""))
    if not b64:
        return ""
    b64 += "=" * (-len(b64) % 4)  # 补齐 base64 padding
    return base64.b64decode(b64).decode("utf-8", "replace")


# --------------------------------------------------------------------------
# 抓取逻辑
# --------------------------------------------------------------------------
def extract_newslist(html):
    """从页面源码提取 window.MEApp.newslist 数组。"""
    marker = "window.MEApp.newslist"
    pos = html.find(marker)
    if pos < 0:
        raise RuntimeError("页面中未找到 window.MEApp.newslist，站点结构可能已变更")
    eq = html.find("=", pos)
    bracket = html.index("[", eq)
    decoder = json.JSONDecoder()
    newslist, _ = decoder.raw_decode(html, bracket)
    if not isinstance(newslist, list):
        raise RuntimeError("window.MEApp.newslist 不是列表，站点结构可能已变更")
    return newslist


def scrape(url):
    """抓取瑞康医药新闻中心列表，返回新闻字典列表。

    - url 为列表页地址（https://www.realcan.cn/newscenter）。
    - 条目无独立详情页（详情由前端同一页面渲染），url 字段使用传入的列表地址。
    - content 为解码后的正文原始 HTML（保留图片标签），图片已转绝对地址。
    """
    target = str(url or "").strip()
    if not target:
        raise ValueError("scrape(url) 需要非空的列表页 URL")
    host = (urllib.parse.urlsplit(target).hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ValueError(f"URL 主机名不属于瑞康医药站点: {host}")

    html = http_get(target)
    newslist = extract_newslist(html)

    items = []
    for it in newslist:
        title = (it.get("name") or "").strip()
        if not title:
            continue
        try:
            body_html = decode_body_html(it.get("htmlContent"))
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"正文 base64 解码失败（标题: {title[:50]}）: {e}") from e
        content = absolutize_images(body_html, target)
        items.append({
            "title": title,
            "date": normalize_date(it.get("pubdate")),
            "url": target,
            "summary": make_summary(html_to_text(content)),
            "content": content,
        })
    return items


# --------------------------------------------------------------------------
# 独立测试（不影响 scrape(url) 入口）
# --------------------------------------------------------------------------
if __name__ == "__main__":
    import sys

    test_url = sys.argv[1] if len(sys.argv) > 1 else REALCAN_PAGE
    rows = scrape(test_url)
    print(f"共 {len(rows)} 条")
    for r in rows[:10]:
        imgs = len(re.findall(r"<img\b", r["content"], re.I))
        print(f"[{r['date']}] {r['title']}")
        print(f"    摘要: {r['summary'][:60]}")
        print(f"    正文长度: {len(r['content'])} 字符, 含图片 {imgs} 张")
    if len(rows) > 10:
        print(f"... 其余 {len(rows) - 10} 条")
