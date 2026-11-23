"""Durable, per-task/per-Runner output receipts; listing never opens Git or ZIPs."""
import hashlib
import json
import re
import zipfile


def manifest(package):
    from .package_limits import MAX_MANIFEST_BYTES, MAX_CODE_BYTES, MAX_CODE_FILES
    if package:
        try:
            with zipfile.ZipFile(package['machine_path']) as bundle:
                info = bundle.getinfo('manifest.json')
                if info.file_size > MAX_MANIFEST_BYTES:
                    raise ValueError('manifest too large')
                value = json.loads(bundle.read(info))
                if not isinstance(value, dict):
                    return {}
                # Older signed snapshots lacked a hash inventory. Recover it
                # from their original bytes once, never while listing outputs.
                if not isinstance(value.get('fileHashes'), dict) or not value['fileHashes']:
                    entries = [entry for entry in bundle.infolist() if not entry.is_dir() and entry.filename != 'manifest.json']
                    if len(entries) <= MAX_CODE_FILES and sum(entry.file_size for entry in entries) <= MAX_CODE_BYTES:
                        hashes = {}
                        for entry in entries:
                            with bundle.open(entry) as stream:
                                hashes[entry.filename] = hashlib.file_digest(stream, 'sha256').hexdigest()
                        value['fileHashes'] = hashes
                        value['_inventorySource'] = 'package-files'
                return value
        except (OSError, ValueError, KeyError, RuntimeError, NotImplementedError, zipfile.BadZipFile):
            pass
    return {}


def record(db, partial, delivery_id):
    if not delivery_id or not partial.get('jobId'):
        return False
    attempt = db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=?', (delivery_id,)).fetchone()
    if not attempt or attempt['status'] != 'success' or not attempt['installed_path']:
        return False
    stored = db.execute("SELECT * FROM jobs WHERE job_type='deployment' AND job_id=?", (partial['jobId'],)).fetchone()
    if not stored:
        return False
    identity = 'deployment:' + hashlib.sha256(json.dumps([partial['jobId'], delivery_id]).encode()).hexdigest()
    if db.execute('SELECT 1 FROM artifacts WHERE artifact_id=?', (identity,)).fetchone():
        return False  # Duplicate acknowledgements and restarts cannot rewrite a completed output.
    job = json.loads(stored['payload'])
    package = db.execute('SELECT * FROM artifacts WHERE artifact_id=?', (attempt['artifact_digest'],)).fetchone()
    bundle = manifest(package)
    files = []
    hashes = bundle.get('fileHashes') or {}
    hashes = hashes if isinstance(hashes, dict) else {}
    for path, digest in hashes.items():
        if isinstance(path, str) and isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest):
            files.append({'path': path, 'sha256': digest})
    files.sort(key=lambda item: item['path'])
    inventory_known = bool(files)
    if not files:
        files = [{'path': path, 'sha256': ''} for path in job.get('selectedPaths') or (job.get('fileSummary') or {}).get('paths') or [] if isinstance(path, str)]
    runner = db.execute('SELECT * FROM runners WHERE runner_id=?', (attempt['runner_id'],)).fetchone()
    sources = bundle.get('sources') or []
    sources = [source for source in sources if isinstance(source, dict)] if isinstance(sources, list) else []
    commits = {source.get('gitCommit') for source in sources if source.get('gitCommit')}
    commit = job.get('gitCommit') or (next(iter(commits)) if len(commits) == 1 else '')
    completed = attempt['finished_at'] or job.get('updatedAt') or attempt['requested_at']
    metadata = dict(sourceTaskId=partial['jobId'], stepId=stored['step_id'], serverId=attempt['runner_id'],
                    serverName=runner['name'] if runner else job.get('runnerName', ''),
                    serverIp=runner['ip_address'] if runner else job.get('runnerIp', ''),
                    instanceDirectory=runner['install_directory'] if runner else job.get('instanceDirectory', ''),
                    environment=stored['environment'], deliveryId=delivery_id, completedAt=completed,
                    deploymentId=job.get('deploymentId', ''), resourceId=job.get('resourceId') or job.get('targetResourceId', ''),
                    targetPath=attempt['target_path'], archiveId=job.get('archiveId', ''),
                    packageId=attempt['artifact_digest'], packagePath=package['machine_path'] if package else '',
                    inventoryKnown=inventory_known, inventorySource=bundle.get('_inventorySource', 'manifest'), sources=sources, status='success')
    from .task_artifacts import save
    save(db, identity, 'deployment', metadata, task_type='deployment', task_id=partial['jobId'],
         name=job.get('nodeName') or stored['config_id'] or job.get('deploymentId', '') or '部署产出',
         machine_path=attempt['installed_path'], repo_id=package['repo_id'] if package else job.get('repositoryId', ''),
         git_path=package['git_path'] if package else job.get('gitDirectory', ''), git_commit=commit,
         sha256=package['sha256'] if package else attempt['artifact_digest'].removeprefix('sha256:'),
         created_at=completed, source_id=stored['source_id'], flow_id=stored['flow_id'], config_id=stored['config_id'],
         output_files=files, insert_only=True)
    return True


