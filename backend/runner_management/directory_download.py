"""Runner-side materialization of manually requested directory snapshots."""
from urllib.request import Request, urlopen
import traceback

from .artifacts import verify_artifact
from .bundle_install import cache_bundle, install_bundle, linked, safe_relative
from .snapshot_reader import read_snapshot


def install_delivery(runner, job):
    def stage(name, message):
        if hasattr(runner, 'logs'):
            runner.logs.event(job['deliveryId'], 'stage', message, stage=name)
    stage('directory-check', '检查下发根目录和路径权限')
    root = job['targetPath']
    if (not safe_relative(root) or '{' in root or '}' in root
            or root.split('/')[0].casefold() in {'code', 'logs', 'versions', 'runner-versions', '.runtime',
                                               'identity.json', 'current.json', 'previous.json', 'instance.lock'}):
        raise ValueError('下发目录不能覆盖 Runner 的程序、日志或身份目录')
    target = runner.directory / root
    cache = runner.directory / 'code'
    # Inspect lexical parents before resolve(): resolving a junction first
    # would hide a redirected directory from the path validation.
    for path in (target, cache / 'artifacts'):
        for parent in (path, *path.parents):
            if parent == runner.directory:
                break
            if linked(parent):
                raise ValueError('下发目录或缓存不能使用符号链接')
        if not path.resolve().is_relative_to(runner.directory):
            raise ValueError('下发目录必须位于 Runner 安装目录下面')
    digest = job['artifactDigest']
    def read(value):
        archive_path = cache / 'artifacts' / (value[7:] + '.zip')
        signature_path = archive_path.with_suffix('.sig')
        if archive_path.is_file() and signature_path.is_file():
            return archive_path.read_bytes(), signature_path.read_text(encoding='ascii')
        request = Request(runner.server + '/api/artifacts/' + value,
                          headers={'Authorization': 'Bearer ' + runner.identity['token']})
        stage('download', '开始下载代码制品 ' + value)
        with urlopen(request, timeout=30) as response:
            archive = response.read(12 * 1024 * 1024 + 1)
            signature = response.headers.get('X-Artifact-Signature', '')
        if len(archive) > 12 * 1024 * 1024:
            raise ValueError('下发代码包超过 12 MB')
        stage('verify', '校验代码摘要和签名')
        verify_artifact(archive, value, signature, runner.identity['publicKey'])
        cache_bundle(cache, value, archive, signature)
        return archive, signature
    files, manifest = read_snapshot(read, digest, runner.identity['publicKey'])
    if (manifest.get('deliverySchema') not in (1, 2) or manifest.get('deliveryRoot') != root
            or manifest.get('bindingType') != job['bindingType'] or manifest.get('ownerId') != job['ownerId']
            or manifest.get('layoutRevision') != job['layoutRevision'] or manifest.get('versionFile') != 'version.json'):
        raise ValueError('代码包与下发任务的目录配置不一致')
    stage('install', '开始写入目标目录 ' + str(target))
    install_bundle(target, files, manifest, digest, cache, runner.identity['publicKey'])
    stage('installed', '文件和 version.json 已写入 ' + str(target))
    return str(target)


def deliver_pending(runner):
    for job in runner.get('/api/runners/me/directory-deliveries'):
        path = '/api/runners/me/directory-deliveries/' + job['deliveryId']
        runner.post(path + '/claim', {})
        try:
            installed = install_delivery(runner, job)
            result = {'status': 'success', 'installedPath': installed}
        except Exception as exc:
            # Invalid signatures, path conflicts and locked files all belong
            # to this delivery; existing queue processes continue running.
            result = {'status': 'failed', 'error': str(exc) or type(exc).__name__}
            if hasattr(runner, 'logs'):
                runner.logs.event(job['deliveryId'], 'stage', result['error'], stage='failed', level='error', detail=traceback.format_exc())
        runner.post(path + '/result', result)
        if hasattr(runner, 'logs'):
            runner.logs.pump()
