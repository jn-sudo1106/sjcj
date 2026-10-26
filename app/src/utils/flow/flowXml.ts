import type { ConditionGroup, FlowDef, NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import type { RuleOrchestration } from '@/api/types/rule'

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

/** 文本子节点：脚本/正文规则这类不透明大段文本用它，不硬塞进属性里。空文本不输出。 */
function textEl(depth: number, tag: string, text: string | undefined): string[] {
  if (!text) return []
  return [line(depth, `<${tag}>${xmlEscape(text)}</${tag}>`)]
}

function conditionXml(condition: ConditionGroup | undefined, depth: number, tag = 'condition'): string[] {
  if (!condition) return []
  const lines = [line(depth, `<${tag}${attrs({ logic: condition.logic, mode: condition.mode, expr: condition.expr })}>`)]
  lines.push(...condition.items.map((item) => line(depth + 1, `<rule${attrs(item)} />`)))
  lines.push(line(depth, `</${tag}>`))
  return lines
}

/**
 * 规则/抓取编排配置（RuleOrchestration，规则节点走 cfg.ruleCfg，非规则节点走 cfg.execCfg 但同一
 * 形状）——这是决定节点到底怎么跑的核心内容（脚本正文/抓取配置 XML），比 collect/table/params
 * 这些结构性字段更重要，之前完全没导出，2026-09-02 按"有什么配置信息展示什么"补上。
 */
function ruleOrchestrationXml(tag: string, ro: RuleOrchestration, depth: number): string[] {
  const lines = [line(depth, `<${tag}${attrs({
    mode: ro.mode,
    name: ro.name,
    format: ro.format,
    enabled: ro.enabled,
    dataSource: ro.dataSource,
    inputTable: ro.inputTable,
    inputTableId: ro.inputTableId,
    outputTable: ro.outputTable,
    outputTableId: ro.outputTableId,
    modelProviderCode: ro.modelProviderCode,
    modelCode: ro.modelCode,
    promptCategory: ro.promptCategory,
    promptTemplateId: ro.promptTemplateId,
    userCode: ro.userCode,
    scriptPath: ro.scriptPath,
  })}>`)]
  lines.push(...(ro.inputFields ?? []).map((id) => line(depth + 1, `<inputField${attrs({ id })} />`)))
  lines.push(...(ro.outputFields ?? []).map((id) => line(depth + 1, `<outputField${attrs({ id })} />`)))
  lines.push(...textEl(depth + 1, 'describe', ro.describe))
  lines.push(...textEl(depth + 1, 'systemPrompt', ro.systemPrompt))
  lines.push(...textEl(depth + 1, 'structuredConfig', ro.structuredConfig))
  lines.push(...textEl(depth + 1, 'contentRules', ro.contentRules))
  // 脚本正文放最后：这是最长的一段，先看完结构化字段再看脚本，读起来顺一点
  lines.push(...textEl(depth + 1, 'script', ro.script))
  lines.push(line(depth, `</${tag}>`))
  return lines
}

function nodeXml(id: string, cfg: NodeConfig): string[] {
  const lines = [line(2, `<node${attrs({
    id,
    title: cfg.title,
    sub: cfg.sub,
    status: cfg.status,
    planned: cfg.planned || undefined,
    template: cfg.template,
    kind: cfg.kind || 'node',
    enabled: !cfg.disabled,
    configId: cfg.configId,
    configName: cfg.configName,
    configUrl: cfg.configUrl,
  })}>`)]

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
      dedupMode: collect.dedupMode,
      multiMode: collect.multiMode,
      bizType: collect.bizType,
      useProxy: collect.useProxy,
      resume: collect.resume,
      needLogin: collect.needLogin,
      loginUrl: collect.loginUrl,
      account: collect.account,
      credentialRef: collect.credentialRef,
      defaultLoginConfigId: collect.defaultLoginConfigId,
      scheduleType: collect.scheduleType,
      scheduleTime: collect.scheduleTime,
      cron: collect.cron,
      weekdays: collect.weekdays?.join(','),
    })}>`))
    lines.push(...collect.inputParams.map((paramId) => line(4, `<inputParam${attrs({ id: paramId })} />`)))
    lines.push(...(collect.urlParamRefs || []).map((paramId) => line(4, `<urlParam${attrs({ id: paramId, value: collect.urlParamValues?.[paramId] })} />`)))
    lines.push(...(collect.outFields ?? []).map((fieldId) => line(4, `<outField${attrs({ id: fieldId })} />`)))
    // 代理明细里的 password 是明文代理密码，不能进导出文件——只带 ip/port/account，跟登录密码
    // （loginConfigs[].loginPwd、cfg.collectCfg.password）在 flow.serialize() 里已经被摘掉是同一个道理，
    // 只是 proxyDetail 嵌得更深一层，那边的摘除逻辑没覆盖到，这里显式只挑安全的字段。
    if (collect.proxyDetail) {
      lines.push(line(4, `<proxy${attrs({ ip: collect.proxyDetail.ip, port: collect.proxyDetail.port, account: collect.proxyDetail.account })} />`))
    }
    lines.push(...(collect.loginConfigs ?? []).map((loginCfg) => line(4, `<loginConfig${attrs({
      id: loginCfg.id, loginUrl: loginCfg.loginUrl, loginName: loginCfg.loginName, newLoginConfig: loginCfg.newLoginConfig, authConfig: loginCfg.authConfig, enabled: loginCfg.enabled,
    })} />`)))
    lines.push(...textEl(4, 'structuredConfig', collect.structuredConfig))
    lines.push(...textEl(4, 'contentRules', collect.contentRules))
    lines.push(line(3, '</collect>'))
  }

  const table = { outputTable: cfg.outputTable, inputTable: cfg.inputTable, dedupMode: cfg.dedupMode, ...cfg.outputAdvanced }
  const hasFieldSelection = (cfg.outFields?.length ?? 0) > 0 || (cfg.inputFields?.length ?? 0) > 0
  if (Object.values(table).some((value) => value !== undefined) || cfg.inmap.length || cfg.output.length || hasFieldSelection) {
    lines.push(line(3, `<table${attrs(table)}>`))
    lines.push(...cfg.inmap.map((mapping) => line(4, `<input${attrs(mapping)} />`)))
    lines.push(...cfg.output.map((field) => line(4, `<output${attrs(field)} />`)))
    lines.push(...(cfg.inputFields ?? []).map((fieldId) => line(4, `<inField${attrs({ id: fieldId })} />`)))
    lines.push(...(cfg.outFields ?? []).map((fieldId) => line(4, `<outField${attrs({ id: fieldId })} />`)))
    lines.push(line(3, '</table>'))
  }
  // 非采集节点的入库配置/正文规则；采集类走上面 <collect> 里的同名字段，两边互斥不重复
  lines.push(...textEl(3, 'structuredConfig', cfg.structuredConfig))
  lines.push(...textEl(3, 'contentRules', cfg.contentRules))

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

  if (cfg.schedule) {
    const { scheduleType, scheduleTime, weekdays, cron } = cfg.schedule
    lines.push(line(3, `<schedule${attrs({ scheduleType, scheduleTime, cron, weekdays: weekdays?.join(',') })} />`))
  }

  if (cfg.monitorMethods?.length) {
    lines.push(...cfg.monitorMethods.map((id) => line(3, `<monitorMethod${attrs({ id })} />`)))
  }

  if (cfg.ruleCfg) lines.push(...ruleOrchestrationXml('rule', cfg.ruleCfg, 3))
  if (cfg.execCfg) lines.push(...ruleOrchestrationXml('exec', cfg.execCfg, 3))

  if (cfg.itemId !== undefined || cfg.stepSourceId !== undefined || cfg.runPolicy !== undefined) {
    lines.push(line(3, `<legacy${attrs({ itemId: cfg.itemId, stepSourceId: cfg.stepSourceId, runPolicy: cfg.runPolicy })} />`))
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
