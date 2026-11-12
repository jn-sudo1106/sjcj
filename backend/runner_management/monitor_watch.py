"""Independent watch for queue health and monitor self-misses.

Two checks run on their own thread, not on the collection queue and not on the
scheduler that owns the checks:

- queue health: read RabbitMQ management API and compare with ``ck_queue``;
  a queue that is configured but absent, or whose metrics cannot be read, is
  reported as its own state instead of "no problem";
- monitor self-check: enabled ``ck_source`` rows whose ``NEXT_RUN`` is past the
  grace window without a newer ``ck_job_log`` — a missed check must not be
  invisible just because the check itself is stuck.

The business database is read only. Credentials come from the operator-owned
delivery config (``RUNNER_MONITOR_DELIVERY_CONFIG``) plus MQ env vars, so no
secret is stored in the repository.
"""
import json
import os
import smtplib
import ssl
import threading
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LOCK = threading.RLock()
SETTING = 'monitor-watch:latest'
STATE = 'monitor-watch:state'
DEFAULT_GRACE_MINUTES = 15
DEFAULT_POLL_SECONDS = 300
DEFAULT_MQ_URL = 'http://127.0.0.1:19601'


class WatchUnavailable(RuntimeError):
    """指标不可取得：调用方必须把它当作「未知」，不能当成正常。"""


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


# ---------------------------------------------------------------- configuration

def configuration():
    """合并 MQ / DB / 通知配置；缺项返回空串而不是抛错，便于分别报告不可用。"""
    result = {'mq': {'url': (os.getenv('RUNNER_MONITOR_MQ_URL') or DEFAULT_MQ_URL).rstrip('/'),
                     'user': os.getenv('RUNNER_MONITOR_MQ_USER') or '',
                     'password': os.getenv('RUNNER_MONITOR_MQ_PASSWORD') or '',
                     'timeout': int(os.getenv('RUNNER_MONITOR_MQ_TIMEOUT') or 8)},
              'db': None, 'smtp': None, 'notify': {'enabled': False, 'recipient': ''},
              'graceMinutes': int(os.getenv('RUNNER_MONITOR_GRACE_MINUTES') or DEFAULT_GRACE_MINUTES),
              'pollSeconds': int(os.getenv('RUNNER_MONITOR_WATCH_SECONDS') or DEFAULT_POLL_SECONDS)}
    path = os.getenv('RUNNER_MONITOR_DELIVERY_CONFIG')
    if path:
        try:
            value = json.loads(Path(path).read_text())
            if isinstance(value.get('db'), dict):
                result['db'] = value['db']
            if isinstance(value.get('smtp'), dict):
                result['smtp'] = value['smtp']
        except Exception:
            result['db'] = None
    extra = os.getenv('RUNNER_MONITOR_WATCH_CONFIG')
    if extra:
        try:
            value = json.loads(Path(extra).read_text())
            result['mq'].update(value.get('mq') or {})
            if isinstance(value.get('notify'), dict):
                result['notify'].update(value['notify'])
            for key in ('graceMinutes', 'pollSeconds'):
                if value.get(key) is not None:
                    result[key] = int(value[key])
        except Exception:
            pass
    return result


# ---------------------------------------------------------------- queue health

def fetch_queues(config):
    """GET /api/queues；任何失败都抛 WatchUnavailable（不得降级成空列表）。"""
    mq = config['mq']
    request = Request(mq['url'] + '/api/queues', headers={'Accept': 'application/json'})
    if mq.get('user'):
        import base64
        token = base64.b64encode(f"{mq['user']}:{mq.get('password', '')}".encode()).decode()
        request.add_header('Authorization', 'Basic ' + token)
    try:
        with urlopen(request, timeout=mq.get('timeout') or 8) as response:
            raw = response.read(8 * 1024 * 1024)
        value = json.loads(raw)
    except HTTPError as exc:
        raise WatchUnavailable(f'队列管理接口返回 HTTP {exc.code}') from exc
    except (URLError, OSError) as exc:
        raise WatchUnavailable(f'队列管理接口不可达：{exc}') from exc
    except ValueError as exc:
        raise WatchUnavailable('队列管理接口返回的不是有效 JSON') from exc
    if not isinstance(value, list):
        raise WatchUnavailable('队列管理接口返回格式无效')
    return [item for item in value if isinstance(item, dict) and item.get('name')]


