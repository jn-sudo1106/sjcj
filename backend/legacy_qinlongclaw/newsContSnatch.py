# -*- coding: utf-8 -*-
"""MQ 新闻正文提取器。

从任务中读取原文 URL 和正文 HTML 路径，把 HTML 路径直接交给正文提取
服务，保存并上传正文 TXT，再把标题、原文 URL、日期、MinIO 路径和正文
大小提交给 saver。
"""

import hashlib
import html
import json
import logging
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Tuple, Union
from urllib.parse import quote, urlsplit

import pika
import requests
from lxml import etree
from pika.channel import Channel
from queue_url_history import queue_url_task, record_url, record_task_result

from content_extractor import (
    HtmlContentExtractor,
    extract_from_html,
    extract_wechat_html,
)


PROJECT_ROOT = Path(__file__).resolve().parent
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

log_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
file_handler = logging.FileHandler(
    LOG_DIR / "newsContSnatch.log", encoding="utf-8"
)
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler(sys.__stdout__)
console_handler.setFormatter(log_formatter)
logging.basicConfig(
    level=logging.INFO,
    handlers=[file_handler, console_handler],
)


MQ_HOST = os.environ.get("NEWS_CONTENT_MQ_HOST", "118.25.96.217")
MQ_PORT = int(os.environ.get("NEWS_CONTENT_MQ_PORT", "9672"))
MQ_USER = os.environ.get("NEWS_CONTENT_MQ_USER", "admin")
MQ_PASSWORD = os.environ.get("NEWS_CONTENT_MQ_PASSWORD", "")
MQ_QUEUE = os.environ.get("NEWS_CONTENT_QUEUE", "news_cont")

SAVE_URL = os.environ.get(
    "NEWS_SAVE_URL",
    "http://192.168.1.30:49102/api/v1/saver/save",
)
DOWNLOAD_URL = os.environ.get(
    "NEWS_CONTENT_DOWNLOAD_URL",
    "http://192.168.1.30:49102/api/oss/download",
)
OSS_UPLOAD_URL = os.environ.get(
    "NEWS_CONTENT_OSS_UPLOAD_URL",
    "http://192.168.1.30:9345/api/upload",
)

MINIO_AUTHORIZATION = os.environ.get(
    "NEWS_CONTENT_MINIO_AUTHORIZATION",
    "Basic YWRtaW46MTIzNDU=",
)
MINIO_BASE_PATH = os.environ.get(
    "NEWS_CONTENT_MINIO_BASE_PATH",
    "/qinlong/dds/",
)

MINIO_UPLOAD_BASE_PATH = os.environ.get(
    "NEWS_CONTENT_MINIO_UPLOAD_BASE_PATH",
    "/qinlong/stocknews/",
)


EXTRACT_CONTENT_URL = os.environ.get(
    "NEWS_CONTENT_EXTRACT_URL",
    "http://192.168.1.36:9090/extractContent",
)
CONTENT_DIR = Path(
    os.environ.get("NEWS_CONTENT_DIR", str(PROJECT_ROOT / "txt" / "content"))
).resolve()
HTML_CACHE_DIR = Path(
    os.environ.get("NEWS_HTML_CACHE_DIR", str(CONTENT_DIR))
).resolve()
ERROR_HTML_DIR = Path(
    os.environ.get("NEWS_ERROR_HTML_DIR", str(PROJECT_ROOT / "txt" / "error_html"))
).resolve()




def _normalized_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _clean_url(value: Any) -> str:
    return html.unescape(str(value or "")).strip().rstrip("，,")


def _is_http_url(value: str) -> bool:
    return urlsplit(str(value or "")).scheme.lower() in {"http", "https"}


def is_wechat_article_url(value: Any) -> bool:
    """仅把微信公众平台文章域名交给公众号专用正文解析器。"""
    return (urlsplit(_clean_url(value)).hostname or "").lower() == "mp.weixin.qq.com"


def _clear_emoji(value: Any) -> str:
    text = str(value or "")
    return re.sub(
        "[\U00010000-\U0010ffff\u2600-\u27bf\ufe0f]",
        "",
        text,
    ).strip()


def _first_xpath_text(doc, expression: str) -> str:
    values = doc.xpath(expression) if doc is not None else []
    if not values:
        return ""
    value = values[0]
    if isinstance(value, etree._Element):
        value = "".join(value.itertext())
    return " ".join(str(value or "").split())


