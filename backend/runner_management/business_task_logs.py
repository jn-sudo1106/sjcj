"""Locate actual business-task execution in captured program output."""
import json
import re
from . import runtime_history as history

MAX_BYTES = 32 * 1024 * 1024
MAX_BATCHES = 2000


def executions(app, query):
    from .server import ApiError
    one = lambda key: (query.get(key) or [''])[0]
    task_id, topic, config_id = one('taskId'), one('topic'), one('configId')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', task_id):
        raise ApiError('任务 ID 无效')
    if len(topic) > 256 or (config_id and not re.fullmatch(r'[1-9][0-9]{0,19}', config_id)):
        raise ApiError('任务查询条件无效')
    marker = re.compile(r'(?:^|\s)(?:(?:INFO|ERROR)\s+)?任务\s+' + re.escape(task_id) + r'(?=\s|[：:])')
    with app.store.connect() as db:
        rows = db.execute("SELECT o.*,p.pid,p.entry,s.log_id AS stream_id,s.seq AS last_seq FROM runtime_operations o "
                          "JOIN program_runs p ON p.run_id=o.record_id "
                          "JOIN logs s ON s.log_type='stream' AND s.record_id=o.record_id "
                          "WHERE o.kind='run' ORDER BY s.updated_at DESC LIMIT 101").fetchall()
    items, used, batches, exhausted = [], 0, 0, False
    truncated = len(rows) > 100
    for row in rows[:100]:
        snapshot = json.loads(row['snapshot_json'])
        if topic and snapshot.get('queue') and topic != snapshot['queue']: continue
        if config_id and snapshot.get('configId') and config_id != str(snapshot['configId']): continue
        found = None
        directory = history.stream_dir(app, history.check_id(row['stream_id']))
        files = sorted((p for p in directory.glob('*.json') if re.fullmatch(r'[0-9]{12}', p.stem)
                        and int(p.stem) <= row['last_seq']), reverse=True)
        for path in files:
            if path.is_symlink(): continue
            try:
                size = path.stat().st_size
                if used + size > MAX_BYTES or batches >= MAX_BATCHES:
                    truncated = True; exhausted = True; break
                used += size; batches += 1
                batch = json.loads(path.read_text(encoding='utf8'))
            except FileNotFoundError: continue  # retention cleanup may run concurrently
            for index, line in reversed(list(enumerate(batch['entries']))):
                text = line['text']
                match = marker.search(text)
                if not match: continue
                message = text[match.end():]
                if found is None:
                    found = {'recordId': row['record_id'], 'runnerId': row['runner_id'],
                             'streamId': row['stream_id'], 'pid': row['pid'], 'entry': row['entry'],
                             'machine': snapshot.get('ipAddress') or snapshot.get('runnerName') or row['runner_id'],
                             'instanceDirectory': snapshot.get('installDirectory', ''),
                             'status': 'failed' if '执行失败' in message else 'completed' if re.match(r'\s*完成[：:]', message) else 'observed',
                             'time': line.get('time', ''), 'seq': int(path.stem), 'index': index}
                found.update(seq=int(path.stem), index=index)
                if re.match(r'\s*·\s*配置\s', message): break
            else: continue
            break  # latest attempt's start found; leave subsequent attempts separate
        if found: items.append(found)
        if exhausted: break
    return {'taskId': task_id, 'items': items, 'truncated': truncated}
