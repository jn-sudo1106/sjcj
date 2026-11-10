import type { ModelInterface } from '@/api/runnerManagement'
import { DEFAULT_CHAT_CDP_PORT } from './generationWorkspace'

export function agentInterfaceKey(row: ModelInterface): string {
  let endpoint = row.endpoint.trim(), localServer = ''
  try {
    const url = new URL(endpoint)
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    if (row.kind === 'chat' && url.pathname === '/wbchat') url.pathname = '/wb/chat'
    if (row.kind === 'agent' && url.pathname === '/wbagent') url.pathname = '/wb/agent'
    endpoint = url.href
    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) localServer = row.generationServerId || ''
  } catch { /* Keep invalid addresses distinct until normal form validation. */ }
  const port = row.cdpPort === undefined ? row.kind === 'agent' ? 9223 : row.kind === 'chat' ? DEFAULT_CHAT_CDP_PORT : null : row.cdpPort
  return JSON.stringify([row.kind, endpoint, row.model.trim(), port, localServer])
}

// Windows quoting keeps JSON path backslashes unless they precede a quote.
function curlCommands(text: string): string[][] {
  const commands: string[][] = []
  let args: string[] = [], word = '', started = false, quote = '', windows = false
  function finishWord() {
    if (!started) return
    if (!args.length) windows = word.toLowerCase() === 'curl.exe'
    args.push(word); word = ''; started = false
  }
  function finishCommand() {
    finishWord()
    if (args.length) commands.push(args)
    args = []; windows = false
  }
  const input = text.replace(/\r\n?/g, '\n')
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!
    if (quote !== "'" && /[\\^\x60]/.test(char) && input[index + 1] === '\n') { index++; continue }
    if (quote !== "'" && char === '\\') {
      let end = index
      while (input[end] === '\\') end++
      const count = end - index
      if (windows && input[end] === '"') {
        word += '\\'.repeat(Math.floor(count / 2)); started = true
        if (count % 2) { word += '"'; index = end; continue }
        index = end - 1; continue
      }
      if (!windows && input[index + 1] && (!quote || /["\\$\x60]/.test(input[index + 1]!))) {
        word += input[++index]; started = true; continue
      }
    }
    if (quote) {
      if (char === quote) quote = ''
      else word += char
      started = true
    } else if (char === '"' || char === "'") {
      quote = char; started = true
    } else if (char === '\n' || char === ';') {
      finishCommand()
    } else if (/\s/.test(char)) {
      finishWord()
    } else {
      word += char; started = true
    }
  }
  if (quote) throw new Error('引号未闭合，请粘贴完整 curl 命令')
  finishCommand()
  return commands
}

export type AgentCurlImportType = 'auto' | 'chat' | 'agent'

function parseCommand(args: string[], importType: AgentCurlImportType): ModelInterface {
  if (!/^curl(?:\.exe)?$/i.test(args[0] || '')) throw new Error('每条请求须以 curl 或 curl.exe 开头')
  let endpoint = '', method = '', data: string | undefined
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!
    if (['-N', '--no-buffer', '-s', '-S', '-sS', '--silent', '--show-error', '-L', '--location'].includes(arg)) continue
    let option = arg, value: string | undefined
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1
    if (equals > 0) { option = arg.slice(0, equals); value = arg.slice(equals + 1) }
    else if (/^-[XHd].+/.test(arg)) { option = arg.slice(0, 2); value = arg.slice(2) }
    if (['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--url'].includes(option)) {
      value ??= args[++index]
      if (value === undefined) throw new Error('请求选项缺少参数')
      if (option === '-X' || option === '--request') method = value.toUpperCase()
      else if (option === '-H' || option === '--header') {
        const colon = value.indexOf(':')
        const name = value.slice(0, colon).trim().toLowerCase(), content = value.slice(colon + 1).trim()
        if (colon < 1 || (name === 'content-type' ? !/^application\/json(?:\s*;.*)?$/i.test(content) : name !== 'accept')) {
          throw new Error('仅支持 JSON Content-Type 和 Accept 请求头，请核对其他请求要求')
        }
      } else if (option === '--url') {
        if (endpoint) throw new Error('每条 curl 只能包含一个接口地址')
        endpoint = value
      } else {
        if (data !== undefined) throw new Error('每条 curl 只能包含一个 JSON 请求体')
        data = value
      }
    } else if (/^https?:\/\//i.test(arg) && !endpoint) endpoint = arg
    else throw new Error('存在不支持的 curl 参数「' + arg + '」，请使用 JSON 请求示例')
  }
  let target: URL
  try { target = new URL(endpoint) } catch { throw new Error('接口地址无效') }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) {
    throw new Error('请使用不带凭据和片段的 HTTP(S) 接口地址')
  }
  const kindByPath: Record<string, ModelInterface['kind']> = {
    '/wb/agent': 'agent', '/workbuudy/agent': 'agent', '/wb/chat': 'chat', '/workbuudy/chat': 'chat',
    '/gemini/agent': 'gemini-agent', '/gemini/chat': 'gemini-chat',
    '/wbchat': 'chat', '/wbagent': 'agent',
  }
  const detected = kindByPath[target.pathname.replace(/\/$/, '')]
  const detectedType = detected?.endsWith('agent') ? 'agent' : detected ? 'chat' : undefined
  if (importType !== 'auto' && detectedType && detectedType !== importType) {
    throw new Error('请求地址与所选接口类型不符，请分别导入或选择自动识别')
  }
  const kind = detected || (importType !== 'auto' ? importType : undefined)
  if (!kind) throw new Error('无法识别接口类型，请选择 Chat 接口或 Agent 接口后解析')
  if (target.pathname.replace(/\/$/, '') === '/wbchat') target.pathname = '/wb/chat'
  if (target.pathname.replace(/\/$/, '') === '/wbagent') target.pathname = '/wb/agent'
  method ||= data === undefined ? 'GET' : 'POST'
  if (method !== 'POST' && !(kind === 'chat' && method === 'GET')) throw new Error('该接口须使用 POST JSON 请求')
  if (method === 'POST' && target.search) throw new Error('POST 请求请将参数放在 JSON 请求体中')
  let payload: Record<string, unknown>
  if (method === 'GET') {
    if (data !== undefined) throw new Error('GET 请求请使用地址查询参数')
    if (new Set(target.searchParams.keys()).size !== [...target.searchParams].length) throw new Error('查询参数不能重复')
    payload = Object.fromEntries(target.searchParams)
    target.search = ''
    if (payload.cdp_port !== undefined) throw new Error('带智能体端口的 Chat 接口请使用 POST JSON 请求')
  } else {
    try { payload = JSON.parse(data || '') } catch { throw new Error('JSON 请求体无效，请检查引号和 Windows 路径转义') }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('JSON 请求体须为对象')
  }
  const agent = kind === 'agent' || kind === 'gemini-agent'
  const fields = agent ? ['prompt', 'prj_dir', 'input_file_dir', 'code_dir', 'output_file_dir'] : ['prompt']
  if (kind === 'gemini-agent') fields.push('title')
  else fields.push('model')
  if (kind === 'agent' || kind === 'chat') fields.push('cdp_port')
  if (method === 'GET') fields.push('stream')
  if (Object.keys(payload).some(key => !fields.includes(key))) throw new Error('JSON 或查询参数包含当前接口配置不支持的字段')
  function stringValue(key: string, required = false) {
    const value = payload[key] ?? ''
    if (typeof value !== 'string' || (required && !value.trim())) throw new Error('模型标识、提示词和目录参数格式不正确，Agent 还须填写 prj_dir')
    return value
  }
  const model = kind === 'gemini-agent' ? '' : stringValue('model', true).trim()
  const rawPort = payload.cdp_port ?? (kind === 'agent' ? 9223 : method === 'GET' ? null : DEFAULT_CHAT_CDP_PORT)
  const port = typeof rawPort === 'string' && /^\d+$/.test(rawPort.trim()) ? Number(rawPort.trim()) : rawPort
  if ((kind === 'agent' || kind === 'chat') && port !== null && (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new Error('智能体端口须为 1–65535 的整数')
  }
  if (method === 'GET' && payload.stream !== undefined && !['0', '1'].includes(String(payload.stream))) throw new Error('stream 须为 0 或 1')
  const name = kind.toUpperCase() + (model ? ' · ' + model : '') + ' · ' + target.hostname + (port !== null && ['agent', 'chat'].includes(kind) ? ' · ' + port : '')
  return {
    id: '', name: name.slice(0, 100), kind, endpoint: target.href, model,
    enabled: true, isDefault: false, timeoutSeconds: 300, generationServerMode: 'auto', generationServerId: '',
    prjDir: agent ? stringValue('prj_dir', true).trim() : '',
    inputFileDir: agent ? stringValue('input_file_dir').trim() : '',
    codeDir: agent ? stringValue('code_dir').trim() : '', outputFileDir: agent ? stringValue('output_file_dir').trim() : '',
    ...(kind === 'agent' || kind === 'chat' ? { cdpPort: port as number | null } : {}),
    ...(kind === 'gemini-agent' ? { title: stringValue('title') } : {}),
    testUserPrompt: stringValue('prompt'), stream: payload.stream !== '0',
  }
}

export function parseAgentCurls(text: string, importType: AgentCurlImportType = 'auto'): { items: ModelInterface[]; errors: string[] } {
  const items: ModelInterface[] = [], errors: string[] = []
  let commands: string[][]
  try { commands = curlCommands(text) }
  catch (error) { return { items, errors: [(error as Error).message] } }
  if (!commands.length) return { items, errors: ['请粘贴至少一条 curl 请求'] }
  if (commands.length > 50) return { items, errors: ['一次最多导入 50 条请求'] }
  for (const [index, command] of commands.entries()) {
    try { items.push(parseCommand(command, importType)) }
    catch (error) { errors.push('第 ' + (index + 1) + ' 条请求解析失败，' + (error as Error).message) }
  }
  return { items, errors }
}
