// 节点 ↔ 配置（Config）的字段映射，两个方向都在这里，避免两处各写一半对不上。
//
// 归属规则（2026-08-28 用户拍板，与 0824-02 §2 的 P0 规则一致）：
//   流程字段（跟节点走、存在流程/旧平台步骤里）：节点名称、任务配置的进入条件；
//   源字段（存在源上）：源 URL —— 旧平台「信息源-详情」页的 URL 那一行，节点上的 collectCfg.url
//     只是 buildNodeForStep 从源复制来的显示副本；与 Config 自己的 configUrl 是两回事。
//   配置字段（存 Config）：其余全部，「编排配置」暂定、「AI 对话」不入本期。
// 因此这两个函数**绝不碰** cfg.title / collectCfg.url / entryCondition —— 换配置不能改掉节点名和源 URL。
//
// 旧字段对照见 0824-02 §4：codeRule=入库配置、contentRule=正文规则、snatchDrepeat=去重类型、
// templetCode=业务类型、isMulti=是否列表、entryTypeId=输出表、inEntryType=输入表、topic=队列。
import type { Config } from '@/api'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

/** 去重类型：旧 '' = 源内去重，'ALL' = 表内去重（0824-02 §4） */
function dedupFromLegacy(dedupType?: string): 'source' | 'table' {
  return dedupType === 'ALL' ? 'table' : 'source'
}
function dedupToLegacy(mode?: 'source' | 'table'): string {
  return mode === 'table' ? 'ALL' : ''
}

/** 把已保存的配置正文覆盖到节点上（选择已有配置 / 保存后回读）。流程字段原样保留。 */
export function applyConfigToNode(cfg: NodeConfig, config: Config): void {
  cfg.configId = config.configId
  cfg.configName = config.name
  const target = cfg.collectCfg ?? cfg
  target.structuredConfig = config.codeRule || undefined
  target.contentRules = config.contentRule || undefined
  if (cfg.collectCfg) {
    cfg.collectCfg.multiMode = config.multiMode
    cfg.collectCfg.bizType = config.templateCode || undefined
    cfg.collectCfg.outputTable = config.entryTypeId || ''
    cfg.collectCfg.inputTable = config.inEntryTypeId || ''
    cfg.collectCfg.dedupMode = dedupFromLegacy(config.dedupType)
    cfg.collectCfg.useProxy = !!config.proxyConf
  } else {
    cfg.outputTable = config.entryTypeId || ''
    cfg.inputTable = config.inEntryTypeId || ''
    cfg.dedupMode = dedupFromLegacy(config.dedupType)
  }
  cfg.taskCfg = { urlRule: '', ...cfg.taskCfg, queue: config.topic ?? cfg.taskCfg?.queue ?? '' }
}

/**
 * 从节点组装配置写入体。base 是 config/configDetail 的**原始记录**——我们的模型没有覆盖
 * clearRule/transRule/checkRule/snatchConf 等 BLOB 字段，不带上原值就会被这次保存清空。
 * 新建配置没有原值，base 传 {} 即可。
 */
export function buildConfigPayload(cfg: NodeConfig, base: Record<string, unknown> = {}): Record<string, unknown> {
  const cc = cfg.collectCfg
  const source = cc ?? cfg
  // 只覆盖节点上确实有值的字段，其余保持 base 原值。
  // 这一层是兜底：节点上某个配置字段没被回填时（历史遗漏或以后新增字段忘了接），
  // 直接写进 payload 就会用空值把后端真值抹掉——2026-08-28 实测配置 1400968 的
  // templetCode='login' 就是这么被清掉的。有值才覆盖，没值就别碰。
  const edited: Record<string, unknown> = {
    configName: cfg.configName ?? '',
    entryTypeId: (cc?.outputTable ?? cfg.outputTable) || undefined,
    inEntryType: (cc?.inputTable ?? cfg.inputTable) || undefined,
    isMulti: cc?.multiMode,
    templetCode: cc?.bizType || undefined,
    topic: cfg.taskCfg?.queue || undefined,
    snatchDrepeat: dedupToLegacy(cc?.dedupMode ?? cfg.dedupMode),
    codeRule: source.structuredConfig || undefined,
    contentRule: source.contentRules || undefined,
  }
  const payload: Record<string, unknown> = {
    ...base,
    // configUrl 是配置自己的地址，跟源实际 URL 不是一回事（0824-02 §1.5：配置 81516 被 9 个源复用，
    // 各源 sourceUrl 不同）。这里只带原值，绝不用节点上的源 URL 覆盖它。
    configUrl: base.configUrl ?? '',
  }
  Object.entries(edited).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value
  })
  return payload
}