def _wechat_node_text(node) -> str:
    """按 gzhdetail_crawl 的格式递归输出正文和公众号图片标记。"""
    if isinstance(node, etree._ElementUnicodeResult):
        return str(node).strip()
    if not isinstance(node, etree._Element):
        return ""
    if str(node.tag).lower() in {"script", "style", "noscript"}:
        return ""
    if str(node.tag).lower() == "img":
        image_url = node.get("data-src") or node.get("src") or ""
        return f"\n<WWIMAGE>{image_url}<\\WWIMAGE>\n" if image_url else ""

    inline_tags = {"span", "em", "strong", "b", "i", "u", "small", "label"}
    parts = []
    if node.text and node.text.strip():
        parts.append(node.text.strip())
    for child in node:
        child_text = _wechat_node_text(child)
        if child_text:
            if str(child.tag).lower() not in inline_tags:
                parts.append("\n")
            parts.append(child_text)
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    if str(node.tag).lower() in {"p", "div", "section", "li", "br", "a"}:
        parts.append("\n")
    return "".join(parts)


def is_pdf_url(value: Any) -> bool:
    """判断 URL 或文件路径是否为 PDF 文件。"""
    url_str = str(value or "").strip()
    if not url_str:
        return False
    path = urlsplit(url_str).path.lower()
    if path.endswith(".pdf"):
        return True
    if re.search(r"\.pdf($|[?&#])", url_str, re.IGNORECASE):
        return True
    return False


class PdfTaskSkipped(Exception):
    """检测到 PDF 文件，主动跳过抓取任务"""

    def __init__(self, message: str, original_url: str = ""):
        super().__init__(message)
        self.original_url = original_url


KNOWN_ERROR_EXTENSIONS = (
    ".gone",
    ".emp",
    ".ocr",
    ".waf",
    ".ifr",
    ".bin",
    ".meta",
)


class ErrorFileDetected(Exception):
    """在 error_html 目录下检测到已存在的非 txt 错误文件（如 .gone, .emp, .ocr 等）"""

    def __init__(
        self,
        file_path: Path,
        ext: str,
        original_url: str,
        file_md5: str = "",
    ):
        super().__init__(f"检测到已有错误文件: {file_path} ({ext})")
        self.file_path = file_path
        self.ext = ext
        self.original_url = original_url
        self.file_md5 = file_md5


def find_cached_error_file(file_md5: str) -> tuple[Optional[Path], str]:
    """检查 error_html 目录下是否已存在非 txt 的错误标记文件。"""
    if not file_md5:
        return None, ""
    safe_name = re.sub(r"[^0-9A-Za-z_.-]+", "_", file_md5).strip("._")
    if not safe_name:
        return None, ""

    for ext in KNOWN_ERROR_EXTENSIONS:
        err_path = ERROR_HTML_DIR / f"{safe_name}{ext}"
        if err_path.is_file():
            return err_path, ext

    # 扫描任何非 .html、.txt、.tmp 的已有同名文件
    for p in ERROR_HTML_DIR.glob(f"{safe_name}.*"):
        if p.is_file() and p.suffix.lower() not in {".html", ".txt", ".tmp"}:
            return p, p.suffix.lower()

    return None, ""


def delete_cached_error_files(file_md5: str) -> list[Path]:
    """如果正文提取成功，删除 error_html 目录下对应的所有历史错误文件（包括各种错误后缀及错误 HTML）。"""
    if not file_md5:
        return []
    safe_name = re.sub(r"[^0-9A-Za-z_.-]+", "_", file_md5).strip("._")
    if not safe_name:
        return []

    deleted = []
    for p in ERROR_HTML_DIR.glob(f"{safe_name}.*"):
        if p.is_file() and p.suffix.lower() != ".tmp":
            try:
                p.unlink(missing_ok=True)
                deleted.append(p)
                logging.info("[ErrorHTML][CLEAN] 正文提取成功，已删除对应错误文件: %s", p)
            except Exception as exc:
                logging.warning("[ErrorHTML][CLEAN] 删除对应错误文件失败 %s: %s", p, exc)
    return deleted


