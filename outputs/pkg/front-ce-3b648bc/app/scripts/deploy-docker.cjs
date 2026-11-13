#!/usr/bin/env node
/**
 * Docker 容器化部署与切流脚本 (sjcj-gateway)
 *
 * 用法（SSH 密码从环境变量读，不写进仓库）：
 *   SJCJ_SSH_PASSWORD=*** node deploy-docker.js deploy    # 一步到位：test 自检通过就直接 release，不通过停在 8086、不碰 806
 *   SJCJ_SSH_PASSWORD=*** node deploy-docker.js test      # 构建候选镜像，在 8086 起一个**独立的**测试容器并自检
 *   SJCJ_SSH_PASSWORD=*** node deploy-docker.js release   # 把 test 验过的那个镜像换上 806（只换容器，不现场构建）
 *   SJCJ_SSH_PASSWORD=*** node deploy-docker.js cutover   # 首次切流：WAN 交给 systemd 跑 8070，再 release（可重复执行）
 *   SJCJ_SSH_PASSWORD=*** node deploy-docker.js rollback  # 紧急回滚：停网关，WAN 经 systemd 回到 806
 *   SJCJ_SSH_PASSWORD=*** node deploy-docker.js status    # 查看容器、wan.service 与端口
 *
 * 日常更新 = deploy。想先在 8086 用浏览器看一眼再上线，就拆成 test → 看 8086 → release。
 *
 * 上传的是本机工作区，不是 git 提交。deploy / test 上传前会对照 CNB master 检查（见 checkLocalCode），
 * 不一致时终端里要确认；非交互环境直接中止，确需部署加 SJCJ_DEPLOY_FORCE=1。
 *
 * 免密：SJCJ_SSH_KEY=~/.ssh/id_ed25519_sjcj 代替 SJCJ_SSH_PASSWORD（deploy / test / release / status 可用，cutover / rollback 要 sudo 仍需密码）。
 *
 * 连 133 环境的另一套（测试 8087、正式 807 / 公网 2807）：前面加 SJCJ_TARGET=133，只支持 deploy / test / release / status。
 *
 * 2026-09-23 重写，修掉第一版的几处线上问题：
 * - WAN 由 systemd 的 wan.service 管（wan 仓库 f11c368 起），第一版却 pkill + nohup 起裸进程：
 *   裸进程崩了没人拉；wan.service 仍是 enabled + PORT=806，机器一重启就和网关抢 806。
 *   `.env.local` 里写 PORT 也没用——Node 的 --env-file 不覆盖已有环境变量，unit 里的 806 赢。
 *   现在改 unit 的 Environment=PORT 并 systemctl restart。
 * - 第一版 cutover 先 `down` 再 `up --build`，构建的几分钟里 806 没人监听；而且 test 和生产
 *   共用 container_name，跑一次 test 就会把生产容器换到 8086。现在 test 用独立容器与候选镜像，
 *   release 只做 tag + 换容器（秒级），上线的就是 8086 上验过的那份。
 * - 健康检查判 `includes('HTTP/1.1')`，网关回 502 也算通过。现在按状态码判。
 * - SSH/sudo 密码有明文默认值，还拼进命令行（`echo pw | sudo -S`，ps 里可见）。
 *   现在只从环境变量读，sudo 密码走 stdin。
 */
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { execFileSync } = require('node:child_process')
const { Client } = require('ssh2')

const action = process.argv[2] || 'test'

/**
 * 部署目标（2026-09-29）：默认 prod = 连 118 的正式平台（806 / 公网 2806）。
 * SJCJ_TARGET=133 部署连 133 环境的另一套：独立目录、镜像、容器、端口，与 prod 互不影响。
 * 133 不共享 WAN 的切流流程，cutover / rollback 只对 prod 开放。
 */
const TARGETS = {
  prod: {
    remoteDir: '/home/leo/sjcj-docker', image: 'sjcj-gateway',
    testPort: '8086', prodPort: '806', publicPort: '2806',
    backend: 'http://118.25.96.217:9999',
  },
  133: {
    remoteDir: '/home/leo/sjcj-docker-133', image: 'sjcj-gateway-133',
    testPort: '8087', prodPort: '807', publicPort: '2807',
    backend: 'http://115.227.21.133:9999',
  },
}
const targetName = process.env.SJCJ_TARGET || 'prod'
const target = TARGETS[targetName]
if (!target) {
  console.error(`\n✗ 失败：未知 SJCJ_TARGET=${targetName}，支持：${Object.keys(TARGETS).join(', ')}\n`)
  process.exit(1)
}

