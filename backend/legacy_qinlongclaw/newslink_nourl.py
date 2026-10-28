# -*- coding: utf-8 -*-
"""MQ 无链接新闻提取器：处理不带 URL 链接的新闻列表或快讯，使用内容的 MD5 代替 URL (9002) 保存。

功能特性：
1. 监听 MQ 任务队列（默认队列可配置：news_nourl 或 news_snt）。
2. 调用 BrowserManager 自动抓取页面中的无链接新闻/公告/快讯列表。
3. 将内容（优先 Summary 摘要/正文，无摘要时使用 Text 标题）计算 MD5 哈希，作为 9002 字段存入数据包。
4. 格式化组装 9001 (标题)、9002 (内容MD5)、9003 (日期时间)、9014 (正文摘要)。
5. 将提取到的数据包提交至 Saver 保存服务，并通过 biz_msg_ret 回传处理结果。
"""

import hashlib
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import pika
import requests
from pika.channel import Channel
from queue_url_history import queue_url_task, record_task_result
from save_batches import SaveTimeoutError, save_in_batches, finish_save_timeout, finish_failure

# 将 link_extractor 项目目录加入 Python 模块搜索路径
project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "link_extractor"))
if project_dir not in sys.path:
    sys.path.insert(0, project_dir)

from browsers.browser_manager import BrowserManager
from browser_process import DEFAULT_PORT, cdp_ready
from core.site_script_loader import find_site_script, resolve_site_script, run_site_script

# 配置日志输出到控制台与文件
log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "newslink_nourl.log")
NOURL_ERROR_FILE = Path(__file__).resolve().parent / "txt" / "errornourl.txt"

log_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

file_handler = logging.FileHandler(log_file, encoding="utf-8")
file_handler.setFormatter(log_formatter)

console_handler = logging.StreamHandler(sys.__stdout__)
console_handler.setFormatter(log_formatter)

logging.basicConfig(
    level=logging.INFO,
    handlers=[file_handler, console_handler],
)


class StreamToLogger:
    """将 print / 标准输出重定向到 logging 系统"""

    def __init__(self, logger, level=logging.INFO):
        self.logger = logger
        self.level = level

    def write(self, message):
        for line in message.rstrip().splitlines():
            line = line.strip()
            if line:
                self.logger.log(self.level, line)

    def flush(self):
        pass


# 重定向标准输出，使所有模块的 print 均自动以 logging 格式写入控制台和日志文件
sys.stdout = StreamToLogger(logging.getLogger("STDOUT"), logging.INFO)


def calculate_content_md5(item: Dict[str, Any]) -> str:
    """计算内容的 MD5 哈希作为 9002 (URL) 保存。

    策略：
    1. 优先使用摘要/正文内容 (Summary) 计算 MD5；
    2. 若无摘要，则使用标题/文本内容 (Text)；
    3. 若都不足，则结合标题与日期组合生成；
    4. 返回 32 位小写 16 进制 MD5 字符串。
    """
    summary = str(item.get("Summary") or "").strip()
    text = str(item.get("Text") or "").strip()
    date_val = str(item.get("Date") or "").strip()

    if summary:
        seed = summary
    elif text:
        seed = text
    elif date_val:
        seed = f"{text}_{date_val}".strip()
    else:
        seed = f"nourl_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"

    return hashlib.md5(seed.encode("utf-8")).hexdigest()


def record_nourl_error(url: str, reason: str) -> None:
    """保留无 URL 任务最终失败的网站，同一地址只记录一次。"""
    url = str(url or "").strip()
    if not url:
        return
    try:
        NOURL_ERROR_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing = NOURL_ERROR_FILE.read_text(encoding="utf-8-sig") if NOURL_ERROR_FILE.exists() else ""
        if url in {line[4:].strip() for line in existing.splitlines() if line.startswith("URL:")}:
            return
        reason = " ".join(str(reason).splitlines())
        with NOURL_ERROR_FILE.open("a", encoding="utf-8") as stream:
            stream.write(f"Time: {datetime.now():%Y-%m-%d %H:%M:%S}\nURL: {url}\nReason: {reason}\n\n")
        logging.warning("[ErrorNoUrl] 抓取失败网站已记录: %s", NOURL_ERROR_FILE)
    except OSError:
        logging.exception("[ErrorNoUrl] 写入失败网站记录异常")


