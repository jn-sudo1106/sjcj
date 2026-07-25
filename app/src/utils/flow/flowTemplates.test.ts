import { describe, expect, it } from 'vitest'
import type { FlowTemplate, Source } from '@/api'
import {
  compatibleTemplateBindings,
  composeTemplateFlow,
  extractTemplateNodeBindings,
  makePresetFlowTemplates,
  sanitizeTemplateDefinition,
} from './flowTemplates'

const source: Source = {
  sourceId: 'source-template-test', name: '测试子源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
}

describe('流程模板与子源绑定组合', () => {
  it('模板保留完整默认配置，子源绑定可以覆盖 URL、表和参数', () => {
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-file-parse')!
    const fileId = template.definition.main.find((id) => id !== 'start' && id !== 'end')!
    const definition = sanitizeTemplateDefinition(template.definition)
    definition.configs[fileId].collectCfg = {
      ...definition.configs[fileId].collectCfg!,
      url: 'https://template.example.com/report.pdf',
      outputTable: 'table-template',
      inputTable: 'table-template-input',
      inputParams: ['param-template-input'],
      urlParamRefs: ['param-template-url'],
      urlParamValues: { 'param-template-url': 'default' },
    }
    const configuredTemplate = { ...template, definition }
    const bindings = {
      [fileId]: {
        collect: {
          url: 'https://source.example.com/report.pdf', outputTable: 'table-source', inputTable: 'table-input',
          inputParams: ['param-input'], urlParamRefs: ['param-url'], urlParamValues: { 'param-url': '2026-07-15' },
        },
      },
    }

    expect(sanitizeTemplateDefinition(definition).configs[fileId].collectCfg?.url).toBe('https://template.example.com/report.pdf')
    expect(composeTemplateFlow(configuredTemplate, source, {}).configs[fileId].collectCfg?.outputTable).toBe('table-template')
    const composed = composeTemplateFlow(configuredTemplate, source, bindings)
    expect(composed.configs[fileId].collectCfg?.url).toBe('https://source.example.com/report.pdf')
    expect(composed.configs[fileId].collectCfg?.outputTable).toBe('table-source')
    expect(composed.source?.nodeBindings).toEqual(bindings)
    expect(extractTemplateNodeBindings(composed.configs)[fileId].collect?.urlParamRefs).toEqual(['param-url'])
  })

  it('升级只按稳定 nodeId 保留绑定，不按节点名称静默复用', () => {
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-file-parse')!
    const [fileId, processId] = template.definition.main.filter((id) => id !== 'start' && id !== 'end')
    const bindings = {
      [fileId]: { collect: { url: 'https://source.example.com' } },
      [processId]: { task: { queue: 'source_queue', urlRule: '' } },
    }
    const upgraded: FlowTemplate = {
      ...template,
      version: 2,
      definition: {
        ...template.definition,
        main: template.definition.main.filter((id) => id !== processId),
        configs: Object.fromEntries(Object.entries(template.definition.configs).filter(([id]) => id !== processId)),
      },
    }

    expect(compatibleTemplateBindings(bindings, upgraded.definition)).toEqual({ [fileId]: bindings[fileId] })
  })
})
