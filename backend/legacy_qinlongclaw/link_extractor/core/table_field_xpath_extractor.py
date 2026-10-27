from typing import Callable, Dict, List

from core.container_selector import ContainerSelection
from models.field_xpath_plans import FieldXPathPlans


class TableFieldXPathExtractor:
    """第三阶段（TABLE）：按 tr/td/th 的字段标签建立相对 XPath。"""

    @staticmethod
    def build_plans(
        page,
        selection: ContainerSelection,
        item_xpaths: List[str],
        build_link: Callable,
        build_date: Callable,
        build_external_map: Callable,
    ) -> FieldXPathPlans:
        sample = page.locator(f"xpath=/{selection.sample_xpath.lstrip('/')}").first
        candidate_title_plans = sample.evaluate(r"""
            root => {
                const relativeXpath = node => {
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
                };
                const plans = [];
                const seen = new Set();
                const addNode = node => {
                    const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (text.length < 4 || text.length > 300) return;
                    if (/(?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(text)) return;
                    const xpath = relativeXpath(node);
                    if (xpath && !seen.has(xpath)) {
                        seen.add(xpath);
                        plans.push({xpath, source: 'text'});
                    }
                };

                const dateOnly = text => /^\(?\s*(?:(?:19|20)\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,2}[/.\-]\d{1,2}[/.\-](?:19|20)\d{2})\s*\)?$/.test(text);
                const isActionWord = text => /^(?:查看详细|查看更多|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载|read\s*more|details?|more|view)\+?$/i.test(text);
                const validAnchor = node => {
                    const href = String(node.getAttribute('href') || '').trim();
                    return href && href !== '#' && !/^javascript:/i.test(href);
                };

                // 候选 1：标题标签及 class 包含 title 的节点
                for (const node of [
                    ...root.querySelectorAll('h1, h2, h3, h4, h5, h6'),
                    ...root.querySelectorAll('[class*="title" i], [class*="headline" i]')
                ]) {
                    addNode(node);
                }

                // 候选 2：包含有效链接的 A 节点文本
                for (const node of root.querySelectorAll('td a[href], th a[href]')) {
                    if (!validAnchor(node)) continue;
                    const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (dateOnly(text) || isActionWord(text)) continue;
                    addNode(node);
                }

                // 候选 3：表格直属单元格 TD / TH 文本
                for (const cell of root.querySelectorAll(':scope > td, :scope > th')) {
                    const text = String(cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
                    if (dateOnly(text) || isActionWord(text)) continue;
                    addNode(cell);
                }
                return plans;
            }
        """)

        # 对表格每列文本在多行之间进行重复度判断：
        # 如果某一列的文本在多行中高度重复（如静态“查看详细”按钮、固定分类词等），排除该列作为标题的可能性。
        title_plan = None
        for plan in candidate_title_plans or []:
            values = []
            for item_xpath in item_xpaths[:15]:
                full_xpath = selection.sample_xpath if plan["xpath"] == "." else f"{item_xpath}/{plan['xpath'].lstrip('./')}"
                try:
                    locator = page.locator(f"xpath=/{full_xpath.lstrip('/')}").first
                    if locator.count() > 0:
                        val = str(locator.evaluate("node => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim()") or "").strip()
                        if val:
                            values.append(val)
                except Exception:
                    pass

            if not values:
                continue

            unique_count = len(set(values))
            total_count = len(values)
            min_required = total_count if total_count <= 5 else max(3, (total_count + 1) // 2)
            if unique_count < min_required or (total_count > 1 and unique_count / total_count < 0.5):
                print(f"[TableTitle] 排除列文本高度重复的候选标题 XPath (仅 {unique_count}/{total_count} 个独立值): {plan['xpath']}")
                continue

            title_plan = plan
            break
        link_plan = build_link(sample, selection.link_relative_xpaths if selection.has_anchor else ())
        date_plan = build_date(page, item_xpaths)
        summary_plan = sample.evaluate(r"""
            (root, excluded) => {
                const relativeXpath = node => {
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
                };
                const blocked = new Set(excluded || []);
                const titleXpath = (excluded || [])[0] || '';
                const titleNode = titleXpath ? document.evaluate(
                    titleXpath, root, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue : null;
                const nodes = [
                    ...root.querySelectorAll('[class*="summary" i], [class*="desc" i], h3'),
                    ...root.querySelectorAll('p')
                ];
                for (const node of nodes) {
                    const xpath = relativeXpath(node);
                    const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (titleNode && (node === titleNode || node.contains(titleNode) ||
                        titleNode.contains(node))) continue;
                    if (xpath && !blocked.has(xpath) && text.length >= 4 && text.length <= 1000)
                        return {xpath, source: 'text'};
                }
                return null;
            }
        """, [
            str((title_plan or {}).get("xpath") or ""),
            str((date_plan or {}).get("xpath") or ""),
        ])
        external_map: Dict[str, Dict[str, str]] = {}
        if not link_plan:
            external_map = build_external_map(page, title_plan)
        return FieldXPathPlans(
            title=title_plan,
            link=link_plan,
            date=date_plan,
            summary=summary_plan,
            external_item_map=external_map,
            is_flash=False,
        )