class Saver:
    SAVE_URL = os.environ.get(
        "NEWS_SAVE_URL",
        "http://192.168.1.30:49102/api/v1/saver/save",
    )

    @classmethod
    def saveHzPrice(cls, task: Dict[str, Any], datas: List[Dict[str, Any]]) -> Optional[str]:
        return save_in_batches(cls._save_batch, task, datas)

    @classmethod
    def _save_batch(cls, task: Dict[str, Any], datas: List[Dict[str, Any]]) -> Optional[str]:
        dic = {
            "sourceId": task.get("SourceId"),
            "configId": task.get("ConfigId"),
            "parentId": task.get("ParentID"),
            "taskId": task.get("TaskID"),
            "forceCommit": "true",
            "datas": datas,
        }
        payload = json.dumps(dic, ensure_ascii=False)
        logging.info(f"保存数据包，大小: {len(datas)} 条")
        headers = {"Content-Type": "application/json; charset=utf-8"}

        last_error = None
        for i in range(5):
            try:
                response = requests.post(
                    cls.SAVE_URL,
                    headers=headers,
                    data=payload.encode("utf-8"),
                    timeout=10,
                )
                response.raise_for_status()
                ret = response.text
                try:
                    result = response.json()
                except ValueError:
                    result = None
                if isinstance(result, dict) and result.get("success") in (False, "false"):
                    raise RuntimeError(f"保存接口拒绝数据: {result.get('msg') or ret}")
                logging.info(f"保存服务器返回: {ret}")
                return ret
            except Exception as e:
                last_error = e
                logging.error(f"保存数据异常: {e}，重试中 ({i+1}/5)...")
                time.sleep(1)
        if isinstance(last_error, requests.exceptions.Timeout):
            raise SaveTimeoutError(str(last_error)) from last_error
        return None


