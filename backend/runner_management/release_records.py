"""One release record for every immutable package and optional code metadata."""
from datetime import datetime, timezone
import json
import zipfile

BASE_COLUMNS = 'digest,kind,name,platform,git_commit,status,published_at,signature,entry,git_url'


def register(db, artifacts, values):
    from .task_artifacts import save_release
    return save_release(db, {**dict(zip(BASE_COLUMNS.split(','), values)),
                             'artifact_path': str(artifacts.path(values[0]).resolve())}, insert_only=True)


def attach_code(db, digest, **values):
    from .release_schema import VERSION_COLUMNS, SHARED_COLUMNS
    if set(values) - set((*VERSION_COLUMNS, *SHARED_COLUMNS)) or not values.get('code_id'):
        raise ValueError('代码版本字段无效')
    row = db.execute('SELECT kind,code_id FROM releases WHERE digest=?', (digest,)).fetchone()
    if not row or row['kind'] != 'script' or row['code_id'] not in ('', values['code_id']):
        raise ValueError('代码版本的发布包不存在或资产冲突')
    if row['code_id']:
        return  # Publishing the exact immutable package again keeps its metadata.
    from .task_artifacts import patch_release
    patch_release(db, digest, **values)


def register_delivery(db, artifacts, digest, signature, manifest, date=None):
    sources = manifest.get('sources', [])
    commits = sorted({source['gitCommit'] for source in sources if source.get('gitCommit')})
    register(db, artifacts, (digest, 'directory', str(manifest.get('deploymentId') or manifest.get('bindingType') or 'directory'),
             'any', commits[0] if len(commits) == 1 else '', 'published',
             date or datetime.now(timezone.utc).isoformat(), signature, manifest.get('entry', ''), ''))
    # A selected deployment can contain multiple repositories. Only label the
    # package with a Git location when the manifest identifies one unambiguously.
    repos = {item.get('repoId') for item in sources if item.get('repoId')}
    if len(repos) == 1:
        import posixpath
        from .task_artifacts import patch_release
        paths = [item.get('sourcePath', '') for item in sources if item.get('sourcePath')]
        common = posixpath.commonpath(paths) if paths else ''
        patch_release(db, digest, repo_id=next(iter(repos)), repository_storage_path=common)


def backfill(app):
    """Register historical delivery packages, then fill paths without changing ZIPs."""
    with app.store.connect() as db:
        rows = db.execute('SELECT d.artifact_digest,d.signature,MIN(d.requested_at) AS requested_at,MIN(d.owner_id) AS owner_id '
                          'FROM directory_deliveries d LEFT JOIN releases r ON r.digest=d.artifact_digest '
                          'WHERE r.digest IS NULL GROUP BY d.artifact_digest,d.signature').fetchall()
        for row in rows:
            # Read only the manifest, not the complete ZIP/EXE contents. This is
            # historical metadata registration; Runner still verifies bytes on use.
            try:
                with zipfile.ZipFile(app.artifacts.path(row['artifact_digest'])) as archive:
                    manifest = json.loads(archive.read('manifest.json'))
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                manifest = {'deploymentId': row['owner_id']}
            register_delivery(db, app.artifacts, row['artifact_digest'], row['signature'], manifest, row['requested_at'])
        for row in db.execute('SELECT digest,artifact_path FROM releases').fetchall():
            path = str(app.artifacts.path(row['digest']).resolve())
            if row['artifact_path'] != path:
                from .task_artifacts import patch_release
                patch_release(db, row['digest'], artifact_path=path)
        for row in db.execute("SELECT digest,signature,published_at FROM releases WHERE kind='directory' AND repo_id=''").fetchall():
            try:
                with zipfile.ZipFile(app.artifacts.path(row['digest'])) as archive:
                    manifest = json.loads(archive.read('manifest.json'))
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                continue
            register_delivery(db, app.artifacts, row['digest'], row['signature'], manifest, row['published_at'])
        from .task_artifacts import backfill_outputs
        backfill_outputs(db)
