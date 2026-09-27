// @vitest-environment jsdom
// 2026-09-26 用户反馈：「流程 SVG 图里，每个流程的 cond 没能在流程上展示出来」。
// 0925 前画布从不展示普通步骤的进入条件（只给决策/分头节点画「条件:」行、给 fan-out 分支列
// 标列首节点的条件），主链上的普通节点条件完全不可见。本文件锁住"普通节点卡片渲染进入条件"。
// 0926 拍板（同日晚）：卡片**不再展示 cond 具体文案**（连线/分支列标签已有展示），只标「条件」tag
// 提示该节点有条件进入；悬停 title 仍保留全文便于核对。
import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'

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

// 每个普通节点卡片上的条件 tag：data-testid 用节点 id 定位
function condTagOf(wrapper: ReturnType<typeof mount>, nodeId: string) {
  return wrapper.find(`[data-testid="node-cond-${nodeId}"]`)
}

describe('FlowBoard · 步骤进入条件的卡片 tag 展示', () => {
  it('普通节点设了进入条件：卡片标「条件」tag（不展示具体文案），未设条件不显示', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]

    // 未设条件：没有条件 tag
    expect(condTagOf(wrapper, targetId).exists()).toBe(false)

    // 字段模式条件组（EntryCondition：field + op + value）
    cfg.collectCfg!.entryCondition = {
      logic: 'AND',
      items: [{ field: 'K6', op: 'eq', value: '达标' }],
    }
    await wrapper.vm.$nextTick()
    const tag = condTagOf(wrapper, targetId)
    expect(tag.exists()).toBe(true)
    // 卡片只标「条件」，具体文案放 title（悬停查看）——连线/分支列标签才是常驻展示位
    expect(tag.text()).toBe('条件')
    expect(tag.attributes('title')).toBe('K6 等于 "达标"')

    // 表达式模式（mode === 'expr'）原样透传，同样只影响 title
    cfg.collectCfg!.entryCondition = { logic: 'AND', items: [], mode: 'expr', expr: 'K6=="nil"' }
    await wrapper.vm.$nextTick()
    expect(condTagOf(wrapper, targetId).text()).toBe('条件')
    expect(condTagOf(wrapper, targetId).attributes('title')).toBe('K6=="nil"')
  })

  it('决策节点不重复展示：已有「条件:」行（base 决策条件）', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    // 把普通节点改成决策节点：即使设了进入条件，决策卡片也只走自己的「条件:」行
    cfg.kind = 'decision'
    cfg.base = [['kind', '决策'], ['条件', '抓取成功且字段完整']]
    cfg.collectCfg!.entryCondition = { logic: 'AND', items: [{ field: 'K6', op: 'eq', value: '达标' }] }
    await wrapper.vm.$nextTick()
    expect(wrapper.find(`[data-testid="node-cond-${targetId}"]`).exists()).toBe(false)
  })
})