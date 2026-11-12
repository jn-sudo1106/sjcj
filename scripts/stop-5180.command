#!/bin/bash
# 双击停止本地 dev（5180）。
set -uo pipefail

REPO="/Users/liligo/Desktop/JN/JN-sjcj"
PORT=5180
PID_FILE="${REPO}/tmp/dev-5180.pid"

PIDS="$(lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"

if [ -z "${PIDS}" ]; then
  echo "5180 没有在运行"
  rm -f "${PID_FILE}"
  exit 0
fi

echo "停止 5180（PID: ${PIDS}）"
# dev server 是 npm → node 的父子链，先礼后兵：TERM 整组，2 秒不退就 KILL（dev server 没有要落盘的数据）。
for pid in ${PIDS}; do
  pgid="$(ps -o pgid= -p "${pid}" 2>/dev/null | tr -d ' ')"
  if [ -n "${pgid}" ]; then kill -TERM -"${pgid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null; fi
done

for _ in $(seq 1 2); do
  if ! lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "已停止"
    rm -f "${PID_FILE}"
    exit 0
  fi
  sleep 1
done

echo "2s 后仍在监听，强杀 ${PIDS}"
for pid in ${PIDS}; do kill -KILL "${pid}" 2>/dev/null; done
rm -f "${PID_FILE}"
echo "已强制停止"