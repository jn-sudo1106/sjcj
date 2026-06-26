#!/usr/bin/env node
/**
 * setup-ssh-key.js
 * 用密码登录服务器，将本机公钥写入 ~/.ssh/authorized_keys
 * 用法：node setup-ssh-key.js
 */
const { Client } = require('ssh2')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const HOST = '47.120.11.60'
const PORT = 5031
const USER = 'leo'
const PUB_KEY_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.ssh', 'id_ed25519.pub')

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    // 隐藏密码输入
    process.stdout.write(question)
    process.stdin.setRawMode?.(true)
    let password = ''
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(password)
      } else if (ch === '\u0003') {
        process.exit()
      } else {
        password += ch
        process.stdout.write('*')
      }
    }
    process.stdin.on('data', onData)
  })
}

async function main() {
  if (!fs.existsSync(PUB_KEY_PATH)) {
    console.error(`✗ 公钥不存在：${PUB_KEY_PATH}`)
    console.error('  请先运行：ssh-keygen -t ed25519')
    process.exit(1)
  }

  const pubKey = fs.readFileSync(PUB_KEY_PATH, 'utf8').trim()
  console.log(`\n→ 公钥：${pubKey.slice(0, 60)}...`)
  console.log(`→ 目标服务器：${USER}@${HOST}:${PORT}\n`)

  const password = await ask(`请输入 ${USER}@${HOST} 的 SSH 密码：`)

  const conn = new Client()

  conn.on('ready', () => {
    console.log('\n✓ SSH 连接成功')
    const cmd = [
      `mkdir -p ~/.ssh`,
      `chmod 700 ~/.ssh`,
      `echo '${pubKey}' >> ~/.ssh/authorized_keys`,
      `sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys`,
      `chmod 600 ~/.ssh/authorized_keys`,
      `echo DONE`,
    ].join(' && ')

    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error('✗ 执行命令失败：', err.message)
        conn.end()
        return
      }
      stream.on('close', (code) => {
        if (code === 0) {
          console.log('✓ 公钥已成功写入服务器 ~/.ssh/authorized_keys')
          console.log('✓ 现在可以直接运行 node deploy.js 免密部署')
        } else {
          console.error(`✗ 命令退出码 ${code}`)
        }
        conn.end()
      })
      stream.on('data', (d) => process.stdout.write(d))
      stream.stderr.on('data', (d) => process.stderr.write(d))
    })
  })

  conn.on('error', (err) => {
    console.error('\n✗ SSH 连接失败：', err.message)
    process.exit(1)
  })

  conn.connect({
    host: HOST,
    port: PORT,
    username: USER,
    password,
    readyTimeout: 10000,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
