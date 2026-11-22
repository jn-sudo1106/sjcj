"""Conservative, read-only artifact inventory for explicit maintenance cleanup."""
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sqlite3
import time
import zipfile

from .package_limits import MAX_MANIFEST_BYTES


ZIP_NAME = re.compile(r'([0-9a-f]{64})\.zip')
DIGEST = re.compile(r'(?<![0-9a-f])(?:sha256:)?([0-9a-f]{64})(?![0-9a-f])')


def references(value, known):
    return {match.group(1) for match in DIGEST.finditer(value) if match.group(1) in known} if isinstance(value, str) else set()


def database_references(db, known):
    """Inspect every management text/JSON column; never return its raw values."""
    reasons = defaultdict(set)
    if isinstance(db, sqlite3.Connection):
        from .store import MYSQL_TABLES
        tables = [row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'") if row['name'] in MYSQL_TABLES]
    else:
        tables = [row['TABLE_NAME'] for row in db.execute(
            "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' "
            "AND TABLE_NAME LIKE ?", ('ce_runner_%',)).fetchall()]
    for table in tables:
        if not re.fullmatch(r'(?:ce_runner_)?[a-z_]+', table):
            raise ValueError('Unexpected table name')
        if isinstance(db, sqlite3.Connection):
            columns = [(row['name'], row['type']) for row in db.execute('PRAGMA table_info(' + table + ')')]
        else:
            columns = [(row['Field'], row['Type']) for row in db.execute('SHOW COLUMNS FROM `' + table + '`').fetchall()]
        fields = [name for name, kind in columns if any(token in kind.lower() for token in ('char', 'text', 'json'))
                  and not re.search('password|token_hash|signature|credential', name)]
        if not fields:
            continue
        cursor = db.execute('SELECT ' + ','.join('`' + name + '`' for name in fields) + ' FROM `' + table + '`')
        while rows := cursor.fetchmany(100):
            for row in rows:
                for name in fields:
                    for digest in references(row[name], known):
                        reasons[digest].add(table + '.' + name)
    return {digest: sorted(values) for digest, values in reasons.items()}


def inventory(app, *, grace_seconds=86400, now=None):
    root = Path(app.artifacts.root).resolve(strict=True)
    now = time.time() if now is None else now
    files, graph, errors = {}, {}, {}
    for path in root.iterdir():
        match = ZIP_NAME.fullmatch(path.name)
        if not match:
            continue
        stat = path.lstat()
        digest = match.group(1)
        files[digest] = {'name': path.name, 'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns,
                         'recent': now - stat.st_mtime < grace_seconds, 'kind': 'unknown'}
        if path.is_symlink() or not path.is_file():
            errors[digest] = 'not_regular_file'
            continue
        try:
            with zipfile.ZipFile(path) as archive:
                info = archive.getinfo('manifest.json')
                if info.file_size > MAX_MANIFEST_BYTES:
                    raise ValueError('manifest too large')
                raw = archive.read(info)
                manifest = json.loads(raw)
                if not isinstance(manifest, dict):
                    raise ValueError('manifest not an object')
                files[digest]['kind'] = str(manifest.get('kind', 'unknown'))[:80]
                graph[digest] = raw.decode('utf8')
        except (OSError, ValueError, KeyError, zipfile.BadZipFile):
            errors[digest] = 'unreadable_manifest'
    known = set(files)
    with app.store.connect() as db:
        roots = database_references(db, known)
    recent = {digest for digest, item in files.items() if item['recent']}
    edges = {digest: references(raw, known) - {digest} for digest, raw in graph.items()}
    kept, pending = set(), list(set(roots) | recent)
    while pending:
        digest = pending.pop()
        if digest in kept:
            continue
        kept.add(digest)
        pending.extend(edges.get(digest, set()) - kept)
    blocked = bool(set(errors) & kept)
    candidates = [item for digest, item in files.items() if digest not in kept and digest not in errors] if not blocked else []
    candidates.sort(key=lambda item: (item['mtimeNs'], item['name']))
    direct = set(roots)
    return {'root': str(root), 'createdAt': now, 'graceSeconds': grace_seconds,
            'fileCount': len(files), 'totalBytes': sum(item['size'] for item in files.values()),
            'databaseReferenced': len(direct), 'recentUnreferenced': len(recent - direct),
            'dependencyKept': len(kept - direct - recent), 'invalidFiles': len(errors),
            'blockedByUnreadableDependency': blocked, 'keptCount': len(files) - len(candidates),
            'candidateCount': len(candidates), 'candidateBytes': sum(item['size'] for item in candidates),
            'kinds': dict(Counter(item['kind'] for item in files.values())),
            'referenceColumns': dict(Counter(column for values in roots.values() for column in values)),
            'candidates': candidates, 'protectedDigests': sorted(kept), 'invalidDigests': errors}
