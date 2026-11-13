"""Late-bound generation variables and the explicit file/output contract."""
import re
from pathlib import PurePosixPath, PureWindowsPath


def bind_source_url(body, previous_url=''):
    """Rebind reused node prompts to this task's source, including old snapshots."""
    current = body.get('url')
    if not isinstance(current, str) or not current.startswith(('http://', 'https://')): return body
    result = dict(body)
    target = re.compile(r'(?im)^([ \t]*(?:[-*][ \t]+)?(?:目标新闻列表\s*URL|目标列表\s*URL|新闻列表地址|目标新闻列表地址)[ \t]*[:：][ \t]*`?)(https?://[^\s`<>]+)')
    for field in ('systemPrompt', 'userPrompt', 'prompt'):
        text = result.get(field)
        if not isinstance(text, str): continue
        if isinstance(previous_url, str) and previous_url and previous_url != current:
            text = text.replace(previous_url, current)
        result[field] = target.sub(lambda match: match.group(1) + current, text)
    return result


def filename(body, service):
    from .server import ApiError
    # Validate the source even when queue naming is selected.
    name = service.file_name_for_url(body.get('url', ''))
    requested = body.get('fileName')
    mode = body.get('fileNameMode', 'website')
    if mode not in ('website', 'queue'): raise ApiError('文件命名方式无效')
    if requested: name = requested
    elif mode == 'queue': name = str(body.get('queueName', '')).strip() + '.py'
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,115}\.py', name) or '..' in name:
        raise ApiError('生成代码文件名无效，请检查命名方式和队列名称')
    if mode == 'queue' and not str(body.get('queueName', '')).strip(): raise ApiError('按队列命名需要有效的队列名称')
    return name


def variables(body, name, workspace=None):
    workspace = workspace or {}
    code_dir = workspace.get('codeDir', '')
    kind = PureWindowsPath if PureWindowsPath(code_dir).drive or '\\' in code_dir else PurePosixPath
    file_path = str(kind(code_dir) / name) if code_dir else ''
    requirement = (f'主代码文件必须命名为 {name}，保存到 {file_path}。其他依赖文件也保存到 {code_dir}，不要写入 input_file_dir 或 output_file_dir；完成文件写入后再返回结果。'
                   if code_dir else f'主代码文件名为 {name}。请在响应正文返回完整 Python 代码，由平台保存文件，不要仅返回服务器文件路径。')
    requirement += (' 检查所有第三方 import，将其实际安装包名合并到代码目录的 requirements.txt，保留已有依赖和版本约束；'
                    '例如 from bs4 import BeautifulSoup 对应 beautifulsoup4，不是 bs4。标准库和项目内模块不写入。'
                    '不得只生成脚本而遗漏依赖清单，不执行 pip 安装；无法确定安装包名时明确报告原因，不猜测包名。')
    result = {'url': body['url'], 'source_url': body['url'], 'file_name': name, 'code_dir': code_dir,
              'code_file_path': file_path, 'code_save_requirement': requirement,
              'prj_dir': workspace.get('prjDir', ''), 'input_file_dir': workspace.get('inputFileDir', ''),
              'output_file_dir': workspace.get('outputFileDir', ''), 'config_id': str(body.get('configId') or ''),
              'queue_name': str(body.get('queueName') or ''), 'task_id': str(workspace.get('taskId') or body.get('taskId') or '')}
    result['reference_files'] = '\n'.join(str(kind(workspace.get('inputFileDir', '')) / PurePosixPath(item['path']).name) for item in body.get('_referenceSnapshot', []))
    for alias, key in {'sourceUrl':'url','fileName':'file_name','codeDir':'code_dir','codeFilePath':'code_file_path',
                       'configId':'config_id','queueName':'queue_name','taskId':'task_id'}.items(): result[alias] = result[key]
    return result


def fill(text, values):
    return re.sub(r'\{\{\s*(\w+)\s*\}\}|\$\{(\w+)\}',
                  lambda match: values.get(match.group(1) or match.group(2), match.group()), text)


def compose(system, user, values):
    context = (f'【本次代码生成配置】\n目标列表 URL：{values["url"]}\n生成文件名：{values["file_name"]}\n'
               + (f'代码保存目录：{values["code_dir"]}\n' if values['code_dir'] else '')
               + (f'输入参考文件：\n{values["reference_files"]}\n' if values.get('reference_files') else '')
               + f'代码保存要求：{values["code_save_requirement"]}\n【代码生成配置结束】')
    return f'{context}\n\n系统要求：\n{fill(system.strip(), values)}\n\n用户要求：\n{fill(user.strip(), values)}'
