// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mockFlowTemplateDetail, mockFlowTemplateList, mockFlowTemplateSave } from './flowTemplates'
import { mockFlowLoad, mockFlowRecommend, mockFlowSave } from './flows'
import type { Source } from '../types'
import { composeTemplateFlow } from '@/utils/flow/flowTemplates'

afterEach(() => localStorage.clear())

describe('流程模板 mock 持久化', () => {
  it('智能推荐返回可直接应用的稳定模板 ID', () => {
    expect(mockFlowRecommend({ prompt: '下载 PDF 文件并解析' }).templateId).toBe('preset-file-parse')
  })

  it('将既有预置迁为种子模板，且文件下载解析种子不再引用旧节点类型', () => {
    const template = mockFlowTemplateList().find((item) => item.id === 'preset-file-parse')
    expect(template).toBeTruthy()
    const titles = Object.values(template!.definition.configs).map((config) => config.title)
    expect(titles).toEqual(['文件下载', '数据处理'])
    expect(titles).not.toEqual(expect.arrayContaining(['文件解析', '字段抽取']))
    expect(Object.values(template!.definition.configs).every((config) => !config.collectCfg?.url && !config.collectCfg?.outputTable)).toBe(true)
  })

  it('保存时保留模板填写的 URL、表和参数默认值', () => {
    const original = mockFlowTemplateList().find((item) => item.id === 'preset-file-parse')!
    const nodeId = original.definition.main.find((id) => id !== 'start' && id !== 'end')!
    const definition = JSON.parse(JSON.stringify(original.definition))
    definition.configs[nodeId].collectCfg.url = 'https://template.example.com/report.pdf'
    definition.configs[nodeId].collectCfg.outputTable = 'template_table'
    definition.configs[nodeId].collectCfg.urlParamRefs = ['date']
    definition.configs[nodeId].collectCfg.urlParamValues = { date: '2026-07-15' }

    const saved = mockFlowTemplateSave({ template: { id: original.id, name: original.name, definition } })
    expect(saved.definition.configs[nodeId].collectCfg).toMatchObject({
      url: 'https://template.example.com/report.pdf',
      outputTable: 'template_table',
      urlParamRefs: ['date'],
      urlParamValues: { date: '2026-07-15' },
    })
  })

  it('保存模板生成新版本，旧版本仍可按版本号读取', () => {
    const original = mockFlowTemplateList()[0]
    const saved = mockFlowTemplateSave({
      template: { id: original.id, name: '改名后的模板', definition: original.definition },
    })

    expect(saved.version).toBe(original.version + 1)
    expect(mockFlowTemplateDetail({ id: original.id, version: original.version })?.name).toBe(original.name)
    expect(mockFlowTemplateDetail({ id: original.id, version: saved.version })?.name).toBe('改名后的模板')
    expect(mockFlowTemplateList().find((item) => item.id === original.id)?.version).toBe(saved.version)
  })

  it('模板更新不会自动覆盖已经绑定旧版本的子源流程', () => {
    const template = mockFlowTemplateList().find((item) => item.id === 'preset-file-parse')!
    const fileId = template.definition.main.find((id) => id !== 'start' && id !== 'end')!
    const source: Source = {
      sourceId: 'source-template-versioned', name: '版本固定子源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
    }
    const def = composeTemplateFlow(template, source, {
      [fileId]: { collect: { url: 'https://source.example.com/old.pdf', outputTable: 'old_table', inputTable: '', inputParams: [] } },
    })
    mockFlowSave({ def })
    mockFlowTemplateSave({ template: { id: template.id, name: '已更新模板', definition: template.definition } })

    const loaded = mockFlowLoad({ id: source.sourceId })
    expect(loaded?.source).toMatchObject({ templateId: template.id, templateVersion: 1 })
    expect(loaded?.configs[fileId].collectCfg?.url).toBe('https://source.example.com/old.pdf')
  })
})
