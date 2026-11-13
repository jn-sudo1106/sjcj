"""AI 检查异常事件与独立的邮件投递回执。

设计取舍
--------
* 只有 ``status != NORMAL`` 才建事件。AI 检查默认每 10 分钟跑一次，正常结果
  也发邮件会把收件箱淹没；真正需要人处理的是异常和执行失败。
* ``eventId`` 由 runId 尾部的时间戳决定，不额外取随机数：同一轮检查被重复
  调用（重跑 apply、接口重试）时必须落到同一条事件上，否则「已发送」的判定
  会失效、同一异常会被重复投递。
* 投递失败不是「没发生」：事件照常保留，``delivery.state`` 记 ``failed`` 并
  保留 attempt/error；SMTP 未配置时记 ``not-configured``，绝不能伪装成 sent。
* 重试只针对 ``pending`` / ``not-configured`` / 未超次数的 ``failed``；每次
  失败至少间隔 ``RETRY_SECONDS``，超过 ``MAX_ATTEMPTS`` 后停手，避免死信在
  后台线程里无限重试。
* 业务库只读。事件落在 Runner 自己的 settings 表（``monitor-events:`` 前缀），
  SMTP 凭据只从环境变量指向的配置文件读取，不写进仓库。

投递状态机::

    pending ──成功──> sent
       │
       ├─未配置──> not-configured ──(配置补齐后)──> 直接重试 ──> sent
       │
       └─发送失败──> failed ──(达到间隔且未超次数)──> pending ...
                        │
                        └─attempts >= MAX_ATTEMPTS──> 停在 failed（死信）

``sending`` 只用于「发送过程中进程退出」的中间态：下一轮扫描看到它会把状态
改成 failed（结果未知），不会把它当成 sent。
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timedelta
from email.utils import make_msgid
from pathlib import Path

from . import monitor_batches as batches
from . import monitor_delivery as delivery
from . import monitor_runner as runner

PREFIX = 'monitor-events:'
INDEX_KEY = PREFIX + 'index'
MAX_EVENTS = 500
MAX_ATTEMPTS = 3
RETRY_SECONDS = 60
DEFAULT_POLL_SECONDS = 15
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

LOCK = threading.RLock()


def now():
    """业务时区的当前时间；与 ck_job_log 的时间口径保持一致。"""
    return runner.business_now()


def stamp(moment=None):
    return (moment or now()).strftime('%Y-%m-%d %H:%M:%S')


def _moment(text):
    try:
        return datetime.strptime(str(text)[:19], '%Y-%m-%d %H:%M:%S')
    except (TypeError, ValueError):
        return None


def event_id_for(monitor_id, run_id):
    """由 runId 的时间戳生成稳定 eventId；runId 缺失时才退回当前时间。"""
    match = re.search(r'(\d{8,14})$', str(run_id or ''))
    suffix = match.group(1) if match else now().strftime('%Y%m%d%H%M%S')
    return 'evt-%s-%s' % (int(monitor_id), suffix)


def _delivery(event):
    """取事件上的投递游标；老事件没有该字段时就地补一个默认值。"""
    state = event.get('delivery')
    if not isinstance(state, dict):
        state = {}
        event['delivery'] = state
    state.setdefault('state', 'pending')
    state.setdefault('attempts', 0)
    state.setdefault('lastAttemptAt', None)
    state.setdefault('nextAttemptAt', None)
    state.setdefault('error', None)
    state.setdefault('reason', None)
    return state


def _index(app):
    value = batches.read(app, INDEX_KEY)
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _index_add(app, event_id):
    """索引按时间倒序且封顶；被挤出的事件连正文一起删，避免 store 无限增长。"""
    index = [item for item in _index(app) if item != event_id]
    index.insert(0, event_id)
    overflow = index[MAX_EVENTS:]
    batches.write(app, INDEX_KEY, index[:MAX_EVENTS])
    for stale in overflow:
        with app.store.connect() as db:
            db.execute('DELETE FROM settings WHERE setting_key=?', (PREFIX + stale,))


def record(app, item, conf=None, outcome=None):
    """apply_result 落库成功后建事件；正常结果不建，同一 runId 幂等。

    返回创建或已存在的事件；不需要通知时返回 None。
    """
    item = item or {}
    status = str(item.get('status') or '').upper()
    if not status or status == runner.STATUS_NORMAL:
        return None
    monitor_id = item.get('monitorId')
    if monitor_id in (None, ''):
        return None
    outcome = outcome or {}
    event_id = event_id_for(monitor_id, item.get('runId'))
    key = PREFIX + event_id
    with LOCK:
        existing = batches.read(app, key)
        if existing is not None:
            return existing
        # 执行失败时 error 才是主因；数据异常时用检查脚本给出的 reason。
        error = item.get('error') or outcome.get('error') or ''
        reason = error if status == runner.STATUS_ERROR else ''
        reason = reason or item.get('reason') or error
        event = {
            'eventId': event_id,
            'monitorId': int(monitor_id),
            'sourceId': item.get('sourceId'),
            'name': item.get('name'),
            'runId': item.get('runId'),
            'status': status,
            'checkedCount': item.get('checkedCount'),
            'abnormalCount': item.get('abnormalCount'),
            'tableName': item.get('tableName'),
            'window': item.get('window'),
            'reason': str(reason or ''),
            'createdAt': stamp(),
            'deliveries': [],
            'delivery': {'state': 'pending', 'attempts': 0, 'lastAttemptAt': None,
                         'nextAttemptAt': None, 'error': None, 'reason': None},
        }
        batches.write(app, key, event)
        _index_add(app, event_id)
        return event


def smtp_configuration():
    """读投递配置，返回 ``(config, None)`` 或 ``(None, 不可投递原因)``。

    配置缺失/未开启不抛错：事件仍在，只是把真实原因写进 ``not-configured``。
    """
    path = (os.getenv('RUNNER_MONITOR_DELIVERY_CONFIG') or '').strip()
    if not path:
        return None, '未配置 RUNNER_MONITOR_DELIVERY_CONFIG'
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        return None, '投递配置不可读：%s' % exc
    if not isinstance(value, dict):
        return None, '投递配置格式无效'
    notify = value.get('notify') if isinstance(value.get('notify'), dict) else {}
    enabled = notify.get('enabled')
    if not (enabled is True or enabled == 1 or str(enabled).strip().lower() in ('true', 'yes', 'on')):
        return None, '邮件通知未开启（notify.enabled 不为 true）'
    recipient = str(notify.get('recipient') or '').strip()
    if not recipient:
        return None, '未配置收件人（notify.recipient 为空）'
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', recipient):
        return None, '收件人地址无效：%s' % recipient
    smtp = value.get('smtp') if isinstance(value.get('smtp'), dict) else {}
    missing = [name for name in ('host', 'port', 'user', 'password', 'from') if not smtp.get(name)]
    if missing:
        return None, 'SMTP 配置缺少字段：%s' % '、'.join(missing)
    if smtp.get('tls') not in ('ssl', 'starttls'):
        return None, 'SMTP tls 必须是 ssl 或 starttls'
    return {'smtp': smtp, 'notify': {'enabled': True, 'recipient': recipient}}, None


def status_label(status):
    return {runner.STATUS_ABNORMAL: '数据异常', runner.STATUS_ERROR: '执行失败'}.get(status, '状态异常')


def _window_text(window):
    if isinstance(window, dict):
        start = window.get('start') or window.get('begin')
        end = window.get('end') or window.get('finish')
        if start or end:
            return '%s ~ %s' % (start or '-', end or '-')
        return json.dumps(window, ensure_ascii=False)
    return str(window or '-')


def subject_for(event):
    return '[数据监控] %s · %s' % (event.get('name') or '#%s' % event.get('monitorId'),
                                   status_label(event.get('status')))


def body_for(event):
    """纯文本正文：值班同学在手机邮件里也要能直接看懂，不放 HTML。"""
    return '\n'.join([
        '检查名称：%s' % (event.get('name') or '-'),
        '源 ID：%s' % (event.get('sourceId') if event.get('sourceId') is not None else '-'),
        '数据表：%s' % (event.get('tableName') or '-'),
        '统计窗口：%s' % _window_text(event.get('window')),
        '状态：%s（%s）' % (status_label(event.get('status')), event.get('status')),
        '检查条数：%s' % (event.get('checkedCount') if event.get('checkedCount') is not None else '-'),
        '异常条数：%s' % (event.get('abnormalCount') if event.get('abnormalCount') is not None else '-'),
        '原因：%s' % (event.get('reason') or '-'),
        'runId：%s' % (event.get('runId') or '-'),
        '时间：%s' % (event.get('createdAt') or '-'),
        '',
        '由 Runner 数据监控自动发送；如需处理请登录管理端查看。',
    ])


def send_email(config, event):
    """复用 monitor_delivery 的 SMTP 发送；只传它需要的 smtp 段。"""
    delivery.send({'smtp': config['smtp']}, {
        'recipient': config['notify']['recipient'],
        'subject': subject_for(event),
        'body': body_for(event),
        'messageId': make_msgid(domain='monitor.local'),
    })


def deliver(app, event_id, moment=None, manual=False):
    """对单个事件尝试一次投递；返回事件（含最新 delivery/deliveries）。

    ``manual=True`` 是 HTTP 重试：清零失败计数并立即尝试。已发送的事件不重复
    发送，避免点一次重试就给收件人再发一封。
    """
    moment = moment or now()
    with LOCK:
        key = PREFIX + event_id
        event = batches.read(app, key)
        if event is None:
            raise batches.error('事件不存在', 404)
        state = _delivery(event)
        if manual:
            if state.get('state') == 'sent':
                return event
            state.update(state='pending', attempts=0, error=None, reason=None, nextAttemptAt=None)
        if state.get('state') == 'sent':
            return event
        if state.get('state') == 'sending':
            # 上次发送没走完（进程退出/被杀）：结果未知，按失败处理，等人工或重试。
            state.update(state='failed', error='上次投递中断，结果未知', nextAttemptAt=None)
            batches.write(app, key, event)
            return event
        if not manual and state.get('state') == 'failed':
            if int(state.get('attempts') or 0) >= MAX_ATTEMPTS:
                return event
            due = _moment(state.get('nextAttemptAt'))
            if due and moment < due:
                return event
        config, reason = smtp_configuration()
        if config is None:
            if state.get('state') == 'not-configured' and state.get('reason') == reason:
                return event
            state.update(state='not-configured', reason=reason, error=None, nextAttemptAt=None)
            batches.write(app, key, event)
            return event
        attempt = int(state.get('attempts') or 0) + 1
        recipient = config['notify']['recipient']
        receipt = {
            'deliveryId': 'dlv-%s-%s' % (event_id, len(event.get('deliveries') or []) + 1),
            'channel': 'email',
            'recipient': recipient,
            'attempt': attempt,
            'state': 'failed',
            'at': stamp(moment),
        }
        # 先落 sending 再发信：发送过程中崩溃时能看出「结果未知」，不会当成还没发。
        state.update(state='sending', attempts=attempt, lastAttemptAt=stamp(moment),
                     reason=None, nextAttemptAt=None)
        event['delivery'] = state
        batches.write(app, key, event)
        try:
            send_email(config, event)
        except Exception as exc:
            receipt['error'] = ('%s: %s' % (type(exc).__name__, exc))[:500]
            state.update(state='failed', error=receipt['error'])
            if attempt < MAX_ATTEMPTS:
                state['nextAttemptAt'] = stamp(moment + timedelta(seconds=RETRY_SECONDS))
        else:
            receipt['state'] = 'sent'
            state.update(state='sent', error=None, reason=None, nextAttemptAt=None, sentAt=stamp(moment))
        event.setdefault('deliveries', []).append(receipt)
        event['delivery'] = state
        batches.write(app, key, event)
        return event


def retry(app, event_id):
    """HTTP 重试入口：不存在抛 404，返回本次投递后的事件。"""
    if not re.fullmatch(r'evt-[0-9]+-[A-Za-z0-9]{1,40}', str(event_id or '')):
        raise batches.error('事件不存在', 404)
    return deliver(app, event_id, manual=True)


def listing(app, monitor_id='', run_id='', limit=DEFAULT_LIMIT):
    """按索引倒序返回事件；过滤条件在读取时应用，不在索引里维护多份。"""
    try:
        monitor_id = int(monitor_id) if str(monitor_id).strip() not in ('', 'None') else None
    except (TypeError, ValueError):
        raise batches.error('monitorId 无效')
    try:
        limit = int(limit) if str(limit).strip() else DEFAULT_LIMIT
    except (TypeError, ValueError):
        raise batches.error('limit 无效')
    limit = max(1, min(limit, MAX_LIMIT))
    run_id = str(run_id or '').strip()
    with LOCK:
        events = []
        for event_id in _index(app):
            event = batches.read(app, PREFIX + event_id)
            if not event:
                continue
            if monitor_id is not None and int(event.get('monitorId') or 0) != monitor_id:
                continue
            if run_id and str(event.get('runId') or '') != run_id:
                continue
            events.append(event)
            if len(events) >= limit:
                break
    return events


def tick(app):
    """扫描索引，投递 pending / not-configured / 到点的 failed；单条失败不影响其他。"""
    for event_id in _index(app):
        try:
            event = batches.read(app, PREFIX + event_id)
            if not event:
                continue
            state = _delivery(event)
            status = state.get('state')
            if status == 'sending':
                # 由 deliver 统一把不确定状态转为 failed。
                deliver(app, event_id)
                continue
            if status not in ('pending', 'not-configured', 'failed'):
                continue
            if status == 'failed' and int(state.get('attempts') or 0) >= MAX_ATTEMPTS:
                continue
            due = _moment(state.get('nextAttemptAt'))
            if status == 'failed' and due and now() < due:
                continue
            deliver(app, event_id)
        except Exception as exc:  # 一个坏事件不能让整轮投递停摆
            print('监控事件投递失败（%s）：%s' % (event_id, exc), flush=True)


def poll_seconds():
    try:
        return max(5, int(os.getenv('RUNNER_MONITOR_EVENTS_SECONDS') or DEFAULT_POLL_SECONDS))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def start(app, stopped):
    def work():
        while True:
            try:
                tick(app)
            except Exception as exc:
                print('监控事件投递线程失败：%s' % exc, flush=True)
            if stopped.wait(poll_seconds()):
                return
    worker = threading.Thread(target=work, name='monitor-events', daemon=True)
    worker.start()
    return worker