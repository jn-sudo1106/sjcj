// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElMessageBox } from 'element-plus'
import { flowCenterApi, type FlowRecord } from '@/api'
import { makeStructureTemplate } from './flowTemplates'
import { createFlowFromTemplate, NO_FLOW_TEMPLATE, pickFlowTemplate } from './createFromTemplate'
import { mount } from '@vue/test-utils'
import type { VNode } from 'vue'

afterEach(() => vi.restoreAllMocks())
const template: FlowRecord = { id: '1', name: '采集下载', definition: makeStructureTemplate(['web-list', 'file-download']), isTemplate: true, updatedAt: '' }

describe('按模板新建流程', () => {
  it('结构模板使用独立的待配置定义并记录所属模板', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(template)
    const save=vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...template, id: '2', isTemplate: false, fromTemplateId: '1' })
    const copy=vi.spyOn(flowCenterApi, 'copy')
    const created=await createFlowFromTemplate('1', 'new')
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'new', fromTemplateId: '1', definition: expect.objectContaining({ main: ['start','node-1','node-2','end'] }) }))
    expect(save.mock.calls[0]![0].definition.structureOnly).toBeUndefined()
    expect(copy).not.toHaveBeenCalled()
    expect(created.fromTemplateId).toBe('1')
  })
  it('复制完整旧模板时保留用户选择的复用配置选项', async () => {
    const original={...template,definition:{...template.definition,structureOnly:false}}
    vi.spyOn(flowCenterApi,'detail').mockImplementation(async id=>id==='1'?original:{...template,id:'2',isTemplate:false})
    const copy=vi.spyOn(await import('./copiedConfigs'),'copyWholeFlow').mockResolvedValue({flowId:'2'})
    await createFlowFromTemplate('1','new',{reuseConfigs:true})
    expect(copy).toHaveBeenCalledWith('1','new',expect.objectContaining({reuseConfigs:true}))
  })
  it('失效模板在创建之前报错', async () => {
    vi.spyOn(flowCenterApi,'detail').mockResolvedValue({ ...template, disabled: true })
    const save=vi.spyOn(flowCenterApi,'save')
    await expect(createFlowFromTemplate('1','new')).rejects.toThrow('有效且启用')
    expect(save).not.toHaveBeenCalled()
  })
  it('选择模板时取消不会创建任何流程，无候选时明确报错', async () => {
    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([template])
    vi.spyOn(ElMessageBox,'confirm').mockRejectedValue('cancel')
    const save=vi.spyOn(flowCenterApi,'save')
    await expect(pickFlowTemplate()).rejects.toBe('cancel')
    expect(save).not.toHaveBeenCalled()
    await expect(pickFlowTemplate({ excludeId: '1' })).rejects.toThrow('暂无流程模板')
  })
  it('allowNone 时列表最前是「暂不建流程」，选它返回空串；没有模板也能弹出', async () => {
    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([template])
    let content: VNode | undefined
    vi.spyOn(ElMessageBox,'confirm').mockImplementation(async (message) => {
      content = message as VNode
      const view = mount({ render: () => content })
      const items = view.findAll('label.rc-tpl-item')
      expect(items.map(i => i.text())).toEqual([expect.stringContaining('暂不建流程'), '采集下载'])
      // 默认仍选第一个模板
      expect(items[1]!.classes()).toContain('is-active')
      await view.get('[data-testid="flow-template-none"] input').trigger('change')
      return 'confirm' as never
    })
    await expect(pickFlowTemplate({ allowNone: true })).resolves.toBe(NO_FLOW_TEMPLATE)

    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([])
    vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never)
    await expect(pickFlowTemplate({ allowNone: true })).resolves.toBe(NO_FLOW_TEMPLATE)
  })
  it('不传 allowNone 时没有「暂不建流程」，确认返回所选模板', async () => {
    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([template, { ...template, id: '3', name: '列表 → 详情' }])
    vi.spyOn(ElMessageBox,'confirm').mockImplementation(async (message) => {
      const view = mount({ render: () => message as VNode })
      expect(view.find('[data-testid="flow-template-none"]').exists()).toBe(false)
      await view.get('[data-testid="flow-template-3"] input').trigger('change')
      return 'confirm' as never
    })
    await expect(pickFlowTemplate()).resolves.toBe('3')
  })
})
