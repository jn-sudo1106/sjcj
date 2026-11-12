"""Queue-independent delivery for explicitly subscribed batch-created checks.

The business database is read only. SMTP secrets stay in an operator-owned file;
the durable settings contain recipients, event identities and delivery receipts.
"""
import json
import os
import re
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

from . import monitor_batches as batches

PREFIX = 'monitor-delivery:'
LOCK = threading.RLock()


def configuration():
    path = os.getenv('RUNNER_MONITOR_DELIVERY_CONFIG')
    if not path: raise batches.error('尚未配置独立邮件投递服务，请配置 RUNNER_MONITOR_DELIVERY_CONFIG', 503)
    try:
        value = json.loads(Path(path).read_text())
        assert all(value['smtp'].get(key) for key in ('host', 'port', 'user', 'password', 'from'))
        assert value['smtp'].get('tls') in ('ssl', 'starttls')
        assert all(key in value['db'] for key in ('host', 'port', 'user', 'password', 'database'))
        return value
    except Exception as exc:
        raise batches.error('独立邮件服务配置无效；未使用默认业务收件人', 503) from exc


def snapshots(config, monitor_ids):
    import pymysql
    result = {}
    ids = list(monitor_ids)
    with pymysql.connect(**config['db'], charset='utf8mb4', connect_timeout=5,
                         read_timeout=10, write_timeout=10, cursorclass=pymysql.cursors.DictCursor) as db:
        with db.cursor() as cursor:
            # No DDL/DML: the existing scheduler remains the only check executor.
            for offset in range(0, len(ids), 200):
                part = ids[offset:offset + 200]
                cursor.execute('SELECT c.ID id, c.SOURCE_ID sourceId, c.NAME name, c.IS_DELETE disabled, '
                               'c.CHECK_CONF conf, UNIX_TIMESTAMP(c.NEXT_RUN) due, UNIX_TIMESTAMP(NOW()) now, '
                               'l.LOG_ID logId, l.STATE logState, l.LOG_MSG logMessage, l.CREATE_DT logAt '
                               'FROM ck_source c LEFT JOIN ck_job_log l ON l.LOG_ID=('
                               'SELECT MAX(LOG_ID) FROM ck_job_log WHERE JOB_ID=c.ID AND SOURCE_ID=c.SOURCE_ID) '
                               'WHERE c.ID IN (' + ','.join(['%s'] * len(part)) + ')', part)
                for row in cursor.fetchall():
                    log = {'id': row['logId'], 'state': row['logState'], 'message': row['logMessage'], 'at': row['logAt']} if row['logId'] else None
                    result[str(row['id'])] = (row, log)
    return result


def send(config, event):
    smtp = config['smtp']
    message = EmailMessage()
    message['From'] = smtp['from']
    message['To'] = event['recipient']
    message['Subject'] = event['subject']
    message['Message-ID'] = event['messageId']
    message.set_content(event['body'])
    context = ssl.create_default_context()
    if smtp['tls'] == 'ssl':
        client = smtplib.SMTP_SSL(smtp['host'], int(smtp['port']), timeout=15, context=context)
    else:
        client = smtplib.SMTP(smtp['host'], int(smtp['port']), timeout=15)
    try:
        if smtp['tls'] == 'starttls': client.starttls(context=context)
        client.login(smtp['user'], smtp['password'])
        refused = client.send_message(message, from_addr=smtp['from'], to_addrs=[event['recipient']])
        if refused: raise smtplib.SMTPRecipientsRefused(refused)
    finally:
        # A QUIT failure after DATA was accepted must not erase that receipt.
        try: client.quit()
        except Exception: client.close()


def deliver(app, key, event, config):
    if event.get('status') == 'sending':
        event.update(status='uncertain', message='上次投递中断，是否已接受未知；请核对邮箱后重试')
    if event.get('status') not in ('pending',):
        batches.write(app, key, event)
        return
    event.update(status='sending', updatedAt=batches.stamp())
    batches.write(app, key, event)
    try:
        send(config, event)
        event.update(status='accepted', message='SMTP 已接受；不代表收件箱已送达', acceptedAt=batches.stamp())
    except smtplib.SMTPAuthenticationError as exc:
        # 163/QQ 等服务端会把「SMTP 服务未开启」也报成认证失败（550 User has no permission），
        # 只写异常类型会让运维误以为只是密码错，这里保留服务端原始码与原因。
        detail = exc.smtp_error.decode('utf-8', 'replace') if isinstance(exc.smtp_error, bytes) else str(exc.smtp_error)
        event.update(status='failed', message=f'邮件投递失败（SMTP 认证被拒 {exc.smtp_code} {detail.strip()[:160]}）：请核对授权码、SMTP 服务是否开启、发件人是否与登录账号一致')
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused,
            smtplib.SMTPDataError, ConnectionRefusedError) as exc:
        event.update(status='failed', message=f'邮件投递失败（{type(exc).__name__}），可核对配置后重试')
    except Exception as exc:
        event.update(status='uncertain', message=f'未取得完整投递回执（{type(exc).__name__}）；请核对邮箱后重试')
    event['updatedAt'] = batches.stamp()
    batches.write(app, key, event)


def event(app, subscription, event_id, subject, body, config):
    key = f'{PREFIX}{subscription["batchId"]}:event:{event_id}'
    record = batches.read(app, key)
    if record is None:
        record = {'recipient': subscription['recipient'], 'subject': subject, 'body': body,
                  'messageId': make_msgid(domain='monitor.local'), 'status': 'pending', 'createdAt': batches.stamp()}
        batches.write(app, key, record)
    deliver(app, key, record, config)