def get_task_context(task_bean: dict) -> dict:
    """取得 Task.Context；兼容 MQ 偶尔把 Context 序列化为 JSON 字符串。"""
    context = task_bean.get("Context")
    if isinstance(context, str):
        try:
            context = json.loads(context)
        except ValueError as exc:
            raise ValueError("Task.Context 不是有效 JSON") from exc
    if not isinstance(context, dict):
        raise ValueError("Task.Context 不是对象")
    return context


class ContentHtmlDownloadError(RuntimeError):
    """下载 HTML 失败（404、网络错误、空内容等）"""
    pass


class DownloadUrlFormatError(RuntimeError):
    """URL 非法或格式错误（非有效 HTTP/HTTPS URL、路径为空、格式损坏等）"""
    pass


def find_html_url(task_bean: dict) -> str:
    """正文 HTML 路径读取 Task.Context.content_html_path。"""
    context = get_task_context(task_bean)
    candidate = _clean_url(context.get("content_html_path"))
    if not candidate:
        candidate = _clean_url(task_bean.get("content_html_path"))
    if not candidate:
        raise DownloadUrlFormatError("Task.Context.content_html_path 为空")
    if _is_http_url(candidate):
        return candidate
    if not candidate.startswith("/"):
        raise DownloadUrlFormatError(
            f"Task.Context.content_html_path 下载URL格式错误: {candidate}"
        )
    return f"{DOWNLOAD_URL}?fileId={quote(candidate, safe='/')}"


def generate_guid_from_string(seed: str) -> str:
    """保持与 save_file.generate_guid_from_string 相同的 SHA1-GUID 规则。"""
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
    return (
        digest[:8]
        + "-"
        + digest[8:12]
        + "-"
        + digest[12:16]
        + "-"
        + digest[16:20]
        + "-"
        + digest[20:32]
    )


def normalize_publish_time(task_bean: dict, report_time: str) -> str:
    """取得 MinIO 目录日期；优先复用源 HTML FileId 中的 yyyyMMdd。"""
    context = get_task_context(task_bean)
    candidates = (
        context.get("content_html_path"),
        report_time,
        task_bean.get("BirthTime"),
        task_bean.get("DispatchTime"),
        task_bean.get("CompleteTime"),
    )
    for candidate in candidates:
        value = str(candidate or "").strip()
        compact_match = re.search(r"(?<!\d)(20\d{6})(?!\d)", value)
        if compact_match:
            return compact_match.group(1)
        date_match = re.search(
            r"(?<!\d)(20\d{2})\D+(\d{1,2})\D+(\d{1,2})(?!\d)",
            value,
        )
        if date_match:
            year, month, day = (int(part) for part in date_match.groups())
            try:
                return datetime(year, month, day).strftime("%Y%m%d")
            except ValueError:
                continue
    return datetime.now().strftime("%Y%m%d")


def build_content_file_id(
    task_bean: dict,
    original_url: str,
    report_time: str = "",
    file_md5: str = "",
    extension: str = ".txt",
) -> str:
    """按 save_file.upload_file_new 的规则生成正文或错误文件 MinIO FileId。"""
    domain = urlsplit(original_url).netloc
    if not domain:
        raise DownloadUrlFormatError(f"无法从原文 URL 提取域名: {original_url}")
    base_path = MINIO_UPLOAD_BASE_PATH.rstrip("/") + "/"
    publish_time = normalize_publish_time(task_bean, report_time)
    base_name = file_md5 if file_md5 else generate_guid_from_string(original_url)
    ext = extension if extension.startswith(".") else f".{extension}"
    filename = f"{base_name}{ext}"
    pic_md5_url = (
        base_path
        + domain.replace(".", "_")
        + "/"
        + publish_time
        + "/"
        + filename
    )
    logging.info("按 upload_file_new 规则生成 FileId: %s", pic_md5_url)
    return pic_md5_url


def find_original_url(task_bean: dict) -> str:
    """9002 使用 Task.Context.url 或 Task.Url 中的原文地址。"""
    context = get_task_context(task_bean)
    candidate = _clean_url(context.get("url"))
    if not candidate:
        candidate = _clean_url(task_bean.get("Url"))
    if not candidate:
        raise DownloadUrlFormatError("Task.Context.url 为空")
    if not _is_http_url(candidate):
        raise DownloadUrlFormatError(f"Task.Context.url 下载url格式错误: {candidate}")
    return candidate


