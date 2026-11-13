"""Preview the signed snapshot confirmed by a particular deployment receipt."""
import hashlib
import json
import re


def read(app, identifier, path=None):
    from .server import ApiError
    from .directory_layout import safe_path
    from .snapshot_reader import read_snapshot
    from .python_cache import is_python_cache
    from .deployment_mapping import mapping
    if not re.fullmatch(r'[0-9a-f]{32}', identifier): raise ApiError('部署记录 ID 无效')
    with app.store.connect() as db:
        row = db.execute('SELECT payload FROM deployment_jobs WHERE job_id=?', (identifier,)).fetchone()
        if not row: raise ApiError('部署记录不存在', 404)
        job = json.loads(row['payload'])
        delivery = db.execute('SELECT * FROM directory_deliveries WHERE delivery_id=? AND owner_id=? AND runner_id=?',
                              (job.get('deliveryId', ''), job.get('deploymentId', ''), job.get('runnerId', ''))).fetchone()
        if not delivery or delivery['status'] != 'success': raise ApiError('本次尚未部署成功，暂无已确认的部署文件', 409)
        def bundle(digest):
            signature = db.execute('SELECT signature FROM directory_deliveries WHERE artifact_digest=? LIMIT 1', (digest,)).fetchone()
            if not signature: raise ApiError('已部署文件缺少签名记录，无法查看', 409)
            return app.artifacts.read(digest), signature['signature']
        try: files, manifest = read_snapshot(bundle, delivery['artifact_digest'], app.artifacts.public_key)
        except (ValueError, KeyError, OSError) as error:
            raise ApiError('部署文件快照缺失或校验失败，无法查看该版本', 409) from error
    files = {name: data for name, data in files.items() if name != 'manifest.json' and not is_python_cache(name)}
    result = {'jobId': identifier, 'deliveryId': delivery['delivery_id'], 'artifactDigest': delivery['artifact_digest'],
              'gitCommit': job['gitCommit'], 'directory': delivery['installed_path'] or delivery['target_path']}
    if path is not None:
        path = safe_path(path)
        if path not in files: raise ApiError('该部署版本中不存在此文件', 404)
        raw = files[path]
        if len(raw) > 1024 * 1024: raise ApiError('文件超过 1 MB，暂不支持在线预览', 413)
        if b'\0' in raw: raise ApiError('二进制文件不支持文本预览', 415)
        try: content = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            try: content = raw.decode('gb18030')
            except UnicodeDecodeError as error: raise ApiError('文件不是支持的文本编码', 415) from error
        return {**result, 'path': path, 'content': content, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    selected = set(job.get('selectedPaths') or [])
    if not selected and job.get('archive', {}).get('files'):
        archive = job['archive']
        prefix = mapping({'deploymentDirectory': '.'}, archive, {'install_directory': job.get('instanceDirectory') or '/'})['sourceBase'] + '/'
        selected = {file['path'][len(prefix):] for file in archive['files'] if file['path'].startswith(prefix)}
    return {**result, 'files': [{'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'taskFile': name in selected}
                               for name, data in sorted(files.items())]}