def backfill(db):
    count = 0
    for row in db.execute("SELECT job_id,payload FROM jobs WHERE job_type='deployment'").fetchall():
        job = json.loads(row['payload'])
        identifiers = set(job.get('deliveryAttempts') or {}) | set(job.get('deliveryHistory') or []) | {job.get('deliveryId', '')}
        for identifier in identifiers - {''}:
            count += int(record(db, {'jobId': row['job_id']}, identifier))
    # These old rows described deployment inputs and pointed to the management
    # server's ZIP. Canonical packages remain; actual outputs are separate receipts.
    for row in db.execute("SELECT artifact_id FROM artifacts WHERE artifact_type='package' AND task_type='deployment' AND artifact_id LIKE ?", ('output:%',)).fetchall():
        if not db.execute('SELECT 1 FROM assignments WHERE release_digest=?', (row['artifact_id'],)).fetchone() and not db.execute(
                'SELECT 1 FROM code_runtime_bindings WHERE digest=?', (row['artifact_id'],)).fetchone():
            db.execute('DELETE FROM artifacts WHERE artifact_id=?', (row['artifact_id'],))
    return count


def public(row):
    metadata = json.loads(row['payload']); files = json.loads(row['output_files'])
    return dict(artifactId=row['artifact_id'], artifactType=row['artifact_type'], taskType=row['task_type'],
                taskId=row['task_id'] or metadata.get('sourceTaskId', ''), sourceId=row['source_id'], flowId=row['flow_id'],
                configId=row['config_id'], stepId=metadata.get('stepId', ''), name=row['name'], machinePath=row['machine_path'],
                repositoryId=row['repo_id'], gitPath=row['git_path'], gitCommit=row['git_commit'], sha256=row['sha256'],
                outputFiles=files, createdAt=row['created_at'], updatedAt=row['updated_at'],
                **{key: metadata.get(key, '') for key in ('serverId', 'serverName', 'serverIp', 'instanceDirectory', 'environment',
                    'archiveId', 'directoryId', 'deliveryId', 'deploymentId', 'resourceId', 'targetPath', 'completedAt', 'packageId', 'packagePath')},
                status=metadata.get('archiveStatus') if row['artifact_type']=='code' else metadata.get('status'),
                pushed=bool(metadata.get('pushed')), inventoryKnown=bool(metadata.get('inventoryKnown')))


def listing(app, query):
    from .server import ApiError
    try: page, size = int(query.get('page') or 1), int(query.get('size') or 100)
    except (ValueError, TypeError): raise ApiError('产出物分页参数无效')
    if page < 1 or not 1 <= size <= 100: raise ApiError('产出物分页参数无效')
    clauses, values = ["artifact_type IN ('code','deployment')"], []
    for key, field in (('sourceId','source_id'),('flowId','flow_id'),('configId','config_id'),('taskId','task_id'),
                       ('taskType','task_type'),('artifactType','artifact_type')):
        value = query.get(key) or ''
        if not isinstance(value, str) or len(value)>128: raise ApiError('产出物筛选参数无效')
        if value: clauses.append(field+'=?');values.append(value)
    with app.store.connect() as db:
        from .store import MySqlConnection
        expression = 'JSON_UNQUOTE(JSON_EXTRACT(payload,?))' if isinstance(db, MySqlConnection) else 'json_extract(payload,?)'
        for key in ('stepId','environment','serverId','status'):
            value = query.get(key) or ''
            if not isinstance(value, str) or len(value)>128: raise ApiError('产出物筛选参数无效')
            if value:
                path = '$.archiveStatus' if key == 'status' and query.get('artifactType') == 'code' else '$.'+key
                clauses.append(expression+'=?'); values.extend((path,value))
        where = ' AND '.join(clauses)
        total = db.execute('SELECT COUNT(*) n FROM artifacts WHERE '+where,values).fetchone()['n']
        rows = db.execute('SELECT * FROM artifacts WHERE '+where+' ORDER BY created_at DESC,artifact_id DESC LIMIT ? OFFSET ?',
                          (*values,size,(page-1)*size)).fetchall()
    return {'items':[public(row) for row in rows],'total':total,'page':page,'size':size}
