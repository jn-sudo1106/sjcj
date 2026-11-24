// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import FlowTemplatePickerDialog from './FlowTemplatePickerDialog.vue'
import FlowChoiceSummary from './FlowChoiceSummary.vue'
import { entryApi, flowCenterApi, type FlowRecord } from '@/api'

const tpl = (id: string, name: string) => ({ id, name, isTemplate: true, updatedAt: '', definition: {} }) as unknown as FlowRecord
const stubs = { FlowReadonlyPreview: { props: ['flow'], template: '<div class="preview-stub" :data-flow="flow?.id" />' }, ResizableFlowSplit: { template: '<div><slot name="left" /><slot name="right" /></div>' } }

describe('FlowTemplatePickerDialog（1123 A1）', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('默认选 initialId 并预览它；改选后预览跟着换；确认抛出所选模板', async () => {
    const w = mount(FlowTemplatePickerDialog, {
      props: { modelValue: true, templates: [tpl('1', '列表'), tpl('2', '详情')], initialId: '2' },
      global: { plugins: [ElementPlus], stubs },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.querySelector('.preview-stub')?.getAttribute('data-flow')).toBe('2')
    ;(document.querySelector('[data-testid="flow-template-1"] input') as HTMLInputElement).click()
    await flushPromises()
    expect(document.querySelector('.preview-stub')?.getAttribute('data-flow')).toBe('1')
    ;(document.querySelector('[data-testid="flow-template-confirm"]') as HTMLButtonElement).click()
    expect(w.emitted('pick')).toEqual([['1']])
    expect(document.querySelector('[data-testid="flow-template-none"]')).toBeNull()
    w.unmount()
  })

  it('allowNone 时最后一项是「暂不配置流程」，选它不显示预览、确认返回空串', async () => {
    const w = mount(FlowTemplatePickerDialog, {
      props: { modelValue: true, templates: [tpl('1', '列表')], allowNone: true },
      global: { plugins: [ElementPlus], stubs },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.querySelector('[data-testid="flow-template-none"]')?.textContent).toContain('暂不配置流程')
    ;(document.querySelector('[data-testid="flow-template-none"] input') as HTMLInputElement).click()
    await flushPromises()
    expect(document.querySelector('.preview-stub')).toBeNull()
    expect(document.querySelector('[data-testid="flow-template-placeholder"]')?.textContent).toContain('暂不配置流程')
    ;(document.querySelector('[data-testid="flow-template-confirm"]') as HTMLButtonElement).click()
    expect(w.emitted('pick')).toEqual([['']])
    w.unmount()
  })
})

describe('FlowChoiceSummary（1123 A1）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('显示流程名、节点数和去重后的写入表（中文名 + 表名）', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(tpl('9', '境外浏览器下载源码'))
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([
      { stepId: 'a', outputTable: '6200043' }, { stepId: 'b', outputTable: '6200043' }, { stepId: 'c', outputTable: '0' }, { stepId: 'd', outputTable: '13' },
    ] as never)
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(async (id) => (id === '13' ? { name: '通用新闻表', tableName: 'TB_CNEWS' } : { name: 'sourcecode_file', tableName: 'sourcecode_file' }) as never)
    const w = mount(FlowChoiceSummary, { props: { flowId: '9', prefix: '复制' } })
    await flushPromises()
    expect(w.text()).toContain('境外浏览器下载源码')
    expect(w.text()).toContain('4 个节点')
    expect(w.findAll('.fcs-table').map(t => t.text())).toEqual(['sourcecode_file', '通用新闻表（TB_CNEWS）'])
  })

  it('previewable 时有「预览节点及表配置」，点开渲染只读预览', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(tpl('9', '崇明'))
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const w = mount(FlowChoiceSummary, {
      props: { flowId: '9', previewable: true },
      global: { plugins: [ElementPlus], stubs: { FlowReadonlyPreview: { props: ['flow'], template: '<div class="preview-stub" :data-flow="flow?.id" />' } } },
      attachTo: document.body,
    })
    await flushPromises()
    await w.get('[data-testid="flow-choice-preview"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('.preview-stub')?.getAttribute('data-flow')).toBe('9')
    w.unmount()
  })

  it('inline 模式默认折叠，点「展开」在摘要下方就地显示预览，再点收起', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(tpl('9', '崇明'))
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const w = mount(FlowChoiceSummary, {
      props: { flowId: '9', previewable: true, previewMode: 'inline' },
      global: { stubs: { FlowReadonlyPreview: { props: ['flow'], template: '<div class="preview-stub" :data-flow="flow?.id" />' } } },
    })
    await flushPromises()
    const btn = w.get('[data-testid="flow-choice-preview"]')
    expect(btn.text()).toContain('展开节点及表配置')
    expect(w.find('.preview-stub').exists()).toBe(false)
    await btn.trigger('click')
    expect(w.get('[data-testid="flow-choice-inline-preview"] .preview-stub').attributes('data-flow')).toBe('9')
    expect(btn.attributes('aria-expanded')).toBe('true')
    await btn.trigger('click')
    expect(w.find('.preview-stub').exists()).toBe(false)
  })

  it('flowId 为空显示「暂不配置流程」说明', () => {
    const w = mount(FlowChoiceSummary, { props: { flowId: '' } })
    expect(w.text()).toContain('暂不配置流程')
  })
})
