"""Install signed directory snapshots using the existing worker version.json format.

Ported from link_extractor.core.managed_script so a copied Runner folder remains
self-contained and can share directories with already deployed workers.
"""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import time
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def effective_manifest(manifest):
    # Existing single-file releases keep their original signature and digest.
    # Missing layout metadata means the same default shown by the directory editor.
    if manifest.get('layoutSchema') is None:
        return {**manifest, 'layoutSchema': 2, 'directoryTemplate': '{configId}',
                'versionFile': 'version.json', 'directories': [], 'sources': []}
    return manifest


def code_key(manifest):
    if isinstance(manifest.get('registryKey'), str) and manifest['registryKey']:
        return manifest['registryKey']
    return '|'.join(str(manifest.get(key) or '') for key in ('configId', 'queueName', 'siteHost'))


def linked(path):
    return path.is_symlink() or bool(getattr(path, 'is_junction', lambda: False)())


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(data)
        temporary_name = temporary.name
    try:
        os.replace(temporary_name, path)
    finally:
        if Path(temporary_name).exists():
            Path(temporary_name).unlink()


def cache_bundle(cache, digest, archive, signature):
    directory = cache / 'artifacts'
    atomic_write(directory / (digest[7:] + '.zip'), archive)
    atomic_write(directory / (digest[7:] + '.sig'), signature.encode('ascii'))


def cached_bundle(cache, digest, public_key):
    from .snapshot_reader import read_snapshot
    def read(value):
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', value):
            raise ValueError('本地版本摘要无效')
        directory = cache / 'artifacts'
        return ((directory / (value[7:] + '.zip')).read_bytes(),
                (directory / (value[7:] + '.sig')).read_text(encoding='ascii'))
    return read_snapshot(read, digest, public_key)


