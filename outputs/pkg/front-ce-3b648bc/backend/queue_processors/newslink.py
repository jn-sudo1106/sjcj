"""Shared news consumer; site scrape(url) returns rows keyed by field ID strings."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

LOG = logging.getLogger('newslink')
HERE = Path(__file__).resolve().parent

# Runtime settings live in this file. The private deployable copy fills the
# credentials from the user's demo; keep credentials out of shared source.
MQ_HOST = '192.168.0.221'
MQ_PORT = 9672
MQ_VHOST = '/'
MQ_USER = ''
MQ_PASSWORD = ''
QUEUE = 'auto_snatch_web_link'
SAVE_URL = 'http://192.168.1.32:9102/api/v1/saver/save'
SITES_DIRECTORY = 'sites'
HOST_SCRIPTS = {}
SCRAPE_TIMEOUT = 120
SAVE_TIMEOUT = 30


def read_settings():
    settings = {
        '_directory': str(HERE), 'queue': QUEUE, 'save_url': SAVE_URL,
        'mq': {'host': MQ_HOST, 'port': MQ_PORT, 'vhost': MQ_VHOST, 'user': MQ_USER, 'password': MQ_PASSWORD},
        'sites_directory': SITES_DIRECTORY, 'host_scripts': dict(HOST_SCRIPTS),
        'scrape_timeout': SCRAPE_TIMEOUT, 'save_timeout': SAVE_TIMEOUT,
    }
    # Runner already supplies the actual queue; each message supplies ConfigId.
    settings['queue'] = os.environ.get('RUNNER_QUEUE') or settings.get('queue', '')
    mq = settings.setdefault('mq', {})
    for name, variable in {
        'host': 'MQ_HOST', 'port': 'MQ_PORT', 'user': 'MQ_USER',
        'password': 'MQ_PASSWORD', 'vhost': 'MQ_VHOST',
    }.items():
        if variable in os.environ:
            mq[name] = os.environ[variable]
    settings['save_url'] = os.environ.get('SAVE_URL') or settings.get('save_url', '')
    for key in ('queue', 'save_url'):
        if not settings.get(key):
            raise ValueError(f'请配置 {key}')
    for key in ('host', 'user', 'password'):
        if not mq.get(key):
            raise ValueError(f'请配置 mq.{key} 或对应的 MQ_* 环境变量')
    return settings


def site_script(url, settings):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').lower().rstrip('.')
    if parsed.scheme.lower() not in ('http', 'https') or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*', host):
        raise ValueError('Task.Url 必须是有效的 HTTP/HTTPS 网站地址')
    root = (Path(settings['_directory']) / settings.get('sites_directory', 'sites')).resolve()
    # Exact host matching only. Explicit aliases may be configured for www/non-www.
    filename = settings.get('host_scripts', {}).get(host, host + '.py')
    path = (root / filename).resolve()
    if not path.is_relative_to(root) or path.suffix != '.py':
        raise ValueError('网站脚本路径必须是 sites_directory 内的 Python 文件')
    if not path.is_file():
        raise FileNotFoundError(f'缺少网站脚本：域名 {host}，路径 {path}')
    return path


def scrape_worker(script, url, output):
    # A fresh interpreter prevents stale module caches and isolates site globals.
    sys.path.insert(0, str(Path(script).resolve().parent))
    namespace = runpy.run_path(script, run_name='_newslink_site_')
    scrape = namespace.get('scrape')
    if not callable(scrape):
        raise ValueError(f'{Path(script).name} 必须提供 scrape(url) 函数')
    rows = validate_rows(scrape(url))
    Path(output).write_text(json.dumps(rows, ensure_ascii=False, allow_nan=False), encoding='utf-8')


def run_scraper(script, url, timeout=120):
    with tempfile.TemporaryDirectory(prefix='newslink-') as directory:
        output = Path(directory) / 'result.json'
        console = Path(directory) / 'console.log'
        with console.open('wb') as stream:
            try:
                result = subprocess.run(
                    [sys.executable, '-B', str(Path(__file__).resolve()), '--scrape-worker',
                     str(script), url, str(output)],
                    cwd=script.parent, stdout=stream, stderr=subprocess.STDOUT,
                    env=dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1'),
                    timeout=timeout, check=False,
                )
            finally:
                stream.flush()
                text = console.read_bytes()[-65536:].decode('utf-8', errors='replace')
                if text.strip():
                    LOG.info('网站脚本 %s 输出：\n%s', script.name, text)
        if result.returncode:
            raise RuntimeError(f'网站脚本 {script.name} 执行失败（退出码 {result.returncode}）：{text[-4000:]}')
        return json.loads(output.read_text(encoding='utf-8'))


def task_url(task, settings):
    url = task.get('Url') or settings.get('url')
    if not isinstance(url, str) or not url.strip():
        raise ValueError('任务缺少 Task.Url，且未配置备用 URL')
    return url.strip()


def validate_rows(rows):
    """Check the transport contract without interpreting site-specific fields."""
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('scrape(url) 必须返回 list[dict]')
    for index, row in enumerate(rows, 1):
        if not row:
            raise ValueError(f'第 {index} 条采集数据为空字典')
        if any(not isinstance(key, str) or not re.fullmatch(r'[0-9]+', key) for key in row):
            raise ValueError(f'第 {index} 条采集数据必须以字段 ID 字符串为 Key；请在网站脚本中完成字段映射，不要返回 title/date/url 等逻辑字段')
    return rows


def save(task, datas, settings):
    import requests

    # Preserve qinlongclaw's saver protocol. No hard-coded field IDs or endpoints.
    context = {
        'sourceId': task['SourceId'], 'configId': task['ConfigId'],
        'parentId': task['ParentID'], 'taskId': task['TaskID'], 'forceCommit': 'true',
    }
    for offset in range(0, len(datas), 50):
        batch = datas[offset:offset + 50]
        response = requests.post(
            settings['save_url'],
            data=json.dumps(dict(context, datas=batch), ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json; charset=utf-8'},
            timeout=float(settings.get('save_timeout', 30)),
        )
        response.raise_for_status()
        try:
            receipt = response.json()
        except ValueError:
            raise RuntimeError('保存接口未返回 JSON，无法确认保存结果')
        if not isinstance(receipt, dict) or receipt.get('success') not in (True, 'true'):
            raise RuntimeError('保存接口未确认成功：' + str(receipt)[:1000])
        LOG.info('任务 %s 已保存 %s/%s 条', task['TaskID'], offset + len(batch), len(datas))


def process_task(task, settings):
    if not isinstance(task, dict):
        raise ValueError('消息缺少 Task 对象')
    for key in ('TaskID', 'SourceId', 'ConfigId', 'ParentID'):
        if key not in task:
            raise ValueError(f'任务缺少 {key}')
    url = task_url(task, settings)
    path = site_script(url, settings)
    LOG.info('任务 %s · 配置 %s · URL %s → 网站脚本 %s', task['TaskID'], task['ConfigId'], url, path)
    rows = run_scraper(path, url, float(settings.get('scrape_timeout', 120)))
    datas = validate_rows(rows)
    if not datas:
        raise ValueError('未采集到有效新闻，不发送成功回执')
    save(task, datas, settings)
    return len(datas)


def handle_message(channel, method, body, settings, connection=None):
    task = {}
    try:
        envelope = json.loads(body)
        if not isinstance(envelope, dict) or not isinstance(envelope.get('Task'), dict):
            raise ValueError('消息缺少 Task 对象')
        task = envelope['Task']
        # Only this thread touches pika; keep heartbeat alive while scraping/saving.
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(process_task, task, settings)
            while not future.done():
                if connection is not None:
                    connection.process_data_events(time_limit=0.2)
                else:
                    time.sleep(0.02)
            count = future.result()
        message = {'IsSuccess': 'true', 'StrTaskId': task['TaskID'], 'ErrorMessage': '-'}
        LOG.info('任务 %s 完成：%s 条', task['TaskID'], count)
    except Exception as exc:
        LOG.exception('任务 %s 执行失败', task.get('TaskID', '未知'))
        message = {'IsSuccess': 'false', 'StrTaskId': str(task.get('TaskID') or ''),
                   'ErrorMessage': str(exc)[:4000], 'Mark': '新闻列表抓取失败'}
    # Publisher confirms must succeed before acknowledging the input message.
    # Task failures are terminal; do not endlessly requeue a wrong-host task.
    published = channel.basic_publish(
        exchange='', routing_key=settings.get('result_queue', 'biz_msg_ret'),
        body=json.dumps(message, ensure_ascii=False), mandatory=True,
    )
    if published is False:
        raise RuntimeError('任务回执发布失败，原消息未确认')
    channel.basic_ack(delivery_tag=method.delivery_tag)


def listen(settings):
    import pika

    mq = settings['mq']
    while True:
        connection = None
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(
                host=mq['host'], port=int(mq.get('port', 5672)),
                virtual_host=mq.get('vhost', '/'),
                credentials=pika.PlainCredentials(mq['user'], mq['password']),
                heartbeat=300, blocked_connection_timeout=60,
            ))
            channel = connection.channel()
            channel.confirm_delivery()
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(
                queue=settings['queue'], auto_ack=False,
                on_message_callback=lambda ch, method, properties, body:
                    handle_message(ch, method, body, settings, connection),
            )
            LOG.info('统一入口开始监听：%s，网站目录：%s', settings['queue'], settings.get('sites_directory', 'sites'))
            channel.start_consuming()
        except KeyboardInterrupt:
            return
        except Exception:
            LOG.exception('MQ 连接或回执异常，5 秒后重连；未确认消息由 MQ 恢复')
            time.sleep(5)
        finally:
            if connection is not None and connection.is_open:
                try:
                    connection.close()
                except Exception:
                    LOG.exception('关闭 MQ 连接失败')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scrape-worker', nargs=3, metavar=('SCRIPT', 'URL', 'OUTPUT'))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', stream=sys.stdout)
    if args.scrape_worker:
        scrape_worker(*args.scrape_worker)
    else:
        listen(read_settings())


if __name__ == '__main__':
    main()
