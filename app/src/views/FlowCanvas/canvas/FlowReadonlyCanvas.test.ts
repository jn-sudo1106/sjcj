// @vitest-environment jsdom
// 2026-10-31 流程选择弹窗的只读画布：与工作区同一纵向布局，分叉的分支都画出来，没有任何编辑入口，不碰全局 flow store
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FlowReadonlyCanvas from './FlowReadonlyCanvas.vue'
import { buildSourceSeed } from './flowModel'
import { buildVerticalLayout } from './flowModel.verticalLayout'
import { entryApi, type Source, type Step } from '@/api'
import { useFlowStore } from '@/stores/flow'

const SOURCE = { sourceId: '', name: '测试流程', url: '', configId: '900', mainTable: '', owner: '', state: 'C' } as Source
const STEPS = [
  { stepId: '100', sourceId: '', name: '入口', isRoot: true, configId: '9001', outputTable: '6200001', dependsOn: [] },
  { stepId: '101', sourceId: '', name: '分支甲', configId: '9002', outputTable: '6200002', dependsOn: ['100'] },
  { stepId: '102', sourceId: '', name: '分支乙', configId: '9003', outputTable: '6200003', dependsOn: ['100'] },
] as Step[]

afterEach(() => vi.restoreAllMocks())

function seedDef() {
  const seed = buildSourceSeed(SOURCE, STEPS)
  return { main: seed.main, branches: seed.branches, configs: seed.configs, branchGroups: seed.branchGroups }
}

describe('FlowReadonlyCanvas', () => {
  it('画出起止、全部节点（含分叉的两支），没有插入 / 删除等编辑按钮；点节点只发 select', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(null as never)
    const def = seedDef()
    const w = mount(FlowReadonlyCanvas, { props: { def } })
    await flushPromises()
    const titles = w.findAll('[data-testid="flow-readonly-node"] .rc-node-title').map((n) => n.text())
    expect(titles).toEqual(expect.arrayContaining(['入口', '分支甲', '分支乙']))
    expect(w.findAll('.rc-term').map((t) => t.text())).toEqual(['开始', '完成 / 发布候选'])
    expect(w.findAll('button')).toHaveLength(0)
    await w.findAll('[data-testid="flow-readonly-node"]')[0].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual([expect.any(String)])
    await w.setProps({ selected: w.emitted('select')![0][0] as string })
    expect(w.findAll('.rc-flow-node.active')).toHaveLength(1)
  })

  it('布局与工作区画布（flow store 的 layout）一致，且不改全局 store', () => {
    setActivePinia(createPinia())
    const store = useFlowStore()
    const def = seedDef()
    store.load({ id: '900', name: '测试流程', version: 'v1', updatedAt: '', ...def })
    expect(JSON.stringify(buildVerticalLayout(def.main, def.branches, def.configs, def.branchGroups)))
      .toBe(JSON.stringify(store.layout))
    // 挂只读画布不会动 store 里当前的流程
    store.load({ id: 'x', name: 'x', version: 'v1', updatedAt: '', main: ['start', 'end'], branches: [], configs: {}, branchGroups: [] })
    const current = JSON.stringify(store.layout)
    mount(FlowReadonlyCanvas, { props: { def } })
    expect(JSON.stringify(store.layout)).toBe(current)
  })
})
