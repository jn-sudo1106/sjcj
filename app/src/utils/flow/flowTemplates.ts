import type {
  FlowRecord,
  FlowDefinition,
  FlowNodeBinding,
  Source,
} from '@/api'
import {
  LIB_GROUPS,
  NODE_CONFIGS,
  PRESET_INTENTS,
  TEMPLATE_TO_NODE,
  cloneConfig,
  makeBlankFlow,
  type FlowDef,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeTemplateConfig(config: NodeConfig): NodeConfig {
  const next = clone(config)
  if (next.collectCfg) {
    Reflect.deleteProperty(next.collectCfg, 'password')
    next.collectCfg.loginConfigs?.forEach((item) => Reflect.deleteProperty(item, 'loginPwd'))
  }
  return next
}

const SOURCE_OVERRIDE_COLLECT_KEYS = [
  'url', 'outputTable', 'inputTable', 'entryCondition', 'inputParams', 'urlParamRefs', 'urlParamValues',
  'useProxy', 'resume', 'needLogin', 'loginUrl', 'account', 'credentialRef', 'loginConfigs', 'defaultLoginConfigId',
  'scheduleType', 'scheduleTime', 'weekdays', 'cron',
] as const

function orderedNodeIds(def: FlowDef): string[] {
  const ids: string[] = []
  const add = (id: string) => {
    if (id !== 'start' && id !== 'end' && def.configs[id] && !ids.includes(id)) ids.push(id)
  }
  def.main.forEach(add)
  def.branches.forEach((branch) => add(branch.id))
  def.branchGroups?.forEach((group) => {
    add(group.ownerId)
    group.branches.forEach((branch) => branch.chain.forEach(add))
  })
  Object.keys(def.configs).forEach(add)
  return ids
}

/** 把任意流程规范化为模板可长期引用的稳定 node-1/node-2… ID。模板保存完整节点默认配置。 */
export function templateDefinitionFromFlow(def: FlowDef): FlowDefinition {
  const ids = orderedNodeIds(def)
  const idMap = new Map(ids.map((id, index) => [id, `node-${index + 1}`]))
  const mapId = (id: string) => idMap.get(id) ?? id
  const configs: Record<string, NodeConfig> = {}
  ids.forEach((id) => { configs[mapId(id)] = sanitizeTemplateConfig(def.configs[id]) })

  return {
    main: def.main.map(mapId),
    branches: def.branches.map((branch) => ({
      ...clone(branch),
      id: mapId(branch.id),
      rowAnchor: mapId(branch.rowAnchor),
      edgeFrom: mapId(branch.edgeFrom),
      edgeTo: mapId(branch.edgeTo),
    })),
    configs,
    branchGroups: (def.branchGroups ?? []).map((group) => ({
      ...clone(group),
      ownerId: mapId(group.ownerId),
      branches: group.branches.map((branch) => ({ ...clone(branch), chain: branch.chain.map(mapId) })),
    })),
  }
}

/** 保存模板时做深拷贝，保留 URL、表、参数等可作为源起点的默认配置。 */
export function sanitizeTemplateDefinition(definition: FlowDefinition): FlowDefinition {
  return {
    main: [...definition.main],
    branches: clone(definition.branches),
    configs: Object.fromEntries(Object.entries(definition.configs).map(([id, config]) => [id, sanitizeTemplateConfig(config)])),
    branchGroups: clone(definition.branchGroups ?? []),
  }
}

export function makeBlankTemplateDefinition(): FlowDefinition {
  return templateDefinitionFromFlow(makeBlankFlow())
}

/** 既有预置意图作为不可变的初始种子；实际画布入口改由模板 API 消费。 */
export function makePresetFlowTemplates(): FlowRecord[] {
  return PRESET_INTENTS.map((preset, index) => ({
    id: `preset-${preset.key}`,
    name: preset.label,
    version: 1,
    definition: templateDefinitionFromFlow(preset.build()),
    updatedAt: `2026-07-15 09:${String(index).padStart(2, '0')}`,
  }))
}

export function extractTemplateNodeBindings(configs: Record<string, NodeConfig>): Record<string, FlowNodeBinding> {
  const bindings: Record<string, FlowNodeBinding> = {}
  Object.entries(configs).forEach(([id, config]) => {
    const binding: FlowNodeBinding = {}
    if (config.collectCfg) {
      const collect: NonNullable<FlowNodeBinding['collect']> = {}
      SOURCE_OVERRIDE_COLLECT_KEYS.forEach((key) => {
        const value = config.collectCfg?.[key]
        if (value !== undefined) {
          const copied = clone(value)
          if (key === 'loginConfigs' && Array.isArray(copied)) {
            copied.forEach((item) => {
              if (item && typeof item === 'object') Reflect.deleteProperty(item, 'loginPwd')
            })
          }
          (collect as Record<string, unknown>)[key] = copied
        }
      })
      binding.collect = collect
    }
    if (config.outputTable !== undefined) binding.outputTable = config.outputTable
    if (config.inputTable !== undefined) binding.inputTable = config.inputTable
    if (config.entryCondition !== undefined) binding.entryCondition = clone(config.entryCondition)
    if (config.taskCfg) binding.task = clone(config.taskCfg)
    if (config.outputAdvanced) binding.outputAdvanced = clone(config.outputAdvanced)
    if (Object.keys(binding).length) bindings[id] = binding
  })
  return bindings
}

/** 同一模板升级仅按稳定 nodeId 保留绑定；切换到其他模板则由调用方传空绑定。 */
export function compatibleTemplateBindings(
  bindings: Record<string, FlowNodeBinding>,
  definition: FlowDefinition,
): Record<string, FlowNodeBinding> {
  return Object.fromEntries(
    Object.entries(bindings)
      .filter(([nodeId]) => Boolean(definition.configs[nodeId]))
      .map(([nodeId, binding]) => [nodeId, clone(binding)]),
  )
}

/** 用模板定义 + 源绑定合成实际可编辑、可运行的 FlowDef。 */
export function composeTemplateFlow(
  template: FlowRecord,
  source: Source,
  nodeBindings: Record<string, FlowNodeBinding>,
): FlowDef {
  const definition = sanitizeTemplateDefinition(template.definition)
  const configs = clone(definition.configs)
  Object.entries(configs).forEach(([nodeId, config]) => {
    const binding = nodeBindings[nodeId]
    if (!binding) return
    if (config.collectCfg && binding.collect) Object.assign(config.collectCfg, clone(binding.collect))
    if (binding.outputTable !== undefined) config.outputTable = binding.outputTable
    if (binding.inputTable !== undefined) config.inputTable = binding.inputTable
    if (binding.entryCondition !== undefined) config.entryCondition = clone(binding.entryCondition)
    if (binding.task) config.taskCfg = clone(binding.task)
    if (binding.outputAdvanced) config.outputAdvanced = clone(binding.outputAdvanced)
  })
  const boundSource: Source = {
    ...clone(source),
    templateId: template.id,
    templateVersion: template.version,
    nodeBindings: clone(nodeBindings),
  }
  return {
    id: source.sourceId,
    name: source.name || template.name,
    version: template.version == null ? `flow-${template.id}` : `template-v${template.version}`,
    main: definition.main,
    branches: definition.branches,
    configs,
    updatedAt: template.updatedAt,
    source: boundSource,
    branchGroups: definition.branchGroups,
  }
}

export function appendTemplateNode(definition: FlowDefinition, template: string): string {
  const seedKey = TEMPLATE_TO_NODE[template]
  const seed = seedKey ? NODE_CONFIGS[seedKey] : undefined
  if (!seed) return ''
  const next = Math.max(0, ...Object.keys(definition.configs).map((id) => Number(/^node-(\d+)$/.exec(id)?.[1]) || 0)) + 1
  const id = `node-${next}`
  definition.configs[id] = cloneConfig(seed)
  const endIndex = definition.main.indexOf('end')
  definition.main.splice(endIndex < 0 ? definition.main.length : endIndex, 0, id)
  return id
}

export function moveTemplateNode(definition: FlowDefinition, nodeId: string, direction: 'up' | 'down'): void {
  const index = definition.main.indexOf(nodeId)
  const target = index + (direction === 'up' ? -1 : 1)
  if (index < 1 || target < 1 || target >= definition.main.length - 1) return
  ;[definition.main[index], definition.main[target]] = [definition.main[target], definition.main[index]]
}

export function removeTemplateNode(definition: FlowDefinition, nodeId: string): void {
  delete definition.configs[nodeId]
  definition.main = definition.main.filter((id) => id !== nodeId)
  definition.branches = definition.branches.filter((branch) => branch.id !== nodeId)
  definition.branchGroups = (definition.branchGroups ?? [])
    .filter((group) => group.ownerId !== nodeId)
    .map((group) => ({ ...group, branches: group.branches.map((branch) => ({ ...branch, chain: branch.chain.filter((id) => id !== nodeId) })) }))
}

export const templateNodeOptions = LIB_GROUPS.flatMap((group) => group.items)

/** 从节点类型构造独立骨架，业务配置与运行身份不进入结构模板。 */
export function structureNode(config: NodeConfig): NodeConfig {
  const next: NodeConfig = {
    title: config.title, sub: config.sub, template: config.template, kind: config.kind,
    configType: config.configType, status: '待配置', planned: config.planned,
    collect: config.collect, base: [], fields: [], inmap: [], params: [], output: [],
  }
  if (config.collectCfg) {
    const c = config.collectCfg
    next.collectCfg = {
      snatchType: c.snatchType, collectorKind: c.collectorKind, webKind: c.webKind,
      isDetail: c.isDetail, url: '', inputTable: '', outputTable: '', inputParams: [],
    }
  }
  return next
}

export function makeStructureTemplate(keys: string[]): FlowDefinition {
  const definition = makeBlankTemplateDefinition()
  definition.structureOnly = true
  keys.forEach((key) => {
    const seed = NODE_CONFIGS[key]
    if (!seed) throw new Error(`未知节点类型：${key}`)
    const id = `node-${Object.keys(definition.configs).length + 1}`
    definition.configs[id] = structureNode(seed)
    definition.configs[id]!.title = ({ 'web-list': '采集', 'web-detail': '详情采集', 'file-download': '文件下载', rule: '规则处理', translate: '翻译', ocr: 'OCR识别', 'article-summary': '生成摘要', 'article-tag': '打标签' } as Record<string, string>)[key] || seed.title
    if (key === 'web-list' && keys.includes('web-detail')) definition.configs[id]!.title = '列表采集'
    definition.configs[id]!.configType = ({ 'web-list': '90', 'web-detail': '90', 'file-download': '95', rule: '600', translate: '800', ocr: '150', 'article-summary': '720', 'article-tag': '730' } as Record<string, string>)[key]
    definition.main.splice(definition.main.length - 1, 0, id)
  })
  return definition
}

export function instantiateStructureTemplate(definition: FlowDefinition): FlowDefinition {
  const copy = sanitizeTemplateDefinition(definition)
  copy.configs = Object.fromEntries(Object.entries(copy.configs).map(([id, config]) => [id, structureNode(config)]))
  return copy
}
