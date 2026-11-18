"""Small deployment file summaries from saved task data, without reading bundles."""


def summarize(paths, scope='task-files', *, known_total=True):
    from .python_cache import is_python_cache
    files = sorted({path for path in paths if isinstance(path, str) and path and path != 'manifest.json' and not is_python_cache(path)},
                   key=lambda path: (not path.lower().endswith(('.py', '.exe')), path))
    return {'paths': files[:2], 'total': len(files) if known_total else None, 'scope': scope}


def for_job(job):
    if job.get('status') != 'success':
        return None
    if job.get('fileSummary') is not None:
        return job['fileSummary']
    if job.get('selectedPaths'):
        return summarize(job['selectedPaths'])
    if job.get('deploymentScope') == 'configuration':
        # Old folder deliveries do not have a stored inventory summary. Keep
        # the list fast; the signed snapshot is opened only when requested.
        return summarize([], 'configuration', known_total=False)
    archive = job.get('archive') or {}
    if not archive.get('directoryPath'):
        return summarize([], known_total=False)
    from .deployment_mapping import mapping
    prefix = mapping({}, archive, {'install_directory': job.get('instanceDirectory') or '/'})['sourceBase'].rstrip('/') + '/'
    paths = [file['path'][len(prefix):] for file in archive.get('files', []) if file.get('path', '').startswith(prefix)]
    return summarize(paths, known_total=bool(paths))
