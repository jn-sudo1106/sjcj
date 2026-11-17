"""Supported program entries; EXE processes are launched directly by Python."""
def entry_kind(path):
    if isinstance(path, str):
        if path.lower().endswith('.py'):
            return 'python'
        if path.lower().endswith('.exe'):
            return 'executable'
    raise ValueError('入口必须是 Python（.py）或 Windows 可执行文件（.exe）')


def executable_image(data):
    """Require a PE image, including normal Windows and .NET executables."""
    if len(data) < 64 or data[:2] != b'MZ':
        raise ValueError('EXE 启动文件不是有效的 Windows 可执行程序')
    offset = int.from_bytes(data[60:64], 'little')
    if offset < 64 or offset + 24 > len(data) or data[offset:offset + 4] != b'PE\0\0':
        raise ValueError('EXE 启动文件缺少有效的 PE 文件头')


def executable_runner(runner):
    import json
    if not str(runner['platform']).lower().startswith('win'):
        raise ValueError('EXE 入口仅支持 Windows Runner，请选择 Windows 部署资源')
    if 'executable-entry' not in json.loads(runner['capabilities']):
        raise ValueError('此 Runner 尚不支持 EXE 入口，请先升级 Runner')
