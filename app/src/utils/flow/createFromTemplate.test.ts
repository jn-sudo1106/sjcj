// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flowCenterApi, type FlowRecord } from '@/api'
import { makeStructureTemplate } from './flowTemplates'
import { createFlowFromTemplate, flowTemplatePickRequest, lastFlowTemplateId, NO_FLOW_TEMPLATE, pickFlowTemplate } from './createFromTemplate'
import { flushPromises } from '@vue/test-utils'

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
    const save=vi.spyOn(flowCenterApi,'save')
    const pending = pickFlowTemplate()
    await flushPromises()
    expect(flowTemplatePickRequest.value?.templates.map(t => t.id)).toEqual(['1'])
    flowTemplatePickRequest.value!.reject('cancel')
    await expect(pending).rejects.toBe('cancel')
    expect(flowTemplatePickRequest.value).toBeNull()
    expect(save).not.toHaveBeenCalled()
    await expect(pickFlowTemplate({ excludeId: '1' })).rejects.toThrow('暂无流程模板')
  })
  it('停用 / 已删的模板不进候选；allowNone 时没有模板也能弹出，选「暂不配置流程」返回空串', async () => {
    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([template, { ...template, id: '4', disabled: true }, { ...template, id: '5', state: 'D' }])
    let pending = pickFlowTemplate({ allowNone: true })
    await flushPromises()
    expect(flowTemplatePickRequest.value).toMatchObject({ allowNone: true })
    expect(flowTemplatePickRequest.value!.templates.map(t => t.id)).toEqual(['1'])
    flowTemplatePickRequest.value!.resolve(NO_FLOW_TEMPLATE)
    await expect(pending).resolves.toBe(NO_FLOW_TEMPLATE)

    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([])
    pending = pickFlowTemplate({ allowNone: true })
    await flushPromises()
    flowTemplatePickRequest.value!.resolve(NO_FLOW_TEMPLATE)
    await expect(pending).resolves.toBe(NO_FLOW_TEMPLATE)
  })
  it('确认返回所选模板并记住；不给 initialId 时默认上次选过的模板', async () => {
    localStorage.removeItem('rc-last-flow-template')
    vi.spyOn(flowCenterApi,'templates').mockResolvedValue([template, { ...template, id: '3', name: '列表 → 详情' }])
    let pending = pickFlowTemplate()
    await flushPromises()
    expect(flowTemplatePickRequest.value?.initialId).toBe('')
    flowTemplatePickRequest.value!.resolve('3')
    await expect(pending).resolves.toBe('3')
    expect(lastFlowTemplateId()).toBe('3')
    pending = pickFlowTemplate()
    await flushPromises()
    expect(flowTemplatePickRequest.value?.initialId).toBe('3')
    flowTemplatePickRequest.value!.reject('cancel')
    await expect(pending).rejects.toBe('cancel')
  })
})
