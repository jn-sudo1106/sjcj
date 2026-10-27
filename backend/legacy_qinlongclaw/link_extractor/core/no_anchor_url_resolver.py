import html
import json
import logging
import re
import time
import urllib.parse
import urllib.request
from typing import Callable, Dict, List, Optional


class NoAnchorUrlResolver:
    """无 A 列表 URL 恢复：网络响应映射 + 逐标题点击拦截。"""

    def __init__(
        self,
        page,
        source_url: str,
        item_xpaths: List[str],
        title_plan: Optional[Dict[str, str]],
        get_plan_value: Callable,
        match_date_value: Callable,
    ):
        self.page = page
        self.source_url = source_url
        self.item_xpaths = item_xpaths
        self.title_plan = title_plan
        self.get_plan_value = get_plan_value
        self.match_date_value = match_date_value

    def resolve(self) -> Dict[str, Dict[str, str]]:
        """合并接口记录与点击后的地址栏 URL，并用已验证路由补全接口 ID。"""
        expected_titles = {
            " ".join(str(self.get_plan_value(
                self.page, item_xpath, self.title_plan
            ) or "").split())
            for item_xpath in self.item_xpaths
        } if self.title_plan else set()
        expected_titles.discard("")

        result = self.capture_initial_network_map()
        nuxt_result = self.capture_nuxt_payload_map()
        for title, item in nuxt_result.items():
            old = result.get(title, {})
            result[title] = {
                **item,
                **{key: value for key, value in old.items() if value not in (None, "")},
            }
        # 接口可能一次返回当前栏目、推荐区和其他分类的混合数据。后续记录按
        # 当前列表标题精确取 URL，因此提前跳过点击也必须按标题交集计算，不能
        # 用“接口总条数 / 当前列表条数”；例如接口21条但当前8条一条都不匹配。
        if expected_titles:
            unrelated_count = len(set(result) - expected_titles)
            result = {
                title: item for title, item in result.items()
                if title in expected_titles
            }
            if unrelated_count:
                logging.info(
                    f"[NoAnchor] 已排除 {unrelated_count} 条非当前列表接口记录; "
                    f"标题匹配={len(result)}/{len(expected_titles)}"
                )

        # 中科通达列表接口 /website/news/search 返回新闻唯一 ID，但不返回
        # href；前端点击后的真实、可复现路由为
        # /#/aboutUs/news?id=<ID>&newsActive=1。先按接口来源补全 URL，
        # 避免为了一个混入候选的分类按钮启动逐项点击并切换列表 DOM。
        citms_synthesized = 0
        source_host = (urllib.parse.urlsplit(self.source_url).hostname or "").lower()
        if source_host in {"citms.cn", "www.citms.cn"}:
            for item in result.values():
                identifier = str(item.get("Id") or "").strip()
                response_url = str(item.get("SourceUrl") or "").strip().lower()
                if (not identifier or str(item.get("Url") or "").strip()
                        or "/website/news/search" not in response_url):
                    continue
                origin = urllib.parse.urlunsplit((
                    urllib.parse.urlsplit(self.source_url).scheme or "https",
                    urllib.parse.urlsplit(self.source_url).netloc,
                    "", "", "",
                ))
                item["Url"] = (
                    f"{origin}/#/aboutUs/news?"
                    + urllib.parse.urlencode({
                        "id": identifier,
                        "newsActive": "1",
                    })
                )
                citms_synthesized += 1
        if citms_synthesized:
            logging.info(
                "[Mapping] 已用中科通达列表接口 ID 补全 "
                f"{citms_synthesized} 条详情链接"
            )

        # 立昂技术新闻列表由 /jeecg-boot/xw/newsPage 返回记录 ID，
        # “查看更多”再由 Vue Router 跳转到具名路由 messageDetail：
        # /news/#/news/messageDetail?id=<ID>&path=message。列表接口本身
        # 不返回 href，因此在启动耗时的逐项点击前，用前端公开路由补全链接。
        leon_synthesized = 0
        if source_host in {"leon.top", "www.leon.top"}:
            source_parts = urllib.parse.urlsplit(self.source_url)
            app_root = urllib.parse.urlunsplit((
                source_parts.scheme or "https",
                source_parts.netloc,
                "/news/",
                "",
                "",
            ))
            for item in result.values():
                identifier = str(item.get("Id") or "").strip()
                response_url = str(item.get("SourceUrl") or "").strip().lower()
                if (not identifier or str(item.get("Url") or "").strip()
                        or "/jeecg-boot/xw/newspage" not in response_url):
                    continue
                item["Url"] = (
                    f"{app_root}#/news/messageDetail?"
                    + urllib.parse.urlencode({
                        "id": identifier,
                        "path": "message",
                    })
                )
                leon_synthesized += 1
        if leon_synthesized:
            logging.info(
                "[Mapping] 已用立昂技术 newsPage 接口 ID 补全 "
                f"{leon_synthesized} 条详情链接"
            )

        # 申能股份公司要闻没有真实 a[href]，点击事件由 Vue 执行：
        # this.$router.push({path: "/detail/" + item.ID,
        #                    query: {name: "公司要闻"}})。列表接口
        # GetFormDataList 已返回稳定唯一 ID，因此直接恢复前端公开路由。
        shenergy_synthesized = 0
        if source_host in {"shenergy.net.cn", "www.shenergy.net.cn"}:
            source_parts = urllib.parse.urlsplit(self.source_url)
            origin = urllib.parse.urlunsplit((
                source_parts.scheme or "https",
                source_parts.netloc,
                "",
                "",
                "",
            ))
            for item in result.values():
                identifier = str(item.get("Id") or "").strip()
                response_url = str(item.get("SourceUrl") or "").strip()
                parsed_response = urllib.parse.urlsplit(response_url)
                response_query = urllib.parse.parse_qs(
                    parsed_response.query, keep_blank_values=True
                )
                action = str(
                    (response_query.get("action") or [""])[0]
                ).lower()
                if (not identifier or str(item.get("Url") or "").strip()
                        or action != "getformdatalist"):
                    continue
                item["Url"] = (
                    f"{origin}/#/detail/"
                    f"{urllib.parse.quote(identifier, safe='')}?"
                    + urllib.parse.urlencode({"name": "公司要闻"})
                )
                shenergy_synthesized += 1
        if shenergy_synthesized:
            logging.info(
                "[Mapping] 已用申能股份 GetFormDataList 接口 ID 补全 "
                f"{shenergy_synthesized} 条详情链接"
            )

        # 华融化学列表的 a[href="#"] 在部分自动化浏览器中不会执行 Vue
        # 路由，但 richTextNew/queryListByPage 已返回当前记录及前后相邻记录。
        # 前端公开详情路由把当前 ID 放在 newsId，并把相邻记录放在
        # previewInfo/nexviewInfo；按列表顺序构造即可得到与手工点击一致的 URL。
        cnchccl_synthesized = 0
        if source_host in {"cnchccl.com", "www.cnchccl.com"}:
            ordered_items = list(result.values())
            allowed_neighbor_keys = (
                "id", "fileType", "title", "createTime", "topType",
                "pictureUrl", "year", "month", "day",
            )

            def neighbor_json(item):
                record = item.get("Record") if isinstance(item, dict) else None
                if not isinstance(record, dict):
                    return ""
                normalized = {
                    self._normalize_key(key): value
                    for key, value in record.items()
                }
                compact = {}
                for key in allowed_neighbor_keys:
                    value = normalized.get(self._normalize_key(key))
                    if value not in (None, ""):
                        compact[key] = value
                return json.dumps(
                    compact, ensure_ascii=False, separators=(",", ":")
                ) if compact.get("id") else ""

            source_parts = urllib.parse.urlsplit(self.source_url)
            current_page = urllib.parse.parse_qs(
                source_parts.query, keep_blank_values=True
            ).get("current", ["1"])[0]
            detail_base = urllib.parse.urlunsplit((
                source_parts.scheme or "https", source_parts.netloc,
                "/newsDetail", "", "",
            ))
            for index, item in enumerate(ordered_items):
                identifier = str(item.get("Id") or "").strip()
                response_url = str(item.get("SourceUrl") or "").lower()
                if (not identifier or str(item.get("Url") or "").strip()
                        or "/richtextnew/querylistbypage" not in response_url):
                    continue
                query_parts = [
                    "current=" + urllib.parse.quote(str(current_page), safe=""),
                    "newsId=" + urllib.parse.quote(identifier, safe=""),
                ]
                previous = neighbor_json(ordered_items[index - 1]) if index else ""
                following = (
                    neighbor_json(ordered_items[index + 1])
                    if index + 1 < len(ordered_items) else ""
                )
                if previous:
                    query_parts.append(
                        "previewInfo=" + urllib.parse.quote(previous, safe="{}")
                    )
                if following:
                    query_parts.append(
                        "nexviewInfo=" + urllib.parse.quote(following, safe="{}")
                    )
                item["Url"] = detail_base + "?" + "&".join(query_parts)
                cnchccl_synthesized += 1
        if cnchccl_synthesized:
            logging.info(
                "[Mapping] 已用华融化学列表接口记录补全 "
                f"{cnchccl_synthesized} 条 newsDetail 链接"
            )
        # Record 仅用于上述站点的相邻记录路由构造，不进入最终字段结果。
        for item in result.values():
            item.pop("Record", None)

        # 只有当前可见标题已成功覆盖大部分且 URL 各不相同时，才跳过耗时点击。
        valid_api_urls = {
            str(item.get("Url") or "").strip()
            for item in result.values() if item.get("Url")
        }
        needed_count = len(expected_titles) or len(self.item_xpaths)
        matched_with_url = sum(
            1 for title in (expected_titles or set(result))
            if title in result and str(result[title].get("Url") or "").strip()
        )
        if (matched_with_url >= max(3, int(needed_count * 0.8))
                and len(valid_api_urls) > 1):
            logging.info(
                f"[NoAnchor] 接口/Payload 已成功映射 "
                f"{matched_with_url}/{needed_count} 个当前列表标题，"
                "跳过模拟点击流程"
            )
            return result

        clicked = self.capture_by_clicking_titles()
        if clicked:
            clicked_urls = {
                str(item.get("Url") or "").strip()
                for item in clicked.values() if item.get("Url")
            }
            if len(clicked) > 1 and len(clicked_urls) == 1:
                logging.info(
                    "[ClickCapture] 多条点击结果的 URL 全部相同，"
                    "整批点击映射已排除"
                )
            else:
                route_template = self._derive_route_template(clicked, result)
                if route_template:
                    for api_item in result.values():
                        identifier = str(api_item.get("Id") or "").strip()
                        if identifier and not str(api_item.get("Url") or "").strip():
                            api_item["Url"] = route_template.replace(
                                "{id}", urllib.parse.quote(identifier, safe="")
                            )
                    logging.info(
                        "[Mapping] 已用点击后的地址栏 URL 模板补全接口 ID 链接: "
                        f"{route_template}"
                    )
                for title, item in clicked.items():
                    old = result.get(title, {})
                    merged = dict(old)
                    merged.update(item)
                    if not item.get("Date") and old.get("Date"):
                        merged["Date"] = old["Date"]
                    result[title] = merged
        synthesized_count = 0
        for item in result.values():
            if str(item.get("Url") or "").strip():
                continue
            identifier = str(item.get("Id") or "").strip()
            response_url = str(item.get("SourceUrl") or "").strip()
            lowered_source = response_url.lower()
            if not identifier:
                continue
            # 这类 SPA 在列表接口中已经返回完整文章记录，点击只切换组件，
            # 地址栏和网络请求都不会变化。接口中的唯一 content ID 是唯一可用
            # 的逐条标识，因此把它作为栏目页查询参数保留下来。
            if "selectmarscontentbycategoryid" in lowered_source:
                base_url = str(self.source_url or self.page.url or "").strip()
                item["Url"] = self._hash_route_with_id(
                    base_url, identifier, response_url
                )
                synthesized_count += 1
            # 该站的 Vue Router 把新闻 ID 仅放在 route params/localStorage，
            # 公开详情路由本身不含 ID；接口路径与前端路由代码共同提供了
            # 可验证的详情地址。点击捕获成功时仍以前面的真实结果为准。
            elif ("/article/news/getnewslist/" in lowered_source
                  and urllib.parse.urlsplit(self.source_url).hostname in {
                      "hnsyec.com", "www.hnsyec.com"
                  }):
                detail_url = urllib.parse.urljoin(
                    self.source_url, "/newsCenter-xinwenxiangqing"
                )
                item["Url"] = self._hash_route_with_id(
                    detail_url, identifier, "news"
                )
                synthesized_count += 1
        if synthesized_count:
            logging.info(
                f"[Mapping] 已用列表接口唯一 ID 补全 "
                f"{synthesized_count} 条页内详情链接"
            )
        return result

    @staticmethod
    def _derive_route_template(
        clicked: Dict[str, Dict[str, str]],
        api_result: Dict[str, Dict[str, str]],
    ) -> str:
        """用同一标题的已知 ID 从真实点击 URL 推导可复用路由模板。"""
        for title, clicked_item in clicked.items():
            target_url = str(clicked_item.get("Url") or "").strip()
            identifier = str((api_result.get(title) or {}).get("Id") or "").strip()
            if not target_url or not identifier:
                continue
            encoded_values = {
                identifier,
                urllib.parse.quote(identifier, safe=""),
                urllib.parse.quote_plus(identifier),
            }
            for value in sorted(encoded_values, key=len, reverse=True):
                pattern = re.compile(
                    rf"(?<=[/?#=&]){re.escape(value)}(?=([/?#&=]|$))"
                )
                if pattern.search(target_url):
                    return pattern.sub("{id}", target_url, count=1)
        return ""

    def capture_nuxt_payload_map(self) -> Dict[str, Dict[str, str]]:
        """解析 Nuxt SSR 的 devalue 扁平数据，恢复可见新闻的 ID、日期和 URL。"""
        try:
            raw = self.page.evaluate("""
                () => {
                    const node = document.querySelector(
                        'script#__NUXT_DATA__[type="application/json"], '
                        + 'script[data-nuxt-data][type="application/json"]'
                    );
                    return node ? String(node.textContent || '') : '';
                }
            """) or ""
        except Exception as ex:
            logging.warning(f"[Nuxt] 读取 __NUXT_DATA__ 失败: {ex}")
            return {}
        if not raw.strip():
            return {}
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as ex:
            logging.warning(f"[Nuxt] __NUXT_DATA__ JSON 解析失败: {ex}")
            return {}
        if not isinstance(payload, list):
            return {}

        try:
            visible_texts = set(self.page.evaluate("""
                () => Array.from(document.querySelectorAll('body *'))
                    .filter(node => node.children.length === 0)
                    .map(node => String(node.innerText || node.textContent || '')
                        .replace(/\\s+/g, ' ').trim()).filter(Boolean)
            """) or [])
        except Exception:
            visible_texts = set()

        def scalar(value):
            """Nuxt devalue 中整数通常是顶层值表的引用。"""
            seen = set()
            while isinstance(value, int) and not isinstance(value, bool):
                if value < 0 or value >= len(payload) or value in seen:
                    break
                seen.add(value)
                value = payload[value]
            return value

        def field(record, names):
            normalized = {self._normalize_key(key): value for key, value in record.items()}
            for name in names:
                if name in normalized:
                    value = scalar(normalized[name])
                    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
                        return str(value).strip()
            return ""

        result: Dict[str, Dict[str, str]] = {}
        for record in payload:
            if not isinstance(record, dict):
                continue
            title = " ".join(field(record, {
                "title", "newstitle", "articletitle", "contenttitle", "headline"
            }).split())
            if len(title) < 4 or (visible_texts and title not in visible_texts):
                continue
            identifier = field(record, {"id", "contentid", "newsid", "articleid"})
            item_url = field(record, {
                "url", "href", "link", "detailurl", "articleurl", "newsurl", "route"
            })
            if item_url and self._looks_like_item_url(item_url):
                item_url = urllib.parse.urljoin(self.page.url, item_url)
            else:
                item_url = ""
            # 部分 Nuxt 新闻页用同一路由弹层显示详情，并通过 itemId 支持
            # 深链接。数据本身没有 URL 时保留当前分类参数，只追加记录 ID。
            if not item_url and identifier:
                current_url = str(getattr(self.page, "url", "") or "")
                base_url = (
                    current_url if current_url.startswith(("http://", "https://"))
                    else self.source_url
                )
                parsed = urllib.parse.urlsplit(base_url)
                params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
                # 仅对已带新闻分类 ID 的同路由弹层页使用 itemId。其他 Nuxt
                # 路由命名不统一，继续交给网络监听/点击捕获，禁止臆造链接。
                normalized_params = {key.lower() for key in params}
                if "news" in parsed.path.lower() and (
                    "id" in normalized_params or "targetid" in normalized_params
                ):
                    params["itemId"] = [identifier]
                    item_url = urllib.parse.urlunsplit((
                        parsed.scheme, parsed.netloc, parsed.path,
                        urllib.parse.urlencode(params, doseq=True), parsed.fragment,
                    ))
            if not item_url:
                continue
            date_value = field(record, {
                "date", "time", "publishtime", "publishdate", "releasedate",
                "createtime", "createdate", "updatetime", "labeltime"
            })
            result[title] = {
                "Url": item_url,
                "Id": identifier,
                "Date": self.match_date_value(date_value),
            }
        logging.info(f"[Nuxt] 已解析 __NUXT_DATA__; 可见标题映射={len(result)} 条")
        if result:
            logging.info(f"[Mapping] 已建立 {len(result)} 条 Nuxt 标题→详情链接映射")
        return result

    @staticmethod
    def _normalize_key(value) -> str:
        return re.sub(r"[^a-z0-9]", "", str(value or "").lower())

    @staticmethod
    def _walk(value):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from NoAnchorUrlResolver._walk(child)
        elif isinstance(value, list):
            for child in value:
                yield from NoAnchorUrlResolver._walk(child)
        elif isinstance(value, str):
            # 一些 .NET 接口把实际数组再次 JSON 序列化到 ResultValue 等
            # 字符串字段中。只展开看起来确实是 JSON 容器的字符串，正文、
            # HTML 和普通标题不会进入解析。
            stripped = value.strip()
            if len(stripped) >= 2 and (
                (stripped.startswith("[") and stripped.endswith("]"))
                or (stripped.startswith("{") and stripped.endswith("}"))
            ):
                try:
                    nested = json.loads(stripped)
                except (TypeError, ValueError, json.JSONDecodeError):
                    return
                yield from NoAnchorUrlResolver._walk(nested)

    @staticmethod
    def _looks_like_item_url(value: str) -> bool:
        raw = str(value or "").strip()
        if not raw or len(raw) > 2000:
            return False
        if re.match(r"^(?:javascript|data|about):", raw, re.IGNORECASE) or re.search(
            r"\bvoid\s*\(\s*0\s*\)", raw, re.IGNORECASE
        ):
            return False
        if re.search(
            r"\.(?:jpe?g|png|gif|webp|svg|bmp|ico|pdf|docx?|xlsx?|zip|rar)(?:[?#]|$)",
            raw,
            re.IGNORECASE,
        ) or "/profile/upload/" in raw.lower():
            return False
        return bool(
            re.match(r"^(?:https?://|/|#\/)", raw, re.IGNORECASE)
            or re.search(r"\.(?:html?|aspx?)(?:[?#]|$)", raw, re.IGNORECASE)
        )

    @staticmethod
    def _is_valid_navigation_url(value: str) -> bool:
        raw = str(value or "").strip()
        if not raw or raw == "#":
            return False
        parsed = urllib.parse.urlsplit(raw)
        # 地址栏错误页（chrome-error://chromewebdata/）表示导航失败，
        # 不能因为它与列表页地址不同就当成详情 URL。其他浏览器内部协议
        # 同样排除；无 scheme 的相对地址仍交给后续拼接处理。
        if parsed.scheme and parsed.scheme.lower() not in {"http", "https"}:
            return False
        if re.search(r"\bvoid\s*\(\s*0\s*\)", raw, re.IGNORECASE):
            return False
        # 排除第三方埋点、统计和上报请求
        if re.search(
            r"jingsocial\.com|hm\.baidu\.com|cnzz\.com|google-analytics\.com|clarity\.ms|growingio\.com|sensorsdata|umeng|51\.la",
            raw,
            re.IGNORECASE,
        ):
            return False
        if re.search(
            r"/(?:track|beacon|collect|analytics|report|stat|log|ping|pv)(?:/|\?|$)",
            raw,
            re.IGNORECASE,
        ):
            return False
        return True

    @staticmethod
    def _hash_route_with_id(original_url: str, identifier: str, semantic: str) -> str:
        if not identifier:
            return ""
        parsed_original = urllib.parse.urlsplit(original_url)
        decoded_id = urllib.parse.unquote(str(identifier)).strip()
        existing_values = {
            urllib.parse.unquote(str(value)).strip()
            for values in urllib.parse.parse_qs(
                parsed_original.query, keep_blank_values=True
            ).values()
            for value in values
        }
        route_tokens = {
            urllib.parse.unquote(token).strip()
            for token in re.split(r"[/#?&=]", (
                parsed_original.path + "#" + parsed_original.fragment
            ))
            if token
        }
        # 地址栏路由已经携带同一个 ID 时不要再追加 ?newsId=<ID>；
        # 例如 /cn/news/457 点击后同时请求 /api/jy/news/get?id=457。
        if decoded_id and decoded_id in existing_values.union(route_tokens):
            return original_url
        lowered = semantic.lower()
        if "content" in lowered:
            param = "contentId"
        elif "article" in lowered:
            param = "articleId"
        elif "news" in lowered:
            param = "newsId"
        else:
            param = "id"
        if "#/" in original_url:
            base, fragment = original_url.split("#", 1)
            route, _, query = fragment.partition("?")
            params = urllib.parse.parse_qs(query, keep_blank_values=True)
            params[param] = [identifier]
            return base + "#" + route + "?" + urllib.parse.urlencode(params, doseq=True)
        parsed = urllib.parse.urlsplit(original_url)
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        params[param] = [identifier]
        return urllib.parse.urlunsplit((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(params, doseq=True),
            parsed.fragment,
        ))

    def capture_initial_network_map(self) -> Dict[str, Dict[str, str]]:
        """递归识别导航前捕获的 XHR/Fetch JSON 标题、日期、URL或ID。"""
        getter = getattr(self.page, "get_network_json_responses", None)
        if not callable(getter):
            return {}
        try:
            responses = getter() or []
        except Exception as ex:
            logging.warning(f"[Network] 读取 CDP XHR/Fetch 响应失败: {ex}")
            return {}

        title_keys = {
            "title", "newstitle", "articletitle", "contenttitle", "subject",
            "headline", "name", "newsname", "articlename",
        }
        url_keys = {
            "url", "href", "link", "detailurl", "articleurl", "newsurl",
            "pcurl", "wapurl", "path", "route", "router", "linkurl",
        }
        date_keys = {
            "date", "time", "publishtime", "publishdate", "releasedate",
            "createtime", "createdate", "createon", "updatetime",
            "modifiedon", "labeltime",
        }
        content_keys = {
            "content", "newscontent", "articlecontent", "body", "detailcontent",
        }
        summary_keys = {
            "description", "summary", "abstract", "brief", "intro",
        }
        try:
            visible_texts = set(self.page.evaluate("""
                () => Array.from(document.querySelectorAll('body *'))
                    .filter(node => node.children.length === 0)
                    .map(node => String(node.innerText || node.textContent || '')
                        .replace(/\\s+/g, ' ').trim()).filter(Boolean)
            """) or [])
        except Exception:
            visible_texts = set()

        result: Dict[str, Dict[str, str]] = {}
        response_urls = []
        for response in responses:
            response_urls.append(str(response.get("url") or ""))
            for record in self._walk(response.get("payload")):
                scalars = [
                    (self._normalize_key(key), str(value).strip())
                    for key, value in record.items()
                    if isinstance(value, (str, int, float)) and value is not None
                ]
                title_key, title = next(
                    ((key, value) for key, value in scalars
                     if key in title_keys and len(value) >= 4),
                    ("", ""),
                )
                title = " ".join(title.split())
                # DOM 未渲染时接口标题不会出现在可见文本中。候选最终还会在
                # BrowserManager 按新闻接口 URL 分组并要求至少两条记录，
                # 因此这里不能提前用可见文本把真实接口列表全部过滤掉。
                if not title:
                    continue
                item_url = next(
                    (value for key, value in scalars
                     if key in url_keys and self._looks_like_item_url(value)), ""
                )
                if not item_url:
                    item_url = next(
                        (value for key, value in scalars
                         if not re.search(r"img|image|icon|banner|logo|file|attach", key)
                         and self._looks_like_item_url(value)), ""
                    )
                identifier = next(
                    (value for key, value in scalars
                     if key in {"id", "contentid", "newsid", "articleid"}), ""
                )
                if not item_url and not identifier:
                    continue
                response_url = str(response.get("url") or "")
                if not item_url and identifier:
                    # 从 LoadNews / LoadNotice 这类列表接口动态推导同目录详情
                    # 地址，不绑定具体站点。保留分类参数，移除分页参数。
                    source_parts = urllib.parse.urlsplit(response_url)
                    detail_path = re.sub(
                        r"load(news|notice|article)s?$",
                        lambda match: f"{match.group(1).title()}Detail",
                        source_parts.path,
                        flags=re.I,
                    )
                    if detail_path != source_parts.path:
                        detail_query = urllib.parse.parse_qs(
                            source_parts.query, keep_blank_values=True
                        )
                        for page_key in list(detail_query):
                            if page_key.lower() in {
                                "page", "pageindex", "pagenum", "pagesize"
                            }:
                                detail_query.pop(page_key, None)
                        detail_query["id"] = [identifier]
                        detail_query.setdefault("bg", ["false"])
                        item_url = urllib.parse.urlunsplit((
                            source_parts.scheme,
                            source_parts.netloc,
                            detail_path,
                            urllib.parse.urlencode(detail_query, doseq=True),
                            "",
                        ))
                date_value = next(
                    (value for key, value in scalars if key in date_keys), ""
                )
                content_value = next(
                    (value for key, value in scalars if key in content_keys), ""
                )
                summary_raw = next(
                    (value for key, value in scalars if key in summary_keys), ""
                ) or content_value
                summary_value = self._clean_plain_text(summary_raw)
                result[title] = {
                    "Url": (
                        item_url if item_url.startswith(("http://", "https://"))
                        else urllib.parse.urljoin(self.page.url, item_url)
                    ) if item_url else "",
                    "Id": identifier,
                    "SourceUrl": response_url,
                    "Date": self.match_date_value(date_value),
                    "Summary": summary_value,
                    "Record": {
                        key: value for key, value in record.items()
                        if isinstance(value, (str, int, float, bool))
                        and self._normalize_key(key) not in content_keys
                    },
                }
        logging.info(
            f"[Network] 已检查 {len(responses)} 个 XHR/Fetch JSON 响应; "
            f"接口={response_urls}; 映射={len(result)} 条"
        )
        if result:
            logging.info(f"[Mapping] 已建立 {len(result)} 条接口标题→详情链接映射")
        return result

    def capture_by_clicking_titles(self) -> Dict[str, Dict[str, str]]:
        """复用当前列表页逐项点击；拦截导航，不打开详情页。"""
        if not self.item_xpaths:
            return {}
        # Playwright set_content 加载的本地快照没有 Vue/React 运行时事件，
        # 只能用于 DOM 算法回归；模拟点击必须在真实 CDP 页面执行。
        if not hasattr(self.page, "network_responses"):
            logging.info("[ClickCapture] 当前为静态快照，跳过点击；等待真实 CDP 页面捕获")
            return {}
        original_url = self.page.url

        def is_meaningful_navigation(value: str) -> bool:
            """空锚点（仅多一个 #）仍是列表页，不算详情跳转。"""
            candidate = str(value or "").strip()
            if not self._is_valid_navigation_url(candidate):
                return False
            try:
                original = urllib.parse.urlsplit(str(original_url or "").strip())
                current = urllib.parse.urlsplit(candidate)
                return (
                    current.scheme.lower(), current.netloc.lower(), current.path,
                    current.query, current.fragment or "",
                ) != (
                    original.scheme.lower(), original.netloc.lower(), original.path,
                    original.query, original.fragment or "",
                )
            except Exception:
                return candidate.rstrip("#") != str(original_url or "").strip().rstrip("#")

        def list_browser_page_targets():
            """读取调试浏览器全部普通标签，用于捕获 window.open 新标签地址栏。"""
            port = getattr(self.page, "port", None)
            if not port:
                return []
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{int(port)}/json/list",
                    headers={"Host": "localhost"},
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    targets = json.loads(response.read().decode(
                        "utf-8", errors="replace"
                    ))
                return [
                    target for target in targets
                    if str(target.get("type") or "") == "page"
                ]
            except Exception:
                return []

        def close_browser_target(target_id: str) -> None:
            port = getattr(self.page, "port", None)
            if not port or not target_id:
                return
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{int(port)}/json/close/{target_id}",
                    headers={"Host": "localhost"},
                )
                with urllib.request.urlopen(request, timeout=2):
                    pass
            except Exception:
                pass
        click_items = []
        seen_titles = set()
        for idx, item_xpath in enumerate(self.item_xpaths, 1):
            title = ""
            if self.title_plan:
                title = " ".join(str(self.get_plan_value(
                    self.page, item_xpath, self.title_plan
                ) or "").split())
            if not title:
                title = f"列表项_{idx}"
            if title not in seen_titles:
                seen_titles.add(title)
                click_items.append((item_xpath, title))
        titles = [title for _, title in click_items]
        guard_script = """
            () => {
                window.__qlClickCapture = {urls: [], requests: []};
                const save = value => {
                    if (!value) return;
                    const raw = String(value).trim();
                    if (/^(?:javascript|data|about):/i.test(raw) ||
                        /\\bvoid\\s*\\(\\s*0\\s*\\)/i.test(raw)) return;
                    try { value = new URL(String(value), location.href).href; }
                    catch (_) { value = String(value); }
                    if (!window.__qlClickCapture.urls.includes(value))
                        window.__qlClickCapture.urls.push(value);
                };
                const saveRequest = value => {
                    save(value);
                    if (!value) return;
                    try { value = new URL(String(value), location.href).href; }
                    catch (_) { value = String(value); }
                    if (!window.__qlClickCapture.requests.includes(value))
                        window.__qlClickCapture.requests.push(value);
                };
                const openWindow0 = window.open.bind(window);
                window.open = function(value) {
                    save(value); return openWindow0.apply(window, arguments);
                };
                const pushState0 = history.pushState.bind(history);
                history.pushState = function(_s, _t, value) {
                    save(value); return pushState0.apply(history, arguments);
                };
                const replaceState0 = history.replaceState.bind(history);
                history.replaceState = function(_s, _t, value) {
                    save(value); return replaceState0.apply(history, arguments);
                };
                const fetch0 = window.fetch;
                window.fetch = function(input) {
                    saveRequest(typeof input === 'string' ? input : input && input.url);
                    return fetch0.apply(this, arguments);
                };
                const open0 = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(method, value) {
                    saveRequest(value); return open0.apply(this, arguments);
                };
                document.addEventListener('click', event => {
                    const a = event.target && event.target.closest
                        ? event.target.closest('a[href]') : null;
                    if (a) save(a.href);
                }, true);
                return true;
            }
        """

        def restore_and_wait_for_list(click_page) -> bool:
            """恢复列表路由，并等待 Vue 把原列表项重新渲染到 DOM。"""
            click_page.goto(
                original_url, wait_until="domcontentloaded", timeout=30000
            )
            expected_count = len(self.item_xpaths)
            minimum_ready = min(3, expected_count)
            for _ in range(60):
                ready_count = click_page.evaluate(r"""
                    xpaths => xpaths.filter(xpath => {
                        const node = document.evaluate(
                            xpath.startsWith('/') ? xpath : '/' + xpath,
                            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                        return node && String(node.innerText || node.textContent || '')
                            .replace(/\s+/g, ' ').trim().length >= 2;
                    }).length
                """, self.item_xpaths)
                if int(ready_count or 0) >= minimum_ready:
                    logging.info(
                        f"[ClickCapture] 列表 DOM 已恢复: "
                        f"{ready_count}/{expected_count} 项"
                    )
                    return True
                time.sleep(0.2)
            logging.warning(
                f"[ClickCapture] 列表 DOM 恢复超时: 需要至少 "
                f"{minimum_ready}/{expected_count} 项"
            )
            return False

        result = {}
        uncaptured_count = 0
        for index, (item_xpath, title) in enumerate(click_items, start=1):
            if uncaptured_count >= 3:
                logging.info(
                    f"[ClickCapture] 未捕获已达到 {uncaptured_count} 个，提前终止后续点击尝试"
                )
                break
            try:
                click_page = self.page
                # 上一次点击可能已改变 SPA 内部状态。复用同一标签并恢复列表页，
                # 禁止为每条新闻创建新标签而触发全局五标签上限。
                current_url = str(getattr(click_page, "url", "") or "")
                if current_url != original_url or index > 1:
                    if not restore_and_wait_for_list(click_page):
                        break
                for _ in range(30):
                    found = click_page.evaluate("""
                        expected => Array.from(document.querySelectorAll('body *'))
                            .some(node => String(node.innerText || node.textContent || '')
                                .replace(/\\s+/g, ' ').trim() === expected)
                    """, title)
                    if found:
                        break
                    time.sleep(0.2)
                click_page.evaluate(guard_script)
                before_ids = set(getattr(click_page, "network_responses", {}))
                before_targets = {
                    str(target.get("id") or target.get("targetId") or ""):
                    str(target.get("url") or "").strip()
                    for target in list_browser_page_targets()
                }
                click_result = {}
                for click_attempt in range(6):
                    attempt_before_ids = set(
                        getattr(click_page, "network_responses", {})
                    )
                    click_result = click_page.evaluate(r"""
                    args => {
                        const item = document.evaluate(
                            args.itemXpath.startsWith('/')
                                ? args.itemXpath : '/' + args.itemXpath,
                            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                        if (!item) return {clicked:false, target:''};
                        const cleanText = node => String(
                            node.innerText || node.textContent || ''
                        ).replace(/\s+/g, ' ').trim();
                        const descendants = [item, ...item.querySelectorAll('*')];
                        const candidates = [];
                        const add = node => {
                            if (node && item.contains(node) && !candidates.includes(node))
                                candidates.push(node);
                        };
                        descendants
                            .filter(n => /^(?:查看详细|查看更多|查看全部|了解更多|阅读全文|点击查看|查看详情|查看|详细|详情|了解详情|阅读详情|更多|下载|read\s*more|details?|more|view)[>》›»+＋→]*$/i.test(cleanText(n)))
                            .sort((a,b) => {
                                const interactive = n => n.matches([
                                    'button', 'a[href]', '[onclick]',
                                    '[role="link"]', '[role="button"]'
                                ].join(',')) ? 1 : 0;
                                return interactive(b) - interactive(a) ||
                                    a.children.length - b.children.length;
                            }).forEach(add);
                        descendants.filter(n => {
                                const semantic = `${String(n.className || '')} ${String(n.id || '')}`
                                    .toLowerCase();
                                return /detail|more|showdesc|readmore|button|btn/.test(semantic) &&
                                    cleanText(n).length <= 30;
                            }).sort((a,b) => a.children.length-b.children.length)
                            .forEach(add);
                        descendants.filter(n => cleanText(n) === args.expected)
                            .sort((a,b) => a.children.length-b.children.length)
                            .forEach(add);
                        descendants.filter(n => n.matches(
                            'a, img, button, [class*="img"], [class*="card"], [class*="item"]'
                        )).forEach(add);
                        add(item);
                        // 同一可见文案可能同时出现在 button、文字层和外层容器。
                        // 每次只尝试一个层级，Python 侧检查 URL/网络变化后再决定
                        // 是否继续下一层，避免把“执行了 node.click”误当作跳转成功。
                        let node = candidates[args.attemptIndex];
                        if (!node) return {clicked:false, target:''};
                        // Vue/React 列表经常把 click 监听器绑定在卡片祖先上，
                        // 标题节点本身只是普通 div。优先点击语义明确的卡片祖先，
                        // 仍保留事件冒泡作为兜底。
                        const clickableAncestor = node.closest([
                            'a[href]', '[onclick]', '[data-url]', '[data-href]',
                            '[role="link"]', '[role="button"]', '.pointer',
                            '.el-tag',
                            '[class*="click"]', '[class*="item"]', '[class*="card"]'
                        ].join(','));
                        if (clickableAncestor && item.contains(clickableAncestor)) {
                            node = clickableAncestor;
                        }
                        const target = cleanText(node) || String(node.className || '');
                        if (typeof node.click === 'function') node.click();
                        else node.dispatchEvent(new MouseEvent('click', {
                            bubbles:true, cancelable:true, view:window
                        }));
                        return {clicked:true, target, candidateCount:candidates.length};
                    }
                    """, {
                        "expected": title,
                        "itemXpath": item_xpath,
                        "attemptIndex": click_attempt,
                    }) or {}
                    if not click_result.get("clicked"):
                        break
                    logging.info(
                        f"[ClickCapture] ({index}/{len(titles)}) 尝试点击层 "
                        f"{click_attempt + 1}/{click_result.get('candidateCount') or '?'}: "
                        f"{click_result.get('target') or '(未知)'}"
                    )
                    # SPA pushState 通常立即改变地址；接口驱动的详情页则会先发请求。
                    # 两者均无变化时才继续尝试同一列表项的下一候选层。
                    click_changed = False
                    for _ in range(5):
                        time.sleep(0.2)
                        try:
                            live_url = str(click_page.evaluate(
                                "() => String(window.location.href || '')"
                            ) or "").strip()
                        except Exception:
                            live_url = str(getattr(click_page, "url", "") or "").strip()
                        try:
                            captured_now = click_page.evaluate(
                                "() => (window.__qlClickCapture && "
                                "window.__qlClickCapture.urls) || []"
                            ) or []
                        except Exception:
                            captured_now = []
                        new_response = any(
                            request_id not in attempt_before_ids
                            for request_id in getattr(
                                click_page, "network_responses", {}
                            )
                        )
                        captured_navigation = any(
                            is_meaningful_navigation(value)
                            for value in captured_now
                        )
                        if is_meaningful_navigation(live_url) or captured_navigation or new_response:
                            click_changed = True
                            break
                    if click_changed:
                        break
                if not click_result.get("clicked"):
                    uncaptured_count += 1
                    logging.info(f"[ClickCapture] ({index}/{len(titles)}) 未找到可点击节点: {title}")
                    if uncaptured_count >= 3:
                        logging.info(
                            f"[ClickCapture] 未捕获已达到 {uncaptured_count} 个，提前终止后续点击尝试"
                        )
                        break
                    continue
                logging.info(
                    f"[ClickCapture] ({index}/{len(titles)}) 点击节点: "
                    f"{click_result.get('target') or '(未知)'}"
                )
                for _ in range(8):
                    time.sleep(0.2)
                    try:
                        click_page.evaluate("() => document.readyState")
                    except Exception:
                        # 整页跳转期间执行上下文会短暂销毁；继续等新页面就绪，
                        # 不能把这种正常导航误判为点击捕获失败。
                        continue
                try:
                    captured = click_page.evaluate(
                        "() => (window.__qlClickCapture && window.__qlClickCapture.urls) || []"
                    ) or []
                except Exception:
                    captured = []
                try:
                    captured_requests = click_page.evaluate(
                        "() => (window.__qlClickCapture && "
                        "window.__qlClickCapture.requests) || []"
                    ) or []
                except Exception:
                    captured_requests = []
                # Vue Router 可能在初始化时保存了原始 history.pushState 引用，
                # 从而绕过上面的运行时猴子补丁；整页导航又会清空旧页面的
                # __qlClickCapture。无论哪种情况，CDP 当前页面地址都是最可靠
                # 的最终导航结果，必须纳入候选。
                current_page_url = ""
                browser_location_url = ""
                new_tab_url = ""
                new_tab_target_id = ""
                new_tab_is_new = False
                for _ in range(20):
                    try:
                        current_page_url = str(
                            getattr(click_page, "url", "") or ""
                        ).strip()
                    except Exception:
                        current_page_url = ""
                    try:
                        browser_location_url = str(click_page.evaluate(
                            "() => String(window.location.href || '')"
                        ) or "").strip()
                    except Exception:
                        browser_location_url = ""
                    if is_meaningful_navigation(
                        current_page_url
                    ) or is_meaningful_navigation(browser_location_url):
                        break
                    time.sleep(0.2)
                # target="_blank" / window.open 会把真实详情地址放在新标签页，
                # 原列表标签通常只剩 href="#"。必须读取浏览器标签列表中的
                # 新 target URL，不能只看 click_page.url。
                for _ in range(20):
                    new_targets = [
                        target for target in list_browser_page_targets()
                        if (
                            str(target.get("id") or target.get("targetId") or "")
                            != str(getattr(click_page, "target_id", "") or "")
                            and (
                                str(target.get("id") or target.get("targetId") or "")
                                not in before_targets
                                or before_targets.get(str(
                                    target.get("id") or target.get("targetId") or ""
                                )) != str(target.get("url") or "").strip()
                            )
                        )
                    ]
                    for target in new_targets:
                        candidate_url = str(target.get("url") or "").strip()
                        if is_meaningful_navigation(candidate_url):
                            new_tab_url = candidate_url
                            new_tab_target_id = str(
                                target.get("id") or target.get("targetId") or ""
                            )
                            new_tab_is_new = new_tab_target_id not in before_targets
                            break
                    if new_tab_url:
                        break
                    time.sleep(0.2)
                xhr_urls = [
                    str((meta.get("response") or {}).get("url") or "")
                    for request_id, meta in getattr(click_page, "network_responses", {}).items()
                    if request_id not in before_ids
                ]
                request_urls = list(dict.fromkeys(
                    [str(value) for value in xhr_urls + captured_requests if value]
                ))
                candidates = [
                    str(value) for value in (
                        ([new_tab_url] if new_tab_url else []) + captured + xhr_urls + (
                            [value for value in (
                                browser_location_url, current_page_url
                            ) if is_meaningful_navigation(value)]
                        )
                    )
                    if self._is_valid_navigation_url(str(value))
                ]
                # 实际页面导航比接口、埋点和静态资源请求更能代表详情 URL。
                target_url = (
                    new_tab_url
                    if new_tab_url
                    else browser_location_url
                    if is_meaningful_navigation(browser_location_url)
                    else ""
                )
                if not target_url:
                    target_url = (
                        current_page_url
                        if is_meaningful_navigation(current_page_url)
                        else ""
                    )
                if not target_url:
                    target_url = next((value for value in candidates if "#/" in value), "")
                if not target_url:
                    target_url = next(
                        (value for value in candidates
                         if self._is_valid_navigation_url(value)
                         and not re.search(r"/api/|\.json(?:[?#]|$)", value, re.I)), ""
                    )
                if not target_url:
                    for request_url in request_urls:
                        query = urllib.parse.parse_qs(
                            urllib.parse.urlsplit(request_url).query
                        )
                        identifier = next(
                            (values[0] for key, values in query.items()
                             if key.lower() in {"id", "contentid", "newsid", "articleid"}
                             and values), ""
                        )
                        target_url = self._hash_route_with_id(
                            original_url, identifier, request_url
                        )
                        if target_url:
                            break
                # 某些 Vue Router 页面把文章 ID 只放在 route params/localStorage，
                # 地址栏因此对所有文章都显示同一个详情路由；点击同时会请求
                # /viewNews/749 之类的接口。此时从点击新增接口的 query 或末级
                # path 提取 ID，并拼入已经取得的详情路由，形成逐条唯一 URL。
                # 这必须基于本次点击新增请求，不能从列表接口随意取 ID。
                if target_url:
                    request_identifier = ""
                    request_semantic = ""
                    for request_url in request_urls:
                        split_request = urllib.parse.urlsplit(request_url)
                        query = urllib.parse.parse_qs(
                            split_request.query, keep_blank_values=True
                        )
                        request_identifier = next(
                            (values[0] for key, values in query.items()
                             if key.lower() in {
                                 "id", "contentid", "newsid", "articleid"
                             } and values and str(values[0]).strip()),
                            "",
                        )
                        if not request_identifier:
                            path_match = re.search(
                                r"/(?:view|detail|get|show)?(?:news|article|content)?/([A-Za-z0-9_-]+)(?:/)?$",
                                split_request.path,
                                re.IGNORECASE,
                            )
                            if path_match:
                                request_identifier = path_match.group(1)
                        if request_identifier:
                            request_semantic = request_url
                            break
                    if request_identifier:
                        target_url = self._hash_route_with_id(
                            target_url, request_identifier, request_semantic
                        )
                if target_url:
                    result[title] = {"Url": target_url, "Date": ""}
                    logging.info(f"[ClickCapture] ({index}/{len(titles)}) {title} -> {target_url}")
                else:
                    uncaptured_count += 1
                    logging.info(f"[ClickCapture] ({index}/{len(titles)}) 未捕获: {title}")
                    if uncaptured_count >= 3:
                        logging.info(
                            f"[ClickCapture] 未捕获已达到 {uncaptured_count} 个，提前终止后续点击尝试"
                        )
                        break
                if new_tab_target_id and new_tab_is_new:
                    close_browser_target(new_tab_target_id)
            except Exception as ex:
                uncaptured_count += 1
                logging.warning(f"[ClickCapture] 点击拦截失败: {title}: {ex}")
                if uncaptured_count >= 3:
                    logging.info(
                        f"[ClickCapture] 未捕获已达到 {uncaptured_count} 个，提前终止后续点击尝试"
                    )
                    break
        # 后续字段提取仍依赖列表 DOM，捕获结束后确保页面回到列表状态。
        try:
            if titles and original_url.startswith(("http://", "https://")):
                restore_and_wait_for_list(self.page)
        except Exception as ex:
            logging.warning(f"[ClickCapture] 恢复列表页失败: {ex}")
        if result:
            logging.info(f"[ClickCapture] 已逐条点击 {len(titles)} 个标题，映射 {len(result)} 个 URL")
        return result

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
