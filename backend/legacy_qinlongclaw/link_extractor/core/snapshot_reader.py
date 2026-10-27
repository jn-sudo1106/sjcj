"""Verify full snapshots and sparse snapshots with direct signed file origins."""
import base64
import hashlib
import io
import json
import re
import zipfile

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def safe_relative(value):
    return (isinstance(value, str) and 0 < len(value) <= 400
            and not any(ch in value for ch in '\\:<>"|?*')
            and all(part and part not in ('.', '..', '.git') and not part.endswith(('.', ' '))
                    and part.upper().split('.')[0] not in {'CON', 'PRN', 'AUX', 'NUL',
                        *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
                    and not any(ord(ch) < 32 for ch in part) for part in value.split('/')))


def read_snapshot(read_bundle, digest, public_key):
    """read_bundle returns ZIP bytes and signature; origins never recurse."""
    raw_cache = {}

    def raw(value):
        if not isinstance(value, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', value):
            raise ValueError('本地版本摘要无效')
        if value not in raw_cache:
            data, signature = read_bundle(value)
            actual = hashlib.sha256(data).hexdigest()
            if len(data) > 12 * 1024 * 1024 or value != 'sha256:' + actual:
                raise ValueError('版本缓存摘要校验失败')
            key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key, validate=True))
            key.verify(base64.b64decode(signature, validate=True), bytes.fromhex(actual))
            files, folded, total = {}, set(), 0
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if len(archive.infolist()) > 2001:
                    raise ValueError('版本缓存文件数量过多')
                for info in archive.infolist():
                    total += info.file_size
                    if (not safe_relative(info.filename) or info.is_dir() or total > 12 * 1024 * 1024
                            or info.filename.casefold() in folded
                            or (info.external_attr >> 16) & 0o170000 == 0o120000):
                        raise ValueError('版本缓存包含非法文件')
                    folded.add(info.filename.casefold())
                    files[info.filename] = archive.read(info)
            manifest = json.loads(files['manifest.json'])
            if (not isinstance(manifest, dict) or manifest.get('kind') != 'script'
                    or manifest.get('layoutSchema') not in (None, 1, 2)):
                raise ValueError('本地版本清单无效')
            raw_cache[value] = (files, manifest)
        return raw_cache[value]

    physical, manifest = raw(digest)
    files = dict(physical)
    origins = {name: {'digest': digest, 'path': name, 'sha256': hashlib.sha256(data).hexdigest()}
               for name, data in physical.items() if name != 'manifest.json'}
    retained = manifest.get('retainedFiles', {})
    if not isinstance(retained, dict) or len(retained) > 2000:
        raise ValueError('保留文件清单无效')
    if retained and (manifest.get('deliverySchema') != 2 or manifest.get('deliveryScope') != 'selected'):
        raise ValueError('保留文件只能用于部分下发')
    folded = {name.casefold() for name in files}
    for name, origin in retained.items():
        if (not safe_relative(name) or name.casefold() in folded or name.casefold() in ('manifest.json', 'version.json')
                or not isinstance(origin, dict) or not safe_relative(origin.get('path'))
                or origin['path'].casefold() in ('manifest.json', 'version.json')
                or not re.fullmatch(r'[0-9a-f]{64}', str(origin.get('sha256', '')))):
            raise ValueError('保留文件路径或摘要无效')
        source, _ = raw(origin.get('digest'))
        data = source.get(origin['path'])
        if data is None or hashlib.sha256(data).hexdigest() != origin['sha256']:
            raise ValueError('保留文件与签名版本不一致')
        files[name] = data
        origins[name] = origin
        folded.add(name.casefold())
    if len(files) > 2001 or sum(map(len, files.values())) > 12 * 1024 * 1024:
        raise ValueError('合并后的代码包超过文件数量或大小限制')
    names = {name.casefold() for name in files}
    if any('/'.join(name.split('/')[:i]).casefold() in names
           for name in files for i in range(1, len(name.split('/')))):
        raise ValueError('代码包文件和目录路径冲突')
    manifest = {**manifest, 'fileOrigins': origins}
    if manifest.get('layoutSchema') is None:
        manifest.update(layoutSchema=2, directoryTemplate='{configId}', versionFile='version.json', directories=[], sources=[])
    return files, manifest
