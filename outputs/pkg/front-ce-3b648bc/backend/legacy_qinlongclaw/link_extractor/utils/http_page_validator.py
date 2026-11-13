import re


class HttpPageError(RuntimeError):
    """目标页面返回 HTTP 错误，不能继续执行内容识别。"""

    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = int(status or 0)


def detect_http_error_page(html: str) -> tuple[int, str] | None:
    """识别浏览器已渲染的服务器错误页，避免把错误正文当新闻列表。"""
    source = str(html or "")
    title_match = re.search(r"<title[^>]*>(.*?)</title>", source, re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""

    patterns = (
        r"IIS\s*[\d.]*\s*(?:详细错误|Detailed Error)\s*[-–—]\s*(\d{3})(?:\.\d+)?",
        r"HTTP\s*(?:Error\s*)?(\d{3})(?:\.\d+)?",
        r"\b(4\d{2}|5\d{2})(?:\.\d+)?\s*[-–—:]\s*(?:Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)",
    )
    searchable = title or source[:6000]
    certificate_error = (
        "fp-certerror-page-title" in source
        or "aboutNetError.css" in source
        or re.search(r"Warning:\s*Security Risk", searchable, re.I)
    )
    if certificate_error:
        return 495, title or "Firefox certificate error"
    # 部分 WAF/网关不返回可见的 4xx 状态，而是用 HTTP 200 输出统一拒绝页。
    # 将其按 403 处理，交给上层切换代理出口和 Firefox 内核，禁止继续跑
    # 列表识别。要求标题或“拒绝文案 + support ID”组合命中，避免业务正文
    # 偶然出现 requested/rejected 单词时误判。
    request_rejected = (
        re.search(r"^\s*Request\s+Rejected\s*$", title, re.I)
        or (
            re.search(r"The\s+requested\s+URL\s+was\s+rejected", searchable, re.I)
            and re.search(r"support\s+ID", searchable, re.I)
        )
    )
    if request_rejected:
        return 403, title or "Request Rejected"
    # 华为云等 CloudWAF 的拦截模板常以正常 HTTP 响应返回，并在页面中
    # 自行显示 418。“访问被拦截 + 疑似攻击行为 + 事件ID”是明确的拒绝页，
    # 必须交给上层切换出口，不能把它当成一个稳定的业务 DOM。
    block_searchable = f"{title} {source[:6000]}"
    cloud_waf_blocked = (
        re.search(r"访问被拦截|The\s+access\s+is\s+blocked", title, re.I)
        and re.search(
            r"请求疑似攻击行为|appears?\s+to\s+be\s+an\s+attack",
            block_searchable,
            re.I,
        )
        and re.search(r"事件\s*ID|Event\s*ID", block_searchable, re.I)
    )
    if cloud_waf_blocked:
        return 418, title or "CloudWAF access blocked"
    # 阿里云 WAF 未接入协议/端口时通常返回 HTTP 200，但正文只是统一配置
    # 提示页。按 503 处理，禁止进入容器识别；上层可尝试 HTTPS、代理和
    # Firefox，而不是把 WAF 控制台链接误当新闻入口。
    waf_searchable = f"{title} {source}"
    aliyun_waf_unavailable = (
        re.search(
            r"阿里云\s*Web应用防火墙|Alibaba\s+Cloud\s+Web\s+Application\s+Firewall",
            waf_searchable,
            re.I,
        )
        and re.search(
            r"网站暂时无法访问|temporarily\s+inaccessible",
            waf_searchable,
            re.I,
        )
        and re.search(
            r"协议和端口未接入|protocol\s+and\s+port.+not\s+added",
            waf_searchable,
            re.I | re.S,
        )
    )
    if aliyun_waf_unavailable:
        return 503, title or "Alibaba Cloud WAF unavailable"
    # 阿里云虚拟主机的域名未绑定、IP 访问或站点被暂停时，也会返回 HTTP
    # 200 的停放页。它含有“万网主机控制面板”等正常链接，若未在这里
    # 截住，列表识别会把管理控制台按钮错当新闻列表，从而跳过
    # DrissionPage / 代理出口的降级链路。
    aliyun_hosting_stopped = (
        re.search(r"(?:域名未绑定至主机|站点已被网站管理员停止|抱歉[！!]该网站可能由于以下原因无法访问)",
                  waf_searchable, re.I)
        and re.search(r"(?:万网主机控制面板|阿里云虚拟主机控制台)",
                      waf_searchable, re.I)
    )
    if aliyun_hosting_stopped:
        return 503, title or "Alibaba Cloud hosting stop page"
    # IIS 的精简错误页标题常为
    # “404 - File or directory not found.”，并不包含固定的
    # “HTTP Error”前缀。浏览器错误页 title 以明确三位 4xx/5xx 开头时，
    # 可直接使用该状态，避免误入容器识别而跳过代理降级。
    leading_status = re.match(r"^\s*([45]\d{2})(?:\.\d+)?\b", title)
    if leading_status:
        return int(leading_status.group(1)), title
    for pattern in patterns:
        match = re.search(pattern, searchable, re.I)
        if match:
            status = int(match.group(1))
            if 400 <= status <= 599:
                return status, title or f"HTTP {status}"
    return None


def ensure_successful_html(html: str, url: str = "") -> None:
    error = detect_http_error_page(html)
    if error:
        status, description = error
        raise HttpPageError(
            f"目标网页返回 HTTP {status} 错误页，不进入列表识别: "
            f"{description}; URL={url}",
            status=status,
        )
