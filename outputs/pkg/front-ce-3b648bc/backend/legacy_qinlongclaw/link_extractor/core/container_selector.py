from dataclasses import dataclass
from typing import Callable, Optional
from core.table_container_selector import TableContainerSelector
from core.list_container_selector import ListContainerSelector


@dataclass(frozen=True)
class ContainerSelection:
    """第一阶段输出，后续阶段不得重新判断容器或有无 a 标签。"""

    container_xpath: str
    sample_xpath: str
    has_anchor: bool
    item_kind: str
    sample_tag: str
    sample_classes: tuple[str, ...]
    link_relative_xpaths: tuple[str, ...]
    link_xpath_plans: tuple[dict, ...]
    rejected_link_relative_xpaths: tuple[str, ...]
    container_kind: str = "LIST"


class ContainerSelector:
    """容器选择总调度：缓存、TableContainer、ListContainer。"""

    @staticmethod
    def select(
        page,
        cached_sample_xpath: str,
        find_container: Callable,
        find_sample: Callable,
        excluded_container_xpaths=(),
        title_only: bool = False,
    ) -> tuple[Optional[ContainerSelection], bool]:
        """
        返回 (选择结果, 是否来自缓存)。

        未命中缓存时先走统一普通容器识别，完全无结果时才用 Table 兜底。
        """
        # URL.txt 的有效性校验依赖详情链接规律，纯无 URL 模式不能复用。
        sample_xpath = "" if title_only else (cached_sample_xpath or "")
        container_xpath = ""
        from_cache = False
        container_kind = "LIST"
        recognized_link_plan = None

        excluded_container_xpaths = set(excluded_container_xpaths or ())
        if sample_xpath and sample_xpath.rsplit("/", 1)[0] in excluded_container_xpaths:
            sample_xpath = ""
        if sample_xpath:
            locator = page.locator(f"xpath=/{sample_xpath.lstrip('/')}")
            if locator.count() > 0:
                # 缓存只能加速，不能绕过列表样本的基本结构校验。
                # 合法缓存必须属于父容器中数量最多的重复结构组。
                is_repeated_direct_item = bool(locator.first.evaluate(r"""
                    node => {
                        const frame = document.createElement('iframe');
                        frame.style.display = 'none';
                        (document.documentElement || document.body).appendChild(frame);
                        const NativeMap = frame.contentWindow.Map;
                        frame.remove();
                        if (['SCRIPT','STYLE','TEMPLATE','NOSCRIPT','LINK','META','SOURCE']
                            .includes(String(node.tagName || '').toUpperCase())) return false;
                        const parent = node.parentElement;
                        if (!parent) return false;
                        const transient = /^(show|shown|visible|animated|active|aos-init|aos-animate)$/i;
                        const animationClass = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
                        const positionClass = /^(odd|even)$/i;
                        const classes = item => String(item.className || '')
                            .split(/\s+/).filter(Boolean)
                            .filter(cls => !transient.test(cls) && !animationClass.test(cls) &&
                                !positionClass.test(cls))
                            .sort().join('.');
                        const signature = item => {
                            const children = [...item.children].map(child =>
                                child.tagName.toLowerCase() + '.' + classes(child)
                            ).join('|');
                            return item.tagName.toLowerCase() + '#' + classes(item) + '#' + children;
                        };
                        const counts = new NativeMap();
                        [...parent.children].forEach(child => {
                            const key = signature(child);
                            counts.set(key, (counts.get(key) || 0) + 1);
                        });
                        const sampleCount = counts.get(signature(node)) || 0;
                        const dominantCount = Math.max(0, ...counts.values());
                        if (!(sampleCount >= 2 && sampleCount === dominantCount)) return false;

                        // 缓存不能只验证 DOM/class 重复，还要验证链接结构规律。
                        // 否则多个互不相关的外部公司链接也会被误认为新闻列表。
                        const validHref = anchor => {
                            const href = String(anchor && anchor.getAttribute('href') || '').trim();
                            return href && !/^#/.test(href) && !/^javascript:/i.test(href);
                        };
                        const urlSignature = value => {
                            try {
                                const base = /^https?:/i.test(document.baseURI)
                                    ? document.baseURI : 'https://relative.invalid/';
                                const parsed = new URL(String(value || ''), base);
                                return parsed.origin.toLowerCase() + parsed.pathname.toLowerCase() + '?' +
                                    [...parsed.searchParams.keys()].sort().join('&');
                            } catch (_) { return ''; }
                        };
                        const peers = [...parent.children].filter(child => signature(child) === signature(node));
                        const signatures = peers.map(item => {
                            const anchor = item.matches('a[href]') ? item : item.querySelector('a[href]');
                            return validHref(anchor) ? urlSignature(anchor.getAttribute('href')) : '';
                        }).filter(Boolean);
                        // 缓存只保存样本 XPath，没有保存容器阶段识别出的
                        // 自定义 URL 属性。没有有效 href 时必须重新跑容器识别，
                        // 才能把 data-vr 等属性继续传给字段阶段。
                        if (!signatures.length) return false;
                        const patternCounts = new NativeMap();
                        signatures.forEach(value => patternCounts.set(
                            value, (patternCounts.get(value) || 0) + 1
                        ));
                        return Math.max(0, ...patternCounts.values()) / peers.length >= 0.6;
                    }
                """))
                if is_repeated_direct_item:
                    container_xpath = sample_xpath.rsplit("/", 1)[0]
                    from_cache = True
                    parent_tag = str(locator.first.evaluate(
                        "node => node.parentElement ? node.parentElement.tagName : ''"
                    ) or "").upper()
                    if str(locator.first.evaluate(
                        "node => node.tagName"
                    ) or "").upper() == "TR" and parent_tag in {"TBODY", "TABLE"}:
                        container_kind = "TABLE"
                else:
                    sample_xpath = ""
            else:
                sample_xpath = ""

        if not sample_xpath:
            # table 只是页面结构标签，不能天然优先于 ul/div 等普通列表。
            # 先让所有容器接受相同的 URL、标题、日期和区域语义筛选；只有
            # 普通容器完全没有结果时，才启用表格行专用兜底。
            container_kind = "LIST"
            list_selection = ListContainerSelector.select(
                page,
                find_container,
                find_sample,
                excluded_container_xpaths,
                title_only=title_only,
            )
            if list_selection:
                container_xpath = str(list_selection["containerXpath"])
                sample_xpath = str(list_selection["sampleXpath"])
                if list_selection.get("linkXpath") and list_selection.get("linkSource"):
                    recognized_link_plan = {
                        "xpath": str(list_selection["linkXpath"]),
                        "source": str(list_selection["linkSource"]),
                        "container_recognized": True,
                    }
            elif not title_only:
                table_selection = TableContainerSelector.select(page)
                if (table_selection and str(
                    table_selection.get("containerXpath") or ""
                ) in excluded_container_xpaths):
                    table_selection = None
                if not table_selection:
                    return None, False
                container_kind = "TABLE"
                container_xpath = str(table_selection["containerXpath"])
                sample_xpath = str(table_selection["sampleXpath"])
                print(
                    "[TableFallback] 普通容器未识别成功，按有效表格行兜底: "
                    f"{container_xpath}; 有效行={table_selection.get('itemCount')}/"
                    f"{table_selection.get('totalRows')}; 样本={sample_xpath}"
                )
            else:
                return None, False
            if not sample_xpath:
                return None, False

        sample = page.locator(f"xpath=/{sample_xpath.lstrip('/')}").first
        item_meta = sample.evaluate(r"""
            node => {
                // 页面可能用第三方地图脚本覆盖 window.Map/window.Set。
                // 字段元数据必须使用隔离 realm 的原生集合实现。
                const frame = document.createElement('iframe');
                frame.style.display = 'none';
                (document.documentElement || document.body).appendChild(frame);
                const NativeMap = frame.contentWindow.Map;
                const NativeSet = frame.contentWindow.Set;
                frame.remove();
                const valid = anchor => {
                    const href = String(anchor.getAttribute('href') || '').trim();
                    return href && !/^#/.test(href) && !/^javascript:/i.test(href);
                };
                const relativeXpathFrom = (root, target) => {
                    if (target === root) return '.';
                    const parts = [];
                    let current = target;
                    while (current && current !== root) {
                        let index = 1;
                        for (let prev = current.previousElementSibling; prev; prev = prev.previousElementSibling) {
                            if (prev.tagName === current.tagName) index++;
                        }
                        parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
                        current = current.parentElement;
                    }
                    return current === root ? './' + parts.join('/') : '';
                };
                const relativeXpath = target => relativeXpathFrom(node, target);
                const transient = /^(show|shown|visible|animated|active|aos-init|aos-animate)$/i;
                const animationClass = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
                const positionClass = /^(odd|even)$/i;
                const structuralClasses = item => String(item.className || '')
                    .split(/\s+/).filter(Boolean)
                    .filter(cls => !transient.test(cls) && !animationClass.test(cls) &&
                        !positionClass.test(cls)).sort();
                const classes = structuralClasses(node);
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
                const siblingItems = node.parentElement
                    ? [...node.parentElement.children].filter(item =>
                        item.tagName === node.tagName &&
                        sameClasses(structuralClasses(item), classes))
                    : [node];
                // 第一阶段只有在“新闻区域 + 独立详情 URL + 标题 + 日期”
                // 全部成立时才会放行单条 A 候选。该强证据候选在字段阶段
                // 必须允许 1/1 覆盖，否则链接会再次被旧的至少两项门槛否决。
                const minimumCoverage = siblingItems.length === 1
                    ? 1 : Math.max(2, Math.ceil(siblingItems.length / 2));
                const cleanText = target => String(
                    target && (target.innerText || target.textContent) || ''
                ).replace(/\s+/g, ' ').trim();
                const isActionText = value => /^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载|read\s*more|details?|more|view)[>》›»+＋→]*$/i.test(
                    String(value || '').replace(/\s+/g, '')
                );
                const isDateText = value => {
                    const pure = String(value || '').replace(/^[\s\[\(\{【（\xa0]*(?:(?:发布|更新|录入|发表|创建)?(?:时间|日期)|date|time|posted\s*on)?[:：\s]*/i, '').replace(/[\s\]\)\}】）\xa0]*$/, '').trim();
                    return /^(?:\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,2}[-/.月]\d{1,2}(?:日)?)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(pure);
                };

                // 链接文字相同并不等于链接错误。若同一列表项内存在稳定的标题
                // XPath，并且标题逐条不同，则统一的“查看更多”仍是有效详情入口。
                const titleStats = new NativeMap();
                siblingItems.forEach((item, itemIndex) => {
                    const candidates = [];
                    if (/^H[1-6]$/.test(item.tagName)) candidates.push(item);
                    candidates.push(...item.querySelectorAll(
                        'h1,h2,h3,h4,h5,h6,[class*="title" i],[class*="headline" i],[class*="subject" i]'
                    ));
                    const seen = new NativeSet();
                    for (const titleNode of candidates) {
                        const value = cleanText(titleNode);
                        const xpath = relativeXpathFrom(item, titleNode);
                        if (!xpath || !value || value.length < 2 || value.length > 300 ||
                            isActionText(value) || isDateText(value) || seen.has(xpath)) continue;
                        seen.add(xpath);
                        if (!titleStats.has(xpath)) {
                            titleStats.set(xpath, {items: new NativeSet(), values: new NativeSet()});
                        }
                        const stat = titleStats.get(xpath);
                        stat.items.add(itemIndex);
                        stat.values.add(value);
                    }
                });
                const stableTitleEntry = [...titleStats.entries()].find(([_, stat]) =>
                    stat.items.size >= minimumCoverage &&
                    stat.values.size === stat.items.size
                );
                const hasStableDistinctTitle = Boolean(stableTitleEntry);
                const stableTitleXpath = stableTitleEntry ? stableTitleEntry[0] : '';

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
                const findIdPlan = records => {
                    const stats = new NativeMap();
                    records.forEach((record, recordIndex) => {
                        const seen = new NativeSet();
                        for (const candidate of [record.item, ...record.item.querySelectorAll('*')]) {
                            const xpath = relativeXpathFrom(record.item, candidate);
                            if (!xpath) continue;
                            for (const attr of idAttrs) {
                                const value = String(candidate.getAttribute && candidate.getAttribute(attr) || '').trim();
                                if (!value || value.length > 128 || /\s/.test(value)) continue;
                                if (attr === 'id' && !/^(?:\d+|[a-f0-9-]{8,})$/i.test(value)) continue;
                                const key = attr + '|' + xpath;
                                if (seen.has(key)) continue;
                                seen.add(key);
                                if (!stats.has(key)) stats.set(key, {
                                    attr, xpath, records: new NativeSet(), values: new NativeSet()
                                });
                                const stat = stats.get(key);
                                stat.records.add(recordIndex);
                                stat.values.add(value);
                            }
                        }
                    });
                    return [...stats.values()].find(stat =>
                        stat.records.size === records.length &&
                        stat.values.size === records.length
                    ) || null;
                };
                const composeValue = (base, identifier, param) => {
                    const raw = String(base || '').trim();
                    const id = String(identifier || '').trim();
                    if (!raw || !id) return raw;
                    if (/\{(?:id|contentId|newsId|articleId|itemId)\}/i.test(raw)) {
                        return raw.replace(
                            /\{(?:id|contentId|newsId|articleId|itemId)\}/i,
                            encodeURIComponent(id)
                        );
                    }
                    try {
                        const parsed = new URL(raw, document.baseURI || location.href);
                        parsed.searchParams.set(param || 'id', id);
                        return parsed.href;
                    } catch (_) {
                        const sep = raw.includes('?') ? '&' : '?';
                        return raw + sep + encodeURIComponent(param || 'id') + '=' + encodeURIComponent(id);
                    }
                };

                const anchors = [];
                if (node.matches && node.matches('a[href]') && valid(node)) anchors.push(node);
                anchors.push(...[...node.querySelectorAll('a[href]')].filter(valid));
                const directAnchor = node.matches && node.matches('a[href]') && valid(node);
                const linkStats = anchors.map(anchor => {
                    const xpath = relativeXpath(anchor);
                    const records = siblingItems.map(item => {
                        let target = item;
                        if (xpath !== '.') {
                            target = document.evaluate(
                                xpath, item, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                            ).singleNodeValue;
                        }
                        if (!(target && target.matches && target.matches('a[href]') && valid(target))) {
                            return null;
                        }
                        return {
                            item,
                            href: String(target.getAttribute('href') || '').trim(),
                            text: cleanText(target)
                        };
                    }).filter(Boolean);
                    const rawDistinct = new NativeSet(records.map(record => record.href)).size;
                    const idPlan = rawDistinct === records.length ? null : findIdPlan(records);
                    const resolvedValues = records.map(record => {
                        if (!idPlan) return record.href;
                        const idNode = idPlan.xpath === '.' ? record.item : document.evaluate(
                            idPlan.xpath, record.item, null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                        const identifier = String(idNode && idNode.getAttribute(idPlan.attr) || '').trim();
                        return composeValue(record.href, identifier, idParam(idPlan.attr));
                    });
                    const nonEmptyTexts = records.map(record => record.text).filter(Boolean);
                    const repeatedText = records.length >= 3 &&
                        nonEmptyTexts.length / records.length >= 0.6 &&
                        new NativeSet(nonEmptyTexts).size === 1;
                    const isActionLink = repeatedText && isActionText([...new NativeSet(nonEmptyTexts)][0]);
                    const emptyText = records.length >= 2 &&
                        nonEmptyTexts.length / records.length <= 0.2;
                    return {
                        xpath, source: '@href', count: records.length,
                        distinctCount: new NativeSet(resolvedValues).size,
                        repeatedText,
                        isActionLink,
                        emptyText,
                        idXpath: idPlan ? idPlan.xpath : '',
                        idSource: idPlan ? '@' + idPlan.attr : '',
                        idParam: idPlan ? idParam(idPlan.attr) : ''
                    };
                }).filter(stat => stat.xpath);
                const usableLinkStats = linkStats.filter(stat =>
                    stat.count >= minimumCoverage && stat.distinctCount === stat.count &&
                    (!stat.repeatedText || stat.isActionLink || stat.emptyText || hasStableDistinctTitle));
                const linkPlans = usableLinkStats.map(stat => {
                    let fallbackXpath = '';
                    const anchorNode = stat.xpath === '.' ? node : document.evaluate(
                        stat.xpath, node, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                    ).singleNodeValue;
                    if (anchorNode) {
                        const token = String(anchorNode.className || '').split(/\s+/).find(t => /title|tit|name|link|item|detail|article|news/i.test(t));
                        if (token && /^[\w-]+$/.test(token) && node.querySelectorAll('.' + CSS.escape(token)).length === 1) {
                            fallbackXpath = `.//*[contains(concat(' ', normalize-space(@class), ' '), ' ${token} ')]`;
                        }
                    }
                    return {
                        xpath: stat.xpath,
                        source: stat.source,
                        // 该路径已经在容器全部同级项上通过覆盖率和 URL
                        // 逐项唯一校验。字段阶段可据此接受有明确内容路径的
                        // 跨域活动/文章链接，不再局限于固定外站白名单。
                        container_recognized: true,
                        id_xpath: stat.idXpath,
                        id_source: stat.idSource,
                        id_param: stat.idParam,
                        title_xpath: stableTitleXpath,
                        fallback_xpath: fallbackXpath
                    };
                });
                return {
                    // A/无A只区分 URL 的取得方式，最终 URL 和标题规则保持一致。
                    hasAnchor: usableLinkStats.length > 0,
                    itemKind: !usableLinkStats.length ? 'NO_ANCHOR' :
                        (directAnchor ? 'DIRECT_ANCHOR' : 'WRAPPER_WITH_ANCHOR'),
                    sampleTag: node.tagName.toLowerCase(),
                    sampleClasses: classes,
                    linkXpaths: usableLinkStats.map(stat => stat.xpath),
                    linkPlans,
                    rejectedLinkXpaths: linkStats
                        .filter(stat => stat.count < minimumCoverage ||
                            stat.distinctCount !== stat.count ||
                            (stat.repeatedText && !stat.isActionLink && !hasStableDistinctTitle))
                        .map(stat => stat.xpath),
                };
            }
        """) or {}
        if recognized_link_plan and not item_meta.get("hasAnchor"):
            # 容器阶段可能从 data-vr 等站点自定义属性识别出 URL。
            # 字段阶段必须复用该属性，不能退回固定属性白名单。
            item_meta["hasAnchor"] = True
            item_meta["itemKind"] = "CUSTOM_URL_ATTRIBUTE"
            item_meta["linkXpaths"] = [recognized_link_plan["xpath"]]
            item_meta["linkPlans"] = [recognized_link_plan]

        if title_only:
            # 纯无 URL 模式从第一阶段起就清空所有链接结论，后续阶段只能
            # 依靠标题路径和文本结构推导列表。
            item_meta["hasAnchor"] = False
            item_meta["itemKind"] = "NO_ANCHOR"
            item_meta["linkXpaths"] = []
            item_meta["linkPlans"] = []
            item_meta["rejectedLinkXpaths"] = []

        return ContainerSelection(
            container_xpath=container_xpath,
            sample_xpath=sample_xpath,
            has_anchor=bool(item_meta.get("hasAnchor")),
            item_kind=str(item_meta.get("itemKind") or "NO_ANCHOR"),
            sample_tag=str(item_meta.get("sampleTag") or ""),
            sample_classes=tuple(item_meta.get("sampleClasses") or []),
            link_relative_xpaths=tuple(item_meta.get("linkXpaths") or []),
            link_xpath_plans=tuple(item_meta.get("linkPlans") or []),
            rejected_link_relative_xpaths=(
                tuple(item_meta.get("rejectedLinkXpaths") or [])
                if bool(item_meta.get("hasAnchor")) else ()
            ),
            container_kind=container_kind,
        ), from_cache
