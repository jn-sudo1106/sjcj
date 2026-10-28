from typing import Optional


class TableContainerSelector:
    """参考 ExtractDataTableAction：按 table 的有效数据行选择容器和样本。"""

    @staticmethod
    def select(page) -> Optional[dict]:
        result = page.evaluate(r"""
            () => {
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

                const urlValue = row => {
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
                const candidates = [];
                for (const body of document.querySelectorAll('table > tbody')) {
                    const excludedRegion = (() => {
                        let current = body;
                        for (let depth = 0; current && depth < 7;
                             depth++, current = current.parentElement) {
                            const tag = String(current.tagName || '').toLowerCase();
                            const semantic = `${String(current.className || '')} ${String(current.id || '')}`
                                .toLowerCase();
                            if (tag === 'footer' ||
                                /(?:^|[\s_-])(?:footer|foot|friend[_-]?link|links?)(?:[\s_-]|$)/i.test(semantic)) {
                                return true;
                            }
                        }
                        return false;
                    })();
                    if (excludedRegion) continue;
                    const rows = [...body.children].filter(row => row.tagName === 'TR');
                    const validRows = rows.filter(row => {
                        const text = String(row.innerText || row.textContent || '')
                            .replace(/\s+/g, ' ').trim();
                        return text.length >= 4 && row.querySelector('td,th') && Boolean(urlValue(row));
                    });
                    if (validRows.length < 3) continue;
                    const urls = validRows.map(urlValue).filter(Boolean);
                    if (new Set(urls).size < 2) continue;
                    // 表格行后续只能作为当前站点的新闻详情记录。政府网站、
                    // 媒体网站、友情链接等跨站目录表即使 URL 各不相同，也
                    // 不能抢在真实普通新闻列表之前成为 TABLE 容器。
                    const baseHost = String(location.hostname || '').toLowerCase()
                        .replace(/^www\./, '');
                    const sameSiteCount = urls.filter(value => {
                        try {
                            const host = new URL(value, document.baseURI).hostname
                                .toLowerCase().replace(/^www\./, '');
                            return host === baseHost || host.endsWith('.' + baseHost) ||
                                baseHost.endsWith('.' + host);
                        } catch (_) {
                            return false;
                        }
                    }).length;
                    if (sameSiteCount / urls.length < 0.5) continue;
                    const dateCount = validRows.filter(row =>
                        /(?:19|20)\d{2}[年/.\-]\s*\d{1,2}(?:[月/.\-]\s*\d{1,2}日?)?/.test(
                            String(row.innerText || row.textContent || '')
                        )
                    ).length;
                    const headingCount = validRows.filter(row =>
                        row.querySelector('h1,h2,h3,h4,h5,h6')
                    ).length;
                    candidates.push({
                        containerXpath: absoluteXpath(body),
                        sampleXpath: absoluteXpath(validRows[0]),
                        itemCount: validRows.length,
                        totalRows: rows.length,
                        dateRatio: dateCount / validRows.length,
                        headingRatio: headingCount / validRows.length,
                    });
                }
                candidates.sort((a, b) =>
                    b.itemCount - a.itemCount || b.dateRatio - a.dateRatio ||
                    b.headingRatio - a.headingRatio
                );
                return candidates[0] || null;
            }
        """)
        return result if result and result.get("sampleXpath") else None