def read_registry(target):
    path = target / 'version.json'
    if not path.exists():
        return {'schemaVersion': 1, 'current': {}, 'versions': []}
    if linked(path) or path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('version.json 无效')
    value = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(value, dict) or value.get('schemaVersion') != 1
            or not isinstance(value.get('current'), dict) or not isinstance(value.get('versions'), list)):
        raise ValueError('version.json 格式无效')
    if any(not isinstance(k, str) or not isinstance(v, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', v)
           for k, v in value['current'].items()):
        raise ValueError('version.json 当前版本无效')
    if any(not isinstance(record, dict) or not isinstance(record.get('codeKey'), str)
           or not isinstance(record.get('digest'), str) for record in value['versions']):
        raise ValueError('version.json 历史版本无效')
    return value


def registry_bytes(registry):
    data = json.dumps(registry, ensure_ascii=False, indent=2).encode('utf-8')
    if len(data) > 20 * 1024 * 1024:
        raise ValueError('version.json 版本记录过大')
    return data


def record_for(files, manifest, digest):
    return {'codeKey': code_key(manifest), 'codeId': manifest.get('codeId', ''), 'digest': digest,
            'configId': manifest['configId'], 'queueName': manifest.get('queueName', ''),
            'siteHost': manifest.get('siteHost', ''), 'entry': manifest['entry'],
            'sources': manifest.get('sources', []), 'directories': manifest.get('directories', []),
            'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items() if name != 'manifest.json'}}


@contextmanager
def directory_lock(target):
    target.parent.mkdir(parents=True, exist_ok=True)
    lock_path = target.parent / ('.' + target.name + '.update.lock')
    if linked(lock_path):
        raise ValueError('目录更新锁路径无效')
    with lock_path.open('a+b') as handle:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b'0'); handle.flush()
        deadline = time.monotonic() + 30
        while True:
            try:
                handle.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise TimeoutError('等待代码目录更新超时')
                time.sleep(0.05)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def live_journal(target, cache):
    directory = cache / 'live-updates'
    if linked(directory) or not directory.resolve().is_relative_to(cache.resolve()): raise ValueError('在线更新恢复目录无效')
    return directory / (hashlib.sha256(str(target.resolve()).encode()).hexdigest() + '.json')


def recover_live_update(target, cache):
    journal = live_journal(target, cache)
    if not journal.exists(): return
    if linked(journal) or journal.stat().st_size > 30 * 1024 * 1024: raise ValueError('在线更新恢复记录无效')
    record = json.loads(journal.read_text(encoding='utf8'))
    if record.get('target') != str(target.resolve()): raise ValueError('在线更新恢复目录不匹配')
    entries = record.get('files')
    if not isinstance(entries, dict) or any(not safe_relative(name) or '/' in name for name in entries): raise ValueError('在线更新恢复路径无效')
    committed = read_registry(target)['current'].get(record['key']) == record['digest']
    for name, item in entries.items():
        path = target / name
        if linked(path) or path.exists() and not path.is_file(): raise ValueError('在线更新恢复文件无效')
        current = path.read_bytes() if path.exists() else None
        previous = base64.b64decode(item['before'], validate=True) if item['before'] is not None else None
        matches_new = current is not None and hashlib.sha256(current).hexdigest() == item['after']
        if committed:
            if not matches_new: raise ValueError('在线更新提交后的文件已被修改：' + name)
        elif not matches_new and current != previous:
            raise ValueError('在线更新中断后文件被其他操作修改，无法自动恢复：' + name)
    if not committed:
        for name, item in entries.items():
            path = target / name
            if item['before'] is None: path.unlink(missing_ok=True)
            else: atomic_write(path, base64.b64decode(item['before'], validate=True))
        old = record.get('registry')
        if old is None: (target / 'version.json').unlink(missing_ok=True)
        else: atomic_write(target / 'version.json', base64.b64decode(old, validate=True))
    journal.unlink()


def install_live(target, mapped, registry, key, digest, cache):
    updates = {name: data for name, data in mapped.items() if not (target / name).is_file() or (target / name).read_bytes() != data}
    registry_path = target / 'version.json'
    record = {'target': str(target.resolve()), 'key': key, 'digest': digest,
              'registry': base64.b64encode(registry_path.read_bytes()).decode() if registry_path.exists() else None,
              'files': {name: {'before': base64.b64encode((target / name).read_bytes()).decode() if (target / name).exists() else None,
                               'after': hashlib.sha256(data).hexdigest()} for name, data in updates.items()}}
    journal = live_journal(target, cache)
    atomic_write(journal, json.dumps(record).encode())
    try:
        for name, data in updates.items(): atomic_write(target / name, data)
        registry['current'][key] = digest
        atomic_write(registry_path, registry_bytes(registry))
    except Exception:
        recover_live_update(target, cache)
        raise
    journal.unlink()
    return registry


def install_bundle(target, files, manifest, digest, cache, public_key, make_current=True, *, protected_programs=None):
    from .python_cache import is_python_cache
    directories = manifest.get('directories', [])
    if not isinstance(directories, list) or any(not safe_relative(name) for name in directories):
        raise ValueError('代码包目录无效')
    mapped = {name: data for name, data in files.items() if name != 'manifest.json' and not is_python_cache(name)}
    new_record = record_for(files, manifest, digest)
    key = new_record['codeKey']
    backup = target.parent / ('.' + target.name + '.update.backup')
    with directory_lock(target):
        if (linked(backup) or linked(target)
                or backup.resolve().parent != target.parent.resolve()):
            raise ValueError('代码目录不能使用符号链接')
        recover_live_update(target, cache)
        if backup.exists():
            if not target.exists():
                os.replace(backup, target)
        if target.exists() and any(linked(path) for path in target.rglob('*')):
            raise ValueError('代码目录包含符号链接')
        registry = read_registry(target)
        if (manifest.get('deliveryScope') == 'selected' and make_current
                and registry['current'].get(key) not in (manifest.get('baseDigest'), digest)):
            raise ValueError('本地版本已变化，请重新选择范围或使用全部下发')
        records = {(record.get('codeKey'), record.get('digest')): record for record in registry['versions'] if isinstance(record, dict)}
        owned = {}
        own_files = set()
        own_directories = set()
        other_directories = set()
        # A manual full delivery can recreate this configuration's missing
        # empty folders. Files, other owners and partial baselines stay strict.
        full_delivery = (make_current and (manifest.get('syncMode') == 'all'
                         or manifest.get('deliverySchema') == 1 and manifest.get('deliveryScope') != 'selected'))
        missing_directories = set()
        for owner, old_digest in registry['current'].items():
            old_files, old_manifest = cached_bundle(cache, old_digest, public_key)
            expected = record_for(old_files, old_manifest, old_digest)
            stored = records.get((owner, old_digest))
            if owner != expected['codeKey'] or not stored or any(stored.get(k) != v for k, v in expected.items()):
                raise ValueError('version.json 与签名版本不一致')
            for name, data in old_files.items():
                if name == 'manifest.json' or is_python_cache(name):
                    continue
                current_file = target / name
                if not current_file.is_file() or current_file.is_symlink() or current_file.read_bytes() != data:
                    raise ValueError('代码包缓存被修改，请恢复已签名版本后重试')
                if owner == key:
                    own_files.add(name)
                else:
                    owned[name.casefold()] = (name, data)
            owner_directories = {name for name in old_manifest.get('directories', []) if not is_python_cache(name)}
            for name in old_files:
                if name != 'manifest.json' and not is_python_cache(name):
                    parts = name.split('/')
                    owner_directories.update('/'.join(parts[:i]) for i in range(1, len(parts)))
            if owner == key:
                own_directories.update(owner_directories)
            else:
                other_directories.update(directory.casefold() for directory in owner_directories)
            for directory in old_manifest.get('directories', []):
                if is_python_cache(directory):
                    continue
                path = target / directory
                if path.is_dir():
                    continue
                if path.exists():
                    raise ValueError('目标部署目录中的文件占用了目录位置：' + directory)
                if full_delivery and owner == key:
                    missing_directories.add(directory)
                else:
                    raise ValueError('目标部署目录缺少已下发目录：' + directory + '，请对该配置重新下发全部代码')
        # A crash after the successful swap can leave its backup. Only remove it
        # after the new current directory has passed signed-content validation.
        if backup.exists():
            if not registry['current'] or not backup.resolve().is_relative_to(target.parent.resolve()):
                raise ValueError('上次目录更新的备份无法确认')
            shutil.rmtree(backup)
        if (key, digest) not in records:
            registry['versions'].append({**new_record, 'downloadedAt': datetime.now(timezone.utc).isoformat(timespec='seconds')})
        if not make_current:
            target.mkdir(parents=True, exist_ok=True)
            atomic_write(target / 'version.json', registry_bytes(registry))
            return registry
        if registry['current'].get(key) == digest and not missing_directories:
            return registry
        for name, data in mapped.items():
            if name.casefold() in owned and owned[name.casefold()] != (name, data):
                raise ValueError('目标路径被其他节点代码占用：' + name)
            existing = target / name
            if existing.is_file() and name not in own_files and name.casefold() not in owned and existing.read_bytes() != data:
                raise ValueError('目标目录已有未托管的同名文件：' + name)
        if protected_programs:
            from .live_deployment import validate
            validate({name: (target / name).read_bytes() for name in own_files}, mapped, protected_programs)
            if any(not (target / directory).is_dir() for directory in directories): raise ValueError('公共目录结构发生变化，请先停止处理程序')
            return install_live(target, mapped, registry, key, digest, cache)
        temporary = Path(tempfile.mkdtemp(prefix='.' + target.name + '.incoming-', dir=target.parent))
        try:
            if target.exists():
                shutil.copytree(target, temporary, dirs_exist_ok=True)
            for name in own_files - mapped.keys():
                if name.casefold() not in owned:
                    (temporary / name).unlink()
            # Prune emptied managed folders so a former folder can become a file.
            for relative in sorted(own_directories, key=lambda item: len(item.split('/')), reverse=True):
                path = temporary / relative
                if path.is_dir() and relative.casefold() not in other_directories:
                    try:
                        path.rmdir()
                    except OSError:
                        pass
            for directory in directories:
                (temporary / directory).mkdir(parents=True, exist_ok=True)
            for name, data in mapped.items():
                destination = temporary / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.is_file() or destination.read_bytes() != data:
                    destination.write_bytes(data)
            registry['current'][key] = digest
            (temporary / 'version.json').write_bytes(registry_bytes(registry))
            if target.exists():
                os.replace(target, backup)
            try:
                os.replace(temporary, target)
            except Exception:
                if backup.exists():
                    os.replace(backup, target)
                raise
            if backup.exists() and backup.resolve().is_relative_to(target.parent.resolve()):
                shutil.rmtree(backup)
        finally:
            if temporary.exists() and temporary.resolve().is_relative_to(target.parent.resolve()):
                shutil.rmtree(temporary)
        return registry


def safe_relative(value):
    if not isinstance(value, str) or not value or any(ch in value for ch in '\\:< >"|?*'.replace(' ', '')):
        return False
    return all(part and part not in ('.', '..', '.git') and not part.endswith(('.', ' '))
               and part.upper().split('.')[0] not in {'CON', 'PRN', 'AUX', 'NUL',
                   *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
               and not any(ord(ch) < 32 for ch in part) for part in value.split('/'))
