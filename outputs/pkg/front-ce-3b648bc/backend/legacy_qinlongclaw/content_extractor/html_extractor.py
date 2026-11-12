# -*- coding: utf-8 -*-
"""HTML 页面正文、标题与发布时间提取器。
整合了基于多类 CMS（Next.js、Nuxt.js、Elementor、WordPress、TRS_WCM、CMS 富文本等）
的提取算法、噪声清洗、双重编码修复、PDF/二进制探测、救援抽取模式，
以及未处理文件检测统计功能（_check_unprocessed）。
"""

import datetime
import html as htmllib
import json
import logging
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

# ---------- 结果扩展名与分类常量 ----------
EXT_TXT = ".txt"    # 成功抽取正文
EXT_WAF = ".waf"    # WAF / 验证码拦截（需重抓）
EXT_OCR = ".ocr"    # 扫描件 PDF（需 OCR）
EXT_IFR = ".ifr"    # iframe 嵌套（需二级抓取）
EXT_BIN = ".bin"    # 二进制非 HTML
EXT_GONE = ".gone"  # 404 / 内容已删除
EXT_EMP = ".emp"    # 其它不可抓取
EXT_META = ".meta"  # 元数据 / 摘要（低正文/富媒体）

RESULT_EXTENSIONS: Tuple[str, ...] = (
    EXT_TXT,
    EXT_WAF,
    EXT_OCR,
    EXT_IFR,
    EXT_BIN,
    EXT_GONE,
    EXT_EMP,
    EXT_META,
)

# ---------- 噪声正则特征 ----------
NOISE_RE = re.compile(
    r"__NUXT__|__NEXT_DATA__|\bwindow\.|document\.|function\s*\(|=>|"
    r"\bvar\s|\bconst\s|\blet\s|jQuery|\$\(|\{|\}|\[\{|\",\"|\\u00|"
    r"Copyright|版权所有|备案号|京ICP|沪ICP|粤ICP|浙ICP|苏ICP|蜀ICP|All Rights Reserved",
    re.IGNORECASE,
)

EXTRA_NOISE_RE = re.compile(
    # 验证页 / 挑战页文案
    r"当前环境异常|完成验证后|轻点两下|取消赞|取消在看|"
    r"请开启JavaScript|浏览器版本过低|"
    # 页脚垃圾
    r"佛祖保佑|永无BUG|Powered\s*by|版权归|All\s*right|"
    # 备案号 / 工商号
    r"工商网监|公网安备|京公网安备|粤B2-|"
    # 页内 UI 元素
    r"打印本页|关闭窗口|返回顶部|扫一扫|"
    # 文章间导航
    r"^上一篇[：:]?|^下一篇[：:]?|^分享到|^关注我们|"
    r"^浏览次数[：:]|^文章作者[：:]|^信息来源[：:]|^责任编辑[：:]",
    re.IGNORECASE | re.MULTILINE,
)

SCRIPT_NOISE_RE = re.compile(
    r"__NUXT__|__NEXT_DATA__|\bwindow\.|document\.|function\s*\(|=>|"
    r"\bvar\s|\bconst\s|\blet\s|jQuery|\$\(|\[\{|\",\"|\\u00",
    re.IGNORECASE,
)

LONG_LINE = 200

WAF_STRONG_RE = re.compile(
    r"aliyun_waf|aliyunwaf|\b_waf\b|renderData|当前环境异常|完成验证后|"
    r"访问被拦截|请完成安全验证|请输入验证码|请点击.*?验证|"
    r"verify\s+you\s+are\s+(?:a\s+)?human|拖动滑块|滑动到最右边",
    re.IGNORECASE,
)

WAF_WEAK_RE = re.compile(
    r"captcha|recaptcha|人机验证|滑动验证|安全验证|行为验证|"
    r"请开启JavaScript|浏览器版本过低",
    re.IGNORECASE,
)

GONE_RE = re.compile(
    r"页面不存在|找不到页面|页面已删除|内容已删除|文章已删除|信息不存在|"
    r"not\s*found|page\s*does\s*not\s*exist|404\s*error",
    re.IGNORECASE,
)

