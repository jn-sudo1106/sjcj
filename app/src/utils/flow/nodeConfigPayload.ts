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
import {
  defaultMultiMode,
  isArticleSummaryNode,
  isArticleTagNode,
  isRuleNode,
  isTranslateNode,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'

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
  cfg.configUrl = config.url ?? ''
  cfg.runPolicy = config.runPolicy
  const target = cfg.collectCfg ?? cfg
  target.structuredConfig = config.codeRule ?? undefined
  target.contentRules = config.contentRule ?? undefined
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
/**
 * 节点类型 → 配置的 `configType`（= 旧平台「抓取类型」，2026-08-28 确认）。
 * 采集节点上以 `[90] - 网页抓取` 这样的展示串存在（TEMPLATE_TO_SNATCH），这里取出编号。
 * 取值范围由 canvas/legacyEnums.test.ts 锁死为后端字典 config/sourceTypes 的编号。
 * 解析不出编号就返回 undefined——按"有值才覆盖"的原则保留 base 原值，绝不猜一个写进去。
 *
 * 规则 / 数据监控这类节点没有 `collectCfg`（自然也没有 snatchType 展示串），**2026-09-07 前**
 * 这里对它们恒返回 undefined——当时字典没有对应编号，写一个臆造值等于把 `1400998`
 * （实测 configType 为 `null`）之类的真实样本盖成错的（0904 §9-Q8 未决）。现在按模板写死。
 *
 * **2026-09-17 编号订正**：字典里 610=数据监控、620=数据校验，700 已经另有其主
 *（视频提取音频）。此前写 700/800 的话，监控节点保存下来会变成"视频提取音频"、
 * 校验节点写一个字典里不存在的 800，所以这次一并改掉。
 * 判断顺序：先查模板表（monitor 复用 rule 种子，`ruleCfg` 也为真，必须让模板信号赢），
 * 再退回 `ruleCfg → 600`，最后按 snatchType 取编号。
 */
const TEMPLATE_CONFIG_TYPE: Record<string, number> = {
  rule: 600,
  monitor: 610,
  'data-validation': 620,
  'video-audio': 700,
  'audio-text': 710,
  'article-summary': 720,
  'article-tag': 730,
  // 800 现在是「翻译助手」（2026-09-17 核对 cfg_source_type）；09-17 前本前端曾把 800 写成数据校验，
  // 那个编号已经改成 620，所以这里不会与校验撞车。
  translate: 800,
  check: 300,
  mail: 400,
  ocr: 150,
}

function configTypeFrom(cfg: NodeConfig): number | undefined {
  const byTemplate = cfg.template ? TEMPLATE_CONFIG_TYPE[cfg.template] : undefined
  if (byTemplate) return byTemplate
  if (cfg.ruleCfg) return 600
  const code = cfg.collectCfg?.snatchType?.match(/^\[(\d+)\]/)?.[1]
  return code ? Number(code) : undefined
}

/**
 * 落库用的 `isMulti`（2026-08-28 拍板）。
 *
 * 界面上「网页类型」只让选 列表页 / 详情页 两项；旧三态里的 `2 更新父表` **不由用户选**，
 * 而是按「输入表 == 输出表」推导——详情步骤如果读写同一张表，语义上就是回写父行。
 *
 * 放在落库这一步算，而不是在下拉的 change 里算：用户可能先选详情页、之后再改输入/输出表，
 * 在 change 里算就会停在改表之前的结论。这里算能保证跟最终提交的表配置一致。
 */
export function resolveMultiMode(cfg: NodeConfig): number | undefined {
  const cc = cfg.collectCfg
  if (!cc) return undefined
  // 「未设置」占位已去掉（D10），界面永远显示一个具体值；模型上没值时按节点形态推导，
  // 与 ConfigTab 的回显兜底共用 defaultMultiMode，保证"看到的就是会写进去的"。
  const mode = cc.multiMode ?? defaultMultiMode(cfg)
  if (mode === 1) return 1
  const input = cc?.inputTable ?? cfg.inputTable
  const output = cc?.outputTable ?? cfg.outputTable
  return input && output && input === output ? 2 : 0
}

/**
 * 节点当前拼接好的系统提示词（2026-09-18 需求：点击保存时随配置落 `cs_config.prompt`）。
 *
 * 编排配置 Tab 把模板 + 占位符拼好后写回节点：规则/数据监控/数据校验 → `ruleCfg.systemPrompt`，
 * 文章摘要/打标签/翻译 → `execCfg.systemPrompt`。只有这几类会拼提示词的节点才带 prompt——
 * 普通采集节点的 `execCfg.systemPrompt` 是抓取 XML 的默认模板，写进 prompt 属于污染字段。
 *
 * 返回 undefined = 不覆盖 base 原值（"有值才覆盖"）；空串（含纯空白）也不覆盖——
 * systemPrompt 由 Tab 自动拼接管理，空串多出现在拼接尚未完成时，不能把后端真值抹掉。
 */
function promptForConfig(cfg: NodeConfig): string | undefined {
  const orch = isRuleNode(cfg)
    ? cfg.ruleCfg
    : isArticleSummaryNode(cfg) || isArticleTagNode(cfg) || isTranslateNode(cfg)
      ? cfg.execCfg
      : undefined
  const prompt = orch?.systemPrompt
  return prompt?.trim() ? prompt : undefined
}

/**
 * 保存时的 configType（2026-09-18 防污染）：`configTypeFrom` 对「带 ruleCfg 但没有
 * template」的节点会退回 600——那是为历史规则配置补类型用的。但翻译助手/打标签等
 * 规则式节点在**首屏 configDetail 回填前**会被短暂画成规则节点（见 flowModel.seeds 的
 * applyStepDetails 重建机制），用户如果在这个窗口点保存，600 就会把配置真实类型
 * （730/800 等）覆盖掉，之后回读再也认不出它是什么（实测配置 1401011 被写成 600）。
 *
 * 兜底口径：600 是**猜测值**。base 里躺着的是这几类无脚本节点的真实类型号
 * （150/700/710/720/730/800）时以 base 为准——那种情况下节点还没被正确识别，
 * 真实类型就在 base 里；其余情况（含 base 为空的历史规则配置）照旧写 600。
 */
const SCRIPTLESS_CONFIG_TYPES = new Set([150, 700, 710, 720, 730, 800])

function configTypeForSave(cfg: NodeConfig, base: Record<string, unknown>): number | undefined {
  const fromNode = configTypeFrom(cfg)
  if (fromNode === 600 && !cfg.template && cfg.ruleCfg) {
    const baseType = base.configType == null ? undefined : Number(base.configType)
    if (baseType && SCRIPTLESS_CONFIG_TYPES.has(baseType)) return baseType
  }
  return fromNode
}

export function buildConfigPayload(cfg: NodeConfig, base: Record<string, unknown> = {}): Record<string, unknown> {
  const cc = cfg.collectCfg
  const source = cc ?? cfg
  // 只覆盖节点上确实有值的字段，其余保持 base 原值。
  // 这一层是兜底：节点上某个配置字段没被回填时（历史遗漏或以后新增字段忘了接），
  // 直接写进 payload 就会用空值把后端真值抹掉——2026-08-28 实测配置 1400968 的
  // templetCode='login' 就是这么被清掉的。有值才覆盖，没值就别碰。
  const edited: Record<string, unknown> = {
    configName: cfg.configName ?? '',
    // 配置自己的 URL。绝不用 collectCfg.url（那是源 URL 的显示副本）。
    ...(cfg.configUrl !== undefined ? { configUrl: cfg.configUrl } : {}),
    entryTypeId: (cc?.outputTable ?? cfg.outputTable) || undefined,
    inEntryType: (cc?.inputTable ?? cfg.inputTable) || undefined,
    isMulti: resolveMultiMode(cfg),
    // 节点类型（0828 W0-7）：此前**完全没写**，导致复制出来的配置类型永远停在被复制那份上。
    configType: configTypeForSave(cfg, base),
    templetCode: cc?.bizType || undefined,
    topic: cfg.taskCfg?.queue || undefined,
    snatchDrepeat: dedupToLegacy(cc?.dedupMode ?? cfg.dedupMode),
    // 空字符串是用户明确删除，必须写回后端；只有 undefined 才代表“尚未回填，保留 base”。
    codeRule: source.structuredConfig,
    contentRule: source.contentRules,
    // 拼接后的系统提示词（2026-09-18）：落 cs_config.prompt；见 promptForConfig 的节点类型口径。
    prompt: promptForConfig(cfg),
  }
  const payload: Record<string, unknown> = {
    ...base,
    // 配置自己的 URL 默认带 base 原值；节点上回填/编辑过（cfg.configUrl !== undefined）时由 edited 覆盖。
    // 绝不用 collectCfg.url（源 URL）写进来（0824-02 §1.5：配置 81516 被 9 个源复用，各源地址不同）。
    configUrl: base.configUrl ?? '',
  }
  Object.entries(edited).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value
  })
  return payload
}