def consume_rate(item):
    stats = ((item.get('message_stats') or {}).get('ack_details') or {}).get('rate')
    if not stats:
        stats = ((item.get('message_stats') or {}).get('deliver_get_details') or {}).get('rate')
    try:
        return float(stats or 0)
    except (TypeError, ValueError):
        return 0.0


def classify(defined, item, thresholds):
    """返回 (status, reason)；顺序沿用旧平台：堆积→量不足→消费过慢→过快→消费者缺失。"""
    if item is None:
        return 'missing', '配置了该队列，但 RabbitMQ 里找不到'
    messages = int(item.get('messages') or 0)
    unacked = int(item.get('messages_unacknowledged') or 0)
    consumers = int(item.get('consumers') or 0)
    rate = consume_rate(item)
    max_size = defined.get('maxSize')
    min_size = defined.get('minSize')
    min_rate = defined.get('minRate')
    max_rate = defined.get('maxRate')
    min_consumer = defined.get('minConsumer')
    text = f'消息 {messages}（未确认 {unacked}）、消费者 {consumers}、消费 {rate:g}/s'
    if max_size is not None and messages >= int(max_size):
        return 'backlog', f'积压：{text}，阈值 Max {max_size}'
    if min_size is not None and messages < int(min_size):
        return 'insufficient', f'量不足：{text}，阈值 Min {min_size}'
    if min_rate is not None and messages > thresholds['slowConsumerMessages'] and rate < float(min_rate):
        return 'slow_consumer', f'消费过慢：{text}，阈值 Min {min_rate}/s'
    if max_rate is not None and rate >= float(max_rate):
        return 'too_fast', f'消费过快：{text}，阈值 Max {max_rate}/s'
    if min_consumer is not None and consumers < int(min_consumer):
        return 'no_consumer', f'消费者不足：{text}，阈值 Min {min_consumer} 个'
    return 'ok', text


def queue_health(config, fetch=None):
    thresholds = {'slowConsumerMessages': 200}
    fetch = fetch or fetch_queues
    try:
        queues = fetch(config)
    except WatchUnavailable as exc:
        return {'reachable': False, 'error': str(exc), 'items': [], 'summary': {'total': 0, 'problems': 0}}
    try:
        defined = read_defined_queues(config)
    except Exception as exc:
        return {'reachable': True, 'error': f'读取队列配置失败：{exc}', 'items': [],
                'summary': {'total': 0, 'problems': 0}}
    by_name = {}
    for item in queues:
        by_name.setdefault(str(item['name']), item)
    items = []
    for row in defined:
        name = str(row.get('name') or '').strip()
        if not name:
            continue
        status, reason = classify(row, by_name.get(name), thresholds)
        items.append({'name': name, 'status': status, 'reason': reason,
                      'messages': int((by_name.get(name) or {}).get('messages') or 0),
                      'unacked': int((by_name.get(name) or {}).get('messages_unacknowledged') or 0),
                      'consumers': int((by_name.get(name) or {}).get('consumers') or 0),
                      'consumeRate': round(consume_rate(by_name.get(name) or {}), 3)})
    problems = [item for item in items if item['status'] != 'ok']
    return {'reachable': True, 'error': None, 'items': items,
            'summary': {'total': len(items), 'problems': len(problems)}}


def read_defined_queues(config):
    """ck_queue 里启用的队列及其阈值；数据库不可用属于不可取得，不是「没有队列」。"""
    if not config.get('db'):
        raise WatchUnavailable('未配置业务数据库，无法读取 ck_queue')
    import pymysql
    with pymysql.connect(**config['db'], charset='utf8mb4', connect_timeout=5,
                         read_timeout=10, write_timeout=10, cursorclass=pymysql.cursors.DictCursor) as db:
        with db.cursor() as cursor:
            cursor.execute('SELECT QUEUE_NAME name, MAX_SIZE maxSize, MIN_SIZE minSize, MIN_RATE minRate, '
                           'MAX_RATE maxRate, MIN_CONSUMER minConsumer FROM ck_queue '
                           'WHERE IS_DELETE = 0 ORDER BY QUEUE_ID')
            rows = cursor.fetchall()
    return [{'name': row['name'], 'maxSize': row['maxSize'], 'minSize': row['minSize'],
             'minRate': row['minRate'], 'maxRate': row['maxRate'], 'minConsumer': row['minConsumer']}
            for row in rows]