class MqNoUrlNewsSnatcher(object):
    """无链接新闻/公告/快讯抓取处理器"""

    MAX_RETRIES = 10
    QUEUE_THIS = os.environ.get("NEWS_NOURL_QUEUE", "news_snt_nourl")

    def __init__(self):
        self.browser_manager = BrowserManager()
        self.browser_process = None

    def ensure_browser_process(self):
        """确保独立浏览器进程在线；这里只负责启动，不执行内容抓取。"""
        if cdp_ready(DEFAULT_PORT):
            logging.info("[Browser] 独立 CDP 浏览器已经运行，直接复用")
            return

        launcher = os.path.join(project_dir, "browser_process.py")
        logging.info("[Browser] CDP 浏览器未运行，正在自动启动: %s", launcher)
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        self.browser_process = subprocess.Popen(
            [sys.executable, launcher],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            creationflags=creation_flags,
        )

        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if cdp_ready(DEFAULT_PORT):
                logging.info("[Browser] 独立 CDP 浏览器自动启动成功")
                return
            if self.browser_process.poll() is not None:
                raise RuntimeError(
                    f"browser_process.py 提前退出，退出码: {self.browser_process.returncode}"
                )
            time.sleep(0.5)
        raise RuntimeError("自动启动独立 CDP 浏览器超时（25秒）")

    def extract_and_format_datas(self, url: str, task_bean=None) -> List[Dict[str, Any]]:
        self.last_extract_error = ""
        self.browser_manager.last_extract_error = ""
        try:
            datas = self._extract_and_format_datas(url, task_bean)
        except Exception as exc:
            self.last_extract_error = str(exc)
            record_nourl_error(url, f"抓取或正文处理异常: {exc}")
            raise
        if not datas:
            self.last_extract_error = (self.browser_manager.last_extract_error
                                       or "所有抓取尝试结束，未取得有效新闻标题或内容")
            record_nourl_error(url, self.last_extract_error)
        return datas

    def _extract_and_format_datas(self, url: str, task_bean=None) -> List[Dict[str, Any]]:
        """执行页面抓取并把 9002 (URL) 转换为内容的 MD5。"""
        # 这些源的新闻条目本身没有详情 URL。只按重复标题/正文结构识别
        # 容器和列表，不运行通用抓取器的 URL 推导、点击恢复或 URL 必填校验。
        site_script = resolve_site_script(url, task_bean)
        if site_script:
            # 命中脚本便由它负责抓取；失败记录 errornourl，不隐式改用另一套逻辑。
            raw_datas = run_site_script(site_script, url)
        else:
            raw_datas = self.browser_manager.extract_no_url_news(url)
        datas = []

        for item in raw_datas:
            text = str(item.get("Text") or "").strip()
            # 如果标题和摘要均为空，跳过无效条目
            if not text and not item.get("Summary"):
                continue

            content_md5 = calculate_content_md5(item)
            data_dict = {
                "9001": text,
                "9002": content_md5,  # 使用内容的 MD5 代替 URL 保存
                "52000380": "",  # 缺正文时下方会覆盖为错误，成功则清空旧 K24。
            }

            if item.get("Date"):
                data_dict["9003"] = str(item["Date"]).strip()

            if item.get("Summary"):
                summary = str(item["Summary"]).strip()
                if len(summary) > 2000:
                    logging.info(
                        "[Summary] 摘要超过 2000 字符，已截断: 标题=%s; 原长度=%s",
                        text[:80],
                        len(summary),
                    )
                    summary = summary[:2000]
                data_dict["9014"] = summary

            content = str(item.get("Content") or "").strip()
            if content:
                from newsContSnatch import (
                    ContentFileStore, MinioContentStore, build_content_file_id,
                )
                title_line = f"<WWTITLE>{text}<\\WWTITLE>"
                content_bytes = (title_line + "\n" + content.rstrip() + "\n").encode("utf-8")
                file_md5 = hashlib.md5(content_bytes).hexdigest()
                # 列表任务不要求 Context；仅为复用正文文件路径生成器补齐，
                # 不修改原始 MQ 任务，也不放宽正文下载任务的 Context 校验。
                upload_task = dict(task_bean or {})
                upload_context = upload_task.get("Context")
                if isinstance(upload_context, str):
                    try:
                        upload_context = json.loads(upload_context)
                    except ValueError:
                        upload_context = None
                        logging.warning("[Content] 列表任务 Context 非有效 JSON，使用列表日期生成上传路径")
                upload_task["Context"] = upload_context if isinstance(upload_context, dict) else {}
                file_id = build_content_file_id(
                    upload_task, url,
                    str(item.get("Date") or ""), file_md5=file_md5,
                )
                ContentFileStore.save(
                    url, content_bytes, file_name=Path(file_id).name,
                    file_md5=file_md5,
                )
                data_dict["9006"] = MinioContentStore.upload(content_bytes, file_id)
                data_dict["9007"] = len(content_bytes)
                logging.info("[Content] 正文已上传: 标题=%s, 字节数=%s", text, len(content_bytes))
            if not content:
                data_dict['52000380'] = '正文缺失：未取得文字或图片正文'
            datas.append(data_dict)

        return datas

    @queue_url_task
    def callback(self, ch: Channel, method, properties, body):
        task_bean = {}
        try:
            logging.info("--------------------------------------------------")
            logging.info(" [x] Received MQ message: %r bytes" % len(body))
            task = json.loads(body)
            task_bean = task["Task"]
            url = str(task_bean.get("Url") or "").strip()
            logging.info(f"开始处理无链接新闻任务，URL: {url}")

            # 确保独立 CDP 浏览器在线（若异常退出自动拉起）
            try:
                if not resolve_site_script(url, task_bean):
                    self.ensure_browser_process()
            except Exception as e_br:
                logging.warning(f"[Browser] 任务前检测浏览器状态提示: {e_br}")

            # 使用提取管理器进行自动检测和提取，并将 9002 替换为内容 MD5
            extraction_failed = False
            err_msg = ""
            try:
                datas = self.extract_and_format_datas(url, task_bean=task_bean)
            except Exception as exc:
                extraction_failed = True
                datas = []
                err_msg = str(exc) or type(exc).__name__
                logging.exception("无链接新闻抓取或正文处理失败: %s", err_msg)

            # 保存提交结果
            if datas:
                logging.info(
                    "MQ 保存前数据（URL 已替换为内容 MD5）：\n%s",
                    json.dumps(datas, ensure_ascii=False, indent=2),
                )
                if Saver.saveHzPrice(task_bean, datas) is None:
                    raise RuntimeError('新闻数据保存失败')
                missing = [item for item in datas if item.get('52000380')]
                is_success = 'false' if missing else 'true'
                err_msg = (f'正文抓取不完整：{len(missing)}/{len(datas)} 条失败；'
                           + '；'.join(str(item.get('9001') or item.get('9002')) for item in missing)) if missing else '-'
            else:
                is_success = "false"
                err_msg = err_msg or getattr(self, "last_extract_error", "") or "未抓取到有效的新闻标题或内容"
                # 与 newsContSnatch 一致，52000380 是错误字段的保存接口编码。
                # 列表失败没有文章 MD5，以任务原始 URL 标识失败记录。
                saved = Saver.saveHzPrice(task_bean, [{"9002": url or "-", "52000380": err_msg}])
                if saved is None:
                    raise RuntimeError("抓取失败记录保存失败，未完成 K24 回写")

            # 反馈 MQ
            message = {
                "IsSuccess": is_success,
                "StrTaskId": task_bean.get("TaskID"),
                "ErrorMessage": err_msg,
            }
            if is_success == "false":
                message["Mark"] = "无链接新闻抓取失败"
            ret_msg = json.dumps(message, ensure_ascii=False)
            record_task_result(is_success == 'true', '' if is_success == 'true' else err_msg)
            logging.info(f"向 biz_msg_ret 发送反馈: {ret_msg}")
            ch.basic_publish(exchange="", routing_key="biz_msg_ret", body=ret_msg)
            if extraction_failed:
                ch.basic_reject(delivery_tag=method.delivery_tag, requeue=False)
            else:
                ch.basic_ack(delivery_tag=method.delivery_tag)
            logging.info("[OK] 任务反馈及消息确认完成")

        except SaveTimeoutError as e:
            finish_save_timeout(ch, method, task_bean, e, Saver.saveHzPrice)
        except Exception as e:
            logging.error(f"处理消息异常: {e}")
            record_task_result(False, str(e))
            finish_failure(ch, method, task_bean, e, Saver.saveHzPrice)

    def listener(self):
        # 按任务需要启动浏览器，网站专用脚本不依赖 CDP 服务。

        retry_count = 0
        mq_host = os.environ.get("NEWS_MQ_HOST", "118.25.96.217")
        mq_port = int(os.environ.get("NEWS_MQ_PORT", "9672"))
        mq_user = os.environ.get("NEWS_MQ_USER", "admin")
        mq_pwd = os.environ.get("NEWS_MQ_PASSWORD", "")

        while retry_count < self.MAX_RETRIES:
            try:
                auth = pika.PlainCredentials(mq_user, mq_pwd)
                connection = pika.BlockingConnection(
                    pika.ConnectionParameters(
                        host=mq_host,
                        port=mq_port,
                        credentials=auth,
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
                logging.info(f" [*] Waiting for messages on queue [{self.QUEUE_THIS}]. To exit press CTRL+C")
                channel.start_consuming()
            except pika.exceptions.ConnectionClosed as e:
                logging.warning(
                    f"MQ连接已关闭，3秒后尝试重连... 重试次数: {retry_count}/{self.MAX_RETRIES}"
                )
                try:
                    if "connection" in locals() and connection.is_open:
                        connection.close()
                except Exception:
                    pass
                retry_count += 1
                time.sleep(3)
            except Exception as e:
                logging.error(f"其他错误: {e}")
                try:
                    if "connection" in locals() and connection.is_open:
                        connection.close()
                except Exception:
                    pass
                retry_count += 1
                time.sleep(3)

        logging.error(f"已达到最大重试次数 {self.MAX_RETRIES}，停止尝试连接。")
        self.browser_manager.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="MQ 无链接新闻提取器")
    parser.add_argument("--url", type=str, help="直接抓取指定 URL 测试提取与 MD5 转换（不进入 MQ 循环）")
    args = parser.parse_args()

    snatcher = MqNoUrlNewsSnatcher()
    if args.url:
        logging.info("【本地测试模式】目标 URL: %s", args.url)
        if not find_site_script(args.url):
            snatcher.ensure_browser_process()
            snatcher.browser_manager.start()
        test_datas = snatcher.extract_and_format_datas(args.url)
        logging.info("提取结果（共 %d 条）：\n%s", len(test_datas), json.dumps(test_datas, ensure_ascii=False, indent=2))
        snatcher.browser_manager.close()
    else:
        snatcher.listener()
