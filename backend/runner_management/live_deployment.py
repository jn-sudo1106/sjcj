"""Conservative shared policy for updating a directory while a program uses it."""
import ast
import io
import json
import zipfile


def validate(before, after, programs):
    """Only independent top-level scripts may change; running signed files stay exact."""
    folded = lambda files: {name.casefold(): (name, data) for name, data in files.items() if name != 'manifest.json'}
    old, new = folded(before), folded(after)
    if len(old) != len(before) or len(new) != len(after): raise ValueError('文件大小写或名称冲突')
    for name in old.keys() - new.keys(): raise ValueError('需要删除已下发文件，请先停止目标目录中的处理程序：' + old[name][0])
    imported = set()
    for program in programs:
        for name, data in program.items():
            if name == 'manifest.json': continue
            candidate = new.get(name.casefold())
            if not candidate or candidate[1] != data:
                raise ValueError('运行入口或已签名依赖发生变化，请先停止处理程序：' + name)
            if not name.endswith('.py'): continue
            try: tree = ast.parse(data.decode('utf-8-sig'))
            except (SyntaxError, UnicodeError): raise ValueError('无法确认运行程序依赖，请先停止处理程序')
            for node in ast.walk(tree):
                if isinstance(node, ast.Import): imported.update(alias.name.split('.')[0].casefold() for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module: imported.add(node.module.split('.')[0].casefold())
    for key, (name, data) in new.items():
        if key in old and old[key][1] == data: continue
        if ('/' in name or not name.endswith('.py') or name.casefold() in ('__init__.py', 'sitecustomize.py', 'usercustomize.py')
                or name.split('.')[0].casefold() in imported):
            raise ValueError('公共依赖或非独立脚本发生变化，请先停止处理程序：' + name)
        try: ast.parse(data.decode('utf-8-sig'))
        except (SyntaxError, UnicodeError): raise ValueError('新增或修改的脚本不是有效 Python 文件：' + name)


def server_programs(app, db, processes):
    from .artifacts import verify_artifact
    result = []
    for process in processes:
        identifier = str(process.get('assignmentId') or '').split(':')[0]
        row = db.execute('SELECT r.digest,r.signature FROM assignments a JOIN releases r ON r.digest=a.release_digest WHERE a.assignment_id=?', (identifier,)).fetchone()
        if not row: raise ValueError('无法确认运行程序版本，请先停止处理程序')
        raw = app.artifacts.read(row['digest']); verify_artifact(raw, row['digest'], row['signature'], app.artifacts.public_key)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            if manifest.get('executionSchema') != 2: raise ValueError('旧式队列程序需停止后部署')
            from .python_cache import is_python_cache
            result.append({name: archive.read(name) for name in archive.namelist() if name != 'manifest.json'
                           and not is_python_cache(name) and name.split('/')[0] != '.venv'})
    return result


def runner_programs(runner, target):
    result = []
    for key, (digest, child, _) in list(runner.processes.items()):
        if child.poll() is not None: continue
        directory = runner.process_info.get(key, {}).get('workingDirectory')
        if not directory: raise ValueError('正在启动处理程序，请稍后下发')
        from pathlib import Path
        directory = Path(directory)
        if directory != target and directory not in target.parents and target not in directory.parents: continue
        if directory != target: raise ValueError('父级或子级目录中有程序运行，请先停止后部署')
        release, manifest = runner.prepare(digest)
        if manifest.get('executionSchema') != 2: raise ValueError('旧式队列程序需停止后部署')
        from .python_cache import is_python_cache
        result.append({path.relative_to(release).as_posix(): path.read_bytes() for path in release.rglob('*')
                       if path.is_file() and path.name != 'manifest.json' and not is_python_cache(path.relative_to(release).as_posix())
                       and path.relative_to(release).parts[0] != '.venv'})
    return result
