"""Task outputs and immutable package metadata share one durable store.

Machine and Git locations describe the same output and may both be present.
The legacy SQL views are read projections, not additional storage tables.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath

FIELDS = ('artifact_id', 'artifact_type', 'task_type', 'task_id', 'name',
          'machine_path', 'repo_id', 'git_path', 'git_commit', 'sha256',
          'created_at', 'updated_at', 'payload', 'source_id', 'flow_id', 'config_id', 'output_files')
ASSET_FIELDS = ('code_id', 'config_id', 'queue_name', 'site_host', 'storage_path',
                'created_at', 'repo_id', 'config_type', 'directory_id')
RELEASE_FIELDS = ('digest', 'kind', 'name', 'platform', 'git_commit', 'status',
                  'published_at', 'signature', 'entry', 'git_url', 'artifact_path',
                  'code_id', 'delivery_path', 'prompt', 'system_prompt',
                  'prompt_template_id', 'source_url', 'repo_id', 'source_repo_path',
                  'source_git_commit', 'layout_json', 'repository_directory_id',
                  'repository_storage_path')


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def task_link(db, kind, identifier):
    if identifier and db.execute('SELECT 1 FROM jobs WHERE job_type=? AND job_id=?',
                                 (kind, identifier)).fetchone():
        return kind, identifier
    return None, None


def save(db, identifier, artifact_type, metadata, *, task_type=None, task_id=None,
         machine_path='', repo_id='', git_path='', git_commit='', sha256='',
         name='', created_at=None, insert_only=False, source_id='', flow_id='', config_id='', output_files=None):
    task_type, task_id = task_link(db, task_type, task_id)
    values = (identifier, artifact_type, task_type, task_id, name, machine_path,
              repo_id, git_path, git_commit, sha256, created_at or timestamp(),
              timestamp(), json.dumps(metadata, ensure_ascii=False, separators=(',', ':')),
              source_id, flow_id, config_id, json.dumps(output_files or [], ensure_ascii=False, separators=(',', ':')))
    result = db.execute('INSERT OR IGNORE INTO artifacts (' + ','.join(FIELDS) +
                        ') VALUES (' + ','.join('?' for _ in FIELDS) + ')', values)
    if not insert_only:
        # Never delete/reinsert: assignments reference immutable package IDs.
        changes = [(field, value) for field, value in zip(FIELDS, values) if field not in ('artifact_id', 'created_at')]
        db.execute('UPDATE artifacts SET ' + ','.join(field + '=?' for field, _ in changes) + ' WHERE artifact_id=?',
                   (*[value for _, value in changes], identifier))
    return result


def save_asset(db, values):
    row = {name: values.get(name, '') for name in ASSET_FIELDS}
    return save(db, 'asset:' + row['code_id'], 'code_identity', row,
                name=row['site_host'] or row['queue_name'], repo_id=row['repo_id'],
                git_path=row['storage_path'], created_at=row['created_at'], config_id=row['config_id'])


def patch_asset(db, code_id, **changes):
    row = db.execute('SELECT * FROM code_assets WHERE code_id=?', (code_id,)).fetchone()
    if not row:
        raise ValueError('代码资产不存在')
    save_asset(db, {**dict(row), **changes})


def save_release(db, values, *, insert_only=False):
    row = {name: values.get(name, 0 if name == 'prompt_template_id' else '') for name in RELEASE_FIELDS}
    digest = row['digest']
    return save(db, digest, 'package', row, name=row['name'],
                machine_path=row['artifact_path'], repo_id=row['repo_id'],
                git_path=row['repository_storage_path'], git_commit=row['git_commit'],
                sha256=digest.removeprefix('sha256:'), created_at=row['published_at'], insert_only=insert_only)


def patch_release(db, digest, **changes):
    row = db.execute('SELECT * FROM releases WHERE digest=?', (digest,)).fetchone()
    if not row:
        raise ValueError('发布包不存在')
    save_release(db, {**dict(row), **changes})


def sync_archive(db, record):
    """Record each actual generated file; preserve both original locations."""
    root = (record.get('workspace') or {}).get('codeDir', '')
    path_class = PureWindowsPath if '\\' in root or PureWindowsPath(root).drive else PurePosixPath
    prefix = (record.get('repositoryPrefix') or '').strip('/')
    from .generated_archives import changed_files
    context = record.get('sourceContext') or {}
    if not context and record.get('taskId'):
        job = db.execute("SELECT payload FROM jobs WHERE job_type='generation' AND job_id=?", (record['taskId'],)).fetchone()
        context = json.loads(job['payload']) if job else {}
    if not context.get('sourceId'):
        relation = db.execute('SELECT source_id,flow_id,step_id FROM source_code_relations WHERE archive_id=? LIMIT 1',
                              (record['archiveId'],)).fetchone()
        if relation:
            context = dict(sourceId=relation['source_id'], flowId=relation['flow_id'], stepId=relation['step_id'])
    files = changed_files(record, record.get('files', []))
    identity_prefix = 'file:' + record['archiveId'] + ':'
    if isinstance(record.get('beforeCodeFiles'), dict):
        identities = {identity_prefix + hashlib.sha256(file.get('path', '').encode('utf8')).hexdigest() for file in files}
        rows = db.execute("SELECT artifact_id FROM artifacts WHERE artifact_type='code' AND artifact_id LIKE ?",
                          (identity_prefix + '%',)).fetchall()
        for row in rows:
            if row['artifact_id'].startswith(identity_prefix) and row['artifact_id'] not in identities:
                db.execute('DELETE FROM artifacts WHERE artifact_id=?', (row['artifact_id'],))
    for file in files:
        relative = file.get('sourceRelativePath') or file.get('relativePath', '')
        if not file.get('sourceRelativePath') and prefix:
            relative = relative.removeprefix(prefix + '/')
        path = file.get('path', '')
        identifier = identity_prefix + hashlib.sha256(path.encode('utf8')).hexdigest()
        metadata = {key: value for key, value in file.items() if key != 'data'}
        metadata.update(archiveId=record['archiveId'], archiveStatus=record.get('status', ''),
                        pushed=bool(record.get('pushed')), sourceTaskId=record.get('taskId', ''),
                        stepId=context.get('stepId', ''), directoryId=record.get('directoryId', ''), serverId=record.get('serverId', ''))
        save(db, identifier, 'code', metadata, task_type='generation', task_id=record.get('taskId'),
             name=PurePosixPath(path or relative).name,
             machine_path=str(path_class(root) / relative) if root and relative else file.get('serverPath', ''),
             repo_id=record.get('repoId', ''), git_path=path, git_commit=record.get('gitCommit', ''),
             sha256=file.get('sha256', ''), created_at=record.get('createdAt'), source_id=context.get('sourceId', ''),
             flow_id=context.get('flowId', ''), config_id=record.get('configId', ''),
             output_files=[{'path': relative, 'gitPath': path, 'sha256': file.get('sha256', ''), 'size': file.get('size')}])


def sync_delivery(db, job):
    """A successful Runner receipt produces a deployed directory, not a ZIP path."""
    from .deployment_outputs import record
    return record(db, job, job.get('deliveryId', ''))


def backfill_outputs(db):
    for row in db.execute("SELECT payload FROM artifacts WHERE artifact_type='code_identity' AND config_id='' ").fetchall():
        save_asset(db, json.loads(row['payload']))
    for row in db.execute('SELECT setting_value FROM settings WHERE setting_key LIKE ?', ('generated-code-result:%',)).fetchall():
        sync_archive(db, json.loads(row['setting_value']))
    from .deployment_outputs import backfill
    backfill(db)


def ensure_outputs(db):
    """Commit the completion marker only after all historical outputs are copied."""
    marker = 'artifact-node-outputs:v1'
    if not db.execute('SELECT 1 FROM settings WHERE setting_key=?', (marker,)).fetchone():
        backfill_outputs(db)
        db.execute('INSERT INTO settings(setting_key,setting_value) VALUES (?,?)', (marker, 'complete'))


def view_columns(fields, mysql=False):
    direct = {'digest': 'artifact_id', 'artifact_path': 'machine_path', 'git_commit': 'git_commit', 'repo_id': 'repo_id'}
    result = []
    for field in fields:
        if field in direct:
            expression = direct[field]
        else:
            expression = "json_extract(payload,'$." + field + "')"
            if mysql:
                expression = 'JSON_UNQUOTE(' + expression + ')'
            expression = 'COALESCE(' + expression + (',0)' if field == 'prompt_template_id' else ",'')")
            if field == 'prompt_template_id' and mysql:
                expression = 'CAST(' + expression + ' AS SIGNED)'
        result.append(expression + ' AS ' + field)
    return ','.join(result)


def views(mysql=False):
    prefix = 'ce_runner_' if mysql else ''
    table = prefix + 'artifacts'
    return [(prefix + 'code_assets', 'SELECT ' + view_columns(ASSET_FIELDS, mysql) +
             " FROM " + table + " WHERE artifact_type='code_identity'"),
            (prefix + 'releases', 'SELECT ' + view_columns(RELEASE_FIELDS, mysql) +
             " FROM " + table + " WHERE artifact_type='package' AND artifact_id LIKE 'sha256:%'")]
