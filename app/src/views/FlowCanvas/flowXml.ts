import type { ConditionGroup, FlowDef, NodeConfig } from './flowModel'

export function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function attrs(values: object): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${xmlEscape(String(value))}"`)
    .join('')
}

function line(depth: number, text: string): string {
  return `${'  '.repeat(depth)}${text}`
}

function conditionXml(condition: ConditionGroup | undefined, depth: number, tag = 'condition'): string[] {
  if (!condition) return []
  const lines = [line(depth, `<${tag}${attrs({ logic: condition.logic, mode: condition.mode, expr: condition.expr })}>`)]
  lines.push(...condition.items.map((item) => line(depth + 1, `<rule${attrs(item)} />`)))
  lines.push(line(depth, `</${tag}>`))
  return lines
}

function nodeXml(id: string, cfg: NodeConfig): string[] {
  const lines = [line(2, `<node${attrs({ id, title: cfg.title, kind: cfg.kind || 'node', enabled: !cfg.disabled })}>`)]

  if (cfg.collectCfg) {
    const collect = cfg.collectCfg
    lines.push(line(3, `<collect${attrs({
      snatchType: collect.snatchType,
      webKind: collect.webKind,
      url: collect.url,
      outputTable: collect.outputTable,
      inputTable: collect.inputTable,
      isDetail: collect.isDetail,
      collectorKind: collect.collectorKind,
    })}>`))
    lines.push(...collect.inputParams.map((paramId) => line(4, `<inputParam${attrs({ id: paramId })} />`)))
    lines.push(...(collect.urlParamRefs || []).map((paramId) => line(4, `<urlParam${attrs({ id: paramId, value: collect.urlParamValues?.[paramId] })} />`)))
    lines.push(line(3, '</collect>'))
  }

  const table = { outputTable: cfg.outputTable, inputTable: cfg.inputTable, ...cfg.outputAdvanced }
  if (Object.values(table).some((value) => value !== undefined) || cfg.inmap.length || cfg.output.length) {
    lines.push(line(3, `<table${attrs(table)}>`))
    lines.push(...cfg.inmap.map((mapping) => line(4, `<input${attrs(mapping)} />`)))
    lines.push(...cfg.output.map((field) => line(4, `<output${attrs(field)} />`)))
    lines.push(line(3, '</table>'))
  }

  if (cfg.params.length) {
    lines.push(line(3, '<parameters>'))
    lines.push(...cfg.params.map((param) => line(4, `<param${attrs(param)} />`)))
    lines.push(line(3, '</parameters>'))
  }

  if (cfg.taskCfg) {
    const { paramValues, contextMap, outColumns, paramRefs, ...task } = cfg.taskCfg
    if (!paramValues?.length && !contextMap?.length && !outColumns?.length) {
      lines.push(line(3, `<task${attrs(task)} />`))
    } else {
      lines.push(line(3, `<task${attrs(task)}>`))
      lines.push(...(paramValues ?? []).map((item) => line(4, `<paramValue${attrs(item)} />`)))
      lines.push(...(contextMap ?? []).map((fieldId) => line(4, `<context${attrs({ fieldId })} />`)))
      lines.push(...(outColumns ?? []).map((fieldId) => line(4, `<outColumn${attrs({ fieldId })} />`)))
      lines.push(line(3, '</task>'))
    }
  }
  lines.push(...conditionXml(cfg.entryCondition || cfg.collectCfg?.entryCondition, 3))
  lines.push(line(2, '</node>'))
  return lines
}

export function flowToXml(def: FlowDef): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>']
  lines.push(line(0, `<flow${attrs({ id: def.id, name: def.name, version: def.version, updatedAt: def.updatedAt })}>`))

  lines.push(line(1, '<main>'))
  lines.push(...def.main.map((id) => line(2, `<nodeRef${attrs({ id })} />`)))
  lines.push(line(1, '</main>'))

  lines.push(line(1, '<nodes>'))
  const mainIds = new Set(def.main)
  const ids = [...def.main.filter((id) => !!def.configs[id]), ...Object.keys(def.configs).filter((id) => !mainIds.has(id))]
  for (const id of ids) lines.push(...nodeXml(id, def.configs[id]))
  lines.push(line(1, '</nodes>'))

  if (def.branchGroups?.length) {
    lines.push(line(1, '<branchGroups>'))
    for (const group of def.branchGroups) {
      lines.push(line(2, `<branchGroup${attrs({ ownerId: group.ownerId })}>`))
      for (const branch of group.branches) {
        lines.push(line(3, `<branch${attrs({ id: branch.id, label: branch.label })}>`))
        lines.push(...conditionXml(branch.condition, 4))
        lines.push(...branch.chain.map((nodeId) => line(4, `<nodeRef${attrs({ id: nodeId })} />`)))
        lines.push(line(3, '</branch>'))
      }
      lines.push(line(2, '</branchGroup>'))
    }
    lines.push(line(1, '</branchGroups>'))
  }

  lines.push('</flow>')
  return lines.join('\n')
}
