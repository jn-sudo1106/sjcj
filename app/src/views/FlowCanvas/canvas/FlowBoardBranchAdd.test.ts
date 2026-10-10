// @vitest-environment jsdom
// 1008-BR-04：画布上新建分支 / 线上插入的入口。
//  - 节点左右「+」= 给节点加兄弟（同一个上级），悬停 / 选中时出现；根位节点没有；上级没表时置灰并提示旧平台原文
//  - 分支区域线上「+」：分叉前（接管全部分支）/ 分支链头上方 / 链内两节点之间
import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'
import type { Step } from '@/api'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const mk = (stepId: string, dependsOn: string[]): Step => ({
  stepId, sourceId: '430016824', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable: '900', enabled: true,
} as Step)

async function mountBoard(steps: Step[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: '430016824' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  flow.loadFromSource(
    { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
    steps,
  )
  const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  await flushPromises()
  return { flow, wrapper }
}

const pick = async (wrapper: Awaited<ReturnType<typeof mountBoard>>['wrapper'], name: string) => {
  const item = wrapper.findAll('.anp-pop button, .anp-pop [role="option"], .anp-pop li').find((el) => el.text().includes(name))
  expect(item, `浮层里找不到「${name}」`).toBeTruthy()
  await item!.trigger('click')
  await flushPromises()
}

describe('FlowBoard · 新建分支与分支区域插入（1008-BR-04）', () => {
  it('悬停节点出现左右「+」；根位节点不出现', async () => {
    const { wrapper } = await mountBoard([mk('1', ['0']), mk('2', ['1'])])
    const node = (id: string) => wrapper.findAll('.rc-flow-node').find((n) => n.find('[data-testid="node-step-id"]').text() === `#${id}`)!
    await node('2').trigger('mouseenter')
    expect(wrapper.find('[data-testid="side-add-left-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="side-add-right-2"]').exists()).toBe(true)
    await node('1').trigger('mouseenter')
    expect(wrapper.find('[data-testid="side-add-left-1"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点右侧「+」选模板 → 在上级处分叉，新节点排最右', async () => {
    const { flow, wrapper } = await mountBoard([mk('1', ['0']), mk('2', ['1'])])
    flow.select('2')
    await flushPromises()
    await wrapper.get('[data-testid="side-add-right-2"]').trigger('click')
    await pick(wrapper, '网页抓取')
    const group = flow.branchGroups.find((g) => g.ownerId === '1')!
    expect(group.branches.map((b) => b.chain.length)).toEqual([1, 1])
    expect(group.branches[0].chain).toEqual(['2'])
    wrapper.unmount()
  })

  it('上级没有输出表：左右「+」置灰，点了提示旧平台原文、不出浮层', async () => {
    const { flow, wrapper } = await mountBoard([mk('1', ['0']), mk('2', ['1'])])
    const parent = flow.configs['1']
    if (parent.collectCfg) { parent.collectCfg.outputTable = ''; parent.collectCfg.inputTable = '' }
    parent.outputTable = ''
    parent.inputTable = ''
    flow.select('2')
    await flushPromises()
    const btn = wrapper.get('[data-testid="side-add-right-2"]')
    expect(btn.classes()).toContain('blocked')
    expect(btn.attributes('title')).toBe('所选步骤输出表为空，无法增加后续步骤')
    await btn.trigger('click')
    expect(wrapper.find('.anp-pop').exists()).toBe(false)
    wrapper.unmount()
  })

  it('分叉流程画出三类线上「+」：分叉前、各分支链头上方、链内两节点之间', async () => {
    const { wrapper } = await mountBoard([mk('1', ['0']), mk('2', ['1']), mk('3', ['1']), mk('4', ['3'])])
    expect(wrapper.find('[data-testid="edge-slot-trunk:1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="edge-slot-head:1:2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="edge-slot-head:1:3"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="edge-slot-in:3"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('分支链头上方「+」只插进这一支；分叉前「+」接管全部分支', async () => {
    const { flow, wrapper } = await mountBoard([mk('1', ['0']), mk('2', ['1']), mk('3', ['1'])])
    await wrapper.get('[data-testid="edge-slot-head:1:3"]').trigger('click')
    await pick(wrapper, '网页抓取')
    const inserted = flow.parentOfNode('3')!
    expect(flow.parentOfNode(inserted)).toBe('1')
    expect(flow.parentOfNode('2')).toBe('1')

    await wrapper.get('[data-testid="edge-slot-trunk:1"]').trigger('click')
    await pick(wrapper, '网页抓取')
    const trunk = flow.parentOfNode('2')!
    expect(flow.parentOfNode(trunk)).toBe('1')
    expect(flow.parentOfNode(inserted)).toBe(trunk)
    wrapper.unmount()
  })
})