const cfg = {
  host: process.env.SJCJ_REMOTE_HOST || '47.120.11.60',
  port: parseInt(process.env.SJCJ_SSH_PORT || '5031', 10),
  username: process.env.SJCJ_SSH_USER || 'leo',
  password: process.env.SJCJ_SSH_PASSWORD || '',
  // 2026-09-29：可改用私钥登录（如 ~/.ssh/id_ed25519_sjcj），免输密码；sudo（cutover / rollback）仍要密码
  keyPath: process.env.SJCJ_SSH_KEY || '',
  remoteDir: process.env.SJCJ_DOCKER_DIR || target.remoteDir,
  wanDir: process.env.WAN_DIR || '/home/leo/wan',
  testPort: process.env.SJCJ_TEST_PORT || target.testPort,
  prodPort: process.env.SJCJ_PROD_PORT || target.prodPort,
  publicPort: target.publicPort,
  backend: target.backend,
  wanPort: process.env.WAN_INTERNAL_PORT || '8070',
}

const IMAGE = target.image
const CANDIDATE = `${IMAGE}:candidate`
const TEST_CONTAINER = `${IMAGE}-test`
const WAN_UNIT = '/etc/systemd/system/wan.service'

function ok(msg) { console.log(`✓ ${msg}`) }
function warn(msg) { console.log(`⚠ ${msg}`) }
function info(msg) { console.log(`→ ${msg}`) }
function die(msg) { console.error(`\n✗ 失败：${msg}\n`); process.exit(1) }

function getSshClient() {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      ...(cfg.keyPath ? { privateKey: fs.readFileSync(cfg.keyPath) } : { password: cfg.password }),
      readyTimeout: 15000,
      hostVerifier: () => true,
    })
  })
}

/** 远端执行。`stdin` 会写进命令的标准输入（sudo 密码走这里，不进命令行） */
function sshExec(conn, cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      let errOut = ''
      stream.on('data', d => {
        out += d
        if (!opts.silent) process.stdout.write(d)
      })
      stream.stderr.on('data', d => {
        errOut += d
        if (!opts.silent) process.stderr.write(d)
      })
      stream.on('close', code => {
        if (code === 0 || opts.ignoreError) resolve({ code, out: out.trim(), errOut: errOut.trim() })
        else reject(new Error(`命令执行失败 (exit ${code}): ${cmd}\n${errOut}`))
      })
      if (opts.stdin != null) stream.end(opts.stdin)
    })
  })
}

/** root 权限执行一段 shell。脚本经 base64 传过去，免得引号层层转义 */
function sudoExec(conn, script, opts = {}) {
  const b64 = Buffer.from(script).toString('base64')
  return sshExec(conn, `sudo -S -p '' bash -c "$(echo ${b64} | base64 -d)"`, { ...opts, stdin: `${cfg.password}\n` })
}

/** 取 HTTP 状态码（取不到返回 '000'） */
async function httpCode(conn, url) {
  const res = await sshExec(conn, `curl -s -o /dev/null -m 10 -w '%{http_code}' ${url}`, { silent: true, ignoreError: true })
  return res.out || '000'
}

/** 某个响应头（小写名），取不到返回空串 */
async function httpHeader(conn, url, name) {
  const res = await sshExec(conn, `curl -s -o /dev/null -D - -m 10 ${url}`, { silent: true, ignoreError: true })
  const line = res.out.split(/\r?\n/).find(l => l.toLowerCase().startsWith(`${name}:`))
  return line ? line.slice(name.length + 1).trim() : ''
}

async function waitFor(conn, url, accept, { tries = 15, gapSec = 2 } = {}) {
  let code = '000'
  for (let i = 0; i < tries; i++) {
    code = await httpCode(conn, url)
    if (accept.includes(code)) return code
    await sshExec(conn, `sleep ${gapSec}`, { silent: true })
  }
  return code
}

