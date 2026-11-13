import pandas as pd
from typing import List, Dict
from actions.base_action import ActionBase
from models.xpath_data import XpathData
from handlers.xpath_data_handler import XPathDataHandler

class ExtractLinkListAction(ActionBase):
    """对应 C# QinLong.Actions.ExtractLinkListAction"""

    def __init__(self):
        super().__init__(action_name="提取链接列表")
        self.url: str = ""
        self.list_link: List[str] = []
        self.operating_obj = XpathData()

    def run(self, page) -> bool:
        """对应 C# ExtractLinkListAction.Run 核心流程"""
        try:
            self.url = page.url
            xpath_data: XpathData = self.operating_obj
            if not xpath_data or not (xpath_data.absolute_path or xpath_data.relative_path):
                self.last_error_msg = "XpathData 配置为空"
                return False

            # 步骤 1: 直接获取节点列表绝对 XPath
            self.list_link = XPathDataHandler.get_element_by_xpath_list(page, xpath_data)

            # 步骤 2: 若直接匹配结果 <= 1，触发智能推导
            if len(self.list_link) <= 1:
                deduced_links = XPathDataHandler.deduce_xpaths_from_sample(page, xpath_data)
                if len(deduced_links) > len(self.list_link):
                    self.list_link = deduced_links

            if not self.list_link:
                self.last_error_msg = f"提取链接列表失败，找不到元素：{xpath_data.absolute_path}"
                return False

            # 步骤 3: 抓取数据并构造 DataFrame (对应 ExecuteSnatchList)
            records: List[Dict[str, str]] = []
            for idx, item_xpath in enumerate(self.list_link, start=1):
                locator = page.locator(f"xpath={item_xpath}")
                if locator.count() > 0:
                    text = self._get_element_clean_text(locator)
                    # 1. 优先获取自身的 href/src 属性
                    href = locator.get_attribute("href") or locator.get_attribute("src") or ""

                    # 2. 如果自身没有，向上寻找祖先节点中的 <a> 标签
                    if not href:
                        try:
                            ancestor_a = locator.locator("xpath=ancestor-or-self::a").first
                            if ancestor_a.count() > 0:
                                href = ancestor_a.get_attribute("href") or ""
                        except Exception:
                            pass

                    # 3. 如果仍未找到，向下寻找子元素中的 <a> 标签
                    if not href and locator.locator("a").count() > 0:
                        a_elem = locator.locator("a").first
                        href = a_elem.get_attribute("href") or ""
                        if not text:
                            text = self._get_element_clean_text(a_elem)

                    # 4. 如果仍未找到（例如单页应用中通过 div 绑定 click 事件跳转，无 <a> 标签）
                    # 尝试向上寻找拥有数字 ID 属性的祖先节点来拼接详情页链接
                    if not href:
                        try:
                            curr = locator
                            for _ in range(6):
                                parent = curr.locator("xpath=..")
                                if parent.count() > 0:
                                    node_id = parent.get_attribute("id") or ""
                                    if node_id.isdigit():
                                        import urllib.parse
                                        parsed_url = urllib.parse.urlparse(page.url)
                                        query_params = urllib.parse.parse_qs(parsed_url.query)
                                        query_params['id'] = [node_id]
                                        new_query = urllib.parse.urlencode(query_params, doseq=True)
                                        href = urllib.parse.urlunparse((
                                            parsed_url.scheme,
                                            parsed_url.netloc,
                                            parsed_url.path,
                                            parsed_url.params,
                                            new_query,
                                            parsed_url.fragment
                                        ))
                                        break
                                    curr = parent
                                else:
                                    break
                        except Exception:
                            pass

                    # 5. 如果是相对路径，自动转换为绝对路径
                    if href:
                        import urllib.parse
                        href = urllib.parse.urljoin(page.url, href)

                    records.append({
                        "Index": str(idx),
                        "Text": text,
                        "Url": href,
                        "Xpath": item_xpath
                    })

            dt = pd.DataFrame(records)
            if dt.empty:
                self.run_result = None
                return False

            self.run_result = dt
            return True

        except Exception as ex:
            self.last_error_msg = f"执行异常: {str(ex)}"
            self.run_result = None
            return False

    def _get_element_clean_text(self, locator) -> str:
        """获取清洗后的节点文本，避免把描述/时间等其他节点的文字合并进来"""
        try:
            text = locator.evaluate("""
                (el) => {
                    // 1. 优先获取 h1-h6 标题标签的文本
                    const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
                    for (let i = 0; i < headings.length; i++) {
                        const hText = headings[i].innerText.trim();
                        if (hText) return hText;
                    }
                    
                    // 2. 优先获取含有 title/tit/name 类名的子标签的文本
                    const titleNodes = el.querySelectorAll('[class*="title"], [class*="tit"], [class*="name"]');
                    for (let i = 0; i < titleNodes.length; i++) {
                        if (titleNodes[i] === el) continue;
                        const tText = titleNodes[i].innerText.trim();
                        if (tText) return tText;
                    }
                    
                    // 3. 克隆并剥离常见的非标题性子标签（如描述、摘要、时间等）
                    const clone = el.cloneNode(true);
                    const toRemove = clone.querySelectorAll('span, em, p, .desc, .summary, .time, .date, .pic, img, svg, button');
                    toRemove.forEach(node => {
                        node.parentNode.removeChild(node);
                    });
                    const cleaned = clone.innerText.trim();
                    if (cleaned) return cleaned;
                    
                    return el.innerText.trim();
                }
            """)
            return (text or "").strip()
        except Exception:
            return (locator.text_content() or "").strip()
