#!/usr/bin/env node
/*
 * 采集配置中心（sjcj）静态部署脚本
 * 对齐《设计稿/部署方案_隔离.md》的隔离边界：
 *   - 只部署到 WAN 公网入口下的隔离子路径 /sjcj/
 *   - 静态产物发布到 /home/leo/sjcj/public，绝不写入 /home/leo/wan
 *   - 不占独立端口、不起常驻 Node 服务；默认 mock 数据
 * 危险配置一律拒绝，git 未提交 / 未推送 / 未同步时中止。
 */
const { execSync } = require('node:child_process')
const path = require('node:path')

const cfg = {
  remotePath: process.env.SJCJ_REMOTE_PATH || '/home/leo/sjcj',
  publicPath: process.env.SJCJ_PUBLIC_PATH || '/sjcj/',
  wanPort: process.env.SJCJ_WAN_LOCAL_PORT || '806',
  sshPort: process.env.SJCJ_SSH_PORT || '5031',
  viteBase: process.env.VITE_BASE || '/sjcj/',
  remoteHost: (process.env.SJCJ_REMOTE_HOST || '').trim(), // trim 防止 cmd set 尾部空格
  skipGitCheck: process.env.SJCJ_SKIP_GIT_CHECK === '1',
}

const die = (msg) => {
  console.error(`\n✗ 部署中止：${msg}\n`)
  process.exit(1)
}
const ok = (msg) => console.log(`✓ ${msg}`)

// 1) 隔离配置安全保护
function guardConfig() {
  if (cfg.publicPath === '/') die('SJCJ_PUBLIC_PATH 不能为根路径 "/"，必须隔离到子路径')
  if (!/^\/[^/]+\/$/.test(cfg.publicPath)) die(`SJCJ_PUBLIC_PATH 必须是单层顶级子路径（形如 /sjcj/），当前：${cfg.publicPath}`)
  if (cfg.remotePath === '/home/leo/wan' || cfg.remotePath.startsWith('/home/leo/wan/')) die('SJCJ_REMOTE_PATH 不能指向 WAN 目录 /home/leo/wan')
  if (cfg.viteBase !== cfg.publicPath) die(`VITE_BASE（${cfg.viteBase}）必须与 SJCJ_PUBLIC_PATH（${cfg.publicPath}）一致`)
  ok(`隔离配置校验通过：base=${cfg.viteBase} → ${cfg.remotePath}/public（WAN 本机端口 ${cfg.wanPort}）`)
}

// 2) git 状态保护：已初始化 / 已提交 / 已推送 / 已同步
function guardGit() {
  if (cfg.skipGitCheck) {
    console.log('⚠ 已跳过 git 检查（SJCJ_SKIP_GIT_CHECK=1，仅限本地预览，勿用于正式发布）')
    return
  }
  const run = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  try { run('git rev-parse --is-inside-work-tree') } catch { die('Git 未初始化，请先 git init 并提交、推送') }
  if (run('git status --porcelain')) die('工作区有未提交改动，请先 commit')
  const branch = run('git rev-parse --abbrev-ref HEAD')
  let upstream = ''
  try { upstream = run(`git rev-parse --abbrev-ref "${branch}@{upstream}"`) } catch { die(`当前分支 ${branch} 未设置上游 / 未推送，请先 git push -u`) }
  if (run(`git rev-list --count "${upstream}..${branch}"`) !== '0') die(`当前分支领先远端，请先 git push`)
  if (run(`git rev-list --count "${branch}..${upstream}"`) !== '0') die(`当前分支落后远端，请先 git pull`)
  ok(`git 已提交并与 ${upstream} 同步`)
}

// 3) 隔离构建（VITE_BASE 注入）
function buildDist() {
  console.log(`→ 构建（VITE_BASE=${cfg.viteBase}，VITE_API_MODE=${process.env.VITE_API_MODE || 'mock'}）`)
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, VITE_BASE: cfg.viteBase } })
  ok('构建完成 → dist/')
}

// 4) 发布到隔离目录（rsync 优先，无 rsync 时降级 scp）
function deploy() {
  const dist = path.join(__dirname, '..', 'dist')
  const target = `${cfg.remotePath}/public`
  if (!cfg.remoteHost) {
    console.log(`\nℹ 未设置 SJCJ_REMOTE_HOST，已仅完成本地构建。`)
    console.log(`  设置后重新运行：set SJCJ_REMOTE_HOST=leo@47.120.11.60`)
    console.log(`  发布后访问：http://47.120.11.60:2806${cfg.publicPath}#/canvas`)
    return
  }
  // 检测 rsync
  let hasRsync = false
  try { execSync('rsync --version', { stdio: 'ignore' }); hasRsync = true } catch { /* noop */ }

  if (hasRsync) {
    const distSlash = dist + '/'
    console.log(`→ rsync 到 ${cfg.remoteHost}:${target}`)
    execSync(`rsync -az --delete -e "ssh -p ${cfg.sshPort}" "${distSlash}" "${cfg.remoteHost}:${target}/"`, { stdio: 'inherit' })
  } else {
    console.log(`⚠ rsync 不可用，改用 scp（Windows OpenSSH）`)
    console.log(`→ scp 到 ${cfg.remoteHost}:${target}`)
    // 先 ssh 清空并重建目录，再 scp 上传
    execSync(`ssh -p ${cfg.sshPort} -o StrictHostKeyChecking=accept-new ${cfg.remoteHost} "rm -rf '${target}' && mkdir -p '${target}'"`, { stdio: 'inherit' })
    execSync(`scp -P ${cfg.sshPort} -o StrictHostKeyChecking=accept-new -r "${dist}/." "${cfg.remoteHost}:${target}/"`, { stdio: 'inherit' })
  }
  ok(`已发布到 ${cfg.remoteHost}:${target}（公网 ${cfg.publicPath} 下）`)
}


console.log('=== sjcj 静态部署（隔离方案）===')
guardConfig()
guardGit()
buildDist()
deploy()
ok('部署流程结束')
