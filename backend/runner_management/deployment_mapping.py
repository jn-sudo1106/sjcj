"""Place each deployment's Git folder below its resource's environment root."""
from pathlib import PurePosixPath, PureWindowsPath


def relative_directory(value, runner):
    from .server import ApiError
    from .directory_layout import safe_path
    if not isinstance(value, str) or len(value) > 1000:
        raise ApiError('部署目录无效')
    value = value.strip()
    if not value or value == '.': return '.'
    if '{' in value or '}' in value:
        raise ApiError('部署目录请填写实际路径，不支持模板变量')
    root = runner['install_directory']
    kind = PureWindowsPath if PureWindowsPath(root).drive else PurePosixPath
    path = kind(value)
    if kind is PurePosixPath and ('\\' in value or PureWindowsPath(value).drive):
        raise ApiError('所选 Runner 为 Linux，请使用该实例内的部署目录')
    if path.is_absolute():
        try: path = path.relative_to(kind(root))
        except ValueError as error: raise ApiError('部署目录必须位于所选 Runner 实例目录内') from error
    elif path.drive or path.root:
        raise ApiError('部署目录必须位于所选 Runner 实例目录内')
    return '.' if path.as_posix() == '.' else safe_path(path.as_posix(), template=True)


def archive_root(archive):
    from .server import ApiError
    from .directory_layout import safe_path
    if not archive.get('directoryPath'): raise ApiError('生成归档缺少 Git 目录信息')
    root = safe_path(archive['directoryPath'])
    prefix = archive.get('repositoryPrefix', '').strip('/')
    return root + '/' + safe_path(prefix) if prefix else root


def mapping(rule, archive, runner):
    from .directory_layout import safe_path
    source = archive_root(archive)
    root = relative_directory(rule.get('deploymentDirectory', ''), runner)
    destination = PurePosixPath(root) / source
    return {'targetPath': safe_path(destination.as_posix(), template=True), 'sourceBase': source, 'resourceRoot': root}
