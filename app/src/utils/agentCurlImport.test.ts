import { describe, expect, it } from 'vitest'
import { agentInterfaceKey, parseAgentCurls } from './agentCurlImport'

const windowsAgent = String.raw`curl.exe -N -X POST "http://192.168.1.171:6000/wb/agent" -H "Content-Type: application/json" -d "{\"prj_dir\":\"D:\\aicode\",\"input_file_dir\":\"d:\\aicode\\input\",\"model\":\"hy3\",\"prompt\":\"\",\"code_dir\":\"D:\\aicode\\code\",\"output_file_dir\":\"D:\\aicode\\output\",\"cdp_port\":9222}"`

describe('智能体 curl 批量导入', () => {
  it('同一远程地址、类型、模型和端口按一个接口判重，提示词和目录不影响身份', () => {
    const original = parseAgentCurls(windowsAgent).items[0]!
    const configured = { ...original, name: 'WB-AGENT', generationServerId: 'server-171', generationServerMode: 'manual' as const,
      prjDir: 'D:\\codeserver\\workspace', inputFileDir: '', testUserPrompt: '已经修改的测试提示词', enabled: false }
    expect(agentInterfaceKey(configured)).toBe(agentInterfaceKey(original))
    expect(agentInterfaceKey({ ...original, endpoint: original.endpoint + '/' })).toBe(agentInterfaceKey(original))
    expect(agentInterfaceKey({ ...original, endpoint: original.endpoint.replace('/wb/agent', '/wbagent') })).toBe(agentInterfaceKey(original))
    const chat = { ...original, kind: 'chat' as const, endpoint: 'http://192.168.1.171:6000/wb/chat' }
    expect(agentInterfaceKey({ ...chat, endpoint: chat.endpoint.replace('/wb/chat', '/wbchat') })).toBe(agentInterfaceKey(chat))
    expect(agentInterfaceKey({ ...original, cdpPort: 9223 })).not.toBe(agentInterfaceKey(original))
    expect(agentInterfaceKey({ ...original, kind: 'chat' })).not.toBe(agentInterfaceKey(original))
    const local = { ...original, endpoint: 'http://127.0.0.1:6000/wb/agent' }
    expect(agentInterfaceKey({ ...local, generationServerId: 'server-1' })).not.toBe(agentInterfaceKey({ ...local, generationServerId: 'server-2' }))
  })
  it('保留用户示例里的 Windows 路径、空提示词和智能体端口', () => {
    const result = parseAgentCurls(windowsAgent)
    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      kind: 'agent', endpoint: 'http://192.168.1.171:6000/wb/agent', model: 'hy3', cdpPort: 9222,
      prjDir: 'D:\\aicode', inputFileDir: 'd:\\aicode\\input', codeDir: 'D:\\aicode\\code',
      outputFileDir: 'D:\\aicode\\output', testUserPrompt: '', generationServerMode: 'auto',
    })
  })

  it('一次识别多条 Windows 和 Bash 命令，保留不同端口及 Gemini 类型', () => {
    const commands = [
      windowsAgent.replace(' -H ', ' ^\n  -H ').replace(' -d ', ' ^\n  -d '),
      windowsAgent.replace('9222', '9333'),
      'curl -N -X POST "http://host:6000/wb/chat" \\\n -H "Content-Type: application/json" -d \'{"model":"hy3","prompt":"地球有多大？"}\'',
      'curl -X POST http://host:6000/gemini/agent -d \'{"prj_dir":"/data/code","title":"测试","prompt":"优化代码"}\'',
      'curl -X POST http://host:6000/gemini/chat --data-raw=\'{"model":"gemini-3.5-flash-lite","prompt":"hello"}\'',
    ].join('\n\n')
    const result = parseAgentCurls(commands)
    expect(result.errors).toEqual([])
    expect(result.items.map(item => item.kind)).toEqual(['agent', 'agent', 'chat', 'gemini-agent', 'gemini-chat'])
    expect(result.items.map(item => item.cdpPort)).toEqual([9222, 9333, 9222, undefined, undefined])
    expect(result.items[3]).toMatchObject({ title: '测试', prjDir: '/data/code', model: '' })
  })

  it('支持 Bash 双引号 JSON、PowerShell 单引号 JSON 和 GET 查询参数', () => {
    const json = JSON.stringify({ prj_dir: 'D:\\aicode', model: 'hy3', prompt: 'a "quote"\n下一行' })
    const bashQuoted = '"' + json.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
    const result = parseAgentCurls([
      'curl -XPOST http://host/wb/agent -d ' + bashQuoted,
      "curl.exe -X POST http://host/wb/agent -d '" + json + "'",
      'curl "http://host/wb/chat?model=hy3&prompt=%E4%BD%A0%E5%A5%BD&stream=0"',
    ].join('\n'))
    expect(result.errors).toEqual([])
    expect(result.items[0]?.testUserPrompt).toBe('a "quote"\n下一行')
    expect(result.items[1]?.prjDir).toBe('D:\\aicode')
    expect(result.items[2]).toMatchObject({ endpoint: 'http://host/wb/chat', cdpPort: null, stream: false, testUserPrompt: '你好' })
  })

  it('兼容截图中带换行的 Windows 请求、字符串端口与 wbchat 地址', () => {
    const chat = String.raw`curl.exe -N -X POST "http://192.168.1.172:6000/wbchat" -H "Content-Type: application/json" -d "
{\"model\":\"hy3\",\"prompt\":\"\",\"cdp_port\":\"9222\"}"`
    const result = parseAgentCurls(windowsAgent.replace(' -d "', ' -d "\n') + '\n\n' + chat)
    expect(result.errors).toEqual([])
    expect(result.items.map(item => item.kind)).toEqual(['agent', 'chat'])
    expect(result.items[1]).toMatchObject({ endpoint: 'http://192.168.1.172:6000/wb/chat', cdpPort: 9222 })
  })

  it('自定义地址按手工选择的 Chat 或 Agent 类型导入，已知地址类型冲突时明确提示', () => {
    const chat = 'curl -X POST http://host/custom-chat -d \'{"model":"hy3","prompt":"","cdp_port":"9222"}\''
    expect(parseAgentCurls(chat).errors[0]).toContain('请选择 Chat 接口或 Agent 接口')
    expect(parseAgentCurls(chat, 'chat').items[0]).toMatchObject({ kind: 'chat', endpoint: 'http://host/custom-chat', cdpPort: 9222 })
    expect(parseAgentCurls(windowsAgent, 'chat').errors[0]).toContain('接口类型不符')
    const agent = windowsAgent.replace('/wb/agent', '/custom-agent')
    expect(parseAgentCurls(agent, 'agent').items[0]).toMatchObject({ kind: 'agent', prjDir: 'D:\\aicode' })
  })

  it('不支持的 curl 参数直接报错并点名，不会静默丢掉认证类选项', () => {
    for (const command of [
      'curl -X POST http://host/wb/chat --compressed -d \'{"model":"hy3"}\'',
      'curl -X POST http://host/wb/chat -u user:pass -d \'{"model":"hy3"}\'',
    ]) {
      const result = parseAgentCurls(command)
      expect(result.items).toEqual([])
      expect(result.errors[0]).toContain('存在不支持的 curl 参数')
    }
    expect(parseAgentCurls('curl -X POST http://host/wb/chat --compressed -d \'{"model":"hy3"}\'').errors[0]).toContain('--compressed')
  })

  it.each([
    'curl -X POST http://host/wb/chat -d \'{"model":"hy3","cdp_port":0}\'',
    'curl -X POST http://host/wb/chat -d \'{"model":"hy3","cdp_port":"not-a-port"}\'',
    'curl -X POST http://host/wb/chat -d \'{"model":"hy3","unknown":"ignored?"}\'',
    'curl -X POST http://host/wb/chat -d @request.json',
    'curl -X POST http://host/wb/chat -H "Authorization: Bearer private" -d \'{"model":"hy3"}\'',
    'curl -X POST http://host/wb/chat -d \'{"model":"hy3"}\' && echo unsafe',
    'curl -X POST http://host/wb/agent -d \'{"model":"hy3"}\'',
    'curl -X DELETE http://host/wb/agent',
    'curl -X POST http://host/wb/chat -d "incomplete',
  ])('对无效或无法保真的请求给出错误，不泄露原请求 %s', command => {
    const result = parseAgentCurls(command)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.join(' ')).not.toContain('private')
    expect(result.items).toEqual([])
  })
})
