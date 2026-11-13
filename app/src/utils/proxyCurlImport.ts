import type { CollectorProxyDetail } from '@/views/FlowCanvas/canvas/flowModel'
import { curlCommands } from './agentCurlImport'

/** Parse configuration only; never execute curl or contact the target URL. */
export function parseProxyCurl(text: string): CollectorProxyDetail {
  if (text.length > 16000) throw new Error('cURL 内容过长，请只保留代理配置参数')
  const commands = curlCommands(text)
  if (commands.length !== 1 || !/^curl(?:\.exe)?$/i.test(commands[0]?.[0] || '')) throw new Error('请粘贴一条完整的 curl 或 curl.exe 命令')
  const args = commands[0]!
  let proxy = '', credentials: string | undefined
  const flags = new Set(['-s', '-S', '-sS', '-L', '-I', '-k', '-N', '--silent', '--show-error', '--location', '--head', '--insecure', '--no-buffer', '--compressed'])
  const withValue = new Set(['-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '-X', '--request', '-o', '--output', '-u', '--user', '--url', '--connect-timeout', '--max-time'])
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!
    const next = () => { const value = args[++index]; if (!value || value.startsWith('-')) throw new Error('cURL 参数缺少值'); return value }
    if (arg === '-x' || arg === '--proxy') proxy = next()
    else if (arg.startsWith('--proxy=')) proxy = arg.slice(8)
    else if (arg.startsWith('-x')) proxy = arg.slice(2)
    else if (arg === '-U' || arg === '--proxy-user') credentials = next()
    else if (arg.startsWith('--proxy-user=')) credentials = arg.slice(13)
    else if (arg.startsWith('-U')) credentials = arg.slice(2)
    else if (withValue.has(arg)) next()
    else if (flags.has(arg)) continue
    else if (arg.startsWith('-') || ['&&', '||', '|', '>'].includes(arg)) throw new Error('包含不支持的参数，请只保留 -x、-U 和目标地址')
  }
  if (!proxy) throw new Error('缺少 -x 或 --proxy 代理地址')
  let url: URL
  try { url = new URL(proxy.includes('://') ? proxy : `http://${proxy}`) } catch { throw new Error('代理地址或端口无效') }
  if (url.protocol !== 'http:') throw new Error('当前节点代理字段仅支持 HTTP 代理')
  if (!url.hostname || url.pathname !== '/' || url.search || url.hash) throw new Error('代理地址只能包含主机和端口')
  const authority = proxy.replace(/^http:\/\//i, '').split('/')[0]!
  const explicitPort = authority.match(/:(\d+)$/)?.[1]
  const port = Number(explicitPort)
  if (!explicitPort || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请填写 1–65535 的代理端口')
  let account = '', password = ''
  try { account = decodeURIComponent(url.username); password = decodeURIComponent(url.password) } catch { throw new Error('代理认证信息编码无效') }
  if (credentials !== undefined) {
    const colon = credentials.indexOf(':')
    if (colon < 1) throw new Error('-U 或 --proxy-user 须使用“账号:密码”格式')
    account = credentials.slice(0, colon); password = credentials.slice(colon + 1)
  }
  return { ip: url.hostname, port, account, password }
}
