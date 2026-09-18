// @vitest-environment jsdom
// 2026-09-18 用户报：节点右侧明明「已有配置 #1401008」、卡片上也写着「⊞ 通用新闻表」，
// 底部状态却是「待配置」（title：还缺输出表）。
//
// 根因是两处口径不一致：卡片那行表名用 effectiveOutputTable（没显式设就继承上游），
// 状态判定只认 nodeOutputTable（显式值）。本文件锁住"两边必须一致"。
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

describe('FlowBoard · 节点状态与卡片上的表名必须一致', () => {
  it('非采集节点继承上游输出表时算「已配置」，不再是「待配置」', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    // 造一个处理型节点（文章生成摘要这类）：没有采集配置、没显式输出表，只继承上游的表
    delete cfg.collectCfg
    cfg.inputTable = '900'
    cfg.outputTable = ''
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as unknown as {
      tableChip: (c: unknown) => { label: string; unset: boolean } | null
      footFor: (c: unknown) => { left: string; hint: string }
    }
    // 卡片那行表名认这张表（title 里写明是继承来的）
    expect(vm.tableChip(cfg)?.label).toBeTruthy()
    expect(vm.tableChip(cfg)?.unset).toBe(false)
    // 状态必须跟着它走
    expect(vm.footFor(cfg).left).not.toBe('待配置')
    expect(vm.footFor(cfg).hint).toBe('')
  })

  // 节点种子里几乎每个模板的初始 status 都写着 '待配置'，配好之后没人清它。
  // 此前 footFor 原样把它当运行态吐出来，于是「已配置」的节点仍然显示「待配置」，
  // 而 missingFor 又查不出缺什么——卡片上只剩一个没有任何解释的标签（用户报的就是这个）。
  it('种子里的初始 status「待配置」不当运行态用', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    delete cfg.collectCfg
    cfg.inputTable = '900'
    cfg.outputTable = '900'
    cfg.status = '待配置'          // 种子里带来的占位值
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as unknown as {
      tableChip: (c: unknown) => { label: string; unset: boolean } | null
      footFor: (c: unknown) => { left: string; hint: string }
    }
    expect(vm.footFor(cfg).left).toBe('运行')

    // 真正的运行态照常显示
    cfg.status = '运行中'
    expect(vm.footFor(cfg).left).toBe('运行中')
  })

  it('上下游都没有表才是真的「待配置」，并说明缺什么', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    delete cfg.collectCfg
    cfg.inputTable = ''
    cfg.outputTable = ''
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as unknown as {
      tableChip: (c: unknown) => { label: string; unset: boolean } | null
      footFor: (c: unknown) => { left: string; hint: string }
    }
    expect(vm.tableChip(cfg)).toBeNull()
    expect(vm.footFor(cfg).left).toBe('待配置')
    expect(vm.footFor(cfg).hint).toContain('输出表')
  })
})
