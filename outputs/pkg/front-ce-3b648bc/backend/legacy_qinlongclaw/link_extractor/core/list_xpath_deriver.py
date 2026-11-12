from typing import Callable, List

from core.container_selector import ContainerSelection


class ListXPathDeriver:
    """第二阶段：只从基础样本推导同容器、有序、同结构列表项。"""

    @staticmethod
    def derive(
        page,
        selection: ContainerSelection,
        is_flash: bool,
        flash_deriver: Callable,
    ) -> List[str]:
        if is_flash:
            return flash_deriver(page, selection.sample_xpath)
        # 容器和样本已由第一阶段确定。第二阶段只能枚举容器直属同级项，
        # 禁止旧推导器继续进入样本内部，把样本的子 div 当作列表变异层。
        result = page.evaluate(r"""
            args => {
                // 站点脚本可能覆盖 window.Map/window.Set（国义招标会覆盖 Map）。
                // 从空白 iframe 获取原生集合，避免列表推导在主页面 realm 中崩溃。
                const frame = document.createElement('iframe');
                frame.style.display = 'none';
                (document.documentElement || document.body).appendChild(frame);
                const NativeMap = frame.contentWindow.Map;
                const NativeSet = frame.contentWindow.Set;
                frame.remove();
                const byXpath = xpath => document.evaluate(
                    xpath.startsWith('/') ? xpath : '/' + xpath,
                    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue;
                const absoluteXpath = element => {
                    if (!element || element.nodeType !== 1) return '';
                    if (element.tagName.toLowerCase() === 'html') return 'html[1]';
                    const tag = element.tagName.toLowerCase();
                    const validXpathName = /^[a-z_][a-z0-9_.-]*$/i.test(tag);
                    let index = 1;
                    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
                        if (validXpathName) {
                            if (sibling.tagName === element.tagName) index++;
                        } else {
                            index++;
                        }
                    }
                    return absoluteXpath(element.parentElement) + '/' +
                        (validXpathName ? tag : '*') + '[' + index + ']';
                };
                // 动画/可见性 class 是运行状态，不属于列表结构 class。
                const transient = /^(show|shown|visible|animated|active|aos-init|aos-animate)$/i;
                const animationClass = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
                const positionClass = /^(odd|even)$/i;
                const dynamicId = /^(?:post|item|entry|node|news|article|card|e-loop-item)[_-]?[a-zA-Z0-9_-]*\d+[a-zA-Z0-9_-]*$|^(?:news_type|category|cat|tag|term|tax|author|format)[_-]/i;
                const classes = node => String(node.className || '')
                    .split(/\s+/).filter(Boolean)
                    .filter(cls => !transient.test(cls) && !animationClass.test(cls) &&
                        !positionClass.test(cls) && !dynamicId.test(cls))
                    .sort();
                const classSimilarity = (left, right) => {
                    if (!left.length || !right.length) return left.length === right.length ? 1 : 0;
                    const tokenSimilarity = (a, b) => {
                        if (a === b) return 1;
                        let prefix = 0;
                        const limit = Math.min(a.length, b.length);
                        while (prefix < limit && a[prefix] === b[prefix]) prefix++;
                        return prefix / Math.max(a.length, b.length);
                    };
                    const source = left.length >= right.length ? left : right;
                    const target = source === left ? right : left;
                    return source.reduce((sum, value) => sum + Math.max(
                        0, ...target.map(other => tokenSimilarity(value, other))
                    ), 0) / source.length;
                };
                const sameClasses = (left, right) => classSimilarity(left, right) >= 0.5;
                const classesWithoutNumbers = node => String(node.className || '')
                    .split(/\s+/).filter(Boolean)
                    .filter(cls => !transient.test(cls) && !animationClass.test(cls) &&
                        !positionClass.test(cls))
                    .map(cls => cls.replace(/\d+/g, ''))
                    .filter(Boolean).sort();
                const orderedSiblingXpaths = nodes => {
                    if (nodes.length < 3) return false;
                    const parsed = nodes.map(node => {
                        const xpath = absoluteXpath(node);
                        const matched = xpath.match(/^(.*)\/([a-z0-9_-]+)\[(\d+)\]$/i);
                        return matched ? {
                            parent: matched[1], tag: matched[2], index: Number(matched[3])
                        } : null;
                    });
                    if (parsed.some(value => !value)) return false;
                    return parsed.every((value, index) =>
                        value.parent === parsed[0].parent && value.tag === parsed[0].tag &&
                        (index === 0 || value.index === parsed[index - 1].index + 1));
                };

                const container = byXpath(args.containerXpath);
                const sample = byXpath(args.sampleXpath);
                if (!container || !sample || sample.parentElement !== container) return [];
                const sampleClasses = classes(sample);
                const sameTagSiblings = [...container.children]
                    .filter(node => node.tagName === sample.tagName);
                const positionalTokens = new NativeSet();
                if (orderedSiblingXpaths(sameTagSiblings)) {
                    const tokenPositions = new NativeMap();
                    sameTagSiblings.forEach((node, index) => classes(node).forEach(token => {
                        if (!tokenPositions.has(token)) tokenPositions.set(token, []);
                        tokenPositions.get(token).push(index);
                    }));
                    for (const [token, positions] of tokenPositions.entries()) {
                        const parity = positions[0] % 2;
                        const expected = parity === 0
                            ? Math.ceil(sameTagSiblings.length / 2)
                            : Math.floor(sameTagSiblings.length / 2);
                        if (positions.length === expected &&
                            positions.every(index => index % 2 === parity)) positionalTokens.add(token);
                    }
                }
                const structuralClasses = node => classes(node)
                    .filter(cls => !positionalTokens.has(cls));
                const structuralNumberlessClasses = node => structuralClasses(node)
                    .map(cls => cls.replace(/\\d+/g, '')).filter(Boolean).sort();
                const sampleStructuralClasses = structuralClasses(sample);
                const rawClassKeys = sameTagSiblings.map(node => structuralClasses(node).join('.'));
                const useNumberlessClassFallback =
                    new NativeSet(rawClassKeys).size === sameTagSiblings.length &&
                    orderedSiblingXpaths(sameTagSiblings);
                const sampleNumberlessClasses = structuralNumberlessClasses(sample);
                const validHref = node => {
                    const href = String(node && node.getAttribute('href') || '').trim();
                    return href && href !== '#' && !/^javascript:/i.test(href);
                };
                const relativeNode = (root, xpath) => {
                    if (!xpath || xpath === '.') return root;
                    return document.evaluate(
                        xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                    ).singleNodeValue;
                };
                const urlSignature = value => {
                    try {
                        const base = /^https?:/i.test(document.baseURI)
                            ? document.baseURI : 'https://relative.invalid/';
                        const parsed = new URL(String(value || ''), base);
                        let path = parsed.pathname.toLowerCase().replace(/\/$/, '');
                        const lastSlash = path.lastIndexOf('/');
                        if (lastSlash > 0) {
                            path = path.slice(0, lastSlash) + '/*';
                        }
                        return parsed.origin.toLowerCase() + path + '?' +
                            [...parsed.searchParams.keys()].sort().join('&');
                    } catch (_) { return ''; }
                };
                const primaryLinkXpath = (args.linkRelativeXpaths || [])[0] || '';
                const primaryLinkSource = String(args.linkSource || '@href');
                const primaryLinkAttr = primaryLinkSource.replace(/^@/, '') || 'href';
                const primaryUrlValue = node => node && node.getAttribute
                    ? String(node.getAttribute(primaryLinkAttr) || '').trim() : '';
                const validPrimaryUrl = node => {
                    const value = primaryUrlValue(node);
                    if (!value || value === '#') return false;
                    return primaryLinkAttr !== 'href' || !/^javascript:/i.test(value);
                };
                const normalizedUrl = value => {
                    try {
                        const base = /^https?:/i.test(document.baseURI)
                            ? document.baseURI : 'https://relative.invalid/';
                        const parsed = new URL(String(value || ''), base);
                        // SPA 详情路由经常完全位于 hash 中，例如
                        // #/news/newsDetail?userId=1978。去掉 fragment 会把
                        // 所有详情误归一成列表页，只剩第一条。
                        parsed.hostname = parsed.hostname.toLowerCase();
                        const entries = [...parsed.searchParams.entries()]
                            .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
                                leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
                        parsed.search = '';
                        for (const [key, itemValue] of entries) {
                            parsed.searchParams.append(key, itemValue);
                        }
                        return parsed.href;
                    } catch (_) { return ''; }
                };
                // URL 去重属于列表推导的一部分：同一详情页只保留 DOM 中首次出现的项。
                // 无法从既定链接相对 XPath 读取 URL 的项仍保留，交给后续字段校验。
                const deduplicateByPrimaryUrl = nodes => {
                    if (!primaryLinkXpath) return nodes;
                    const seen = new NativeSet();
                    return nodes.filter(node => {
                        const link = relativeNode(node, primaryLinkXpath);
                        const href = primaryUrlValue(link);
                        const key = href ? normalizedUrl(href) : '';
                        if (!key) return true;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                };
                const sampleLink = relativeNode(sample, primaryLinkXpath);
                const sampleUrlSignature = validPrimaryUrl(sampleLink)
                    ? urlSignature(primaryUrlValue(sampleLink)) : '';
                const hasSameUrlPattern = node => {
                    if (!sampleUrlSignature || !primaryLinkXpath) return false;
                    const link = relativeNode(node, primaryLinkXpath);
                    if (!link || !link.getAttribute) return false;
                    const href = primaryUrlValue(link);
                    return validPrimaryUrl(link) && urlSignature(href) === sampleUrlSignature;
                };
                const matchesItemKind = node => {
                    if (['SCRIPT','STYLE','TEMPLATE','NOSCRIPT','LINK','META','SOURCE']
                        .includes(String(node.tagName || '').toUpperCase())) return false;
                    const direct = node.matches('a[href]') && validHref(node);
                    const nestedAnchors = [...node.querySelectorAll('a[href]')].filter(validHref);
                    const nested = nestedAnchors.length > 0;
                    if (args.itemKind === 'DIRECT_ANCHOR') return direct;
                    if (args.itemKind === 'WRAPPER_WITH_ANCHOR') return !direct && nested;
                    if (args.itemKind === 'CUSTOM_URL_ATTRIBUTE') {
                        return validPrimaryUrl(relativeNode(node, primaryLinkXpath));
                    }
                    // 第一阶段一旦判定为 NO_ANCHOR，后续完全按无 A 结构推导。
                    // DOM 中即使残留被忽略的动作 A，也不再读取或依赖之前的 A 记录。
                    return true;
                };
                const directItems = [...container.children]
                    .filter(node => node.tagName === sample.tagName)
                    .filter(node => sameClasses(structuralClasses(node), sampleStructuralClasses) ||
                        (useNumberlessClassFallback &&
                         sameClasses(structuralNumberlessClasses(node), sampleNumberlessClasses)) ||
                        hasSameUrlPattern(node))
                    .filter(matchesItemKind);

                // 二维新闻网格：容器可能只是其中一行（例如 2 个 row，
                // 每行 3 个 article card）。当父节点下至少有 2 个同结构行，
                // 且每行都能产生同结构新闻项时，按 DOM 顺序展开全部行。
                // 这里仍以第一阶段已经确认的样本结构为准，不重新猜字段节点。
                const parent = container.parentElement;
                if (parent && directItems.length >= 2) {
                    const containerClasses = classes(container);
                    const peerRows = [...parent.children].filter(node =>
                        node.tagName === container.tagName &&
                        sameClasses(classes(node), containerClasses)
                    );
                    if (peerRows.length >= 2) {
                        const rowItems = peerRows.map(row => [...row.children]
                            .filter(node => node.tagName === sample.tagName)
                            .filter(node => sameClasses(classes(node), sampleClasses))
                            .filter(matchesItemKind));
                        const validRows = rowItems.filter(items => items.length >= 2);
                        const itemCounts = new NativeSet(validRows.map(items => items.length));
                        if (validRows.length === peerRows.length &&
                            itemCounts.size === 1 &&
                            validRows.flat().length > directItems.length) {
                            return deduplicateByPrimaryUrl(validRows.flat())
                                .map(absoluteXpath).filter(Boolean);
                        }
                    }
                }

                return deduplicateByPrimaryUrl(directItems)
                    .map(absoluteXpath)
                    .filter(Boolean);
            }
        """, {
            "containerXpath": selection.container_xpath,
            "sampleXpath": selection.sample_xpath,
            "itemKind": selection.item_kind,
            "linkRelativeXpaths": list(selection.link_relative_xpaths),
            "linkSource": next((
                str(plan.get("source") or "") for plan in selection.link_xpath_plans
                if plan.get("container_recognized")
            ), "@href"),
        })
        return list(result or [])
