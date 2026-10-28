class XPathPathUtils:
    """XPath 路径拼接工具，不归属于 LIST 或 TABLE 提取算法。"""

    @staticmethod
    def full_xpath(item_xpath: str, relative_xpath: str) -> str:
        item = "/" + str(item_xpath or "").strip().lstrip("/").rstrip("/")
        relative = str(relative_xpath or ".").strip()
        if relative == ".":
            return item
        if relative.startswith("./"):
            return item + "/" + relative[2:]
        return item + "/" + relative.lstrip("/")
