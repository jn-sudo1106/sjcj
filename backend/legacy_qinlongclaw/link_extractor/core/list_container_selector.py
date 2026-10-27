from typing import Callable, Optional

from core.a_xpath_container_selector import AXPathContainerSelector


class ListContainerSelector:
    """普通新闻列表容器选择；与 table 容器选择完全分文件。"""

    @staticmethod
    def select(
        page,
        find_fallback_container: Callable,
        find_sample: Callable,
        excluded_container_xpaths=(),
        title_only: bool = False,
    ) -> Optional[dict]:
        if title_only:
            # 纯无 URL 新闻只按重复标题/日期/正文结构选择容器。
            # 不运行 A Full XPath 选择器，避免页面内无关导航链接抢占候选。
            container_xpath = find_fallback_container(page) or ""
            if not container_xpath:
                return None
            sample_xpath = find_sample(page, container_xpath) or ""
            if not sample_xpath:
                return None
            print(
                "[ContainerTitleOnly] 已按重复标题特征选择无 URL 新闻容器: "
                f"{container_xpath}"
            )
            return {
                "containerXpath": str(container_xpath),
                "sampleXpath": str(sample_xpath),
                "linkXpath": "",
                "linkSource": "",
            }

        # 第一轮：有 A 标签时按 A Full XPath 规律选择。
        a_selection = AXPathContainerSelector.select(
            page, excluded_container_xpaths
        )
        container_xpath = str(a_selection.get("containerXpath") or "") if a_selection else ""
        sample_xpath = str(a_selection.get("sampleXpath") or "") if a_selection else ""
        # A 只是链接形态，不应天然压过无 A 新闻容器。A 候选缺少日期、
        # 新闻语义和足够标题文本，或本身来自语义兜底时，同时运行无 A
        # 识别；只要找到另一重复业务容器，就优先让强字段证据参与后续处理。
        weak_a_selection = bool(a_selection) and (
            bool(a_selection.get("semanticFallback"))
            or (
                float(a_selection.get("dateRatio") or 0) < 0.5
                and float(a_selection.get("averageLinkText") or 0) <= 16
                and float(a_selection.get("classSemanticScore") or 0) <= 200
            )
        )
        fallback_container = ""
        if not container_xpath or weak_a_selection:
            fallback_container = find_fallback_container(page) or ""
        if fallback_container and (
            not container_xpath or fallback_container != container_xpath
        ):
            print(
                "[ContainerScore] A 候选字段证据较弱，"
                "改用重复标题/日期/点击特征更强的无 A 容器: "
                f"{fallback_container}"
            )
            container_xpath = fallback_container
            sample_xpath = ""
            a_selection = None
        if not container_xpath:
            return None
        # 有A容器直接沿用容器阶段已过滤列表组中的样本，禁止重新扫描
        # 全部直属节点；无A兜底才单独推导样本。
        if not sample_xpath:
            sample_xpath = find_sample(page, container_xpath) or ""
        if not sample_xpath:
            return None
        return {
            "containerXpath": str(container_xpath),
            "sampleXpath": str(sample_xpath),
            "linkXpath": str(a_selection.get("linkXpath") or "") if a_selection else "",
            "linkSource": str(a_selection.get("linkSource") or "") if a_selection else "",
        }
