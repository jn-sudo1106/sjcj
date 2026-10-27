from typing import List

from core.container_selector import ContainerSelection


class TableXPathDeriver:
    """第二阶段（TABLE）：按有效 tr 数据行推导 XPath。"""

    @staticmethod
    def derive(page, selection: ContainerSelection) -> List[str]:
        result = page.evaluate(r"""
            args => {
                const byXpath = xpath => document.evaluate(
                    xpath.startsWith('/') ? xpath : '/' + xpath,
                    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue;
                const absoluteXpath = element => {
                    if (!element || element.nodeType !== 1) return '';
                    if (element === document.documentElement) return 'html[1]';
                    let index = 1;
                    for (let prev = element.previousElementSibling; prev; prev = prev.previousElementSibling) {
                        if (prev.tagName === element.tagName) index++;
                    }
                    return absoluteXpath(element.parentElement) + '/' +
                        element.tagName.toLowerCase() + '[' + index + ']';
                };
                const isUrlLikeValue = (val, attrName) => {
                    if (!val || typeof val !== 'string') return false;
                    val = val.trim();
                    if (val.length < 3 || val.length > 2000) return false;
                    if (attrName === 'onclick') {
                        return /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i.test(val) ||
                               /(?:window\.)?open\s*\(\s*['"]([^'"]+)['"]/i.test(val) ||
                               /https?:\/\//i.test(val);
                    }
                    if (/^https?:\/\//i.test(val)) return true;
                    if (/^(?:\/|\.\/|\.\.\/|[a-zA-Z0-9_\-]+\/)/.test(val)) {
                        if (/\.(?:html?|php|jsp|asp|aspx|shtml|json)$/i.test(val) ||
                            /(?:news|article|detail|content|info|view|post|page|id=|\?)/i.test(val)) {
                            return true;
                        }
                    }
                    return false;
                };

                const getUrlAttribute = node => {
                    if (!node || !node.attributes) return null;
                    const priority = ['onclick', 'data-url', 'data-href', 'data-link', 'url', 'link', 'to', 'target-url', 'go'];
                    for (const attr of priority) {
                        const val = String(node.getAttribute(attr) || '').trim();
                        if (val && isUrlLikeValue(val, attr)) return { attr, value: val };
                    }
                    const excludeAttrs = new Set(['class', 'style', 'id', 'type', 'title', 'alt', 'width', 'height', 'src', 'rel', 'target', 'role', 'aria-hidden']);
                    for (const a of Array.from(node.attributes)) {
                        const attrName = a.name.toLowerCase();
                        if (excludeAttrs.has(attrName)) continue;
                        const val = String(a.value || '').trim();
                        if (val && isUrlLikeValue(val, attrName)) return { attr: attrName, value: val };
                    }
                    return null;
                };

                const rowUrl = row => {
                    const anchor = [...row.querySelectorAll('a[href]')].find(a => {
                        const href = String(a.getAttribute('href') || '').trim();
                        return href && href !== '#' && !/^javascript:/i.test(href);
                    });
                    if (anchor) return anchor.getAttribute('href') || '';
                    for (const node of [row, ...row.querySelectorAll('*')]) {
                        const res = getUrlAttribute(node);
                        if (!res) continue;
                        if (res.attr !== 'onclick') return res.value;
                        const locationMatch = res.value.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i);
                        if (locationMatch) return locationMatch[1];
                        const openMatch = res.value.match(/(?:window\.)?open\s*\(\s*['"]([^'"]+)['"]/i);
                        if (openMatch) return openMatch[1];
                    }
                    return '';
                };
                const container = byXpath(args.containerXpath);
                if (!container || !['TBODY', 'TABLE'].includes(container.tagName)) return [];
                return [...container.children]
                    .filter(row => row.tagName === 'TR')
                    .filter(row => String(row.innerText || row.textContent || '').trim().length >= 4)
                    .filter(row => row.querySelector('td,th') && Boolean(rowUrl(row)))
                    .map(absoluteXpath).filter(Boolean);
            }
        """, {"containerXpath": getattr(selection, "container_xpath", None) or (selection.get("container_xpath") if isinstance(selection, dict) else None) or (selection.get("containerXpath") if isinstance(selection, dict) else "")})
        return list(result or [])
