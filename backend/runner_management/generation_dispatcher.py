"""Fill idle agent leases even while an older CodeServer poller executes a task."""
import json
import logging
import threading
import time
from urllib.request import urlopen

LOCK = threading.Lock()
WORKERS = {}
MAX_WORKERS = 64
LOG = logging.getLogger(__name__)


class BackgroundResponse:
    close_connection = True

    def send_response(self, *_):
        # execute keeps recording progress/output in the task when no client is
        # connected. The background dispatcher does not need another HTTP stream.
        raise OSError('background task has no browser response')


def dispatch(app):
    from . import code_servers, database_generation as tasks
    with app.store.connect() as db:
        if not db.execute("SELECT 1 FROM jobs WHERE job_type='generation' AND (status='queued' OR (status='claimed' AND lease_until<?)) LIMIT 1", (time.time(),)).fetchone():
            return
    for server in code_servers.registry(app):
        if server['status'] != 'online' or not server.get('mqCapable'):
            continue
        try:
            with urlopen(code_servers.relay_request(app, server['serverId'], 'control', {'action': 'status'}), timeout=5) as response:
                status = json.load(response)
            if status.get('draining'):
                continue
            while True:
                with LOCK:
                    if len(WORKERS) >= MAX_WORKERS:
                        return
                job = tasks.claim(app, server).get('job')
                if not job:
                    break
                task_id = job['taskId']

                def execute(machine=server, identifier=task_id):
                    try:
                        tasks.execute(BackgroundResponse(), app, machine, identifier)
                    except Exception:
                        LOG.exception('智能体任务执行失败 TaskID=%s', identifier)
                    finally:
                        with LOCK:
                            WORKERS.pop(identifier, None)

                worker = threading.Thread(target=execute, name='agent-task-' + task_id[:12], daemon=True)
                with LOCK:
                    WORKERS[task_id] = worker
                try:
                    worker.start()
                except Exception:
                    with LOCK:
                        WORKERS.pop(task_id, None)
                    raise
        except Exception:
            LOG.exception('智能体资源调度失败 ServerID=%s', server['serverId'])
