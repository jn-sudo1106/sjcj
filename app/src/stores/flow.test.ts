import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFlowStore } from './flow'

describe('flow store 编辑动作', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('insertAfter 在主链插入节点', () => {
    const f = useFlowStore()
    const before = f.main.length
    f.insertAfter('web-list', 'web')
    expect(f.main.length).toBe(before + 1)
  })

  it('moveTo 重排且保持首尾终端', () => {
    const f = useFlowStore()
    f.moveTo('web-list', 'ai-extract')
    const m = f.main
    expect(m.indexOf('web-list')).toBeGreaterThan(m.indexOf('ai-extract'))
    expect(m[0]).toBe('start')
    expect(m[m.length - 1]).toBe('end')
  })

  it('moveTo 不移动终端节点', () => {
    const f = useFlowStore()
    f.moveTo('start', 'rule')
    expect(f.main[0]).toBe('start')
  })

  it('patchCollect 写入采集配置', () => {
    const f = useFlowStore()
    f.patchCollect('web-list', { url: 'http://new.example' })
    expect(f.configs['web-list'].collectCfg?.url).toBe('http://new.example')
  })

  it('setEdgeRow 改子步骤字段', () => {
    const f = useFlowStore()
    f.setEdgeRow('web-list', 0, '新适用源')
    expect(f.edges['web-list'].rows[0][1]).toBe('新适用源')
  })

  it('addEdgeContext / removeEdgeContext', () => {
    const f = useFlowStore()
    const n = f.edges['web-list'].context.length
    f.addEdgeContext('web-list', 'K9 → x')
    expect(f.edges['web-list'].context.length).toBe(n + 1)
    f.removeEdgeContext('web-list', f.edges['web-list'].context.length - 1)
    expect(f.edges['web-list'].context.length).toBe(n)
  })
})
