#!/usr/bin/env node
/*
 * Deploy committed sjcj code from a clean git archive.
 *
 * This is intended for shared/local deployment while other developers may have
 * uncommitted work in the checkout. It deploys only SJCJ_ARCHIVE_REF (default:
 * HEAD), never the dirty working tree.
 */
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cfg = {
  ref: process.env.SJCJ_ARCHIVE_REF || 'HEAD',
  remoteHost: process.env.SJCJ_REMOTE_HOST || 'leo@47.120.11.60',
  remotePath: process.env.SJCJ_REMOTE_PATH || '/home/leo/sjcj',
  publicPath: process.env.SJCJ_PUBLIC_PATH || '/sjcj/',
  sshPort: process.env.SJCJ_SSH_PORT || '5031',
  requireSync: process.env.SJCJ_REQUIRE_SYNC === '1',
  keepWorkdir: process.env.SJCJ_KEEP_DEPLOY_WORKDIR === '1',
  skipInstall: process.env.SJCJ_SKIP_NPM_CI === '1',
}

function die(msg) {
  console.error(`\n✗ 部署中止：${msg}\n`)
  process.exit(1)
}

function ok(msg) {
  console.log(`✓ ${msg}`)
}

function runFile(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

function inherit(cmd, args, opts = {}) {
  const isWin = process.platform === 'win32'
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...opts })
  if (res.status !== 0) die(`${cmd} ${args.join(' ')} 失败`)
}

function guardConfig() {
  if (cfg.publicPath === '/') die('SJCJ_PUBLIC_PATH 不能为根路径 "/"，必须隔离到子路径')
  if (!/^\/[^/]+\/$/.test(cfg.publicPath)) die(`SJCJ_PUBLIC_PATH 必须是单层顶级子路径（形如 /sjcj/），当前：${cfg.publicPath}`)
  if (cfg.remotePath === '/home/leo/wan' || cfg.remotePath.startsWith('/home/leo/wan/')) die('SJCJ_REMOTE_PATH 不能指向 WAN 目录 /home/leo/wan')
  if (!cfg.remoteHost) die('SJCJ_REMOTE_HOST 不能为空')
  ok(`隔离配置校验通过：${cfg.publicPath} -> ${cfg.remoteHost}:${cfg.remotePath}/public`)
}

function repoRoot() {
  try {
    return runFile('git', ['rev-parse', '--show-toplevel'])
  } catch {
    die('当前目录不在 Git 仓库内')
  }
}

function warnGitState(root) {
  const dirty = runFile('git', ['status', '--porcelain'], { cwd: root })
  if (dirty) {
    console.log('\n⚠ 工作区有未提交改动；本次只部署已提交的 git archive，不包含这些改动。')
  }

  try {
    const branch = runFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })
    const upstream = runFile('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: root })
    const ahead = runFile('git', ['rev-list', '--count', `${upstream}..${branch}`], { cwd: root })
    const behind = runFile('git', ['rev-list', '--count', `${branch}..${upstream}`], { cwd: root })
    if (ahead !== '0' || behind !== '0') {
      const msg = `当前分支与 ${upstream} 不同步：ahead=${ahead}, behind=${behind}`
      if (cfg.requireSync) die(`${msg}。请先 git push / git pull，或取消 SJCJ_REQUIRE_SYNC=1。`)
      console.log(`⚠ ${msg}；仍将部署本地 ${cfg.ref}。`)
    }
  } catch {
    const msg = '当前分支未设置上游，无法确认是否已 push'
    if (cfg.requireSync) die(`${msg}。`)
    console.log(`⚠ ${msg}；仍将部署本地 ${cfg.ref}。`)
  }
}

function archiveRef(root, tmp) {
  console.log(`→ 导出 ${cfg.ref} 到临时目录`)
  let archive
  try {
    archive = execFileSync('git', ['archive', cfg.ref], { cwd: root, maxBuffer: 200 * 1024 * 1024 })
  } catch {
    die(`无法导出 ${cfg.ref}，请确认该 ref 存在且已提交`)
  }
  const res = spawnSync('tar', ['-x', '-f', '-', '-C', tmp], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] })
  if (res.status !== 0) die('解压 git archive 失败')
  ok(`已导出干净副本：${tmp}`)
}

function build(appDir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  if (!cfg.skipInstall) {
    console.log('→ 安装依赖（npm ci）')
    inherit(npm, ['ci'], { cwd: appDir })
  } else {
    console.log('⚠ 已跳过 npm ci（SJCJ_SKIP_NPM_CI=1）')
  }
  console.log(`→ 构建（VITE_BASE=${cfg.publicPath}）`)
  inherit(npm, ['run', 'build'], { cwd: appDir, env: { ...process.env, VITE_BASE: cfg.publicPath } })
  ok('构建完成')
}

const sshCfg = {
  host: '47.120.11.60',
  port: parseInt(cfg.sshPort, 10),
  username: 'leo',
  password: 'mcafee123',
  readyTimeout: 15000,
  hostVerifier: () => true,
}

function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      stream.on('data', d => { out += d })
      stream.stderr.on('data', d => process.stderr.write(d))
      stream.on('close', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${cmd}`)))
    })
  })
}

function sftpUploadDir(sftp, localDir, remoteDir) {
  return new Promise((resolve, reject) => {
    const tasks = []
    function walk(local, remote) {
      const entries = fs.readdirSync(local, { withFileTypes: true })
      for (const e of entries) {
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
        sftp.mkdir(t.remote, err => {
          // ignore EEXIST
          next()
        })
      } else {
        sftp.fastPut(t.local, t.remote, err => {
          if (err) return reject(new Error(`上传失败 ${t.remote}: ${err.message}`))
          fileCount++
          if (fileCount % 10 === 0 || fileCount === total) {
            process.stdout.write(`\r  已上传 ${fileCount}/${total} 个文件`)
          }
          next()
        })
      }
    }
    next()
  })
}

async function deploy(appDir) {
  const dist = path.join(appDir, 'dist')
  const remotePath = `${cfg.remotePath}/public`

  console.log(`→ 通过 ssh2 连接 ${sshCfg.host}:${sshCfg.port}`)

  const { Client } = require('ssh2')
  const conn = new Client()

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve)
    conn.on('error', reject)
    conn.connect(sshCfg)
  })
  ok('SSH 连接成功')

  // 清空并重建目录
  console.log(`→ 清理远端目录 ${remotePath}`)
  await sshExec(conn, `rm -rf '${remotePath}' && mkdir -p '${remotePath}'`)

  // SFTP 上传
  console.log(`→ SFTP 上传 dist/ → ${remotePath}`)
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => err ? reject(err) : resolve(s))
  })
  const count = await sftpUploadDir(sftp, dist, remotePath)
  console.log(`\n`)
  ok(`已上传 ${count} 个文件`)

  conn.end()
  ok(`已发布：http://47.120.11.60:2806${cfg.publicPath}#/overview`)
}

async function main() {
  console.log('=== sjcj HEAD 一键部署 ===')
  guardConfig()
  const root = repoRoot()
  warnGitState(root)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sjcj-deploy-'))
  try {
    archiveRef(root, tmp)
    build(path.join(tmp, 'app'))
    await deploy(path.join(tmp, 'app'))
  } finally {
    if (cfg.keepWorkdir) console.log(`ℹ 保留临时目录：${tmp}`)
    else fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch(e => { console.error(`\n✗ 部署失败：${e.message}`); process.exit(1) })
