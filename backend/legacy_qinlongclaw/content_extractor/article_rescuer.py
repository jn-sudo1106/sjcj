# -*- coding: utf-8 -*-
"""article_rescuer.py — 从 HTML 抽取文章正文（支持中文、英文、container容器与多重编码修复）。"""

from __future__ import annotations

import html as ihtml
import os
import re
from typing import Any, Dict, Tuple, Union

# ============================ 文本与编码工具 ============================

CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN_WORD = re.compile(r"[A-Za-z]{2,}")

COMMON_CHINESE = set(
    "的一是不了在人有我他这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感"
)
CHINESE_PUNCT = set("，。！？；：、“”‘’《》（）—…·")

PROMO_PAT = re.compile(
    r"(在公众号小说中沉浸阅读|在小说阅读器读本章|沉浸阅读|预览时标签不可点|"
    r"扫一扫|点击上方|关注我们|点赞|点在看|分享到|阅读原文|下一篇|上一篇|返回顶部|"
    r"百度网盘|免费高速下载|高速下载|提取码|下载APP|登录|注册|立即下载|"
    r"版权所有|ICP备|免责声明|友情链接|网站地图|隐私政策|使用条款|Cookie|cookie|"
    r"广告|Advertisement|Sponsored|举报|版权归|京公网安备|技术支持|"
    r"^(首页|关于我们|联系我们|加入我们|新闻中心|产品中心|人才招聘|English|中文|EN|详情|更多)$|"
    r"^[>»←→\-\|\s]+$)"
)

BLOCK_END = re.compile(
    r"</(p|div|section|article|li|tr|h[1-6]|blockquote|td|table|ul|ol|dl|dd|dt)\s*>|<br\s*/?>|<hr\s*/?>",
    re.I,
)

NAV_HINT = re.compile(
    r"(当前位置|首页\s*>|您的位置|返回列表|>>|关于我们|投资者关系|新闻中心|产品中心|人才招聘|"
    r"网站地图|友情链接|-监管部门-|-友情链接-|-证券媒体-|-行业门户-|请求信息|E-mail\s*[:：]|"
    r"浏览新闻中心|MORE STORIES|返回全部新闻)"
)
FOOTER_HINT = re.compile(
    r"(电话|邮箱|传真|地址|热线|Copyright|COPYRIGHT|ICP备|公网安备|版权所有|Company Hotline|Fax|Email|Address|Compliance)"
)
BOILER_LINE = re.compile(
    r"^(返回|更多|上一篇|下一篇|分享|打印|关闭|首页|导航|公司简介|联系我们|About Us|Contact Us|"
    r"Company News|Company Profile|Menu|Home|Copyright|ICP|©)"
    r"|(E-mail\s*[:：]|@\w+\.\w+|^\d{3,4}-\d{7,8}|^\+86|热线|传真|Address\s*[:：]|Hotline)"
    r"|^[\d\-\s()+（）]{7,}$"
)
SECTION_TITLE = re.compile(
    r"(股份有限公司$|有限公司$|集团$|新闻动态$|公司公告$|公司新闻$|财务报告$|投资者保护$|"
    r"环境信息$|产品中心|资讯中心|新闻中心$)"
)


def cjk_count(s: str) -> int:
    return len(CJK.findall(s))


def latin_words(s: str) -> int:
    return len(LATIN_WORD.findall(s))


def real_chinese_score(s: str) -> float:
    c = CJK.findall(s)
    if not c:
        return 0.0
    good = sum(1 for ch in c if ch in COMMON_CHINESE)
    punct = sum(1 for ch in s if ch in CHINESE_PUNCT)
    return (good + punct) / max(1, len(c) + punct)


def _plain(s: str) -> str:
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    s = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", s, flags=re.S | re.I)
    return re.sub(r"<[^>]+>", " ", s)


def _text_score(t: str) -> float:
    return real_chinese_score(t) * 1000 + cjk_count(t) / 1000.0


def score(t: str) -> float:
    return cjk_count(t) + int(latin_words(t) * 1.6)


def decode_best(raw_b: bytes) -> Tuple[str, str]:
    cands = []
    for enc, err in (("utf-8", "strict"), ("gb18030", "strict"), ("utf-8", "replace")):
        try:
            s = raw_b.decode(enc, errors=err)
        except Exception:
            continue
        cands.append((_text_score(_plain(s)), enc + ("" if err == "strict" else "!"), s))
    if not cands:
        return raw_b.decode("utf-8", errors="replace"), "utf-8-replace"
    cands.sort(key=lambda x: -x[0])
    return cands[0][2], cands[0][1]


def repair_once(s: str, mode: str) -> str:
    if mode == "latin-utf8":
        return s.encode("latin-1").decode("utf-8")
    if mode == "latin-gb":
        return s.encode("latin-1").decode("gb18030")
    if mode == "gbk-utf8":
        return s.encode("gbk").decode("utf-8")
    return s.encode("gb18030").decode("utf-8")