function sftpUploadDir(sftp, localDir, remoteDir) {
  return new Promise((resolve, reject) => {
    const tasks = []
    function walk(local, remote) {
      const entries = fs.readdirSync(local, { withFileTypes: true })
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === '__pycache__' || e.name.endsWith('.pyc')) continue
        const lp = path.join(local, e.name)
        const rp = remote + '/' + e.name
        if (e.isDirectory()) {
          tasks.push({ type: 'dir', remote: rp })
          walk(lp, rp)
        } else {
          tasks.push({ type: 'file', local: lp, remote: rp })
        }
      }
    }
    tasks.push({ type: 'dir', remote: remoteDir })
    walk(localDir, remoteDir)

    let i = 0
    let fileCount = 0
    const total = tasks.filter(t => t.type === 'file').length
    function next() {
      if (i >= tasks.length) return resolve(fileCount)
      const t = tasks[i++]
      if (t.type === 'dir') {
        sftp.mkdir(t.remote, () => next())
      } else {
        sftp.fastPut(t.local, t.remote, err => {
          if (err) return reject(new Error(`上传失败 ${t.remote}: ${err.message}`))
          fileCount++
          if (fileCount % 20 === 0 || fileCount === total) {
            process.stdout.write(`\r  已上传配置文件与源码 ${fileCount}/${total} 个文件`)
          }
          next()
        })
      }
    }
    next()
  })
}

async function checkDocker(conn) {
  info('检查远端 Docker 环境...')
  const res = await sshExec(conn, 'docker --version && docker-compose --version', { silent: true })
  ok(`Docker 可用：${res.out.replace(/\n/g, ' | ')}`)
}

async function syncFiles(conn) {
  info(`同步项目部署文件到远端 ${cfg.remoteDir}...`)
  // 先清掉上一次的源码目录，否则本地删掉的文件在远端还在、会被打进镜像
  await sshExec(conn, `mkdir -p ${cfg.remoteDir} && rm -rf ${cfg.remoteDir}/app ${cfg.remoteDir}/site-script-service`)

  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => err ? reject(err) : resolve(s))
  })

  const rootDir = path.resolve(__dirname, '../..')
  const rootFiles = ['Dockerfile', 'nginx.conf', 'docker-compose.yml', '.dockerignore']
  for (const f of rootFiles) {
    const local = path.join(rootDir, f)
    if (fs.existsSync(local)) {
      await new Promise((resolve, reject) => {
        sftp.fastPut(local, `${cfg.remoteDir}/${f}`, err => err ? reject(err) : resolve())
      })
    }
  }

  const appLocalDir = path.join(rootDir, 'app')
  const count = await sftpUploadDir(sftp, appLocalDir, `${cfg.remoteDir}/app`)
  console.log('\n')
  ok(`文件同步完成，已传输 ${count} 个文件`)
}

/**
 * 会话失效时业务后端 302 到 logout；Location 必须是站内路径。
 * 带主机的话浏览器会跨域直连 9999（2026-09-23 第一版上线就是这样：
 * `http://47.120.11.60:9999/apiapi/logout.htm`）。
 */
async function checkLogoutRedirect(conn, port) {
  const loc = await httpHeader(conn, `http://127.0.0.1:${port}/api/v1/site/summary`, 'location')
  if (!loc) {
    warn('未拿到 302 跳转（后端可能换了会话失效的处理方式），跳过该项检查')
    return true
  }
  if (loc.startsWith('/')) {
    ok(`会话失效跳转是站内路径：${loc}`)
    return true
  }
  warn(`会话失效跳转带了主机：${loc}（浏览器会跨域）`)
  return false
}

async function doStatus(conn) {
  console.log('\n=== 容器 ===')
  await sshExec(conn, `docker ps -a --filter "name=${IMAGE}" --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"`)
  console.log('\n=== wan.service ===')
  await sshExec(conn, 'systemctl is-active wan.service; systemctl show wan.service -p Environment -p MainPID', { ignoreError: true })
  console.log('\n=== 端口 ===')
  await sshExec(conn, `ss -tlnp | grep -E ":(${cfg.prodPort}|${cfg.testPort}|${cfg.wanPort})\\b" || true`)
}

