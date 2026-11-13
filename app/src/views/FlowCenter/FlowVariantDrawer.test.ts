// @vitest-environment jsdom
// 流程中心「分析变体 / 推荐归类」抽屉（1105 会议）。算法在 utils/flow/flowVariants.test.ts 测，
// 这里测接线：拉本组流程 → 逐个读步骤 → 分组展示、对比、按推荐归类调接口。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import FlowVariantDrawer from './FlowVariantDrawer.vue'
import { flowCenterApi, type FlowRecord, type FlowTemplateGroup, type Step } from '@/api'
import { clearVariantCache } from '@/utils/flow/flowVariants'

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

// 抽屉的步骤读取结果按「组 + 算法版本 + 流程指纹」缓存在模块内存里（1106 §4.3），
// 每个用例都从空缓存开始，避免上一个用例缓存的步骤干扰下一个用例的 mock。
beforeEach(() => clearVariantCache())
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

describe('FlowVariantDrawer · 配置组与缓存（1106 §4.2/§4.3）', () => {
  it('结构相同、输出表不同时拆成两个配置组，并给出与 A1 的差异摘要', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 3, list: [flow('1', '甲'), flow('2', '乙'), flow('3', '丙')] } as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => steps(`s${id}`, ['90', '600'], {
      outputTable: id === '3' ? 'TB_B' : 'TB_A',
      codeRule: 'r1',
    }))
    const wrapper = mountDrawer('t1')
    await flushPromises()

    // 结构是同一个变体，但配置拆成两组：A1（2 个流程）在前，A2（1 个流程）带差异摘要
    expect(wrapper.findAll('[data-testid="flow-variant"]')).toHaveLength(1)
    const configGroups = wrapper.findAll('[data-testid="flow-variant-config-group"]')
    expect(configGroups).toHaveLength(2)
    expect(configGroups[0]!.text()).toContain('配置组 A1')
    expect(configGroups[0]!.text()).toContain('2 个流程')
    expect(configGroups[0]!.text()).toContain('输出表：TB_A')
    expect(configGroups[1]!.text()).toContain('配置组 A2')
    expect(configGroups[1]!.text()).toContain('输出表：TB_B')
    const diff = configGroups[1]!.get('[data-testid="flow-variant-config-diff"]').text()
    expect(diff).toContain('与配置组 A1 差异')
    expect(diff).toContain('输出表不同：TB_A / TB_B')
  })

  it('结构相同、脚本字段不同时也拆组，差异摘要落到具体节点和字段', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [flow('1', '甲'), flow('2', '乙')] } as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => steps(`s${id}`, ['90'], {
      outputTable: 'TB_A',
      codeRule: id === '1' ? 'rule_a' : 'rule_b',
    }))
    const wrapper = mountDrawer('t1')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="flow-variant-config-group"]')).toHaveLength(2)
    // 步骤名相同，所以差异落在「节点名称」上时摘要按节点名标；脚本差异要带上字段和值
    const diff = wrapper.findAll('[data-testid="flow-variant-config-group"]')[1]!.get('[data-testid="flow-variant-config-diff"]').text()
    expect(diff).toContain('代码规则：rule_a / rule_b')
  })

  it('同一组流程重复打开命中缓存，不再逐流程读步骤；换一组或流程更新时间变化后重新读', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 1, list: [flow('1')] } as never)
    const readSteps = vi.spyOn(flowCenterApi, 'steps').mockImplementation(async () => steps('s', ['90']))
    const first = mountDrawer('t1')
    await flushPromises()
    expect(readSteps).toHaveBeenCalledTimes(1)
    expect(first.find('[data-testid="flow-variant-cache-hit"]').exists()).toBe(false)
    first.unmount()

    const second = mountDrawer('t1')
    await flushPromises()
    expect(readSteps).toHaveBeenCalledTimes(1) // 命中缓存，没再读
    expect(second.find('[data-testid="flow-variant-cache-hit"]').exists()).toBe(true)
    second.unmount()

    // 流程更新时间变了 → 流程指纹变 → 缓存 key 变 → 重新读
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 1, list: [{ ...flow('1'), updatedAt: '2026-11-06T10:00:00Z' }] } as never)
    mountDrawer('t1')
    await flushPromises()
    expect(readSteps).toHaveBeenCalledTimes(2)
  })

  it('读取失败的流程标「待核对」，且不把残缺结果写进缓存', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [flow('1'), flow('2', '坏流程')] } as never)
    const readSteps = vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (id) => {
      if (id === '2') throw new Error('500')
      return steps('s', ['90'])
    })
    const wrapper = mountDrawer('t1')
    await flushPromises()

    const pending = wrapper.get('[data-testid="flow-variant-pending-review"]')
    expect(pending.text()).toContain('1 个流程的步骤读取失败，未参与分析：坏流程')
    expect(pending.text()).toContain('待核对')
    wrapper.unmount()

    // 失败的那次没有写缓存：再打开会重新读
    readSteps.mockClear()
    mountDrawer('t1')
    await flushPromises()
    expect(readSteps).toHaveBeenCalled()
  })

  it('推荐归类的确认文案说明只按结构比较、配置组差异未合并', async () => {
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 1, list: [flow('1')] } as never)
    vi.spyOn(flowCenterApi, 'detail').mockImplementation(async (id) => ({
      ...flow(id),
      definition: { structureOnly: true, main: ['start', 'n1', 'end'], branches: [], configs: { n1: { configType: '90' } } },
    }) as never)
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async () => steps('s', ['90']))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mountDrawer('unassigned')
    await flushPromises()

    await wrapper.get('[data-testid="flow-variant-assign"]').trigger('click')
    await flushPromises()
    const message = String(confirm.mock.calls[0]![0])
    expect(message).toContain('推荐只按节点结构比较，配置组差异未合并')
  })
})
