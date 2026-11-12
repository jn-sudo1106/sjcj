from typing import Callable, Dict

from core.container_selector import ContainerSelection
from models.field_xpath_plans import FieldXPathPlans


class FieldXPathExtractor:
    """第三阶段：建立字段相对路径，并供逐项完整 XPath 校验使用。"""

    @staticmethod
    def build_plans(
        page,
        selection: ContainerSelection,
        is_flash: bool,
        build_title: Callable,
        build_link: Callable,
        build_date: Callable,
        build_summary: Callable,
        build_external_map: Callable,
    ) -> FieldXPathPlans:
        sample = page.locator(f"xpath=/{selection.sample_xpath.lstrip('/')}").first
        title_plan = build_title(sample)

        # 有无 A 的结论来自第一阶段，第三阶段不得自行切换分支。
        link_plan = None
        external_map: Dict[str, Dict[str, str]] = {}
        if not is_flash:
            recognized_plan = next((
                dict(plan) for plan in selection.link_xpath_plans
                if plan.get("container_recognized")
            ), None)
            if recognized_plan:
                link_plan = recognized_plan
            elif selection.has_anchor:
                link_plan = build_link(
                    sample, selection.link_relative_xpaths, True
                )
            else:
                # 无 A 分支只扫描 URL 特征节点，不复用 A 候选路径。
                # 这里只建立字段候选，不立即做点击/接口 URL 映射。
                # 样本项中的分类、标签等短文本可能暂时被误选为标题；
                # 主流程会先在全部列表项上校验去重率并切换到其他 XPath，
                # 然后才用最终标题调用 build_external_map。
                link_plan = build_link(sample, (), False)

        date_plan = None if is_flash else build_date(page, [selection.sample_xpath])
        summary_plan = build_summary(sample, title_plan, date_plan)
        return FieldXPathPlans(
            title=title_plan,
            link=link_plan,
            date=date_plan,
            summary=summary_plan,
            external_item_map=external_map,
            is_flash=is_flash,
        )
