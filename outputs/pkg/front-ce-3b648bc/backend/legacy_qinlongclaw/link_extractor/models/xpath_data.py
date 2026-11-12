from dataclasses import dataclass
from typing import Optional

@dataclass
class XpathData:
    """对应 C# 中的 XpathData 实体"""
    absolute_path: str = ""
    relative_path: str = ""
    real_path: str = ""
    tag_name: str = ""
    element_id: str = ""
    is_frame: bool = False
    frame_xpath: Optional['XpathData'] = None
