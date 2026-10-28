from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class FieldXPathPlans:
    """字段提取策略的统一输出模型。"""

    title: Optional[Dict[str, str]]
    link: Optional[Dict[str, str]]
    date: Optional[Dict[str, str]]
    summary: Optional[Dict[str, str]]
    external_item_map: Dict[str, Dict[str, str]]
    is_flash: bool
