import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from './runtime'
import { cloneConfig, NODE_CONFIGS, type FlowDef } from '@/views/FlowCanvas/canvas/flowModel'

function makeDef(): FlowDef {
  const login = cloneConfig(NODE_CONFIGS['login-collect'])
  const rule = cloneConfig(NODE_CONFIGS.rule)
  const web = cloneConfig(NODE_CONFIGS['web-list'])
  rule.ruleCfg = { ...rule.ruleCfg!, ruleId: '173', script: 'def main(value): return value' }
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

  it('规则节点不依赖 NodeConfig.outputTable，已有规则脚本即可运行', () => {
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
})
