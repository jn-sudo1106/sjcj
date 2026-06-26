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

function deploy(appDir) {
  const dist = path.join(appDir, 'dist')
  const remotePath = `${cfg.remotePath}/public`
  const target = `${cfg.remoteHost}:${remotePath}/`
  const sshOpts = `-p ${cfg.sshPort} -o StrictHostKeyChecking=accept-new`

  // 检测 rsync
  let hasRsync = false
  try { execFileSync('rsync', ['--version'], { stdio: 'ignore' }); hasRsync = true } catch { /* noop */ }

  if (hasRsync) {
    const distSlash = dist + path.sep
    const ssh = process.env.SSHPASS
      ? `sshpass -e ssh ${sshOpts}`
      : `ssh ${sshOpts}`
    console.log(`→ rsync 到 ${target}`)
    inherit('rsync', ['-az', '--delete', '-e', ssh, distSlash, target])
  } else {
    console.log(`⚠ rsync 不可用，改用 scp（Windows OpenSSH）`)
    console.log(`→ scp 到 ${target}`)
    inherit('ssh', ['-p', cfg.sshPort, '-o', 'StrictHostKeyChecking=accept-new',
      cfg.remoteHost, `rm -rf '${remotePath}' && mkdir -p '${remotePath}'`])
    inherit('scp', ['-P', cfg.sshPort, '-o', 'StrictHostKeyChecking=accept-new',
      '-r', `${dist}${path.sep}.`, target])
  }
  ok(`已发布：http://47.120.11.60:2806${cfg.publicPath}#/overview`)
}

console.log('=== sjcj HEAD 一键部署 ===')
guardConfig()
const root = repoRoot()
warnGitState(root)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sjcj-deploy-'))
try {
  archiveRef(root, tmp)
  build(path.join(tmp, 'app'))
  deploy(path.join(tmp, 'app'))
} finally {
  if (cfg.keepWorkdir) console.log(`ℹ 保留临时目录：${tmp}`)
  else fs.rmSync(tmp, { recursive: true, force: true })
}
