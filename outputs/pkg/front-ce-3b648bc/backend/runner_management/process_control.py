"""Stop one reported worker slot without changing other slots or the Runner."""
import json
import uuid
from .runtime_history import add_event, complete, insert_record, redact, stamp

PREFIX = 'processor-stop:'
START_PREFIX = 'processor-start:'


def generation(assignment):
    return assignment['releaseDigest'] + ':' + assignment.get('processGeneration', '')


def epochs(db):
    return {row['setting_key'][len(START_PREFIX):]: row['setting_value']
            for row in db.execute('SELECT setting_key,setting_value FROM settings WHERE setting_key LIKE ?', (START_PREFIX + '%',))}


def new_start(db, assignment_id):
    # Advance only after start validation succeeds, in the assignment transaction.
    key, value = START_PREFIX + assignment_id, uuid.uuid4().hex
    if db.execute('SELECT 1 FROM settings WHERE setting_key=?', (key,)).fetchone():
        db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (value, key))
    else:
        db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)', (key, value))


def commands(db):
    return [json.loads(row['setting_value']) for row in db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', (PREFIX + '%',))]


def save(db, command):
    key, value = PREFIX + command['requestId'], json.dumps(command, ensure_ascii=False)
    if db.execute('SELECT 1 FROM settings WHERE setting_key=?', (key,)).fetchone():
        db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (value, key))
    else:
        db.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?)', (key, value))


def attach(db, assignments):
    stops, starts = commands(db), epochs(db)
    for row in assignments:
        row['processGeneration'] = starts.get(row['assignmentId'], '')
        row['processStops'] = [item for item in stops if item['runnerId'] == row['runnerId']
                               and item['assignmentId'] == row['assignmentId']
                               and item['generation'] == generation(row) and item['status'] in ('pending', 'applied')]
    return assignments


def runtime_slots(db, rows):
    stops, starts = commands(db), epochs(db)
    for row in rows:
        assignment = row.get('assignment')
        current = generation({**assignment, 'processGeneration': starts.get(assignment['assignmentId'], '')}) if assignment else ''
        row['stoppedProcessSlots'] = sorted({item['slot'] for item in stops if assignment
                                            and item['assignmentId'] == assignment['assignmentId']
                                            and item['runnerId'] == row['runnerId'] and item['generation'] == current
                                            and item['status'] == 'applied' and item['slot'] < assignment['concurrency']})
    return rows


def listing(app):
    from .server import as_runner, as_assignment, ASSIGNMENT_SELECT
    from .runtime_history import assignment_contexts
    app.expire_stale_runners()
    with app.store.connect() as db:
        runners = [as_runner(row) for row in db.execute('SELECT * FROM runners ORDER BY ip_address,install_directory')]
        contexts = assignment_contexts(app, db, [as_assignment(row) for row in db.execute(ASSIGNMENT_SELECT)])
        by_assignment = {row['assignmentId']: row for row in contexts}
        stops = commands(db)
        items = []
        for runner in runners:
            for worker in runner['workerProcesses'] or []:
                assignment = by_assignment.get(worker['assignmentId'])
                if not assignment or assignment['runnerId'] != runner['runnerId']:
                    continue
                relevant = sorted([item for item in stops if item['runnerId'] == runner['runnerId']
                                   and item['assignmentId'] == worker['assignmentId'] and item['slot'] == worker['slot']
                                   and item['pid'] == worker['pid'] and item['generation'] == generation(assignment)],
                                  key=lambda item: item['requestedAt'], reverse=True)
                command = relevant[0] if relevant else None
                run = db.execute("SELECT o.record_id FROM runtime_operations o JOIN program_runs p ON p.run_id=o.record_id "
                                 "WHERE o.runner_id=? AND o.assignment_id=? AND o.kind='run' AND p.slot=? AND p.pid=? "
                                 "ORDER BY o.requested_at DESC,o.record_id DESC LIMIT 1",
                                 (runner['runnerId'], worker['assignmentId'], worker['slot'], worker['pid'])).fetchone()
                items.append({**worker, 'runnerId': runner['runnerId'], 'runtimeId': assignment.get('runtimeId', ''),
                              'runId': run['record_id'] if run else '',
                              'generation': generation(assignment),
                              'stopStatus': command['status'] if command else '', 'stopError': command.get('error', '') if command else ''})
    return {'runners': runners, 'items': items}


