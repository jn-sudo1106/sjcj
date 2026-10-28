from abc import ABC, abstractmethod
from typing import Any

class ActionBase(ABC):
    """对应 C# QinLong.Actions.ActionBase"""

    def __init__(self, action_name: str = "BaseAction"):
        self.action_name = action_name
        self.operating_obj: Any = None
        self.run_result: Any = None
        self.last_error_msg: str = ""

    def bind_operating_object(self, obj: Any):
        self.operating_obj = obj

    @abstractmethod
    def run(self, page) -> bool:
        pass
