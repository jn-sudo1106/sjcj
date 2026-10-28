"""Authorized operation history and bounded, resumable file-backed console logs."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import threading
import uuid
import io
import zipfile
from .retry_policy import retry_policy

LOCK = threading.RLock()
ID = re.compile(r'^[0-9a-f]{32}$')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def redact(value):
    text = str(value or '')
    text = re.sub(r'(?i)(Bearer\s+)[\w.\-]+', r'\1***', text)
    text = re.sub(r'(?i)((?:password|passwd|token|secret|authorization|access[_-]?key)\s*[=:]\s*)[^\s,;]+', r'\1***', text)
    return re.sub(r'(://[^:/\s]+:)[^@\s]+(@)', r'\1***\2', text)


def check_id(value):
    from .server import ApiError
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ApiError('日志标识无效')
    return value


def snapshot(app, db, runtime):
    from .deployment_configuration import get_configuration
    runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (runtime['runnerId'],)).fetchone()
    assignment = runtime.get('assignment') or {}
    layout = {}
    if runtime.get('deploymentId'):
        try:
            layout = get_configuration(app, runtime['deploymentId'], db)
        except Exception:
            pass
    manifest = {}
    if assignment.get('releaseDigest'):
        try:
            with zipfile.ZipFile(io.BytesIO(app.artifacts.read(assignment['releaseDigest']))) as archive:
                manifest = json.loads(archive.read('manifest.json'))
        except (OSError, ValueError, KeyError, zipfile.BadZipFile):
            pass
    return {'name': runtime.get('name', ''), 'deploymentId': runtime.get('deploymentId', ''), 'runnerName': runner['name'] if runner else '',
            'ipAddress': runner['ip_address'] if runner else '', 'installDirectory': runner['install_directory'] if runner else '',
            'sourceNode': layout.get('sourceNode'), 'configId': layout.get('configId') or assignment.get('configId', ''),
            'queue': assignment.get('queue') or layout.get('queueName', ''), 'entryPoint': runtime.get('entryPoint', ''),
            'directoryTemplate': manifest.get('directoryTemplate', runtime.get('directoryTemplate', '')), 'revision': runtime.get('appliedRevision', ''),
            'releaseDigest': assignment.get('releaseDigest', ''), 'concurrency': assignment.get('concurrency'),
            'retryPolicy': retry_policy(runtime.get('retryPolicy')),
            'sources': manifest.get('sources') or [{key: node.get(key, '') for key in ('repoId', 'sourcePath', 'gitCommit', 'name')}
                                                   for node in layout.get('nodes', []) if node.get('repoId')]}


def insert_record(db, identifier, runtime, kind, data, parent='', status='pending', date=None):
    date = date or stamp()
    db.execute('INSERT INTO runtime_operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
               (identifier, runtime.get('runnerId', ''), runtime.get('runtimeId', ''), runtime.get('deploymentId', ''),
                runtime.get('assignmentId', ''), parent, kind, status, date, date, None, '', json.dumps(data, ensure_ascii=False)))


def add_event(db, record_id, stage, message, level='info', detail='', event_id=None, date=None):
    db.execute('INSERT OR IGNORE INTO runtime_events VALUES (?,?,?,?,?,?,?)',
               (event_id or uuid.uuid4().hex, record_id, date or stamp(), stage[:50], level,
                redact(message)[:4000], redact(detail)[:32000]))


def complete(db, identifier, status, error=''):
    date = stamp()
    db.execute('UPDATE runtime_operations SET status=?,updated_at=?,finished_at=?,error=? WHERE record_id=?',
               (status, date, date if status not in ('pending', 'checking', 'running') else None, redact(error)[:4000], identifier))


def startup_result(db, parent):
    if not parent:
        return
    row = db.execute('SELECT assignment_id,snapshot_json FROM runtime_operations WHERE record_id=?', (parent,)).fetchone()
    if not row:
        return
    runs = db.execute("SELECT status FROM runtime_operations WHERE parent_id=? AND kind='run'", (parent,)).fetchall()
    running = sum(r['status'] == 'running' for r in runs)
    data = json.loads(row['snapshot_json'])
    # A manual Start can restore only a closed slot while siblings continue
    # running under the same adopted release and an earlier start record.
    if row['assignment_id'] and data.get('releaseDigest'):
        siblings = db.execute("SELECT p.slot,o.snapshot_json FROM runtime_operations o JOIN program_runs p ON p.run_id=o.record_id "
                              "WHERE o.assignment_id=? AND o.kind='run' AND o.status='running'", (row['assignment_id'],)).fetchall()
        slots = {item['slot'] for item in siblings if json.loads(item['snapshot_json']).get('releaseDigest') == data['releaseDigest']}
        running = max(running, len(slots))
    failed = any(r['status'] in ('failed', 'paused') for r in runs)
    wanted = data.get('concurrency') or 1
    complete(db, parent, 'success' if running >= wanted else 'partial' if running and failed else 'failed' if failed else 'pending',
             '部分实例启动失败，请查看对应运行记录' if running and failed else '启动失败，请查看对应运行记录' if failed else '')


def control(app, runtime_id, revision, enabled):
    from .deployment_configuration import runtime_rows, control_runtime
    identifier = uuid.uuid4().hex
    with app.store.connect() as db:
        row = next((item for item in runtime_rows(app, db) if item['runtimeId'] == runtime_id), None)
        if row:
            insert_record(db, identifier, row, 'start' if enabled else 'stop', snapshot(app, db, row))
            add_event(db, identifier, 'requested', '已请求启动' if enabled else '已请求停止')
    try:
        result = control_runtime(app, runtime_id, revision, enabled)
    except Exception as exc:
        if row:
            with app.store.connect() as db:
                complete(db, identifier, 'failed', str(exc))
                add_event(db, identifier, 'validation', str(exc), 'error')
        raise
    if row and not enabled:
        with app.store.connect() as db:
            live = db.execute("SELECT 1 FROM runtime_operations WHERE runtime_id=? AND kind='run' AND status IN ('checking','running')", (runtime_id,)).fetchone()
            if not live:
                complete(db, identifier, 'success')
                add_event(db, identifier, 'stopped', '停止状态已保存；未发现已上报的运行实例')
    return result


def assignment_contexts(app, db, assignments):
    from .deployment_configuration import runtime_rows
    by_assignment = {row.get('assignmentId'): row for row in runtime_rows(app, db) if row.get('assignmentId')}
    output = []
    for assignment in assignments:
        runtime = by_assignment.get(assignment['assignmentId'])
        if runtime:
            latest = db.execute("SELECT record_id FROM runtime_operations WHERE assignment_id=? AND kind='start' ORDER BY requested_at DESC LIMIT 1", (assignment['assignmentId'],)).fetchone()
            output.append({**assignment, 'runtimeId': runtime['runtimeId'], 'retryPolicy': runtime['retryPolicy'], 'operationId': latest['record_id'] if latest else '',
                           'logSnapshot': snapshot(app, db, runtime)})
        else:
            output.append(assignment)
    from .process_control import attach
    return attach(db, output)


def delivery_request(app, binding_type, owner, runner_id, payload):
    from .deployment_configuration import runtime_rows
    from .directory_delivery import request_delivery
    identifier = uuid.uuid4().hex
    requested_at = stamp()
    with app.store.connect() as db:
        runtime = next((row for row in runtime_rows(app, db) if row['runnerId'] == runner_id and
                        (row.get('deploymentId') == owner or (row.get('binding') or {}).get('ownerId') == owner)), None)
        data = snapshot(app, db, runtime) if runtime else {'name': owner}
        data.update(scope=payload.get('scope', 'all'), selectedPaths=payload.get('paths', []))
    try:
        result = request_delivery(app, binding_type, owner, runner_id, payload)
    except Exception as exc:
        with app.store.connect() as db:
            insert_record(db, identifier, runtime or {'runnerId': runner_id}, 'delivery', data, date=requested_at)
            complete(db, identifier, 'failed', str(exc)); add_event(db, identifier, 'validation', str(exc), 'error')
        raise
    if result.get('unchanged'):
        return result  # Do not rewrite the previous successful run or add logs.
    data.update(releaseDigest=result['artifactDigest'], revision=result['layoutRevision'], directoryTemplate=result['targetPath'])
    with LOCK, app.store.connect() as db:
        record = db.execute('SELECT record_id FROM runtime_operations WHERE record_id=?', (result['deliveryId'],)).fetchone()
        if record:
            # A fast Runner may claim/report a stage between delivery creation and
            # this history write. Keep that result, enriching its authorized snapshot.
            db.execute('UPDATE runtime_operations SET runtime_id=?,deployment_id=?,assignment_id=?,snapshot_json=?,requested_at=? WHERE record_id=?',
                       ((runtime or {}).get('runtimeId', ''), (runtime or {}).get('deploymentId', ''),
                        (runtime or {}).get('assignmentId', ''), json.dumps(data, ensure_ascii=False), requested_at, result['deliveryId']))
        else:
            insert_record(db, result['deliveryId'], runtime or {'runnerId': runner_id}, 'delivery', data, date=requested_at)
        add_event(db, result['deliveryId'], 'requested', '已提交下发，等待 Runner 接收', date=requested_at)
    return result


def delivery_result(app, result, action):
    with app.store.connect() as db:
        row = db.execute('SELECT status FROM runtime_operations WHERE record_id=?', (result['deliveryId'],)).fetchone()
        if not row:
            return
        status = 'running' if action == 'claim' else 'success' if result['status'] == 'success' else 'failed'
        if row['status'] != status:
            complete(db, result['deliveryId'], status, result.get('error', ''))
            add_event(db, result['deliveryId'], 'received' if action == 'claim' else 'finished',
                      'Runner 已接收下发任务' if action == 'claim' else result.get('error') or '代码下发完成',
                      'error' if status == 'failed' else 'info')


def ingest_event(app, runner_id, payload):
    from .server import ApiError
    event_id, identifier = check_id(payload.get('eventId')), check_id(payload.get('recordId'))
    action = payload.get('action')
    if action not in ('created', 'started', 'failed', 'exited', 'stopped', 'stage', 'retry-paused'):
        raise ApiError('运行事件类型无效')
    date = payload.get('occurredAt') or stamp()
    try:
        if not isinstance(date, str) or len(date) > 50 or datetime.fromisoformat(date).tzinfo is None:
            raise ValueError()
    except ValueError:
        raise ApiError('日志时间无效')
    with LOCK, app.store.connect() as db:
        old_event = db.execute('SELECT * FROM runtime_events WHERE event_id=?', (event_id,)).fetchone()
        record = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (identifier,)).fetchone()
        if record and record['runner_id'] != runner_id:
            raise ApiError('不能上报其他机器的日志', 403)
        if old_event:
            if old_event['record_id'] != identifier or not record:
                raise ApiError('日志事件标识冲突', 409)
            return {'ok': True}
        if action == 'created' and not record and payload.get('kind') == 'runner':
            machine = db.execute('SELECT * FROM runners WHERE runner_id=?', (runner_id,)).fetchone()
            insert_record(db, identifier, {'runnerId': runner_id}, 'runner',
                          {'name': 'Runner 管理日志', 'runnerName': machine['name'], 'ipAddress': machine['ip_address'],
                           'installDirectory': machine['install_directory'], 'runnerVersion': redact(payload.get('runnerVersion'))[:100]}, status='running', date=date)
            record = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (identifier,)).fetchone()
        if action == 'created' and not record:
            assignment = db.execute('SELECT * FROM assignments WHERE assignment_id=? AND runner_id=?', (payload.get('assignmentId', ''), runner_id)).fetchone()
            parent = payload.get('operationId', '')
            owner = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (check_id(parent),)).fetchone() if parent else None
            historical = bool(owner and owner['runner_id'] == runner_id and owner['assignment_id'] == payload.get('assignmentId')
                              and json.loads(owner['snapshot_json']).get('releaseDigest') == payload.get('releaseDigest')
                              and owner['requested_at'] >= (datetime.now(timezone.utc) - timedelta(days=7)).isoformat())
            if (not assignment or assignment['release_digest'] != payload.get('releaseDigest')) and not historical:
                raise ApiError('启动日志与机器分配不匹配', 403)
            from .server import as_assignment
            context = assignment_contexts(app, db, [as_assignment(assignment)])[0] if assignment else {}
            slot = payload.get('slot')
            if type(slot) is not int or not 0 <= slot < 100:
                raise ApiError('并发序号无效')
            runtime = {'runnerId': runner_id, 'runtimeId': context.get('runtimeId', ''),
                       'deploymentId': (context.get('logSnapshot') or {}).get('deploymentId', ''), 'assignmentId': payload['assignmentId']}
            data = context.get('logSnapshot') or {}
            parent = payload.get('operationId') or context.get('operationId', '')
            if parent:
                owner = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (check_id(parent),)).fetchone()
                if not owner or owner['runner_id'] != runner_id or owner['assignment_id'] != payload['assignmentId']:
                    raise ApiError('启动操作归属无效', 403)
                data = json.loads(owner['snapshot_json'])
                if data.get('releaseDigest') != payload.get('releaseDigest'):
                    raise ApiError('启动操作版本与实际代码不一致', 403)
            try:
                actual_policy = retry_policy(payload.get('retryPolicy', context.get('retryPolicy', data.get('retryPolicy'))))
            except ValueError as exc:
                raise ApiError(str(exc), 422) from exc
            if actual_policy not in (retry_policy(context.get('retryPolicy')), retry_policy(data.get('retryPolicy'))):
                raise ApiError('启动日志的重试策略与机器配置不匹配', 403)
            data = {**data, 'retryPolicy': actual_policy}
            runtime['runtimeId'] = data.get('runtimeId') or runtime['runtimeId'] or (owner['runtime_id'] if owner else '')
            runtime['deploymentId'] = data.get('deploymentId', runtime['deploymentId'])
            insert_record(db, identifier, runtime, 'run', data, parent, 'checking', date)
            db.execute('INSERT INTO program_runs VALUES (?,?,?,?,?,?,?,?,?,?)', (identifier, slot, None, '', '', '', None, None, None, ''))
            record = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (identifier,)).fetchone()
        if not record:
            # A claimed delivery is already authorized independently of runtime bindings.
            delivery = db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=? AND runner_id=?', (identifier, runner_id)).fetchone()
            if not delivery:
                raise ApiError('请先上报运行开始记录', 409)
            insert_record(db, identifier, {'runnerId': runner_id}, 'delivery', {'name': delivery['owner_id'], 'directoryTemplate': delivery['target_path']})
            record = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (identifier,)).fetchone()
        if action not in ('stage', 'created') and record['kind'] not in ('run', 'runner'):
            raise ApiError('事件与运行记录类型不一致')
        # Terminal events cannot be reopened by a late start acknowledgement.
        terminal = record['status'] in ('failed', 'stopped', 'exited', 'paused')
        if action == 'started' and not terminal:
            pid = payload.get('pid')
            if type(pid) is not int or not 0 < pid <= 4294967295:
                raise ApiError('进程 ID 无效')
            db.execute('UPDATE program_runs SET pid=?,entry=?,working_directory=?,interpreter=?,started_at=? WHERE run_id=?',
                       (pid, redact(payload.get('entry'))[:2000], redact(payload.get('workingDirectory'))[:2000], redact(payload.get('interpreter'))[:2000], date, identifier))
            complete(db, identifier, 'running')
            startup_result(db, record['parent_id'])
        elif action in ('failed', 'exited', 'stopped', 'retry-paused'):
            code = payload.get('exitCode')
            if code is not None and (type(code) is not int or abs(code) > 4294967295):
                raise ApiError('退出码无效')
            status = {'failed': 'failed', 'stopped': 'stopped', 'retry-paused': 'paused'}.get(action, 'exited' if code == 0 else 'failed')
            complete(db, identifier, status, payload.get('message', '') if status in ('failed', 'paused') else '')
            if action != 'retry-paused':
                # Pausing future attempts is separate from the completed process:
                # keep its actual exit code, exit time, and failure reason.
                db.execute('UPDATE program_runs SET ended_at=?,exit_code=?,reason=? WHERE run_id=?', (date, code, redact(payload.get('message'))[:4000], identifier))
            if action == 'failed' and type(payload.get('pid')) is int:
                db.execute('UPDATE program_runs SET pid=?,entry=?,working_directory=? WHERE run_id=?',
                           (payload['pid'], redact(payload.get('entry'))[:2000], redact(payload.get('workingDirectory'))[:2000], identifier))
            if action == 'retry-paused':
                # Do not pause a newer manual start/version after a delayed upload.
                current = db.execute('SELECT release_digest FROM assignments WHERE assignment_id=? AND runner_id=?', (record['assignment_id'], runner_id)).fetchone()
                latest = db.execute("SELECT record_id FROM runtime_operations WHERE assignment_id=? AND kind='start' ORDER BY requested_at DESC LIMIT 1", (record['assignment_id'],)).fetchone()
                from .deployment_configuration import runtime_rows
                active_runtime = next((row for row in runtime_rows(app, db) if row.get('assignmentId') == record['assignment_id']), None)
                try:
                    pause_policy = retry_policy(payload.get('retryPolicy', json.loads(record['snapshot_json']).get('retryPolicy')))
                except ValueError as exc:
                    raise ApiError(str(exc), 422) from exc
                policy_matches = not active_runtime or pause_policy == active_runtime['retryPolicy']
                if current and policy_matches and current['release_digest'] == json.loads(record['snapshot_json']).get('releaseDigest') and (not latest or latest['record_id'] == record['parent_id']):
                    db.execute('UPDATE assignments SET enabled=0 WHERE assignment_id=?', (record['assignment_id'],))
            if record['parent_id'] and action == 'failed':
                startup_result(db, record['parent_id'])
            if action == 'stopped':
                live = db.execute("SELECT 1 FROM runtime_operations WHERE runtime_id=? AND kind='run' AND status IN ('checking','running')", (record['runtime_id'],)).fetchone()
                if not live:
                    db.execute("UPDATE runtime_operations SET status='success',finished_at=?,updated_at=? WHERE runtime_id=? AND kind='stop' AND status='pending'", (stamp(), stamp(), record['runtime_id']))
        add_event(db, identifier, str(payload.get('stage') or action), payload.get('message') or action,
                  'error' if action in ('failed', 'retry-paused') or payload.get('level') == 'error' else 'info', payload.get('detail', ''), event_id, date)
    return {'ok': True}


def log_root(app):
    # An independent server root; test applications stay isolated in their data directory.
    from .server import RUNTIME, ROOT
    default = ROOT.parent / 'runner-logs' if app.data_dir.resolve() == RUNTIME.resolve() else app.data_dir.parent / 'runner-logs'
    with app.store.connect() as db:
        saved = db.execute("SELECT setting_value FROM settings WHERE setting_key='runtime-log-policy'").fetchone()
    config = json.loads(saved['setting_value']) if saved else {}
    path = Path(config.get('directory') or os.getenv('RUNNER_LOG_DIR', str(default))).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def policy(app, payload=None):
    from .server import ApiError
    with LOCK, app.store.connect() as db:
        saved = db.execute("SELECT setting_value FROM settings WHERE setting_key='runtime-log-policy'").fetchone()
        result = json.loads(saved['setting_value']) if saved else {'directory': str(log_root(app)),
                  'retentionDays': int(os.getenv('RUNNER_LOG_RETENTION_DAYS', '30')), 'quotaMb': int(os.getenv('RUNNER_LOG_QUOTA_MB', '1024'))}
        existing = bool(db.execute('SELECT 1 FROM runtime_log_streams LIMIT 1').fetchone())
        if payload is not None:
            directory = payload.get('directory')
            if not isinstance(directory, str) or not Path(directory).is_absolute():
                raise ApiError('日志目录必须是服务器上的绝对路径')
            directory = Path(directory).resolve()
            if existing and directory != Path(result['directory']).resolve():
                raise ApiError('已有日志时不能直接更换目录，请先迁移并确认历史文件', 409)
            protected = [app.data_dir.resolve(), app.default_site_script_repo.resolve()]
            if any(directory == p or directory.is_relative_to(p) or p.is_relative_to(directory) for p in protected):
                raise ApiError('日志目录必须独立于 Runner 数据目录和代码仓库')
            days, quota = payload.get('retentionDays'), payload.get('quotaMb')
            if type(days) is not int or not 1 <= days <= 365 or type(quota) is not int or not 64 <= quota <= 1048576:
                raise ApiError('保留天数须为 1–365，容量须为 64–1048576 MB')
            directory.mkdir(parents=True, exist_ok=True)
            result = {'directory': str(directory), 'retentionDays': days, 'quotaMb': quota}
            db.execute("DELETE FROM settings WHERE setting_key='runtime-log-policy'")
            db.execute('INSERT INTO settings VALUES (?,?)', ('runtime-log-policy', json.dumps(result)))
        return {**result, 'hasLogs': existing}


def stream_dir(app, identifier):
    root = log_root(app)
    target = root / check_id(identifier)
    if target.is_symlink() or (target.exists() and not target.resolve().is_relative_to(root)):
        from .server import ApiError
        raise ApiError('日志目录无效', 409)
    target.mkdir(exist_ok=True)
    return target


def ingest_logs(app, runner_id, payload):
    from .server import ApiError
    stream_id, record_id = check_id(payload.get('streamId')), check_id(payload.get('recordId'))
    seq = payload.get('seq')
    entries = payload.get('entries')
    if type(seq) is not int or seq < 1 or not isinstance(entries, list) or not 1 <= len(entries) <= 200:
        raise ApiError('日志批次无效')
    cleaned = []
    for line in entries:
        if not isinstance(line, dict) or not isinstance(line.get('text'), str) or len(line['text']) > 16000:
            raise ApiError('日志行无效')
        cleaned.append({'text': redact(line['text']), 'time': str(line.get('time') or stamp())[:50],
                        'source': line.get('source') if line.get('source') in ('stdout', 'stderr') else 'console'})
    encoded = json.dumps({'seq': seq, 'entries': cleaned}, ensure_ascii=False).encode('utf-8')
    if len(encoded) > 128 * 1024:
        raise ApiError('日志批次超过 128 KB', 413)
    with LOCK, app.store.connect() as db:
        record = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (record_id,)).fetchone()
        if not record or record['runner_id'] != runner_id:
            raise ApiError('日志不属于此机器的运行记录', 403)
        row = db.execute('SELECT * FROM runtime_log_streams WHERE stream_id=?', (stream_id,)).fetchone()
        if row and (row['runner_id'] != runner_id or row['record_id'] != record_id):
            raise ApiError('日志流归属冲突', 403)
        previous = row['last_seq'] if row else 0
        if seq <= previous:
            return {'ack': previous}
        if seq != previous + 1:
            raise ApiError('日志序号不连续，请补传缺失批次', 409)
        directory = stream_dir(app, stream_id)
        # Hard server quota keeps a noisy script from filling the disk.
        quota = policy(app)['quotaMb'] * 1024 * 1024
        total = db.execute('SELECT SUM(byte_count) AS total FROM runtime_log_streams').fetchone()['total'] or 0
        if total + len(encoded) > quota:
            raise ApiError('服务器日志容量已满，请清理或扩大日志容量', 507)
        target = directory / f'{seq:012d}.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_bytes(encoded); os.replace(temporary, target)
        if row:
            db.execute('UPDATE runtime_log_streams SET last_seq=?,byte_count=byte_count+?,updated_at=? WHERE stream_id=?', (seq, len(encoded), stamp(), stream_id))
        else:
            db.execute('INSERT INTO runtime_log_streams VALUES (?,?,?,?,?,?)', (stream_id, record_id, runner_id, seq, len(encoded), stamp()))
    return {'ack': seq}


def as_record(row):
    return {'recordId': row['record_id'], 'runnerId': row['runner_id'], 'runtimeId': row['runtime_id'],
            'deploymentId': row['deployment_id'], 'assignmentId': row['assignment_id'], 'parentId': row['parent_id'],
            'kind': row['kind'], 'status': row['status'], 'requestedAt': row['requested_at'], 'updatedAt': row['updated_at'],
            'finishedAt': row['finished_at'], 'error': row['error'], 'snapshot': json.loads(row['snapshot_json'])}


def decorate(db, item):
    runner = db.execute('SELECT status,last_heartbeat,capabilities,worker_processes FROM runners WHERE runner_id=?', (item['runnerId'],)).fetchone()
    item['lastHeartbeat'] = runner['last_heartbeat'] if runner else None
    item['logAvailable'] = bool(runner and 'runtime-logs' in json.loads(runner['capabilities']))
    if item['kind'] in ('run', 'runner') and item['status'] in ('checking', 'running'):
        if not runner or runner['status'] == 'offline':
            item['status'] = 'unknown'
        elif item['kind'] == 'run' and item['status'] == 'running':
            run = db.execute('SELECT pid FROM program_runs WHERE run_id=?', (item['recordId'],)).fetchone()
            processes = json.loads(runner['worker_processes'] or '[]')
            if run and run['pid'] and not any(p['pid'] == run['pid'] and p['assignmentId'] == item['assignmentId'] for p in processes):
                item['status'] = 'unknown'
    return item


def list_records(app, query):
    from .server import ApiError
    one = lambda name, default='': (query.get(name) or [default])[0]
    try:
        page, size = max(1, int(one('page', '1'))), min(100, max(1, int(one('pageSize', '20'))))
    except ValueError:
        raise ApiError('日志分页无效')
    where, args = [], []
    for name, column in (('runnerId', 'runner_id'), ('runtimeId', 'runtime_id'), ('assignmentId', 'assignment_id'), ('kind', 'kind')):
        if one(name):
            where.append(column + '=?'); args.append(one(name))
    process = []
    for name, column, lower, upper in (('processPid', 'pid', 1, 4294967295), ('processSlot', 'slot', 0, 99)):
        if one(name):
            try:
                value = int(one(name))
                if not lower <= value <= upper:
                    raise ValueError()
            except ValueError:
                raise ApiError('日志进程筛选无效')
            process.append('p.' + column + '=?'); args.append(value)
    if process:
        where.append("kind='run' AND EXISTS (SELECT 1 FROM program_runs p WHERE p.run_id=record_id AND " + ' AND '.join(process) + ')')
    # Filter by the same observed state the detail displays, including a missing PID
    # on an otherwise online Runner. Keep the count/pagination consistent with it.
    uncertain = []
    if one('status') in ('unknown', 'running', 'checking'):
        with app.store.connect() as db:
            active = db.execute("SELECT * FROM runtime_operations WHERE kind IN ('run','runner') AND status IN ('running','checking')").fetchall()
            uncertain = [r['record_id'] for r in active if decorate(db, as_record(r))['status'] == 'unknown']
    if one('status') == 'unknown':
        pending_observation = 'record_id IN (' + ','.join('?' for _ in uncertain) + ')' if uncertain else '1=0'
        where.append("(status='unknown' OR (" + pending_observation + ") "
                     "OR (kind='delivery' AND status IN ('pending','running') AND EXISTS "
                     "(SELECT 1 FROM directory_deliveries d WHERE d.delivery_id=record_id AND d.status='failed')))")
        args.extend(uncertain)
    elif one('status'):
        where.append('status=?'); args.append(one('status'))
        if uncertain:
            where.append('record_id NOT IN (' + ','.join('?' for _ in uncertain) + ')'); args.extend(uncertain)
    since = one('since', (datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
    if since:
        where.append('requested_at>=?'); args.append(since)
    if one('until'):
        where.append('requested_at<=?'); args.append(one('until'))
    if one('keyword'):
        # Values remain bound SQL parameters, including user-entered wildcard characters.
        where.append('snapshot_json LIKE ?'); args.append('%' + one('keyword')[:200] + '%')
    sql = ' WHERE ' + ' AND '.join(where) if where else ''
    with app.store.connect() as db:
        count = db.execute('SELECT COUNT(*) AS total FROM runtime_operations' + sql, args).fetchone()['total']
        rows = db.execute('SELECT * FROM runtime_operations' + sql + ' ORDER BY requested_at DESC,record_id DESC LIMIT ? OFFSET ?', (*args, size, (page - 1) * size)).fetchall()
        items = [decorate(db, as_record(row)) for row in rows]
        for item in items:
            if item['kind'] == 'delivery':
                delivery = db.execute('SELECT status,error FROM directory_deliveries WHERE delivery_id=?', (item['recordId'],)).fetchone()
                if delivery and delivery['status'] == 'failed' and item['status'] in ('pending', 'running'):
                    item['status'], item['error'] = 'unknown', delivery['error']
    return {'items': items, 'total': count, 'page': page, 'pageSize': size}


def detail(app, identifier):
    from .server import ApiError
    check_id(identifier)
    with app.store.connect() as db:
        row = db.execute('SELECT * FROM runtime_operations WHERE record_id=?', (identifier,)).fetchone()
        if not row:
            raise ApiError('运行记录不存在', 404)
        item = decorate(db, as_record(row))
        events = db.execute('SELECT * FROM runtime_events WHERE record_id=? ORDER BY occurred_at,event_id', (identifier,)).fetchall()
        item['events'] = [{'eventId': r['event_id'], 'time': r['occurred_at'], 'stage': r['stage'], 'level': r['level'], 'message': r['message'], 'detail': r['detail']} for r in events]
        item['streams'] = [{'streamId': r['stream_id'], 'lastSeq': r['last_seq'], 'byteCount': r['byte_count'], 'updatedAt': r['updated_at']} for r in db.execute('SELECT * FROM runtime_log_streams WHERE record_id=?', (identifier,)).fetchall()]
        run = db.execute('SELECT * FROM program_runs WHERE run_id=?', (identifier,)).fetchone()
        item['run'] = dict(run) if run else None
        item['runs'] = [decorate(db, as_record(r)) for r in db.execute('SELECT * FROM runtime_operations WHERE parent_id=? ORDER BY requested_at', (identifier,)).fetchall()]
        return item


def read_entries(app, identifier, query):
    from .server import ApiError
    check_id(identifier)
    try:
        cursor = int((query.get('cursor') or ['0'])[0])
        before = int((query.get('before') or ['0'])[0])
    except ValueError:
        raise ApiError('日志游标无效')
    with app.store.connect() as db:
        row = db.execute('SELECT * FROM runtime_log_streams WHERE stream_id=?', (identifier,)).fetchone()
        if not row:
            raise ApiError('日志流不存在', 404)
    files = sorted(stream_dir(app, identifier).glob('*.json'))
    last = row['last_seq']
    files = [p for p in files if int(p.stem) <= last]
    earliest = int(files[0].stem) if files else 0
    if cursor > 0:
        files = [p for p in files if cursor < int(p.stem) <= last][:8]
    elif before > 0:
        files = [p for p in files if int(p.stem) < before][-8:]
    else:
        files = [p for p in files if int(p.stem) <= last][-8:]
    entries = []
    for p in files:
        if p.is_symlink():
            raise ApiError('日志文件无效', 409)
        data = json.loads(p.read_text(encoding='utf-8'))
        entries.extend([{**line, 'seq': data['seq'], 'index': i} for i, line in enumerate(data['entries'])])
    return {'entries': entries, 'cursor': int(files[-1].stem) if files else cursor,
            'firstCursor': int(files[0].stem) if files else 0, 'lastSeq': last,
            'earliestSeq': earliest, 'expired': row['byte_count'] == 0 and last > 0,
            'hasEarlier': bool(files and earliest < int(files[0].stem))}


def download(app, identifier):
    from .server import ApiError
    check_id(identifier)
    with app.store.connect() as db:
        stream = db.execute('SELECT last_seq FROM runtime_log_streams WHERE stream_id=?', (identifier,)).fetchone()
        if not stream:
            raise ApiError('日志流不存在', 404)
    # Bounded downloads; a large log can still be browsed by cursor.
    output, count = [], 0
    for p in sorted(stream_dir(app, identifier).glob('*.json')):
        if int(p.stem) > stream['last_seq']:
            continue
        if p.is_symlink():
            raise ApiError('日志文件无效', 409)
        for line in json.loads(p.read_text(encoding='utf-8'))['entries']:
            text = f"{line['time']} [{line['source']}] {line['text']}\n"
            count += len(text.encode('utf-8'))
            if count > 20 * 1024 * 1024:
                raise ApiError('日志超过单次下载 20 MB，请按时间分段查看', 413)
            output.append(text)
    return {'name': identifier + '.log', 'content': ''.join(output)}


def cleanup(app):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=policy(app)['retentionDays'])).isoformat()
    with LOCK, app.store.connect() as db:
        rows = db.execute('SELECT stream_id FROM runtime_log_streams WHERE updated_at<? AND byte_count>0', (cutoff,)).fetchall()
        for row in rows:
            directory = stream_dir(app, row['stream_id'])
            for p in directory.glob('*.json'):
                if not p.is_symlink():
                    p.unlink()
            db.execute('UPDATE runtime_log_streams SET byte_count=0 WHERE stream_id=?', (row['stream_id'],))
        old = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        ids = db.execute("SELECT record_id FROM runtime_operations WHERE updated_at<? AND status NOT IN ('pending','running','checking') "
                         "AND NOT EXISTS (SELECT 1 FROM runtime_log_streams s WHERE s.record_id=runtime_operations.record_id AND s.byte_count>0)", (old,)).fetchall()
        for row in ids:
            db.execute('DELETE FROM runtime_log_streams WHERE record_id=? AND byte_count=0', (row['record_id'],))
            db.execute('DELETE FROM runtime_events WHERE record_id=?', (row['record_id'],))
            db.execute('DELETE FROM program_runs WHERE run_id=?', (row['record_id'],))
            db.execute('DELETE FROM runtime_operations WHERE record_id=?', (row['record_id'],))
