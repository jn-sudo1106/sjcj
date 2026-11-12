"""Runner adapter for the shared program launcher; keeps the existing CLI."""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import signal
import sys
from .program_launcher import ProgramLauncher
from .runner import Runner, announce_instance


class Bootstrapper(ProgramLauncher):
    def __init__(self, directory: Path, server: str, client=None):
        super().__init__(directory, server, client if client is not None else Runner(directory, server))

    def launch_spec(self, digest):
        env = os.environ.copy()
        env["RUNNER_RELEASE_DIGEST"] = digest
        if digest == "source-local":
            target = Path(__file__).resolve().parent
            command = [sys.executable, str(target / "start.py"), "--worker", "--dir", str(self.directory),
                       "--server", self.client.server]
        else:
            target, manifest = self.download(digest)
            env["PYTHONPATH"] = str(target)
            command = [sys.executable, "-m", manifest["entryModule"], "--dir", str(self.directory),
                       "--server", self.client.server]
        return command, target, env

    def create_capture(self, digest):
        from .runtime_logs import ConsoleCapture
        self.client.logs.event(self.capture_id, 'created', 'Runner 主进程启动', kind='runner', runnerVersion=digest)
        return ConsoleCapture(self.client.logs, 'runner', self.capture_id)

    def started(self, digest, child):
        announce_instance(self.client.identity['runnerId'], self.directory, digest)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, required=True)
    parser.add_argument("--server", default="http://127.0.0.1:8092")
    parser.add_argument("--interval", type=float, default=10)
    args = parser.parse_args()
    bootstrapper = Bootstrapper(args.dir, args.server)
    signal.signal(signal.SIGTERM, lambda *_: setattr(bootstrapper, "running", False))
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, lambda *_: setattr(bootstrapper, "running", False))
    try:
        bootstrapper.serve(max(0.5, args.interval))
    except KeyboardInterrupt:
        bootstrapper.running = False
        bootstrapper.stop()


if __name__ == "__main__":
    main()
