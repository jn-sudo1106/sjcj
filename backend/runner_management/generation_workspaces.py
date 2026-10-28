"""Stable node workspaces, serialized generation, and per-task JSON receipts."""
import base64
import contextlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath

_GUARD = threading.Lock()
_LOCKS = {}


def directory(body):
    from .directory_layout import safe_path
    from .server import ApiError
    mode = body.get('workspaceMode', 'config')
    custom = body.get('workspacePath', '')
    if not isinstance(custom, str) or len(custom) > 500:
        raise ApiError('自定义工作目录无效')
    if mode == 'config':
        value = body.get('configId', '')
    elif mode == 'queue':
        value = body.get('queueName', '')
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,119}', value):
            raise ApiError('按 MQ 名称生成时，请配置有效的单个队列名称')
    elif mode == 'custom':
        value = custom.strip()
    else:
        raise ApiError('工作目录规则无效')
    value = safe_path(value)
    if any(part.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
           or ':' in part or part.endswith((' ', '.')) for part in value.split('/')):
        raise ApiError('工作目录包含无效名称')
    return value


@contextlib.contextmanager
def serialized(server_id, workspace, timeout):
    from .server import ApiError
    windows = bool(PureWindowsPath(workspace).drive or '\\' in workspace)
    path = str(PureWindowsPath(workspace)).casefold() if windows else str(PurePosixPath(workspace))
    key = (server_id, path)
    with _GUARD:
        entry = _LOCKS.setdefault(key, [threading.Lock(), 0])
        entry[1] += 1
    acquired = False
    try:
        acquired = entry[0].acquire(timeout=timeout)
        if not acquired:
            raise ApiError('该工作目录正在生成代码，请等待当前任务完成后重试', 409)
        yield
    finally:
        if acquired:
            entry[0].release()
        with _GUARD:
            entry[1] -= 1
            if not entry[1]:
                del _LOCKS[key]


def receipt(app, server_id, workspace, **fields):
    from .code_servers import operation
    from .generated_archives import relative_workspace_path
    path = relative_workspace_path(app, server_id, workspace['taskRecordPath'])
    record = {'taskId': workspace['taskId'], 'workspace': workspace['prjDir'], **fields}
    encoded = base64.b64encode(json.dumps(record, ensure_ascii=False, indent=2).encode('utf8')).decode('ascii')
    operation(app, server_id, {'action': 'upload', 'overwrite': True, 'files': [{'path': path, 'data': encoded}]})


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')
