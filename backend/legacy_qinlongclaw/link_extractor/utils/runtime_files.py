from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TXT_DIR = PROJECT_ROOT / "txt"
RUNTIME_TXT_FILES = {
    "recent": TXT_DIR / "recent.txt",
    "url_cache": TXT_DIR / "URL.txt",
    "extract_error": TXT_DIR / "errorurl.txt",
    "open_error": TXT_DIR / "error_open_url.txt",
    "no_anchor_urls": TXT_DIR / "无a的url.txt",
    "firefox_urls": TXT_DIR / "firefoxurl.txt",
}


def ensure_runtime_txt_files() -> dict[str, Path]:
    """保证运行所需 txt 目录和文件存在，不覆盖任何已有内容。"""
    TXT_DIR.mkdir(parents=True, exist_ok=True)
    for file_path in RUNTIME_TXT_FILES.values():
        file_path.touch(exist_ok=True)
    return RUNTIME_TXT_FILES.copy()
