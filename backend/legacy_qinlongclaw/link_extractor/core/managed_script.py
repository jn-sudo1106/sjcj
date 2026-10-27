"""Resolve a node's signed site script using the queue task's ConfigId."""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import zipfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def resolve(task):
    if not isinstance(task, dict) or not os.getenv('RUNNER_WORKER_TOKEN'):
        return None
    config_id = str(task.get('ConfigId') or '').strip()
    if not config_id:
        return None
    if not re.fullmatch(r'[A-Za-z0-9_-]+', config_id):
        raise ValueError('ConfigId 无效')
    server = os.environ['RUNNER_MANAGEMENT_URL'].rstrip('/')
    headers = {'Authorization': 'Bearer ' + os.environ['RUNNER_WORKER_TOKEN']}
    queue = os.getenv('RUNNER_QUEUE', '')
    environment = os.getenv('RUNNER_ENVIRONMENT', '')
    host = (urlsplit(str(task.get('Url') or '')).hostname or '').lower()
    expected_digest = str(task.get('ScriptDigest') or '')
    params = urlencode({'queue': queue, 'environment': environment, 'host': host}) if queue and environment else ''
    lookup = server + '/api/workers/configs/' + config_id + '/script-release'
    with urlopen(Request(lookup + ('?' + params if params else ''), headers=headers), timeout=15) as response:
        release = json.load(response)
    current_digest = release.get('scriptDigest', '') if release else ''
    if expected_digest and expected_digest != current_digest and params:
        with urlopen(Request(lookup + '?' + params + '&' + urlencode({'digest': expected_digest}), headers=headers), timeout=15) as response:
            release = json.load(response)
    if not release:
        return None
    digest = release['scriptDigest']
    if expected_digest and expected_digest != digest:
        raise ValueError('任务脚本版本与当前节点绑定不一致')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ValueError('脚本摘要无效')
    cache = Path(os.environ['RUNNER_SCRIPT_CACHE']).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    delivery_path = release.get('deliveryPath') or release.get('name') or ''
    with urlopen(Request(server + '/api/artifacts/' + digest, headers=headers), timeout=30) as response:
        archive = response.read()
        signature = response.headers['X-Artifact-Signature']
    actual = hashlib.sha256(archive).hexdigest()
    if digest != 'sha256:' + actual:
        raise ValueError('脚本摘要校验失败')
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(os.environ['RUNNER_PUBLIC_KEY'], validate=True))
    key.verify(base64.b64decode(signature, validate=True), bytes.fromhex(actual))
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        manifest = json.loads(zipped.read('manifest.json'))
        name = manifest.get('entry', '')
        bundled = manifest.get('layoutSchema') in (1, 2)
        valid_name = (safe_relative(name) and name.lower().endswith('.py')) if bundled else bool(re.fullmatch(r'(?:sites/)?[a-z0-9][a-z0-9_.-]*\.py', name, re.I))
        if (manifest.get('kind') != 'script' or manifest.get('configId') != config_id
                or not valid_name or (delivery_path and name != delivery_path)
                or (params and release.get('queueName') and
                    (manifest.get('queueName') != queue or manifest.get('siteHost', '') != release.get('siteHost', '')))):
            raise ValueError('脚本制品清单无效')
        manifest = effective_manifest(manifest)
        template = manifest.get('directoryTemplate', '')
        if not isinstance(template, str):
            raise ValueError('下发目录无效')
        expanded = template.replace('{configId}', config_id).replace('{queue}', queue).replace('{environment}', environment)
        if (not safe_relative(expanded) or '{' in expanded or '}' in expanded
                or expanded.split('/')[0].lower() in ('versions', 'runner-versions', 'code', 'logs', 'identity.json', 'current.json', 'previous.json', 'instance.lock', '.runtime')):
            raise ValueError('下发目录无效')
        root = Path(os.environ.get('RUNNER_INSTANCE_DIR') or cache.parent).resolve()
        target = root / expanded
        # Existing junctions/symlinks must not redirect a signed package outside this instance.
        if (not target.resolve().is_relative_to(root)
                or target.resolve().is_relative_to(cache) or cache.is_relative_to(target.resolve())
                or any(linked(p) for p in [target, *target.parents] if p != root and p.is_relative_to(root))):
            raise ValueError('下发目录不能指向 Runner 外部')
        files = {}
        for info in zipped.infolist():
            if (not safe_relative(info.filename) or info.is_dir()
                    or (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('脚本制品包含非法路径或符号链接')
            if info.file_size > 10 * 1024 * 1024 or sum(len(data) for data in files.values()) + info.file_size > 12 * 1024 * 1024:
                raise ValueError('脚本制品过大')
            files[info.filename] = zipped.read(info)
        if name not in files:
            raise ValueError('脚本入口不存在')
    if any(name.casefold() == 'version.json' for name in files):
        raise ValueError('代码包不能覆盖系统维护的 version.json')
    cache_bundle(cache, digest, archive, signature)
    registry = install_bundle(target, files, manifest, digest, cache, os.environ['RUNNER_PUBLIC_KEY'],
                              make_current=digest == current_digest and not manifest.get('deploymentId'))
    path = ManagedScriptPath(target / name)
    path._managed_bundle = {'files': files, 'manifest': manifest, 'digest': digest, 'registry': registry}
    return path


class ManagedScriptPath(type(Path())):
    """A fixed user-facing path carrying this task's verified immutable bytes."""
    pass


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
    if __package__:
        from .snapshot_reader import read_snapshot
    else:  # Standalone compatibility tests also load this file directly.
        import importlib.util
        spec = importlib.util.spec_from_file_location('snapshot_reader', Path(__file__).with_name('snapshot_reader.py'))
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        read_snapshot = reader.read_snapshot
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


def install_bundle(target, files, manifest, digest, cache, public_key, make_current=True):
    directories = manifest.get('directories', [])
    if not isinstance(directories, list) or any(not safe_relative(name) for name in directories):
        raise ValueError('代码包目录无效')
    mapped = {name: data for name, data in files.items() if name != 'manifest.json'}
    new_record = record_for(files, manifest, digest)
    key = new_record['codeKey']
    backup = target.parent / ('.' + target.name + '.update.backup')
    with directory_lock(target):
        if (linked(backup) or linked(target)
                or backup.resolve().parent != target.parent.resolve()):
            raise ValueError('代码目录不能使用符号链接')
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
        for owner, old_digest in registry['current'].items():
            old_files, old_manifest = cached_bundle(cache, old_digest, public_key)
            expected = record_for(old_files, old_manifest, old_digest)
            stored = records.get((owner, old_digest))
            if owner != expected['codeKey'] or not stored or any(stored.get(k) != v for k, v in expected.items()):
                raise ValueError('version.json 与签名版本不一致')
            for name, data in old_files.items():
                if name == 'manifest.json':
                    continue
                current_file = target / name
                if not current_file.is_file() or current_file.is_symlink() or current_file.read_bytes() != data:
                    raise ValueError('代码包缓存被修改，请恢复已签名版本后重试')
                if owner == key:
                    own_files.add(name)
                else:
                    owned[name.casefold()] = (name, data)
            owner_directories = set(old_manifest.get('directories', []))
            for name in old_files:
                if name != 'manifest.json':
                    parts = name.split('/')
                    owner_directories.update('/'.join(parts[:i]) for i in range(1, len(parts)))
            if owner == key:
                own_directories.update(owner_directories)
            else:
                other_directories.update(directory.casefold() for directory in owner_directories)
            if any(not (target / directory).is_dir() for directory in old_manifest.get('directories', [])):
                raise ValueError('代码包缓存目录被修改')
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
        if registry['current'].get(key) == digest:
            return registry
        for name, data in mapped.items():
            if name.casefold() in owned and owned[name.casefold()] != (name, data):
                raise ValueError('目标路径被其他节点代码占用：' + name)
            existing = target / name
            if existing.is_file() and name not in own_files and name.casefold() not in owned and existing.read_bytes() != data:
                raise ValueError('目标目录已有未托管的同名文件：' + name)
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


def runtime_snapshot(path):
    attached = getattr(path, '_managed_bundle', None)
    if attached:
        return attached
    instance = Path(os.environ.get('RUNNER_INSTANCE_DIR') or Path(os.environ['RUNNER_SCRIPT_CACHE']).parent).resolve()
    for parent in path.parents:
        if not parent.resolve().is_relative_to(instance):
            break
        if not (parent / 'version.json').is_file():
            continue
        with directory_lock(parent):
            registry = read_registry(parent)
            for owner, digest in registry['current'].items():
                files, manifest = cached_bundle(Path(os.environ['RUNNER_SCRIPT_CACHE']), digest, os.environ['RUNNER_PUBLIC_KEY'])
                record = next((item for item in registry['versions'] if item['codeKey'] == owner and item['digest'] == digest), None)
                expected = record_for(files, manifest, digest)
                if owner != expected['codeKey'] or not record or any(record.get(k) != v for k, v in expected.items()):
                    raise ValueError('version.json 与签名版本不一致')
                if manifest['entry'] == path.relative_to(parent).as_posix():
                    return {'files': files, 'manifest': manifest, 'digest': digest, 'registry': registry}
    return None


def safe_relative(value):
    if not isinstance(value, str) or not value or any(ch in value for ch in '\\:< >"|?*'.replace(' ', '')):
        return False
    return all(part and part not in ('.', '..', '.git') and not part.endswith(('.', ' '))
               and not any(ord(ch) < 32 for ch in part) for part in value.split('/'))
