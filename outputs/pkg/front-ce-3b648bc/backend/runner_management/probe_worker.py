"""Tiny signed processor used to verify Runner supervision without MQ access."""
import os
import signal
import time

running = True


def stop(*_args):
    global running
    running = False


signal.signal(signal.SIGTERM, stop)
if hasattr(signal, "SIGBREAK"):
    signal.signal(signal.SIGBREAK, stop)

print(f"READY queue={os.getenv('RUNNER_QUEUE', '')}", flush=True)
while running:
    time.sleep(0.2)
print("STOPPED", flush=True)
