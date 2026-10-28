"""Python's interpreter-owned cache is not deployment source code."""


def is_python_cache(path):
    # Keep explicitly supplied bytecode outside this reserved directory under
    # normal integrity checks; only interpreter-owned __pycache__ is ignored.
    return '__pycache__' in str(path).replace('\\', '/').casefold().split('/')
