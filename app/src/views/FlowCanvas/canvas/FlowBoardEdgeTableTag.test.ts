// @vitest-environment jsdom
// 连线血缘标注（0901）：两处回归——
// 1) 标注之前直接拼裸 tableId（如「6200026 → ?」），现在要按 id 查 entryDetail 换成可读 label；
// 2) 节点自己没显式落输出表时，「输出表」编辑框自己写着「默认 = 输入表」（RuleTableFieldBinder.vue），
//    这里的输出表也得兑现这句承诺，不能显示成 '?' 或裸 id。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'
import { entryApi } from '@/api'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

async function mountBoard() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: 'source-a' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  flow.newFlow('standard')
  const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { flow, wrapper }
}

describe('FlowBoard · 连线表关系标注', () => {
  it('输出表未显式设置时回退到本节点输入表（默认 = 输入表），且裸 tableId 会被换成可读 label', async () => {
    let resolveDetail!: (v: { tableId: string; tableName: string; name: string; fields: never[] }) => void
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(
      () => new Promise((resolve) => { resolveDetail = resolve }),
    )

    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    flow.configs[targetId].inputTable = '6200026'
    flow.configs[targetId].outputTable = ''
    if (flow.configs[targetId].collectCfg) flow.configs[targetId].collectCfg!.outputTable = ''
    await wrapper.vm.$nextTick()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    // 兜底阶段：entryDetail 还没 resolve，先拿裸 id 顶着，但至少不是 '?'
    expect(vm.edgeTableTag(targetId, 'end')).toBe('6200026 → ?')

    resolveDetail({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] })
    await flushPromises()
    expect(vm.edgeTableTag(targetId, 'end')).toBe('表-6200026 → ?')
  })

  it('entryDetail 查询失败：保留裸 tableId 兜底，不是空白', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockRejectedValue(new Error('网络错误'))

    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    flow.configs[targetId].inputTable = '6200026'
    flow.configs[targetId].outputTable = ''
    if (flow.configs[targetId].collectCfg) flow.configs[targetId].collectCfg!.outputTable = ''
    await wrapper.vm.$nextTick()
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    expect(vm.edgeTableTag(targetId, 'end')).toBe('6200026 → ?')
  })
})

// 节点卡片自己身上的「⊞ 输出表」角标（用户 2026-09-01 追加确认：跟连线标注同一套兜底+解析）。
describe('FlowBoard · 节点卡片「⊞ 输出表」角标', () => {
  it('节点自己没显式落输出表时也要按输入表兜底展示（此前 v-if 只认显式输出表，会整块不显示）', async () => {
    let resolveDetail!: (v: { tableId: string; tableName: string; name: string; fields: never[] }) => void
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(
      () => new Promise((resolve) => { resolveDetail = resolve }),
    )

    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    flow.configs[targetId].inputTable = '6200026'
    flow.configs[targetId].outputTable = ''
    if (flow.configs[targetId].collectCfg) flow.configs[targetId].collectCfg!.outputTable = ''
    await wrapper.vm.$nextTick()

    const card = wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(flow.configs[targetId].title))!
    const badge = () => card.find('.rc-node-table')
    // 兜底阶段：不再是"没显式落表就整块不显示"，裸 id 顶着也要能看到角标
    expect(badge().exists()).toBe(true)
    expect(badge().text()).toBe('⊞ 6200026')

    resolveDetail({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] })
    await flushPromises()
    expect(card.find('.rc-node-table').text()).toBe('⊞ 表-6200026')
  })
})