IFRAME_JUNK_RE = re.compile(
    r"visitcount|visit\.jsp|counter|count\.|statistics|/stat/|"
    r"\bads?\b|advert|banner|union\.|alimama|google_ad|"
    r"share|social|weibo|weixin|baidu\.com/s|"
    r"\.js(\?|$)|about:|javascript:|blank\.html",
    re.IGNORECASE,
)

# 可选 PDF 支持
try:
    from pypdf import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False


class HtmlContentExtractor:
    """HTML 正文内容提取核心类。"""

    def __init__(self):
        self.noise_pattern = NOISE_RE

    @staticmethod
    def is_noise_line(line: str) -> bool:
        """判定某行是否为噪声行。对超过 200 字的长行放宽部分关键词过滤以保护正文。"""
        if SCRIPT_NOISE_RE.search(line):
            return True
        if len(line) > LONG_LINE:
            return False
        return bool(NOISE_RE.search(line) or EXTRA_NOISE_RE.search(line))

    @staticmethod
    def fix_mojibake(text: str) -> str:
        """修复双重编码（UTF-8 被误存为 Latin-1 又转回 UTF-8 造成的乱码）。"""
        if not text:
            return ""
        try:
            repaired = text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return text
        cjk_orig = len(re.findall(r"[\u4e00-\u9fff]", text))
        cjk_fix = len(re.findall(r"[\u4e00-\u9fff]", repaired))
        return repaired if cjk_fix > cjk_orig else text

    @classmethod
    def decode_html_bytes(cls, source: Union[bytes, str]) -> str:
        """安全将 HTML 字节流或字符串转为标准 Python 字符串。"""
        if isinstance(source, str):
            return cls.fix_mojibake(source)

        if not isinstance(source, bytes):
            return ""

        # 1. 尝试从 <meta charset="..."> 嗅探编码
        charset_match = re.search(
            rb'''<meta[^>]+(?:charset\s*=\s*["']?([a-zA-Z0-9_-]+)|content\s*=\s*["'][^"']*charset=([a-zA-Z0-9_-]+))''',
            source[:2048],
            re.IGNORECASE,
        )
        detected_charset = None
        if charset_match:
            detected_charset = (
                (charset_match.group(1) or charset_match.group(2))
                .decode("ascii", errors="ignore")
                .strip()
                .lower()
            )

        encodings_to_try = []
        if detected_charset:
            if detected_charset in ("gb2312", "gbk"):
                encodings_to_try.append("gb18030")
            else:
                encodings_to_try.append(detected_charset)

        encodings_to_try.extend(["utf-8", "gb18030", "gbk", "latin-1"])

        for enc in encodings_to_try:
            try:
                decoded = source.decode(enc)
                return cls.fix_mojibake(decoded)
            except (UnicodeDecodeError, LookupError):
                continue

        # 终极回退
        return cls.fix_mojibake(source.decode("utf-8", errors="ignore"))

    @staticmethod
    def strip_tags(s: str) -> str:
        """剥离 HTML 标签并规范化换行符。"""
        s = htmllib.unescape(s or "")
        s = re.sub(r"<[^>]+>", "\n", s)
        s = re.sub(r"\n{2,}", "\n", s)
        return s.strip()

    @staticmethod
    def is_pdf(head_bytes: bytes) -> bool:
        """检测文件头部是否为 PDF"""
        return head_bytes[:5] == b"%PDF-"

    @classmethod
    def is_binary(cls, head_bytes: bytes) -> bool:
        """检测文件是否为非 HTML 的二进制文件"""
        if cls.is_pdf(head_bytes):
            return False
        if b"<html" in head_bytes.lower() or b"<!doctype" in head_bytes.lower():
            return False
        ctrl = sum(1 for b in head_bytes if b < 9 or (13 < b < 32))
        return ctrl > len(head_bytes) * 0.05

    @classmethod
    def read_pdf(cls, path_or_bytes: Union[str, Path, bytes], max_pages: int = 60) -> Tuple[str, str, int]:
        """提取 PDF 文本层。返回 (状态, 文本, 页数)。"""
        if not HAS_PYPDF:
            return "nopypdf", "", 0
        try:
            import io
            if isinstance(path_or_bytes, bytes):
                stream = io.BytesIO(path_or_bytes)
                reader = PdfReader(stream)
            else:
                reader = PdfReader(str(path_or_bytes))
            pages = len(reader.pages)
            chunks = []
            for pg in reader.pages[:max_pages]:
                try:
                    chunks.append(pg.extract_text() or "")
                except Exception:
                    continue
            joined = "\n".join(chunks)
            cjk = len(re.findall(r"[\u4e00-\u9fff]", joined))
            alnum = len(re.findall(r"[A-Za-z0-9]{3,}", joined))
            if cjk >= 30 or alnum >= 100:
                cleaned = cls.clean_lines(joined)
                return "text", cleaned, pages
            return "scan", "", pages
        except Exception:
            return "broken", "", 0

    @classmethod
    def clean_lines(cls, text: str) -> str:
        """按行清洗文本：去噪声、去重复、压缩空白。"""
        out, seen = [], set()
        for ln in text.split("\n"):
            ln = re.sub(r"\s+", " ", ln).strip()
            if len(ln) < 2 or ln in seen:
                continue
            if cls.is_noise_line(ln):
                continue
            seen.add(ln)
            out.append(ln)
        return "\n".join(out)

    @staticmethod
    def extract_iframes(html_text: str) -> List[str]:
        """提取 iframe / frame 外链，过滤广告与计数器。"""
        srcs = []
        for m in re.finditer(
            r"<(?:iframe|frame)\b[^>]*\bsrc=[\"']([^\"']+)[\"']",
            html_text,
            re.IGNORECASE,
        ):
            u = m.group(1).strip()
            if not u or IFRAME_JUNK_RE.search(u):
                continue
            srcs.append(u)
        return srcs

    @staticmethod
    def extract_next_data(html_text: str) -> Optional[dict]:
        """从 Next.js 页面 __NEXT_DATA__ 中提取 article。"""
        m = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
            html_text,
            re.DOTALL,
        )
        if not m:
            return None
        try:
            return json.loads(m.group(1))["props"]["pageProps"]["article"]
        except (KeyError, TypeError, json.JSONDecodeError):
            return None

    @staticmethod
    def extract_generic_body(html_text: str) -> List[str]:
        """通用正文抽取：WordPress/Elementor/普通文章页面。"""
        m = re.search(
            r'elementor-widget-theme-post-content.*?<div class="elementor-widget-container">(.*?)(?:elementor-widget-post-navigation|</section>)',
            html_text,
            re.DOTALL,
        )
        if not m:
            m = re.search(
                r'data-elementor-type="wp-post"(.*?)<footer', html_text, re.DOTALL
            )
        seg = m.group(1) if m else html_text
        seg = re.sub(
            r"<script.*?</script>|<style.*?</style>", "", seg, flags=re.DOTALL
        )
        paras = re.findall(r"<(?:p|h\d)[^>]*>(.*?)</(?:p|h\d)>", seg, re.DOTALL)
        texts = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", p)).strip() for p in paras
        ]
        return [t for t in texts if len(t) > 20]

    @classmethod
    def extract_nuxt_payload(cls, html_text: str) -> Optional[List[str]]:
        """Nuxt SSR payload：正文在 pageData 的 content 字段中。"""
        m = re.search(r'content:"((?:[^"\\]|\\.)*)"', html_text, re.DOTALL)
        if not m:
            return None
        s = m.group(1)
        s = re.sub(
            r"\\u([0-9a-fA-F]{4})", lambda x: chr(int(x.group(1), 16)), s
        )
        s = s.replace('\\"', '"').replace("\\/", "/")
        s = s.replace("\\n", "\n").replace("\\r", "")
        seg = cls.strip_tags(s)
        paras = [re.sub(r"\s+", " ", p).strip() for p in seg.split("\n")]
        return [p for p in paras if len(p) > 15]

    @staticmethod
    def extract_richtext_body(html_text: str) -> List[str]:
        """CMS 页面 e_richText 容器抽取。"""
        m = re.search(
            r'class="e_richText[^"]*"[^>]*>(.*?)<div class="e_container',
            html_text,
            re.DOTALL,
        )
        if not m:
            return []
        seg = re.sub(
            r"<script.*?</script>|<style.*?</style>",
            "",
            m.group(1),
            flags=re.DOTALL,
        )
        paras = re.findall(r"<(?:p|h\d)[^>]*>(.*?)</(?:p|h\d)>", seg, re.DOTALL)
        texts = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", p)).strip() for p in paras
        ]
        return [t for t in texts if len(t) > 5]

    @classmethod
    def extract_block_text(
        cls,
        html_text: str,
        min_cjk: int = 15,
        min_len: int = 20,
        min_ratio: float = 0.2,
    ) -> List[str]:
        """兜底抽取：按块级标签切行后保留中文密度足够高的文本行。"""
        if min_cjk < 15:
            min_cjk, min_len, min_ratio = 8, 10, 0.15
        seg = re.sub(
            r"<script.*?</script>|<style.*?</style>|<head.*?</head>",
            "",
            html_text,
            flags=re.DOTALL | re.IGNORECASE,
        )
        seg = re.sub(
            r"<(?:nav|footer|header)\b.*?</(?:nav|footer|header)>",
            "",
            seg,
            flags=re.DOTALL | re.IGNORECASE,
        )
        seg = re.sub(r"<br\s*/?>", "\n", seg, flags=re.IGNORECASE)
        for tag in (
            "p",
            "div",
            "section",
            "article",
            "li",
            "tr",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "td",
        ):
            seg = re.sub(r"</\s*%s\s*>" % tag, "\n", seg, flags=re.IGNORECASE)
        seg = htmllib.unescape(re.sub(r"<[^>]+>", "", seg))
        lines, seen = [], set()
        for ln in seg.split("\n"):
            ln = re.sub(r"\s+", " ", ln).strip()
            if len(ln) < min_len:
                continue
            cjk = len(re.findall(r"[\u4e00-\u9fff]", ln))
            if cjk < min_cjk or cjk / max(len(ln), 1) < min_ratio:
                continue
            if cls.is_noise_line(ln) or ln in seen:
                continue
            seen.add(ln)
            lines.append(ln)
        return lines

    @classmethod
    def extract_script_payload(
        cls, html_text: str, min_cjk: int = 100
    ) -> List[str]:
        """TRS_WCM、Nuxt/Vue SSR 动态塞入 script 字符串的处理。"""
        best, best_score = [], 0
        for s in re.findall(
            r"<script\b[^>]*>(.*?)</script>",
            html_text,
            re.DOTALL | re.IGNORECASE,
        ):
            if len(re.findall(r"[\u4e00-\u9fff]", s)) < min_cjk:
                continue
            t = s.replace("\\\\u", "\\u").replace('\\\\"', '\\"')
            t = re.sub(
                r"\\u([0-9a-fA-F]{4})",
                lambda x: chr(int(x.group(1), 16)),
                t,
            )
            t = (
                t.replace('\\"', '"')
                .replace("\\/", "/")
                .replace("\\n", "\n")
            )
            t = htmllib.unescape(t)
            if re.search(r"<(?:p|div|span|br)\b", t, re.IGNORECASE):
                lines = cls.extract_block_text(t)
            else:
                lines = [re.sub(r"\s+", " ", x).strip() for x in t.split("\n")]
                lines = [
                    x
                    for x in lines
                    if len(x) >= 20
                    and len(re.findall(r"[\u4e00-\u9fff]", x)) >= 15
                ]
            score = sum(len(re.findall(r"[\u4e00-\u9fff]", x)) for x in lines)
            if score > best_score:
                best, best_score = lines, score
        return best

    @classmethod
    def rescue_body(cls, html_text: str, min_valid_cjk: int = 40) -> Tuple[str, int]:
        """救援抽取：针对正文极短的新闻/摘要页，多路并行抓取并评分。"""
        cands = []
        for fn in (
            cls.extract_generic_body,
            cls.extract_script_payload,
            cls.extract_nuxt_payload,
            cls.extract_richtext_body,
        ):
            try:
                parts = fn(html_text)
            except Exception:
                parts = []
            if parts:
                cands.append("\n".join(parts))

        loose = cls.extract_block_text(html_text, min_cjk=8)
        if loose:
            cands.append("\n".join(loose))

        best, best_score = "", 0
        for c in cands:
            cleaned = "\n".join(l for l in c.split("\n") if not cls.is_noise_line(l))
            s = len(re.findall(r"[\u4e00-\u9fff]", cleaned))
            if s > best_score:
                best, best_score = cleaned, s
        return (best, best_score) if best_score >= min_valid_cjk else ("", 0)

    @staticmethod
    def extract_title_and_date(
        html_text: str,
    ) -> Tuple[Optional[str], Optional[str]]:
        """从 HTML 中解析标题与发布日期。"""
        title = ""
        h1_match = re.search(r"<h1[^>]*>([^<]+)</h1>", html_text, re.IGNORECASE)
        if h1_match:
            title = htmllib.unescape(h1_match.group(1)).strip()

        if not title:
            title_match = re.search(
                r"<title[^>]*>([^<]*)</title>", html_text, re.IGNORECASE
            )
            if title_match:
                full_title = htmllib.unescape(title_match.group(1)).strip()
                clean_t = re.sub(r"[\-_|].*$", "", full_title).strip()
                title = clean_t or full_title

        pub_time = ""
        date_patterns = [
            r'elementor-post-info__item--type-date">\s*<time>([^<]+)</time>',
            r'itemprop="datePublished"[^>]*content="([^"]+)"',
            r'property="article:published_time"[^>]*content="([^"]+)"',
            r"addDate:\"(20\d{2}-\d{2}-\d{2})",
            r"发布时间[：:]\s*(20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)",
            r"发布日期[：:]\s*(20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)",
            r"\b(20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)\b",
            r"\b(20\d{2}/\d{1,2}/\d{1,2})\b",
            r"\b(20\d{2}年\d{1,2}月\d{1,2}日)\b",
        ]
        for pattern in date_patterns:
            m = re.search(pattern, html_text, re.IGNORECASE)
            if m:
                raw_date = m.group(1).strip()
                d_m = re.search(
                    r"(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})", raw_date
                )
                if d_m:
                    y, mon, d = d_m.groups()
                    pub_time = f"{y}-{int(mon):02d}-{int(d):02d}"
                    break
                pub_time = raw_date
                break

        return (title or None, pub_time or None)

    def extract(self, source: Union[str, bytes], url: str = "") -> Dict[str, Any]:
        """核心提取函数：输入 HTML 内容（str 或 bytes），返回包含正文、标题、时间、状态与诊断信息的字典。

        Returns:
            {
                "title": str,
                "report_time": str,
                "content": str,
                "status": str,       # success, waf, ocr, iframe, gone, binary, empty
                "method": str,       # next_data, generic, nuxt, richtext, script_payload, block, rescue, pdf
                "iframes": list,
                "note": str
            }
        """
        head = source[:4096] if isinstance(source, bytes) else source[:4096].encode("utf-8", errors="ignore")
        raw = self.decode_html_bytes(source)

        # 1. 前置文件类型检测
        if self.is_pdf(head):
            status, text, pages = self.read_pdf(source if isinstance(source, bytes) else head)
            if status == "text":
                return {
                    "title": "",
                    "report_time": "",
                    "content": text,
                    "status": "success",
                    "method": "pdf",
                    "iframes": [],
                    "note": f"PDF {pages}页 有文本层",
                }
            return {
                "title": "",
                "report_time": "",
                "content": "",
                "status": "ocr",
                "method": "pdf",
                "iframes": [],
                "note": f"PDF {pages}页 扫描件需OCR",
            }

        if self.is_binary(head):
            return {
                "title": "",
                "report_time": "",
                "content": "",
                "status": "binary",
                "method": "",
                "iframes": [],
                "note": "二进制非HTML",
            }

        if not raw or not raw.strip():
            return {
                "title": "",
                "report_time": "",
                "content": "",
                "status": "empty",
                "method": "",
                "iframes": [],
                "note": "空文件",
            }

        if GONE_RE.search(raw) and len(raw) < 60000:
            return {
                "title": "",
                "report_time": "",
                "content": "",
                "status": "gone",
                "method": "",
                "iframes": [],
                "note": "404/内容已删除",
            }

        title, pub_time, body, method = None, None, None, None
        iframes = self.extract_iframes(raw)

        # 2. 依次尝试各提取路径
        # 0) 微信公众号文章（调用微信解析正式版）
        if (url and "mp.weixin.qq.com" in url.lower()) or (
            "__biz=" in raw and ("var msg_title =" in raw or "window.appuin" in raw or "oriCreateTime" in raw)
        ):
            from .wechat_parser import extract_wechat_html
            wx_res = extract_wechat_html(raw)
            if wx_res.get("content"):
                return {
                    "title": wx_res.get("title", ""),
                    "report_time": wx_res.get("report_time", ""),
                    "content": wx_res.get("content", ""),
                    "status": "success",
                    "method": "wechat_official",
                    "iframes": iframes,
                    "note": f"微信正式版 (type={wx_res.get('content_type', '0')})",
                }

        # 1) Next.js __NEXT_DATA__
        art = self.extract_next_data(raw)
        if art:
            title = (art.get("articleTitle") or art.get("title") or "").strip()
            pub_time = art.get("publishTime") or art.get("publishDate") or ""
            body = self.strip_tags(art.get("contentBody") or "")
            method = "next_data"

        # 2) 通用 HTML 抽取 (WordPress/Elementor/<p>/<h>)
        if not body or len(body) < 50:
            paras = self.extract_generic_body(raw)
            candidate_body = "\n".join(paras)
            if candidate_body and len(candidate_body) >= 50:
                body = candidate_body
                method = "generic"

        # 3) Nuxt SSR payload
        if not body or len(body) < 50:
            nuxt_paras = self.extract_nuxt_payload(raw)
            if nuxt_paras:
                body = "\n".join(nuxt_paras)
                method = "nuxt"

        # 4) CMS e_richText 容器
        if not body or len(body) < 50:
            richtext_paras = self.extract_richtext_body(raw)
            short_body = "\n".join(richtext_paras)
            if short_body and len(short_body) >= 15:
                body = short_body
                method = "richtext"

        # 5) 兜底：块级 div/section 文本与 script 转义 payload 比较
        if not body or len(body) < 50:
            paras = self.extract_block_text(raw)
            script_paras = self.extract_script_payload(raw)
            if sum(len(re.findall(r"[\u4e00-\u9fff]", p)) for p in script_paras) > sum(
                len(re.findall(r"[\u4e00-\u9fff]", p)) for p in paras
            ):
                paras = script_paras
                method = "script_payload"
            else:
                method = "block"
            block_body = "\n".join(paras)
            if block_body and len(block_body) >= 50:
                body = block_body
            else:
                method = None

        # 6) 救援抽取
        if not body or len(body) < 15:
            r_body, r_score = self.rescue_body(raw)
            if r_body:
                body, method = r_body, "rescue"

        # 6.1) 智能容器抽取与中英文启发式救援（支持英文产品/新闻页与容器抽取）
        if not body or len(body) < 15:
            from .article_rescuer import extract_article_from_source
            rescued = extract_article_from_source(source)
            if rescued.get("success") and rescued.get("body"):
                body = rescued["body"]
                method = f"rescuer({rescued.get('method', 'container')})"
                if not title:
                    title = rescued.get("title", "")
                if not pub_time:
                    pub_time = rescued.get("date", "")

        # 7) 噪声清洗
        if body:
            filtered_lines = [
                ln.strip()
                for ln in body.split("\n")
                if ln.strip() and not self.is_noise_line(ln)
            ]
            body = "\n".join(filtered_lines)

        # 抽到的正文若是 WAF 挑战页文案，判为拦截
        if body and WAF_STRONG_RE.search(body) and len(re.findall(r"[\u4e00-\u9fff]", body)) < 60:
            body = ""

        # 提取标题和日期
        if not title or not pub_time:
            gen_title, gen_date = self.extract_title_and_date(raw)
            title = title or gen_title or ""
            pub_time = pub_time or gen_date or ""

        # 成功提取
        if body and len(body) >= 15:
            return {
                "title": title.strip(),
                "report_time": pub_time.strip(),
                "content": body.strip(),
                "status": "success",
                "method": method or "unknown",
                "iframes": iframes,
                "note": f"成功抽取 ({method})",
            }

        # 提取失败原因归类
        cjk = len(re.findall(r"[\u4e00-\u9fff]", raw))
        if WAF_STRONG_RE.search(raw):
            return {
                "title": title,
                "report_time": pub_time,
                "content": "",
                "status": "waf",
                "method": "",
                "iframes": iframes,
                "note": "WAF/验证码拦截(强特征)",
            }
        if WAF_WEAK_RE.search(raw) and cjk < 200:
            return {
                "title": title,
                "report_time": pub_time,
                "content": "",
                "status": "waf",
                "method": "",
                "iframes": iframes,
                "note": f"疑似验证码页(弱特征,中文字数{cjk})",
            }
        if iframes:
            return {
                "title": title,
                "report_time": pub_time,
                "content": "",
                "status": "iframe",
                "method": "",
                "iframes": iframes,
                "note": f"iframe嵌套({len(iframes)}个外链)",
            }

        return {
            "title": title,
            "report_time": pub_time,
            "content": "",
            "status": "empty",
            "method": "",
            "iframes": iframes,
            "note": f"不可抓取(中文{cjk}字)",
        }


