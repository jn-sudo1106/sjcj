"""Durable asynchronous uploads; logs never travel in heartbeat requests."""
from __future__ import annotations
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading
import time
import uuid

from .runtime_history import redact


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


class LogQueue:
    def __init__(self, directory, post):
        self.root = Path(directory) / 'logs'
        self.spool = self.root / 'spool'
        self.spool.mkdir(parents=True, exist_ok=True)
        self.post = post
        self.lock = threading.RLock()
        self.upload_lock = threading.Lock()
        self.pending = {}
        self.sequences = {}
        self.last_flush = time.monotonic()
        self.last_error = ''
        self.enqueue_stamp = 0
        self.thread = None
        self.local_limit = int(os.getenv('RUNNER_LOCAL_LOG_QUOTA_MB', '1024')) * 1024 * 1024
        self.active_files = set()
        self.local_bytes = 0
        self.last_maintenance = 0
        self.drop_path = self.root / 'dropped-lines.json'
        try:
            self.drops = json.loads(self.drop_path.read_text(encoding='utf-8'))
            for stream_id, drop in self.drops.items(): self.sequences[stream_id] = drop['previousSeq']
        except (OSError, ValueError, KeyError):
            self.drops = {}
        self.maintenance()

    def save_drops(self):
        temporary = self.drop_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.drops), encoding='utf-8'); os.replace(temporary, self.drop_path)

    def maintenance(self):
        with self.lock:
            if time.monotonic() - self.last_maintenance < 2:
                return
            self.last_maintenance = time.monotonic()
            files = []
            for p in self.root.rglob('*'):
                try:
                    if p.is_file() and not p.is_symlink():
                        files.append((p, p.stat()))
                except FileNotFoundError:
                    # Bootstrapper and Runner can acknowledge the same spool concurrently.
                    continue
            self.local_bytes = sum(stat.st_size for _, stat in files)
            candidates = sorted(((p, stat) for p, stat in files if (p.suffix == '.log' or p.parent.name == 'rejected') and p not in self.active_files and stat.st_mtime < time.time() - 30), key=lambda item: item[1].st_mtime)
            for p, stat in candidates:
                if self.local_bytes > self.local_limit * .9 or stat.st_mtime < time.time() - 7 * 86400:
                    try:
                        p.unlink(missing_ok=True); self.local_bytes -= stat.st_size
                    except PermissionError:
                        # Another process still owns this file; never interrupt its capture.
                        continue

    def reserve(self, size):
        self.maintenance()
        if self.local_bytes + size > self.local_limit:
            self.last_error = '日志缓存容量已满；新日志已截断，请恢复网络或扩大日志容量'
            (self.root / 'log-upload-error.txt').write_text(self.last_error, encoding='utf-8')
            return False
        self.local_bytes += size
        return True

    def enqueue(self, endpoint, payload):
        with self.lock:
            encoded = json.dumps({'endpoint': endpoint, 'payload': payload}, ensure_ascii=False).encode('utf-8')
            if not self.reserve(len(encoded)):
                return False
            self.enqueue_stamp = max(time.time_ns(), self.enqueue_stamp + 1)
            path = self.spool / f'{self.enqueue_stamp:020d}-{uuid.uuid4().hex}.json'
            temporary = path.with_suffix('.tmp')
            temporary.write_bytes(encoded); os.replace(temporary, path)
            return True

    def event(self, record_id, action, message='', **extra):
        payload = {'eventId': uuid.uuid4().hex, 'recordId': record_id, 'action': action,
                   'occurredAt': now(), 'message': redact(message), **extra}
        if 'detail' in payload:
            payload['detail'] = redact(payload['detail'])
        self.enqueue('/api/runners/me/runtime-events', payload)

    def output(self, record_id, stream_id, text):
        with self.lock:
            self.pending.setdefault((record_id, stream_id), []).append({'time': now(), 'source': 'console', 'text': redact(text)[:16000]})
            if len(self.pending[(record_id, stream_id)]) >= 20 or time.monotonic() - self.last_flush >= 2:
                self.flush()

    def flush(self):
        with self.lock:
            for (record_id, stream_id), lines in list(self.pending.items()):
                # Cap UTF-8 size as well as line count, including long tracebacks.
                while lines:
                    batch, size = [], 0
                    while lines and len(batch) < 100:
                        line_size = len(json.dumps(lines[0], ensure_ascii=False).encode('utf-8'))
                        if batch and size + line_size > 64000:
                            break
                        batch.append(lines.pop(0)); size += line_size
                    seq = self.sequences.get(stream_id, 0) + 1
                    drop = self.drops.get(stream_id)
                    if drop:
                        batch.insert(0, {'time': now(), 'source': 'console', 'text': f"[日志截断] 本机容量不足，丢失 {drop['count']} 条输出片段；运行程序未因此停止。"})
                    if self.enqueue('/api/runners/me/log-batches', {'recordId': record_id, 'streamId': stream_id, 'seq': seq, 'entries': batch}):
                        self.sequences[stream_id] = seq
                        if drop:
                            del self.drops[stream_id]; self.save_drops()
                    else:
                        self.drops[stream_id] = {'recordId': record_id, 'count': (drop['count'] if drop else 0) + len(batch) - (1 if drop else 0), 'previousSeq': seq - 1}
                        self.save_drops()
            self.pending.clear(); self.last_flush = time.monotonic()

    def ordered_pending(self):
        paths = sorted(self.spool.glob('*.json'))
        # Bound in-memory console bodies while allowing unrelated streams beyond
        # an old conflicting batch to make progress.
        for start in range(0, len(paths), 100):
            pending = []
            for path in paths[start:start + 100]:
                try:
                    item = json.loads(path.read_text(encoding='utf-8'))
                except FileNotFoundError:
                    continue
                payload = item['payload']
                # Windows time_ns can repeat. UUID lexical order must never send
                # batch 13 before batch 12 or output before the created event.
                priority = 0 if payload.get('action') == 'created' else 2 if item['endpoint'].endswith('/log-batches') else 1
                pending.append((path, item, (path.name.split('-', 1)[0], priority,
                                            str(payload.get('streamId', '')), payload.get('seq', 0), path.name)))
            yield from ((path, item) for path, item, _ in sorted(pending, key=lambda row: row[2]))

    def upload(self):
        if not self.upload_lock.acquire(blocking=False):
            return
        try:
            self.flush()
            upload_error, blocked, processed = '', {}, 0
            for path, item in self.ordered_pending():
                stream = item['payload'].get('streamId') if item['endpoint'].endswith('/log-batches') else None
                seq = item['payload'].get('seq', 0)
                if stream in blocked and seq >= blocked[stream]:
                    continue
                try:
                    result = self.post(item['endpoint'], item['payload'])
                except RuntimeError as exc:
                    if getattr(exc, 'http_status', None) == 409:
                        # A missing earlier batch/creation remains queued for a
                        # retry; it must not block unrelated runs and streams.
                        self.last_error = upload_error = redact(exc)[:1000]
                        (self.root / 'log-upload-error.txt').write_text(self.last_error, encoding='utf-8')
                        if stream:
                            blocked[stream] = seq
                        continue
                    if getattr(exc, 'http_status', None) in (400, 403, 404, 413):
                        # Retain rejected records for local diagnosis without blocking new streams.
                        rejected = self.root / 'rejected'; rejected.mkdir(exist_ok=True)
                        if path.exists():
                            os.replace(path, rejected / path.name)
                        self.last_error = upload_error = '部分日志被服务拒收，请检查 logs/rejected：' + redact(exc)
                        (self.root / 'log-upload-error.txt').write_text(self.last_error, encoding='utf-8')
                        processed += 1
                        if processed >= 100:
                            break
                        continue
                    raise
                if 'seq' in item['payload'] and result.get('ack', 0) < item['payload']['seq']:
                    raise RuntimeError('日志上传没有收到持久化确认')
                with self.lock:
                    if path.exists():
                        size = path.stat().st_size; path.unlink(missing_ok=True); self.local_bytes = max(0, self.local_bytes - size)
                if stream in blocked:
                    del blocked[stream]
                processed += 1
                if processed >= 100:
                    break
            self.last_error = upload_error
            if not upload_error:
                (self.root / 'log-upload-error.txt').unlink(missing_ok=True)
            # Once space is released, report gaps even if the failed program no longer prints.
            with self.lock:
                for stream_id, drop in list(self.drops.items()):
                    seq = self.sequences.get(stream_id, drop['previousSeq']) + 1
                    notice = {'time': now(), 'source': 'console', 'text': f"[日志截断] 本机容量不足，丢失 {drop['count']} 条输出片段。"}
                    if self.enqueue('/api/runners/me/log-batches', {'recordId': drop['recordId'], 'streamId': stream_id, 'seq': seq, 'entries': [notice]}):
                        self.sequences[stream_id] = seq; del self.drops[stream_id]; self.save_drops()
        except Exception as exc:
            self.last_error = redact(exc)[:1000]
            (self.root / 'log-upload-error.txt').write_text(self.last_error, encoding='utf-8')
        finally:
            self.upload_lock.release()

    def pump(self):
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self.upload, name='runner-log-upload', daemon=True)
            self.thread.start()


