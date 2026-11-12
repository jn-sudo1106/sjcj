const { Client } = require('ssh2')
const fs = require('fs')
const os = require('os')
const path = require('path')

const pub = fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_ed25519.pub'), 'utf8').trim()
console.log('公钥:', pub.slice(0, 60) + '...')

const c = new Client()

c.on('ready', () => {
  console.log('✓ SSH 连接成功，上传公钥中...')
  const cmd = [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    `echo '${pub}' >> ~/.ssh/authorized_keys`,
    'sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    'echo DONE',
  ].join(' && ')

  c.exec(cmd, (err, stream) => {
    if (err) { console.error('执行失败:', err.message); c.end(); return }
    stream.on('close', (code) => {
      if (code === 0) {
        console.log('✓ 公钥已写入服务器 ~/.ssh/authorized_keys')
        console.log('✓ 现在可以运行 node deploy.js 免密部署了')
      } else {
        console.error('✗ 失败 code=' + code)
      }
      c.end()
    })
    stream.on('data', d => process.stdout.write(d))
    stream.stderr.on('data', d => process.stderr.write(d))
  })
})

c.on('error', e => {
  console.error('✗ SSH 错误:', e.message)
  process.exit(1)
})

c.connect({
  host: '47.120.11.60',
  port: 5031,
  username: 'leo',
  password: 'mcafee123',
  readyTimeout: 15000,
  // 跳过 host key 验证（仅用于首次上传公钥，安全）
  hostVerifier: () => true,
  algorithms: {
    kex: ['curve25519-sha256', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256'],
  },
})
