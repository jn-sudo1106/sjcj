"""Small execution facts extracted on log upload, queried in one batch by task lists."""
import json
import re
from . import runtime_history as history

MARKER = re.compile(r'(?:^|\s)(?:(?:INFO|ERROR)\s+)?任务\s+([A-Za-z0-9_-]{1,128})(?=\s|[：:])')
TASK_ID = re.compile(r'[A-Za-z0-9_-]{1,128}')


def index_batch(db, record, stream_id, seq, entries):
    if record['kind'] != 'run':
        return 0
    snapshot = json.loads(record['snapshot_json'])
    count = 0
    for index, line in enumerate(entries):
        match = MARKER.search(line['text'])
        if not match:
            continue
        task_id, message = match.group(1), line['text'][match.end():]
        status = 'failed' if '执行失败' in message else 'completed' if re.match(r'\s*完成[：:]', message) else 'observed'
        old = db.execute('SELECT seq,line_index,status FROM business_task_executions WHERE task_id=? AND record_id=? AND stream_id=?',
                         (task_id, record['record_id'], stream_id)).fetchone()
        if old and (old['seq'], old['line_index']) >= (seq, index):
            continue
        if old and status == 'observed' and not re.match(r'\s*·\s*配置\s', message):
            status = old['status']
        values = (seq, index, line.get('time', ''), status, str(snapshot.get('queue') or '')[:256],
                  str(snapshot.get('configId') or '')[:20], task_id, record['record_id'], stream_id)
        if old:
            db.execute('UPDATE business_task_executions SET seq=?,line_index=?,occurred_at=?,status=?,topic=?,config_id=? WHERE task_id=? AND record_id=? AND stream_id=?', values)
        else:
            db.execute('INSERT INTO business_task_executions (seq,line_index,occurred_at,status,topic,config_id,task_id,record_id,stream_id) VALUES (?,?,?,?,?,?,?,?,?)', values)
        count += 1
    return count


def listing(app, payload):
    from .server import ApiError
    tasks = payload.get('tasks') if isinstance(payload, dict) else None
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= 200:
        raise ApiError('任务列表须包含 1–200 条任务')
    requested = {}
    for item in tasks:
        if not isinstance(item, dict) or not isinstance(item.get('taskId'), str) or not TASK_ID.fullmatch(item['taskId']):
            raise ApiError('任务 ID 无效')
        topic = item.get('topic', '')
        if not isinstance(topic, str) or len(topic) > 256:
            raise ApiError('任务队列无效')
        requested.setdefault(item['taskId'], set()).add(topic)
    with app.store.connect() as db:
        rows = db.execute('SELECT e.*,o.runner_id,o.runtime_id,o.deployment_id,o.snapshot_json,p.pid,p.entry '
                          'FROM business_task_executions e JOIN runtime_operations o ON o.record_id=e.record_id '
                          'JOIN program_runs p ON p.run_id=e.record_id WHERE e.task_id IN (' + ','.join('?' for _ in requested) + ') '
                          'ORDER BY e.occurred_at DESC,e.seq DESC,e.line_index DESC', tuple(requested)).fetchall()
    result = {task_id: [] for task_id in requested}
    for row in rows:
        topics = requested[row['task_id']]
        if '' not in topics and row['topic'] and row['topic'] not in topics:
            continue
        snapshot = json.loads(row['snapshot_json'])
        result[row['task_id']].append({
            'recordId': row['record_id'], 'runnerId': row['runner_id'], 'runtimeId': row['runtime_id'],
            'deploymentId': row['deployment_id'], 'streamId': row['stream_id'], 'pid': row['pid'], 'entry': row['entry'],
            'machine': snapshot.get('ipAddress') or snapshot.get('runnerName') or row['runner_id'],
            'runnerName': snapshot.get('runnerName', ''), 'instanceDirectory': snapshot.get('installDirectory', ''),
            'status': row['status'], 'time': row['occurred_at'], 'seq': row['seq'], 'index': row['line_index']})
    return {'items': result}


def backfill(app):
    """Explicit maintenance action, never called by a list request or service startup."""
    with app.store.connect() as db:
        streams = db.execute("SELECT o.*,s.stream_id,s.last_seq FROM runtime_operations o JOIN runtime_log_streams s "
                             "ON s.record_id=o.record_id WHERE o.kind='run'").fetchall()
    counts = {'streams': len(streams), 'batches': 0, 'events': 0}
    for record in streams:
        directory = history.stream_dir(app, history.check_id(record['stream_id']))
        with history.LOCK, app.store.connect() as db:
            for path in sorted(directory.glob('*.json')):
                if path.is_symlink() or not re.fullmatch(r'[0-9]{12}', path.stem) or int(path.stem) > record['last_seq']:
                    continue
                try:
                    batch = json.loads(path.read_text(encoding='utf8'))
                except FileNotFoundError:
                    continue
                counts['events'] += index_batch(db, record, record['stream_id'], int(path.stem), batch['entries'])
                counts['batches'] += 1
    return counts
