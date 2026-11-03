// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElMessageBox } from 'element-plus'
import { flowCenterApi, type FlowRecord } from '@/api'
import { makeStructureTemplate } from './flowTemplates'
import { createFlowFromTemplate, pickFlowTemplate } from './createFromTemplate'

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
})
