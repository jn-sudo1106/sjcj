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
import { engineCodeOf } from '@/api/translate'
import {
  defaultMultiMode,
  isArticleSummaryNode,
  isArticleTagNode,
  isAudioTextNode,
  isOcrNode,
  isPdfNode,
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

/**
 * 结构化配置落在 cs_config.core_param（而非 code_rule）的节点：翻译助手（源/目标语言与引擎）
 * 与音频提取文字（供应商/区间/输出格式）。这类节点从 core_param 读写，回读时兼容旧存量 code_rule。
 */
function isStructuredInCoreParam(cfg: NodeConfig): boolean {
  // OCR 抓取（2026-09-30）：编排 Tab 的 `{"saveAsFile":bool,"outputFileName"?:string}` 也落 core_param，不占 code_rule。
  return isTranslateNode(cfg) || isAudioTextNode(cfg) || isOcrNode(cfg)
}

/** 把已保存的配置正文覆盖到节点上（选择已有配置 / 保存后回读）。流程字段原样保留。 */
export function applyConfigToNode(cfg: NodeConfig, config: Config): void {
  cfg.configId = config.configId
  cfg.configName = config.name
  cfg.configUrl = config.url ?? ''
  cfg.runPolicy = config.runPolicy
  if (config.configType) {
    cfg.configType = String(config.configType)
    if (cfg.configType === '150' && (cfg.template === 'rule' || !cfg.template)) {
      cfg.template = 'ocr'
      if (!cfg.sub || cfg.sub.includes('规则处理')) cfg.sub = '[150] OCR抓取 · 图片文字识别'
    } else if (cfg.configType === '800' && (cfg.template === 'rule' || !cfg.template)) {
      cfg.template = 'translate'
      if (!cfg.sub || cfg.sub.includes('规则处理')) cfg.sub = '[800] 翻译助手 · 多语言互译'
    } else if (cfg.configType === '730' && (cfg.template === 'rule' || !cfg.template)) {
      cfg.template = 'article-tag'
      if (!cfg.sub || cfg.sub.includes('规则处理')) cfg.sub = '[730] 文章打标签 · 大模型抽取'
    } else if (cfg.configType === '720' && (cfg.template === 'rule' || !cfg.template)) {
      cfg.template = 'article-summary'
      if (!cfg.sub || cfg.sub.includes('规则处理')) cfg.sub = '[720] 文章生成摘要 · 大模型生成'
    } else if (cfg.configType === '710' && (cfg.template === 'rule' || !cfg.template)) {
      cfg.template = 'audio-text'
      if (!cfg.sub || cfg.sub.includes('规则处理')) cfg.sub = '[710] 音频提取文字 · 语音识别'
    } else if (cfg.configType === '700' && (cfg.template === 'rule' || !cfg.template)) {
      cfg.template = 'video-audio'
      if (!cfg.sub || cfg.sub.includes('规则处理')) cfg.sub = '[700] 视频提取音频 · 音轨抽取'
    }
  }
  const target = cfg.collectCfg ?? cfg
  // 翻译助手 / 音频提取文字节点的结构化配置存在 core_param（2026-09-21 / 2026-09-23 从
  // code_rule 挪过去），旧存量配置仍躺在 code_rule——回读先取 core_param，取不到回落 code_rule 兼容。
  // OCR 抓取（2026-09-30 用户拍板）：编排 Tab 的「是否保存为文件 / 指定输出文件名」落 core_param 的
  // `{"saveAsFile":bool,"outputFileName"?:string}`；对旧存量（core_param/code_rule 都没有）按 isMulti 反推勾选态，
  // 保证 Tab 的勾选跟后端 isMulti 对齐——发后续时 ocrMultiModeFor 也从同一份 structuredConfig
  // 得到同一 isMulti，不会因为回读丢字段把 1 打回 0。
  if (isStructuredInCoreParam(cfg)) {
    target.structuredConfig = config.coreParam || config.codeRule || undefined
    if (target.structuredConfig == null && isOcrNode(cfg)
      && (config.multiMode === 0 || config.multiMode === 1)) {
      target.structuredConfig = JSON.stringify({ saveAsFile: config.multiMode === 1 })
    }
  } else {
    target.structuredConfig = config.codeRule ?? undefined
  }
  target.contentRules = config.contentRule ?? undefined
  cfg.coreParam = config.coreParam ?? undefined
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
  // PDF 抓取（2026-10-08，用户拍板方案一）：没有这条时只能从 snatchType 的 `[130]` 反解——
  // 节点经「复制配置 / 更换」带进一个 90 的抓取类型后，保存就把 configType 写成 90，
  // 下次加载 isPdfNode 认不出、PDF 那套规则式 Tab 直接消失（实测配置 1401119）。模板信号优先。
  pdf: 130,
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

/**
 * 打标签 / 摘要节点保存时的核心参数（2026-09-20 需求，落 cs_config.core_param）：模型供应商
 * 与模型按 `{"providerCode":"...","model":"..."}`，取的是编排 Tab 当前下拉的值
 *（execCfg.modelProviderCode / modelCode）。两个都没选好（编排 Tab 没打开过 / 模型还没拉到）
 * 时返回 undefined——沿用「有值才覆盖」，不把后端原值抹掉。
 */
function modelCodeRuleFor(cfg: NodeConfig): string | undefined {
  if (!isArticleSummaryNode(cfg) && !isArticleTagNode(cfg)) return undefined
  const providerCode = (cfg.execCfg?.modelProviderCode ?? '').trim()
  const model = (cfg.execCfg?.modelCode ?? '').trim()
  if (!providerCode || !model) return undefined
  return JSON.stringify({ providerCode, model })
}

/**
 * 翻译助手节点保存时的核心参数（2026-09-21 需求，落 cs_config.core_param）：源/目标语言与
 * 引擎按 `{"from":"zh","to":"en","engine":"google"}`，取的是节点上的结构化配置
 *（编排 Tab 改下拉即写回）。整段从 code_rule 挪到 core_param，code_rule 不再写；
 * 结构化配置尚未回填（undefined）时不写，沿用「有值才覆盖」保留 base 原值。
 *
 * engine 统一成**英文引擎码**再落库：存量 {"from","to"} 没有引擎（后端缺省百度）时
 * 补默认 baidu，存量界面值（谷歌翻译等，曾短暂落过库）换算回引擎码——保证「保存时选的
 * 是什么、库里存的就是对应引擎码」，不再出现只有语言对、没有 engine 的 core_param。
 */
function translateStructuredFor(cfg: NodeConfig): string | undefined {
  if (!isTranslateNode(cfg)) return undefined
  const source = cfg.collectCfg ?? cfg
  const stored = source.structuredConfig
  if (!stored) return undefined
  const text = stored.trim()
  if (!text.startsWith('{')) return stored
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return stored
    const record = parsed as Record<string, unknown>
    const raw = String(record.engine ?? '').trim()
    const engine = raw ? engineCodeOf(raw) : 'baidu'
    if (record.engine !== engine || !raw) {
      return JSON.stringify({ ...record, engine })
    }
  } catch {
    // 解析不出按原样写
  }
  return stored
}

/**
 * 音频提取文字节点保存时的核心参数（2026-09-23 需求，落 cs_config.core_param）：供应商
 *（本地/远程）+ 远程供应商/模型 + 语言 + 区间裁剪 + 输出格式/目录，取的是编排 Tab 改回节点
 * 的结构化配置（serializeAudioOrchestrationConfig 的 JSON 文本，见 api/speech.ts）。
 * 整段从 code_rule 挪到 core_param，code_rule 不再写；结构化配置尚未回填（undefined）时不写，
 * 沿用「有值才覆盖」保留 base 原值。
 */
function audioStructuredFor(cfg: NodeConfig): string | undefined {
  if (!isAudioTextNode(cfg)) return undefined
  const source = cfg.collectCfg ?? cfg
  return source.structuredConfig
}

/**
 * OCR 抓取编排配置（2026-09-30「是否保存为文件」，2026-10-08 加「指定输出文件名」）：
 * 落 cs_config.core_param 的 `{"saveAsFile":bool,"outputFileName"?:string}`（编排 Tab 写进
 * cfg.structuredConfig，OCR 无 collectCfg → 落 NodeConfig 顶层）。整段原样透传，新增键不用改这里；
 * isMulti 只由 saveAsFile 派生（见 ocrMultiModeFor），文件名不参与。
 */
function ocrStructuredFor(cfg: NodeConfig): string | undefined {
  if (!isOcrNode(cfg)) return undefined
  return cfg.structuredConfig
}

/**
 * PDF 抓取编排配置（2026-10-08 需求）：点底部「保存」时把「设置业务规则」的描述与模型选择落成
 * cs_config.core_param 的 `{"describe":"...","providerCode":"...","model":"..."}`。
 * 取的是编排 Tab 当前值（存在 cfg.execCfg，PDF 走 execCfg 而非 ruleCfg）；`providerCode` / `model`
 * 两个键名与摘要 / 打标签节点同一口径（后端按这两个键读 core_param）。
 * 三项全空（Tab 没打开过 / 模型列表没拉到）返回 undefined，沿用「有值才覆盖」不抹后端原值。
 */
function pdfStructuredFor(cfg: NodeConfig): string | undefined {
  if (!isPdfNode(cfg)) return undefined
  const describe = (cfg.execCfg?.describe ?? '').trim()
  const providerCode = (cfg.execCfg?.modelProviderCode ?? '').trim()
  const model = (cfg.execCfg?.modelCode ?? '').trim()
  if (!describe && !providerCode && !model) return undefined
  return JSON.stringify({
    ...(describe ? { describe } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(model ? { model } : {}),
  })
}

/**
 * OCR 保存时的 `isMulti`（2026-09-30，用户拍板）：勾选=1（列表类）、不勾=0（详情类）。
 * OCR 没有 collectCfg，通用 `resolveMultiMode` 对它恒 undefined，会让 `isMulti=null` →
 * 后端 nextStep「没有详情配置」→ 发后续报「OCR抓取 处理失败：没有详情配置」。这里恒给 0/1
 * 兜底（structuredConfig 未回填按 0），保证 OCR 步骤永远带合法 isMulti。
 */
function ocrMultiModeFor(cfg: NodeConfig): number | undefined {
  if (!isOcrNode(cfg)) return undefined
  const text = cfg.structuredConfig?.trim()
  if (!text || !text.startsWith('{')) return 0
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return parsed && typeof parsed === 'object' && parsed.saveAsFile === true ? 1 : 0
  } catch {
    return 0
  }
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
    isMulti: isOcrNode(cfg) ? ocrMultiModeFor(cfg) : resolveMultiMode(cfg),
    // 节点类型（0828 W0-7）：此前**完全没写**，导致复制出来的配置类型永远停在被复制那份上。
    configType: configTypeForSave(cfg, base),
    templetCode: cc?.bizType || undefined,
    topic: cfg.taskCfg?.queue || undefined,
    snatchDrepeat: dedupToLegacy(cc?.dedupMode ?? cfg.dedupMode),
    // 空字符串是用户明确删除，必须写回后端；只有 undefined 才代表“尚未回填，保留 base”。
    // 翻译助手 / 音频提取文字的结构化配置已挪去 core_param，code_rule 不再写（保持 base 原值）。
    codeRule: isStructuredInCoreParam(cfg) ? undefined : source.structuredConfig,
    contentRule: source.contentRules,
    // 打标签 / 摘要节点把模型选择写核心参数（modelCodeRuleFor），翻译助手写语言/引擎、
    // 音频节点写转写参数、PDF 节点写描述+模型（各自 structuredFor），都没写时回写节点回读到的原值。
    coreParam: modelCodeRuleFor(cfg) ?? translateStructuredFor(cfg) ?? audioStructuredFor(cfg) ?? ocrStructuredFor(cfg) ?? pdfStructuredFor(cfg) ?? cfg.coreParam,
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
