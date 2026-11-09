// @vitest-environment jsdom
// 流程中心「分析变体 / 推荐归类」抽屉（1105 会议）。算法在 utils/flow/flowVariants.test.ts 测，
// 这里测接线：拉本组流程 → 逐个读步骤 → 分组展示、对比、按推荐归类调接口。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import FlowVariantDrawer from './FlowVariantDrawer.vue'
import { flowCenterApi, type FlowRecord, type FlowTemplateGroup, type Step } from '@/api'

const flow = (id: string, name = `流程${id}`) => ({ id, name, updatedAt: '', definition: { main: [], branches: [], configs: {} }, sourceCnt: 2 }) as FlowRecord
function steps(prefix: string, types: string[], over: Partial<Step> = {}): Step[] {
  return types.map((configType, i) => ({ stepId: `${prefix}${i}`, sourceId: '-1', name: `节点${i}`, configType, dependsOn: i ? [`${prefix}${i - 1}`] : [], ...over }) as Step)
}
const groups: FlowTemplateGroup[] = [
  { id: 't1', name: '列表详情', flowCount: 3, structure: '', disabled: false },
  { id: 't2', name: '下载 OCR', flowCount: 0, structure: '', disabled: false },
  { id: 'unassigned', name: '未归类', flowCount: 2, structure: '', disabled: false },
]

function mountDrawer(groupId: string) {
  return mount(FlowVariantDrawer, {
    props: { modelValue: true, group: groups.find((g) => g.id === groupId), templateGroups: groups },
    global: { stubs: { ElDrawer: { template: '<div><slot /></div>' } } },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('FlowVariantDrawer · 分析变体', () => {
  it('拉本组全部流程，按结构分出变体，次要变体标出多出来的节点', async () => {
    const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 3, list: [flow('1'), flow('2'), flow('3')] } as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => (id === '2' ? steps('b', ['90', '90', '720']) : steps(`s${id}`, ['90', '90'])))
    const wrapper = mountDrawer('t1')
    await flushPromises()

    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', unassignedTemplate: false, onlyTemplate: false }))
    expect(wrapper.get('[data-testid="flow-variant-summary"]').text()).toBe('共 3 个流程，2 个变体')
    const variants = wrapper.findAll('[data-testid="flow-variant"]')
    expect(variants[0]!.text()).toContain('变体 A')
    expect(variants[0]!.text()).toContain('2 个流程')
    expect(variants[1]!.get('.fv-node.added').text()).toBe('+ 文章生成摘要')
  })

  it('勾两个流程逐步骤对比，只列有差异的字段', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [flow('1', '甲'), flow('2', '乙')] } as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => steps(`s${id}`, ['90', '90'], { outputTable: id === '1' ? 'TB_A' : 'TB_B' }))
    const wrapper = mountDrawer('t1')
    await flushPromises()

    for (const box of wrapper.findAll('[data-testid="flow-variant-compare-pick"]')) await box.setValue(true)
    const compare = wrapper.get('[data-testid="flow-variant-compare"]')
    expect(compare.text()).toContain('「甲」 vs 「乙」 · 2 处步骤有差异')
    expect(compare.text()).toContain('输出表')
    expect(compare.text()).toContain('TB_B')
  })

  it('个别流程步骤读取失败时照常分析其余的，并说明哪些没参与', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [flow('1'), flow('2', '坏流程')] } as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => {
      if (id === '2') throw new Error('500')
      return steps('s', ['90'])
    })
    const wrapper = mountDrawer('t1')
    await flushPromises()

    expect(wrapper.text()).toContain('1 个流程的步骤读取失败，未参与分析：坏流程')
    expect(wrapper.get('[data-testid="flow-variant-summary"]').text()).toBe('共 1 个流程，1 个变体')
  })
})

describe('FlowVariantDrawer · 未归类推荐', () => {
  it('按结构推荐模板，确认后按模板分批调用归类接口并通知列表刷新', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [flow('1'), flow('2')] } as never)
    vi.spyOn(flowCenterApi, 'detail').mockImplementation(async (id) => ({
      ...flow(id),
      definition: { structureOnly: true, main: ['start', 'n1', 'n2', 'end'], branches: [], configs: id === 't1' ? { n1: { configType: '90' }, n2: { configType: '90' } } : { n1: { configType: '95' }, n2: { configType: '150' } } },
    }) as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => (id === '1' ? steps('a', ['90', '90']) : steps('b', ['720', '730', '800'])))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const assign = vi.spyOn(flowCenterApi, 'assignTemplate').mockResolvedValue({ ok: true })
    const wrapper = mountDrawer('unassigned')
    await flushPromises()

    expect(flowCenterApi.paged).toHaveBeenCalledWith(expect.objectContaining({ unassignedTemplate: true, templateId: undefined }))
    const rows = wrapper.findAll('[data-testid="flow-variant-recommend-row"]')
    expect(rows[0]!.text()).toContain('列表详情 100%')
    expect(rows[1]!.text()).toContain('无相近模板')

    await wrapper.get('[data-testid="flow-variant-assign"]').trigger('click')
    await flushPromises()
    expect(assign).toHaveBeenCalledWith(['1'], 't1')
    expect(wrapper.emitted('assigned')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="flow-variant-recommend-row"]')).toHaveLength(1)
  })
})