def tick(app):
    with LOCK:
        for entry in batches.key_rows(app, PREFIX):
            if not entry['setting_key'].endswith(':subscription'): continue
            sub = batches.read(app, entry['setting_key'])
            if not sub['enabled']: continue
            try:
                config = configuration()
                current = snapshots(config, sub['monitors'])
                for monitor_id, state in sub['monitors'].items():
                    row, log = current.get(monitor_id, (None, None))
                    if not row or int(row.get('disabled') or 0) != 0: continue
                    conf = json.loads(row['conf'] or '{}')
                    if conf.get('batchCreateKey') != state['createKey'] or conf.get('notifyOn') != 'none':
                        raise ValueError('check configuration changed')
                    overdue = row.get('due') is not None and float(row['now']) - float(row['due']) > 900
                    health = 'overdue' if overdue else 'running'
                    data = log.get('state') if log else None
                    # Notify transitions, not every hourly abnormal log. Recovery
                    # and a subsequent recurrence produce separate events.
                    signature = f'{health}:{data or "unconfirmed"}'
                    if state.get('signature') != signature:
                        previous = state.get('signature', '')
                        event_id = f'{monitor_id}-{log["id"] if log else 0}-{int(row["due"] or 0) if overdue else 0}-{health}'
                        if overdue or data == 'E' or previous.startswith('overdue:') or previous.endswith(':E'):
                            kind = '检查超期未运行' if overdue else '数据异常' if data == 'E' else '监控恢复'
                            body = (f'源：{row["name"]}\n源 ID：{row["sourceId"]}\n检查 ID：{monitor_id}\n'
                                    f'状态：{kind}\n日志 ID：{log["id"] if log else "未取得"}\n'
                                    f'结果：{str(log.get("message") or "")[:600] if log else "未取得正式检查日志"}\n'
                                    '本通知由独立投递服务发送，不经过采集队列。')
                            # The event ID derives from the actual log/due time.
                            # Restarting between event delivery and cursor save
                            # reuses its receipt instead of sending it twice.
                            event(app, sub, event_id, f'[数据监控] {kind} · {row["sourceId"]}', body, config)
                        state['signature'] = signature
                sub.update(lastPollAt=batches.stamp(), error='')
            except Exception as exc:
                sub['error'] = f'独立巡检未完成（{type(exc).__name__}）；不能视为监控正常'
            batches.write(app, entry['setting_key'], sub)
        # Durable pending sends survive a service restart. Ambiguous sends need
        # an explicit retry so a timeout cannot silently cause duplicate email.
        for entry in batches.key_rows(app, PREFIX):
            if ':event:' not in entry['setting_key']: continue
            record = batches.read(app, entry['setting_key'])
            if record['status'] in ('pending', 'sending'):
                batch_id = entry['setting_key'].split(':')[1]
                subscription = batches.read(app, f'{PREFIX}{batch_id}:subscription')
                if not subscription or not subscription['enabled']: continue
                try: deliver(app, entry['setting_key'], record, configuration())
                except Exception: pass  # Subscription reports configuration errors.


def configure(app, job, payload):
    with LOCK:
        key = f'{PREFIX}{job["batchId"]}:subscription'
        previous = batches.read(app, key)
        if payload.get('enabled') is False:
            if previous:
                previous['enabled'] = False
                batches.write(app, key, previous)
            return
        configuration()
        recipient = str(payload.get('recipient') or '').strip()
        if not re.fullmatch(r'[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}', recipient):
            raise batches.error('请输入一个有效的通知邮箱')
        if previous and previous['recipient'] != recipient:
            raise batches.error('本批次已绑定收件人；变更收件人请使用新批次', 409)
        monitors = {}
        for entry in batches.key_rows(app, batches.item_key(job['batchId'])):
            item = batches.read(app, entry['setting_key'])
            if item.get('monitorId') and item.get('createKey') and item['status'] in ('created', 'queued', 'unconfirmed', 'executed'):
                monitors[item['monitorId']] = {'createKey': item['createKey']}
        if not monitors: raise batches.error('本批次没有已确认新增的检查；现有业务检查不会自动改通知')
        sub = previous or {'batchId': job['batchId'], 'recipient': recipient, 'monitors': monitors}
        sub['enabled'] = True
        batches.write(app, key, sub)


def retry(app, job):
    with LOCK:
        configuration()
        sub = batches.read(app, f'{PREFIX}{job["batchId"]}:subscription')
        if not sub or not sub['enabled']: raise batches.error('请先启用本批次独立通知')
        for entry in batches.key_rows(app, f'{PREFIX}{job["batchId"]}:event:'):
            record = batches.read(app, entry['setting_key'])
            if record['status'] in ('failed', 'uncertain'):
                record.update(status='pending', message='已申请重试')
                batches.write(app, entry['setting_key'], record)


def status(app, job):
    sub = batches.read(app, f'{PREFIX}{job["batchId"]}:subscription')
    records = []
    for entry in batches.key_rows(app, f'{PREFIX}{job["batchId"]}:event:')[-20:]:
        record = batches.read(app, entry['setting_key'])
        records.append({key: value for key, value in record.items() if key != 'body'})
    return {'configured': bool(os.getenv('RUNNER_MONITOR_DELIVERY_CONFIG')), 'enabled': bool(sub and sub['enabled']),
            'recipient': sub['recipient'] if sub else '', 'lastPollAt': sub.get('lastPollAt') if sub else None,
            'error': sub.get('error', '') if sub else '', 'receipts': sorted(records, key=lambda row: row['createdAt'], reverse=True)}


def start(app, stopped):
    def work():
        while not stopped.is_set():
            try: tick(app)
            except Exception: pass  # Individual subscription errors remain visible.
            stopped.wait(15)
    worker = threading.Thread(target=work, name='monitor-mail-delivery', daemon=True)
    worker.start()
    return worker