async function doTest(conn) {
  console.log(`\n=== 构建候选镜像，并在测试端口 ${cfg.testPort} 起独立容器 ===`)
  await checkDocker(conn)
  await syncFiles(conn)

  info(`构建 ${CANDIDATE}（不动正在跑的生产容器）...`)
  await sshExec(conn, `cd ${cfg.remoteDir} && docker build \
    --build-arg BUILD_IMAGE=\${BUILD_IMAGE:-node:22-slim} \
    --build-arg RUNTIME_IMAGE=\${RUNTIME_IMAGE:-nginx:alpine} \
    --build-arg VITE_BASE=/sjcj/ \
    --build-arg BACKEND_TARGET=${cfg.backend} \
    -t ${CANDIDATE} .`)

  info(`在 ${cfg.testPort} 启动测试容器 ${TEST_CONTAINER}...`)
  await sshExec(conn, `docker rm -f ${TEST_CONTAINER} >/dev/null 2>&1 || true`)
  await sshExec(conn, `docker run -d --name ${TEST_CONTAINER} -p ${cfg.testPort}:80 --add-host host.docker.internal:host-gateway ${CANDIDATE}`)

  const code = await waitFor(conn, `http://127.0.0.1:${cfg.testPort}/sjcj/index.html`, ['200'])
  if (code !== '200') {
    await sshExec(conn, `docker logs --tail 30 ${TEST_CONTAINER}`, { ignoreError: true })
    die(`测试容器 /sjcj/index.html 返回 ${code}`)
  }
  ok('sjcj 首页 200')
  const wanCode = await httpCode(conn, `http://127.0.0.1:${cfg.testPort}/`)
  if (!['200', '302'].includes(wanCode)) die(`经测试网关访问 WAN 返回 ${wanCode}（WAN 是否在 ${cfg.wanPort} 运行？）`)
  ok(`WAN 首页 ${wanCode}`)
  if (!(await checkLogoutRedirect(conn, cfg.testPort))) die('会话失效跳转不对，别 release')

  ok('自检通过')
  // deploy 模式下紧接着就 release，不用再提示
  if (action !== 'test') return
  console.log(`\n------------------------------------------------------------`)
  console.log(`✓ 测试地址：http://${cfg.host}:${cfg.testPort}/sjcj/ （外网能否直达取决于端口映射）`)
  console.log(`✓ 验证通过后运行：node deploy-docker.js release`)
  console.log(`------------------------------------------------------------\n`)
}

/**
 * 把 806 上的网关换成指定镜像。
 *
 * ⚠️ 不能让 docker-compose 去「重建」已有容器：部署机上是 compose v1.29.2 + Docker 29，
 * v1 的 recreate 路径与新引擎不兼容——它会先把旧容器停掉改名成 `<id>_sjcj-gateway`，
 * 然后报错退出、新容器没建起来，806 直接空了（2026-09-23 第一次 cutover 实际踩到，停了几分钟）。
 * 所以先按名字删掉旧容器，让 compose 只走「新建」这条路（第一版首次上线就是这条路，是通的）。
 * 按名字删而不是 `docker-compose rm`：手工 docker run 起的同名容器没有 compose 标签，rm 看不见。
 */
async function swapGateway(conn, imageRef) {
  await sshExec(conn, `docker tag ${imageRef} ${IMAGE}:latest`)
  await sshExec(conn, `docker rm -f ${IMAGE} >/dev/null 2>&1 || true`)
  await sshExec(conn, `cd ${cfg.remoteDir} && BACKEND_TARGET=${cfg.backend} GATEWAY_NAME=${IMAGE} GATEWAY_PORT=${cfg.prodPort} docker-compose up -d --no-build`)
}

