import { describe, expect, it } from 'vitest'
import type { FlowRecord, Source } from '@/api'
import {
  compatibleTemplateBindings,
  composeTemplateFlow,
  extractTemplateNodeBindings,
  makePresetFlowTemplates,
  makeStructureTemplate,
  makeStructureNode,
  structureDefinition,
  structureNodeGroups,
  restoreTemplateDefaults,
  instantiateStructureTemplate,
  sanitizeTemplateDefinition,
} from './flowTemplates'
import { NODE_CONFIGS, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

const source: Source = {
  sourceId: 'source-template-test', name: '测试源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
}

describe('流程模板与源绑定组合', () => {
  it('模板保留完整默认配置，源绑定可以覆盖 URL、表和参数', () => {
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

  it('模板绑定保留登录节点配置和默认配置，但不保存登录密码', () => {
    const configs = {
      login: {
        ...NODE_CONFIGS['login-collect'],
        collectCfg: {
          ...NODE_CONFIGS['login-collect'].collectCfg!,
          loginConfigs: [{ id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', loginPwd: 'pwd-1', newLoginConfig: '1' as const, authConfig: '', enabled: true }],
          defaultLoginConfigId: 'login-1',
        },
      },
    }
    const bindings = extractTemplateNodeBindings(configs)
    expect(bindings.login.collect?.loginConfigs).toEqual([{ id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', newLoginConfig: '1', authConfig: '', enabled: true }])
    expect(bindings.login.collect?.defaultLoginConfigId).toBe('login-1')
  })

  it('升级只按稳定 nodeId 保留绑定，不按节点名称静默复用', () => {
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-file-parse')!
    const [fileId, processId] = template.definition.main.filter((id) => id !== 'start' && id !== 'end')
    const bindings = {
      [fileId]: { collect: { url: 'https://source.example.com' } },
      [processId]: { task: { queue: 'source_queue', urlRule: '' } },
    }
    const upgraded: FlowRecord = {
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

describe('流程结构模板', () => {
  it('将网址、表、参数和规则复制到未配置步骤，已绑定配置的节点保留自身设置', () => {
    const initial = makeStructureTemplate(['web-list', 'rule'])
    const web = initial.configs['node-1']!
    web.configId = '123'
    web.configUrl = 'https://example.com/list'
    Object.assign(web.collectCfg!, { outputTable: '900', urlParamRefs: ['45'], urlParamValues: { '45': '1' } })
    const rule = initial.configs['node-2']!
    rule.ruleCfg = { mode: 'new', describe: '', inputTableId: '900', inputFields: [], outputFields: [], script: 'return row', scriptPath: 'shared.py' }
    const stored = structureDefinition(initial)
    const copied = instantiateStructureTemplate(stored)
    const remapped = { ...copied, configs: { '101': copied.configs['node-1']!, '102': copied.configs['node-2']! } }
    const live: Record<'101' | '102', NodeConfig> = {
      '101': { ...web, configId: undefined, configUrl: '' },
      '102': { ...rule, configId: undefined, ruleCfg: undefined },
    }
    restoreTemplateDefaults(live, remapped)
    expect(live['101']).toMatchObject({ configUrl: 'https://example.com/list', collectCfg: { outputTable: '900', urlParamValues: { '45': '1' } } })
    expect(live['101'].configId).toBeUndefined()
    expect(live['102']).toMatchObject({ ruleCfg: { script: 'return row' } })
    expect(live['102'].ruleCfg?.scriptPath).toBeUndefined()
    live['101'].configId = '456'
    live['101'].configUrl = 'https://example.com/independent'
    restoreTemplateDefaults(live, remapped)
    expect(live['101'].configUrl).toBe('https://example.com/independent')
    expect(stored.configs['node-1']?.configUrl).toBe('https://example.com/list')
  })

  it('模板节点库的每个条目都能生成对应类型的节点', () => {
    for (const { template, code } of structureNodeGroups.flatMap(group => group.items)) {
      expect(makeStructureNode(template), template).toMatchObject({ configType: code })
    }
  })

  it('节点缺名称或类型非法时，提示出错节点的位置', () => {
    const definition = makeStructureTemplate(['web-list', 'file-download'])
    const node = definition.configs['node-2']!
    Reflect.deleteProperty(node, 'title')
    expect(() => structureDefinition(definition)).toThrow('请填写第 2 个节点的名称')
    node.title = '下载'
    node.configType = '999'
    expect(() => structureDefinition(definition)).toThrow('第 2 个节点「下载」的类型不受支持')
  })

  it('拒绝空画布、缺失端点和分支，避免保存时丢弃结构', () => {
    const definition = makeStructureTemplate(['web-list'])
    expect(() => structureDefinition({ ...definition, main: ['start', 'end'], configs: {} })).toThrow('模板需包含 1 至 100 个节点')
    expect(() => structureDefinition({ ...definition, main: ['node-1', 'end'] })).toThrow('模板画布缺少完整的开始或结束节点')
    expect(() => structureDefinition({
      ...definition,
      branchGroups: [{ ownerId: 'node-1', branches: [{ id: 'branch-1', label: '分支', chain: ['node-2'] }] }],
    })).toThrow('模板只支持顺序编排')
  })

  it('模板只带节点类型和顺序，实例之间不共享业务配置或身份', () => {
    const template=makeStructureTemplate(['web-list','file-download'])
    expect(template.structureOnly).toBe(true)
    expect(template.configs['node-1']?.configType).toBe('90')
    expect(template.configs['node-2']?.configType).toBe('95')
    expect(template.configs['node-2']?.collectCfg?.collectorKind).toBe('file_download')
    const first=instantiateStructureTemplate(template)
    const second=instantiateStructureTemplate(template)
    first.configs['node-1']!.collectCfg!.url='https://one.example'
    expect(second.configs['node-1']!.collectCfg!.url).toBe('')
    expect(template.configs['node-1']!.collectCfg!.url).toBe('')
    expect(first.structureOnly).toBeUndefined()
    expect(first.configs['node-1']!.configId).toBeUndefined()
    expect(first.configs['node-1']!.collectCfg!.outputTable).toBe('')
  })
})
