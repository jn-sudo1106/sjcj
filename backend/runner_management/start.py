"""Copy this folder anywhere, then run `python start.py` inside it."""
from __future__ import annotations

import argparse
import importlib.util
import signal
import sys
from pathlib import Path
from urllib.parse import urlparse


HERE = Path(__file__).resolve().parent
PACKAGE = "runner_management"
if PACKAGE not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        PACKAGE, HERE / "__init__.py", submodule_search_locations=[str(HERE)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)

from runner_management.bootstrapper import Bootstrapper
from runner_management.runner import Runner


def main() -> None:
    parser = argparse.ArgumentParser(description="Runner 文件夹内启动入口")
    parser.add_argument("--server", default="http://127.0.0.1:8092", help="管理服务地址")
    parser.add_argument("--enroll-code", default="", help="首次登记的一次性登记码")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--dir", type=Path, default=HERE / "instance", help=argparse.SUPPRESS)
    args = parser.parse_args()
    directory = args.dir.resolve()
    runner = Runner(directory, args.server)
    if runner.identity and not runner.identity_matches_directory():
        if args.worker:
            raise SystemExit("实例身份属于其他目录，请使用 python start.py 重新登记")
        print("检测到复制的实例身份，将为当前目录登记独立实例。", flush=True)
        # Keep the existing file until enrollment succeeds. A failed enrollment
        # must not destroy credentials or affect the original installation.
        runner.identity = None
    if args.worker:
        if not runner.identity:
            raise SystemExit("实例尚未登记")
        signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "running", False))
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, lambda *_: setattr(runner, "running", False))
        try:
            runner.serve()
        except KeyboardInterrupt:
            runner.running = False
        return
    if not runner.identity:
        if args.enroll_code:
            runner.enroll(args.enroll_code)
        elif urlparse(args.server).hostname in ("127.0.0.1", "localhost", "::1"):
            try:
                runner.enroll()
            except RuntimeError as exc:
                if "登记码" not in str(exc):
                    raise
                code = input("此服务要求登记码，请输入管理页生成的登记码：").strip()
                if not code:
                    raise SystemExit("未输入登记码")
                runner.enroll(code)
        else:
            code = input("远程接入请输入管理页生成的登记码：").strip()
            if not code:
                raise SystemExit("未输入登记码")
            runner.enroll(code)
        print(f"已登记 Runner 实例：{runner.identity['runnerId']}", flush=True)
    print(f"管理服务：{args.server}", flush=True)
    bootstrapper = Bootstrapper(directory, args.server)
    signal.signal(signal.SIGTERM, lambda *_: setattr(bootstrapper, "running", False))
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, lambda *_: setattr(bootstrapper, "running", False))
    try:
        bootstrapper.serve()
    except KeyboardInterrupt:
        bootstrapper.running = False
        bootstrapper.stop()


if __name__ == "__main__":
    main()
