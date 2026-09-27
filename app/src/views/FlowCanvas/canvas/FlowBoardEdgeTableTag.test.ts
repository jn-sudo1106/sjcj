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
  const tableTagOf = (wrapper: ReturnType<typeof mount>, text: string) =>
    wrapper.findAll('.rc-edge-table-tag').find((t) => t.text() === text)

  // 0926 补记：原用例走 vm.edgeTableTag（script setup 内部函数未 expose，Vue3.3+ 拿不到），
  // 改为断言连线标签真实渲染的 DOM 文本。
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

    // 兜底阶段：entryDetail 还没 resolve，先拿裸 id 顶着，但至少不是 '?'
    // （start→targetId 是主链真实边；inp 侧是测试节点自己的输入表）
    expect(tableTagOf(wrapper, '? → 6200026')).toBeTruthy()

    resolveDetail({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] })
    await flushPromises()
    expect(tableTagOf(wrapper, '? → 表-6200026')).toBeTruthy()
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

    // 输入侧裸 id 兜底仍在（start→targetId 边）
    expect(tableTagOf(wrapper, '? → 6200026')).toBeTruthy()
  })
})

// 节点卡片自己身上的「⊞ 输出表」角标（用户 2026-09-01 追加确认：跟连线标注同一套兜底+解析）。
describe('FlowBoard · 节点卡片「⊞ 输出表」角标', () => {
  // 2026-09-04 修正这条的口径：兜底展示要保留（不能整块消失），但**采集节点**不能把输入表
  // 冒充成输出表——它的编辑框写的是「请选择输出表」，输出表必填。原来标成「输出表 X」，
  // 卡片底部却是「待配置」，看上去自相矛盾（用户实例：流程 1400984 的「网页抓取测试01」，
  // 配置 1400990 的 outEntry 为 null）。现在加 `→ ?` 并把 title 说成输入表。
  it('采集节点没显式落输出表：角标仍显示（不整块消失），但标成输入表 + → ?，不冒充输出表', async () => {
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
    expect(badge().text()).toBe('⊞ 6200026 → ?')
    expect(badge().attributes('title')).toBe('输入表 6200026 · 尚未设置输出表')
    expect(badge().classes()).toContain('unset')

    resolveDetail({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] })
    await flushPromises()
    expect(card.find('.rc-node-table').text()).toBe('⊞ 表-6200026 (6200026) → ?')

    // 真的设上输出表后，角标变成「输入表 → 输出表」成对展示（0926 拍板），
    // 且表 ID 跟着业务名一起显示（0926 拍板「表的 ID 也是需要的」）
    flow.configs[targetId].collectCfg!.outputTable = '6200026'
    await wrapper.vm.$nextTick()
    const settled = card.find('.rc-node-table')
    expect(settled.text()).toBe('⊞ 表-6200026 (6200026) → 表-6200026 (6200026)')
    expect(settled.attributes('title')).toBe('输入表 表-6200026 (6200026) → 输出表 表-6200026 (6200026)')
    expect(settled.classes()).not.toContain('unset')
  })

  // 2026-09-04：流程视图里采集节点永远"待配置"的真因——只认 collectCfg.url（源 URL，
  // 流程视图没有源、填不上），而用户在节点配置 Tab 里看到并编辑的 URL 是 cfg.configUrl。
  it('绑了配置、URL 只在 configUrl 上时不算待配置（流程视图没有源 URL）', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] } as never)
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    cfg.collectCfg!.url = ''            // 流程视图：没有源，源 URL 填不上
    cfg.collectCfg!.outputTable = '6200026'
    cfg.configId = '1400990'
    cfg.configUrl = 'www.baidu.com'     // 节点配置 Tab 里显示的就是这个
    await flushPromises()

    const card = wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(cfg.title))!
    expect(card.findAll('.rc-chip').some((c) => c.text() === '待配置')).toBe(false)
  })

  it('「待配置」角标的 title 说明还缺什么（原来只有状态词，用户无从自查）', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] } as never)
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    flow.configs[targetId].collectCfg!.url = 'www.baidu.com'
    flow.configs[targetId].collectCfg!.outputTable = ''  // 只缺输出表
    await flushPromises()

    const card = wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(flow.configs[targetId].title))!
    const chip = card.findAll('.rc-chip').find((c) => c.text() === '待配置')!
    expect(chip.attributes('title')).toBe('还缺：输出表')
  })

  it('规则节点已有 configId 和脚本时不再因为缺 ruleId 显示待配置', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({ tableId: '6200026', tableName: 'sense_data.T_6200026', name: '表-6200026', fields: [] } as never)
    const { flow, wrapper } = await mountBoard()
    const ruleId = flow.main.find((id) => flow.configs[id]?.ruleCfg)!
    flow.configs[ruleId].configId = '1400998'
    delete flow.configs[ruleId].ruleCfg!.ruleId
    flow.patchRuleConfig(ruleId, { script: 'def main():\n    return {}' })
    await flushPromises()

    const card = wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(flow.configs[ruleId].title))!
    expect(card.findAll('.rc-chip').some((c) => c.text() === '待配置')).toBe(false)
  })
})
