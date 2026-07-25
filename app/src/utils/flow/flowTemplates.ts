import type {
  FlowTemplate,
  FlowTemplateDefinition,
  FlowTemplateNodeBinding,
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

const SOURCE_OVERRIDE_COLLECT_KEYS = [
  'url', 'outputTable', 'inputTable', 'entryCondition', 'inputParams', 'urlParamRefs', 'urlParamValues',
  'useProxy', 'resume', 'needLogin', 'loginUrl', 'account', 'credentialRef',
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
export function templateDefinitionFromFlow(def: FlowDef): FlowTemplateDefinition {
  const ids = orderedNodeIds(def)
  const idMap = new Map(ids.map((id, index) => [id, `node-${index + 1}`]))
  const mapId = (id: string) => idMap.get(id) ?? id
  const configs: Record<string, NodeConfig> = {}
  ids.forEach((id) => { configs[mapId(id)] = clone(def.configs[id]) })

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

/** 保存模板时做深拷贝，保留 URL、表、参数等可作为子源起点的默认配置。 */
export function sanitizeTemplateDefinition(definition: FlowTemplateDefinition): FlowTemplateDefinition {
  return {
    main: [...definition.main],
    branches: clone(definition.branches),
    configs: clone(definition.configs),
    branchGroups: clone(definition.branchGroups ?? []),
  }
}

export function makeBlankTemplateDefinition(): FlowTemplateDefinition {
  return templateDefinitionFromFlow(makeBlankFlow())
}

/** 既有预置意图作为不可变的初始种子；实际画布入口改由模板 API 消费。 */
export function makePresetFlowTemplates(): FlowTemplate[] {
  return PRESET_INTENTS.map((preset, index) => ({
    id: `preset-${preset.key}`,
    name: preset.label,
    version: 1,
    definition: templateDefinitionFromFlow(preset.build()),
    updatedAt: `2026-07-15 09:${String(index).padStart(2, '0')}`,
  }))
}

export function extractTemplateNodeBindings(configs: Record<string, NodeConfig>): Record<string, FlowTemplateNodeBinding> {
  const bindings: Record<string, FlowTemplateNodeBinding> = {}
  Object.entries(configs).forEach(([id, config]) => {
    const binding: FlowTemplateNodeBinding = {}
    if (config.collectCfg) {
      const collect: NonNullable<FlowTemplateNodeBinding['collect']> = {}
      SOURCE_OVERRIDE_COLLECT_KEYS.forEach((key) => {
        const value = config.collectCfg?.[key]
        if (value !== undefined) (collect as Record<string, unknown>)[key] = clone(value)
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
  bindings: Record<string, FlowTemplateNodeBinding>,
  definition: FlowTemplateDefinition,
): Record<string, FlowTemplateNodeBinding> {
  return Object.fromEntries(
    Object.entries(bindings)
      .filter(([nodeId]) => Boolean(definition.configs[nodeId]))
      .map(([nodeId, binding]) => [nodeId, clone(binding)]),
  )
}

/** 用模板定义 + 子源绑定合成实际可编辑、可运行的 FlowDef。 */
export function composeTemplateFlow(
  template: FlowTemplate,
  source: Source,
  nodeBindings: Record<string, FlowTemplateNodeBinding>,
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
    version: `template-v${template.version}`,
    main: definition.main,
    branches: definition.branches,
    configs,
    updatedAt: template.updatedAt,
    source: boundSource,
    branchGroups: definition.branchGroups,
  }
}

export function appendTemplateNode(definition: FlowTemplateDefinition, template: string): string {
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

export function moveTemplateNode(definition: FlowTemplateDefinition, nodeId: string, direction: 'up' | 'down'): void {
  const index = definition.main.indexOf(nodeId)
  const target = index + (direction === 'up' ? -1 : 1)
  if (index < 1 || target < 1 || target >= definition.main.length - 1) return
  ;[definition.main[index], definition.main[target]] = [definition.main[target], definition.main[index]]
}

export function removeTemplateNode(definition: FlowTemplateDefinition, nodeId: string): void {
  delete definition.configs[nodeId]
  definition.main = definition.main.filter((id) => id !== nodeId)
  definition.branches = definition.branches.filter((branch) => branch.id !== nodeId)
  definition.branchGroups = (definition.branchGroups ?? [])
    .filter((group) => group.ownerId !== nodeId)
    .map((group) => ({ ...group, branches: group.branches.map((branch) => ({ ...branch, chain: branch.chain.filter((id) => id !== nodeId) })) }))
}

export const templateNodeOptions = LIB_GROUPS.flatMap((group) => group.items)