async function doRelease(conn) {
  console.log(`\n=== 把候选镜像换上 ${cfg.prodPort} ===`)
  const has = await sshExec(conn, `docker image inspect ${CANDIDATE} >/dev/null 2>&1 && echo yes || echo no`, { silent: true })
  if (has.out !== 'yes') die(`没有 ${CANDIDATE}，先跑 test`)

  // 换容器前先记下当前镜像 ID，失败时换回去
  const prev = await sshExec(conn, `docker inspect ${IMAGE} --format '{{.Image}}' 2>/dev/null || true`, { silent: true })

  info('换容器（只 tag + 新建容器，不现场构建）...')
  let failure = ''
  try {
    await swapGateway(conn, CANDIDATE)
    const code = await waitFor(conn, `http://127.0.0.1:${cfg.prodPort}/sjcj/index.html`, ['200'])
    const wanCode = await httpCode(conn, `http://127.0.0.1:${cfg.prodPort}/`)
    const redirectOk = await checkLogoutRedirect(conn, cfg.prodPort)
    if (code !== '200' || !['200', '302'].includes(wanCode) || !redirectOk) {
      failure = `上线检查未通过：sjcj=${code} WAN=${wanCode} 跳转=${redirectOk ? 'ok' : '带主机'}`
    } else {
      ok(`sjcj=${code} WAN=${wanCode}`)
    }
  } catch (err) {
    // 换容器本身报错也得回退——第一版这里直接抛出去，回退代码根本没机会跑
    failure = `换容器失败：${err.message}`
  }

  if (failure) {
    warn(failure)
    if (prev.out) {
      info('换回上一个镜像...')
      await swapGateway(conn, prev.out)
      const back = await waitFor(conn, `http://127.0.0.1:${cfg.prodPort}/sjcj/index.html`, ['200'])
      die(`已换回上一个镜像（sjcj=${back}），请排查`)
    }
    die(`没有可换回的镜像，${cfg.prodPort} 可能无服务，立即手工处理`)
  }
  await sshExec(conn, `docker rm -f ${TEST_CONTAINER} >/dev/null 2>&1 || true`)
  ok(`已上线：http://${cfg.host}:${cfg.publicPort}/sjcj/`)
}

/**
 * WAN 交给 systemd 跑在内部端口。可重复执行：已经是目标端口且在跑就不动。
 * 顺带清掉第一版切流留下的、systemd 管不到的裸进程（只认 wan 目录下的 server.js，别误杀别的 Node 服务）。
 */
async function moveWanTo(conn, port) {
  const script = `
set -e
sed -i 's/^Environment=PORT=.*/Environment=PORT=${port}/' ${WAN_UNIT}
systemctl daemon-reload
main=$(systemctl show -p MainPID --value wan.service)
for pid in $(pgrep -f 'server\\.js' || true); do
  if [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "${cfg.wanDir}" ] && [ "$pid" != "$main" ]; then
    kill "$pid" || true
  fi
done
sleep 1
systemctl restart wan.service
`
  await sudoExec(conn, script)
  const code = await waitFor(conn, `http://127.0.0.1:${port}/`, ['200', '302'])
  if (!['200', '302'].includes(code)) die(`WAN 在 ${port} 返回 ${code}，查看 ${cfg.wanDir}/server.log`)
  ok(`WAN 由 systemd 运行在 ${port}（HTTP ${code}）`)
}

async function doCutover(conn) {
  console.log(`\n=== 切流：WAN → systemd:${cfg.wanPort}，网关接管 ${cfg.prodPort} ===`)
  await checkDocker(conn)
  await moveWanTo(conn, cfg.wanPort)
  await doRelease(conn)
}

async function doRollback(conn) {
  console.log(`\n=== 紧急回滚：停网关，WAN 经 systemd 回到 806 ===`)
  info('停止网关容器...')
  await sshExec(conn, `cd ${cfg.remoteDir} && (docker-compose down || docker stop ${IMAGE} || true)`)
  await moveWanTo(conn, '806')
  ok('已回滚到 WAN 直接监听 806')
}

/**
 * 部署前检查本地代码（2026-10-09 用户定）。
 *
 * test / deploy 上传的是**本机这个目录的工作区**（syncFiles：app/ 整个目录 + 根目录几个部署文件），
 * 不是 git 里的提交，更不是 CNB 上的 master。三人分仓以后（姜楠本地枢纽、zhonghe 推 CNB、leo 推内网），
 * 「本地是什么就部署什么」很容易把旧代码或半成品发出去，所以上传前对照 CNB 的 master 检查：
 * 不在 master、有未提交改动、比 CNB 落后、有没推送的提交——有任何一条就停下来列给人看。
 * 终端里跑：确认后继续；非交互（如 Claude 代跑）：直接中止，确需部署时加 SJCJ_DEPLOY_FORCE=1。
 * release / cutover / rollback / status 不上传代码，不检查。
 */
const DEPLOY_PATHS = ['app', 'Dockerfile', 'nginx.conf', 'docker-compose.yml', '.dockerignore']

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()) }))
}

