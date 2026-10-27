"""Operating system information reported by each Runner, not the API host."""
from functools import lru_cache
import platform
import sys


@lru_cache(maxsize=1)
def operating_system_info():
    system = platform.system()
    kind = {'Darwin': 'macOS'}.get(system, system) or sys.platform
    try:
        if system == 'Windows':
            release, build, service_pack, _ = platform.win32_ver()
            edition = platform.win32_edition() or ''
            version = ' '.join(filter(None, (release, edition, service_pack)))
            if build:
                version = f'{version} · {build}' if version else build
        elif system == 'Linux':
            try:
                distribution = platform.freedesktop_os_release().get('PRETTY_NAME', '')
            except OSError:
                distribution = ''
            kernel = platform.release()
            version = f'{distribution} · {kernel}' if distribution and kernel else distribution or kernel
        elif system == 'Darwin':
            version = platform.mac_ver()[0] or platform.release()
        else:
            version = platform.release()
    except (OSError, ValueError):
        version = ''
    return {'osType': ' '.join(kind.split())[:64], 'osVersion': ' '.join(version.split())[:255]}
