#!/bin/bash
# 双击启动本地 dev（5180）。已在运行就直接开浏览器，不重复起。
# 环境变量与 .claude/launch.json 的 sjcj-dev 一致：业务后端走 186、runner 走本机 18092。
set -uo pipefail

REPO="/Users/liligo/Desktop/JN/JN-sjcj"
PORT=5180
URL="http://localhost:${PORT}/"
LOG="${REPO}/tmp/dev-5180.log"
PID_FILE="${REPO}/tmp/dev-5180.pid"

mkdir -p "${REPO}/tmp"

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "5180 已在运行，直接打开 ${URL}"
  open "${URL}"
  exit 0
fi

cd "${REPO}" || { echo "仓库目录不存在：${REPO}"; exit 1; }

export VITE_API_PROXY_TARGET=http://124.223.180.186:9999
export VITE_DATA_PROCESS_PROXY_TARGET=http://124.223.180.186:9999
export VITE_RUNNER_MANAGEMENT_PROXY_TARGET=http://127.0.0.1:18092

echo "启动 dev（端口 ${PORT}）……日志：${LOG}"
nohup npm --prefix app run dev -- --port "${PORT}" --strictPort >"${LOG}" 2>&1 &
echo $! >"${PID_FILE}"

for _ in $(seq 1 90); do
  if curl -sf -o /dev/null "${URL}"; then
    echo "已就绪：${URL}"
    open "${URL}"
    exit 0
  fi
  sleep 1
done

echo "启动超时（90s），日志最后 20 行："
tail -n 20 "${LOG}"
exit 1