# ---------------------------------------------------------------- overdue checks

OVERDUE_SQL = """SELECT c.ID id, c.SOURCE_ID sourceId, c.NAME name, c.SCHEDULE cron,
       DATE_FORMAT(c.NEXT_RUN, '%%Y-%%m-%%d %%H:%%i:%%s') due,
       DATE_FORMAT(c.LAST_RUN, '%%Y-%%m-%%d %%H:%%i:%%s') lastRun,
       (SELECT DATE_FORMAT(MAX(l.CREATE_DT), '%%Y-%%m-%%d %%H:%%i:%%s') FROM ck_job_log l
          WHERE l.JOB_ID = c.ID AND l.SOURCE_ID = c.SOURCE_ID) lastLog
  FROM ck_source c
 WHERE c.IS_DELETE = 0 AND c.NEXT_RUN IS NOT NULL
   AND c.NEXT_RUN < DATE_SUB(NOW(), INTERVAL %s MINUTE)
   AND NOT EXISTS (SELECT 1 FROM ck_job_log l
                    WHERE l.JOB_ID = c.ID AND l.SOURCE_ID = c.SOURCE_ID
                      AND l.CREATE_DT >= c.NEXT_RUN)
 ORDER BY c.NEXT_RUN LIMIT 500"""


def read_overdue(config, grace_minutes=None):
    if not config.get('db'):
        raise WatchUnavailable('未配置业务数据库，无法核对监控是否漏跑')
    grace = int(grace_minutes if grace_minutes is not None else config.get('graceMinutes') or DEFAULT_GRACE_MINUTES)
    import pymysql
    with pymysql.connect(**config['db'], charset='utf8mb4', connect_timeout=5,
                         read_timeout=10, write_timeout=10, cursorclass=pymysql.cursors.DictCursor) as db:
        with db.cursor() as cursor:
            cursor.execute(OVERDUE_SQL, (grace,))
            rows = cursor.fetchall()
    return {'graceMinutes': grace,
            'items': [{'monitorId': str(row['id']), 'sourceId': str(row['sourceId']), 'name': row['name'],
                       'cron': row['cron'], 'due': row['due'], 'lastRun': row['lastRun'],
                       'lastLog': row['lastLog']} for row in rows]}


# ---------------------------------------------------------------- scan / snapshot

def scan(app, config=None, fetch=None, now=None):
    config = config or configuration()
    snapshot = {'at': stamp(), 'graceMinutes': config.get('graceMinutes') or DEFAULT_GRACE_MINUTES}
    snapshot['queue'] = queue_health(config, fetch=fetch)
    try:
        overdue = read_overdue(config)
        snapshot['monitors'] = {'available': True, 'graceMinutes': overdue['graceMinutes'],
                                'items': overdue['items'], 'count': len(overdue['items'])}
    except WatchUnavailable as exc:
        snapshot['monitors'] = {'available': False, 'error': str(exc), 'items': [], 'count': 0}
    except Exception as exc:
        snapshot['monitors'] = {'available': False, 'error': f'漏跑核对失败：{exc}', 'items': [], 'count': 0}
    snapshot['summary'] = {
        'queueProblems': snapshot['queue']['summary']['problems'],
        'queueUnobservable': 0 if snapshot['queue']['reachable'] and not snapshot['queue']['error'] else 1,
        'overdueMonitors': snapshot['monitors']['count'],
        'healthy': bool(snapshot['queue']['reachable'] and not snapshot['queue']['error'] and snapshot['queue']['summary']['problems'] == 0
                        and snapshot['monitors']['available'] and snapshot['monitors']['count'] == 0),
    }
    write(app, SETTING, snapshot)
    previous = read(app, STATE) or {}
    signature = signature_of(snapshot)
    notified = previous.get('lastNotifiedSignature')
    # Preserve receipts made before this field existed. A failed send must not
    # advance the delivered cursor and suppress retries of an unchanged issue.
    if notified is None and previous.get('lastSentAt') and not previous.get('lastError'):
        notified = previous.get('signature')
    if signature == 'ok':
        previous.update(lastNotifiedSignature='ok', lastError='')
    elif signature != notified and config['notify'].get('enabled'):
        try:
            send_digest(config, snapshot)
            previous.update(lastSentAt=stamp(), lastNotifiedSignature=signature, lastError='')
        except Exception as exc:
            previous['lastError'] = f'巡检通知投递失败：{exc}'
    previous['signature'] = signature
    write(app, STATE, previous)
    return snapshot


