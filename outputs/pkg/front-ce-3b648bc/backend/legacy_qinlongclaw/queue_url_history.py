"""Append queue-scoped task/visit/XPath history without reading shared recent.txt."""
from contextvars import ContextVar
from datetime import datetime
from functools import wraps
import json
import logging
import os
from pathlib import Path
import re

HISTORY_DIR = Path(__file__).resolve().parent / 'txt'
_task = ContextVar('queue_url_task', default=None)
_result = ContextVar('queue_url_result', default=None)


def record_task_result(success, error=''):
    result = _result.get()
    if result is not None:
        result.update(success=bool(success), error=str(error or ''))


def record_url(url, status, container='', sample='', item_xpaths=None, outcome=None):
    context = _task.get()
    if context is None or not url:
        return
    queue, task_id = context
    queue = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(queue)).rstrip(' .') or 'unknown'
    paths = item_xpaths or []
    now = datetime.now()
    lines = [f'Date: {now:%Y-%m-%d}', f'Time: {now:%Y-%m-%d %H:%M:%S}', f'TaskID: {task_id}',
             f'URL: {url}', f'Status: {status}', f'ContainerXPath: {container}',
             f'SampleXPath: {sample}', f'ItemCount: {len(paths)}', 'ItemXPaths:']
    lines.extend(f'{i}. {xpath}' for i, xpath in enumerate(paths, 1))
    if outcome is not None:
        lines.extend([f'EndTime: {now:%Y-%m-%d %H:%M:%S}',
                      'TaskResult: ' + ('成功' if outcome['success'] else '失败'),
                      'ErrorMessage: ' + ' '.join(outcome['error'].splitlines())])
    try:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        data = ('\n'.join(lines) + '\n\n').encode('utf-8')
        fd = os.open(HISTORY_DIR / f'{queue}_url_{now:%Y-%m-%d}.txt', os.O_CREAT | os.O_APPEND | os.O_WRONLY | getattr(os, 'O_BINARY', 0), 0o600)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
    except OSError:
        logging.exception('按队列记录 URL 失败，不影响原任务处理')


def queue_url_task(callback):
    @wraps(callback)
    def wrapped(self, ch, method, properties, body):
        try:
            task = json.loads(body).get('Task') or {}
            task_id = task.get('TaskID', '')
            url = task.get('Url') or ''
            context = task.get('Context') or {}
            if isinstance(context, str):
                try:
                    context = json.loads(context)
                except ValueError:
                    context = {}
            if not url and isinstance(context, dict):
                url = context.get('url') or ''
        except (ValueError, TypeError, AttributeError):
            task_id, url = '', ''
        token = _task.set((self.QUEUE_THIS, task_id))
        result = {'success': False, 'error': '任务未返回明确成功结果'}
        result_token = _result.set(result)
        try:
            record_url(url, 'ReceivedByMQ')
            return callback(self, ch, method, properties, body)
        except Exception as exc:
            record_task_result(False, str(exc))
            raise
        finally:
            record_url(url, 'TaskSucceeded' if result['success'] else 'TaskFailed', outcome=result)
            _result.reset(result_token)
            _task.reset(token)
    return wrapped
