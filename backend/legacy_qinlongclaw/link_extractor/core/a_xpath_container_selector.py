import logging
import time
import urllib.parse
from typing import Optional


class AXPathContainerSelector:
    """根据页面 A 节点的 Full XPath 规律选择新闻列表容器。"""

    @staticmethod
    def select(page, excluded_container_xpaths=()) -> Optional[dict]:
        """
        返回可信的有 A 列表容器 Full XPath；没有时返回 None。

        核心证据：
        1. 容器至少有 3 个有序直属项。
        2. 同一 A 相对 XPath 覆盖至少 60% 直属项。
        3. 该路径最终取得的 URL 必须逐项唯一；原始 URL 重复时可用稳定文章 ID 拼接。
        4. title/des/more 等字段并列的单条记录容器直接排除。
        5. 硬校验后先选择有序直属项更多的候选。
        """
        result = page.evaluate(r"""
            (excludedXpaths) => {
                const excludedContainerXpaths = new Set(excludedXpaths || []);
                // 部分旧站会把第三方地图构造器直接挂到 window.Map，覆盖原生
                // ES Map。此选择器大量依赖 Map#values/entries；若继续使用页面
                // 全局对象，会在候选收集途中抛错并被上层表现为“没有容器”。
                // 从一个同源空白 iframe 取得未被站点脚本污染的原生构造器。
                const NativeCollections = (() => {
                    const frame = document.createElement('iframe');
                    frame.style.display = 'none';
                    (document.documentElement || document.body).appendChild(frame);
                    const mapConstructor = frame.contentWindow && frame.contentWindow.Map;
                    const setConstructor = frame.contentWindow && frame.contentWindow.Set;
                    frame.remove();
                    if (typeof mapConstructor !== 'function' ||
                        typeof mapConstructor.prototype.values !== 'function' ||
                        typeof setConstructor !== 'function' ||
                        typeof setConstructor.prototype.values !== 'function') {
                        throw new Error('无法取得浏览器原生 Map/Set 构造器');
                    }
                    return {Map: mapConstructor, Set: setConstructor};
                })();
                const NativeMap = NativeCollections.Map;
                const NativeSet = NativeCollections.Set;

                function absoluteXpath(element) {
                    if (!element || element.nodeType !== 1) return '';
                    if (element === document.documentElement) return 'html[1]';
                    if (element === document.body) return 'html[1]/body[1]';
                    const tag = element.tagName.toLowerCase();
                    const validXpathName = /^[a-z_][a-z0-9_.-]*$/i.test(tag);
                    let index = 1;
                    for (let prev = element.previousElementSibling; prev; prev = prev.previousElementSibling) {
                        if (validXpathName) {
                            if (prev.tagName === element.tagName) index++;
                        } else {
                            // 非法 HTML（如 <divstyle="...">）可能产生不能直接写入
                            // XPath 的 tagName；此时用全部元素兄弟中的通配符序号。
                            index++;
                        }
                    }
                    return absoluteXpath(element.parentElement) + '/' +
                        (validXpathName ? tag : '*') + '[' + index + ']';
                }

                function relativeXpath(root, node) {
                    if (node === root) return '.';
                    const parts = [];
                    let current = node;
                    while (current && current !== root) {
                        let index = 1;
                        for (let prev = current.previousElementSibling; prev; prev = prev.previousElementSibling) {
                            if (prev.tagName === current.tagName) index++;
                        }
                        parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
                        current = current.parentElement;
                    }
                    return current === root ? './' + parts.join('/') : '';
                }

                function structurallyPresent(element) {
                    for (let current = element; current; current = current.parentElement) {
                        if (getComputedStyle(current).display === 'none') return false;
                    }
                    const style = getComputedStyle(element);
                    if (style.display === 'none') return false;
                    const rect = element.getBoundingClientRect();
                    return (rect.width > 0 && rect.height > 0) ||
                        Boolean(String(element.textContent || '').trim() || element.querySelector('a[href]'));
                }

                function isUrlLikeValue(val, attrName) {
                    if (!val || typeof val !== 'string') return false;
                    val = val.trim();
                    if (val.length < 3 || val.length > 2000) return false;
                    if (attrName === 'onclick') {
                        return /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i.test(val) ||
                               /(?:window\.)?open\s*\(\s*['"]([^'"]+)['"]/i.test(val) ||
                               /https?:\/\//i.test(val);
                    }
                    if (/^(?:javascript|data|about|tel|mailto):/i.test(val) || val === '#') return false;
                    if (/^https?:\/\//i.test(val) || /^\/\//.test(val)) return true;
                    // 支持 info.aspx?t=23&ContentID=119 这类不带目录前缀的
                    // 相对文件 URL；查询串和 hash 必须允许出现在扩展名之后。
                    if (/^(?:\.\.?\/|\/)?[^\s?#<>"']+\.(?:html?|shtml|php|jsp|jspx|asp|aspx)(?:[?#].*)?$/i.test(val)) {
                        return true;
                    }
                    if (/^(?:\/|\.\/|\.\.\/|[a-zA-Z0-9_\-]+\/)/.test(val) &&
                        /(?:news|article|detail|content|info|view|post|page|(?:^|[?&])(?:id|\w+id)=|\?)/i.test(val)) {
                        return true;
                    }
                    return false;
                }

                function getUrlAttribute(node) {
                    if (!node || !node.attributes) return null;
                    const priority = ['onclick', 'data-url', 'data-href', 'data-link', 'url', 'link', 'to', 'target-url', 'go'];
                    let found = null;
                    for (const attr of priority) {
                        const val = String(node.getAttribute(attr) || '').trim();
                        if (val && isUrlLikeValue(val, attr)) { found = { attr, value: val }; break; }
                    }
                    if (!found) {
                        const excludeAttrs = new NativeSet(['class', 'style', 'id', 'type', 'title', 'alt', 'width', 'height', 'src', 'rel', 'target', 'role', 'aria-hidden']);
                        for (const a of Array.from(node.attributes)) {
                            const attrName = a.name.toLowerCase();
                            if (excludeAttrs.has(attrName)) continue;
                            const val = String(a.value || '').trim();
                            if (val && isUrlLikeValue(val, attrName)) { found = { attr: attrName, value: val }; break; }
                        }
                    }
                    if (found && found.attr !== 'onclick') {
                        const dataId = String(node.getAttribute('data-id') || node.getAttribute('data-item-id') || node.getAttribute('data-artid') || node.getAttribute('data-news-id') || '').trim();
                        if (dataId && !found.value.includes(dataId) && !found.value.includes('id=')) {
                            const sep = found.value.includes('?') ? '&' : '?';
                            found.value = `${found.value}${sep}id=${dataId}`;
                        }
                    }
                    return found;
                }

                const idAttrs = [
                    'data-content-id','data-news-id','data-article-id','data-item-id',
                    'data-artid','content-id','news-id','article-id','data-id','id'
                ];
                const idParam = attr => {
                    const value = String(attr || '').toLowerCase();
                    if (value.includes('content')) return 'contentId';
                    if (value.includes('news')) return 'newsId';
                    if (value.includes('article') || value.includes('artid')) return 'articleId';
                    if (value.includes('item')) return 'itemId';
                    return 'id';
                };
                const effectiveUrlValue = (item, rawValue) => {
                    const raw = String(rawValue || '').trim();
                    if (!raw || !item) return raw;
                    for (const candidate of [item, ...item.querySelectorAll('*')]) {
                        for (const attr of idAttrs) {
                            const identifier = String(
                                candidate.getAttribute && candidate.getAttribute(attr) || ''
                            ).trim();
                            if (!identifier || identifier.length > 128 || /\s/.test(identifier)) continue;
                            if (attr === 'id' && !/^(?:\d+|[a-f0-9-]{8,})$/i.test(identifier)) continue;
                            try {
                                const parsed = new URL(raw, document.baseURI || location.href);
                                parsed.searchParams.set(idParam(attr), identifier);
                                return parsed.href;
                            } catch (_) {
                                const sep = raw.includes('?') ? '&' : '?';
                                return raw + sep + idParam(attr) + '=' + encodeURIComponent(identifier);
                            }
                        }
                    }
                    return raw;
                };

                function meaningfulListItem(element) {
                    const text = String(element.innerText || element.textContent || '').trim();
                    if (text) return true;
                    if (element.matches('a[href]') || element.querySelector('a[href]')) return true;
                    return [element, ...element.querySelectorAll('*')].some(node => Boolean(getUrlAttribute(node)));
                }

                function isMoreActionItem(element) {
                    const text = String(element.innerText || element.textContent || '')
                        .replace(/\s+/g, '').replace(/^[+＋>》›»]+|[>》›»]+$/g, '');
                    if (!/^(?:查看更多|查看全部|全部|更多|MORE|VIEWMORE|READMORE)$/i.test(text)) {
                        return false;
                    }
                    const links = element.matches('a[href]')
                        ? [element] : Array.from(element.querySelectorAll('a[href]'));
                    return links.length <= 1;
                }

                function isPaginationItem(element) {
                    const semantic = `${String(element.className || '')} ${String(element.id || '')}`
                        .toLowerCase();
                    if (!/(?:^|[\s_-])(?:page|pager|pagination|pagelist|pagebar)(?:[\s_-]|$)/.test(semantic)) {
                        return false;
                    }
                    const text = String(element.innerText || element.textContent || '')
                        .replace(/\s+/g, '').trim();
                    return !text || /^(?:\d+|[<>«»‹›…\.]+|首页|尾页|上一页|下一页)+$/i.test(text);
                }

                function hasValidAnchor(element) {
                    const anchors = element.matches('a[href]')
                        ? [element] : Array.from(element.querySelectorAll('a[href]'));
                    return anchors.some(anchor => {
                        const href = String(anchor.getAttribute('href') || '').trim();
                        return href && !/^#/.test(href) && !/^javascript:/i.test(href) && !/^(?:tel|mailto):/i.test(href);
                    });
                }

                function hasValidLink(element) {
                    if (hasValidAnchor(element)) return true;
                    return [element, ...element.querySelectorAll('*')].some(node => Boolean(getUrlAttribute(node)));
                }

                function stableItemClass(element) {
                    const ignored = /^(odd|even|show|shown|visible|animated|active|aos-init|aos-animate)$/i;
                    const animation = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
                    const dynamicId = /^(?:post|item|entry|node|news|article|card|e-loop-item)[_-]?[a-zA-Z0-9_-]*\d+[a-zA-Z0-9_-]*$|^(?:news_type|category|cat|tag|term|tax|author|format)[_-]/i;
                    return String(element.className || '').split(/\s+/).filter(Boolean)
                        .filter(cls => !ignored.test(cls) && !animation.test(cls) && !dynamicId.test(cls))
                        .sort().join('.');
                }

                function excludedRegion(element) {
                    // pager/pagination 可能只是新闻容器的 AJAX 加载标识，
                    // 不能仅凭 class 包含该词就排除整个区域。
                    const features = ['header','footer','foot','nav','menu','sidebar',
                        'breadcrumb'];
                    const hasBusinessFeature = root => {
                        const nodes = [root, ...root.querySelectorAll('*')];
                        const semantics = nodes.map(node =>
                            `${String(node.className || '')} ${String(node.id || '')}`.toLowerCase()
                        );
                        const newsCount = semantics.filter(value => /news|article/.test(value)).length;
                        const listCount = semantics.filter(value => /list/.test(value)).length;
                        const contentCount = semantics.filter(value => /content/.test(value)).length;
                        const titleCount = semantics.filter(value => /title|headline|subject/.test(value)).length;
                        const urlBusinessCount = nodes.filter(node =>
                            node.matches && node.matches('a[href],[onclick],[data-url],[data-href]') &&
                            /news|article|content|detail/.test(
                                `${String(node.className || '')} ${String(node.id || '')}`.toLowerCase()
                            )
                        ).length;
                        return newsCount >= 2 || (newsCount >= 1 && listCount >= 1) ||
                            (titleCount >= 2 && contentCount >= 2) || urlBusinessCount >= 2;
                    };
                    if (hasBusinessFeature(element)) return false;
                    const ownText = String(element.innerText || element.textContent || '')
                        .replace(/\s+/g, ' ').trim();
                    // 无 footer class 的旧站常用普通 div 承载版权、备案和技术支持。
                    // 这些组合文案是比 class 更可靠的页脚降级证据。
                    const footerTextHits = [
                        /版权所有/i, /ICP备/i, /公安备案|公网安备/i,
                        /技术支持/i, /copyright/i
                    ].filter(pattern => pattern.test(ownText)).length;
                    if (footerTextHits >= 2) return true;
                    let current = element;
                    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
                        const tag = String(current.tagName || '').toLowerCase();
                        const role = String(current.getAttribute && current.getAttribute('role') || '').toLowerCase();
                        const semantic = `${String(current.className || '').toLowerCase()} ${String(current.id || '').toLowerCase()}`;
                        if (['header','footer','nav','aside'].includes(tag)) return true;
                        if (['navigation','banner','contentinfo'].includes(role)) return true;
                        // news_header、news-nav 等名称描述的是新闻业务区域，不能仅因
                        // 同时含有 header/nav 子串就当成站点页头或导航排除。
                        const isNewsRegion = /(^|[\s_-])news([\s_-]|$)/i.test(semantic);
                        // body/html 上通常挂的是整站主题能力 class（例如 sidebar-narrow），
                        // 它不能证明当前候选容器本身位于侧栏或导航区域。
                        if (!['body','html'].includes(tag) &&
                            !isNewsRegion &&
                            features.some(key => semantic.includes(key))) return true;
                    }
                    return false;
                }

                function insideBottomRegion(element) {
                    for (let current = element, depth = 0;
                         current && depth < 8;
                         current = current.parentElement, depth++) {
                        const tag = String(current.tagName || '').toLowerCase();
                        const semantic = `${String(current.className || '').toLowerCase()} ${String(current.id || '').toLowerCase()}`;
                        if (tag === 'footer' ||
                            /(^|[\s_-])bottom(?:[\s_-]|$)/i.test(semantic)) return true;
                    }
                    return false;
                }

                function insideSiteNavigationRegion(element) {
                    for (let current = element, depth = 0;
                         current && depth < 8;
                         current = current.parentElement, depth++) {
                        const tag = String(current.tagName || '').toLowerCase();
                        const role = String(
                            current.getAttribute && current.getAttribute('role') || ''
                        ).toLowerCase();
                        if (tag === 'nav' || role === 'navigation') return true;
                    }
                    return false;
                }

                function insideInactiveTabPanel(element) {
                    for (let current = element; current; current = current.parentElement) {
                        const semantic = `${String(current.className || '').toLowerCase()} ${String(current.id || '').toLowerCase()}`;
                        if (/formtabcntid|tab[_-]?item/.test(semantic)) {
                            return !/formtabcntidhover|current|active|selected/.test(semantic);
                        }
                    }
                    return false;
                }

                function classSemanticEvidence(container, listItems) {
                    const positive = ['article','news','list','content','items','feed','result'];
                    const evidence = [];
                    let score = 0;
                    let current = container;
                    // 容器自身可能是无 class 的 ul，因此同时读取近层父节点。
                    for (let depth = 0; current && depth < 3; depth++, current = current.parentElement) {
                        const cls = String(current.className || '').trim();
                        const id = String(current.id || '').trim();
                        const semantic = `${cls} ${id}`.toLowerCase();
                        const matched = positive.filter(key => semantic.includes(key));
                        if (matched.length) {
                            const weight = depth === 0 ? 160 : (depth === 1 ? 120 : 50);
                            score += weight + matched.length * 30;
                            evidence.push({depth, tag: current.tagName.toLowerCase(), className: cls, id, matched});
                        }
                    }
                    const itemClasses = new NativeSet(
                        listItems.map(item => String(item.className || '').trim()).filter(Boolean)
                    );
                    for (const cls of itemClasses) {
                        const matched = positive.filter(key => cls.toLowerCase().includes(key));
                        if (matched.length) {
                            score += 80 + matched.length * 20;
                            evidence.push({depth: -1, tag: 'item', className: cls, id: '', matched});
                        }
                    }
                    return {score, evidence};
                }

                function isTwoItemNewsException(container, items) {
                    if (items.length !== 2) return false;
                    let current = container;
                    for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
                        const semantic = `${String(current.className || '')} ${String(current.id || '')}`.toLowerCase();
                        if (/(?:news|xwzx|xw|article|info|dongtai|zixun|gzdt|gsyw|journal|press|activity|huodong|rmhd)/.test(semantic)) return true;
                    }
                    // URL/class 没有新闻关键词时，仍允许“两个不同详情 URL +
                    // 两个不同标题 + 两项均有日期”的结构强证据。三个条件缺一
                    // 不可，避免把两个导航入口当成两条新闻。
                    const rows = items.map(item => {
                        const anchors = (item.matches('a[href]')
                            ? [item] : Array.from(item.querySelectorAll('a[href]'))
                        ).filter(anchor => {
                            const href = String(anchor.getAttribute('href') || '').trim();
                            return href && !/^#/.test(href) && !/^(?:javascript|tel|mailto):/i.test(href);
                        });
                        const titleNode = item.querySelector(
                            'h1,h2,h3,h4,h5,h6,[class*="title" i],[class*="tit" i],[class*="headline" i]'
                        );
                        const title = String(
                            (titleNode && (titleNode.innerText || titleNode.textContent)) ||
                            (anchors[0] && (anchors[0].innerText || anchors[0].textContent)) || ''
                        ).replace(/\s+/g, ' ').trim();
                        const text = String(item.innerText || item.textContent || '');
                        let href = '';
                        try {
                            href = anchors[0]
                                ? new URL(anchors[0].getAttribute('href'), document.baseURI).href
                                : '';
                        } catch (_) {}
                        return {
                            href, title,
                            hasDate: /(?:19|20)\d{2}[年/.\-]\s*\d{1,2}(?:[月/.\-]\s*\d{1,2}日?)?/.test(text)
                        };
                    });
                    return rows.every(row => row.href && row.title.replace(/\s+/g, '').length >= 5 && row.hasDate) &&
                        new NativeSet(rows.map(row => row.href)).size === 2 &&
                        new NativeSet(rows.map(row => row.title)).size === 2;
                }

                function isSingleItemNewsException(container, items) {
                    if (items.length !== 1) return false;
                    const item = items[0];
                    // 单条候选若内部还包着一组逐项带日期的重复节点，它只是
                    // 页面/栏目外壳。不能把外壳中的面包屑 URL、栏目标题和
                    // 内层列表日期拼成一条虚假新闻。
                    const nestedRepeatedNewsList = Array.from(
                        item.querySelectorAll('ul,ol,div,section')
                    ).some(parent => {
                        const children = Array.from(parent.children || [])
                            .filter(child => String(
                                child.innerText || child.textContent || ''
                            ).replace(/\s+/g, ' ').trim().length >= 5);
                        if (children.length < 3) return false;
                        const dated = children.filter(child =>
                            /(?:19|20)\d{2}[年/.\-]\s*\d{1,2}(?:[月/.\-]\s*\d{1,2}日?)?/.test(
                                String(child.innerText || child.textContent || '')
                            )
                        );
                        if (dated.length / children.length < 0.6) return false;
                        const titles = dated.map(child => String(
                            (child.querySelector(
                                'h1,h2,h3,h4,h5,h6,[class*="title" i],a'
                            ) || child).innerText || ''
                        ).replace(/\s+/g, ' ').trim()).filter(value => value.length >= 4);
                        return new NativeSet(titles).size >= Math.min(3, dated.length);
                    });
                    if (nestedRepeatedNewsList) return false;
                    // 单条列表不能用重复结构证明自己，必须同时满足 URL、标题、
                    // 日期和新闻区域四类强证据。不能依赖 title/date class，旧站
                    // 常见的结构只是 <li><a>标题</a><span>日期</span></li>。
                    const regionParts = [];
                    let current = container;
                    for (let depth = 0; current && depth < 5;
                         depth++, current = current.parentElement) {
                        regionParts.push(
                            `${String(current.className || '')} ${String(current.id || '')}`
                        );
                    }
                    const region = regionParts.join(' ').toLowerCase();
                    const pagePath = String(location.pathname || '').toLowerCase();
                    const regionText = String(
                        (container.parentElement && container.parentElement.innerText) || ''
                    ).replace(/\s+/g, ' ').slice(0, 1000);
                    const hasNewsRegion =
                        /(?:news|article|info|list|xw|xinwen|mtbd|gggs|xyxw)/.test(region) ||
                        /(?:news|article|info|list|xw|xinwen|mtbd|gggs|xyxw)/.test(pagePath) ||
                        /新闻|资讯|公告|动态|媒体报道|公司新闻|行业新闻/.test(regionText);
                    if (!hasNewsRegion) return false;

                    const anchors = (item.matches('a[href]')
                        ? [item] : Array.from(item.querySelectorAll('a[href]'))
                    ).filter(anchor => {
                        const href = String(anchor.getAttribute('href') || '').trim();
                        return href && !/^#/.test(href) && !/^(?:javascript|tel|mailto):/i.test(href);
                    });
                    const detailLinks = anchors.map(anchor => ({
                        node: anchor,
                        value: String(anchor.getAttribute('href') || '').trim()
                    }));
                    // 单条新闻与普通候选必须使用同一套 URL 特征。很多旧站
                    // 整个卡片通过 onclick 跳转，并不存在 a[href]。
                    for (const node of [item, ...item.querySelectorAll('*')]) {
                        const urlAttr = getUrlAttribute(node);
                        if (!urlAttr) continue;
                        let value = String(urlAttr.value || '').trim();
                        if (urlAttr.attr === 'onclick') {
                            const matched =
                                value.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ||
                                value.match(/(?:window\.)?open\s*\(\s*['"]([^'"]+)['"]/i);
                            value = matched ? matched[1] : '';
                        }
                        if (value) detailLinks.push({node, value});
                    }
                    const validDetailLinks = detailLinks.filter(entry => {
                        try {
                            const resolved = new URL(entry.value, document.baseURI);
                            const currentUrl = new URL(location.href);
                            resolved.hash = '';
                            currentUrl.hash = '';
                            if (resolved.href === currentUrl.href) return false;
                            const value = resolved.href.toLowerCase();
                            if (/beian\.miit\.gov\.cn|beian\.gov\.cn\/portal\/registersysteminfo/.test(value)) {
                                return false;
                            }
                            const label = String(entry.node.innerText || entry.node.textContent || '')
                                .replace(/\s+/g, '').trim();
                            return !/^(?:首页|主页|上一页|下一页|更多|返回|登录|注册|中文|english)$/i.test(label);
                        } catch (_) {
                            return false;
                        }
                    });
                    if (!validDetailLinks.length) return false;

                    const isDate = value => {
                        const text = String(value || '').replace(/\s+/g, ' ').trim();
                        return /(?:19|20)\d{2}[年/.\-]\s*\d{1,2}(?:[月/.\-]\s*\d{1,2}日?)?/.test(text) ||
                            /\d{1,2}[/.\-]\d{1,2}.{0,40}(?:19|20)\d{2}/.test(text);
                    };
                    const itemText = String(item.innerText || item.textContent || '')
                        .replace(/\s+/g, ' ').trim();
                    if (!isDate(itemText)) return false;

                    const titleNodes = [
                        ...validDetailLinks.map(entry => entry.node),
                        ...item.querySelectorAll(
                            'h1,h2,h3,h4,h5,h6,[class*="title" i],'
                            + '[class*="headline" i],[class*="subject" i]'
                        )
                    ];
                    const titleValues = titleNodes.flatMap(node => [
                        String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
                        String(node.getAttribute && node.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
                    ]).filter(Boolean);
                    const hasTitle = titleValues.some(value => {
                        const compact = value.replace(/\s+/g, '');
                        return compact.length >= 5 && compact.length <= 300 &&
                            !isDate(compact) && !isActionText(compact) &&
                            !/^(?:首页|主页|新闻|资讯|公告|动态|新闻中心|公司新闻|行业新闻)$/.test(compact);
                    });
                    return hasTitle && itemText.length >= 12;
                }

                function orderedSiblingXpaths(items) {
                    if (items.length < 3) return false;
                    const parsed = items.map(item => {
                        const xpath = absoluteXpath(item);
                        const matched = xpath.match(/^(.*)\/([a-z0-9_-]+)\[(\d+)\]$/i);
                        return matched ? {parent: matched[1], tag: matched[2], index: Number(matched[3])} : null;
                    });
                    if (parsed.some(value => !value)) return false;
                    if (!parsed.every(value =>
                        value.parent === parsed[0].parent && value.tag === parsed[0].tag)) return false;
                    const step = parsed.length > 1 ? parsed[1].index - parsed[0].index : 0;
                    return step > 0 && parsed.every((value, index) =>
                        index === 0 || value.index === parsed[index - 1].index + step);
                }

                function containerClassRatio(items) {
                    const positionClass = /^(odd|even)$/i;
                    const transientClass = /^(show|shown|visible|animated|active|aos-init|aos-animate)$/i;
                    const animationClass = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
                    const baseClasses = item => String(item.className || '')
                        .split(/\s+/).filter(Boolean)
                        .filter(cls => !positionClass.test(cls) &&
                            !transientClass.test(cls) && !animationClass.test(cls));
                    // 不依赖 odd/even 名称：Full XPath 连续时，严格只覆盖奇数位
                    // 或偶数位的 class 属于位置样式，不参与结构一致率。
                    const positionalTokens = new NativeSet();
                    if (orderedSiblingXpaths(items)) {
                        const tokenPositions = new NativeMap();
                        items.forEach((item, index) => baseClasses(item).forEach(token => {
                            if (!tokenPositions.has(token)) tokenPositions.set(token, []);
                            tokenPositions.get(token).push(index);
                        }));
                        for (const [token, positions] of tokenPositions.entries()) {
                            const parity = positions[0] % 2;
                            const expected = parity === 0 ? Math.ceil(items.length / 2) : Math.floor(items.length / 2);
                            if (positions.length === expected &&
                                positions.every(index => index % 2 === parity)) positionalTokens.add(token);
                        }
                    }
                    const structuralClass = item => baseClasses(item)
                        .filter(cls => !positionalTokens.has(cls)).sort().join(' ');
                    const rawCounts = {};
                    for (const item of items) {
                        const cls = structuralClass(item);
                        rawCounts[cls] = (rawCounts[cls] || 0) + 1;
                    }
                    const rawMax = Math.max(0, ...Object.values(rawCounts));
                    // 仅用于容器候选：Full XPath 连续有序且原始 class 全不相同时，
                    // 去掉 class 中的数字序号后重新计算一致率。
                    if (rawMax === 1 && orderedSiblingXpaths(items)) {
                        const normalizedCounts = {};
                        for (const item of items) {
                            const cls = structuralClass(item).replace(/\d+/g, '').trim();
                            normalizedCounts[cls] = (normalizedCounts[cls] || 0) + 1;
                        }
                        return Math.max(0, ...Object.values(normalizedCounts)) / items.length;
                    }
                    return rawMax / items.length;
                }

                const isActionText = value => /^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载|read\s*more|details?|more|view)[>》›»+＋→]*$/i.test(
                    String(value || '').replace(/\s+/g, '')
                );

                const candidates = [];
                const seenContainers = new NativeSet();
                const seeds = [
                    ...document.querySelectorAll('a[href]'),
                    ...Array.from(document.querySelectorAll('*')).filter(node => Boolean(getUrlAttribute(node)))
                ];
                for (const seed of seeds) {
                    if (seed.matches && seed.matches('a[href]')) {
                        const href = String(seed.getAttribute('href') || '').trim();
                        const hrefValid = href && !/^#/.test(href) &&
                            !/^javascript:/i.test(href) && !/^(?:tel|mailto):/i.test(href);
                        // href 无效时继续检查该 A 标签的其他全部属性；例如
                        // href="javascript:void(0)" + chref="info.aspx?..."。
                        if (!hrefValid && !getUrlAttribute(seed)) continue;
                    }

                    // 从每个种子节点向上检查可能的公共容器。
                    let container = seed.parentElement;
                    for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
                        const containerXpath = absoluteXpath(container);
                        // 页头、页脚、导航语义只作为多个列表候选之间的降权依据，
                        // 不能在候选收集阶段硬排除；否则页面只有一个列表区域时会
                        // 直接得到“自动识别失败”。非激活 Tab 仍然必须跳过。
                        if (!containerXpath || seenContainers.has(containerXpath) || insideInactiveTabPanel(container)) continue;
                        seenContainers.add(containerXpath);

                        // 分隔线虽然有尺寸，但没有文本、链接或 URL 特征，不属于列表项。
                        // 先移除它们，再判断 Full XPath 和 class 规律。
                        const items = Array.from(container.children)
                            .filter(structurallyPresent)
                            .filter(meaningfulListItem)
                            .filter(item => !isMoreActionItem(item))
                            .filter(item => !isPaginationItem(item))
                            .filter(hasValidLink);
                        if (items.length < 3 &&
                            !isTwoItemNewsException(container, items) &&
                            !isSingleItemNewsException(container, items)) continue;
                        const tagCounts = {};
                        for (const item of items) {
                            tagCounts[item.tagName] = (tagCounts[item.tagName] || 0) + 1;
                        }
                        const dominantTag = Object.keys(tagCounts).sort((a,b) => tagCounts[b] - tagCounts[a])[0];
                        let listItems = items.filter(item => item.tagName === dominantTag);
                        const smallDominantGroup = items.length <= 5 &&
                            listItems.length >= 3 &&
                            listItems.length > Math.max(0, ...Object.entries(tagCounts)
                                .filter(([tag]) => tag !== dominantTag)
                                .map(([, count]) => count));
                        if (listItems.length / items.length < 0.8 && !smallDominantGroup) continue;

                        // 同一容器存在推荐、正文、分页等多组 A 节点时，优先使用
                        // “标签 + 稳定class”数量最多且至少3项的组，不再混合评分。
                        const classGroups = new NativeMap();
                        for (let itemIndex = 0; itemIndex < listItems.length; itemIndex++) {
                            const item = listItems[itemIndex];
                            const key = item.tagName + '#' + stableItemClass(item);
                            if (!classGroups.has(key)) classGroups.set(key, []);
                            classGroups.get(key).push(item);
                        }
                        const dominantClassGroup = [...classGroups.values()].sort(
                            (left, right) => right.length - left.length
                        )[0] || [];
                        if (dominantClassGroup.length >= 3) {
                            listItems = dominantClassGroup;
                        }
                        const classRatio = containerClassRatio(listItems);

                        // “首页 + 新闻动态”同时作为列表项主链接出现时，属于
                        // 网站主导航而非新闻标题列表，直接排除且不参与兜底。
                        const primaryItemLabelList = listItems.map(item => {
                            const anchor = item.matches('a[href]')
                                ? item
                                : Array.from(item.children).find(child =>
                                    child.matches && child.matches('a[href]')
                                ) || item.querySelector('a[href]');
                            const semanticTitle = item.querySelector(
                                'h1,h2,h3,h4,h5,h6,[class*="title" i],'
                                + '[class*="headline" i],[class*="subject" i]'
                            );
                            const labelNode = anchor || semanticTitle || item;
                            return String(labelNode && (labelNode.innerText || labelNode.textContent) || '')
                                .replace(/\s+/g, '').trim();
                        }).filter(Boolean);
                        // 不用平均长度稀释短导航项：只要同一候选中出现至少
                        // 2 个不超过四字的主链接文本，就按导航/栏目容器排除。
                        // “查看详情/更多/read more”等重复行动按钮是新闻卡片的
                        // 正常主链接，不能按短栏目词淘汰整个重复列表。
                        const shortNonActionLabels = primaryItemLabelList.filter(label =>
                            label.length <= 4 && !isActionText(label)
                        );
                        if (shortNonActionLabels.length >= 2) {
                            continue;
                        }
                        const primaryItemLabels = new NativeSet(primaryItemLabelList);
                        if (primaryItemLabels.has('首页') &&
                            primaryItemLabels.has('新闻动态')) continue;

                        const containerSemantic = `${String(container.className || '').toLowerCase()} ${String(container.id || '').toLowerCase()}`;
                        const insideLanguageSiteSelector = (() => {
                            let current = container;
                            for (let ancestorDepth = 0; current && ancestorDepth < 6;
                                 ancestorDepth++, current = current.parentElement) {
                                const semantic = `${String(current.className || '')} ${String(current.id || '')}`
                                    .toLowerCase();
                                if (/(?:^|[\s_-])(?:lang(?:uage)?[_-]?(?:pop|list|menu|selector|switch)|country[_-]?(?:list|menu|selector|switch)|global[_-]?(?:site|business|selector|switch)|site[_-]?(?:global|selector|switch))(?:[\s_-]|$)/i.test(semantic)) {
                                    return true;
                                }
                            }
                            return false;
                        })();
                        if (insideLanguageSiteSelector) continue;
                        const childSemantics = Array.from(container.children).map(c => `${String(c.className || '').toLowerCase()} ${String(c.id || '').toLowerCase()}`);
                        const hasNavChild = childSemantics.some(s => /\b(?:nav|tab|menu|filter|category|subnav|total-nav)\b|[_-]nav|[_-]tab/i.test(s));
                        if (hasNavChild && depth > 0 && container.children.length <= 5) continue;

                        const tabItemRatio = listItems.filter(item =>
                            /tab[_-]?item|formtabcntid/.test(
                                `${String(item.className || '').toLowerCase()} ${String(item.id || '').toLowerCase()}`
                            )).length / listItems.length;
                        if (/tab[_-]?list|formtabcontent/.test(containerSemantic) && tabItemRatio >= 0.6) continue;

                        const topNavItemRatio = listItems.filter(item =>
                            /(?:^|[\s_-])top[_-]?nav(?:[\s_-]|$)|(?:^|[\s_-])main[_-]?nav(?:[\s_-]|$)/i.test(
                                `${String(item.className || '')} ${String(item.id || '')}`
                            )
                        ).length / listItems.length;
                        if (/(?:^|[\s_-])top[_-]?nav(?:[\s_-]|$)|(?:^|[\s_-])main[_-]?nav(?:[\s_-]|$)/i.test(containerSemantic) ||
                            topNavItemRatio >= 0.5) continue;

                        const paginationPattern = /^(?:\d+|<|>|<<|>>|首页|尾页|上一页|下一页|first|last|prev|next|page|\.\.\.)$/i;
                        const isPaginationBar = listItems.filter(item => {
                            const text = String(item.innerText || item.textContent || '').replace(/\s+/g, '').trim();
                            return paginationPattern.test(text);
                        }).length / listItems.length >= 0.6;
                        if (isPaginationBar) continue;
                        if (/page[_-]?(?:list|nation|bar|nav|link|wrap|box|cnt|num|item)|pager|pagelist/i.test(containerSemantic) &&
                            listItems.every(item => String(item.innerText || item.textContent || '').replace(/\s+/g, '').trim().length <= 10)) continue;

                        // ICP、公安备案属于明确的页脚功能链接，不能进入候选，
                        // 更不能在正常新闻候选全部失败后通过语义兜底胜出。
                        // 以多数比例判断，避免真实新闻列表偶然提到“备案”被误伤。
                        const filingItemRatio = listItems.filter(item => {
                            const text = String(item.innerText || item.textContent || '')
                                .replace(/\s+/g, '').toLowerCase();
                            const urls = [item, ...item.querySelectorAll('*')]
                                .flatMap(node => node.attributes
                                    ? Array.from(node.attributes).map(attr => String(attr.value || ''))
                                    : [])
                                .join(' ').toLowerCase();
                            return /(?:icp备|ICP备|公网安备|公安备案|网站备案)/i.test(text) ||
                                /beian\.miit\.gov\.cn|beian\.gov\.cn\/portal\/registersysteminfo/i.test(urls);
                        }).length / listItems.length;
                        if (filingItemRatio >= 0.5) continue;

                        const fieldRoles = new NativeSet();
                        for (const item of listItems) {
                            const semantic = `${String(item.className || '').toLowerCase()} ${String(item.id || '').toLowerCase()}`;
                            if (/title|tit|headline|subject/.test(semantic)) fieldRoles.add('title');
                            if (/desc|des(?:cription)?|summary|abstract|intro/.test(semantic)) fieldRoles.add('summary');
                            if (/more|detail|date|time|action|button/.test(semantic)) fieldRoles.add('meta');
                        }
                        if (fieldRoles.size >= 2) continue;

                        const pathStats = new NativeMap();
                        let textLength = 0;
                        for (let itemIndex = 0; itemIndex < listItems.length; itemIndex++) {
                            const item = listItems[itemIndex];
                            textLength += String(item.innerText || item.textContent || '').trim().length;
                            const links = item.tagName === 'A' ? [item] : Array.from(item.querySelectorAll('a[href]'));
                            const validAnchors = links.filter(link => {
                                const value = String(link.getAttribute('href') || '').trim();
                                return value && !/^#/.test(value) && !/^javascript:/i.test(value) && !/^(?:tel|mailto):/i.test(value);
                            });
                            const linkEntries = [];
                            for (const link of validAnchors) {
                                const path = relativeXpath(item, link);
                                if (path) linkEntries.push({
                                    path,
                                    source: '@href',
                                    value: effectiveUrlValue(
                                        item, String(link.getAttribute('href') || '').trim()
                                    ),
                                    node: link
                                });
                            }
                            if (!linkEntries.length) {
                                const attrObj = getUrlAttribute(item);
                                if (attrObj) {
                                    linkEntries.push({
                                        path: '.', source: '@' + attrObj.attr,
                                        value: effectiveUrlValue(item, attrObj.value), node: item
                                    });
                                } else {
                                    for (const child of Array.from(item.querySelectorAll('*'))) {
                                        const childAttr = getUrlAttribute(child);
                                        if (childAttr) {
                                            const childPath = relativeXpath(item, child);
                                            if (childPath) linkEntries.push({
                                                path: childPath, source: '@' + childAttr.attr,
                                                value: effectiveUrlValue(item, childAttr.value),
                                                node: child
                                            });
                                        }
                                    }
                                }
                            }

                            const seenPaths = new NativeSet();
                            for (const entry of linkEntries) {
                                const { path, value, node } = entry;
                                if (!pathStats.has(path)) pathStats.set(path, {
                                    count: 0, values: new NativeSet(), textLengths: [],
                                    meaningfulTextCount: 0, titleTextCount: 0,
                                    textLengthSum: 0, actionTextCount: 0,
                                    sourceCounts: new NativeMap(),
                                    itemIndexes: new NativeSet()
                                });
                                const stat = pathStats.get(path);
                                if (!seenPaths.has(path)) {
                                    stat.count++;
                                    stat.itemIndexes.add(itemIndex);
                                    const rawLinkText = String(
                                        node.innerText || node.textContent || ''
                                    ).replace(/\s+/g, ' ').trim();
                                    const linkTextLength = rawLinkText.length;
                                    stat.textLengths.push(linkTextLength);
                                    if (isActionText(rawLinkText)) {
                                        stat.actionTextCount++;
                                    }
                                    if (linkTextLength >= 2) {
                                        stat.meaningfulTextCount++;
                                        stat.textLengthSum += linkTextLength;
                                        if (linkTextLength >= 8 && linkTextLength <= 200) {
                                            stat.titleTextCount++;
                                        }
                                    }
                                    seenPaths.add(path);
                                }
                                stat.values.add(value);
                                stat.sourceCounts.set(
                                    entry.source,
                                    (stat.sourceCounts.get(entry.source) || 0) + 1
                                );
                            }
                        }

                        let bestPath = '';
                        let bestCount = 0;
                        let bestDistinct = 0;
                        let bestMeaningfulText = -1;
                        let bestTitleText = -1;
                        let bestAverageLinkText = -1;
                        for (const [path, stat] of pathStats.entries()) {
                            const statAverageLinkText = stat.meaningfulTextCount
                                ? stat.textLengthSum / stat.meaningfulTextCount : 0;
                            if (stat.count > bestCount ||
                                (stat.count === bestCount && stat.values.size > bestDistinct) ||
                                (stat.count === bestCount && stat.values.size === bestDistinct &&
                                 stat.meaningfulTextCount > bestMeaningfulText) ||
                                (stat.count === bestCount && stat.values.size === bestDistinct &&
                                 stat.meaningfulTextCount === bestMeaningfulText &&
                                 stat.titleTextCount > bestTitleText) ||
                                (stat.count === bestCount && stat.values.size === bestDistinct &&
                                 stat.meaningfulTextCount === bestMeaningfulText &&
                                 stat.titleTextCount === bestTitleText &&
                                 statAverageLinkText > bestAverageLinkText)) {
                                bestPath = path;
                                bestCount = stat.count;
                                bestDistinct = stat.values.size;
                                bestMeaningfulText = stat.meaningfulTextCount;
                                bestTitleText = stat.titleTextCount;
                                bestAverageLinkText = statAverageLinkText;
                            }
                        }
                        const pathRatio = bestCount / listItems.length;
                        const averageText = textLength / listItems.length;
                        // 新闻列表中每一项都应指向不同 URL。重复地址通常来自
                        // 轮播副本、导航入口或同一模块的多个操作按钮。
                        const uniqueUrlRatio = bestCount ? bestDistinct / bestCount : 0;
                        if (pathRatio < 0.5 || uniqueUrlRatio < 1) continue;
                        const bestPathStat = pathStats.get(bestPath);
                        // 50% 只能用于真正的奇偶镜像布局：直属项结构必须稳定，
                        // 并且存在第二条 URL 路径覆盖另一半项目。不能因为一个
                        // 混合大容器中的某条深层路径碰巧命中 2/4 就选中整块。
                        if (pathRatio < 0.6) {
                            let hasComplementaryMirrorPath = false;
                            if (classRatio >= 0.7 && bestPathStat) {
                                for (const [otherPath, otherStat] of pathStats.entries()) {
                                    if (otherPath === bestPath ||
                                        otherStat.count < Math.ceil(listItems.length * 0.3) ||
                                        otherStat.values.size !== otherStat.count) continue;
                                    const union = new NativeSet([
                                        ...bestPathStat.itemIndexes,
                                        ...otherStat.itemIndexes
                                    ]);
                                    const overlap = [...bestPathStat.itemIndexes].filter(
                                        index => otherStat.itemIndexes.has(index)
                                    ).length;
                                    if (union.size / listItems.length >= 0.8 &&
                                        overlap / listItems.length <= 0.2) {
                                        hasComplementaryMirrorPath = true;
                                        break;
                                    }
                                }
                            }
                            if (!hasComplementaryMirrorPath) continue;
                        }
                        const bestSource = bestPathStat
                            ? [...bestPathStat.sourceCounts.entries()].sort(
                                (left, right) => right[1] - left[1]
                              )[0]?.[0] || '@href'
                            : '@href';
                        const linkTextLengths = bestPathStat ? bestPathStat.textLengths : [];
                        const meaningfulTextLengths = linkTextLengths.filter(value => value >= 2);
                        const averageLinkText = meaningfulTextLengths.length
                            ? meaningfulTextLengths.reduce((sum, value) => sum + value, 0) /
                                meaningfulTextLengths.length : 0;
                        const shortLinkRatio = meaningfulTextLengths.length
                            ? meaningfulTextLengths.filter(value => value <= 16).length /
                                meaningfulTextLengths.length : 0;
                        // 完整 class 组合不一致时，用 URL 字符串相似度补充判断。
                        // 使用完整 URL（协议、域名、端口、path、query）比较；
                        // 查询参数排序后保留键和值，让 id=1370/id=1369 等模板
                        // 自然取得高相似度，同时避免硬编码动态 ID 所在层级。
                        const comparableUrl = value => {
                            try {
                                const base = /^https?:/i.test(document.baseURI)
                                    ? document.baseURI : 'https://relative.invalid/';
                                const parsed = new URL(String(value || ''), base);
                                const params = [...parsed.searchParams.entries()]
                                    .sort(([ak, av], [bk, bv]) =>
                                        ak.localeCompare(bk) || av.localeCompare(bv))
                                    .map(([key, val]) => `${key}=${val}`).join('&');
                                return parsed.origin.toLowerCase() +
                                    parsed.pathname.toLowerCase().replace(/\/$/, '') +
                                    (params ? `?${params.toLowerCase()}` : '');
                            } catch (_) {
                                return '';
                            }
                        };
                        // Sørensen-Dice bigram 相似度比固定正则更适合不同 CMS 的
                        // 数字目录、文件名 ID、slug 和 query 参数模板。
                        const urlSimilarity = (left, right) => {
                            if (left === right) return 1;
                            if (left.length < 2 || right.length < 2) return 0;
                            const counts = new NativeMap();
                            for (let i = 0; i < left.length - 1; i++) {
                                const gram = left.slice(i, i + 2);
                                counts.set(gram, (counts.get(gram) || 0) + 1);
                            }
                            let overlap = 0;
                            for (let i = 0; i < right.length - 1; i++) {
                                const gram = right.slice(i, i + 2);
                                const count = counts.get(gram) || 0;
                                if (count > 0) {
                                    overlap++;
                                    counts.set(gram, count - 1);
                                }
                            }
                            return (2 * overlap) / (left.length + right.length - 2);
                        };
                        const comparableUrls = [...(bestPathStat ? bestPathStat.values : [])]
                            .map(comparableUrl).filter(Boolean);
                        // 以每个 URL 为中心计算相似成员，最大簇占列表项比例
                        // 即规律率；阈值 0.72 可容纳 URL 中少量动态字段变化，
                        // 又不会把结构差异明显的链接判为同一规律。
                        let urlPatternCount = 0;
                        for (const center of comparableUrls) {
                            const similarCount = comparableUrls.filter(value =>
                                urlSimilarity(center, value) >= 0.72
                            ).length;
                            urlPatternCount = Math.max(urlPatternCount, similarCount);
                        }
                        const urlPatternRatio = listItems.length
                            ? urlPatternCount / listItems.length : 0;
                        if (classRatio < 0.6 && urlPatternRatio < 0.6) continue;
                        const titlePathStats = new NativeMap();
                        for (let itemIndex = 0; itemIndex < listItems.length; itemIndex++) {
                            const item = listItems[itemIndex];
                            const seenTitlePaths = new NativeSet();
                            const descendants = Array.from(item.querySelectorAll('*'));
                            for (let nodeIndex = 0; nodeIndex < descendants.length; nodeIndex++) {
                                const titleNode = descendants[nodeIndex];
                                const titleText = String(
                                    titleNode.innerText || titleNode.textContent || ''
                                ).replace(/\s+/g, ' ').trim();
                                const titlePath = relativeXpath(item, titleNode);
                                if (!titlePath || titleText.length < 2 || titleText.length > 300 ||
                                    seenTitlePaths.has(titlePath)) continue;
                                if (/^(?:(?:19|20)\d{2}[年/.\-]\d{1,2}(?:[月/.\-]\d{1,2}日?)?|\d{1,2}[月/.\-]\d{1,2}日?)$/.test(titleText) ||
                                    isActionText(titleText)) continue;
                                seenTitlePaths.add(titlePath);
                                if (!titlePathStats.has(titlePath)) {
                                    titlePathStats.set(titlePath, {
                                        items: new NativeSet(), values: new NativeSet(),
                                        positions: [], textLengths: [], semanticCount: 0
                                    });
                                }
                                const titleStat = titlePathStats.get(titlePath);
                                titleStat.items.add(itemIndex);
                                titleStat.values.add(titleText);
                                titleStat.positions.push(nodeIndex);
                                titleStat.textLengths.push(titleText.length);
                                const semantic = `${String(titleNode.tagName || '')} ${String(titleNode.className || '')} ${String(titleNode.id || '')}`;
                                if (/^H[1-6]\b|title|tit\b|headline|subject/i.test(semantic)) {
                                    titleStat.semanticCount++;
                                }
                            }
                        }
                        // 单条候选在前面已经通过新闻区域、详情 URL、标题和日期
                        // 四重硬校验；此处允许其标题路径按 1/1 形成稳定证据。
                        // 多条候选继续保持至少两项、至少 50% 的覆盖门槛。
                        const minimumTitleCoverage = listItems.length === 1
                            ? 1 : Math.max(2, Math.ceil(listItems.length / 2));
                        // 短标题排除必须基于实际标题候选路径，不能只读取 a 文本。
                        // React/Ant 菜单常把跳转属性和标题都放在 div 中；若同一
                        // 稳定标题路径至少产生两个不超过四字的不同标题，该候选
                        // 就是栏目/导航容器，不允许进入后续排序或语义兜底。
                        const hasRepeatedShortTitlePath = [...titlePathStats.values()].some(stat => {
                            if (stat.items.size < minimumTitleCoverage ||
                                stat.values.size !== stat.items.size) return false;
                            const shortValues = [...stat.values].filter(value => {
                                const compact = String(value || '').replace(/\s+/g, '').trim();
                                return compact.length >= 1 && compact.length <= 4 &&
                                    !isActionText(compact) &&
                                    !/^(?:(?:19|20)\d{2}[年/.\-]\d{1,2}|\d{1,2}[月/.\-]\d{1,2})/.test(compact);
                            });
                            return shortValues.length >= 2;
                        });
                        if (hasRepeatedShortTitlePath) continue;
                        const hasStableDistinctTitle = [...titlePathStats.values()].some(stat => {
                            if (stat.items.size < minimumTitleCoverage ||
                                stat.values.size !== stat.items.size) return false;
                            const averagePosition = stat.positions.reduce((sum, value) => sum + value, 0) /
                                (stat.positions.length || 1);
                            const averageTitleLength = stat.textLengths.reduce((sum, value) => sum + value, 0) /
                                (stat.textLengths.length || 1);
                            const semanticRatio = stat.semanticCount / stat.items.size;
                            // 标题通常是列表项前部的简短、逐条不同文本。标题标签和
                            // class 只提高可信度，不限制具体使用 h3、em、span 或 div。
                            return averageTitleLength <= 200 &&
                                (averagePosition <= 25 || semanticRatio >= 0.5);
                        });
                        // 列表项可能把整篇正文预埋在 DOM 中，不能仅凭总文本超过
                        // 3000 字排除容器。只有正文超长且找不到稳定、合理长度、
                        // 逐条不同的标题路径时，才认为它不像新闻列表。
                        if (averageText > 3000 && !hasStableDistinctTitle) continue;
                        const isActionLink = Boolean(
                            bestPathStat && bestPathStat.actionTextCount &&
                            (bestPathStat.actionTextCount / (meaningfulTextLengths.length || 1) >= 0.5)
                        );
                        // 链接文本相同或较短时，只要是“查看详情”等行动按钮（isActionLink），
                        // 或者同项存在稳定、逐条不同的标题标签，就仍然是有效新闻入口，不按导航短词淘汰。
                        if (meaningfulTextLengths.length &&
                            averageLinkText <= 16 && shortLinkRatio >= 0.8 &&
                            !isActionLink && !hasStableDistinctTitle) continue;
                        const dateItemCount = listItems.filter(item => {
                            const text = String(item.innerText || item.textContent || '');
                            return /(?:19|20)\d{2}[年/.\-]\s*\d{1,2}(?:[月/.\-]\s*\d{1,2}日?)?|\d{1,2}[月/.\-]\s*\d{1,2}日?/.test(text);
                        }).length;
                        const dateRatio = dateItemCount / listItems.length;
                        const hasDateEvidence = dateRatio >= 0.5;

                        // 多个栏目导航常由“公司新闻、通知公告、行业动态”等
                        // 等长四字短词组成。即使 URL 唯一、文本逐项不同，
                        // 无日期、无行动按钮且主链接普遍极短时也不是新闻列表。
                        // 不使用整项 innerText：下拉菜单会把导航项文本虚假拉长。
                        const ultraShortCategoryList = listItems.length >= 3 &&
                            averageLinkText <= 6 && shortLinkRatio >= 0.8 &&
                            dateRatio < 0.5 && !isActionLink;
                        if (ultraShortCategoryList) continue;

                        const classEvidence = classSemanticEvidence(container, listItems);

                        candidates.push({
                            xpath: containerXpath,
                            sampleXpath: absoluteXpath(listItems[0]),
                            itemCount: listItems.length,
                            pathRatio,
                            distinctUrls: bestDistinct,
                            averageText,
                            averageLinkText,
                            shortLinkRatio,
                            urlPatternRatio,
                            dateRatio,
                            hasDateEvidence,
                            linkXpath: bestPath,
                            linkSource: bestSource,
                            classRatio,
                            classSemanticScore: classEvidence.score,
                            classEvidence: classEvidence.evidence,
                            semanticExcluded: excludedRegion(container),
                            // bottom 只在“短链接 + 无日期”同时成立时作为硬页脚证据；
                            // 新闻卡片自身常有 .bottom 操作区，不能仅凭该词排除。
                            hardFooterExcluded: insideBottomRegion(container) &&
                                averageLinkText <= 16 && dateRatio < 0.5,
                            // 明确位于站点 nav/navigation 中的短文字、无日期链接
                            // 是菜单，不允许在“没有正常 A 候选”时重新兜底胜出。
                            hardNavigationExcluded:
                                insideSiteNavigationRegion(container) &&
                                averageLinkText <= 16 && dateRatio < 0.5
                        });
                    }
                }

                const sortCandidates = values => values.sort((a, b) => {
                    const aIsNormal = a.itemCount >= 3 ? 1 : 0;
                    const bIsNormal = b.itemCount >= 3 ? 1 : 0;
                    if (bIsNormal !== aIsNormal) return bIsNormal - aIsNormal;
                    // 有文字的候选（averageText >= 4）优先于纯图片/无文字候选（averageText < 4）
                    const aHasText = a.averageText >= 4 ? 1 : 0;
                    const bHasText = b.averageText >= 4 ? 1 : 0;
                    if (bHasText !== aHasText) return bHasText - aHasText;
                    // 布局语义是候选间的降级项而非硬排除：存在正常候选时
                    // 页脚/导航靠后；若全部候选均被降级，最高结构分仍可胜出。
                    return Number(a.semanticExcluded) - Number(b.semanticExcluded) ||
                        // 有真实标题文本的链接优先于纯图片/空文本链接。
                        // 后者常见于轮播、装饰模块和门户 portlet。
                        Number(b.averageLinkText >= 2) - Number(a.averageLinkText >= 2) ||
                        b.urlPatternRatio - a.urlPatternRatio ||
                        b.distinctUrls - a.distinctUrls ||
                        b.pathRatio - a.pathRatio ||
                        b.classSemanticScore - a.classSemanticScore ||
                        b.dateRatio - a.dateRatio ||
                        b.itemCount - a.itemCount ||
                        b.classRatio - a.classRatio ||
                        b.averageText - a.averageText;
                });
                // 页头、页脚、导航候选不能在“页面没有真正的 A 新闻列表”时
                // 作为唯一候选胜出。否则无 A 新闻页会先抓到备案、菜单等链接，
                // 并阻断后续无 A 容器识别。news-header 等业务区域已在
                // excludedRegion() 中由 hasBusinessFeature/isNewsRegion 放行。
                const allowedCandidates = candidates.filter(candidate =>
                    !excludedContainerXpaths.has(candidate.xpath)
                );
                let rankedCandidates = sortCandidates(
                    allowedCandidates.filter(candidate =>
                        !candidate.semanticExcluded &&
                        !candidate.hardFooterExcluded &&
                        !candidate.hardNavigationExcluded)
                );
                // 第一轮所有结构合格候选都因 menu/nav/header/footer 语义被
                // 排除时，去掉这层语义硬排除再评分。候选此前仍须通过 URL
                // 唯一性、相似度、链接文本和重复列表结构等硬条件，因此这里只
                // 放宽区域名称，不放宽新闻列表本身的证据。
                const fallbackCandidates = allowedCandidates.filter(candidate =>
                    !candidate.hardFooterExcluded &&
                    !candidate.hardNavigationExcluded
                );
                if (!rankedCandidates.length && fallbackCandidates.length) {
                    rankedCandidates = sortCandidates([...fallbackCandidates]);
                    if (rankedCandidates.length) {
                        rankedCandidates[0].semanticFallback = true;
                    }
                }
                return rankedCandidates.length ? rankedCandidates[0] : null;
            }
        """, list(excluded_container_xpaths or ()))
        if not result or not result.get("xpath") or not result.get("sampleXpath"):
            return None
        # 自定义属性证据较弱时，用第一条样本的真实点击结果做一次校验。
        # 高覆盖、高规律候选无需点击，避免无意义地反复导航。
        needs_click_validation = (
            str(result.get("linkSource") or "@href") != "@href"
            and (
                float(result.get("urlPatternRatio") or 0) < 0.8
                or bool(result.get("semanticFallback"))
            )
        )
        if needs_click_validation and hasattr(page, "network_responses"):
            sample_xpath = str(result["sampleXpath"])
            link_xpath = str(result.get("linkXpath") or ".")
            link_source = str(result.get("linkSource") or "").lstrip("@")
            full_link_xpath = sample_xpath
            if link_xpath not in {"", "."}:
                full_link_xpath += "/" + link_xpath.removeprefix("./")
            locator = page.locator(f"xpath=/{full_link_xpath.lstrip('/')}").first
            original_url = str(getattr(page, "url", "") or "")
            try:
                raw_expected = str(locator.get_attribute(link_source) or "").strip()
                expected_url = urllib.parse.urljoin(original_url, raw_expected)
                locator.evaluate("node => node.click()")
                clicked_url = original_url
                for _ in range(10):
                    time.sleep(0.2)
                    clicked_url = str(getattr(page, "url", "") or "")
                    if clicked_url and clicked_url != original_url:
                        break
                if clicked_url != original_url:
                    # 地址栏确实变化时必须与候选属性一致；不一致说明选错了
                    # URL 属性，淘汰该 A 候选并交给后续容器兜底。
                    if clicked_url.rstrip("/") != expected_url.rstrip("/"):
                        logging.info(
                            "[A XPath] 低置信度 URL 属性点击校验失败: "
                            f"属性={expected_url}; 地址栏={clicked_url}"
                        )
                        page.goto(original_url, wait_until="domcontentloaded", timeout=30000)
                        return None
                    logging.info(
                        "[A XPath] 低置信度 URL 属性已通过单条点击校验: "
                        f"{clicked_url}"
                    )
                    page.goto(original_url, wait_until="domcontentloaded", timeout=30000)
                else:
                    logging.info(
                        "[A XPath] 单条点击后地址栏未变化，保留现有结构证据继续处理"
                    )
            except Exception as ex:
                logging.info(f"[A XPath] 单条点击校验无法完成，保留结构候选: {ex}")
                try:
                    if str(getattr(page, "url", "") or "") != original_url:
                        page.goto(original_url, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    pass
        print(
            "[A XPath] 按 A Full XPath 规律选定容器: "
            f"{result['xpath']}; 列表项={result.get('itemCount')}; "
            f"链接路径={result.get('linkXpath')}; "
            f"覆盖率={result.get('pathRatio'):.2f}; "
            f"不同URL={result.get('distinctUrls')}; "
            f"URL规律率={result.get('urlPatternRatio', 0):.2f}; "
            f"链接平均文本长度={result.get('averageLinkText', 0):.1f}; "
            f"日期覆盖率={result.get('dateRatio', 0):.2f}; "
            f"class语义分={result.get('classSemanticScore', 0)}; "
            f"class证据={result.get('classEvidence', [])}; "
            f"语义排除兜底={bool(result.get('semanticFallback'))}"
        )
        return {
            "containerXpath": str(result["xpath"]),
            "sampleXpath": str(result["sampleXpath"]),
            "linkXpath": str(result.get("linkXpath") or ""),
            "linkSource": str(result.get("linkSource") or "@href"),
            "dateRatio": float(result.get("dateRatio") or 0),
            "averageLinkText": float(result.get("averageLinkText") or 0),
            "urlPatternRatio": float(result.get("urlPatternRatio") or 0),
            "classSemanticScore": float(result.get("classSemanticScore") or 0),
            "semanticFallback": bool(result.get("semanticFallback")),
        }
