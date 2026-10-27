"""Machine-local management settings; passwords use Windows user-bound DPAPI."""
from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path

SETTINGS_FILE = Path(__file__).resolve().parents[1] / '.runtime' / 'runner-management.local.json'
DATABASE_KEYS = ('RUNNER_DB_HOST', 'RUNNER_DB_PORT', 'RUNNER_DB_NAME', 'RUNNER_DB_USER')
OPTIONAL_KEYS = ('RUNNER_DATA_DIR', 'RUNNER_DEV_MODE', 'RUNNER_HOST', 'RUNNER_PORT', 'RUNNER_LAN_HOST', 'RUNNER_AUTH_URL', 'RUNNER_NODE_TYPE_BACKEND')


def _dpapi(data: bytes, protect: bool) -> bytes:
    if os.name != 'nt':
        raise RuntimeError('本机数据库密码由 Windows 加密，请在原 Windows 用户下运行或通过环境变量配置数据库')
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    incoming, outgoing = Blob(len(data), buffer), Blob()
    library = ctypes.WinDLL('crypt32', use_last_error=True)
    operation = library.CryptProtectData if protect else library.CryptUnprotectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise RuntimeError('无法读取本机加密数据库密码，请使用原 Windows 用户或重新配置数据库')
    free = ctypes.WinDLL('kernel32', use_last_error=True).LocalFree
    free.argtypes, free.restype = [ctypes.c_void_p], ctypes.c_void_p
    try:
        return ctypes.string_at(outgoing.data, outgoing.length)
    finally:
        free(outgoing.data)


def protect_password(password: str) -> str:
    return base64.b64encode(_dpapi(password.encode('utf-8'), True)).decode('ascii')


def unprotect_password(value: str) -> str:
    return _dpapi(base64.b64decode(value, validate=True), False).decode('utf-8')


def load_local_settings(path: Path | None = None) -> bool:
    """Explicit complete environment wins; a broken saved config never falls back to SQLite."""
    if os.getenv('RUNNER_DB_HOST'):
        if any(not os.getenv(key) for key in ('RUNNER_DB_NAME', 'RUNNER_DB_USER')) or 'RUNNER_DB_PASSWORD' not in os.environ:
            raise RuntimeError('MySQL 环境变量不完整，请配置数据库名、用户名和密码；为避免空数据，已停止启动')
        return False
    explicit = os.getenv('RUNNER_SETTINGS_FILE')
    default_file = Path(os.getenv('RUNNER_DATA_DIR', str(SETTINGS_FILE.parent))) / SETTINGS_FILE.name
    file = path or (Path(explicit) if explicit else default_file)
    if not file.is_file():
        if explicit:
            raise RuntimeError('指定的 Runner 本机配置文件不存在；为避免连接空数据库，已停止启动')
        return False
    try:
        config = json.loads(file.read_text(encoding='utf-8-sig'))
        environment = config['environment']
        if config.get('version') != 1 or not isinstance(environment, dict):
            raise ValueError('invalid schema')
        for key in DATABASE_KEYS:
            if not isinstance(environment.get(key), str) or not environment[key].strip():
                raise ValueError('missing database setting')
        if not 1 <= int(environment['RUNNER_DB_PORT']) <= 65535:
            raise ValueError('invalid port')
        if not isinstance(config.get('passwordProtected'), str):
            raise ValueError('missing encrypted password')
        password = unprotect_password(config['passwordProtected'])
        for key in OPTIONAL_KEYS:
            if key in environment and not isinstance(environment[key], str):
                raise ValueError('invalid optional setting')
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError('Runner 本机数据库配置无效；为避免连接空数据库，已停止启动') from error
    # Set credentials together, only after the complete saved configuration was validated.
    os.environ.update({key: environment[key] for key in DATABASE_KEYS})
    os.environ['RUNNER_DB_PASSWORD'] = password
    for key in OPTIONAL_KEYS:
        if key in environment:
            os.environ.setdefault(key, environment[key])
    return True