async function checkLocalCode() {
  info('检查本地代码（部署上传的是本机工作区）...')
  const problems = []
  try {
    git(['fetch', '--quiet', 'origin', 'master'], { timeout: 30000 })
  } catch (e) {
    problems.push(`拉取 CNB（origin）失败，无法确认本地是否落后：${String(e.stderr || e.message).trim().split('\n')[0]}`)
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'master') problems.push(`当前分支是 ${branch}，不是 master`)

  const dirty = git(['status', '--porcelain', '--', ...DEPLOY_PATHS])
  if (dirty) {
    const lines = dirty.split('\n')
    problems.push(`有 ${lines.length} 个未提交 / 未加入 git 的文件会被一起部署：\n${lines.slice(0, 10).map(l => `      ${l}`).join('\n')}${lines.length > 10 ? `\n      …另有 ${lines.length - 10} 个` : ''}`)
  }

  let behind = []
  let ahead = []
  try {
    behind = git(['log', '--oneline', 'HEAD..origin/master']).split('\n').filter(Boolean)
    ahead = git(['log', '--oneline', 'origin/master..HEAD']).split('\n').filter(Boolean)
  } catch {
    // 没有 origin/master（fetch 也失败了）时上面已经记过一条，这里不重复
  }
  const list = commits => commits.slice(0, 5).map(c => `      ${c}`).join('\n') + (commits.length > 5 ? `\n      …另有 ${commits.length - 5} 个` : '')
  if (behind.length) problems.push(`比 CNB master 落后 ${behind.length} 个提交，这些不会被部署（先 git pull）：\n${list(behind)}`)
  if (ahead.length) problems.push(`有 ${ahead.length} 个提交还没推到 CNB，会被部署上去：\n${list(ahead)}`)

  const head = git(['log', '-1', '--format=%h %s'])
  if (!problems.length) {
    ok(`本地代码与 CNB master 一致：${head}`)
    return
  }

  console.log(`\n⚠ 本次将部署 ${branch} @ ${head}，但有以下情况：`)
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`))
  console.log('')
  if (process.env.SJCJ_DEPLOY_FORCE === '1') {
    warn('已设置 SJCJ_DEPLOY_FORCE=1，忽略以上情况继续部署')
    return
  }
  if (!process.stdin.isTTY) die('非交互环境下不自动继续。确认要按当前本地代码部署，请加 SJCJ_DEPLOY_FORCE=1 重跑')
  const answer = await ask('仍按当前本地代码部署？输入 y 继续，其它任意键取消：')
  if (answer.toLowerCase() !== 'y') die('已取消部署')
  warn('已确认，按当前本地代码继续部署')
}

async function main() {
  const needsSudo = ['cutover', 'rollback'].includes(action)
  if (!cfg.password && (needsSudo || !cfg.keyPath)) {
    die(needsSudo
      ? `${action} 要 sudo，请用环境变量 SJCJ_SSH_PASSWORD 提供密码`
      : '请用环境变量 SJCJ_SSH_KEY 指定私钥，或 SJCJ_SSH_PASSWORD 提供 SSH 密码（不再写进脚本）')
  }
  if (targetName !== 'prod' && ['cutover', 'rollback'].includes(action)) {
    die(`${action} 会动 WAN 与 806，只对 prod 开放；SJCJ_TARGET=${targetName} 只支持 deploy / test / release / status`)
  }
  info(`部署目标：${targetName}（后端 ${cfg.backend}，端口 ${cfg.prodPort} / 公网 ${cfg.publicPort}，容器 ${IMAGE}）`)
  if (['deploy', 'test'].includes(action)) await checkLocalCode()
  info(`连接远程服务器 ${cfg.host}:${cfg.port}...`)
  const conn = await getSshClient()
  ok('SSH 连接建立成功')

  try {
    switch (action) {
      case 'deploy': await doTest(conn); await doRelease(conn); break
      case 'test': await doTest(conn); break
      case 'release': await doRelease(conn); break
      case 'cutover': await doCutover(conn); break
      case 'rollback': await doRollback(conn); break
      case 'status': await doStatus(conn); break
      default: die(`未知操作: ${action}。支持：deploy, test, release, cutover, rollback, status`)
    }
  } finally {
    conn.end()
  }
}

main().catch(err => {
  die(err.stack || err.message)
})
