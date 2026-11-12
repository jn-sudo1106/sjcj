import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from './runtime'
import { cloneConfig, NODE_CONFIGS, type FlowDef } from '@/views/FlowCanvas/canvas/flowModel'

function makeDef(): FlowDef {
  const login = cloneConfig(NODE_CONFIGS['login-collect'])
  const rule = cloneConfig(NODE_CONFIGS.rule)
  const web = cloneConfig(NODE_CONFIGS['web-list'])
  login.collectCfg!.loginConfigs = [{
    id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', loginPwd: 'pwd-1', newLoginConfig: '1', authConfig: '', enabled: true,
  }]
  login.collectCfg!.defaultLoginConfigId = 'login-1'
  rule.configId = '1400998'
  rule.ruleCfg = { ...rule.ruleCfg!, script: 'def main(value): return value' }
  if (web.collectCfg) web.collectCfg.outputTable = ''
  return {
    id: 'runtime-test', name: 'runtime-test', version: 'test',
    main: ['login', 'rule', 'web'], branches: [],
    configs: { login, rule, web }, updatedAt: '',
  }
}

describe('runtime 节点能力校验', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('登录节点只要求登录 URL，不要求输出表', () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const runtime = useRuntimeStore()
    const result = runtime.runSingleNode(makeDef(), 'login')
    expect(result.runId).toBeTruthy()
    expect(result.reason).toBeUndefined()
    vi.runAllTimers()
  })

  it('规则节点不依赖 ruleId，已有 configId 和规则脚本即可运行', () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const runtime = useRuntimeStore()
    const result = runtime.runSingleNode(makeDef(), 'rule')
    expect(result.runId).toBeTruthy()
    vi.runAllTimers()
  })

  it('普通采集节点仍要求输出表', () => {
    setActivePinia(createPinia())
    const runtime = useRuntimeStore()
    const result = runtime.runSingleNode(makeDef(), 'web')
    expect(result.runId).toBe('')
    expect(result.reason).toContain('缺少必要配置')
  })

  it('发起抓取时使用任务级登录配置覆盖，且不修改节点默认配置', () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const def = makeDef()
    def.configs.login.collectCfg!.loginConfigs = [
      { id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', loginPwd: 'pwd-1', newLoginConfig: '1', authConfig: '', enabled: true },
      { id: 'login-2', loginUrl: 'https://example.com/login', loginName: 'backup-user', loginPwd: 'pwd-2', newLoginConfig: '1', authConfig: '', enabled: true },
    ]
    def.configs.login.collectCfg!.defaultLoginConfigId = 'login-1'
    const runtime = useRuntimeStore()
    const runId = runtime.startCapture(def, { loginNodeId: 'login', loginConfigId: 'login-2' })

    expect(runId).toBeTruthy()
    expect(runtime.runs[0]).toMatchObject({
      loginConfigId: 'login-2', loginAccount: 'backup-user',
    })
    expect(def.configs.login.collectCfg!.defaultLoginConfigId).toBe('login-1')
    vi.runAllTimers()
  })
})
