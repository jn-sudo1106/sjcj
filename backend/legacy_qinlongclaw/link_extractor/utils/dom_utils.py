class DomUtils:
    """对应 C# 中的 GeckoHtmlUtil，视角重构为基于 CDP / DOM 节点与 XPath 的转换"""

    JS_GET_ABSOLUTE_XPATH = """
    (xpath) => {
        try {
            const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            let element = res.singleNodeValue;
            if (!element || element.nodeType !== 1) return '';
            const paths = [];
            for (; element && element.nodeType === 1; element = element.parentNode) {
                let index = 0;
                let hasSiblings = false;

                for (let sibling = element.previousSibling; sibling; sibling = sibling.previousSibling) {
                    if (sibling.nodeType === 10) continue;
                    if (sibling.nodeName === element.nodeName) {
                        index++;
                        hasSiblings = true;
                    }
                }
                for (let sibling = element.nextSibling; sibling && !hasSiblings; sibling = sibling.nextSibling) {
                    if (sibling.nodeName === element.nodeName) {
                        hasSiblings = true;
                    }
                }
                const tagName = element.nodeName.toLowerCase();
                const pathIndex = (hasSiblings || index > 0) ? `[${index + 1}]` : '[1]';
                paths.unshift(tagName + pathIndex);
            }
            return paths.length ? '/' + paths.join('/') : '';
        } catch(e) {
            return '';
        }
    }
    """

    @staticmethod
    def get_absolute_xpath(page, target) -> str:
        """从 DOM 节点反向计算绝对 XPath"""
        if not target:
            return ""
        xpath_str = target.raw_xpath if hasattr(target, "raw_xpath") else str(target)
        if xpath_str.startswith("xpath="):
            xpath_str = xpath_str[6:]
        return page.evaluate(DomUtils.JS_GET_ABSOLUTE_XPATH, xpath_str) or ""

    @staticmethod
    def is_valid_xpath(page, xpath: str) -> bool:
        """验证 XPath 在当前页面是否能准确定位元素"""
        if not xpath:
            return False
        try:
            selector = f"xpath={xpath}" if not xpath.startswith("xpath=") else xpath
            return page.locator(selector).count() > 0
        except Exception:
            return False
