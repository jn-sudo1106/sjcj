"""Persist generated-file provenance; these rows do not select executable code."""
import hashlib
import json
import re
from datetime import datetime, timezone

COLUMNS = ('relation_id', 'source_id', 'flow_id', 'flow_version_id', 'step_id', 'config_id', 'task_id', 'archive_id',
           'repo_id', 'directory_id', 'file_path', 'git_commit', 'sha256', 'server_id', 'server_path', 'queue_name',
           'archive_status', 'pushed', 'created_at', 'latest_task_id', 'latest_task_created_at')

OWNER_WHERE = 'source_id=? AND flow_id=? AND step_id=? AND config_id=?'


def task_stamp(value):
    if not value:
        return ''
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).isoformat(timespec='microseconds')


def advance_latest(db, context, config_id, task_id, created_at):
    stamp = task_stamp(created_at)
    if not task_id or not stamp:
        return
    # A slow older job must never replace the latest submission with its completion.
    db.execute('UPDATE source_code_relations SET latest_task_id=?,latest_task_created_at=? WHERE ' + OWNER_WHERE
               + ' AND (latest_task_created_at<? OR (latest_task_created_at=? AND latest_task_id<?))',
               (task_id, stamp, context['sourceId'], context['flowId'], context['stepId'], config_id, stamp, stamp, task_id))


def note_task(db, job):
    advance_latest(db, job, job['configId'], job['taskId'], job.get('createdAt', ''))


def sync_latest(db, context, archive):
    owner = (context['sourceId'], context['flowId'], context['stepId'], archive['configId'])
    existing = db.execute('SELECT latest_task_id,latest_task_created_at FROM source_code_relations WHERE ' + OWNER_WHERE
                          + ' ORDER BY latest_task_created_at DESC,latest_task_id DESC LIMIT 1', owner).fetchone()
    candidates = [(existing['latest_task_created_at'], existing['latest_task_id'])] if existing else []
    jobs = db.execute('SELECT task_id,created_at,payload FROM generation_jobs WHERE source_id=? AND flow_id=? AND config_id=?',
                      (context['sourceId'], context['flowId'], archive['configId'])).fetchall()
    found_origin = False
    for row in jobs:
        job = json.loads(row['payload'])
        if job.get('stepId') != context['stepId']:
            continue
        created_at = row['created_at'] or job.get('createdAt', '')
        if row['task_id'] == archive.get('taskId'):
            found_origin = True
            created_at = created_at or archive.get('createdAt', '')
        candidates.append((task_stamp(created_at), row['task_id']))
    if not found_origin and not any(stamp for stamp, _ in candidates):
        candidates.append((task_stamp(archive.get('createdAt', '')), archive.get('taskId', '')))
    stamp, task_id = max(candidates, default=('', ''))
    advance_latest(db, context, archive['configId'], task_id, stamp)


def source_context(value):
    from .server import ApiError
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ApiError('代码来源须包含源、流程及节点 ID')
    result = {name: str(value.get(name) or '') for name in ('sourceId', 'flowId', 'stepId')}
    if any(not re.fullmatch(r'[1-9][0-9]{0,19}', item) for item in result.values()):
        raise ApiError('请提供有效的代码来源源、流程及节点 ID')
    result['flowVersionId'] = str(value.get('flowVersionId') or '')
    if len(result['flowVersionId']) > 80:
        raise ApiError('流程版本 ID 过长')
    return result