class ConsoleCapture:
    def __init__(self, queue, runtime_id, run_id):
        self.queue, self.run_id = queue, run_id
        self.stream_id = uuid.uuid4().hex
        # Generated IDs only; never place queue names or slot colons in filenames.
        safe_runtime = ''.join(c for c in runtime_id if c.isalnum() or c in '-_') or 'unbound'
        self.directory = queue.root / 'runner' / run_id if safe_runtime == 'runner' else queue.root / 'programs' / safe_runtime / run_id
        self.directory.mkdir(parents=True, exist_ok=True)
        self.part, self.size = 1, 0
        self.file = (self.directory / 'console-0001.log').open('a', encoding='utf-8')
        self.queue.active_files.add(Path(self.file.name))
        self.thread = None

    def attach(self, pipe):
        def read():
            try:
                # Bounded fragments handle programs that emit no newline.
                while True:
                    data = pipe.readline(12000)
                    if not data:
                        break
                    text = data.decode('utf-8', errors='replace').rstrip('\r\n')
                    safe = redact(text)
                    length = len(safe.encode('utf-8')) + 1
                    if self.size + length > 10 * 1024 * 1024:
                        self.queue.active_files.discard(Path(self.file.name))
                        self.file.close(); self.part += 1; self.size = 0
                        self.file = (self.directory / f'console-{self.part:04d}.log').open('a', encoding='utf-8')
                        self.queue.active_files.add(Path(self.file.name))
                    with self.queue.lock:
                        if self.queue.reserve(length):
                            self.file.write(safe + '\n'); self.file.flush(); self.size += length
                    self.queue.output(self.run_id, self.stream_id, text)
            finally:
                pipe.close(); self.queue.active_files.discard(Path(self.file.name)); self.file.close(); self.queue.flush()
        self.thread = threading.Thread(target=read, name='program-console-' + self.run_id, daemon=True)
        self.thread.start()

    def close(self):
        if self.thread:
            self.thread.join(timeout=2)
        elif not self.file.closed:
            self.queue.active_files.discard(Path(self.file.name))
            self.file.close()
        self.queue.flush()
