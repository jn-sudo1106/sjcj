import pandas as pd
import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
from actions.base_action import ActionBase
from core.container_selector import ContainerSelector
from core.field_xpath_extractor import FieldXPathExtractor
from core.list_xpath_deriver import ListXPathDeriver
from core.table_xpath_deriver import TableXPathDeriver
from core.table_field_xpath_extractor import TableFieldXPathExtractor
from utils.runtime_files import ensure_runtime_txt_files
from utils.xpath_path_utils import XPathPathUtils
from core.no_anchor_url_resolver import NoAnchorUrlResolver

class ExtractLinkListAutoAction(ActionBase):
    """全自动网页列表抓取 Action (零样本 XPath 引导)"""

    def __init__(self, require_detail_url: bool = True):
        super().__init__(action_name="全自动提取链接列表")
        self.require_detail_url = bool(require_detail_url)
        self.url: str = ""
        self.list_link: List[str] = []
        self.run_result = None
        self.date_patterns = self._load_date_patterns()
        self.initial_html: str = ""
        self.source_url: str = ""
        self.debug_container_xpath: str = ""
        self.debug_sample_xpath: str = ""
        self._rejected_container_xpaths: set[str] = set()
        self._container_retry_depth: int = 0
        self._container_run_active: bool = False
        runtime_files = ensure_runtime_txt_files()
        self.url_xpath_file = runtime_files["url_cache"]
        self.recent_file = runtime_files["recent"]
        self.no_anchor_url_file = runtime_files["no_anchor_urls"]

    def _save_no_anchor_url(self, url: str) -> None:
        """容器确认无有效 a[href] 后，去重写入无 A 回归清单。"""
        normalized = self._normalize_cache_url(url)
        if not normalized:
            return
        header = "# 无 A 标签 URL 回归清单（每行一个 URL）"
        try:
            lines = self.no_anchor_url_file.read_text(
                encoding="utf-8-sig"
            ).splitlines()
        except OSError:
            lines = []
        existing = {
            self._normalize_cache_url(line)
            for line in lines
            if line.strip() and not line.lstrip().startswith("#")
        }
        if normalized in existing:
            print(f"[NoAnchor] URL 已存在于回归清单: {normalized}")
            return
        clean_lines = [line.rstrip() for line in lines if line.strip()]
        if not clean_lines:
            clean_lines.append(header)
        clean_lines.append(normalized)
        self.no_anchor_url_file.write_text(
            "\n".join(clean_lines) + "\n", encoding="utf-8"
        )
        print(f"[NoAnchor] 已写入无 A 回归清单: {normalized}")

    @staticmethod
    def _normalize_cache_url(url: str) -> str:
        """缓存匹配忽略 URL 片段，保留会影响列表内容的查询参数。"""
        value = str(url or "").strip().rstrip("，,")
        parsed = urllib.parse.urlsplit(value)
        return urllib.parse.urlunsplit((
            parsed.scheme.lower(), parsed.netloc.lower(), parsed.path,
            parsed.query, "",
        ))

    @staticmethod
    def _normalize_detail_url(url: str) -> str:
        """详情去重保留 hash 路由；SPA 常把文章路径和 ID 全放在片段中。"""
        value = str(url or "").strip().rstrip("，,")
        parsed = urllib.parse.urlsplit(value)
        return urllib.parse.urlunsplit((
            parsed.scheme.lower(), parsed.netloc.lower(), parsed.path,
            parsed.query, parsed.fragment,
        ))

    @staticmethod
    def _is_same_site_url(base_url: str, candidate_url: str) -> bool:
        """接受同站点地址，以及具有合法文章/内容路径的跨站新闻链接（如国资委、政府网、官媒、微信等）。"""
        candidate = str(candidate_url or "").strip()
        if not candidate:
            return False
        absolute = urllib.parse.urljoin(str(base_url or ""), candidate)
        parsed = urllib.parse.urlsplit(absolute)
        if parsed.scheme.lower() not in {"http", "https"}:
            return False

        def normalized_host(value: str) -> str:
            host = (urllib.parse.urlsplit(value).hostname or "").lower().rstrip(".")
            return host[4:] if host.startswith("www.") else host

        base_host = normalized_host(base_url)
        candidate_host = normalized_host(absolute)
        if not candidate_host:
            return False
        if base_host and base_host == candidate_host:
            return True
        # 同一官网常把详情页部署到业务子域，例如列表位于
        # www.yuwell.com，详情位于 xsj.yuwell.com。www 归一化后，允许
        # 基础域与其子域双向匹配；不同注册域仍继续走下方严格规则。
        if base_host and (
            candidate_host.endswith("." + base_host)
            or base_host.endswith("." + candidate_host)
        ):
            return True

        path = parsed.path.strip()
        if not path or path == "/":
            return False
        # 微信公众号正文的标准地址。查询参数常包含 mpshare、sharer_shareinfo，
        # 这些是文章分享来源参数，不代表当前 URL 是普通“分享页”。必须先于
        # 下方 share/sharer 通用排除规则放行。
        if (candidate_host == "mp.weixin.qq.com" and
                (path == "/s" or path.startswith("/s/"))):
            return True
        # 社交分享平台排除
        share_patterns = ["share", "sharer", "oauth", "login", "register", "cas", "sso", "beian.miit.gov.cn", "beian.gov.cn"]
        if any(sp in absolute.lower() for sp in share_patterns):
            return False
        # 合法跨站文章路径通常有子目录、扩展名或ID
        if (candidate_host == "weixin.qq.com" or candidate_host.endswith(".weixin.qq.com")):
            return True
        if (candidate_host.endswith(".gov.cn") or candidate_host.endswith(".edu.cn") or
                candidate_host.endswith(".org.cn") or candidate_host.endswith(".news.cn") or
                candidate_host.endswith(".xinhuanet.com") or candidate_host.endswith(".people.com.cn") or
                candidate_host.endswith(".cctv.com") or candidate_host.endswith(".chinanews.com.cn")):
            return True
        # 其他具有明确内容路径的跨站 URL（如 .../123.html, .../detail/..., .../article/...）
        if re.search(r'\.(?:s?html?|php|jsp|aspx?)|/(?:article|content|news|detail|item|p|s|view|show|post)/|\d{4,}', path, re.I):
            return True
        return False

    def _load_cached_sample_xpath(self, url: str) -> str:
        """从 URL.txt 读取“URL<TAB>样本XPath”映射。"""
        target = self._normalize_cache_url(url)
        try:
            for raw_line in self.url_xpath_file.read_text(encoding="utf-8-sig").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split("\t", 1)
                if len(parts) == 2 and self._normalize_cache_url(parts[0]) == target:
                    return parts[1].strip()
        except OSError:
            pass
        return ""

    def _save_cached_sample_xpath(self, url: str, xpath: str) -> None:
        """新增或更新 URL 对应的已验证样本 XPath。"""
        normalized_url = self._normalize_cache_url(url)
        entries: List[tuple[str, str]] = []
        try:
            for raw_line in self.url_xpath_file.read_text(encoding="utf-8-sig").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "\t" not in line:
                    continue
                old_url, old_xpath = line.split("\t", 1)
                if self._normalize_cache_url(old_url) != normalized_url:
                    entries.append((old_url.strip(), old_xpath.strip()))
        except OSError:
            pass
        entries.append((normalized_url, xpath.strip()))
        content = "# URL<TAB>已验证的列表样本XPath\n" + "\n".join(
            f"{entry_url}\t{entry_xpath}" for entry_url, entry_xpath in entries
        ) + "\n"
        try:
            self.url_xpath_file.write_text(content, encoding="utf-8")
        except OSError as ex:
            print(f"[!] 保存 URL XPath 缓存失败: {ex}")

    def _save_recent_result(
        self,
        url: str,
        container_xpath: str,
        sample_xpath: str,
        item_xpaths: List[str],
    ) -> None:
        """覆盖保存最近一次成功推导的 URL、容器和全部列表项 XPath。"""
        lines = [
            f"URL: {self._normalize_cache_url(url)}",
            f"ContainerXPath: {container_xpath}",
            f"SampleXPath: {sample_xpath}",
            f"ItemCount: {len(item_xpaths)}",
            "ItemXPaths:",
        ]
        lines.extend(f"{index}. {xpath}" for index, xpath in enumerate(item_xpaths, start=1))
        from queue_url_history import record_url
        record_url(url, 'ListExtracted', container_xpath, sample_xpath, item_xpaths)
        try:
            self.recent_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        except OSError as ex:
            print(f"[!] 保存最近一次 XPath 结果失败: {ex}")
            raise

    def _wait_for_dom_stability(self, page, timeout_ms: int = 10000) -> None:
        """等待网页 DOM 结构稳定（通过检查节点数和 HTML 长度是否停止发生变化来判断 Ajax 加载完成）"""
        print("正在等待页面 DOM 结构稳定 (通过检测网页内容变化)...")
        js_code = """
        (timeout) => {
            return new Promise((resolve) => {
                let lastHTML = document.body ? document.body.innerHTML : '';
                let lastNodeCount = document.getElementsByTagName('*').length;
                let stableChecks = 0;
                let elapsed = 0;
                const intervalTime = 400; // 每 400ms 检查一次
                const minimumWait = 3000; // 至少等待 3 秒，避免接口返回前的短暂静止
                
                const timer = setInterval(() => {
                    const currentHTML = document.body ? document.body.innerHTML : '';
                    const currentNodeCount = document.getElementsByTagName('*').length;
                    elapsed += intervalTime;
                    
                    // 如果节点数过少（小于 150 个节点），说明页面骨架尚未解析出来，重置稳定次数
                    if (currentNodeCount < 150) {
                        stableChecks = 0;
                    } else if (document.readyState === 'complete' &&
                               currentNodeCount === lastNodeCount &&
                               currentHTML.length === lastHTML.length) {
                        stableChecks++;
                    } else {
                        stableChecks = 0;
                        lastHTML = currentHTML;
                        lastNodeCount = currentNodeCount;
                    }
                    
                    // 至少等待 3 秒，并连续 4 次（1.6秒）无变化后才认为加载完成。
                    if ((elapsed >= minimumWait && stableChecks >= 4) || elapsed >= timeout) {
                        clearInterval(timer);
                        resolve(true);
                    }
                }, intervalTime);
            });
        }
        """
        try:
            page.evaluate(js_code, timeout_ms)
            print("[OK] 网页 DOM 已趋于稳定")
        except Exception as e:
            print(f"[!] 等待 DOM 稳定超时或异常: {e}，直接进行后续解析")

    @staticmethod
    def _scroll_for_lazy_loaded_content(page) -> Dict:
        """分段下拉页面，触发依赖 scroll/IntersectionObserver 的首批列表内容。"""
        print("[LazyLoad] 初次未识别到列表，尝试分段下拉触发懒加载...")
        js_code = r"""
        async (options) => {
            const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
            const root = document.scrollingElement || document.documentElement;
            if (!root || !document.body) {
                return {scrolled: false, contentChanged: false, steps: 0};
            }

            const metrics = () => {
                const body = document.body;
                const validAnchors = Array.from(document.querySelectorAll('a[href]'))
                    .filter(anchor => {
                        const href = String(anchor.getAttribute('href') || '').trim();
                        return href && href !== '#' &&
                            !href.toLowerCase().startsWith('javascript:');
                    }).length;
                return {
                    y: Math.max(window.scrollY || 0, root.scrollTop || 0),
                    height: Math.max(
                        root.scrollHeight || 0,
                        body.scrollHeight || 0,
                        document.documentElement.scrollHeight || 0
                    ),
                    nodes: document.getElementsByTagName('*').length,
                    anchors: validAnchors,
                    textLength: String(body.innerText || '').replace(/\s+/g, '').length
                };
            };

            const initial = metrics();
            let previous = initial;
            let finalState = initial;
            let stableAtBottom = 0;
            let scrolled = false;
            let contentChanged = false;
            let steps = 0;
            const viewport = Math.max(
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                400
            );
            const stepSize = Math.max(320, Math.floor(viewport * 0.8));

            for (let index = 0; index < options.maxSteps; index++) {
                const before = metrics();
                const maxY = Math.max(0, before.height - viewport);
                const targetY = Math.min(maxY, before.y + stepSize);
                if (targetY > before.y + 1) {
                    window.scrollTo({top: targetY, left: 0, behavior: 'auto'});
                    scrolled = true;
                } else {
                    // 已在底部时仍派发一次 scroll，兼容仅监听滚动事件的旧站点。
                    window.dispatchEvent(new Event('scroll'));
                }
                steps++;
                await sleep(options.intervalMs);

                finalState = metrics();
                const materialChange =
                    finalState.anchors >= initial.anchors + 2 ||
                    finalState.nodes >= initial.nodes + 6 ||
                    finalState.textLength >= initial.textLength + 40;
                if (materialChange) {
                    contentChanged = true;
                    // 接口返回后，旧站点常再用 setTimeout 批量插入列表。
                    await sleep(options.settleMs);
                    finalState = metrics();
                    break;
                }

                const currentMaxY = Math.max(0, finalState.height - viewport);
                const atBottom = finalState.y >= currentMaxY - 2;
                const unchanged =
                    finalState.height === previous.height &&
                    finalState.nodes === previous.nodes &&
                    finalState.anchors === previous.anchors &&
                    finalState.textLength === previous.textLength;
                stableAtBottom = atBottom && unchanged ? stableAtBottom + 1 : 0;
                if (stableAtBottom >= options.bottomStableChecks) break;
                previous = finalState;
            }

            return {
                scrolled,
                contentChanged,
                steps,
                startY: initial.y,
                endY: finalState.y,
                startHeight: initial.height,
                endHeight: finalState.height,
                addedNodes: finalState.nodes - initial.nodes,
                addedAnchors: finalState.anchors - initial.anchors,
                addedText: finalState.textLength - initial.textLength
            };
        }
        """
        try:
            result = page.evaluate(
                js_code,
                {
                    "maxSteps": 10,
                    "intervalMs": 550,
                    "settleMs": 900,
                    "bottomStableChecks": 4,
                },
                timeout_ms=15000,
            ) or {}
            print(
                "[LazyLoad] 下拉完成: "
                f"steps={result.get('steps', 0)}, "
                f"scrollY={result.get('startY', 0)}->{result.get('endY', 0)}, "
                f"height={result.get('startHeight', 0)}->{result.get('endHeight', 0)}, "
                f"新增节点={result.get('addedNodes', 0)}, "
                f"新增链接={result.get('addedAnchors', 0)}"
            )
            return result
        except Exception as exc:
            print(f"[LazyLoad] 分段下拉失败，继续使用原页面识别: {exc}")
            return {}

    def run(self, page) -> bool:
        outermost_run = not self._container_run_active
        if outermost_run:
            self._rejected_container_xpaths.clear()
            self._container_retry_depth = 0
            self._container_run_active = True
        try:
            self.url = self.source_url or page.url

            # SSR 原始 HTML 中可能有时间，但前端水合后会把属性覆盖为 0；
            # 必须在等待 DOM 稳定之前先保存文章 ID 与时间戳。
            initial_date_map = self._get_html_timestamp_map(self.initial_html)
            if not initial_date_map:
                initial_date_map = self._get_dom_timestamp_map(page)
            print(f"[Date] 页面初始时间戳数量: {len(initial_date_map)}")
            
            # 步骤 0: 等待网页 DOM 停止发生变化 (Ajax 加载就绪)
            self._wait_for_dom_stability(page)
            
            cached_sample_xpath = (
                self._load_cached_sample_xpath(self.url)
                if self.require_detail_url else ""
            )
            find_container = lambda target_page: self._get_best_xpath_list(
                target_page,
                title_only=not self.require_detail_url,
            )
            selection, sample_from_cache = ContainerSelector.select(
                page,
                cached_sample_xpath,
                find_container,
                self._get_first_item_xpath,
                self._rejected_container_xpaths,
                title_only=not self.require_detail_url,
            )
            if not selection:
                # 有些页面的真实列表初始为空，只有滚动到列表区域后才发起
                # Ajax/IntersectionObserver 请求。首次识别失败时再下拉，避免
                # 正常列表页每次都被强制滚到底。
                lazy_result = self._scroll_for_lazy_loaded_content(page)
                if lazy_result.get("scrolled") or lazy_result.get("contentChanged"):
                    self._wait_for_dom_stability(page, timeout_ms=8000)
                    selection, sample_from_cache = ContainerSelector.select(
                        page,
                        cached_sample_xpath,
                        find_container,
                        self._get_first_item_xpath,
                        self._rejected_container_xpaths,
                        title_only=not self.require_detail_url,
                    )
            if not selection:
                self.last_error_msg = "自动识别列表容器或基础样本失败"
                return False
            best_container_xpath = selection.container_xpath
            first_item_xpath = selection.sample_xpath
            self.debug_container_xpath = best_container_xpath
            self.debug_sample_xpath = first_item_xpath
            if sample_from_cache:
                print(f"[Cache] 命中 URL.txt，跳过列表区域识别: {first_item_xpath}")
            else:
                print(f"[OK] 自动定位到列表父容器: {best_container_xpath}")
                print(f"[OK] 自动确立列表变异样本: {first_item_xpath}")
            print(f"[Container] 有效 a[href]: {selection.has_anchor}")
            if not self.require_detail_url:
                print("[Container] 纯无 URL 模式：容器与列表只按标题特征推导")
            elif not selection.has_anchor:
                self._save_no_anchor_url(self.url)
            print(
                f"[Container] 列表项类型: {selection.item_kind}; "
                f"标签={selection.sample_tag}; class={list(selection.sample_classes)}; "
                f"可用链接相对XPath={list(selection.link_relative_xpaths)}; "
                f"同值排除={list(selection.rejected_link_relative_xpaths)}"
            )

            sample_locator = page.locator(f"xpath=/{first_item_xpath.lstrip('/')}").first
            sample_is_flash = self._is_flash_item(sample_locator)

            # 第二阶段严格按容器类型分派，TABLE 与 LIST 不共享推导算法。
            if selection.container_kind == "TABLE":
                self.list_link = TableXPathDeriver.derive(page, selection)
            else:
                self.list_link = ListXPathDeriver.derive(
                    page, selection, sample_is_flash, self._get_flash_item_xpaths
                )
            if not self.list_link:
                self.last_error_msg = f"列表推导泛化失败，样本节点为: {first_item_xpath}"
                return self._retry_next_container(
                    page, best_container_xpath, self.last_error_msg
                )
            short_titles = self._get_short_candidate_titles(page, self.list_link)
            if len(short_titles) >= 2:
                self.last_error_msg = (
                    "候选容器包含至少两个不超过四字的标题，按导航/栏目排除: "
                    + ", ".join(short_titles[:6])
                )
                print(f"[ContainerReject] {self.last_error_msg}")
                return self._retry_next_container(
                    page, best_container_xpath, self.last_error_msg
                )
            if len(self.list_link) == 1:
                # 第一阶段只有在 news/article 区域且单项同时具备标题、
                # 摘要/日期等多个字段时，才会放行单条 A 新闻候选。
                # 此处不能再用旧的“至少两条”规则否决该强证据兜底。
                if not selection.has_anchor:
                    self.last_error_msg = (
                        "自动列表只推导出 1 条，样本不具备重复列表特征: "
                        f"{first_item_xpath}"
                    )
                    print(f"[!] {self.last_error_msg}")
                    return self._retry_next_container(
                        page, best_container_xpath, self.last_error_msg
                    )
                print(
                    "[List] 当前页面仅有 1 条强证据新闻，保留单条列表项: "
                    f"{first_item_xpath}"
                )

            # 纯无 URL 模式不创建链接字段方案，也不触发接口/点击 URL 恢复。
            if not self.require_detail_url:
                title_xpath_plan = None
                link_xpath_plan = None
                date_xpath_plan = (
                    None if sample_is_flash
                    else self._build_date_xpath_plan(page, self.list_link)
                )
                summary_xpath_plan = None
                external_item_map = {}
            # 第三阶段同样按容器类型分派，禁止 TABLE 进入普通列表字段算法。
            elif selection.container_kind == "TABLE":
                field_plans = TableFieldXPathExtractor.build_plans(
                    page,
                    selection,
                    self.list_link,
                    self._build_link_xpath_plan,
                    self._build_date_xpath_plan,
                    self._get_external_item_map,
                )
            else:
                field_plans = FieldXPathExtractor.build_plans(
                    page,
                    selection,
                    sample_is_flash,
                    self._build_title_xpath_plan,
                    self._build_link_xpath_plan,
                    self._build_date_xpath_plan,
                    self._build_summary_xpath_plan,
                    self._get_external_item_map,
                )
            if self.require_detail_url:
                title_xpath_plan = field_plans.title
                link_xpath_plan = field_plans.link
                date_xpath_plan = field_plans.date
                summary_xpath_plan = field_plans.summary
                external_item_map = field_plans.external_item_map

            # 标题不能只在基础样本上看起来正确，还必须在全部列表项中产生
            # 不同的新闻标题。若所有值相同（例如统一的“了解详情”按钮），
            # 排除该相对 XPath，并按样本候选排序继续尝试下一条。
            if selection.container_kind == "TABLE":
                if title_xpath_plan and not self._title_plan_has_distinct_values(
                    page, self.list_link, title_xpath_plan
                ):
                    title_xpath_plan = None
                if summary_xpath_plan and not self._plan_has_majority_class(
                    page, self.list_link, summary_xpath_plan
                ):
                    summary_xpath_plan = None
                if title_xpath_plan:
                    print(f"[TableTitle] 标题 XPath: {title_xpath_plan['xpath']}")
                if summary_xpath_plan:
                    print(f"[TableSummary] 摘要 XPath: {summary_xpath_plan['xpath']}")
            else:
                title_xpath_plan = None
                for plan in self._build_title_xpath_candidates(sample_locator):
                    if self._title_plan_has_distinct_values(page, self.list_link, plan):
                        title_xpath_plan = plan
                        print(f"[Title] 第一项已确定标题 XPath: {plan['xpath']}")
                        break
                if not title_xpath_plan:
                    print("[Title] 第一项无法确定标题，启用多项50%共识")
                    title_xpath_plan = self._build_consensus_title_xpath_plan(
                        page, self.list_link
                    )
                # 标题候选可能发生切换，摘要排除路径必须基于最终标题重新推导。
                summary_xpath_plan = None
                if title_xpath_plan:
                    first_summary_plan = self._build_summary_xpath_plan(
                        sample_locator, title_xpath_plan, date_xpath_plan
                    )
                    if first_summary_plan and self._plan_has_majority_class(
                        page, self.list_link, first_summary_plan
                    ):
                        summary_xpath_plan = first_summary_plan
                        print(
                            "[Summary] 第一项已确定摘要 XPath: "
                            f"{first_summary_plan['xpath']}"
                        )
                    else:
                        print("[Summary] 第一项无法确定摘要，启用多项50%共识")
                        summary_xpath_plan = self._build_consensus_summary_xpath_plan(
                            page, self.list_link, title_xpath_plan, date_xpath_plan
                        )
            if (self.require_detail_url and not sample_is_flash and
                    selection.has_anchor):
                candidate_link_plans = [
                    dict(plan) for plan in selection.link_xpath_plans
                    if plan and plan.get("xpath")
                ]
                for relative_xpath in selection.link_relative_xpaths:
                    plan = {"xpath": relative_xpath, "source": "@href"}
                    if plan not in candidate_link_plans:
                        candidate_link_plans.append(plan)
                # 链接优先使用容器阶段已经确定并排序的相对 XPath。
                # 字段阶段的样本候选只能作为末尾备选，不能覆盖前面结论。
                if link_xpath_plan and link_xpath_plan not in candidate_link_plans:
                    candidate_link_plans.append(link_xpath_plan)
                link_xpath_plan = None
                for plan in candidate_link_plans:
                    if self._link_plan_has_distinct_values(page, self.list_link, plan):
                        link_xpath_plan = plan
                        break
                    print(
                        "[Link] 链接路径所有值相同或为空，排除并尝试下一条: "
                        f"{plan['xpath']}"
                    )
            elif self.require_detail_url:
                candidate_link_plans = [
                    dict(plan) for plan in selection.link_xpath_plans
                    if plan and plan.get("xpath")
                ]
                if link_xpath_plan:
                    # 先验证原始 URL；只有原始值重复时，才尝试选择器证明稳定的
                    # “基础 URL + 独立 ID”组合计划，避免给本已唯一的 URL 多拼参数。
                    base_plan = dict(link_xpath_plan)
                    for key in ("id_xpath", "id_source", "id_param"):
                        base_plan.pop(key, None)
                    if base_plan not in candidate_link_plans:
                        candidate_link_plans.append(base_plan)
                    if (link_xpath_plan.get("id_xpath") and
                            link_xpath_plan not in candidate_link_plans):
                        candidate_link_plans.append(link_xpath_plan)
                link_xpath_plan = None
                for plan in candidate_link_plans:
                    if self._link_plan_has_distinct_values(page, self.list_link, plan):
                        link_xpath_plan = plan
                        break
                    print(
                        "[Link] 无 A URL 特征路径存在空值或重复值，排除: "
                        f"{plan['xpath']}"
                    )
                if not link_xpath_plan and not external_item_map:
                    external_item_map = self._get_external_item_map(page, title_xpath_plan)
            if (self.require_detail_url and not sample_is_flash and
                    not link_xpath_plan and
                    not external_item_map):
                # 容器中即使混入了统计/埋点 a[href]，过滤后也应进入无直链恢复；
                # 例如可见卡片之外按标题输出的隐藏 SEO 详情锚点。
                external_item_map = self._get_external_item_map(page, title_xpath_plan)
            missing_fields = []
            if not title_xpath_plan:
                if (not self.require_detail_url or
                        not (link_xpath_plan or external_item_map)):
                    missing_fields.append("标题")
            if (self.require_detail_url and not sample_is_flash and
                    not link_xpath_plan and not external_item_map):
                missing_fields.append("链接")
            if missing_fields:
                self.last_error_msg = (
                    f"基础样本错误，无法建立字段相对 XPath: {', '.join(missing_fields)}; "
                    f"样本={first_item_xpath}"
                )
                print(f"[!] {self.last_error_msg}")
                return self._retry_next_container(
                    page, best_container_xpath, self.last_error_msg
                )

            if self.require_detail_url:
                # 字段方案确定后立即按详情 URL 清理推导样本。无 A 列表的 URL
                # 直到标题映射完成后才可获得，因此在这里完成去重。
                self.list_link = self._deduplicate_derived_items(
                    page, self.list_link, title_xpath_plan,
                    link_xpath_plan, external_item_map,
                )
            else:
                # 无 URL 新闻以最终标题相对 XPath 校验列表项：路径必须有值，
                # 且同标题只保留第一项。这样推导结果不再依赖 href/onclick。
                self.list_link = self._filter_derived_items_by_title(
                    page, self.list_link, title_xpath_plan
                )
                if len(self.list_link) < 2:
                    self.last_error_msg = (
                        "标题路径未能推导出至少 2 条不同的无 URL 新闻: "
                        f"{title_xpath_plan['xpath']}"
                    )
                    print(f"[!] {self.last_error_msg}")
                    return self._retry_next_container(
                        page, best_container_xpath, self.last_error_msg
                    )
            title_repr = title_xpath_plan['xpath'] if title_xpath_plan else "(无标题，使用节点/图片/默认占位)"
            link_repr = (
                link_xpath_plan['xpath'] if link_xpath_plan
                else "(无 URL 模式)" if not self.require_detail_url
                else "(接口标题映射)"
            )
            print(
                "[Sample] 已从基础样本建立字段相对 XPath: "
                f"标题={title_repr}, "
                f"链接={link_repr}, "
                f"日期={date_xpath_plan['xpath'] if date_xpath_plan else '(可选，使用时间映射)'}, "
                f"摘要={summary_xpath_plan['xpath'] if summary_xpath_plan else '(可选)'}"
            )

            if not sample_from_cache and self.require_detail_url:
                self._save_cached_sample_xpath(self.url, first_item_xpath)
                print(f"[Cache] 已保存 URL 与已验证样本 XPath 到: {self.url_xpath_file}")

            print(f"[OK] 成功推导出 {len(self.list_link)} 个同级列表项，开始提取数据...")
            # 步骤 4: 抓取文本、URL 与日期
            records: List[Dict[str, str]] = []
            accepted_xpaths: List[str] = []
            seen_detail_urls: set[str] = set()
            list_date_map = initial_date_map or self._get_list_date_map(
                page, len(self.list_link)
            )
            if date_xpath_plan:
                print(
                    "[Date] 已锁定列表日期相对 XPath: "
                    f"{date_xpath_plan['xpath']} ({date_xpath_plan['source']})"
                )
            else:
                print(
                    "[Date] 未锁定统一日期 XPath，保留有效标题"
                    + ("" if not self.require_detail_url else "/链接")
                    + "并使用时间映射补充"
                )
            for idx, item_xpath in enumerate(self.list_link, start=1):
                locator = page.locator(f"xpath={item_xpath}")
                if locator.count() <= 0:
                    continue

                is_flash_item = self._is_flash_item(locator)
                title_full_xpath = XPathPathUtils.full_xpath(
                    item_xpath, title_xpath_plan["xpath"]
                ) if title_xpath_plan else ""
                link_full_xpath = ""
                if not is_flash_item and link_xpath_plan:
                    link_full_xpath = XPathPathUtils.full_xpath(
                        item_xpath, link_xpath_plan["xpath"]
                    )
                date_full_xpath = ""
                if not is_flash_item and date_xpath_plan:
                    date_full_xpath = XPathPathUtils.full_xpath(
                        item_xpath, date_xpath_plan["xpath"]
                    )
                summary_full_xpath = ""
                if summary_xpath_plan:
                    summary_full_xpath = XPathPathUtils.full_xpath(
                        item_xpath, summary_xpath_plan["xpath"]
                    )

                text = self._get_plan_value(page, item_xpath, title_xpath_plan) if title_xpath_plan else ""
                if not text:
                    text = self._get_element_image_alt(page, item_xpath)
                    if not text and (link_xpath_plan or external_item_map):
                        text = f"列表项_{idx}"
                    elif not text:
                        print(f"[XPath] 标题完整 XPath 为空，丢弃列表项: {title_full_xpath}")
                        continue

                mapped_item = external_item_map.get(" ".join(text.split()), {})
                mapped_href = str(
                    mapped_item.get("Url") or mapped_item.get("url") or ""
                ).strip()
                href = mapped_href
                href_from_mapping = bool(mapped_href)
                if not is_flash_item and not href and link_xpath_plan:
                    href = self._get_plan_value(page, item_xpath, link_xpath_plan)
                date = self._get_flash_date(locator) if is_flash_item else ""
                if not is_flash_item and date_xpath_plan:
                    date = self._match_date_value(
                        self._get_plan_value(page, item_xpath, date_xpath_plan)
                    )
                if not is_flash_item and date_xpath_plan and not date:
                    print(f"[XPath] 日期完整 XPath 为空，保留标题和链接: {date_full_xpath}")

                if (href and not href_from_mapping and link_xpath_plan
                        and link_xpath_plan["source"].startswith("@")
                        and link_xpath_plan["source"] != "@href"):
                    href = self._extract_url_feature(href, link_xpath_plan["source"])
                elif (href and not href_from_mapping and link_xpath_plan
                      and link_xpath_plan["source"] != "@href"):
                    parsed_url = urllib.parse.urlparse(page.url)
                    query_params = urllib.parse.parse_qs(parsed_url.query)
                    query_params["id"] = [href]
                    href = urllib.parse.urlunparse((
                        parsed_url.scheme, parsed_url.netloc, parsed_url.path,
                        parsed_url.params,
                        urllib.parse.urlencode(query_params, doseq=True),
                        parsed_url.fragment,
                    ))

                if href and (
                    re.match(r"^(?:javascript|data|about):", href, re.IGNORECASE)
                    or re.search(r"\bvoid\s*\(\s*0\s*\)", href, re.IGNORECASE)
                ):
                    print(f"[Link] 排除无效伪链接: {href}")
                    href = ""
                if (self.require_detail_url and not href and
                        not is_flash_item):
                    print(
                        f"[XPath] 未取得可验证的唯一详情 URL，丢弃列表项: {item_xpath}"
                    )
                    continue
                if href:
                    href = urllib.parse.urljoin(self.url or page.url, href)
                    allow_container_external = bool(
                        link_xpath_plan and
                        link_xpath_plan.get("container_recognized")
                    )
                    parsed_external = urllib.parse.urlsplit(href)
                    external_path_valid = (
                        allow_container_external
                        and parsed_external.scheme.lower() in {"http", "https"}
                        and bool(parsed_external.hostname)
                        and parsed_external.path not in {"", "/"}
                        and not any(marker in href.lower() for marker in (
                            "beian.miit.gov.cn", "beian.gov.cn/portal/",
                            "/login", "/register", "/oauth", "/sso",
                        ))
                    )
                    if (not self._is_same_site_url(self.url or page.url, href)
                            and not external_path_valid):
                        print(f"[Link] 排除跨站详情 URL: {href}")
                        href = ""
                if (self.require_detail_url and not href and
                        not is_flash_item):
                    print(
                        f"[XPath] 未取得同站点详情 URL，丢弃列表项: {item_xpath}"
                    )
                    continue
                normalized_detail_url = str(href or "").strip()
                if normalized_detail_url and normalized_detail_url in seen_detail_urls:
                    print(
                        f"[Dedup] 详情 URL 重复，跳过后续列表项: "
                        f"{normalized_detail_url}"
                    )
                    continue
                if normalized_detail_url:
                    seen_detail_urls.add(normalized_detail_url)

                record = {
                    "Index": str(len(records) + 1),
                    "Text": text,
                    "Url": href,
                    "Xpath": item_xpath,
                }
                if not date and is_flash_item:
                    date = self._get_element_date(locator)
                if mapped_item.get("Date"):
                    date = mapped_item["Date"]
                if not date and href and list_date_map:
                    article_id = urllib.parse.parse_qs(
                        urllib.parse.urlparse(href).query
                    ).get("id", [""])[0]
                    date = list_date_map.get(str(article_id), "")
                if date:
                    record["Date"] = date
                if summary_xpath_plan:
                    summary = self._get_value_by_full_xpath(
                        page, summary_full_xpath, summary_xpath_plan["source"]
                    )
                    cleaned_summary = self._clean_plain_text(summary)
                    if cleaned_summary:
                        record["Summary"] = cleaned_summary
                if mapped_item.get("Summary"):
                    cleaned_mapped = self._clean_plain_text(mapped_item["Summary"])
                    if cleaned_mapped:
                        record["Summary"] = cleaned_mapped
                if record.get("Summary") and (
                    self._clean_plain_text(record["Summary"])
                    == self._clean_plain_text(record["Text"])
                ):
                    # 标题在详情按钮、图片链接等节点中重复时，只保留标题。
                    record.pop("Summary", None)
                records.append(record)
                accepted_xpaths.append(item_xpath)

            if not self.require_detail_url and records:
                from core.list_content_resolver import enrich_content
                records = enrich_content(page, records)
            dt = pd.DataFrame(records)
            if dt.empty:
                self.last_error_msg = (
                    "列表结构已识别，但所有列表项的标题均为空"
                    if not self.require_detail_url
                    else "列表结构已识别，但所有列表项都未取得与标题匹配的唯一详情 URL"
                )
                print(f"[!] {self.last_error_msg}")
                self.run_result = None
                return self._retry_next_container(
                    page, best_container_xpath, self.last_error_msg
                )
            normalized_urls = dt["Url"].fillna("").map(
                lambda value: str(value).strip()
            )
            nonempty_urls = normalized_urls[normalized_urls != ""]
            if nonempty_urls.duplicated().any():
                duplicate_urls = sorted(set(
                    nonempty_urls[nonempty_urls.duplicated(keep=False)].tolist()
                ))
                self.last_error_msg = (
                    "最终链接校验失败：新闻详情 URL 存在重复值: "
                    + ", ".join(duplicate_urls[:3])
                )
                print(f"[!] {self.last_error_msg}")
                self.run_result = None
                return self._retry_next_container(
                    page, best_container_xpath, self.last_error_msg
                )
            self.list_link = accepted_xpaths
            self._save_recent_result(
                self.url, best_container_xpath, first_item_xpath, self.list_link
            )
            print(f"[Recent] 已保存最近一次有效 XPath 结果到: {self.recent_file}")
            self.run_result = dt
            return True

        except Exception as ex:
            self.last_error_msg = f"执行异常: {str(ex)}"
            self.run_result = None
            return False
        finally:
            if outermost_run:
                self._container_run_active = False

    def _retry_next_container(self, page, container_xpath: str, reason: str) -> bool:
        """当前候选通过结构初选但业务验证失败时，改试排序中的下一名。"""
        xpath = str(container_xpath or "").strip()
        if not xpath or xpath in self._rejected_container_xpaths:
            return False
        self._rejected_container_xpaths.add(xpath)
        self._container_retry_depth += 1
        self.list_link = []
        self.run_result = None
        print(
            f"[ContainerFallback] 候选验证失败，排除并尝试下一名 "
            f"(已排除 {self._container_retry_depth} 个): {xpath}; 原因={reason}"
        )
        return self.run(page)

    @staticmethod
    def _get_short_candidate_titles(page, item_xpaths: List[str]) -> List[str]:
        """从已推导的全部列表项中识别短标题，统一拦截导航候选。"""
        try:
            values = page.evaluate(r"""
                itemXpaths => {
                    const actionText = /^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载|read\s*more|details?|more|view)$/i;
                    const dateText = /^(?:(?:19|20)\d{2}[年/.\-]\d{1,2}|\d{1,2}[月/.\-]\d{1,2})/;
                    const result = [];
                    for (const xpath of itemXpaths || []) {
                        const item = document.evaluate(
                            '/' + String(xpath || '').replace(/^\/+/, ''),
                            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                        if (!item) continue;
                        const semanticNodes = Array.from(item.querySelectorAll(
                            'h1,h2,h3,h4,h5,h6,[class*="title" i],'
                            + '[class*="headline" i],[class*="subject" i]'
                        ));
                        const nodes = semanticNodes.length ? semanticNodes : [item];
                        const candidates = nodes.map(node =>
                            String(node.innerText || node.textContent || '')
                                .replace(/\s+/g, '').trim()
                        ).filter(value => value && value.length <= 4 &&
                            !actionText.test(value) && !dateText.test(value));
                        if (candidates.length) {
                            candidates.sort((left, right) => left.length - right.length);
                            result.push(candidates[0]);
                        }
                    }
                    return result;
                }
            """, item_xpaths)
            return [str(value).strip() for value in (values or []) if str(value).strip()]
        except Exception as ex:
            print(f"[ContainerReject] 短标题统一校验异常，保留原候选继续处理: {ex}")
            return []

    @staticmethod
    def _load_date_patterns() -> List[re.Pattern]:
        """从 NewsSnatchConfig.xml 读取中英文新闻时间正则。"""
        config_path = Path(__file__).resolve().parents[1] / "NewsSnatchConfig.xml"
        if not config_path.exists():
            config_path = Path(__file__).resolve().parents[2] / "NewsSnatchConfig.xml"
        patterns: List[re.Pattern] = []
        try:
            root = ET.parse(config_path).getroot()
            for section_name in ("NewsDateFormat", "EnNewsDateFormat"):
                section = root.find(section_name)
                if section is None:
                    continue
                for node in section.findall("Format"):
                    expression = (node.text or "").strip()
                    if not expression:
                        continue
                    try:
                        patterns.append(re.compile(expression, re.IGNORECASE))
                    except re.error as ex:
                        print(f"[!] 忽略无效的时间正则 {expression!r}: {ex}")
        except (OSError, ET.ParseError) as ex:
            print(f"[!] 读取新闻时间配置失败: {ex}")
        return patterns

    @staticmethod
    def _build_title_xpath_plan(locator) -> Optional[Dict[str, str]]:
        """在样本项内确定唯一的标题相对 XPath。"""
        candidates = ExtractLinkListAutoAction._build_title_xpath_candidates(locator)
        return candidates[0] if candidates else None

    @staticmethod
    def _build_title_xpath_candidates(locator) -> List[Dict[str, str]]:
        """按稳定评分返回样本项中的全部标题相对 XPath 候选。"""
        try:
            result = locator.evaluate("""
                root => {
                    const relativeXpath = node => {
                        if (node === root) return '.';
                        const parts = [];
                        while (node && node !== root) {
                            let index = 1;
                            for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
                                if (prev.tagName === node.tagName) index++;
                            }
                            parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
                            node = node.parentElement;
                        }
                        return node === root ? './' + parts.join('/') : '';
                    };
                    const candidates = [];
                    for (const node of [root, ...root.querySelectorAll('*')]) {
                        const text = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                        if (!text || text.length < 4 || text.length > 300) continue;
                        // 日期即使错误地带有 title 类名，也不能参与标题竞争；
                        // 否则短文本优先会把日期误选成标题（兼容带“发布时间：”等前缀）。
                        const pureDate = text.replace(/^[\\s\\[\\(\\{【（\\xa0]*(?:(?:发布|更新|录入|发表|创建)?(?:时间|日期)|date|time|posted\\s*on)?[:：\\s]*/i, '').replace(/[\\s\\]\\)\\}】）\\xa0]*$/, '').trim();
                        if (/^(?:\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}(?:日)?|\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{4}|\\d{1,2}[-/.月]\\d{1,2}(?:日)?|\\d{1,2}\\s+\\d{4}[-/.年]\\d{1,2}(?:月)?)(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?$/.test(pureDate)) continue;
                        if (/^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载|read\\s*more|details?|more|view)[>》›»+＋→]*$/i.test(
                            pureDate.replace(/\\s+/g, '')
                        )) continue;
                        const tag = node.tagName.toLowerCase();
                        const cls = String(node.className || '').toLowerCase();
                        // 年、月日、浏览量等拆分字段不一定长成完整日期（如单独的
                        // “2026”），必须结合 class 排除，避免短文本排序抢过新闻标题。
                        const parentSemantic = String(
                            node.parentElement && node.parentElement.className || ''
                        ).toLowerCase();
                        if (/date|time|year|month|day|count|eye/.test(cls + ' ' + parentSemantic) ||
                            /^\\d{1,7}$/.test(pureDate) ||
                            /^\\d{4}[-/.年]\\d{1,2}(?:月)?$/.test(pureDate) ||
                            /^\\d{1,2}\\s*月\\s*(?:\\/|[-—])?\\s*\\d{1,2}\\s*日?$/.test(pureDate)) continue;
                        let score = 0;
                        const isHeading = /^h[1-6]$/.test(tag);
                        const hasTitleClass = /title|tit|name/.test(cls);
                        const candidateXpath = relativeXpath(node);
                        let fallbackXpath = '';
                        if (hasTitleClass) {
                            const titleToken = String(node.className || '').split(/\\s+/)
                                .find(token => /title|tit|name/i.test(token));
                            if (titleToken && /^[\\w-]+$/.test(titleToken) &&
                                root.querySelectorAll('.' + CSS.escape(titleToken)).length === 1) {
                                fallbackXpath = `.//*[contains(concat(' ', normalize-space(@class), ' '), ' ${titleToken} ')]`;
                            }
                        }
                        if (isHeading) score += 1000;
                        // 表格新闻行按列标签表达字段：h1 是标题，h2 常为日期/发布者，
                        // h3 常为摘要。不能继续使用“更短标题优先”让 h3 抢占标题。
                        if (hasTitleClass) score += 700;
                        if (tag === 'a' && node.getAttribute('href')) score += 400;
                        if (node.children.length === 0) score += 100;
                        // 整张新闻卡片经常以一个 a 包住图片、标题、摘要和日期。
                        // href 只证明它是链接载体，不能让整卡文本压过内部的
                        // strong/h/p 等纯字段节点，否则标题会变成“标题+摘要+日期”，
                        // 真正标题随后还会被摘要识别，形成标题摘要互换。
                        const isCompositeCardLink = tag === 'a' &&
                            Boolean(node.getAttribute('href')) &&
                            Boolean(node.querySelector('p, strong, h1, h2, h3, h4, h5, h6')) &&
                            (node.children.length >= 2 ||
                                node.querySelectorAll('p, strong, h1, h2, h3, h4, h5, h6').length >= 2);
                        if (isCompositeCardLink) score -= 800;
                        // 旧站常用带 tit class 的父节点同时包住“标题链接 + 日期”。
                        // class 语义不能压过字段纯度；存在独立纯日期子节点时，
                        // 应优先选择内部只含标题的 a/h 节点。
                        const hasIndependentDateChild = Array.from(
                            node.querySelectorAll('*')
                        ).some(child => {
                            const childText = String(
                                child.innerText || child.textContent || ''
                            ).replace(/\\s+/g, ' ').trim();
                            return /^(?:19|20)\\d{2}[-/.年]\\d{1,2}[-/.月]\\d{1,2}(?:日)?$/.test(childText);
                        });
                        if (hasIndependentDateChild) score -= 900;
                        // 一个列表项根 a 内同时包含日期、标题、摘要时，根节点
                        // 只是链接载体，不能把全部文本当成标题。
                        if (node === root && node.children.length >= 2) score -= 1000;
                        // 中文新闻标题本身经常以。！？结尾，不能据此扣分或删除。
                        // 只有不含中文的普通句子结尾标点才保留弱摘要惩罚。
                        const hasChineseText = /[\u3400-\u9fff]/.test(text);
                        if (/[。！？.!?]$/.test(text) && !hasChineseText &&
                            !isHeading && !hasTitleClass) score -= 300;
                        // 同一层级存在多个标题候选时，标题通常短于摘要。
                        // 长度只作为同类候选的稳定排序依据，不再给长文本加分。
                        const lengthRank = Math.min(text.length, 300);
                        if (score > 0) candidates.push({
                            xpath: candidateXpath, source: 'text', score,
                            fallback_xpath: fallbackXpath,
                            lengthRank, depth: candidateXpath.split('/').length
                        });
                    }
                    candidates.sort((a, b) =>
                        b.score - a.score ||
                        a.lengthRank - b.lengthRank ||
                        a.depth - b.depth ||
                        a.xpath.localeCompare(b.xpath)
                    );
                    return candidates;
                }
            """)
            return [
                candidate for candidate in (result or [])
                if candidate and candidate.get("xpath")
            ]
        except Exception:
            return []

    @classmethod
    def _build_consensus_title_xpath_plan(
        cls, page, item_xpaths: List[str]
    ) -> Optional[Dict[str, str]]:
        """汇总多个列表项的标题候选，至少覆盖50%才允许成为统一路径。"""
        stats: Dict[tuple[str, str], Dict[str, object]] = {}
        for item_xpath in item_xpaths:
            locator = page.locator(f"xpath=/{item_xpath.lstrip('/')}").first
            if locator.count() == 0:
                continue
            seen = set()
            for plan in cls._build_title_xpath_candidates(locator):
                key = (str(plan.get("xpath") or ""), str(plan.get("source") or "text"))
                if not key[0] or key in seen:
                    continue
                seen.add(key)
                stat = stats.setdefault(key, {
                    "count": 0, "score": 0, "length": 0, "plan": plan,
                })
                stat["count"] += 1
                stat["score"] += int(plan.get("score") or 0)
                stat["length"] += int(plan.get("lengthRank") or 0)
        minimum = cls._multi_item_minimum(len(item_xpaths))
        ranked = [stat for stat in stats.values() if int(stat["count"]) >= minimum]
        ranked.sort(key=lambda stat: (
            -int(stat["count"]),
            -(int(stat["score"]) / max(1, int(stat["count"]))),
            int(stat["length"]) / max(1, int(stat["count"])),
            str(stat["plan"].get("xpath") or ""),
        ))
        for stat in ranked:
            plan = dict(stat["plan"])
            if cls._title_plan_has_distinct_values(page, item_xpaths, plan):
                print(
                    f"[Title] 多项共识标题 XPath: {plan['xpath']}; "
                    f"覆盖={stat['count']}/{len(item_xpaths)}"
                )
                return plan
        return None

    @classmethod
    def _build_consensus_summary_xpath_plan(
        cls, page, item_xpaths: List[str], title_plan, date_plan
    ) -> Optional[Dict[str, str]]:
        """汇总多个列表项的摘要候选，路径和 class 至少覆盖50%。"""
        stats: Dict[tuple[str, str], Dict[str, object]] = {}
        for item_xpath in item_xpaths:
            locator = page.locator(f"xpath=/{item_xpath.lstrip('/')}").first
            if locator.count() == 0:
                continue
            plan = cls._build_summary_xpath_plan(locator, title_plan, date_plan)
            if not plan:
                continue
            key = (str(plan.get("xpath") or ""), str(plan.get("source") or "text"))
            if not key[0]:
                continue
            stat = stats.setdefault(key, {"count": 0, "score": 0, "plan": plan})
            stat["count"] += 1
            stat["score"] += int(plan.get("score") or 0)
        minimum = cls._multi_item_minimum(len(item_xpaths))
        ranked = [stat for stat in stats.values() if int(stat["count"]) >= minimum]
        ranked.sort(key=lambda stat: (
            -int(stat["count"]),
            -(int(stat["score"]) / max(1, int(stat["count"]))),
            str(stat["plan"].get("xpath") or ""),
        ))
        for stat in ranked:
            plan = dict(stat["plan"])
            if cls._plan_has_majority_class(page, item_xpaths, plan):
                print(
                    f"[Summary] 多项共识摘要 XPath: {plan['xpath']}; "
                    f"覆盖={stat['count']}/{len(item_xpaths)}"
                )
                return plan
        return None

    @staticmethod
    def _build_summary_xpath_plan(
        locator, title_plan=None, date_plan=None
    ) -> Optional[Dict[str, str]]:
        """从基础样本确定一次摘要相对 XPath；摘要是可选字段。"""
        try:
            excluded = {
                str((title_plan or {}).get("xpath") or ""),
                str((date_plan or {}).get("xpath") or ""),
            }
            result = locator.evaluate("""
                (root, excludedXpaths) => {
                    const relativeXpath = node => {
                        if (node === root) return '.';
                        const parts = [];
                        while (node && node !== root) {
                            let index = 1;
                            for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
                                if (prev.tagName === node.tagName) index++;
                            }
                            parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
                            node = node.parentElement;
                        }
                        return node === root ? './' + parts.join('/') : '';
                    };
                    const excluded = new Set(excludedXpaths || []);
                    const excludedNodes = Array.from(excluded).map(xpath => {
                        if (!xpath) return null;
                        return document.evaluate(
                            xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                    }).filter(Boolean);
                    const cleanText = node => String(
                        node && (node.innerText || node.textContent) || ''
                    ).replace(/\\s+/g, ' ').trim();
                    const excludedTexts = new Set(
                        excludedNodes.map(cleanText).filter(Boolean)
                    );
                    const candidates = [];
                    for (const node of root.querySelectorAll('*')) {
                        const xpath = relativeXpath(node);
                        if (!xpath || excluded.has(xpath)) continue;
                        // 标题/日期节点的父容器仍包含同一文本，
                        // 不能换一层 XPath 后被误当成摘要。
                        if (excludedNodes.some(excludedNode => node.contains(excludedNode))) continue;
                        const text = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                        // 标题可能在另一个图片/箭头链接中重复出现。即使 XPath
                        // 不同，只要文本与标题完全相同，也不能作为摘要。
                        if (excludedTexts.has(text)) continue;
                        // 摘要是可选长文本字段。“公司新闻”“展会信息”等
                        // 短分类/标签不能因为排除了标题和日期就被填入摘要。
                        // 页面没有合格摘要时应保持为空。
                        if (text.length < 10) continue;
                        const pureDate = text.replace(/^[\\s\\[\\(\\{【（\\xa0]*(?:(?:发布|更新|录入|发表|创建)?(?:时间|日期)|date|time|posted\\s*on)?[:：\\s]*/i, '').replace(/[\\s\\]\\)\\}】）\\xa0]*$/, '').trim();
                        // 摘要常以事件日期开头（如“12月10日-12日，……”）。
                        // 只有整个字段都是日期/时间时才排除，不能用前缀匹配
                        // 丢掉后面仍有正文的有效摘要。
                        if (/^(?:\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}(?:日)?|\\d{1,2}[-/.月]\\d{1,2}(?:日)?)(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?$/.test(pureDate)) continue;
                        const tag = node.tagName.toLowerCase();
                        const cls = String(node.className || '').toLowerCase();
                        if (/category|classify|classification|tag|label|type/.test(cls)) continue;
                        let score = Math.min(text.length, 300);
                        if (/summary|desc|description|abstract|intro|content|brief/.test(cls)) score += 1000;
                        if (tag === 'p') score += 300;
                        if (/[。！？.!?]$/.test(text)) score += 400;
                        if (/^h[1-6]$/.test(tag)) score -= 1000;
                        // 容器节点往往同时包含标题、日期和摘要，不能整块作为摘要。
                        if (node.children.length > 1) score -= 600;
                        candidates.push({xpath, source: 'text', score, length: text.length});
                    }
                    candidates.sort((a, b) =>
                        b.score - a.score || b.length - a.length || a.xpath.localeCompare(b.xpath)
                    );
                    return candidates[0] && candidates[0].score > 0 ? candidates[0] : null;
                }
            """, list(excluded))
            return result if result and result.get("xpath") else None
        except Exception as ex:
            print(f"[Summary] 摘要 XPath 候选计算失败: {ex}")
            return None

    @staticmethod
    def _build_link_xpath_plan(
        locator, allowed_xpaths=(), use_anchor_logic=True
    ) -> Optional[Dict[str, str]]:
        """在样本项内确定唯一的链接相对 XPath。"""
        try:
            result = locator.evaluate(r"""
                (root, args) => {
                    const allowedXpaths = args.allowedXpaths || [];
                    const relativeXpath = node => {
                        if (node === root) return '.';
                        const parts = [];
                        while (node && node !== root) {
                            let index = 1;
                            for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
                                if (prev.tagName === node.tagName) index++;
                            }
                            parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
                            node = node.parentElement;
                        }
                        return node === root ? './' + parts.join('/') : '';
                    };
                    const idAttrs = [
                        'data-content-id','data-news-id','data-article-id','data-item-id',
                        'data-artid','content-id','news-id','article-id','data-id','id'
                    ];
                    const idParam = attr => {
                        const value = String(attr || '').toLowerCase();
                        if (value.includes('content')) return 'contentId';
                        if (value.includes('news')) return 'newsId';
                        if (value.includes('article') || value.includes('artid')) return 'articleId';
                        if (value.includes('item')) return 'itemId';
                        return 'id';
                    };
                    const findIdPlan = () => {
                        for (const node of [root, ...root.querySelectorAll('*')]) {
                            for (const attr of idAttrs) {
                                const value = String(node.getAttribute && node.getAttribute(attr) || '').trim();
                                if (!value || value.length > 128 || /\\s/.test(value)) continue;
                                if (attr === 'id' && !/^(?:\\d+|[a-f0-9-]{8,})$/i.test(value)) continue;
                                return {
                                    id_xpath: relativeXpath(node),
                                    id_source: '@' + attr,
                                    id_param: idParam(attr)
                                };
                            }
                        }
                        return null;
                    };
                    const candidates = [];
                    if (args.useAnchorLogic) {
                        if (root.matches && root.matches('a[href]')) candidates.push(root);
                        candidates.push(...root.querySelectorAll('a[href]'));
                    }
                    const validLinks = [];
                    for (const node of candidates) {
                        const href = String(node.getAttribute('href') || '').trim();
                        const text = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                        const xpath = relativeXpath(node);
                        if (href && !/^#/.test(href) && !/^javascript:/i.test(href) &&
                            (!allowedXpaths.length || allowedXpaths.includes(xpath))) {
                            let score = Math.min(text.length, 200) * 5;
                            if (!text) score += 100;
                            const cls = String(node.className || '').toLowerCase();
                            if (/detail|item[_-]?link|article|news[_-]?link/.test(cls)) score += 600;
                            if (/group|category|tag|classify/.test(cls)) score -= 600;
                            if (href.includes('/c/') || href.includes('/p20')) score += 300;
                            let fallbackXpath = '';
                            const token = String(node.className || '').split(/\s+/).find(t => /title|tit|name|link|item|detail|article|news/i.test(t));
                            if (token && /^[\w-]+$/.test(token) && root.querySelectorAll('.' + CSS.escape(token)).length === 1) {
                                fallbackXpath = `.//*[contains(concat(' ', normalize-space(@class), ' '), ' ${token} ')]`;
                            }
                            validLinks.push({xpath, source: '@href', score, fallback_xpath: fallbackXpath});
                        }
                    }
                    if (validLinks.length) {
                        validLinks.sort((a, b) => b.score - a.score);
                        const best = validLinks[0];
                        return {xpath: best.xpath, source: best.source, fallback_xpath: best.fallback_xpath || ''};
                    }
                    // 无 A 分支不复用前面的 A 候选结论；href 在这里仅作为普通
                    // URL 属性参与节点 XPath 规律提取。
                    const urlAttrs = args.useAnchorLogic
                        ? ['onclick', 'data-url', 'data-href', 'data-link', 'url', 'link']
                        : ['href', 'onclick', 'data-url', 'data-href', 'data-link', 'url', 'link'];
                    const urlCandidates = [];
                    for (const node of [root, ...root.querySelectorAll('*')]) {
                        const text = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                        for (const attr of urlAttrs) {
                            const raw = String(node.getAttribute && node.getAttribute(attr) || '').trim();
                            if (!raw) continue;
                            let value = raw;
                            if (attr === 'onclick') {
                                const matched = raw.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ||
                                    raw.match(/(?:window\.)?open\s*\(\s*['"]([^'"]+)['"]/i);
                                if (!matched) continue;
                                value = matched[1];
                            }
                            if (!value || /^#/.test(value) || /^javascript:\\s*void/i.test(value)) continue;
                            let score = 500 + Math.min(text.length, 200) * 4;
                            if (text.length >= 4) score += 400;
                            const plan = {
                                xpath: relativeXpath(node), source: '@' + attr, score
                            };
                            if (!args.useAnchorLogic) {
                                const idPlan = findIdPlan();
                                if (idPlan) Object.assign(plan, idPlan);
                            }
                            urlCandidates.push(plan);
                        }
                    }
                    if (urlCandidates.length) {
                        urlCandidates.sort((a, b) => b.score - a.score || a.xpath.localeCompare(b.xpath));
                        const best = urlCandidates[0];
                        return {
                            xpath: best.xpath,
                            source: best.source,
                            id_xpath: best.id_xpath || '',
                            id_source: best.id_source || '',
                            id_param: best.id_param || ''
                        };
                    }
                    return null;
                }
            """, {
                "allowedXpaths": list(allowed_xpaths or ()),
                "useAnchorLogic": bool(use_anchor_logic),
            })
            return result if result and result.get("xpath") else None
        except Exception:
            return None

    def _link_plan_has_distinct_values(self, page, item_xpaths, plan: Dict[str, str]) -> bool:
        """A/无A统一校验：推导去重后，路径须充分覆盖且 URL 逐项唯一。"""
        values = []
        for item_xpath in item_xpaths:
            value = ExtractLinkListAutoAction._get_plan_value(page, item_xpath, plan)
            base_url = self.url or str(getattr(page, "url", "") or "")
            allow_container_external = bool(plan.get("container_recognized"))
            external_valid = False
            if value and allow_container_external:
                absolute_candidate = urllib.parse.urljoin(base_url, value.strip())
                candidate_parts = urllib.parse.urlsplit(absolute_candidate)
                candidate_lower = absolute_candidate.lower()
                external_valid = (
                    candidate_parts.scheme.lower() in {"http", "https"}
                    and bool(candidate_parts.hostname)
                    and candidate_parts.path not in {"", "/"}
                    and not any(marker in candidate_lower for marker in (
                        "beian.miit.gov.cn", "beian.gov.cn/portal/",
                        "/login", "/register", "/oauth", "/sso",
                    ))
                )
            if value and (
                self._is_same_site_url(base_url, value) or external_valid
            ):
                absolute = urllib.parse.urljoin(base_url, value.strip())
                parsed = urllib.parse.urlsplit(absolute)
                normalized_query = urllib.parse.urlencode(sorted(
                    urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
                ))
                values.append(urllib.parse.urlunsplit((
                    parsed.scheme.lower(), parsed.netloc.lower(), parsed.path,
                    normalized_query, parsed.fragment,
                )))
        if not values:
            return False
        minimum = ExtractLinkListAutoAction._multi_item_minimum(len(item_xpaths))
        if len(values) < minimum:
            return False
        return len(set(values)) == len(values)

    def _deduplicate_derived_items(
        self, page, item_xpaths: List[str], title_plan: Dict[str, str],
        link_plan: Optional[Dict[str, str]], external_item_map: Dict[str, dict],
    ) -> List[str]:
        """按最终字段方案中的详情 URL 去重推导项，保留 DOM 中首次出现者。"""
        result: List[str] = []
        seen: set[str] = set()
        base_url = self.url or str(getattr(page, "url", "") or "")
        for item_xpath in item_xpaths:
            detail_url = ""
            # 无 A 列表的点击/接口映射已经按标题验证过，优先级必须高于
            # DOM 推导出的兜底链接。否则诸如 href="/" 的占位方案会把
            # 所有真实点击 URL 覆盖成网站首页，并在这里被误判为重复。
            if external_item_map:
                title = self._get_plan_value(page, item_xpath, title_plan)
                mapped = external_item_map.get(" ".join(str(title or "").split()), {})
                detail_url = str(mapped.get("Url") or mapped.get("url") or "").strip()
            if not detail_url and link_plan:
                detail_url = str(self._get_plan_value(page, item_xpath, link_plan) or "").strip()
            key = (
                self._normalize_detail_url(
                    urllib.parse.urljoin(base_url, detail_url)
                )
                if detail_url else ""
            )
            if key and key in seen:
                print(f"[DeriveDedup] 推导阶段移除重复 URL: {key}")
                continue
            if key:
                seen.add(key)
            result.append(item_xpath)
        return result

    @staticmethod
    def _filter_derived_items_by_title(
        page,
        item_xpaths: List[str],
        title_plan: Optional[Dict[str, str]],
    ) -> List[str]:
        """纯无 URL 模式按统一标题路径过滤并去重最终列表项。"""
        if not title_plan:
            return []
        result: List[str] = []
        seen_titles: set[str] = set()
        for item_xpath in item_xpaths:
            title = ExtractLinkListAutoAction._get_plan_value(
                page, item_xpath, title_plan
            )
            normalized = " ".join(str(title or "").split())
            if not normalized:
                print(
                    "[TitleOnly] 标题路径为空，移除推导项: "
                    f"{item_xpath}"
                )
                continue
            if normalized in seen_titles:
                print(f"[TitleOnly] 标题重复，移除后续推导项: {normalized}")
                continue
            seen_titles.add(normalized)
            result.append(item_xpath)
        print(
            "[TitleOnly] 标题路径校验完成: "
            f"保留={len(result)}/{len(item_xpaths)}"
        )
        return result

    @staticmethod
    def _get_element_image_alt(page, item_xpath: str) -> str:
        """从列表项节点提取图片 alt 或 title 属性作为标题占位。"""
        try:
            alt = page.locator(f"xpath=/{item_xpath.lstrip('/')}").evaluate(r"""
                node => {
                    const img = node.querySelector('img[alt], img[title]');
                    if (img) {
                        return (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
                    }
                    return (node.getAttribute('title') || node.getAttribute('alt') || '').trim();
                }
            """)
            return str(alt or "").strip()
        except Exception:
            return ""

    @staticmethod
    def _title_plan_has_distinct_values(page, item_xpaths, plan: Dict[str, str]) -> bool:
        """标题文本需不同，路径和值及同一 class 均至少覆盖50%的列表项。"""
        values = []
        node_classes = []
        for item_xpath in item_xpaths:
            value = ExtractLinkListAutoAction._get_plan_value(page, item_xpath, plan)
            normalized = " ".join(str(value or "").split())
            if normalized:
                values.append(normalized)
                full_xpath = XPathPathUtils.full_xpath(
                    item_xpath, plan.get("xpath", ".")
                )
                locator = page.locator(f"xpath=/{full_xpath.lstrip('/')}").first
                if locator.count() > 0:
                    node_classes.append(" ".join(sorted(
                        str(locator.get_attribute("class") or "").split()
                    )))
        if not values:
            return False
        minimum = ExtractLinkListAutoAction._multi_item_minimum(len(item_xpaths))
        if len(values) < minimum:
            return False
        class_counts: Dict[str, int] = {}
        for class_name in node_classes:
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
        if not class_counts or max(class_counts.values()) < minimum:
            return False
        if len(item_xpaths) <= 1:
            return True
        return len(set(values)) >= max(2, int(len(values) * 0.8))

    @staticmethod
    def _plan_has_majority_class(page, item_xpaths, plan: Dict[str, str]) -> bool:
        """通用字段路径必须在至少50%列表项中有值且节点 class 相同。"""
        minimum = ExtractLinkListAutoAction._multi_item_minimum(len(item_xpaths))
        class_counts: Dict[str, int] = {}
        value_count = 0
        for item_xpath in item_xpaths:
            full_xpath = XPathPathUtils.full_xpath(
                item_xpath, plan.get("xpath", ".")
            )
            locator = page.locator(f"xpath=/{full_xpath.lstrip('/')}").first
            if locator.count() == 0:
                continue
            value = ExtractLinkListAutoAction._get_plan_value(
                page, item_xpath, plan
            )
            if not " ".join(str(value or "").split()):
                continue
            value_count += 1
            class_name = " ".join(sorted(
                str(locator.get_attribute("class") or "").split()
            ))
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
        return (
            value_count >= minimum and bool(class_counts) and
            max(class_counts.values()) >= minimum
        )

    @staticmethod
    def _multi_item_minimum(item_count: int) -> int:
        """至少覆盖50%的列表项（至少2项）。"""
        count = max(0, int(item_count or 0))
        if count <= 2:
            return count
        return (count + 1) // 2

    @staticmethod
    def _clean_plain_text(raw_text: str) -> str:
        """去除 HTML 标签与实体，保留纯文本并规范化空白。"""
        if not raw_text:
            return ""
        text = str(raw_text)
        text = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html.unescape(text)
        return " ".join(text.split()).strip()

    @staticmethod
    def _get_plan_value(page, item_xpath: str, plan: Optional[Dict[str, str]]) -> str:
        """先读取样本推导的位置 XPath；只有为空时才使用稳定 class 备用 XPath。"""
        if not plan:
            return ""
        source = str(plan.get("source") or "text")
        primary = XPathPathUtils.full_xpath(item_xpath, plan.get("xpath", "."))
        value = ExtractLinkListAutoAction._get_value_by_full_xpath(page, primary, source)
        if value:
            id_xpath = str(plan.get("id_xpath") or "").strip()
            id_source = str(plan.get("id_source") or "").strip()
            if id_xpath and id_source:
                identifier = ExtractLinkListAutoAction._get_value_by_full_xpath(
                    page,
                    XPathPathUtils.full_xpath(item_xpath, id_xpath),
                    id_source,
                )
                if identifier:
                    value = ExtractLinkListAutoAction._compose_url_with_id(
                        value,
                        identifier,
                        str(plan.get("id_param") or "id"),
                    )
            return value
        fallback = str(plan.get("fallback_xpath") or "").strip()
        if not fallback:
            return ""
        fallback_full = XPathPathUtils.full_xpath(item_xpath, fallback)
        return ExtractLinkListAutoAction._get_value_by_full_xpath(page, fallback_full, source)

    @staticmethod
    def _compose_url_with_id(base_url: str, identifier: str, param_name: str) -> str:
        """只在选择器已证明 ID 路径稳定且逐条唯一后组合最终 URL。"""
        raw = str(base_url or "").strip()
        item_id = str(identifier or "").strip()
        param = str(param_name or "id").strip() or "id"
        if not raw or not item_id:
            return raw
        placeholder = re.search(
            r"\{(?:id|contentId|newsId|articleId|itemId)\}", raw, re.IGNORECASE
        )
        if placeholder:
            return raw[:placeholder.start()] + urllib.parse.quote(item_id) + raw[placeholder.end():]

        parsed = urllib.parse.urlsplit(raw)
        # SPA 路由参数位于 fragment 中时，应把 ID 放进 Hash 路由，不能放到
        # 页面顶层 query 后面。
        if parsed.fragment and ("?" in parsed.fragment or parsed.fragment.startswith("/")):
            fragment_path, separator, fragment_query = parsed.fragment.partition("?")
            params = urllib.parse.parse_qs(fragment_query, keep_blank_values=True)
            params[param] = [item_id]
            new_fragment = fragment_path + "?" + urllib.parse.urlencode(params, doseq=True)
            return urllib.parse.urlunsplit((
                parsed.scheme, parsed.netloc, parsed.path, parsed.query, new_fragment
            ))

        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        params[param] = [item_id]
        return urllib.parse.urlunsplit((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(params, doseq=True),
            parsed.fragment,
        ))

    @staticmethod
    def _extract_url_feature(value: str, source: str) -> str:
        """把 onclick/data-url 等 URL 特征转换为可补全的地址。"""
        raw = str(value or "").strip()
        if source == "@onclick":
            match = re.search(
                r"(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]+)['\"]",
                raw,
                re.IGNORECASE,
            )
            if not match:
                match = re.search(
                    r"(?:window\.)?open\s*\(\s*['\"]([^'\"]+)['\"]",
                    raw,
                    re.IGNORECASE,
                )
            return match.group(1).strip() if match else ""
        return raw

    @staticmethod
    def _get_value_by_xpath_plan(locator, plan: Optional[Dict[str, str]]) -> str:
        """沿样本确定的相对 XPath 读取标题或链接。"""
        if not plan:
            return ""
        try:
            return str(locator.evaluate("""
                (root, plan) => {
                    let node = root;
                    if (plan.xpath !== '.') {
                        node = document.evaluate(
                            plan.xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                    }
                    if (!node) return '';
                    if (plan.source.startsWith('@')) {
                        const attrName = plan.source.slice(1);
                        let val = String(node.getAttribute(attrName) || '').trim();
                        if (val && attrName !== 'href' && attrName !== 'onclick') {
                            const dataId = String(node.getAttribute('data-id') || node.getAttribute('data-item-id') || node.getAttribute('data-artid') || node.getAttribute('data-news-id') || '').trim();
                            if (dataId && !val.includes(dataId) && !val.includes('id=')) {
                                const sep = val.includes('?') ? '&' : '?';
                                val = `${val}${sep}id=${dataId}`;
                            }
                        }
                        return val;
                    }
                    return String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                }
            """, plan) or "").strip()
        except Exception:
            return ""

    @staticmethod
    def _get_value_by_full_xpath(page, full_xpath: str, source: str) -> str:
        """只通过字段完整 XPath 读取值，不再从列表项内部重新搜索。"""
        if not full_xpath:
            return ""
        try:
            locator = page.locator(f"xpath={full_xpath}").first
            if locator.count() <= 0:
                return ""
            if source.startswith("@"):
                attr_name = source[1:]
                val = str(locator.get_attribute(attr_name) or "").strip()
                if val and attr_name not in {"href", "onclick"}:
                    try:
                        data_id = str(locator.get_attribute("data-id") or locator.get_attribute("data-item-id") or locator.get_attribute("data-artid") or locator.get_attribute("data-news-id") or "").strip()
                        if data_id and data_id not in val and "id=" not in val:
                            sep = "&" if "?" in val else "?"
                            val = f"{val}{sep}id={data_id}"
                    except Exception:
                        pass
                return val
            return str(locator.evaluate(
                "node => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim()"
            ) or "").strip()
        except Exception:
            return ""

    def _get_external_item_map(
        self, page, title_plan: Optional[Dict[str, str]] = None
    ) -> Dict[str, Dict[str, str]]:
        """读取无 href 列表的 DOM 点击地址或接口数据，按标题映射 URL。"""
        title_plan_key = tuple(sorted(
            (str(key), str(value)) for key, value in (title_plan or {}).items()
        ))
        cache_key = (
            str(self.url or getattr(page, "url", "") or ""),
            tuple(str(xpath) for xpath in self.list_link),
            title_plan_key,
        )
        if (getattr(self, "_cached_external_item_map_key", None) == cache_key and
                getattr(self, "_cached_external_item_map", None) is not None):
            print("[Mapping] 命中无 A URL 映射缓存，跳过重复 ClickCapture")
            return self._cached_external_item_map

        def cache_result(result: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
            self._cached_external_item_map_key = cache_key
            self._cached_external_item_map = result
            return result

        list_titles = {
            " ".join(str(self._get_plan_value(page, item_xpath, title_plan) or "").split())
            for item_xpath in self.list_link
        } if title_plan else set()
        list_titles.discard("")
        dom_result: Dict[str, Dict[str, str]] = {}
        # 有些 Vue/Nuxt 页面让可见卡片通过组件点击跳转，同时在列表后方输出
        # 隐藏的 SEO 锚点。锚点 title 与卡片标题一致，可直接恢复真实详情 URL。
        try:
            anchor_rows = page.evaluate("""
                () => Array.from(document.querySelectorAll('a[href]')).map(node => ({
                    text: String(node.innerText || node.textContent || '')
                        .replace(/\\s+/g, ' ').trim(),
                    title: String(node.getAttribute('title') || '')
                        .replace(/\\s+/g, ' ').trim(),
                    href: String(node.getAttribute('href') || '').trim()
                }))
            """) or []
            for row in anchor_rows:
                href = str(row.get("href") or "").strip()
                title = " ".join(str(row.get("title") or row.get("text") or "").split())
                if (title and href and not href.startswith("#")
                        and title in list_titles
                        and self._is_same_site_url(self.url or page.url, href)):
                    dom_result[title] = {
                        "Url": urllib.parse.urljoin(self.url or page.url, href),
                        "Date": "",
                    }
            if dom_result:
                print(f"[Mapping] 已建立 {len(dom_result)} 条隐藏/独立锚点标题→详情链接映射")
        except Exception as ex:
            print(f"[Mapping] DOM 锚点映射失败: {ex}")

        # 优先使用当前列表 DOM 已有的 onclick，不点击、不进入详情页。
        # 例：onclick="window.location='../cn/newdetail/1170.html'"
        try:
            onclick_rows = page.evaluate("""
                () => Array.from(document.querySelectorAll('[onclick]')).map(node => ({
                    text: String(node.innerText || node.textContent || '')
                        .replace(/\\s+/g, ' ').trim(),
                    onclick: node.getAttribute('onclick') || ''
                }))
            """) or []
            for row in onclick_rows:
                title = " ".join(str(row.get("text") or "").split())
                expression = str(row.get("onclick") or "")
                match = re.search(
                    r"(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]+)['\"]",
                    expression,
                    re.IGNORECASE,
                )
                if not match:
                    match = re.search(
                        r"(?:window\.)?open\s*\(\s*['\"]([^'\"]+)['\"]",
                        expression,
                        re.IGNORECASE,
                    )
                # 页头语言切换、导航和页脚按钮也可能带 onclick；只有文本能
                # 与已推导新闻标题精确对应时，才属于列表 URL 映射。
                target_url = match.group(1).strip() if match else ""
                if (title and target_url and (not list_titles or title in list_titles)
                        and self._is_same_site_url(self.url or page.url, target_url)):
                    dom_result[title] = {
                        "Url": urllib.parse.urljoin(self.url or page.url, target_url),
                        "Date": "",
                    }
            if dom_result:
                print(f"[Mapping] 已建立 {len(dom_result)} 条 DOM onclick 标题→详情链接映射")
        except Exception as ex:
            print(f"[Mapping] DOM onclick 映射失败: {ex}")

        # 旧式 jQuery 站点常让 a[href="#none"] 只承担点击入口，真实详情
        # 由 articleid/contentid 等属性和脚本里的 .load('/prefix/' + id)
        # 拼接。直接从同页脚本恢复该规则，避免把纯锚点误当详情 URL。
        try:
            id_route_data = page.evaluate("""
                () => ({
                    scripts: Array.from(document.scripts)
                        .map(node => node.textContent || '').join('\\n'),
                    rows: Array.from(document.querySelectorAll(
                        '[articleid],[article-id],[data-article-id],'
                        + '[contentid],[content-id],[data-content-id]'
                    )).map(node => ({
                        text: String(node.innerText || node.textContent || '')
                            .replace(/\\s+/g, ' ').trim(),
                        articleid: String(
                            node.getAttribute('articleid') ||
                            node.getAttribute('article-id') ||
                            node.getAttribute('data-article-id') || ''
                        ).trim(),
                        contentid: String(
                            node.getAttribute('contentid') ||
                            node.getAttribute('content-id') ||
                            node.getAttribute('data-content-id') || ''
                        ).trim()
                    }))
                })
            """) or {}
            scripts = str(id_route_data.get("scripts") or "")
            for attr_name, row_key in (
                ("articleid", "articleid"),
                ("article-id", "articleid"),
                ("contentid", "contentid"),
                ("content-id", "contentid"),
            ):
                route_match = re.search(
                    r"""(?:\.load|\.get|\.getJSON)\s*\(\s*['"]([^'"]+/)['"]\s*\+"""
                    r"""[^;\n]{0,160}\.attr\s*\(\s*['"]"""
                    + re.escape(attr_name)
                    + r"""['"]\s*\)""",
                    scripts,
                    re.IGNORECASE,
                )
                if not route_match:
                    continue
                route_prefix = route_match.group(1)
                for row in id_route_data.get("rows") or []:
                    title = " ".join(str(row.get("text") or "").split())
                    identifier = str(row.get(row_key) or "").strip()
                    if title and identifier and title in list_titles:
                        dom_result[title] = {
                            "Url": urllib.parse.urljoin(
                                self.url or page.url, route_prefix + identifier
                            ),
                            "Date": "",
                        }
            if dom_result:
                print(
                    f"[Mapping] 已从页面脚本 ID 路由建立 "
                    f"{len(dom_result)} 条标题→详情链接映射"
                )
        except Exception as ex:
            print(f"[Mapping] 页面脚本 ID 路由映射失败: {ex}")

        # 隐藏锚点或 onclick 已覆盖所有唯一标题时，URL 已经完整，无需再进入
        # NoAnchorUrlResolver 的逐标题点击流程。重复列表项会共享同一个标题键。
        mapped_titles = list_titles.intersection(dom_result)
        mapped_urls = {
            str(dom_result[title].get("Url") or "").strip()
            for title in mapped_titles
            if dom_result[title].get("Url")
        }
        if (list_titles and len(mapped_titles) == len(list_titles)
                and len(mapped_urls) >= min(2, len(list_titles))):
            print(
                f"[Mapping] DOM 已完整映射 {len(mapped_titles)}/{len(list_titles)} 个唯一标题，"
                "跳过 ClickCapture"
            )
            return cache_result(dom_result)

        # 无 A 的两种浏览器恢复算法已独立到专用模块：
        # 1. 初始 XHR/Fetch JSON 映射；2. 逐标题点击与跳转拦截。
        captured_result = NoAnchorUrlResolver(
            page=page,
            source_url=self.url,
            item_xpaths=self.list_link,
            title_plan=title_plan,
            get_plan_value=self._get_plan_value,
            match_date_value=self._match_date_value,
        ).resolve()
        captured_result = {
            title: item
            for title, item in captured_result.items()
            if self._is_same_site_url(
                self.url or page.url, str(item.get("Url") or "")
            )
        }
        if captured_result or dom_result:
            dom_result.update(captured_result)
            return cache_result(dom_result)

        parsed = urllib.parse.urlsplit(self.url)
        if parsed.hostname not in {"wisesoft.com.cn", "www.wisesoft.com.cn"}:
            return cache_result({})

        snapshot_path = Path(__file__).resolve().parents[2] / "www.wisesoft.com.cn.json"
        payload = None
        try:
            payload = json.loads(snapshot_path.read_text(encoding="utf-8-sig"))
            print(f"[Mapping] 已读取本地接口快照: {snapshot_path}")
        except (OSError, json.JSONDecodeError):
            try:
                payload = page.evaluate("""
                    async () => {
                        const response = await fetch('http://www.wisesoft.com.cn/api/news/index', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({page: 1, per_page: 100, cate_id: 1})
                        });
                        return await response.json();
                    }
                """)
            except Exception:
                return cache_result({})

        data = payload or {}
        if isinstance(data, dict) and "data" in data:
            data = data.get("data", {})
            if isinstance(data, dict) and "data" in data:
                data = data.get("data", [])
        if not isinstance(data, list):
            return cache_result({})

        result: Dict[str, Dict[str, str]] = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            title = " ".join(str(item.get("title") or "").split())
            article_id = item.get("id")
            cate_id = item.get("cate_id")
            cate_name = str(item.get("cate_name") or "")
            if not title or article_id in (None, ""):
                continue
            query = urllib.parse.urlencode({
                "id": article_id,
                "cateid": cate_id if cate_id is not None else "",
                "catename": cate_name,
            })
            result[title] = {
                "Url": urllib.parse.urljoin(self.url, f"/newsDetail?{query}"),
                "Date": str(item.get("create_time") or "").strip(),
            }
        if result:
            print(f"[Mapping] 已建立 {len(result)} 条接口标题→详情链接映射")
        return cache_result(result)

    def _match_date_value(self, value) -> str:
        """校验并返回配置正则能够识别的日期，兼容秒/毫秒时间戳。"""
        normalized = " ".join(str(value or "").replace("\u00a0", " ").split())
        if not normalized:
            return ""
        # 英文月份日期。除了常见的 "July 24, 2026"、"24 July 2026"，
        # 还要支持日期、时间和年月分处兄弟节点、父节点文本合并后形成的
        # "24 09:16:59 July 2026"。
        english_months = {
            "jan": 1, "january": 1, "feb": 2, "february": 2,
            "mar": 3, "march": 3, "apr": 4, "april": 4,
            "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
            "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
            "oct": 10, "october": 10, "nov": 11, "november": 11,
            "dec": 12, "december": 12,
        }
        month_token = (
            r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
            r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|"
            r"Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
        )
        english_patterns = (
            re.compile(
                rf"(?<!\d)(?P<day>\d{{1,2}})\s+"
                rf"(?:(?P<clock>\d{{1,2}}:\d{{2}}(?::\d{{2}})?)\s+)?"
                rf"(?P<month>{month_token})[.,]?\s+(?P<year>20\d{{2}})(?!\d)"
                rf"(?:\s+(?P<clock_after>\d{{1,2}}:\d{{2}}(?::\d{{2}})?))?",
                re.IGNORECASE,
            ),
            re.compile(
                rf"(?P<month>{month_token})[.,]?\s+(?P<day>\d{{1,2}})"
                rf"(?:st|nd|rd|th)?(?:\s*,)?\s+(?P<year>20\d{{2}})"
                rf"(?:\s+(?P<clock>\d{{1,2}}:\d{{2}}(?::\d{{2}})?))?",
                re.IGNORECASE,
            ),
            re.compile(
                rf"(?<!\d)(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\s+"
                rf"(?P<month>{month_token})[.,]?\s+(?P<year>20\d{{2}})"
                rf"(?:\s+(?P<clock>\d{{1,2}}:\d{{2}}(?::\d{{2}})?))?",
                re.IGNORECASE,
            ),
        )
        for english_pattern in english_patterns:
            english_match = english_pattern.search(normalized)
            if not english_match:
                continue
            month_name = english_match.group("month").lower()
            month = english_months.get(month_name, english_months.get(month_name[:3]))
            candidate = (
                f"{int(english_match.group('year')):04d}-"
                f"{int(month or 0):02d}-{int(english_match.group('day')):02d}"
            )
            try:
                datetime.strptime(candidate, "%Y-%m-%d")
                groups = english_match.groupdict()
                clock = groups.get("clock") or groups.get("clock_after") or ""
                return candidate + (f" {clock}" if clock else "")
            except ValueError:
                continue
        # 欧洲及部分国际站常用“日/月/年”，例如 21/07/2026。
        # 先转为标准年月日，避免该短文本进入标题候选。
        day_month_year = re.fullmatch(
            r"(\d{1,2})[./-](\d{1,2})[./-](20\d{2})"
            r"(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?",
            normalized,
        )
        if day_month_year:
            day, month, year, clock = day_month_year.groups()
            candidate = f"{year}-{int(month):02d}-{int(day):02d}"
            try:
                datetime.strptime(candidate, "%Y-%m-%d")
                return candidate + (f" {clock}" if clock else "")
            except ValueError:
                pass
        # 部分新闻列表把日期渲染成“月.日 + 年份子节点”，例如：
        # <div class="date">08.26<em>2025</em></div> -> "08.26 2025"。
        # 先转换为标准年月日，再交给配置正则校验，使日期 XPath 能锁定
        # 真正的 .date 节点，而不是误选摘要中偶然出现的日期。
        month_day_year = re.search(
            r"(?<!\d)(\d{1,2})[./-](\d{1,2})\s*(20\d{2})(?!\d)", normalized
        )
        if month_day_year:
            month, day, year = month_day_year.groups()
            candidate = f"{year}-{int(month):02d}-{int(day):02d}"
            try:
                datetime.strptime(candidate, "%Y-%m-%d")
                normalized = candidate
            except ValueError:
                pass
        # 日期父标签也可能按“日 + 年-月子标签”排列，例如
        # <div class="time"><div>27</div><div>2025-06</div></div>。
        day_year_month = re.search(
            r"(?<!\d)(\d{1,2})\s*(20\d{2})[./-](\d{1,2})(?!\d)", normalized
        )
        if day_year_month:
            day, year, month = day_year_month.groups()
            candidate = f"{year}-{int(month):02d}-{int(day):02d}"
            try:
                datetime.strptime(candidate, "%Y-%m-%d")
                normalized = candidate
            except ValueError:
                pass
        if re.fullmatch(r"\d{10}|\d{13}", normalized):
            try:
                timestamp = int(normalized)
                seconds = timestamp / 1000 if len(normalized) == 13 else timestamp
                return datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")
            except (ValueError, OSError, OverflowError):
                pass
        for pattern in self.date_patterns:
            match = pattern.search(normalized)
            if match:
                return match.group(0).strip()
        return ""

    def _build_date_xpath_plan(self, page, item_xpaths: List[str]) -> Optional[Dict[str, str]]:
        """从列表头部样本确定一次日期相对 XPath，后续条目沿同一路径读取。"""
        if not self.date_patterns:
            return None

        # 某些列表第一条是置顶项且没有时间，因此只在头部少量样本中寻找路径；
        # 一旦找到，后续所有条目都使用同一条相对 XPath，不再逐条搜索结构。
        for item_xpath in item_xpaths[:5]:
            locator = page.locator(f"xpath={item_xpath}")
            if locator.count() <= 0 or self._is_flash_item(locator):
                continue
            try:
                candidates = locator.evaluate("""
                    root => {
                        const result = [];
                        const attrs = ['datetime', 'officialtime', 'updatetime', 'data-time', 'data-date'];
                        const relativeXpath = node => {
                            if (node === root) return '.';
                            const parts = [];
                            let current = node;
                            while (current && current !== root) {
                                let index = 1;
                                for (let prev = current.previousElementSibling; prev; prev = prev.previousElementSibling) {
                                    if (prev.tagName === current.tagName) index++;
                                }
                                parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
                                current = current.parentElement;
                            }
                            return current === root ? './' + parts.join('/') : '';
                        };
                        for (const node of [root, ...root.querySelectorAll('*')]) {
                            const xpath = relativeXpath(node);
                            if (!xpath) continue;
                            const cls = String(node.className || '').toLowerCase();
                            const semantic = /date|time|publish|created|updated|日期|时间/.test(cls + ' ' + (node.id || ''));
                            let stableXpath = xpath;
                            if (semantic) {
                                const dateToken = String(node.className || '').split(/\\s+/)
                                    .find(token => /date|time|publish|created|updated/i.test(token));
                                if (dateToken && /^[\\w-]+$/.test(dateToken) &&
                                    root.querySelectorAll('.' + CSS.escape(dateToken)).length === 1) {
                                    stableXpath = `.//*[contains(concat(' ', normalize-space(@class), ' '), ' ${dateToken} ')]`;
                                }
                            }
                            if (stableXpath === xpath && node.parentElement) {
                                const parentToken = String(node.parentElement.className || '').split(/\\s+/)
                                    .find(token => /date|time|more|meta/i.test(token));
                                if (parentToken && /^[\\w-]+$/.test(parentToken) &&
                                    root.querySelectorAll('.' + CSS.escape(parentToken)).length === 1) {
                                    let childIndex = 1;
                                    for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
                                        if (prev.tagName === node.tagName) childIndex++;
                                    }
                                    stableXpath = `.//*[contains(concat(' ', normalize-space(@class), ' '), ' ${parentToken} ')]/${node.tagName.toLowerCase()}[${childIndex}]`;
                                }
                            }
                            for (const attr of attrs) {
                                const value = node.getAttribute && node.getAttribute(attr);
                                if (value) result.push({xpath, fallback_xpath: stableXpath !== xpath ? stableXpath : '', source: '@' + attr, value, score: 1000 + (semantic ? 200 : 0)});
                            }
                            const text = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                            if (text && text.length <= 80) {
                                let score = semantic ? 500 : 0;
                                if (node.tagName.toLowerCase() === 'time') score += 500;
                                if (node.children.length === 0) score += 200;
                                score += Math.max(0, 80 - text.length);
                                result.push({xpath, fallback_xpath: stableXpath !== xpath ? stableXpath : '', source: 'text', value: text, score});
                            }
                        }
                        return result;
                    }
                """) or []
            except Exception:
                continue

            matched = []
            for candidate in candidates:
                if self._match_date_value(candidate.get("value", "")):
                    matched.append(candidate)
            if matched:
                matched.sort(key=lambda item: int(item.get("score", 0)), reverse=True)
                best = matched[0]
                return {
                    "xpath": best["xpath"],
                    "fallback_xpath": best.get("fallback_xpath", ""),
                    "source": best["source"],
                }
        return None

    def _get_date_by_xpath_plan(self, locator, plan: Optional[Dict[str, str]]) -> str:
        """严格沿首条样本确定的相对 XPath 读取当前列表项日期。"""
        if not plan:
            return ""
        try:
            value = locator.evaluate("""
                (root, plan) => {
                    let node = root;
                    if (plan.xpath !== '.') {
                        node = document.evaluate(
                            plan.xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                    }
                    if (!node) return '';
                    if (plan.source.startsWith('@')) {
                        return node.getAttribute(plan.source.slice(1)) || '';
                    }
                    return (node.innerText || node.textContent || '').trim();
                }
            """, plan)
        except Exception:
            return ""
        return self._match_date_value(value)

    def _get_element_date(self, locator) -> str:
        """在标题节点及其同列表项兄弟节点中查找配置正则可识别的时间。"""
        if not self.date_patterns:
            return ""
        try:
            candidate_texts = locator.evaluate("""
                (element) => {
                    const result = [];
                    const seen = new Set();
                    const add = (value) => {
                        const text = String(value || '').replace(/\u00a0/g, ' ').trim();
                        if (text && !seen.has(text)) { seen.add(text); result.push(text); }
                    };
                    const addNode = (node) => {
                        if (!node || node.nodeType !== 1) return;
                        add(node.getAttribute('datetime'));
                        add(node.getAttribute('officialtime'));
                        add(node.getAttribute('updatetime'));
                        add(node.getAttribute('title'));
                        add(node.innerText || node.textContent);
                    };
                    addNode(element);
                    let current = element;
                    for (let depth = 0; current && current.parentElement && depth < 5; depth++) {
                        const parent = current.parentElement;
                        for (const sibling of parent.children) {
                            if (sibling === current) continue;
                            if (sibling.matches('a[href]') || sibling.querySelector('a[href]')) continue;
                            addNode(sibling);
                        }
                        add(parent.getAttribute('datetime'));
                        add(parent.getAttribute('officialtime'));
                        add(parent.getAttribute('updatetime'));
                        current = parent;
                    }
                    return result;
                }
            """)
        except Exception:
            return ""

        for candidate in candidate_texts or []:
            matched = self._match_date_value(candidate)
            if matched:
                return matched
        return ""

    @staticmethod
    def _is_flash_item(locator) -> bool:
        """判断节点是否为无详情链接的快讯条目。"""
        try:
            return bool(locator.evaluate("""
                el => {
                    const cls = String(el.className || '').toLowerCase();
                    const timeNode = el.querySelector(
                        '[class*="time"], time'
                    );
                    const timeText = timeNode ? (timeNode.innerText || timeNode.textContent || '').trim() : '';
                    return (cls.includes('live') || cls.includes('flash') || cls.includes('express')) &&
                           /^([01]\\d|2[0-3]):[0-5]\\d$/.test(timeText);
                }
            """))
        except Exception:
            return False

    @staticmethod
    def _get_flash_item_xpaths(page, sample_xpath: str) -> List[str]:
        """获取快讯样本所在容器下全部快讯条目的绝对 XPath。"""
        try:
            return page.locator(f"xpath=/{sample_xpath.lstrip('/')}").first.evaluate("""
                sample => {
                    function getAbsoluteXpath(element) {
                        if (!element || element.nodeType !== 1) return '';
                        if (element.tagName.toLowerCase() === 'html') return 'html[1]';
                        if (element.tagName.toLowerCase() === 'body') return 'html[1]/body[1]';
                        let ix = 0;
                        const siblings = element.parentNode ? element.parentNode.childNodes : [];
                        for (let i = 0; i < siblings.length; i++) {
                            const sibling = siblings[i];
                            if (sibling === element) {
                                return getAbsoluteXpath(element.parentNode) + '/' +
                                    element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                            }
                            if (sibling.nodeType === 1 && sibling.tagName === element.tagName) ix++;
                        }
                        return '';
                    }
                    return Array.from(sample.parentElement.children).filter(item => {
                        const cls = String(item.className || '').toLowerCase();
                        const timeNode = item.querySelector('[class*="time"], time');
                        const timeText = timeNode ? (timeNode.innerText || timeNode.textContent || '').trim() : '';
                        return (cls.includes('live') || cls.includes('flash') || cls.includes('express')) &&
                               /^([01]\\d|2[0-3]):[0-5]\\d$/.test(timeText);
                    }).map(getAbsoluteXpath);
                }
            """) or []
        except Exception:
            return []

    @staticmethod
    def _get_flash_date(locator) -> str:
        """组合快讯页面的当前日期与条目 HH:mm 时间。"""
        try:
            value = locator.evaluate("""
                el => {
                    const timeNode = el.querySelector('[class*="time"], time');
                    const timeText = timeNode ? (timeNode.innerText || timeNode.textContent || '').trim() : '';
                    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(timeText)) return '';
                    const datePattern = /20\\d{2}年\\s*\\d{1,2}月\\s*\\d{1,2}日/;
                    // 优先使用当前快讯之前最近的日期分隔条，支持跨天列表。
                    let previous = el.previousElementSibling;
                    while (previous) {
                        const previousText = (previous.innerText || previous.textContent || '').trim();
                        const previousMatch = previousText.match(datePattern);
                        if (previousMatch) return previousMatch[0] + ' ' + timeText;
                        previous = previous.previousElementSibling;
                    }
                    for (const node of document.querySelectorAll('body *')) {
                        const text = (node.innerText || node.textContent || '').trim();
                        if (datePattern.test(text) && text.length < 30) {
                            return text.match(datePattern)[0] + ' ' + timeText;
                        }
                    }
                    return '';
                }
            """)
            match = re.fullmatch(r"(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日\s+(\d{1,2}):(\d{2})", value or "")
            if match:
                year, month, day, hour, minute = map(int, match.groups())
                return datetime(year, month, day, hour, minute).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
        return ""

    @staticmethod
    def _get_html_timestamp_map(content: str) -> Dict[str, str]:
        """从浏览器收到的原始列表 HTML 属性中读取发布时间。"""
        result: Dict[str, str] = {}
        for tag_match in re.finditer(r"<[^>]*\bofficialtime=[\"']\d{10,13}[\"'][^>]*>", content or "", re.IGNORECASE):
            tag = tag_match.group(0)
            id_match = re.search(r"\bid=[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
            time_match = re.search(r"\bofficialtime=[\"'](\d{10,13})[\"']", tag, re.IGNORECASE)
            if not id_match or not time_match or int(time_match.group(1)) <= 0:
                continue
            try:
                value = time_match.group(1)
                seconds = int(value) / 1000 if len(value) == 13 else int(value)
                result[id_match.group(1)] = datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")
            except (ValueError, OSError, OverflowError):
                continue
        return result

    @staticmethod
    def _get_dom_timestamp_map(page) -> Dict[str, str]:
        """在前端水合覆盖 SSR 属性前读取列表节点中的毫秒时间戳。"""
        try:
            raw_map = page.evaluate("""
                () => {
                    const result = {};
                    document.querySelectorAll('[id][officialtime]').forEach(node => {
                        const value = node.getAttribute('officialtime');
                        if (value && /^\\d{10,13}$/.test(value) && Number(value) > 0) {
                            result[node.id] = value;
                        }
                    });
                    return result;
                }
            """)
        except Exception:
            return {}

        result: Dict[str, str] = {}
        for article_id, value in (raw_map or {}).items():
            try:
                timestamp = int(value)
                seconds = timestamp / 1000 if len(str(value)) == 13 else timestamp
                result[str(article_id)] = datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")
            except (TypeError, ValueError, OSError, OverflowError):
                continue
        return result

    def _get_list_date_map(self, page, page_size: int) -> Dict[str, str]:
        """从同壁财经的列表接口一次性读取文章 ID 与发布时间映射。"""
        parsed_url = urllib.parse.urlparse(page.url)
        if parsed_url.netloc.lower() not in ("tongbicapital.com", "www.tongbicapital.com"):
            return {}

        fe_class_code = urllib.parse.parse_qs(parsed_url.query).get("feClassCode", [""])[0]
        if not fe_class_code:
            return {}

        api_url = urllib.parse.urljoin(
            page.url,
            "/api/app-api/content/list?" + urllib.parse.urlencode({
                "pageNo": 1,
                "pageSize": max(page_size, 10),
                "navMenuCode": fe_class_code,
            }),
        )
        try:
            # 该站会根据浏览器 Cookie 将列表时间字段置为 0，使用无 Cookie
            # 的列表请求才能得到真实 officialTime；仍然不访问任何详情页。
            request = urllib.request.Request(api_url, headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0",
            })
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = json.load(response)
            items = (payload.get("data") or {}).get("list") or []
        except Exception:
            return {}

        result: Dict[str, str] = {}
        for item in items:
            article_id = item.get("id")
            timestamp = item.get("officialTime") or item.get("createTime") or item.get("updateTime")
            try:
                timestamp = int(timestamp)
                seconds = timestamp / 1000 if timestamp >= 100000000000 else timestamp
                if article_id and seconds > 0:
                    result[str(article_id)] = datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")
            except (TypeError, ValueError, OSError, OverflowError):
                continue
        return result

    def _get_best_xpath_list(
        self, page, title_only: bool = False
    ) -> str | None:
        """选择普通列表容器；纯无 URL 模式只使用标题/文本结构候选。"""
        # A Full XPath 主选择已经由 ListContainerSelector 负责；
        # 本方法只保留普通列表的第二轮兜底，避免总调度器混合算法职责。
        js_code = """
        (args) => {
            const excludedContainerXpaths = new Set(args.excludedXpaths || []);
            const titleOnly = Boolean(args.titleOnly);
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
            function isVisible(el) {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                if (rect.width > 0 && rect.height > 0) return true;
                // 旧式 float 布局中，ul 等父容器可能高度塌陷为 0，
                // 但直属 li 仍有真实可见区域，这种容器不能判定为隐藏。
                return Array.from(el.children || []).some(child => {
                    const childStyle = window.getComputedStyle(child);
                    const childRect = child.getBoundingClientRect();
                    return childStyle.display !== 'none' && childStyle.visibility !== 'hidden' &&
                           childRect.width > 0 && childRect.height > 0;
                });
            }
            function isStructuralItem(el) {
                const style = window.getComputedStyle(el);
                if (style.display === 'none') return false;
                // WOW/滚动动画会暂时设为 visibility:hidden，但节点、文本和链接
                // 已经完整存在于 DOM，容器比较时仍应计入列表项数量。
                return isVisible(el) || Boolean(
                    String(el.textContent || '').trim() || el.querySelector('a[href], [onclick], [data-url], [data-href]')
                );
            }
            function getRelativeXpath(root, node) {
                if (!root || !node || node === root) return '.';
                const parts = [];
                let current = node;
                while (current && current !== root) {
                    let index = 1;
                    for (let prev = current.previousElementSibling; prev; prev = prev.previousElementSibling) {
                        if (prev.tagName === current.tagName) index++;
                    }
                    parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
                    current = current.parentElement;
                }
                return current === root ? './' + parts.join('/') : '';
            }
            const hasBusinessFeature = root => {
                const nodes = [root, ...root.querySelectorAll('*')];
                const semantics = nodes.map(node =>
                    `${String(node.className || '')} ${String(node.id || '')}`.toLowerCase()
                );
                const newsCount = semantics.filter(value => /news|article/.test(value)).length;
                const listCount = semantics.filter(value => /list/.test(value)).length;
                const contentCount = semantics.filter(value => /content/.test(value)).length;
                const titleCount = semantics.filter(value => /title|headline|subject/.test(value)).length;
                const urlBusinessCount = nodes.filter(node =>
                    node.matches && node.matches('a[href],[onclick],[data-url],[data-href]') &&
                    /news|article|content|detail/.test(
                        `${String(node.className || '')} ${String(node.id || '')}`.toLowerCase()
                    )
                ).length;
                // 单个 nav-title 不是新闻证据。重复 news/list，或重复的
                // title+content 字段，才能保护带 nav/menu 名称的真实业务容器。
                return newsCount >= 2 || (newsCount >= 1 && listCount >= 1) ||
                    // SPA 公告组件常用 list-content + 多个 list-item/item-title，
                    // 外层却可能叫 topMenuCard。重复的列表项和标题是强业务
                    // 证据，不能因祖先名称含 menu 就当成导航区排除。
                    (listCount >= 3 && titleCount >= 3) ||
                    (titleCount >= 2 && contentCount >= 2) || urlBusinessCount >= 2;
            };
            function isExcludedRegion(el) {
                // 导航区域只有具备重复的 news/list/content/title 组合证据时
                // 才能作为真实业务容器；单独的 nav-title 不予保护。
                const regionText = String(el.innerText || el.textContent || '')
                    .replace(/\\s+/g, ' ').trim();
                // 某些旧站把正文栏命名为 navboxauto，但内部 ul 才是真正新闻
                // 列表。至少 3 个直属项且多数项同时具备标题和日期时，结构
                // 证据强于祖先 class 中偶然出现的 nav，不能按导航区域排除。
                const directChildren = Array.from(el.children || []);
                const repeatedDatedNewsItems = directChildren.length >= 3 &&
                    directChildren.filter(child => {
                        const text = String(
                            child.innerText || child.textContent || ''
                        ).replace(/\\s+/g, ' ').trim();
                        const hasDate =
                            /(?:19|20)\\d{2}[年/.\\-]\\s*\\d{1,2}(?:[月/.\\-]\\s*\\d{1,2}日?)?/.test(text);
                        const titleNode = child.querySelector(
                            'h1,h2,h3,h4,h5,h6,[class*="title" i],'
                            + '[class*="tit" i],a'
                        );
                        const title = String(
                            titleNode && (titleNode.innerText || titleNode.textContent) || ''
                        ).replace(/\\s+/g, ' ').trim();
                        return hasDate && title.length >= 4;
                    }).length / directChildren.length >= 0.6;
                if (repeatedDatedNewsItems) return false;
                // 联系方式组合是页脚/联系卡片的强特征，优先级高于 title/name
                // 等弱语义。避免“联系我们、友情链接、微信公众号”三列因
                // ContactUsName 和重复文本 XPath 被误选成无 A 新闻列表。
                const hasContactHeading = /联系我们|联系信息|联系方式/.test(regionText);
                const hasAddress = /(?:地址|联系地址|公司地址)\\s*[:：]/.test(regionText);
                const hasPhone = /(?:电话|联系电话|服务热线|销售热线|总机)\\s*[:：]/.test(regionText);
                if (hasContactHeading && hasAddress && hasPhone) return true;
                // 真实 <nav>/role=navigation 是站点导航的硬边界。菜单里常有
                // news、content、list 等下拉项名称，不能让这些词触发业务保护
                // 并抢在真正的无 A 新闻卡片之前胜出。
                for (let current = el, depth = 0;
                     current && depth < 8;
                     current = current.parentElement, depth++) {
                    const tag = String(current.tagName || '').toLowerCase();
                    const role = String(
                        current.getAttribute && current.getAttribute('role') || ''
                    ).toLowerCase();
                    if (tag === 'nav' || role === 'navigation') return true;
                }
                if (hasBusinessFeature(el)) return false;
                const semanticTags = ['header', 'footer', 'nav', 'aside'];
                const excludedRoles = ['navigation', 'banner', 'contentinfo'];
                const excludedFeatures = [
                    'header','footer','foot','nav','menu','sidebar',
                    'breadcrumb','pager','pagination'
                ];
                let current = el;
                // 候选自身及有限层祖先都要检查，避免选中页头/页底内部的 ul、div。
                for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
                    const tag = String(current.tagName || '').toLowerCase();
                    const role = String(current.getAttribute && current.getAttribute('role') || '').toLowerCase();
                    const cls = String(current.className || '').toLowerCase();
                    const id = String(current.id || '').toLowerCase();
                    if (semanticTags.includes(tag) || excludedRoles.includes(role)) return true;
                    if (excludedFeatures.some(key => cls.includes(key) || id.includes(key))) return true;
                }
                return false;
            }
            function containsMixedLayoutSemantics(el) {
                // 页面总外壳本身可能只叫 main，但内部同时包含页头、导航、菜单、
                // 页脚等多个布局区域。这种节点不能作为新闻列表容器。
                const found = new Set();
                for (const node of el.querySelectorAll('*')) {
                    const tag = String(node.tagName || '').toLowerCase();
                    const role = String(node.getAttribute && node.getAttribute('role') || '').toLowerCase();
                    const cls = String(node.className || '').toLowerCase();
                    const id = String(node.id || '').toLowerCase();
                    const semantic = `${tag} ${role} ${cls} ${id}`;
                    const text = String(node.innerText || node.textContent || '')
                        .replace(/\\s+/g, ' ').trim();
                    if (/\bheader\b|\bhead(er)?[_-]/.test(semantic)) found.add('header');
                    if (/\bfooter\b|\bfoot(er)?[_-]/.test(semantic)) found.add('footer');
                    if (/\bnav\b|navigation|breadcrumb/.test(semantic)) found.add('nav');
                    if (/\bmenu\b|sidebar/.test(semantic)) found.add('menu');
                    if (tag === 'aside' || role === 'complementary') found.add('aside');
                    // 中文站点常用无语义 div，需结合短文本识别导航和页脚。
                    if (text.length <= 30 && /^(首页|主页|关于我们|产品中心|业务矩阵|核心优势|案例中心|企业动态|新闻中心|公司新闻|视频中心|投资者关系|加入我们|联系我们)$/.test(text)) {
                        found.add('nav');
                    }
                    if (text.length <= 30 && /^(菜单|导航|栏目|更多栏目)$/.test(text)) {
                        found.add('menu');
                    }
                    if (/版权所有|ICP备|公安备案|法律声明|隐私条款|网站地图|技术支持/.test(text) && text.length <= 120) {
                        found.add('footer');
                    }
                    if (/股票代码|服务热线|OA系统/.test(text) && text.length <= 80) {
                        found.add('header');
                    }
                    if (found.size >= 2) return true;
                }
                return false;
            }
            const linkCandidates = [];
            const classFallbackCandidates = [];
            const containerClassFeatures = ['list','news','content','article','feed','result','items'];
            const itemClassFeatures = ['item','info','card','news','article','content','list'];
            const titleClassFeatures = ['title','tit','name','subject','headline'];
            const dateClassFeatures = ['date','time','day','year','month'];
            const actionClassFeatures = ['detail','button','more','view'];
            const idAttrs = [
                'data-content-id','data-news-id','data-article-id','data-item-id',
                'data-artid','content-id','news-id','article-id','data-id','id'
            ];
            const idParam = attr => {
                const value = String(attr || '').toLowerCase();
                if (value.includes('content')) return 'contentId';
                if (value.includes('news')) return 'newsId';
                if (value.includes('article') || value.includes('artid')) return 'articleId';
                if (value.includes('item')) return 'itemId';
                return 'id';
            };
            const effectiveUrlValue = (item, rawValue) => {
                const raw = String(rawValue || '').trim();
                if (!raw || !item) return raw;
                for (const candidate of [item, ...item.querySelectorAll('*')]) {
                    for (const attr of idAttrs) {
                        const identifier = String(
                            candidate.getAttribute && candidate.getAttribute(attr) || ''
                        ).trim();
                        if (!identifier || identifier.length > 128 || /\\s/.test(identifier)) continue;
                        if (attr === 'id' && !/^(?:\\d+|[a-f0-9-]{8,})$/i.test(identifier)) continue;
                        try {
                            const parsed = new URL(raw, document.baseURI || location.href);
                            parsed.searchParams.set(idParam(attr), identifier);
                            return parsed.href;
                        } catch (_) {
                            const sep = raw.includes('?') ? '&' : '?';
                            return raw + sep + idParam(attr) + '=' + encodeURIComponent(identifier);
                        }
                    }
                }
                return raw;
            };
            const nonContentTags = new Set([
                'script','style','template','noscript','link','meta','source'
            ]);
            const meaningfulListItem = element => {
                if (nonContentTags.has(String(element.tagName || '').toLowerCase())) return false;
                const text = String(element.innerText || element.textContent || '').trim();
                if (text) return true;
                if (element.matches('a[href]') || element.querySelector('a[href]')) return true;
                const urlAttrs = ['onclick','data-url','data-href','data-link','url','link'];
                return [element, ...element.querySelectorAll('*')].some(node =>
                    urlAttrs.some(attr => String(node.getAttribute && node.getAttribute(attr) || '').trim())
                );
            };
            const isMoreActionItem = element => {
                const text = String(element.innerText || element.textContent || '')
                    .replace(/\\s+/g, '').replace(/^[+＋>》›»]+|[>》›»]+$/g, '');
                if (!/^(?:查看更多|查看全部|全部|更多|MORE|VIEWMORE|READMORE)$/i.test(text)) {
                    return false;
                }
                const links = element.matches('a[href]')
                    ? [element] : Array.from(element.querySelectorAll('a[href]'));
                return links.length <= 1;
            };
            const isTwoItemNewsException = (container, items) => {
                if (items.length !== 2) return false;
                // 两条首屏 + “加载更多”是常见的移动端/SPA 新闻布局。
                // 与其依赖容器名必须含 news，更应优先识别每项内部稳定的
                // title/content 字段，并要求两个标题不同。
                const fieldRows = items.map(item => {
                    const titleNode = item.querySelector(
                        '[class~="title" i],[class*="-title" i],[class*="_title" i],'
                        + '[class~="headline" i],[class~="subject" i],h1,h2,h3,h4,h5,h6'
                    );
                    const contentNode = item.querySelector(
                        '[class~="content" i],[class*="-content" i],[class*="_content" i],'
                        + '[class~="summary" i],[class~="desc" i],[class~="description" i]'
                    );
                    return {
                        title: String(titleNode && (titleNode.innerText || titleNode.textContent) || '')
                            .replace(/\\s+/g, ' ').trim(),
                        hasContent: Boolean(contentNode)
                    };
                });
                if (fieldRows.every(row => row.title.length >= 2 && row.hasContent) &&
                    fieldRows[0].title !== fieldRows[1].title) return true;
                if (items.some(item => /news/i.test(
                    `${String(item.className || '')} ${String(item.id || '')}`
                ))) return true;
                let current = container;
                for (let depth = 0; current && depth < 5;
                     depth++, current = current.parentElement) {
                    if (/news/i.test(
                        `${String(current.className || '')} ${String(current.id || '')}`
                    )) return true;
                }
                return false;
            };
            const orderedSiblingXpaths = items => {
                if (items.length < 3) return false;
                const parsed = items.map(item => {
                    const xpath = getAbsoluteXpath(item);
                    const matched = xpath.match(/^(.*)\\/([a-z0-9_-]+)\\[(\\d+)\\]$/i);
                    return matched ? {parent: matched[1], tag: matched[2], index: Number(matched[3])} : null;
                });
                if (parsed.some(value => !value)) return false;
                return parsed.every((value, index) =>
                    value.parent === parsed[0].parent && value.tag === parsed[0].tag &&
                    (index === 0 || value.index === parsed[index - 1].index + 1));
            };
            const containerClassRatio = items => {
                const positionClass = /^(odd|even)$/i;
                const transientClass = /^(show|shown|visible|animated|active|aos-init|aos-animate)$/i;
                const animationClass = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
                const baseClasses = item => String(item.className || '')
                    .split(/\\s+/).filter(Boolean)
                    .filter(cls => !positionClass.test(cls) &&
                        !transientClass.test(cls) && !animationClass.test(cls));
                const positionalTokens = new Set();
                if (orderedSiblingXpaths(items)) {
                    const tokenPositions = new Map();
                    items.forEach((item, index) => baseClasses(item).forEach(token => {
                        if (!tokenPositions.has(token)) tokenPositions.set(token, []);
                        tokenPositions.get(token).push(index);
                    }));
                    for (const [token, positions] of tokenPositions.entries()) {
                        const parity = positions[0] % 2;
                        const expected = parity === 0 ? Math.ceil(items.length / 2) : Math.floor(items.length / 2);
                        if (positions.length === expected &&
                            positions.every(index => index % 2 === parity)) positionalTokens.add(token);
                    }
                }
                const structuralClass = item => baseClasses(item)
                    .filter(cls => !positionalTokens.has(cls)).sort().join(' ');
                const rawCounts = {};
                items.forEach(item => {
                    const cls = structuralClass(item);
                    rawCounts[cls] = (rawCounts[cls] || 0) + 1;
                });
                const rawMax = Math.max(0, ...Object.values(rawCounts));
                // 只在容器候选阶段启用数字 class 兜底。
                if (rawMax === 1 && orderedSiblingXpaths(items)) {
                    const normalizedCounts = {};
                    items.forEach(item => {
                        const cls = structuralClass(item).replace(/\\d+/g, '').trim();
                        normalizedCounts[cls] = (normalizedCounts[cls] || 0) + 1;
                    });
                    return Math.max(0, ...Object.values(normalizedCounts)) / items.length;
                }
                return rawMax / items.length;
            };
            const allElements = document.getElementsByTagName('*');
            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i];
                try {
                    if (!isVisible(el)) continue;
                    const tagLower = el.tagName.toLowerCase();
                    if (['html','script','style','link','head','a','span','p','h1','h2','h3','h4','h5','h6','button','input','img'].includes(tagLower)) continue;
                    const className = String(el.className || '').toLowerCase();
                    // 渲染后的投资者关系组件常没有 a/href，点击行才打开详情；
                    // 其外层组件名还可能含 menu。对“至少 3 个同类直属项 +
                    // 每项都有独立语义标题”的结构先建立强候选，不再被祖先
                    // topMenuCard 之类的布局命名误杀。规则依赖 DOM 结构，不依赖站点。
                    const strongDirectItems = Array.from(el.children || []).filter(child => {
                        const semantic = `${String(child.className || '')} ${String(child.id || '')}`.toLowerCase();
                        const title = child.querySelector(
                            'h1,h2,h3,h4,h5,h6,[class*="title" i],'
                            + '[class*="headline" i],[class*="subject" i]'
                        );
                        const titleText = String(
                            title && (title.innerText || title.textContent) || ''
                        ).replace(/\\s+/g, ' ').trim();
                        return /item|news|article|list/.test(semantic) &&
                            titleText.length >= 4 && titleText.length <= 300;
                    });
                    if (strongDirectItems.length >= 3 &&
                        strongDirectItems.length / Math.max(1, el.children.length) >= 0.8) {
                        let region = '';
                        const previous = el.previousElementSibling;
                        if (previous) region = String(
                            previous.innerText || previous.textContent || ''
                        ).replace(/\\s+/g, ' ').trim();
                        classFallbackCandidates.push({
                            xpath: getAbsoluteXpath(el),
                            score: 2200 + strongDirectItems.length * 20,
                            preferredRegionScore:
                                /最新公告|新闻动态|公司新闻|公司动态|latest\\s+news|announcements?/i.test(region)
                                    ? 600 : 0,
                            itemCount: strongDirectItems.length,
                            dateRatio: 0,
                            hasDateEvidence: false,
                            textXpath: '',
                            textXpathPatternRatio: 1,
                            urlXpath: '',
                            urlXpathPatternRatio: 0
                        });
                        continue;
                    }
                    if (isExcludedRegion(el)) continue;
                    // 少数旧站把真实列表项直接挂在 body 下。此时 body 同时包含导航和页脚，
                    // 不能在发现直属重复结构之前直接按“混合布局”淘汰。
                    if (tagLower !== 'body' && containsMixedLayoutSemantics(el) &&
                        !hasBusinessFeature(el)) continue;
                    // 有尺寸但没有文本、链接或 URL 特征的分隔线不参与容器比例统计。
                    const children = Array.from(el.children)
                        .filter(child => !nonContentTags.has(
                            String(child.tagName || '').toLowerCase()
                        ))
                        .filter(isStructuralItem).filter(meaningfulListItem)
                        .filter(child => !isMoreActionItem(child));
                    if (children.length < 3 && !isTwoItemNewsException(el, children)) continue;
                    // 先按“标签 + 去除动画/奇偶/数字序号后的稳定 class”分组。
                    // 根级容器中导航、横幅、分页会污染直属节点比例；但至少 3 个完全
                    // 同构的新闻项仍然是强证据，应只用该组继续判断。
                    const stableGroupKey = node => {
                        const classes = String(node.className || '').split(/\\s+/).filter(Boolean)
                            .filter(cls => !/^(odd|even|show|shown|visible|animated|active|aos-init|aos-animate)$/i.test(cls))
                            .filter(cls => !/^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i.test(cls))
                            .map(cls => cls.replace(/\\d+/g, '')).sort().join('.');
                        return String(node.tagName || '').toLowerCase() + '#' + classes;
                    };
                    const stableGroups = new Map();
                    children.forEach(child => {
                        const key = stableGroupKey(child);
                        if (!stableGroups.has(key)) stableGroups.set(key, []);
                        stableGroups.get(key).push(child);
                    });
                    const strongestStableGroup = [...stableGroups.values()]
                        .sort((left, right) => right.length - left.length)[0] || [];
                    let candidateChildren = children;
                    if (strongestStableGroup.length >= 3) candidateChildren = strongestStableGroup;
                    if (tagLower === 'body' && strongestStableGroup.length < 3) continue;

                    const tagCounts = {};
                    const classCounts = {};
                    candidateChildren.forEach(c => {
                        tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1;
                        const cls = String(c.className || '');
                        classCounts[cls] = (classCounts[cls] || 0) + 1;
                    });
                    const dominantTag = Object.keys(tagCounts).sort((a,b) => tagCounts[b] - tagCounts[a])[0];
                    const maxTagCount = tagCounts[dominantTag];
                    const runnerUpTagCount = Math.max(0, ...Object.entries(tagCounts)
                        .filter(([tag]) => tag !== dominantTag)
                        .map(([, count]) => count));
                    const smallDominantGroup = candidateChildren.length <= 5 &&
                        maxTagCount >= 3 && maxTagCount > runnerUpTagCount;
                    if (maxTagCount / candidateChildren.length < 0.8 && !smallDominantGroup) continue;
                    const listItems = candidateChildren.filter(c => c.tagName === dominantTag);
                    const tabItemRatio = listItems.filter(item =>
                        /tab[_-]?item|formtabcntid/.test(
                            `${String(item.className || '').toLowerCase()} ${String(item.id || '').toLowerCase()}`
                        )).length / listItems.length;
                    if (/tab[_-]?list|formtabcontent/.test(className) && tabItemRatio >= 0.6) continue;
                    const shortLabelRatio = listItems.filter(item => {
                        const text = String(item.innerText || item.textContent || '')
                            .replace(/\\s+/g, '').trim();
                        return text.length >= 2 && text.length <= 8;
                    }).length / listItems.length;
                    if (shortLabelRatio >= 0.8) continue;
                    const shortWholeItemTitleCount = listItems.filter(item => {
                        const text = String(item.innerText || item.textContent || '')
                            .replace(/\\s+/g, '').trim();
                        return text.length >= 1 && text.length <= 4 &&
                            !/^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载)$/i.test(text);
                    }).length;
                    if (shortWholeItemTitleCount >= 2) continue;
                    let linkCount = 0;
                    const directItemLinkValues = new Set();
                    const linkXpathStats = new Map();
                    let textLenSum = 0;
                    let flashCount = 0;
                    let itemFeatureCount = 0;
                    let titleFeatureCount = 0;
                    let shortCandidateTitleCount = 0;
                    let fourCharFieldLabelCount = 0;
                    let dateFeatureCount = 0;
                    let actionFeatureCount = 0;
                    const textXpathCounts = new Map();
                    const semanticTitleXpathCounts = new Map();
                    const urlXpathStats = new Map();
                    listItems.forEach(item => {
                        const itemLinks = (item.tagName === 'A'
                            ? [item] : Array.from(item.querySelectorAll('a[href]'))
                        ).filter(link => {
                            const href = String(link.getAttribute('href') || '').trim();
                            return href && !/^#/.test(href) && !/^javascript:/i.test(href);
                        });
                        // linkRatio 必须与第一阶段的 has_anchor 使用同一有效链接
                        // 定义；javascript:void(0) 只是点击占位，应进入无A分支。
                        if (itemLinks.length) linkCount++;
                        const seenLinkXpaths = new Set();
                        for (const linkNode of itemLinks) {
                            const href = String(linkNode.getAttribute('href') || '').trim();
                            if (href && !/^#/.test(href) && !/^javascript:/i.test(href)) {
                                const effectiveHref = effectiveUrlValue(item, href);
                                directItemLinkValues.add(effectiveHref);
                                const relative = getRelativeXpath(item, linkNode);
                                if (relative) {
                                    if (!linkXpathStats.has(relative)) {
                                        linkXpathStats.set(relative, {count: 0, values: new Set()});
                                    }
                                    const stat = linkXpathStats.get(relative);
                                    if (!seenLinkXpaths.has(relative)) {
                                        stat.count++;
                                        seenLinkXpaths.add(relative);
                                    }
                                    stat.values.add(effectiveHref);
                                }
                            }
                        }
                        // WOW/滚动动画常把未进入视口的新闻项设为 visibility:hidden，
                        // 此时 innerText 为空但 DOM 文本已经完整加载。
                        textLenSum += String(item.innerText || item.textContent || '').trim().length;
                        const cls = String(item.className || '').toLowerCase();
                        if (itemClassFeatures.some(key => cls.includes(key))) itemFeatureCount++;
                        const descendants = Array.from(item.querySelectorAll('*'));
                        const semanticTitleNodes = descendants.filter(node => {
                            const nodeCls = String(node.className || '').toLowerCase();
                            return /^H[1-6]$/.test(node.tagName) ||
                                   titleClassFeatures.some(key => nodeCls.includes(key));
                        });
                        if (semanticTitleNodes.length) titleFeatureCount++;
                        if (semanticTitleNodes.some(node => {
                            const value = String(node.innerText || node.textContent || '')
                                .replace(/\\s+/g, '').trim();
                            return value.length >= 1 && value.length <= 4 &&
                                !/^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|更多|下载)$/i.test(value) &&
                                !/^(?:(?:19|20)\\d{2}[年/.\\-]\\d{1,2}|\\d{1,2}[月/.\\-]\\d{1,2})/.test(value);
                        })) shortCandidateTitleCount++;
                        // 左右交替的新闻卡片会让标题相对 XPath 分成两条，各自
                        // 只覆盖奇数或偶数项。单独统计语义标题路径，允许两条
                        // 镜像路径合并证明列表规律。
                        const seenSemanticTitleXpaths = new Set();
                        for (const titleNode of semanticTitleNodes) {
                            const titleText = String(
                                titleNode.innerText || titleNode.textContent || ''
                            ).replace(/\\s+/g, ' ').trim();
                            if (titleText.length < 4 || titleText.length > 300) continue;
                            const relative = getRelativeXpath(item, titleNode);
                            if (!relative || seenSemanticTitleXpaths.has(relative)) continue;
                            seenSemanticTitleXpaths.add(relative);
                            semanticTitleXpathCounts.set(
                                relative,
                                (semanticTitleXpathCounts.get(relative) || 0) + 1
                            );
                        }
                        // 标题标签和 title class 只提供标题正向证据，不能用于
                        // 排除。另行识别“公司电话、工作时间、公司传真”等
                        // 4 字字段标签集合。
                        if (descendants.some(node => {
                            const value = String(node.innerText || node.textContent || '')
                                .replace(/\\s+/g, '').trim();
                            if (!/^[\\u3400-\\u9fff]{4}$/.test(value)) return false;
                            return /电话|时间|传真|邮箱|地址|邮编|客服|销售|联系人|网址/.test(value);
                        })) fourCharFieldLabelCount++;
                        const itemText = String(item.innerText || item.textContent || '').trim();
                        if (descendants.some(node => {
                            const nodeCls = String(node.className || '').toLowerCase();
                            return node.tagName === 'TIME' ||
                                   dateClassFeatures.some(key => nodeCls.includes(key));
                        }) || /20\\d{2}[年/.\\-]\\s*\\d{1,2}/.test(itemText)) dateFeatureCount++;
                        if (descendants.some(node => {
                            const nodeCls = String(node.className || '').toLowerCase();
                            const nodeText = String(node.innerText || node.textContent || '').trim();
                            return actionClassFeatures.some(key => nodeCls.includes(key)) ||
                                   /查看详情|详情|更多/.test(nodeText);
                        })) actionFeatureCount++;
                        const timeNode = item.querySelector('[class*="time"], time');
                        const timeText = timeNode ? (timeNode.innerText || timeNode.textContent || '').trim() : '';
                        if ((cls.includes('live') || cls.includes('flash') || cls.includes('express')) &&
                            /^([01]\\d|2[0-3]):[0-5]\\d$/.test(timeText)) flashCount++;

                        // 无 A 列表的核心特征：从每个直属项中找实际文本节点，
                        // 统计相对于列表项的 XPath 是否在多数项中保持一致。
                        const itemTextXpaths = new Set();
                        for (const node of item.querySelectorAll('*')) {
                            const tag = String(node.tagName || '').toLowerCase();
                            if (['script','style','button','svg'].includes(tag)) continue;
                            const directText = Array.from(node.childNodes)
                                .filter(child => child.nodeType === Node.TEXT_NODE)
                                .map(child => child.nodeValue || '').join(' ')
                                .replace(/\\s+/g, ' ').trim();
                            if (directText.length < 4 || directText.length > 300) continue;
                            if (/^(?:20\\d{2}[-/.年]\\d{1,2}[-/.月]\\d{1,2}(?:日)?|\\d{1,2}:\\d{2})$/.test(directText)) continue;
                            const relative = getRelativeXpath(item, node);
                            if (relative) itemTextXpaths.add(relative);
                        }
                        for (const relative of itemTextXpaths) {
                            textXpathCounts.set(relative, (textXpathCounts.get(relative) || 0) + 1);
                        }

                        // URL 特征比纯文本更强：统计 onclick/data-url 等节点
                        // 的相对 XPath、覆盖项数、URL 唯一性以及节点文本。
                        const seenUrlXpaths = new Set();
                        for (const node of [item, ...item.querySelectorAll('*')]) {
                            const text = String(node.innerText || node.textContent || '')
                                .replace(/\\s+/g, ' ').trim();
                            for (const attr of ['onclick','data-url','data-href','data-link','url','link']) {
                                const raw = String(node.getAttribute && node.getAttribute(attr) || '').trim();
                                if (!raw) continue;
                                let urlValue = raw;
                                if (attr === 'onclick') {
                                    const matched =
                                        raw.match(/(?:window\\.)?location(?:\\.href)?\\s*=\\s*['\"]([^'\"]+)['\"]/i) ||
                                        raw.match(/(?:window\\.)?open\\s*\\(\\s*['\"]([^'\"]+)['\"]/i);
                                    if (!matched) continue;
                                    urlValue = matched[1];
                                }
                                if (!urlValue || /^#/.test(urlValue)) continue;
                                const relative = getRelativeXpath(item, node);
                                if (!relative) continue;
                                const key = attr + '|' + relative;
                                if (!urlXpathStats.has(key)) {
                                    urlXpathStats.set(key, {xpath: relative, attr, count: 0, textCount: 0, values: new Set()});
                                }
                                const stat = urlXpathStats.get(key);
                                if (!seenUrlXpaths.has(key)) {
                                    stat.count++;
                                    if (text.length >= 4 && text.length <= 300) stat.textCount++;
                                    seenUrlXpaths.add(key);
                                }
                                stat.values.add(effectiveUrlValue(item, urlValue));
                            }
                        }
                    });
                    const linkRatio = linkCount / listItems.length;
                    let dominantLinkXpath = '';
                    let dominantLinkXpathCount = 0;
                    let dominantLinkDistinctCount = 0;
                    for (const [xpath, stat] of linkXpathStats.entries()) {
                        if (stat.count > dominantLinkXpathCount ||
                            (stat.count === dominantLinkXpathCount && stat.values.size > dominantLinkDistinctCount)) {
                            dominantLinkXpath = xpath;
                            dominantLinkXpathCount = stat.count;
                            dominantLinkDistinctCount = stat.values.size;
                        }
                    }
                    const linkXpathPatternRatio = dominantLinkXpathCount / listItems.length;
                    const avgTextLen = textLenSum / listItems.length;
                    const classRatio = containerClassRatio(listItems);
                    const directFieldRoles = new Set();
                    for (const child of listItems) {
                        const childSemantic = `${String(child.className || '').toLowerCase()} ${String(child.id || '').toLowerCase()}`;
                        if (/title|tit|headline|subject/.test(childSemantic)) directFieldRoles.add('title');
                        if (/desc|des(?:cription)?|summary|abstract|intro/.test(childSemantic)) directFieldRoles.add('summary');
                        if (/more|detail|date|time|action|button/.test(childSemantic)) directFieldRoles.add('meta');
                    }
                    // title/des/more 等多种字段角色并列，表明该容器是
                    // 单条记录内部，而不是多条列表。
                    const isRecordFieldContainer = directFieldRoles.size >= 2;
                    const flashRatio = flashCount / listItems.length;
                    const isFlashList = flashRatio >= 0.6 && avgTextLen < 5000;
                    const itemFeatureRatio = itemFeatureCount / listItems.length;
                    const titleFeatureRatio = titleFeatureCount / listItems.length;
                    const fourCharFieldLabelRatio =
                        fourCharFieldLabelCount / listItems.length;
                    const dateFeatureRatio = dateFeatureCount / listItems.length;
                    const actionFeatureRatio = actionFeatureCount / listItems.length;
                    // 与 A 候选使用相同的硬规则：实际标题候选中只要至少
                    // 两项不超过四字，就按栏目/导航容器排除，不能参与兜底。
                    if (shortCandidateTitleCount >= 2) continue;
                    // 多项均为联系方式等 4 字字段标签时，属于属性/联系信息集合，
                    // 不能把它当作新闻列表。普通四字新闻标题不会因 h 标签或
                    // title class 被排除。
                    if (fourCharFieldLabelCount >= 2 &&
                        fourCharFieldLabelRatio >= 0.5) continue;
                    let dominantTextXpath = '';
                    let dominantTextXpathCount = 0;
                    for (const [xpath, xpathCount] of textXpathCounts.entries()) {
                        if (xpathCount > dominantTextXpathCount) {
                            dominantTextXpath = xpath;
                            dominantTextXpathCount = xpathCount;
                        }
                    }
                    const textXpathPatternRatio = dominantTextXpathCount / listItems.length;
                    const semanticTitlePathCounts = [...semanticTitleXpathCounts.values()]
                        .sort((left, right) => right - left);
                    const mirroredTitleXpathPatternRatio = Math.min(
                        1,
                        semanticTitlePathCounts.slice(0, 2)
                            .reduce((sum, count) => sum + count, 0) / listItems.length
                    );
                    const hasMirroredTitlePattern =
                        semanticTitlePathCounts.length >= 2 &&
                        semanticTitlePathCounts[0] / listItems.length >= 0.3 &&
                        semanticTitlePathCounts[1] / listItems.length >= 0.3 &&
                        mirroredTitleXpathPatternRatio >= 0.8;
                    let dominantUrlStat = null;
                    for (const stat of urlXpathStats.values()) {
                        if (!dominantUrlStat ||
                            stat.count > dominantUrlStat.count ||
                            (stat.count === dominantUrlStat.count && stat.textCount > dominantUrlStat.textCount)) {
                            dominantUrlStat = stat;
                        }
                    }
                    const urlXpathPatternRatio = dominantUrlStat ? dominantUrlStat.count / listItems.length : 0;
                    const urlTextPatternRatio = dominantUrlStat ? dominantUrlStat.textCount / listItems.length : 0;
                    const hasDistinctUrlValues = dominantUrlStat
                        ? dominantUrlStat.count > 1 &&
                          dominantUrlStat.values.size === dominantUrlStat.count
                        : false;
                    const hasStrongContainerClass =
                        containerClassFeatures.some(key => className.includes(key));
                    // 同页可能同时有“定期报告”和“最新公告”等多个结构完全
                    // 相同的列表。读取候选容器附近的模块标题，在结构同分时
                    // 优先新闻/最新公告区域，避免只因 DOM 顺序抓到报告区。
                    const nearbyRegionText = (() => {
                        const values = [];
                        let cursor = el;
                        for (let depth = 0; cursor && depth < 4; depth++) {
                            let previous = cursor.previousElementSibling;
                            for (let index = 0; previous && index < 3; index++) {
                                const heading = previous.matches && previous.matches(
                                    'h1,h2,h3,h4,h5,h6,[class*="header" i],'
                                    + '[class*="title" i],[class*="module" i],'
                                    + '[class*="moduel" i]'
                                ) ? previous : previous.querySelector && previous.querySelector(
                                    'h1,h2,h3,h4,h5,h6,[class*="module-name" i],'
                                    + '[class*="moduel-name" i]'
                                );
                                const text = String(
                                    heading && (heading.innerText || heading.textContent) || ''
                                ).replace(/\\s+/g, ' ').trim();
                                if (text && text.length <= 80) values.push(text);
                                previous = previous.previousElementSibling;
                            }
                            cursor = cursor.parentElement;
                        }
                        return values.join(' ');
                    })();
                    const preferredRegionScore =
                        /最新公告|新闻动态|公司新闻|公司动态|行业新闻|latest\\s+news|announcements?/i
                            .test(nearbyRegionText) ? 600 : 0;
                    const containerHasNewsOrItemClass =
                        className.includes('news') || className.includes('item');
                    const itemHasListClassRatio = listItems.filter(item =>
                        String(item.className || '').toLowerCase().includes('list')
                    ).length / listItems.length;
                    // 无 A 的语义 class 兜底：即使标题/日期/动作特征均未命中，
                    // 容器和直属项的 class 已明确表达新闻列表关系，并且每项
                    // 完整 class 一致、文本相对 XPath 有规律时，也应选中容器。
                    const isNoLinkSemanticClassList = linkRatio < 0.5 &&
                        containerHasNewsOrItemClass &&
                        itemHasListClassRatio >= 0.6 &&
                        classRatio === 1 &&
                        textXpathPatternRatio >= 0.6;
                    // 无 A 列表以“文本节点相对 XPath 重复”为核心证据。
                    // class 名称只参与评分，不再作为必须命中的硬条件。
                    const isNoLinkClassList = linkRatio < 0.5 && classRatio >= 0.7 &&
                        (textXpathPatternRatio >= 0.6 || hasMirroredTitlePattern) &&
                        (titleFeatureRatio >= 0.6 || dateFeatureRatio >= 0.6 ||
                         actionFeatureRatio >= 0.6 ||
                         (hasStrongContainerClass && itemFeatureRatio >= 0.6));
                    const isNoLinkUrlList = linkRatio < 0.5 && classRatio >= 0.7 &&
                        urlXpathPatternRatio >= 0.6 && urlTextPatternRatio >= 0.6 &&
                        hasDistinctUrlValues;
                    const hasNewsTextStructure = avgTextLen >= 12 ||
                        titleFeatureRatio >= 0.6 || dateFeatureRatio >= 0.6;
                    const isLinkNewsList = linkRatio >= 0.5 && hasNewsTextStructure &&
                        classRatio >= 0.6 && directItemLinkValues.size >= linkCount &&
                        linkXpathPatternRatio >= 0.6 &&
                        dominantLinkDistinctCount === dominantLinkXpathCount &&
                        !isRecordFieldContainer &&
                        avgTextLen > 3 && avgTextLen < 3000;

                    if (isLinkNewsList) {
                        let score = listItems.length * 20 + linkRatio * 50 + classRatio * 40;
                        score += avgTextLen >= 12 ? 80 : -300;
                        if (hasStrongContainerClass) score += 100;
                        score += linkXpathPatternRatio * 300;
                        linkCandidates.push({
                            xpath: getAbsoluteXpath(el), score,
                            preferredRegionScore,
                            itemCount: listItems.length,
                            linkXpath: dominantLinkXpath,
                            linkXpathPatternRatio,
                            dateRatio: dateFeatureRatio,
                            hasDateEvidence: dateFeatureRatio >= 0.5
                        });
                    }

                    // 只有第一轮找不到可信的 a[href] 新闻容器时，才会使用此候选池。
                    if (isFlashList || isNoLinkUrlList || isNoLinkClassList ||
                        isNoLinkSemanticClassList) {
                        let score = listItems.length * 20 + classRatio * 40;
                        score += avgTextLen >= 12 ? 80 : -300;
                        if (isFlashList) score += 600;
                        if (isNoLinkUrlList) score += 1400;
                        if (isNoLinkClassList) score += 700;
                        if (isNoLinkSemanticClassList) score += 900;
                        score += textXpathPatternRatio * 300;
                        if (itemFeatureRatio >= 0.6) score += 80;
                        if (hasStrongContainerClass) score += 100;
                        classFallbackCandidates.push({
                            xpath: getAbsoluteXpath(el), score,
                            preferredRegionScore,
                            itemCount: listItems.length,
                            dateRatio: dateFeatureRatio,
                            hasDateEvidence: dateFeatureRatio >= 0.5,
                            textXpath: dominantTextXpath,
                            textXpathPatternRatio,
                            urlXpath: dominantUrlStat ? dominantUrlStat.xpath : '',
                            urlXpathPatternRatio
                        });
                    }
                } catch (e) {}
            }
            const allowedLinkCandidates = linkCandidates.filter(candidate =>
                !excludedContainerXpaths.has(candidate.xpath)
            );
            const allowedFallbackCandidates = classFallbackCandidates.filter(candidate =>
                !excludedContainerXpaths.has(candidate.xpath)
            );
            if (!titleOnly && allowedLinkCandidates.length) {
                // URL 规律一致时先比较业务结构综合分和日期证据；数量只用于
                // 最后的平局，避免 7 项导航压过 4 项真实新闻。
                allowedLinkCandidates.sort((a, b) =>
                    b.linkXpathPatternRatio - a.linkXpathPatternRatio ||
                    b.preferredRegionScore - a.preferredRegionScore ||
                    b.score - a.score ||
                    b.dateRatio - a.dateRatio ||
                    b.itemCount - a.itemCount);
                return allowedLinkCandidates[0].xpath;
            }
            if (allowedFallbackCandidates.length) {
                if (titleOnly) {
                    // 纯无 URL 新闻禁止用 URL 属性给容器排序。重复标题文本
                    // XPath、新闻区域语义及结构得分决定最终候选。
                    allowedFallbackCandidates.sort((a, b) =>
                        b.textXpathPatternRatio - a.textXpathPatternRatio ||
                        b.preferredRegionScore - a.preferredRegionScore ||
                        b.score - a.score ||
                        b.dateRatio - a.dateRatio ||
                        b.itemCount - a.itemCount);
                } else {
                    allowedFallbackCandidates.sort((a, b) =>
                        b.urlXpathPatternRatio - a.urlXpathPatternRatio ||
                        b.preferredRegionScore - a.preferredRegionScore ||
                        b.score - a.score ||
                        b.dateRatio - a.dateRatio ||
                        b.itemCount - a.itemCount);
                }
                return allowedFallbackCandidates[0].xpath;
            }
            return null;
        }
        """
        return page.evaluate(js_code, {
            "excludedXpaths": list(self._rejected_container_xpaths),
            "titleOnly": bool(title_only),
        })

    def _get_first_item_xpath(self, page, container_xpath: str) -> str | None:
        """获取容器下第一个有效的子代列表项样本节点的绝对 XPath"""
        js_code = f"""
        () => {{
            function getAbsoluteXpath(element) {{
                if (!element || element.nodeType !== 1) return '';
                if (element.tagName.toLowerCase() === 'html') return 'html[1]';
                if (element.tagName.toLowerCase() === 'body') return 'html[1]/body[1]';
                
                let ix = 0;
                let siblings = element.parentNode ? element.parentNode.childNodes : [];
                for (let i = 0; i < siblings.length; i++) {{
                    let sibling = siblings[i];
                    if (sibling === element) {{
                        return getAbsoluteXpath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                    }}
                    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {{
                        ix++;
                    }}
                }}
                return '';
            }}
            
            const res = document.evaluate("/{container_xpath}", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (!res || res.children.length === 0) return null;
            
            // 按“标签 + 稳定 class + 直属子结构”分组，选择数量最多的结构组。
            // 不能只按标签取第一个，否则会把容器首条的热点/置顶特殊卡片当样本。
            const transient = /^(show|shown|visible|animated|active|aos-init|aos-animate)$/i;
            const animationClass = /^(wow|fade|fadein|fadeout|slide|zoom|bounce)/i;
            const classes = item => String(item.className || '')
                .split(/\\s+/).filter(Boolean)
                .filter(cls => !transient.test(cls) && !animationClass.test(cls))
                .sort().join('.');
            const signature = item => {{
                const children = [...item.children].map(child =>
                    child.tagName.toLowerCase() + '.' + classes(child)
                ).join('|');
                return item.tagName.toLowerCase() + '#' + classes(item) + '#' + children;
            }};
            const groups = new Map();
            const nonContentTags = new Set([
                'script','style','template','noscript','link','meta','source'
            ]);
            const validHref = anchor => {{
                const href = String(anchor && anchor.getAttribute('href') || '').trim();
                return href && href !== '#' && !/^javascript:/i.test(href);
            }};
            const hasValidAnchor = child =>
                (child.matches('a[href]') && validHref(child)) ||
                [...child.querySelectorAll('a[href]')].some(validHref);
            const meaningful = child => {{
                const text = String(child.innerText || child.textContent || '').trim();
                if (text || hasValidAnchor(child)) return true;
                return ['onclick','data-url','data-href','data-link','url','link'].some(attr =>
                    String(child.getAttribute && child.getAttribute(attr) || '').trim()
                );
            }};
            let eligibleChildren = Array.from(res.children)
                .filter(child => !nonContentTags.has(
                    String(child.tagName || '').toLowerCase()
                ))
                .filter(meaningful);
            // 容器中有效A列表项若占多数或至少3项，优先从A项中选择（避免空占位LI干扰）。
            const anchorItems = eligibleChildren.filter(hasValidAnchor);
            if (anchorItems.length >= 3 || (eligibleChildren.length && anchorItems.length >= eligibleChildren.length / 2)) {{
                eligibleChildren = anchorItems;
            }}
            eligibleChildren.forEach(child => {{
                const key = signature(child);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(child);
            }});
            const dominantChildren = [...groups.values()].sort((left, right) => {{
                if (right.length !== left.length) return right.length - left.length;
                const rightLinks = right.filter(item => item.matches('a[href]') || item.querySelector('a[href]')).length;
                const leftLinks = left.filter(item => item.matches('a[href]') || item.querySelector('a[href]')).length;
                return rightLinks - leftLinks;
            }})[0] || [];
            const flashChild = dominantChildren.find(child => {{
                const cls = String(child.className || '').toLowerCase();
                const timeNode = child.querySelector('[class*="time"], time');
                const timeText = timeNode ? (timeNode.innerText || timeNode.textContent || '').trim() : '';
                return (cls.includes('live') || cls.includes('flash') || cls.includes('express')) &&
                       /^([01]\\d|2[0-3]):[0-5]\\d$/.test(timeText);
            }});
            const firstChild = flashChild || dominantChildren[0];
            if (!firstChild) return null;

            // 快讯条目可能没有新闻链接，内部链接通常只是股票/专题链接；
            // 此时必须以整个条目作为样本。
            const firstClass = String(firstChild.className || '').toLowerCase();
            const firstTimeNode = firstChild.querySelector('[class*="time"], time');
            const firstTimeText = firstTimeNode ? (firstTimeNode.innerText || firstTimeNode.textContent || '').trim() : '';
            if ((firstClass.includes('live') || firstClass.includes('flash') || firstClass.includes('express')) &&
                /^([01]\\d|2[0-3]):[0-5]\\d$/.test(firstTimeText)) {{
                return getAbsoluteXpath(firstChild);
            }}
            
            return getAbsoluteXpath(firstChild);
        }}
        """
        return page.evaluate(js_code)

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

    def _visualize_on_page(
        self, page, container_xpath: str, sample_xpath: str,
        item_xpaths: Optional[List[str]] = None,
    ) -> None:
        """高亮容器、样本和推导列表，并在置顶面板展示完整 XPath。"""
        js_code = """
        (args) => {
            const { containerXpath, sampleXpath, itemXpaths } = args;
            const count = itemXpaths.length;

            // 全局复制辅助函数
            window.copyToClipboard = function(text, btnElem) {
                if (!text) return;
                const finishCopy = () => {
                    if (btnElem) {
                        const origText = btnElem.innerText;
                        btnElem.innerText = '✅ 已复制!';
                        btnElem.style.background = '#a6e3a1';
                        btnElem.style.color = '#11111b';
                        setTimeout(() => {
                            btnElem.innerText = origText;
                            btnElem.style.background = '#313244';
                            btnElem.style.color = '#cdd6f4';
                        }, 1500);
                    }
                };
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(text).then(finishCopy).catch(() => {
                        fallbackCopy(text);
                        finishCopy();
                    });
                } else {
                    fallbackCopy(text);
                    finishCopy();
                }
            };

            function fallbackCopy(text) {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-999999px";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                } catch (err) {}
                document.body.removeChild(textArea);
            }

            function getElementByXpath(xpath) {
                if (!xpath) return null;
                const normalized = xpath.startsWith('/') ? xpath : '/' + xpath;
                try {
                    const result = document.evaluate(normalized, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return result.singleNodeValue;
                } catch (e) {
                    return null;
                }
            }

            const markElement = (el, outline, shadow, background) => {
                if (!el || !el.style) return;
                if (!el.hasAttribute('data-ql-xpath-highlight')) {
                    el.setAttribute('data-ql-xpath-highlight', JSON.stringify({
                        outline: el.style.getPropertyValue('outline'),
                        outlinePriority: el.style.getPropertyPriority('outline'),
                        outlineOffset: el.style.getPropertyValue('outline-offset'),
                        outlineOffsetPriority: el.style.getPropertyPriority('outline-offset'),
                        boxShadow: el.style.getPropertyValue('box-shadow'),
                        boxShadowPriority: el.style.getPropertyPriority('box-shadow'),
                        backgroundColor: el.style.getPropertyValue('background-color'),
                        backgroundColorPriority: el.style.getPropertyPriority('background-color')
                    }));
                }
                el.style.setProperty('outline', outline, 'important');
                el.style.setProperty('outline-offset', '3px', 'important');
                el.style.setProperty('box-shadow', shadow, 'important');
                el.style.setProperty('background-color', background, 'important');
            };

            window.closeXPathInspector = function() {
                document.querySelectorAll('[data-ql-xpath-highlight]').forEach(el => {
                    let old = {};
                    try {
                        old = JSON.parse(el.getAttribute('data-ql-xpath-highlight') || '{}');
                    } catch (_) {}
                    const restore = (name, value, priority) => {
                        if (value) el.style.setProperty(name, value, priority || '');
                        else el.style.removeProperty(name);
                    };
                    restore('outline', old.outline, old.outlinePriority);
                    restore('outline-offset', old.outlineOffset, old.outlineOffsetPriority);
                    restore('box-shadow', old.boxShadow, old.boxShadowPriority);
                    restore('background-color', old.backgroundColor, old.backgroundColorPriority);
                    el.removeAttribute('data-ql-xpath-highlight');
                });
                const currentPanel = document.getElementById('xpath-inspector-panel');
                if (currentPanel) currentPanel.remove();
            };

            // 容器：红色粗实线，与样本和列表项明确区分。
            const containerElem = getElementByXpath(containerXpath);
            markElement(
                containerElem, '6px solid #ff1744',
                '0 0 0 3px #ffffff, 0 0 28px 10px rgba(255,23,68,.75)',
                'rgba(255,23,68,.08)'
            );

            // 基础样本：黄绿色粗实线。
            const sampleElem = getElementByXpath(sampleXpath);
            if (sampleElem) {
                markElement(
                    sampleElem, '6px solid #76ff03',
                    '0 0 0 3px #111111, 0 0 26px 10px rgba(118,255,3,.85)',
                    'rgba(118,255,3,.14)'
                );
                sampleElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // 推导列表项：高亮蓝色粗虚线；样本仍保留黄绿实线。
            itemXpaths.forEach(xpath => {
                const itemElem = getElementByXpath(xpath);
                if (itemElem && itemElem !== sampleElem) {
                    markElement(
                        itemElem, '4px dashed #00b0ff',
                        '0 0 0 2px #ffffff, 0 0 18px 6px rgba(0,176,255,.7)',
                        'rgba(0,176,255,.10)'
                    );
                }
            });

            // 创建悬浮调试面板
            let panel = document.getElementById('xpath-inspector-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'xpath-inspector-panel';
                panel.style.cssText = `
                    position: fixed;
                    top: 15px;
                    right: 15px;
                    z-index: 2147483647;
                    background: rgba(20, 22, 34, 0.95);
                    color: #dcdfe4;
                    padding: 16px 20px;
                    border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                    font-family: Consolas, Monaco, monospace;
                    font-size: 13px;
                    max-width: 650px;
                    max-height: 85vh;
                    overflow-y: auto;
                    border: 3px solid #ffffff;
                    backdrop-filter: blur(10px);
                `;
                document.body.appendChild(panel);
            }

            const cleanContainerStr = (containerXpath || '').replace(/'/g, "\\'");
            const cleanSampleStr = (sampleXpath || '').replace(/'/g, "\\'");
            const escapeHtml = value => String(value || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const listXpathHtml = itemXpaths.length
                ? itemXpaths.map((xpath, index) =>
                    `<div style="margin-top:7px;padding:6px 8px;display:flex;gap:7px;align-items:flex-start;background:#062b3a;border:2px dashed #00b0ff;border-radius:6px;">` +
                    `<span style="color:#ffffff;font-weight:bold;">${index + 1}.</span>` +
                    `<code style="word-break:break-all;color:#66d9ff;cursor:pointer;font-weight:bold;" ` +
                    `onclick="window.copyToClipboard(this.textContent, null)">${escapeHtml(xpath)}</code></div>`
                  ).join('')
                : '<div style="color:#f9e2af;margin-top:5px;">尚未推导出列表 XPath</div>';

            panel.innerHTML = `
                <div style="font-weight: bold; font-size: 14px; color: #89b4fa; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span>🔍 DOM XPath 调试面板</span>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="background: #313244; color: #a6e3a1; padding: 2px 8px; border-radius: 6px; font-size: 11px;">推导列表数: ${count}</span>
                        <button onclick="window.closeXPathInspector()" title="关闭面板并清除高亮" style="cursor:pointer;background:#5b2333;color:#ffffff;border:1px solid #ff5577;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:bold;">✕ 关闭</button>
                    </div>
                </div>
                <div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="color: #ff5577; font-weight: bold;">📦 容器 XPath (红色粗实线):</span>
                        <button onclick="window.copyToClipboard('${cleanContainerStr}', this)" style="cursor: pointer; background: #313244; color: #cdd6f4; border: 1px solid #45475a; border-radius: 6px; padding: 3px 10px; font-size: 11px; transition: all 0.2s;">📋 复制容器 XPath</button>
                    </div>
                    <code onclick="window.copyToClipboard('${cleanContainerStr}', this.previousElementSibling.querySelector('button'))" title="点击复制代码" style="word-break: break-all; color: #ffffff; background: #591225; padding: 8px 10px; border-radius: 6px; display: block; cursor: pointer; border: 3px solid #ff1744; font-size: 13px;font-weight:bold;">${containerXpath || '未定位到容器'}</code>
                </div>
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="color: #aaff66; font-weight: bold;">🎯 样本 XPath (黄绿粗实线):</span>
                        <button onclick="window.copyToClipboard('${cleanSampleStr}', this)" style="cursor: pointer; background: #313244; color: #cdd6f4; border: 1px solid #45475a; border-radius: 6px; padding: 3px 10px; font-size: 11px; transition: all 0.2s;">📋 复制样本 XPath</button>
                    </div>
                    <code onclick="window.copyToClipboard('${cleanSampleStr}', this.previousElementSibling.querySelector('button'))" title="点击复制代码" style="word-break: break-all; color: #ffffff; background: #244600; padding: 8px 10px; border-radius: 6px; display: block; cursor: pointer; border: 3px solid #76ff03; font-size: 13px;font-weight:bold;">${sampleXpath || '未定位到样本'}</code>
                </div>
                <div style="margin-top:12px;border-top:1px solid #45475a;padding-top:10px;">
                    <div style="color:#66d9ff;font-weight:bold;">📋 推导列表 XPath（蓝色粗虚线）:</div>
                    ${listXpathHtml}
                </div>
            `;
        }
        """
        try:
            page.evaluate(js_code, {
                "containerXpath": container_xpath,
                "sampleXpath": sample_xpath,
                "itemXpaths": item_xpaths or [],
            })
            print("[UI] 已展示容器、样本及推导列表 XPath（支持点击复制）")
        except Exception as e:
            print(f"[!] 浏览器界面绘制面板失败: {e}")

    def show_debug_panel_on_failure(self, page) -> None:
        """仅在最终失败后注入调试面板，正常抓取过程不修改页面 DOM。"""
        if not self.debug_container_xpath and not self.debug_sample_xpath:
            return
        self._visualize_on_page(
            page,
            self.debug_container_xpath,
            self.debug_sample_xpath,
            self.list_link,
        )