def _response_value(payload: dict, *names: str) -> Any:
    values = {_normalized_key(key): value for key, value in payload.items()}
    for name in names:
        value = values.get(_normalized_key(name))
        if value is not None:
            return value
    return None


class ContentExtractor:
    def __init__(self):
        self.session = requests.Session()
        self.html_cache_dir = HTML_CACHE_DIR
        self.html_cache_dir.mkdir(parents=True, exist_ok=True)
        self.error_html_dir = ERROR_HTML_DIR
        self.error_html_dir.mkdir(parents=True, exist_ok=True)
        self.local_extractor = HtmlContentExtractor()

    def extract_wechat(self, html_content: Union[str, bytes]) -> dict:
        """调用【微信解析正式版】解析微信公众号文章 HTML。"""
        extracted = extract_wechat_html(html_content)
        if not extracted.get("content"):
            error_msg = extracted.get("error") or "微信解析正式版未提取到正文"
            logging.warning("[WeChat][Official] 未识别到正文: %s", error_msg)
            raise RuntimeError(f"微信公众号正式版解析未提取到正文: {error_msg}")
        logging.info(
            "[WeChat][Official] 提取成功: 类型=%s, 标题=%s, 日期=%s, 公众号=%s, 作者=%s, 正文=%s字符",
            extracted.get("content_type", "0"),
            extracted.get("title", "")[:100],
            extracted.get("report_time", "") or "(空)",
            extracted.get("nick_name", "") or "(空)",
            extracted.get("writer", "") or "(空)",
            len(extracted["content"]),
        )
        return extracted

    def save_error_html(
        self, source: bytes, file_md5: str = "", task_id: str = ""
    ) -> str:
        """把提取正文失败的 HTML 单独保存到 error_html 文件夹。"""
        if not source:
            return ""
        name_seed = file_md5 or task_id or datetime.now().strftime("%Y%m%d%H%M%S")
        safe_name = re.sub(r"[^0-9A-Za-z_.-]+", "_", name_seed).strip("._")
        error_file = self.error_html_dir / f"{safe_name}.html"
        try:
            temp_file = error_file.with_suffix(error_file.suffix + ".tmp")
            temp_file.write_bytes(source)
            os.replace(temp_file, error_file)
            logging.warning(
                "[ErrorHTML] 提取正文失败，已将源 HTML 单独保存至: %s", error_file
            )
            return str(error_file)
        except Exception as exc:
            logging.error("[ErrorHTML] 保存失败 HTML 异常: %s", exc)
            return ""

    def read_html_with_cache(
        self, html_url: str, file_md5: str = ""
    ) -> tuple[bytes, str, bool]:
        """根据任务 MD5 判断本地是否已缓存 HTML，已存在则不重复下载，否则下载并保存缓存。"""
        safe_name = re.sub(r"[^0-9A-Za-z_.-]+", "_", file_md5).strip("._")
        cache_file = (self.html_cache_dir / f"{safe_name}.html") if safe_name else None

        if cache_file and cache_file.exists() and cache_file.stat().st_size > 0:
            logging.info(
                "[Cache][HIT] 命中本地 HTML 缓存 (MD5=%s)，跳过 OSS 下载: %s",
                file_md5,
                cache_file,
            )
            source = cache_file.read_bytes()
            content_type = "text/html; charset=utf-8"
            return source, content_type, True

        logging.info("正在从 OSS 读取 HTML 到内存: %s (MD5=%s)", html_url, file_md5 or "(未提供)")
        try:
            response = self.session.get(html_url, timeout=(5, 30))
            response.raise_for_status()
            source = response.content
            if not source:
                raise ContentHtmlDownloadError(f"OSS 返回的 HTML 内容为空: {html_url}")
            if len(source) > 30 * 1024 * 1024:
                raise ContentHtmlDownloadError(f"HTML 超过 30MB，拒绝处理: {len(source)} bytes")
        except ContentHtmlDownloadError:
            raise
        except requests.exceptions.RequestException as req_exc:
            raise ContentHtmlDownloadError(f"从 OSS 下载 HTML 失败: {req_exc}") from req_exc
        except Exception as exc:
            raise ContentHtmlDownloadError(f"读取 HTML 发生异常: {exc}") from exc

        content_type = response.headers.get("Content-Type") or "text/html; charset=utf-8"
        logging.info(
            "HTML 已读入内存: HTTP=%s, 大小=%s bytes",
            response.status_code,
            len(source),
        )

        if cache_file:
            try:
                temp_file = cache_file.with_suffix(cache_file.suffix + ".tmp")
                temp_file.write_bytes(source)
                os.replace(temp_file, cache_file)
                logging.info("[Cache][SAVE] HTML 已缓存到本地: %s", cache_file)
            except Exception as exc:
                logging.warning("[Cache][WARN] 写入 HTML 缓存失败: %s", exc)

        return source, content_type, False

    def extract(
        self, html_url: str, entry_id: str, file_md5: str = "", task_id: str = ""
    ) -> dict:
        source, content_type, is_cached = self.read_html_with_cache(
            html_url, file_md5=file_md5
        )
        logging.info(
            "正在调用正文提取服务: %s, entryid=%s, filemd5=%s, cached=%s",
            html_url,
            entry_id,
            file_md5 or "(空)",
            is_cached,
        )

        title = ""
        report_time = ""
        content = ""
        remote_error = None
        payload = None

        # 1. 优先尝试远程正文提取服务
        try:
            params = {
                "url": html_url,
                "entryid": entry_id,
                "filemd5": file_md5,
            }
            response = self.session.post(
                EXTRACT_CONTENT_URL,
                params=params,
                data=source,
                headers={"Content-Type": content_type},
                timeout=(5, 30),
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                nested = payload.get("data") or payload.get("result")
                if isinstance(nested, dict):
                    payload = nested
            if isinstance(payload, dict):
                title = str(
                    _response_value(payload, "title", "newsTitle") or ""
                ).strip()
                report_time = str(
                    _response_value(
                        payload,
                        "ReportTime",
                        "report_time",
                        "publishTime",
                        "date",
                    )
                    or ""
                ).strip()
                content = str(
                    _response_value(payload, "content", "text", "body") or ""
                ).strip()
        except Exception as exc:
            remote_error = exc
            logging.warning("远程正文提取服务调用异常: %s，尝试使用本地 content_extractor 兜底提取", exc)

        # 2. 如果远程未提取到正文，使用 content_extractor 本地解析
        if not content:
            local_extracted = self.local_extractor.extract(source, url=html_url)
            if local_extracted.get("content"):
                logging.info(
                    "[ContentExtractor] 本地 content_extractor 提取成功: 标题=%s, 日期=%s, 正文=%s字符",
                    local_extracted.get("title", "")[:100],
                    local_extracted.get("report_time", "") or "(空)",
                    len(local_extracted["content"]),
                )
                if not title:
                    title = local_extracted.get("title", "")
                if not report_time:
                    report_time = local_extracted.get("report_time", "")
                content = local_extracted["content"]

        # 3. 两者均失败则保存错误 HTML
        if not content:
            self.save_error_html(source, file_md5=file_md5, task_id=task_id)
            err_msg = (
                f"正文提取失败 (远程错误: {remote_error})"
                if remote_error
                else "正文服务未提取到正文内容"
            )
            raise RuntimeError(err_msg)

        if not title:
            logging.info("正文标题为空，将不保存 9001")
        if not report_time:
            logging.info("正文日期为空，将不保存 9003")

        logging.info(
            "正文提取完成: 标题=%s, 日期=%s, 正文=%s字符",
            title[:100],
            report_time or "(空)",
            len(content),
        )
        return {
            "title": title,
            "report_time": report_time,
            "content": content,
        }




class ContentFileStore:
    @staticmethod
    def save(
        original_url: str,
        content: bytes,
        file_name: str = "",
        file_md5: str = "",
    ) -> str:
        CONTENT_DIR.mkdir(parents=True, exist_ok=True)
        if not file_name:
            base_name = file_md5 if file_md5 else generate_guid_from_string(original_url)
            file_name = f"{base_name}.txt"
        target = (CONTENT_DIR / file_name).resolve()
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_bytes(content)
        os.replace(temporary, target)
        logging.info("正文 TXT 已保存: %s", target)
        return str(target)


class MinioContentStore:
    """按 save_file.upload_file 的接口协议上传正文 TXT。"""

    @staticmethod
    def _response_path(response: requests.Response) -> str:
        response_text = response.text.strip().strip('"')
        if response_text.startswith("{"):
            try:
                payload = response.json()
            except ValueError:
                return response_text
            if isinstance(payload, dict):
                value = _response_value(
                    payload,
                    "fileId",
                    "file_id",
                    "path",
                    "url",
                    "data",
                )
                if isinstance(value, dict):
                    value = _response_value(
                        value,
                        "fileId",
                        "file_id",
                        "path",
                        "url",
                    )
                return str(value or "").strip()
        return response_text

    @classmethod
    def upload(cls, content: bytes, file_id: str) -> str:
        upload_url = OSS_UPLOAD_URL
        headers = {
            "Authorization": MINIO_AUTHORIZATION,
            "Content-Type": "text/plain; charset=utf-8",
        }
        last_error = ""
        for attempt in range(1, 5):
            try:
                logging.info(
                    "正在上传正文到 MinIO: %s (%s bytes)",
                    file_id,
                    len(content),
                )
                params = {"fileId": file_id}
                response = requests.post(
                    upload_url,
                    headers=headers,
                    params=params,
                    data=content,
                    timeout=60,
                )
                logging.info("MinIO 上传请求 URL: %s", response.request.url)
                response.raise_for_status()
                uploaded_path = cls._response_path(response)
                if not uploaded_path:
                    raise RuntimeError("MinIO 上传接口返回的文件路径为空")
                if not uploaded_path.startswith("/") and not _is_http_url(
                    uploaded_path
                ):
                    raise RuntimeError(
                        f"MinIO 上传接口未返回有效路径: {uploaded_path[:300]}"
                    )
                logging.info("正文已上传到 MinIO: %s", uploaded_path)
                return uploaded_path
            except Exception as exc:
                last_error = str(exc)
                logging.error(
                    "正文上传 MinIO 异常: %s，重试中 (%s/4)...",
                    exc,
                    attempt,
                )
                if attempt < 4:
                    time.sleep(3)
        raise RuntimeError(f"正文上传 MinIO 失败: {last_error}")


class Saver:
    @staticmethod
    def save(task_bean: dict, datas: list[dict]) -> str:
        from save_batches import save_in_batches
        return save_in_batches(Saver._save_batch, task_bean, datas)

    @staticmethod
    def _save_batch(task_bean: dict, datas: list[dict]) -> str:
        payload = {
            "sourceId": task_bean["SourceId"],
            "configId": task_bean["ConfigId"],
            "parentId": task_bean["ParentID"],
            "taskId": task_bean["TaskID"],
            "forceCommit": "true",
            "datas": datas,
        }
        logging.info("保存正文数据包，大小: %s 条", len(datas))
        last_error = ""
        for attempt in range(1, 6):
            try:
                response = requests.post(
                    SAVE_URL,
                    json=payload,
                    headers={"Content-Type": "application/json; charset=utf-8"},
                    timeout=15,
                )
                response.raise_for_status()
                logging.info("保存服务器返回: %s", response.text)
                return response.text
            except Exception as exc:
                last_error = exc
                logging.error(
                    "保存正文数据异常: %s，重试中 (%s/5)...",
                    exc,
                    attempt,
                )
                time.sleep(1)
        if isinstance(last_error, requests.exceptions.Timeout):
            from save_batches import SaveTimeoutError
            raise SaveTimeoutError(str(last_error)) from last_error
        raise RuntimeError(f"正文数据保存失败: {last_error}")


class MqNewsContentSnatch:
    MAX_RETRIES = 10
    QUEUE_THIS = MQ_QUEUE

    def __init__(self):
        self.extractor = ContentExtractor()

    @staticmethod
    def _publish_feedback(
        channel: Channel,
        task_bean: dict,
        success: bool,
        error_message: str = "-",
        mark: str = "",
    ) -> None:
        message = {
            "IsSuccess": "true" if success else "false",
            "StrTaskId": str(task_bean.get("TaskID") or ""),
            "ErrorMessage": error_message or "-",
        }
        if not success:
            message["Mark"] = mark or "正文抓取失败"
        elif mark:
            message["Mark"] = mark
        body = json.dumps(message, ensure_ascii=False)
        record_task_result(success, '' if success else error_message)
        logging.info("向 biz_msg_ret 发送反馈: %s", body)
        channel.basic_publish(exchange="", routing_key="biz_msg_ret", body=body)

    def process_task(self, task: dict) -> list[dict]:
        task_bean = task["Task"]
        context = get_task_context(task_bean)
        original_url = find_original_url(task_bean)

        # 1. 检查是否为 PDF 文件，若是直接跳过抓取
        if (
            is_pdf_url(original_url)
            or is_pdf_url(context.get("url"))
            or is_pdf_url(task_bean.get("Url"))
            or is_pdf_url(context.get("content_html_path"))
        ):
            raise PdfTaskSkipped(f"URL 为 PDF 文件: {original_url}", original_url=original_url)

        file_md5 = str(context.get("filemd5") or "").strip()
        entry_id = str(task_bean.get("ParentID") or "").strip()
        if not entry_id:
            raise ValueError("Task.ParentID 为空，无法设置正文接口 entryid")

        logging.info("开始正文任务，原文 URL: %s", original_url)
        if file_md5:
            logging.info("Task.Context.filemd5: %s", file_md5)

        task_id = str(task_bean.get("TaskID") or "").strip()
        html_url = find_html_url(task_bean)
        record_url(html_url, 'ContentHtmlSource')
        logging.info("Task.Context.content_html_path: %s", html_url)
        extracted = None
        if is_wechat_article_url(original_url):
            try:
                source, content_type, is_cached = self.extractor.read_html_with_cache(
                    html_url, file_md5=file_md5
                )
                extracted = self.extractor.extract_wechat(source)
            except Exception as exc:
                logging.warning(
                    "[WeChat] 公众号正文解析失败: %s；回退常规正文流程",
                    exc,
                )

        if extracted is None:
            # 普通网页，以及公众号专用解析失败后的回退流程，继续使用已有 HTML。
            extracted = self.extractor.extract(
                html_url, entry_id, file_md5=file_md5, task_id=task_id
            )
        if not str(extracted.get('content') or '').strip():
            raise RuntimeError('正文抓取失败：正文为空')
        content_bytes = (extracted["content"].rstrip() + "\n").encode("utf-8")
        content_file_id = build_content_file_id(
            task_bean,
            original_url,
            extracted["report_time"],
            file_md5=file_md5,
        )
        content_path = ContentFileStore.save(
            original_url,
            content_bytes,
            file_name=Path(content_file_id).name,
            file_md5=file_md5,
        )
        uploaded_path = MinioContentStore.upload(content_bytes, content_file_id)

        # 提取成功，清理本地 error_html 目录下对应的所有历史错误文件（如 .html, .emp, .gone, .waf, .meta 等）
        if file_md5:
            delete_cached_error_files(file_md5)

        data = {
            "9002": original_url,
            "9006": uploaded_path,
            "9007": len(content_bytes),
            "52000380": "",
        }
        return [data]

    @queue_url_task
    def callback(self, ch: Channel, method, properties, body: bytes) -> None:
        from save_batches import SaveTimeoutError, finish_save_timeout
        del properties
        task_bean: dict = {}
        try:
            logging.info("--------------------------------------------------")
            logging.info(" [x] Received MQ message: %s bytes", len(body))
            task = json.loads(body)
            task_bean = task["Task"]
            logging.info(
                "taskBean IDs: ParentID=%s, SourceId=%s, TaskID=%s",
                task_bean.get("ParentID", ""),
                task_bean.get("SourceId", ""),
                task_bean.get("TaskID", ""),
            )
            datas = self.process_task(task)
            logging.info(
                "MQ 保存前正文数据：\n%s",
                json.dumps(datas, ensure_ascii=False, indent=2),
            )
            Saver.save(task_bean, datas)
            self._publish_feedback(ch, task_bean, True)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            logging.info("[OK] 正文任务完成并已确认 ACK")
        except SaveTimeoutError as exc:
            finish_save_timeout(ch, method, task_bean, exc, Saver.save)
        except PdfTaskSkipped as pdf_exc:
            logging.warning("[Skip][PDF] %s，跳过正文抓取并回写反馈", pdf_exc)
            try:
                data = {
                    "9002": pdf_exc.original_url or "-",
                    "52000380": "pdf文件",
                }
                Saver.save(task_bean, [data])
            except Exception as save_exc:
                logging.error("保存 PDF 跳过记录异常: %s", save_exc)

            if task_bean and task_bean.get("TaskID"):
                try:
                    self._publish_feedback(
                        ch,
                        task_bean,
                        False,
                        error_message="pdf文件",
                        mark="pdf文件",
                    )
                except Exception as feedback_exc:
                    logging.error("发送 PDF 跳过反馈异常: %s", feedback_exc)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            logging.info("[OK] PDF 任务已记录并确认 ACK")
        except DownloadUrlFormatError as url_exc:
            logging.warning("[InvalidURL] %s，跳过并向 biz_msg_ret 汇报: 下载url格式错误", url_exc)
            try:
                orig_url = ""
                if isinstance(task_bean.get("Context"), dict):
                    orig_url = _clean_url(task_bean["Context"].get("url"))
                if not orig_url:
                    orig_url = _clean_url(task_bean.get("Url"))
                data = {
                    "9002": orig_url or "-",
                    "52000380": str(url_exc),
                }
                Saver.save(task_bean, [data])
            except Exception as save_exc:
                logging.error("保存下载URL格式错误记录异常: %s", save_exc)

            if task_bean and task_bean.get("TaskID"):
                try:
                    self._publish_feedback(
                        ch,
                        task_bean,
                        False,
                        error_message=str(url_exc),
                        mark="下载url格式错误",
                    )
                except Exception as feedback_exc:
                    logging.error("发送下载url格式错误反馈异常: %s", feedback_exc)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            logging.info("[OK] 下载url格式错误任务已记录并确认 ACK")
        except Exception as exc:
            logging.exception("处理正文消息异常: %s", exc)
            record_task_result(False, str(exc))
            if task_bean and task_bean.get("TaskID"):
                mark = (
                    "正文下载失败"
                    if isinstance(exc, ContentHtmlDownloadError)
                    else "正文抓取失败"
                )
                try:
                    orig_url = ""
                    if isinstance(task_bean.get("Context"), dict):
                        orig_url = _clean_url(task_bean["Context"].get("url"))
                    if not orig_url:
                        orig_url = _clean_url(task_bean.get("Url"))
                    data = {
                        "9002": orig_url or "-",
                        "52000380": str(exc) or mark,
                    }
                    Saver.save(task_bean, [data])
                except Exception as save_exc:
                    logging.error("保存失败记录异常: %s", save_exc)

                try:
                    self._publish_feedback(
                        ch, task_bean, False, str(exc), mark=mark
                    )
                except Exception as feedback_exc:
                    logging.error("发送正文失败反馈异常: %s", feedback_exc)
            ch.basic_reject(delivery_tag=method.delivery_tag, requeue=False)



    def listener(self) -> None:
        retry_count = 0
        while retry_count < self.MAX_RETRIES:
            try:
                credentials = pika.PlainCredentials(MQ_USER, MQ_PASSWORD)
                connection = pika.BlockingConnection(
                    pika.ConnectionParameters(
                        host=MQ_HOST,
                        port=MQ_PORT,
                        credentials=credentials,
                        heartbeat=300,
                        blocked_connection_timeout=60,
                    )
                )
                channel = connection.channel()
                channel.basic_qos(prefetch_count=1)
                channel.basic_consume(
                    on_message_callback=self.callback,
                    queue=self.QUEUE_THIS,
                    auto_ack=False,
                )
                logging.info(
                    " [*] Waiting for content messages from %s. "
                    "To exit press CTRL+C",
                    self.QUEUE_THIS,
                )
                channel.start_consuming()
            except KeyboardInterrupt:
                logging.info("已停止正文 MQ 消费程序")
                return
            except pika.exceptions.ConnectionClosed as exc:
                retry_count += 1
                logging.warning(
                    "MQ连接已关闭，3秒后尝试重连: %s (%s/%s)",
                    exc,
                    retry_count,
                    self.MAX_RETRIES,
                )
                time.sleep(3)
            except Exception as exc:
                retry_count += 1
                logging.error(
                    "MQ连接异常: %s，3秒后重试 (%s/%s)",
                    exc,
                    retry_count,
                    self.MAX_RETRIES,
                )
                time.sleep(3)
        logging.error("已达到最大重试次数 %s，停止尝试连接", self.MAX_RETRIES)


if __name__ == "__main__":
    MqNewsContentSnatch().listener()
