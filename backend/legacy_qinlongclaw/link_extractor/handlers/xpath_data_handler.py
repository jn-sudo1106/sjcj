from typing import List
from models.xpath_data import XpathData
from utils.dom_utils import DomUtils
from utils.xpath_calculator import XPathCalculator

class XPathDataHandler:
    """对应 C# 中的 XpathDataHandler，负责 XPath 与 DOM 节点映射处理"""

    @staticmethod
    def get_element_by_xpath_list(page, xpath_data: XpathData) -> List[str]:
        """
        对应 XpathDataHandler.getElementByXpathList
        根据 XpathData 查找节点并将其全量解析为真实的绝对 XPath 列表
        """
        target_xpath = xpath_data.absolute_path or xpath_data.relative_path
        if not target_xpath:
            return []

        if target_xpath and not target_xpath.startswith('/') and not target_xpath.startswith('.'):
            target_xpath = '/' + target_xpath

        locators = page.locator(f"xpath={target_xpath}").all()
        xpath_results = []

        for loc in locators:
            abs_xpath = DomUtils.get_absolute_xpath(page, loc)
            if abs_xpath and DomUtils.is_valid_xpath(page, abs_xpath):
                xpath_results.append(abs_xpath)

        return xpath_results

    @staticmethod
    def deduce_xpaths_from_sample(page, xpath_data: XpathData) -> List[str]:
        """
        对应 XpathDataHandler / PathCalculate 的推导入口
        """
        if not xpath_data or not (xpath_data.absolute_path or xpath_data.relative_path):
            return []
        if xpath_data.absolute_path and not xpath_data.absolute_path.startswith('/') and not xpath_data.absolute_path.startswith('.'):
            xpath_data.absolute_path = '/' + xpath_data.absolute_path
        # 使用移植自 C# 的 PathCalculate 结构化分析推导逻辑
        return XPathCalculator.cal_xpath_step_one_no_class(page, xpath_data, 0)
