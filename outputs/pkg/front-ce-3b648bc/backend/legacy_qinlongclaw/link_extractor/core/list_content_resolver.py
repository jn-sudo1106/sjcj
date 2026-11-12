"""Match loaded structured article data to already identified DOM titles."""
import html
import json
import logging
import re
from urllib.parse import urljoin, urlsplit

from lxml import html as lhtml


def normalize(value):
    return re.sub(r'\s+', '', html.unescape(str(value or '')))


def plain_text(value, base_url=''):
    """保留正文顺序，将图片转换为历史 WWIMAGE 标记而非丢弃。"""
    value = html.unescape(value)
    if re.search(r'</?(?:p|div|br|strong|span|section|img|article|h[1-6]|ul|li|table)\b', value, re.I):
        try:
            root = lhtml.fromstring('<div>' + value + '</div>')
            parts = []
            blocks = {'p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'table', 'tr',
                      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'br'}

            def emit(node):
                tag = node.tag.lower() if isinstance(node.tag, str) else ''
                if not tag or tag in {'script', 'style', 'noscript', 'template'}:
                    return
                if tag == 'img':
                    for attr in ('data-src', 'data-original', 'data-lazy-src', 'src'):
                        source = (node.get(attr) or '').strip()
                        if not source:
                            continue
                        source = urljoin(base_url, source)
                        if urlsplit(source).scheme.lower() in {'http', 'https'}:
                            parts.append(f'\n<WWIMAGE>{source}<\\WWIMAGE>\n')
                            break
                    return
                if tag in blocks:
                    parts.append('\n')
                if node.text:
                    parts.append(node.text)
                for child in node:
                    emit(child)
                    if child.tail:
                        parts.append(child.tail)
                if tag in blocks:
                    parts.append('\n')

            emit(root)
            value = ''.join(parts)
        except ValueError:
            pass
    return '\n'.join(line.strip() for line in value.splitlines() if line.strip())


def enrich_content(page, records):
    titles = {normalize(row['Text']): row for row in records}
    base_url = getattr(page, 'url', '')
    base_url = base_url if isinstance(base_url, str) else ''
    candidates = []
    getter = getattr(page, 'get_network_json_responses', None)
    if callable(getter):
        try:
            candidates.extend(x.get('payload') for x in getter())
        except Exception as exc:
            logging.warning('[ContentData] Network responses unavailable: %s', exc)
    # 普通对象只读数据属性；Vue 2 已观察的数据允许读取响应式 getter。
    try:
        candidates.extend(page.evaluate(r'''(expected) => {
            const titles = new Set(expected), found = [], seen = new WeakSet();
            const norm = s => String(s || '').replace(/\s+/g, '');
            let count = 0;
            function walk(obj, depth) {
                if (!obj || typeof obj !== 'object' || depth > 7 || count++ > 30000 ||
                    obj === window || obj instanceof Node || seen.has(obj)) return;
                seen.add(obj);
                let descriptors;
                try { descriptors = Object.getOwnPropertyDescriptors(obj); } catch (_) { return; }
                const observer = descriptors.__ob__ && descriptors.__ob__.value;
                const observedValue = observer && Object.getOwnPropertyDescriptor(observer, 'value');
                const reactive = !!(observedValue && observedValue.value === obj);
                const row = {}, children = [];
                for (const [key, descriptor] of Object.entries(descriptors)) {
                    let v;
                    if ('value' in descriptor) v = descriptor.value;
                    else if (reactive && descriptor.enumerable && typeof descriptor.get === 'function') {
                        try { v = descriptor.get.call(obj); } catch (_) { continue; }
                    } else continue;
                    if (typeof v === 'string' && v.length < 2000000) row[key] = v;
                    if (key !== '__ob__') children.push(v);
                }
                if (Object.values(row).some(v => titles.has(norm(v)))) found.push(row);
                for (const child of children) walk(child, depth + 1);
            }
            // 从当前 frame 的 Vue 挂载点优先读取，避免全局对象遍历耗尽预算。
            for (const el of Array.from(document.querySelectorAll('*')).slice(0, 10000)) {
                for (const key of ['__vue__', '__vueParentComponent']) {
                    const d = Object.getOwnPropertyDescriptor(el, key);
                    if (d && 'value' in d) walk(d.value, 0);
                }
            }
            for (const d of Object.values(Object.getOwnPropertyDescriptors(window))) {
                if ('value' in d) walk(d.value, 0);
            }
            for (const s of document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')) {
                try { walk(JSON.parse(s.textContent), 0); } catch (_) {}
            }
            return found;
        }''', list(titles)) or [])
    except Exception as exc:
        logging.warning('[ContentData] Loaded page objects unavailable: %s', exc)

    content_keys = ('fullcontent', 'articlebody', 'bodyhtml', 'contenthtml',
                    'newscontent', 'articlecontent', 'detailcontent', 'body', 'content', 'contents')
    title_keys = ('title', 'newstitle', 'articletitle', 'headline', 'subject', 'name')
    best = {}
    remaining = 50000

    def walk(value, depth=0):
        nonlocal remaining
        remaining -= 1
        if remaining < 0 or depth > 12:
            return
        if isinstance(value, str) and value.lstrip().startswith(('{', '[')):
            try:
                walk(json.loads(value), depth + 1)
            except ValueError:
                pass
        elif isinstance(value, list):
            for child in value:
                walk(child, depth + 1)
        elif isinstance(value, dict):
            fields = {re.sub('[^a-z0-9]', '', k.lower()): v for k, v in value.items()}
            key = next((normalize(fields[k]) for k in title_keys
                        if k in fields and normalize(fields[k]) in titles), '')
            if key:
                for field in content_keys:
                    raw = fields.get(field)
                    if isinstance(raw, str) and raw.strip():
                        body = plain_text(raw, base_url)
                        if not body or normalize(body) == key:
                            continue
                        if normalize(body) != key and len(body) > len(best.get(key, '')):
                            best[key] = body
                        break
            for child in value.values():
                walk(child, depth + 1)

    for candidate in candidates:
        walk(candidate)
    for row in records:
        body = best.get(normalize(row['Text']))
        if body:
            row['Content'] = body
    logging.info('[ContentData] Matched full text for %s/%s titles', len(best), len(records))
    return records