def repair_deep(s: str, max_depth: int = 3) -> str:
    best, seen, frontier = s, {s}, [s]
    for _ in range(max_depth):
        nxt = []
        for cur in frontier:
            for mode in ("latin-utf8", "latin-gb", "gbk-utf8", "gbk-gb"):
                try:
                    v = repair_once(cur, mode)
                except Exception:
                    continue
                if v in seen:
                    continue
                seen.add(v)
                nxt.append(v)
                if _text_score(v) > _text_score(best):
                    best = v
        if real_chinese_score(best) >= 0.15:
            break
        frontier = nxt[:4]
        if not frontier:
            break
    return best


def html_to_text(s: str) -> str:
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    s = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", s, flags=re.S | re.I)
    s = BLOCK_END.sub("\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = ihtml.unescape(s)
    s = re.sub(r"[ \t\u00a0\u3000]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s)
    return s.strip()


def strip_tags(s: str) -> str:
    return html_to_text(s)


def clean_lines(txt: str, drop_short: int = 6) -> str:
    out = []
    for ln in txt.split("\n"):
        ln = ln.strip()
        if len(ln) < drop_short or PROMO_PAT.search(ln):
            continue
        out.append(ln)
    seen, res = set(), []
    for ln in out:
        if ln in seen:
            continue
        seen.add(ln)
        res.append(ln)
    return "\n".join(res)


def paired_div(raw: str, start: int) -> str:
    depth, pos = 1, 0
    for m in re.finditer(r"</?div\b", raw[start:]):
        if m.group(0) == "<div":
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                pos = m.start()
                break
    return raw[start : start + pos] if pos else raw[start : start + 2000000]


# ============================ 正文抽取策略 ============================

def extract_content_candidates(raw: str) -> Tuple[str, str]:
    r = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    r = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", r, flags=re.S | re.I)
    cands = []

    # A. <p> 段落集合
    ps = [strip_tags(x) for x in re.findall(r"<p\b[^>]*>(.*?)</p>", r, flags=re.S | re.I)]
    if ps:
        t = clean_lines("\n".join(ps), drop_short=20)
        if t:
            cands.append((score(t), t, "p_tags"))

    # B. 常见正文容器
    for cm in re.finditer(
        r'<(div|section|article|td)[^>]*(?:class|id)="[^"]*(article|content|detail|news|post|entry|txt|body|main)[^"]*"[^>]*>',
        r,
        re.I,
    ):
        seg = paired_div(r, cm.end()) if cm.group(1) == "div" else r[cm.end() : cm.end() + 300000]
        ctx = r[max(0, cm.start() - 200) : cm.start() + 200].lower()
        if any(k in ctx for k in ("nav", "menu", "footer", "header", "sidebar", "banner", "ad-")):
            continue
        t = clean_lines(strip_tags(seg))
        if t:
            cands.append((score(t) * 0.95, t, "container"))

    # D. 全文可见文字（兜底）
    body = re.sub(r"<(nav|header|footer|aside)\b.*?</\1>", " ", r, flags=re.S | re.I)
    t_all = clean_lines(strip_tags(body), drop_short=12)
    if t_all:
        cands.append((score(t_all) * 0.7, t_all, "full_visible"))

    if not cands:
        return "", "none"
    cands.sort(key=lambda x: -x[0])
    return cands[0][1], cands[0][2]


def extract_smart(raw_b: bytes) -> Tuple[str, str]:
    s, _enc = decode_best(raw_b)
    t, m = extract_content_candidates(s)
    if real_chinese_score(t) >= 0.15 or cjk_count(t) < 80:
        return t, m
    fixed = repair_deep(s)
    if fixed != s:
        t2, m2 = extract_content_candidates(fixed)
        if _text_score(t2) > _text_score(t):
            return t2, m2 + "+deepfix"
    return t, m


def looks_binary(raw_b: bytes) -> bool:
    if raw_b[:8].startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF8", b"BM", b"%PDF")):
        return True
    if len(re.findall(rb"[\x00-\x08\x0e-\x1f]", raw_b[:20000])) > 500:
        return True
    if raw_b.count(b"\xef\xbf\xbd") > 100:
        return True
    return False


def classify(txt: str, title: str = "") -> str:
    lines = [l.strip() for l in txt.split("\n") if l.strip()]
    if not lines:
        return "thin"
    longest = max(len(l) for l in lines)
    cjk, words = cjk_count(txt), latin_words(txt)
    punct = sum(1 for ch in txt if ch in "，。！？；：、“”‘’《》（）—…·")
    pr = punct / max(1, cjk)
    if lines[0].startswith(("{", "[", "/*", "!function", "(function", "var ")) or txt.lstrip()[:2] in ('{"', "[{"):
        return "json_js"
    footer_lines = sum(1 for l in lines if FOOTER_HINT.search(l))
    if cjk < 150 and footer_lines >= max(3, len(lines) * 0.5):
        return "footer_page"
    if cjk < 400 and footer_lines >= 3 and len(lines) < 60:
        return "footer_page"
    nav_lines = sum(1 for l in lines if NAV_HINT.search(l))
    if len(lines) >= 12 and longest < 60 and pr < 0.03:
        return "nav_list"
    if nav_lines >= 4 and longest < 90 and pr < 0.045:
        return "nav_list"
    if longest < 55 and pr < 0.02 and cjk < 300:
        return "nav_list"
    if len(lines) >= 20 and sum(len(l) for l in lines) / len(lines) < 55 and cjk < 300 and words > 100:
        return "nav_list"
    if cjk >= 100 or words >= 60:
        if title and SECTION_TITLE.search(title.strip()) and cjk < 900:
            listish = sum(1 for l in lines if re.search(r"[\[【（(]?20\d{2}[-/年.]\d{1,2}", l))
            if listish >= 2 or len(lines) >= 8:
                return "nav_list"
        return "article"
    return "thin"


def is_bad_title(t: str) -> bool:
    if not t or len(t.strip()) < 6:
        return True
    if re.match(r"^[\d\s\-+()（）]+$", t):
        return True
    if re.search(r"(400-|E-mail|Hotline|Copyright|©|ICP备)", t, re.I):
        return True
    if re.search(r"Ã|å|æ|ç|è|é|ï¼|â", t):
        return True
    return False


def repair_title(t: str) -> str:
    if not re.search(r"Ã|å|æ|ç|è|é|â", t):
        return t
    for mode in ("latin-utf8", "latin-gb"):
        try:
            rt = repair_once(t, mode)
            if rt and not re.search(r"Ã|å|æ|ç|è|é|â", rt):
                return rt
        except Exception:
            pass
    return t


def get_title(raw: str, txt: str) -> str:
    cands = []
    m = re.search(r'property="og:title" content="([^"]*)"', raw)
    if m:
        cands.append(ihtml.unescape(m.group(1)).strip())
    m = re.search(r"<h1[^>]*>(.*?)</h1>", raw, re.S | re.I)
    if m:
        cands.append(re.sub(r"\s+", " ", strip_tags(m.group(1))).strip())
    m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    if m:
        cands.append(ihtml.unescape(m.group(1)).strip())
    for t in cands:
        t = repair_title(t)
        t = re.sub(r"\s*[-_|]\s*新闻中心.*$", "", t).strip()
        if not is_bad_title(t):
            return t
    return cands[0] if cands else ""


def derive_title(txt: str, title: str) -> str:
    if not is_bad_title(title):
        return title
    for l in txt.split("\n"):
        l = l.strip()
        if len(l) < 12 or BOILER_LINE.search(l) or is_bad_title(l):
            continue
        return l[:120]
    return title


def get_date(raw: str, txt: str) -> str:
    def sane(y: Any, m: Any, d: Any) -> str:
        try:
            y, m, d = int(y), int(m), int(d)
        except Exception:
            return ""
        if 2023 <= y <= 2027 and 1 <= m <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{m:02d}-{d:02d}"
        return ""

    for src in (txt[:3000], raw[:40000]):
        m = re.search(
            r"(?:发布时间|更新时间|发布日期|时间)\s*[:：]?\s*(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})",
            src,
        )
        if m:
            v = sane(*m.groups())
            if v:
                return v
    m = re.search(r"(20\d{2})/(\d{1,2})/(\d{1,2})", txt[:1500])
    if m:
        v = sane(*m.groups())
        if v:
            return v
    m = re.search(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", txt[:200])
    if m:
        v = sane(*m.groups())
        if v:
            return v
    return ""


def trim_boilerplate(txt: str, title: str = "") -> str:
    keep = []
    for l in (x.strip() for x in txt.split("\n")):
        if len(l) < 8 or BOILER_LINE.search(l):
            continue
        keep.append(l)
    out, seen_title = [], False
    for l in keep:
        if title and l.replace(" ", "") == title.replace(" ", ""):
            if seen_title:
                continue
            seen_title = True
        out.append(l)
    return "\n".join(out)


# ============================ 核心对外接口 ============================

def extract_article_from_source(source: Union[str, bytes]) -> Dict[str, Any]:
    """统一入参接口：输入 str 或 bytes，返回结构化抽取结果字典。"""
    if isinstance(source, bytes):
        raw_b = source
        raw, _ = decode_best(raw_b)
    else:
        raw = str(source or "")
        raw_b = raw.encode("utf-8", errors="ignore")

    if looks_binary(raw_b):
        return {
            "success": False,
            "title": "",
            "date": "",
            "body": "",
            "method": "",
            "kind": "binary",
            "reason": "二进制/图片文件",
        }

    txt, method = extract_smart(raw_b)
    title0 = get_title(raw, txt)
    kind = classify(txt, title0)
    if kind != "article":
        return {
            "success": False,
            "title": title0,
            "date": "",
            "body": txt,
            "method": method,
            "kind": kind,
            "reason": f"类型={kind}",
        }

    title = derive_title(txt, title0)
    date = get_date(raw, txt)
    body = trim_boilerplate(txt, title)
    if cjk_count(body) < 80 and latin_words(body) < 50:
        return {
            "success": False,
            "title": title,
            "date": date,
            "body": body,
            "method": method,
            "kind": "thin",
            "reason": "正文太短",
        }

    return {
        "success": True,
        "title": title,
        "date": date,
        "body": body,
        "method": method,
        "kind": "article",
        "reason": "",
    }
