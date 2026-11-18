"""Validated mutations inside a Runner's visible deployment space."""
import base64
import binascii
import hashlib
from pathlib import Path

MAX_FILE = 5 * 1024 * 1024
MAX_TOTAL = 10 * 1024 * 1024
MUTATIONS = ('mkdir', 'upload', 'delete')


def parameters(body):
    from .runner_files import relative
    action = body.get('action')
    if action not in ('list', 'read', *MUTATIONS):
        raise ValueError('文件操作无效')
    path = relative(body.get('path', ''), action)
    result = {'action': action, 'path': path}
    if action == 'upload':
        incoming = body.get('files')
        if not isinstance(incoming, list) or not 1 <= len(incoming) <= 2000:
            raise ValueError('请选择 1 至 2000 个上传文件')
        entries, names, total = [], set(), 0
        for item in incoming:
            if not isinstance(item, dict): raise ValueError('上传文件参数无效')
            name = relative(item.get('path'), 'read')
            if path and not name.startswith(path + '/'):
                raise ValueError('上传文件必须位于当前目录内')
            if name.casefold() in names: raise ValueError('上传文件路径重复')
            names.add(name.casefold())
            encoded = item.get('data')
            if not isinstance(encoded, str) or len(encoded) > (MAX_FILE + 2) // 3 * 4:
                raise ValueError('单文件最多 5 MB')
            try: data = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error): raise ValueError('上传文件编码无效')
            total += len(data)
            if len(data) > MAX_FILE or total > MAX_TOTAL:
                raise ValueError('单文件最多 5 MB，单次合计最多 10 MB')
            entries.append({'path': name, 'data': encoded})
        result['files'] = entries
    if action == 'delete':
        digest = body.get('expectedHash', '')
        if not isinstance(digest, str) or digest and (len(digest) != 64 or any(char not in '0123456789abcdef' for char in digest)):
            raise ValueError('文件摘要无效，请刷新目录')
        result.update(expectedHash=digest, expectedSize=body.get('expectedSize'), expectedModifiedAt=body.get('expectedModifiedAt'))
    return result


def target(root, value):
    from .runner_files import relative
    from .bundle_install import linked
    value = relative(value, 'read')
    root = Path(root).resolve()
    result = root / value
    for part in (result, *result.parents):
        if part == root: break
        if linked(part): raise ValueError('不支持操作符号链接或连接目录')
    if not result.resolve().is_relative_to(root): raise ValueError('路径超出实例目录')
    reserved = {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}
    if any(part.endswith((' ', '.')) or any(char in part for char in '<>:"|?*')
           or part.split('.')[0].casefold() in reserved for part in value.split('/')):
        raise ValueError('文件或目录名称无效')
    return result


def mutate(root, body):
    operation = parameters(body)
    action, path = operation['action'], operation['path']
    if action == 'mkdir':
        target(root, path).mkdir(parents=True, exist_ok=False)
    elif action == 'upload':
        files = [(target(root, item['path']), base64.b64decode(item['data'])) for item in operation['files']]
        names = {str(file).casefold() for file, _ in files}
        for file, _ in files:
            if file.exists(): raise ValueError('上传文件已存在，请先处理同名文件：' + file.name)
            if any(str(parent).casefold() in names or parent.is_file() for parent in file.parents):
                raise ValueError('文件与目录路径冲突')
        for file, data in files:
            file.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation never overwrites an existing deployment file.
            with file.open('xb') as output: output.write(data)
    elif action == 'delete':
        file = target(root, path)
        if file.is_dir():
            try: file.rmdir()
            except OSError as exc:
                if any(file.iterdir()): raise ValueError('目录仍有内容，请先删除目录内的文件后再删除文件夹') from exc
                raise
        else:
            from datetime import datetime, timezone
            stat = file.stat()
            digest = operation['expectedHash']
            if digest:
                if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                    raise ValueError('文件已变化，请刷新目录后再删除')
            elif (operation['expectedSize'] != stat.st_size or operation['expectedModifiedAt'] != datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()):
                raise ValueError('文件已变化，请刷新目录后再删除')
            file.unlink()
    else:
        raise ValueError('文件操作无效')
    return {'ok': True}