def signature_of(snapshot):
    parts = [f"{item['name']}:{item['status']}" for item in snapshot['queue']['items'] if item['status'] != 'ok']
    if not snapshot['queue']['reachable'] or snapshot['queue']['error']:
        parts.append('queue:unobservable')
    if not snapshot['monitors']['available']:
        parts.append('monitors:unobservable')
    parts.extend(f"monitor:{item['monitorId']}" for item in snapshot['monitors']['items'][:50])
    return '|'.join(sorted(parts)) or 'ok'


def send_digest(config, snapshot):
    smtp = config.get('smtp')
    recipient = (config['notify'].get('recipient') or '').strip()
    if not smtp or not recipient:
        raise WatchUnavailable('未配置独立邮件通道或收件人')
    lines = []
    queue = snapshot['queue']
    if not queue['reachable'] or queue['error']:
        lines.append(f"队列指标不可取得：{queue['error']}（不能视为正常）")
    for item in queue['items']:
        if item['status'] != 'ok':
            lines.append(f"[队列] {item['name']} · {item['status']} · {item['reason']}")
    monitors = snapshot['monitors']
    if not monitors['available']:
        lines.append(f"漏跑核对不可取得：{monitors['error']}（不能视为正常）")
    for item in monitors['items'][:50]:
        lines.append(f"[漏跑] {item['name']}（源 {item['sourceId']}，检查 {item['monitorId']}）"
                     f" 应执行 {item['due']}，宽限 {monitors['graceMinutes']} 分钟后仍无运行")
    if not lines:
        return False
    message = EmailMessage()
    message['From'] = smtp['from']
    message['To'] = recipient
    message['Subject'] = f"[监控巡检] 队列异常 {queue['summary']['problems']} · 漏跑 {monitors['count']} · {snapshot['at'][:16]}"
    message.set_content('本邮件由独立巡检发送，不经过采集队列。\n\n' + '\n'.join(lines) +
                        '\n\n如指标不可取得，状态为未知，不代表正常。')
    context = ssl.create_default_context()
    if smtp.get('tls') == 'ssl':
        server = smtplib.SMTP_SSL(smtp['host'], int(smtp['port']), timeout=20, context=context)
    else:
        server = smtplib.SMTP(smtp['host'], int(smtp['port']), timeout=20)
        server.starttls(context=context)
    try:
        server.login(smtp['user'], smtp['password'])
        server.send_message(message)
    finally:
        try:
            server.quit()
        except Exception:
            pass
    return True


# ---------------------------------------------------------------- persistence / api

def read(app, key):
    from . import monitor_batches as batches
    return batches.read(app, key)


def write(app, key, value):
    from . import monitor_batches as batches
    batches.write(app, key, value)


def latest(app):
    return read(app, SETTING)


def run_scan(app):
    with LOCK:
        return scan(app)


def status(app):
    snapshot = latest(app)
    return {'latest': snapshot, 'configured': {
        'mq': bool((configuration()['mq'].get('url'))),
        'db': bool(configuration().get('db')),
        'notify': bool(configuration()['notify'].get('enabled')),
    }}


def start(app, stopped):
    def work():
        while True:
            try:
                run_scan(app)
            except Exception as exc:  # 巡检自身失败要留痕，不能静默
                print(f'监控巡检失败：{exc}', flush=True)
            if stopped.wait(int(configuration().get('pollSeconds') or DEFAULT_POLL_SECONDS)):
                return
    worker = threading.Thread(target=work, name='monitor-watch', daemon=True)
    worker.start()
    return worker
