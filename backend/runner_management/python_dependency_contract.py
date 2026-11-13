"""Known import/distribution aliases; never guess arbitrary PyPI package names."""
import ast
import re

IMPORT_DISTRIBUTIONS = {
    'bs4': 'beautifulsoup4', 'requests': 'requests', 'lxml': 'lxml',
    'pika': 'pika', 'httpx': 'httpx', 'aiohttp': 'aiohttp',
    'selenium': 'selenium', 'playwright': 'playwright', 'yaml': 'PyYAML',
    'PIL': 'Pillow', 'dateutil': 'python-dateutil', 'pandas': 'pandas',
}


def imports(code, known_only=True):
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return set()
    modules = set()
    class Visitor(ast.NodeVisitor):
        def visit_Import(self, node):
            modules.update(alias.name.split('.')[0] for alias in node.names)

        def visit_ImportFrom(self, node):
            if not node.level and node.module:
                modules.add(node.module.split('.')[0])

        def visit_Try(self, node):
            optional = any(handler.type is None or any(isinstance(part, ast.Name) and part.id in
                ('ImportError', 'ModuleNotFoundError') for part in ast.walk(handler.type)) for handler in node.handlers)
            if not optional:
                self.generic_visit(node)

        def visit_If(self, node):
            if isinstance(node.test, ast.Name) and node.test.id == 'TYPE_CHECKING':
                return
            if isinstance(node.test, ast.Attribute) and node.test.attr == 'TYPE_CHECKING':
                return
            self.generic_visit(node)
    Visitor().visit(tree)
    return modules & IMPORT_DISTRIBUTIONS.keys() if known_only else modules


def merge_requirements(text, modules):
    """Preserve existing pins/options/comments and append only missing aliases."""
    normalize = lambda name: re.sub(r'[-_.]+', '-', name).lower()
    declared = {normalize(match.group(1)) for line in text.splitlines()
                if (match := re.match(r'^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)', line))}
    missing = sorted({IMPORT_DISTRIBUTIONS[name] for name in modules
                      if normalize(IMPORT_DISTRIBUTIONS[name]) not in declared})
    if not missing:
        return text
    return text.rstrip() + ('\n' if text.strip() else '') + '\n'.join(missing) + '\n'
