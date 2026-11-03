"""Interpret Runner identities using the client OS, never the API host's OS."""
import ntpath
import posixpath
import re


def install_directory(value, platform, *, legacy=False):
    if not isinstance(value, str) or not value.strip() or len(value) > 1024 or any(ord(c) < 32 for c in value):
        raise ValueError('installDirectory 无效')
    value = value.strip()
    if platform == 'win32':
        # Older Linux APIs mistakenly resolved D:\... below their working dir.
        if legacy:
            match = re.fullmatch(r'/[^\x00]*?/([a-zA-Z]:[\\/].*)', value)
            if match:
                value = match.group(1)
        drive, tail = ntpath.splitdrive(value)
        if not drive or not tail.startswith(('\\', '/')):
            raise ValueError('installDirectory 必须为 Runner 的绝对路径')
        return ntpath.normpath(value)
    if not value.startswith('/'):
        raise ValueError('installDirectory 必须为 Runner 的绝对路径')
    return posixpath.normpath(value)


def directory_key(value, platform, *, legacy=False):
    value = install_directory(value, platform, legacy=legacy)
    return ntpath.normcase(value) if platform == 'win32' else value


def reported_name(value, fallback):
    if value is None or value == '':
        return fallback
    if not isinstance(value, str) or not value.strip() or len(value) > 100 or any(ord(c) < 32 for c in value):
        raise ValueError('Runner 名称无效')
    return value.strip()
