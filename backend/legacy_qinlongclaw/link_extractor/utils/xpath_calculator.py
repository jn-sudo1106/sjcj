# -*- coding: utf-8 -*-
import re
from typing import List, Optional, Dict
from models.xpath_data import XpathData
from utils.dom_utils import DomUtils

# 对应 C# RowNodeNames/checkClassNames
ROW_NODE_NAMES = {"ul", "lo", "div", "li", "tr", "dl", "dd", "table", "a", "article", "section", "main"}
CHECK_CLASS_NAMES = {"ul", "lo", "div", "li", "tr", "dl", "table", "section", "main"}


class PathEntity:
    """对应 C# 中的 PathEntity 结构，表示 XPath 路径链表中的某单个节点实体"""

    def __init__(self):
        self.name: str = ""           # 标签名称 (如 div, li, a)
        self.index: str = ""          # 在同级标签中的 1-based 原始索引
        self.class_name: str = ""     # 节点的 class 属性值
        self.style: str = ""          # 节点的 style 属性值
        self.all_index: List[str] = [] # 该层级节点经算法推导出的所有同级有效索引列表 (如 ['1', '2', '3'])
        self.child_count: int = 0     # 子节点数量


class XPathCalculator:
    """对应 C# 中的 PathCalculate / PathEntityHandler，负责样本 XPath 的智能结构化推导与泛化"""

    @staticmethod
    def get_attr_name_by_xpath(page, xpath: str, attr_name: str) -> str:
        """
        获取指定 XPath 节点的特定 HTML 属性值

        :param page: Playwright Page 对象
        :param xpath: 节点的绝对 XPath
        :param attr_name: 需读取的属性名 (如 'class', 'style')
        :return: 属性字符串值，不存在则返回空字符串
        """
        try:
            locator = page.locator(f"xpath={xpath}")
            if locator.count() > 0:
                return locator.first.get_attribute(attr_name) or ""
        except Exception:
            pass
        return ""

    @staticmethod
    def get_child_nodes_count(page, xpath: str) -> int:
        """
        获取指定 XPath 节点下所有直系子代 DOM 节点的总数量

        :param page: Playwright Page 对象
        :param xpath: 目标节点的 XPath
        :return: 子代节点个数
        """
        try:
            locator = page.locator(f"xpath={xpath}")
            if locator.count() > 0:
                return locator.first.evaluate("element => element.childNodes.length")
        except Exception:
            pass
        return 0

    @staticmethod
    def get_attributes(page, xpath: str) -> Dict[str, str]:
        """
        获取指定 XPath 节点上的全量 HTML 属性字典

        :param page: Playwright Page 对象
        :param xpath: 目标节点的 XPath
        :return: 属性名与属性值映射字典
        """
        try:
            locator = page.locator(f"xpath={xpath}")
            if locator.count() > 0:
                return locator.first.evaluate("""(element) => {
                    const attrs = {};
                    if (element && element.attributes) {
                        for (let i = 0; i < element.attributes.length; i++) {
                            const attr = element.attributes[i];
                            attrs[attr.name] = attr.value;
                        }
                    }
                    return attrs;
                }""")
        except Exception:
            pass
        return {}

    @staticmethod
    def cmp_two_node(ori_xpath: str, new_xpath: str, page) -> bool:
        """
        比较原始样本节点与候选生成节点，判断二者是否属于结构与类型相符的同级列表项

        :param ori_xpath: 原始样本节点的 XPath
        :param new_xpath: 待校验的目标节点 XPath
        :param page: Playwright Page 对象
        :return: 布尔值，True 表示类型与结构匹配
        """
        try:
            ori_locator = page.locator(f"xpath={ori_xpath}")
            new_locator = page.locator(f"xpath={new_xpath}")
            if ori_locator.count() == 0 or new_locator.count() == 0:
                return False

            ori_tag = ori_locator.first.evaluate("el => el.nodeName.toLowerCase()")
            new_tag = new_locator.first.evaluate("el => el.nodeName.toLowerCase()")

            # 节点标签不一致说明不是同类结构
            if ori_tag != new_tag:
                return False

            ori_attrs = XPathCalculator.get_attributes(page, ori_xpath)
            new_attrs = XPathCalculator.get_attributes(page, new_xpath)

            # 列表层的 class 是结构边界。样本有 class 时，候选必须拥有
            # 完全相同的 class 集合；不能因为同为 div/li 就视为同类节点。
            ori_classes = sorted(set(ori_attrs.get("class", "").split()))
            new_classes = sorted(set(new_attrs.get("class", "").split()))
            if ori_classes or new_classes:
                return ori_classes == new_classes

            # 双方都没有 class 时，标签一致即可继续作为同级候选。
            return True
        except Exception:
            pass
        return False

    @staticmethod
    def is_node_none_labels(page, xpath: str) -> bool:
        """
        判断节点是否处于 display:none 样式下
        (项目策略：允许提取 DOM 中预渲染但临时隐藏的列表项，如懒加载或分页卡片，故保留 False)

        :param page: Playwright Page 对象
        :param xpath: 节点 XPath
        :return: 是否过滤
        """
        return False

    @staticmethod
    def get_real_path(array: List[str], index: int) -> str:
        """
        从拆分后的 XPath 数组截取并拼装到指定索引位置的前缀绝对路径

        :param array: XPath 按 '/' 拆分后的段数组
        :param index: 截取的终止索引号
        :return: 拼装后的前缀路径字符串
        """
        path = "/".join(array[:index + 1])
        if not path.startswith('/') and not path.startswith('.'):
            path = "/" + path
        return path

    @staticmethod
    def get_path_entity(array: List[str], index: int, page) -> Optional[PathEntity]:
        """
        将 XPath 文本段解析为结构化的 PathEntity 对象（提取标签名、索引、class 与 style 属性）

        :param array: XPath 按 '/' 拆分后的段数组
        :param index: 当前处理的段索引
        :param page: Playwright Page 对象
        :return: 解析后的 PathEntity 实例
        """
        segment = array[index]
        if not segment:
            return None

        entity = PathEntity()
        first_bracket = segment.find("[")
        if first_bracket == -1:
            entity.name = segment
            entity.index = "1"
        else:
            entity.name = segment[:first_bracket]
            match = re.search(r"\[(\d{1,3})\]", segment)
            if match:
                entity.index = match.group(1)
            else:
                entity.index = ""

        real_path = XPathCalculator.get_real_path(array, index)
        if real_path and real_path != "/":
            entity.class_name = XPathCalculator.get_attr_name_by_xpath(page, real_path, "class")
            entity.style = XPathCalculator.get_attr_name_by_xpath(page, real_path, "style")

        return entity

    @staticmethod
    def convert_xpath_to_path_entity_list(xpath_data: XpathData, page) -> List[PathEntity]:
        """
        将 XpathData 对象中的绝对 XPath 拆解并转换为 PathEntity 节点链表

        :param xpath_data: 包含绝对 XPath 路径的数据模型
        :param page: Playwright Page 对象
        :return: PathEntity 对象列表
        """
        temp_array = xpath_data.absolute_path.split('/')
        path_entity_list = []
        for i in range(len(temp_array)):
            segment = temp_array[i]
            if not segment:
                continue
            if "*" in segment:
                segment = segment.replace("*", "1")
                temp_array[i] = segment
            entity = XPathCalculator.get_path_entity(temp_array, i, page)
            if entity:
                path_entity_list.append(entity)
        return path_entity_list

    @staticmethod
    def ensure_prefix(path: str, original_path: str) -> str:
        """
        校验并格式化 XPath 路径前缀（保证格式统一以 '/' 或 '//' 开头）

        :param path: 生成的路径字符串
        :param original_path: 参照的原始路径字符串
        :return: 修正前缀后的标准 XPath
        """
        if not path:
            return path
        if original_path.startswith('//'):
            if path.startswith('//'):
                return path
            elif path.startswith('/'):
                return '/' + path
            else:
                return '//' + path
        elif original_path.startswith('/'):
            if path.startswith('/'):
                return path
            else:
                return '/' + path
        return path

    @staticmethod
    def real_path_without_end_by_index(index: int, path_entity_list: List[PathEntity], original_path: str) -> str:
        """
        拼接当前被测试节点之前的父级 XPath 前缀

        :param index: 当前分析节点在链表中的位置
        :param path_entity_list: PathEntity 链表
        :param original_path: 原始 XPath
        :return: 父级 XPath 前缀
        """
        parts = []
        for i in range(index):
            ent = path_entity_list[i]
            part = ent.name
            if ent.index:
                part += f"[{ent.index}]"
            parts.append(part)
        parts.append(path_entity_list[index].name)
        raw_path = "/".join(parts)
        return XPathCalculator.ensure_prefix(raw_path, original_path)

    @staticmethod
    def real_path_end_by_index(index: int, path_entity_list: List[PathEntity]) -> str:
        """
        拼接当前被测试节点之后的子级 XPath 后缀（保留原始绝对索引）

        :param index: 当前分析节点在链表中的位置
        :param path_entity_list: PathEntity 链表
        :return: 子级绝对索引后缀
        """
        parts = []
        for i in range(index + 1, len(path_entity_list)):
            ent = path_entity_list[i]
            part = ent.name
            if ent.index:
                part += f"[{ent.index}]"
            parts.append(part)
        if not parts:
            return ""
        return "/" + "/".join(parts)

    @staticmethod
    def relate_path_end_by_index(index: int, path_entity_list: List[PathEntity]) -> str:
        """
        拼接当前被测试节点之后的子级 XPath 后缀（若有 class 优先使用 class 谓词筛选）

        :param index: 当前分析节点在链表中的位置
        :param path_entity_list: PathEntity 链表
        :return: 子级相对 class 后缀
        """
        parts = []
        for i in range(index + 1, len(path_entity_list)):
            ent = path_entity_list[i]
            if ent.class_name:
                part = f"{ent.name}[@class='{ent.class_name}'][1]"
            else:
                part = ent.name
                if ent.index:
                    part += f"[{ent.index}]"
            parts.append(part)
        if not parts:
            return ""
        return "/" + "/".join(parts)

    @staticmethod
    def get_repeat_count_up(xpath_head: str, page, path_entity: PathEntity, xpath_end: str, relate_xpath_end: str) -> List[str]:
        """
        向前向上扫描同级兄弟列表节点（如 index-1, index-2...）

        :param xpath_head: 节点前缀 XPath
        :param page: Playwright Page 对象
        :param path_entity: 当前被探查的 PathEntity
        :param xpath_end: 后缀 XPath (绝对索引)
        :param relate_xpath_end: 后缀 XPath (class 谓词)
        :return: 扫描到的有效前置索引号列表
        """
        try:
            i = int(path_entity.index) - 1
        except ValueError:
            return []

        all_index = []
        need_check_class = path_entity.name.lower() in CHECK_CLASS_NAMES

        if need_check_class:
            while i > 0:
                temp_xpath = f"{xpath_head}[{i}]"
                ori_xpath = f"{xpath_head}[{path_entity.index}]"

                cmp_attr = XPathCalculator.cmp_two_node(ori_xpath, temp_xpath, page)

                has_end = page.locator(f"xpath={temp_xpath}{xpath_end}").count() > 0
                has_relate_end = page.locator(f"xpath={temp_xpath}{relate_xpath_end}").count() > 0 if relate_xpath_end else True

                if cmp_attr and (has_end or has_relate_end):
                    all_index.append(str(i))
                else:
                    found_prev = False
                    for jump in range(1, 4):
                        if i - jump > 0:
                            temp_xpath2 = f"{xpath_head}[{i - jump}]"
                            if page.locator(f"xpath={temp_xpath2}{xpath_end}").count() > 0:
                                found_prev = True
                                break
                    if found_prev:
                        i -= 1
                        continue
                    else:
                        break
                i -= 1
        else:
            while i > 0:
                temp_xpath = f"{xpath_head}[{i}]"
                if page.locator(f"xpath={temp_xpath}").count() > 0:
                    all_index.append(str(i))
                else:
                    found_prev = False
                    for jump in range(1, 4):
                        if i - jump > 0:
                            temp_xpath2 = f"{xpath_head}[{i - jump}]"
                            if page.locator(f"xpath={temp_xpath2}").count() > 0:
                                found_prev = True
                                break
                    if found_prev:
                        i -= 1
                        continue
                    else:
                        break
                i -= 1
        return all_index

    @staticmethod
    def get_repeat_count_down(xpath_head: str, page, path_entity: PathEntity, xpath_end: str, relate_xpath_end: str, limit: int) -> List[str]:
        """
        向后向下扫描同级兄弟列表节点（如 index+1, index+2...）

        :param xpath_head: 节点前缀 XPath
        :param page: Playwright Page 对象
        :param path_entity: 当前被探查的 PathEntity
        :param xpath_end: 后缀 XPath (绝对索引)
        :param relate_xpath_end: 后缀 XPath (class 谓词)
        :param limit: 最大获取数量限制 (0 为不限制)
        :return: 扫描到的有效后置索引号列表
        """
        try:
            i = int(path_entity.index)
        except ValueError:
            return []

        count = 0
        all_index = []
        need_check_class = path_entity.name.lower() in CHECK_CLASS_NAMES

        if need_check_class:
            while True:
                if 0 < limit < count:
                    break

                temp_xpath = f"{xpath_head}[{i}]"
                ori_xpath = f"{xpath_head}[{path_entity.index}]"

                if XPathCalculator.is_node_none_labels(page, temp_xpath):
                    i += 1
                    continue

                has_end = page.locator(f"xpath={temp_xpath}{xpath_end}").count() > 0
                has_relate_end = page.locator(f"xpath={temp_xpath}{relate_xpath_end}").count() > 0 if relate_xpath_end else True

                cmp_attr = XPathCalculator.cmp_two_node(ori_xpath, temp_xpath, page)

                if cmp_attr and (has_end or has_relate_end):
                    count += 1
                    all_index.append(str(i))
                else:
                    found_next = False
                    for jump in range(1, 4):
                        temp_xpath2 = f"{xpath_head}[{i + jump}]"
                        if page.locator(f"xpath={temp_xpath2}{xpath_end}").count() > 0:
                            found_next = True
                            break
                    if found_next:
                        i += 1
                        continue
                    else:
                        break
                i += 1
        else:
            while True:
                if 0 < limit < count:
                    break

                temp_xpath = f"{xpath_head}[{i}]"
                if page.locator(f"xpath={temp_xpath}").count() > 0:
                    count += 1
                    all_index.append(str(i))
                else:
                    found_next = False
                    for jump in range(1, 4):
                        temp_xpath2 = f"{xpath_head}[{i + jump}]"
                        if page.locator(f"xpath={temp_xpath2}").count() > 0:
                            found_next = True
                            break
                    if found_next:
                        i += 1
                        continue
                    else:
                        break
                i += 1
        return all_index

    @staticmethod
    def get_repeat_count(xpath_head: str, page, path_entity: PathEntity, xpath_end: str, relate_xpath_end: str, limit: int) -> List[str]:
        """
        汇总向上与向下双向扫描结果，获取某层级节点的所有可用同级索引号列表

        :param xpath_head: 节点前缀 XPath
        :param page: Playwright Page 对象
        :param path_entity: 当前被探查的 PathEntity
        :param xpath_end: 后缀 XPath (绝对索引)
        :param relate_xpath_end: 后缀 XPath (class 谓词)
        :param limit: 抓取上限
        :return: 全部可用的索引号字符串列表
        """
        all_index = []
        index_up = XPathCalculator.get_repeat_count_up(xpath_head, page, path_entity, xpath_end, relate_xpath_end)
        index_down = XPathCalculator.get_repeat_count_down(xpath_head, page, path_entity, xpath_end, relate_xpath_end, limit)

        if index_up:
            all_index.extend(reversed(index_up))
        if index_down:
            all_index.extend(index_down)

        if not all_index:
            all_index.append(path_entity.index)

        return all_index

    @staticmethod
    def get_min_change_index(path_entity_list: List[PathEntity]) -> int:
        """
        计算允许发生索引变异推导的最外层起算节点位置（避免穿透 iframe 等边界）

        :param path_entity_list: PathEntity 链表
        :return: 最外层允许起算的索引位置
        """
        for i in range(len(path_entity_list) - 1, -1, -1):
            if "iframe" in path_entity_list[i].name:
                return i
        return 0

    @staticmethod
    def is_change_index(index: int, page, path_entity_list: List[PathEntity], limit: int, original_path: str) -> List[str]:
        """
        检查特定层级节点是否属于行/列表级节点，若符合则触发同级扩展计算

        :param index: 当前节点在链表中的位置
        :param page: Playwright Page 对象
        :param path_entity_list: PathEntity 链表
        :param limit: 抓取上限
        :param original_path: 原始绝对 XPath
        :return: 该节点对应的全量可扩展索引号列表
        """
        entity = path_entity_list[index]
        if entity.name.lower() not in ROW_NODE_NAMES:
            return [entity.index]
        else:
            path_without_end = XPathCalculator.real_path_without_end_by_index(index, path_entity_list, original_path)
            path_end = XPathCalculator.real_path_end_by_index(index, path_entity_list)
            relate_path_end = XPathCalculator.relate_path_end_by_index(index, path_entity_list)
            return XPathCalculator.get_repeat_count(path_without_end, page, entity, path_end, relate_path_end, limit)

    @staticmethod
    def calculate_change_path(page, path_entity_list: List[PathEntity], limit: int, original_path: str):
        """
        遍历 PathEntity 链表，为每一个支持扩展的节点计算并赋值 all_index 属性

        :param page: Playwright Page 对象
        :param path_entity_list: PathEntity 链表
        :param limit: 抓取上限
        :param original_path: 原始绝对 XPath
        """
        if not path_entity_list:
            return

        min_ch_index = XPathCalculator.get_min_change_index(path_entity_list)

        # 列表 XPath 只能有一个“变异层”。从样本末端向上寻找第一个
        # 存在多个同级节点的层级，将它确定为列表层后立即停止。
        # 旧实现会同时扩展多个 div 层并做笛卡尔积，导致 XPath 跨出原容器。
        change_index = None
        change_values: List[str] = []
        for i in range(len(path_entity_list) - 1, min_ch_index, -1):
            values = XPathCalculator.is_change_index(
                i, page, path_entity_list, limit, original_path
            )
            if len(values) > 1:
                change_index = i
                change_values = values
                break

        for i, entity in enumerate(path_entity_list):
            if i == change_index:
                # 数字排序保证最终 XPath 按 DOM 同级索引有序输出。
                entity.all_index = sorted(
                    set(change_values), key=lambda value: int(value)
                )
            else:
                entity.all_index = [entity.index]

    @staticmethod
    def get_list_xpath_new(now_xpath_list: List[str], i: int, path_entity_list: List[PathEntity]) -> List[str]:
        """
        笛卡尔积组合当前层级节点的所有变异索引与上一层级产生的路径列表

        :param now_xpath_list: 已生成的前缀 XPath 列表
        :param i: 当前计算的节点层级
        :param path_entity_list: PathEntity 链表
        :return: 组合后的最新前缀 XPath 列表
        """
        xpath_list = []
        entity = path_entity_list[i]
        if len(now_xpath_list) == 0:
            indices = entity.all_index if entity.all_index else [entity.index]
            for idx in indices:
                part = entity.name
                if idx:
                    part += f"[{idx}]"
                xpath_list.append(part)
        else:
            for xpath in now_xpath_list:
                indices = entity.all_index if entity.all_index else [entity.index]
                for idx in indices:
                    part = entity.name
                    if idx:
                        part += f"[{idx}]"
                    xpath_list.append(f"{xpath}/{part}")
        return xpath_list

    @staticmethod
    def get_all_xpath_new(path_entity_list: List[PathEntity], original_path: str) -> List[str]:
        """
        根据填充完毕的 PathEntity 链表递归生成全量推导出的 DOM XPath 列表

        :param path_entity_list: 已计算完成 all_index 的 PathEntity 链表
        :param original_path: 原始参照绝对 XPath
        :return: 生成的全部 XPath 路径字符串列表
        """
        if not path_entity_list:
            return []

        xpath_list = []
        for i in range(len(path_entity_list)):
            xpath_list = XPathCalculator.get_list_xpath_new(xpath_list, i, path_entity_list)

        final_paths = []
        for path in xpath_list:
            final_paths.append(XPathCalculator.ensure_prefix(path, original_path))

        return final_paths

    @staticmethod
    def is_region(page, xpath: str) -> bool:
        """
        判断输入的 XPath 路径是否属于包含多个同级直系列表项的父容器区域

        :param page: Playwright Page 对象
        :param xpath: 待判定的 XPath 路径
        :return: 是否为父容器区域
        """
        try:
            locator = page.locator(f"xpath={xpath}")
            if locator.count() == 0:
                return False
            return locator.first.evaluate("""(element) => {
                if (!element || !element.children) return false;
                const visibleChildren = Array.from(element.children).filter(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
                });
                return visibleChildren.length >= 4;
            }""")
        except Exception:
            return False

    @staticmethod
    def cal_xpath_from_region(page, xpath: str) -> List[str]:
        """
        当输入为父容器区域时，直接从容器直系子节点中解析全量列表项绝对 XPath

        :param page: Playwright Page 对象
        :param xpath: 父容器的 XPath
        :return: 容器下所有主导列表项节点的绝对 XPath 列表
        """
        try:
            # 1. 优先提取容器下占主导地位标签类型的直系子节点
            child_xpaths = page.locator(f"xpath={xpath}").first.evaluate("""
                (container) => {
                    function getAbsoluteXpath(element) {
                        if (!element || element.nodeType !== 1) return '';
                        if (element.tagName.toLowerCase() === 'html') return 'html[1]';
                        if (element.tagName.toLowerCase() === 'body') return 'html[1]/body[1]';
                        let ix = 0;
                        const siblings = element.parentNode ? element.parentNode.childNodes : [];
                        for (let i = 0; i < siblings.length; i++) {
                            const sibling = siblings[i];
                            if (sibling === element) {
                                return getAbsoluteXpath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                            }
                            if (sibling.nodeType === 1 && sibling.tagName === element.tagName) ix++;
                        }
                        return '';
                    }
                    if (!container || !container.children || container.children.length === 0) return [];
                    const tagCounts = {};
                    Array.from(container.children).forEach(c => {
                        tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1;
                    });
                    const dominantTag = Object.keys(tagCounts).sort((a,b) => tagCounts[b] - tagCounts[a])[0];
                    return Array.from(container.children)
                        .filter(c => c.tagName === dominantTag)
                        .map(getAbsoluteXpath);
                }
            """) or []

            valid_child_xpaths = [xp for xp in child_xpaths if xp and DomUtils.is_valid_xpath(page, xp)]
            if len(valid_child_xpaths) >= 2:
                return valid_child_xpaths

            # 2. 备选方案：提取容器下所有包含链接文本的 <a> 标签
            locators = page.locator(f"xpath={xpath}//a").all()
            xpath_results = []
            for loc in locators:
                abs_xpath = DomUtils.get_absolute_xpath(page, loc)
                if abs_xpath and DomUtils.is_valid_xpath(page, abs_xpath):
                    xpath_results.append(abs_xpath)
            return xpath_results
        except Exception:
            return []

    @staticmethod
    def cal_xpath_step_one_no_class(page, xpath_data: XpathData, limit: int = 0) -> List[str]:
        """
        单样本/容器 XPath 智能推导的主入口 (对应 C# 中的 PathCalculate.CalXpathStepOneNoClass 核心实现)

        :param page: Playwright Page 对象
        :param xpath_data: 样本/容器 XPath 数据模型
        :param limit: 提取列表上限 (0 为不限制)
        :return: 智能泛导出的全量列表项绝对 XPath 列表
        """
        original_path = xpath_data.absolute_path
        if original_path.startswith('//') or not original_path.startswith('/html'):
            try:
                locator = page.locator(f"xpath={original_path}")
                if locator.count() > 0:
                    abs_xpath = DomUtils.get_absolute_xpath(page, locator.first)
                    if abs_xpath:
                        xpath_data = XpathData(
                            absolute_path=abs_xpath,
                            relative_path=xpath_data.relative_path,
                            real_path=xpath_data.real_path,
                            tag_name=xpath_data.tag_name,
                            element_id=xpath_data.element_id,
                            is_frame=xpath_data.is_frame,
                            frame_xpath=xpath_data.frame_xpath
                        )
            except Exception:
                pass

        original_path = xpath_data.absolute_path
        if XPathCalculator.is_region(page, original_path):
            return XPathCalculator.cal_xpath_from_region(page, original_path)
        else:
            path_entity_list = XPathCalculator.convert_xpath_to_path_entity_list(xpath_data, page)
            XPathCalculator.calculate_change_path(page, path_entity_list, limit, original_path)
            xpath_list = XPathCalculator.get_all_xpath_new(path_entity_list, original_path)

            # 校验生成路径的 DOM 真实有效性
            valid_xpaths = []
            for xpath in xpath_list:
                if DomUtils.is_valid_xpath(page, xpath):
                    valid_xpaths.append(xpath)
            return valid_xpaths