# ---------- 未处理文件检查与统计 (_check_unprocessed) ----------

def check_unprocessed(
    directory: Union[str, Path],
    result_exts: Tuple[str, ...] = RESULT_EXTENSIONS,
    output_file: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    """检查目录下所有 .html 文件的处理状态，统计并筛选出未处理的 HTML 列表。

    Args:
        directory: 要扫描的目标目录（如 E:\\qinlongclaw\\txt\\error_html）
        result_exts: 判定已处理的结果后缀元组（默认: .txt, .emp, .waf, .ocr, .ifr, .bin, .gone）
        output_file: 可选，将未处理文件清单写入指定文本文件路径（如 _unprocessed_list.txt）

    Returns:
        {
            "total_html": int,
            "processed_count": int,
            "unprocessed_count": int,
            "unprocessed_files": list[str],
            "html_files": list[str]
        }
    """
    target_dir = Path(directory).resolve()
    if not target_dir.is_dir():
        raise FileNotFoundError(f"目录不存在: {target_dir}")

    all_files = os.listdir(str(target_dir))
    html_files = [f for f in all_files if f.endswith(".html")]

    processed_hashes: Set[str] = set()
    for f in all_files:
        for ext in result_exts:
            if f.endswith(ext):
                base_name = f[:-len(ext)]
                processed_hashes.add(base_name)
                break

    unprocessed = [h for h in html_files if h[:-5] not in processed_hashes]

    summary = {
        "total_html": len(html_files),
        "processed_count": len(processed_hashes),
        "unprocessed_count": len(unprocessed),
        "unprocessed_files": unprocessed,
        "html_files": html_files,
    }

    if output_file:
        out_path = Path(output_file)
        if not out_path.is_absolute():
            out_path = target_dir / out_path
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(f"总HTML文件: {len(html_files)}\n")
            f.write(f"已处理: {len(processed_hashes)}\n")
            f.write(f"未处理HTML: {len(unprocessed)}\n")
            f.write("=" * 50 + "\n")
            for h in unprocessed:
                f.write(h + "\n")

    return summary


def get_unprocessed_html_files(
    directory: Union[str, Path],
    result_exts: Tuple[str, ...] = RESULT_EXTENSIONS,
) -> List[str]:
    """快捷获取目录下所有尚未生成结果文件的 HTML 文件名列表。"""
    res = check_unprocessed(directory, result_exts=result_exts)
    return res["unprocessed_files"]


# 模块级单例
_default_extractor = HtmlContentExtractor()


def extract_from_html(source: Union[str, bytes], url: str = "") -> Dict[str, Any]:
    """快捷调用：从 HTML 提取标题、时间与正文。"""
    return _default_extractor.extract(source, url=url)


def extract_html_content(source: Union[str, bytes], url: str = "") -> Dict[str, Any]:
    """别名：从 HTML 提取标题、时间与正文。"""
    return _default_extractor.extract(source, url=url)