def sync_archive(db, archive):
    """Called in the same transaction as the archive receipt; safe on commit retry."""
    context = archive.get('sourceContext')
    if not context and archive.get('taskId'):
        job = db.execute('SELECT payload FROM generation_jobs WHERE task_id=?', (archive['taskId'],)).fetchone()
        record = json.loads(job['payload']) if job else {}
        if record.get('configId') == archive.get('configId'):
            context = {name: record.get(name, '') for name in ('sourceId', 'flowId', 'stepId', 'flowVersionId')}
    if not context or not archive.get('archiveId') or not archive.get('repoId'):
        return 0
    context = source_context(context)
    from .generated_archives import public
    files = public(archive).get('files') or []
    count = 0
    for file in files:
        path = file.get('path')
        if not isinstance(path, str) or not path:
            continue
        identity = [context['sourceId'], context['flowId'], context['stepId'], archive['configId'],
                    archive['archiveId'], archive['repoId'], path]
        relation_id = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        values = (relation_id, context['sourceId'], context['flowId'], context['flowVersionId'], context['stepId'],
                  archive['configId'], archive.get('taskId', ''), archive['archiveId'], archive['repoId'], archive.get('directoryId', ''),
                  path, archive.get('gitCommit', ''), file.get('sha256', ''), archive.get('serverId', ''), file.get('serverPath', ''),
                  archive.get('queueName', ''), archive.get('status', ''), int(bool(archive.get('pushed'))), archive.get('createdAt', ''), '', '')
        db.execute('INSERT OR IGNORE INTO source_code_relations (' + ','.join(COLUMNS) + ') VALUES (' + ','.join('?' for _ in values) + ')', values)
        db.execute('UPDATE source_code_relations SET git_commit=?,sha256=?,server_path=?,archive_status=?,pushed=? WHERE relation_id=?',
                   (archive.get('gitCommit', ''), file.get('sha256', ''), file.get('serverPath', ''), archive.get('status', ''), int(bool(archive.get('pushed'))), relation_id))
        count += 1
    sync_latest(db, context, archive)
    return count


def listing(app, query):
    from .server import ApiError
    try:
        page, size = int(query.get('page') or 1), int(query.get('size') or 20)
    except (TypeError, ValueError):
        raise ApiError('分页参数无效')
    if page < 1 or not 1 <= size <= 100:
        raise ApiError('分页参数无效')
    clauses, values = [], []
    for name, column in (('sourceId', 'source_id'), ('flowId', 'flow_id'), ('stepId', 'step_id'), ('configId', 'config_id'),
                         ('taskId', 'task_id'), ('latestTaskId', 'latest_task_id'), ('archiveId', 'archive_id'), ('repositoryId', 'repo_id'), ('filePath', 'file_path')):
        value = query.get(name) or ''
        if not isinstance(value, str) or len(value) > (2000 if name == 'filePath' else 80):
            raise ApiError('关联查询条件无效')
        if value:
            clauses.append(column + '=?'); values.append(value)
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    with app.store.connect() as db:
        total = db.execute('SELECT COUNT(*) AS total FROM source_code_relations' + where, values).fetchone()['total']
        rows = db.execute('SELECT ' + ','.join(COLUMNS) + ' FROM source_code_relations' + where
                          + ' ORDER BY created_at DESC,relation_id DESC LIMIT ? OFFSET ?', values + [size, (page - 1) * size]).fetchall()
    def camel(name):
        first, *rest = name.split('_')
        return first + ''.join(part.title() for part in rest)
    items = [{camel(key): bool(row[key]) if key == 'pushed' else row[key] for key in COLUMNS} for row in rows]
    return {'items': items, 'total': total}


def backfill(app):
    """Explicit, idempotent migration using recorded task -> archive IDs only."""
    from .generated_archives import PREFIX
    count, skipped = 0, 0
    with app.store.connect() as db:
        for row in db.execute('SELECT task_id,payload FROM generation_jobs').fetchall():
            job = json.loads(row['payload'])
            note_task(db, job)
            archive = (job.get('result') or {}).get('archive') or {}
            if not archive.get('archiveId'):
                skipped += 1
                continue
            saved = db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (PREFIX + archive['archiveId'],)).fetchone()
            archive = json.loads(saved['setting_value']) if saved else archive
            if archive.get('configId') != job.get('configId'):
                skipped += 1
                continue
            context = {name: job.get(name, '') for name in ('sourceId', 'flowId', 'stepId', 'flowVersionId')}
            if archive.get('sourceContext') and source_context(archive['sourceContext']) != source_context(context):
                skipped += 1
                continue
            count += sync_archive(db, {**archive, 'taskId': row['task_id'], 'sourceContext': context})
    return {'filesProcessed': count, 'tasksSkipped': skipped}