def request_stop(app, runner_id, payload):
    from .server import ApiError, GIT_LOCK, as_assignment, ASSIGNMENT_SELECT
    from .runtime_history import assignment_contexts
    slot, pid = payload.get('slot'), payload.get('pid')
    assignment_id = payload.get('assignmentId')
    if type(slot) is not int or not 0 <= slot < 100 or type(pid) is not int or pid <= 0 or not isinstance(assignment_id, str):
        raise ApiError('处理进程标识无效')
    app.expire_stale_runners()
    with GIT_LOCK, app.store.connect() as db:
        runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (runner_id,)).fetchone()
        if not runner or runner['status'] == 'offline':
            raise ApiError('Runner 实例已离线，请刷新后重试', 409)
        if 'process-control' not in json.loads(runner['capabilities']):
            raise ApiError('此 Runner 不支持单进程关闭，请先升级 Runner', 422)
        row = db.execute(ASSIGNMENT_SELECT + 'WHERE x.assignment_id=? AND x.runner_id=?', (assignment_id, runner_id)).fetchone()
        if not row or not row['enabled'] or slot >= row['concurrency']:
            raise ApiError('处理程序配置已变化，请刷新后重试', 409)
        reported = json.loads(runner['worker_processes'] or '[]')
        worker = next((item for item in reported if item['assignmentId'] == assignment_id and item['slot'] == slot and item['pid'] == pid), None)
        if not worker or pid == runner['runner_pid']:
            raise ApiError('进程已退出或 PID 已变化，请刷新后重试', 409)
        assignment = assignment_contexts(app, db, [as_assignment(row)])[0]
        current = generation(assignment)
        if payload.get('generation') != current:
            raise ApiError('启动配置已变化，请刷新后重试', 409)
        previous = next((item for item in commands(db) if item['runnerId'] == runner_id
                         and item['assignmentId'] == assignment_id and item['slot'] == slot and item['pid'] == pid
                         and item['generation'] == current and item['status'] in ('pending', 'applied')), None)
        if previous:
            return previous
        command = {'requestId': uuid.uuid4().hex, 'runnerId': runner_id, 'assignmentId': assignment_id,
                   'slot': slot, 'pid': pid, 'generation': current, 'status': 'pending', 'requestedAt': stamp(), 'error': ''}
        save(db, command)
        runtime = {'runnerId': runner_id, 'runtimeId': assignment.get('runtimeId', ''), 'assignmentId': assignment_id,
                   'deploymentId': assignment.get('logSnapshot', {}).get('deploymentId', '')}
        data = {**assignment.get('logSnapshot', {}), 'runnerName': runner['name'], 'ipAddress': runner['ip_address'],
                'installDirectory': runner['install_directory'], 'queue': row['queue'], 'entryPoint': worker.get('entry', ''),
                'processPid': pid, 'processSlot': slot}
        insert_record(db, command['requestId'], runtime, 'stop', data)
        add_event(db, command['requestId'], 'requested', f'请求关闭处理进程 PID {pid}（并发 {slot + 1}），其他进程保持运行')
    return command


def acknowledge(app, runner_id, request_id, payload):
    from .server import ApiError, GIT_LOCK
    if payload.get('status') not in ('applied', 'failed'):
        raise ApiError('进程关闭结果无效')
    with GIT_LOCK, app.store.connect() as db:
        row = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + request_id,)).fetchone()
        if not row:
            raise ApiError('进程关闭指令不存在', 404)
        command = json.loads(row['setting_value'])
        if command['runnerId'] != runner_id:
            raise ApiError('进程关闭指令不属于此 Runner', 403)
        if command['status'] != 'pending':
            return command
        command.update(status=payload['status'], error=redact(payload.get('error'))[:1000], finishedAt=stamp())
        save(db, command)
        successful = command['status'] == 'applied'
        complete(db, request_id, 'success' if successful else 'failed', command['error'])
        add_event(db, request_id, 'stopped' if successful else 'failed',
                  f"处理进程 PID {command['pid']} 已关闭，手动启动机器配置后恢复" if successful else command['error'],
                  'info' if successful else 'error')
    return command


def apply_stops(runner, assignments):
    blocked = set()
    for assignment in assignments:
        for command in assignment.get('processStops', []):
            if command.get('generation') != generation(assignment):
                continue
            slot = command['slot']
            key = assignment['assignmentId'] if slot == 0 else f"{assignment['assignmentId']}:{slot}"
            item = runner.processes.get(key)
            if command['status'] == 'pending':
                if item and item[1].pid != command['pid']:
                    runner.post(f"/api/runners/me/process-stops/{command['requestId']}/result",
                                {'status': 'failed', 'error': 'PID 已变化，未关闭替代进程，请刷新后重试'})
                    continue
                try:
                    runner.stop(key, timeout=3)
                except Exception as exc:
                    runner.post(f"/api/runners/me/process-stops/{command['requestId']}/result",
                                {'status': 'failed', 'error': '关闭进程失败：' + (str(exc) or type(exc).__name__)})
                    continue
                runner.post(f"/api/runners/me/process-stops/{command['requestId']}/result", {'status': 'applied'})
            blocked.add(key)
    return blocked
