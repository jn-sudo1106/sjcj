// flowModel.layout.ts — 流程画布布局与节点配置规范化算法
//
// 从 flowModel.ts（1270 行）物理切出：
//   - 节点配置规范化（normalizeInputMapping / normalizeFieldDef / emptyTripleRow / setTripleValue
//     / normalizeNodeConfig / normalizeNodeConfigs / cloneConfig）
//   - 画布布局算法（TERMINALS / HPlacedPos / buildHorizontalLayout / SourceSeed / effectiveInputTable
//     / isFirstMainNode / nowStamp / backfillOutputTables）
//   - 节点 UI 辅助（iconFor / nodeClassFor）
//
// 依赖关系：layout → flowModel (types) + @/utils/flow/urlParams（extractUrlParamIds）；
//          seeds → layout（用 cloneConfig / normalizeNodeConfigs / backfillOutputTables）

import type {
  BranchSeed,
  FieldDef,
  FlowBranch,
  FlowBranchGroup,
  FlowDef,
  InputMapping,
  NodeConfig,
  NodeConfigSeed,
  CollectorSchedule,
  LoginConfigRef,
  TaskConfig,
  TaskParamValue,
  TripleField,
} from './flowModel'
import {
  isDataNode, isOcrNode, isAudioTextNode, isVideoAudioNode, isArticleSummaryNode,
  isArticleTagNode, isTranslateNode, isMonitorNode, isDataValidationNode,
  nodeInputTable, nodeOutputTable, branchGroupOf,
} from './flowModel'
import { extractUrlParamIds } from '@/utils/flow/urlParams'

// ---------- 节点配置规范化 ----------
function normalizeInputMapping(row: InputMapping | [string, string, string]): InputMapping {
  if (Array.isArray(row)) return { name: row[0] ?? '', from: row[1] ?? '', desc: row[2] ?? '' }
  return { name: row.name ?? '', from: row.from ?? '', desc: row.desc ?? '' }
}

function normalizeFieldDef(row: FieldDef | [string, string, string]): FieldDef {
  if (Array.isArray(row)) return { name: row[0] ?? '', type: row[1] ?? '', desc: row[2] ?? '' }
  return { name: row.name ?? '', type: row.type ?? '', desc: row.desc ?? '' }
}

export function emptyTripleRow(field: TripleField): InputMapping | FieldDef {
  return field === 'inmap' ? { name: '', from: '', desc: '' } : { name: '', type: '', desc: '' }
}

export function setTripleValue(field: TripleField, row: InputMapping | FieldDef, col: 0 | 1 | 2, value: string) {
  if (field === 'inmap') {
    const target = row as InputMapping
    if (col === 0) target.name = value
    else if (col === 1) target.from = value
    else target.desc = value
    return
  }
  const target = row as FieldDef
  if (col === 0) target.name = value
  else if (col === 1) target.type = value
  else target.desc = value
}

export function normalizeNodeConfig(cfg: NodeConfig | NodeConfigSeed): NodeConfig {
  const next = JSON.parse(JSON.stringify(cfg)) as NodeConfigSeed
  if (next.collectCfg) {
    const legacyAccount = next.collectCfg.account?.trim()
    const normalizeLoginConfigs = (items: LoginConfigRef[]) => {
      const seen = new Set<string>()
      const configs = items
        .map((item, index) => {
          const raw = item as unknown as Record<string, unknown>
          return {
          id: item.id?.trim() || `login-${index + 1}`,
          loginUrl: item.loginUrl?.trim() || next.collectCfg?.loginUrl?.trim() || next.collectCfg?.url?.trim() || '',
          loginName: item.loginName?.trim() || String(raw.account ?? '').trim(),
          // 登录密码只允许存在于当前编辑会话；从已保存流程/模板加载时不回填。
          loginPwd: '',
          newLoginConfig: item.newLoginConfig === '0' ? '0' as const : '1' as const,
          authConfig: item.authConfig?.trim() || '',
          enabled: item.enabled !== false,
          }
        })
        .filter((item) => {
          if (seen.has(item.id)) return false
          seen.add(item.id)
          return true
        })
      const preferred = next.collectCfg?.defaultLoginConfigId
      next.collectCfg!.loginConfigs = configs
      next.collectCfg!.defaultLoginConfigId = configs.some((item) => item.id === preferred && item.enabled)
        ? preferred
        : configs.find((item) => item.enabled)?.id
      const selected = configs.find((item) => item.id === next.collectCfg!.defaultLoginConfigId)
      if (selected?.loginUrl) next.collectCfg!.url = selected.loginUrl
    }

    if (next.collectCfg.loginConfigs?.length) {
      normalizeLoginConfigs(next.collectCfg.loginConfigs)
    } else if (legacyAccount || next.collectCfg.loginUrl) {
      normalizeLoginConfigs([{
        id: 'legacy-default',
        loginUrl: next.collectCfg.loginUrl || next.collectCfg.url || '',
        loginName: legacyAccount || '',
        loginPwd: '',
        newLoginConfig: '1',
        authConfig: '',
        enabled: true,
      }])
    }
  }
  if (next.collectCfg && !next.collectCfg.urlParamRefs?.length) {
    // 旧流程只有 URL token；加载时迁移为显式节点绑定，保存后不再依赖隐式推导。
    next.collectCfg.urlParamRefs = extractUrlParamIds(next.collectCfg.url)
  }
  if (next.taskCfg) {
    const ownParamRefs = new Set(next.collectCfg?.urlParamRefs ?? [])
    const legacyValues: TaskParamValue[] = next.taskCfg.paramRefs?.map((paramId) => ({ paramId })) ?? []
    const paramValues: TaskParamValue[] = next.taskCfg.paramValues ?? legacyValues
    const seen = new Set<string>()
    const normalizedValues = paramValues.filter((item) => {
      if (!ownParamRefs.has(item.paramId) || seen.has(item.paramId)) return false
      seen.add(item.paramId)
      return true
    }).map((item) => ({
      paramId: item.paramId,
      fieldId: item.fieldId ?? '',
      valueExpr: item.valueExpr ?? '',
    }))
    if (normalizedValues.length) next.taskCfg.paramValues = normalizedValues
    else delete next.taskCfg.paramValues
    delete next.taskCfg.paramRefs
    if (next.taskCfg.contextMap) next.taskCfg.contextMap = [...new Set(next.taskCfg.contextMap.filter(Boolean))]
    if (next.taskCfg.outColumns) next.taskCfg.outColumns = [...new Set(next.taskCfg.outColumns.filter(Boolean))]
  }
  // 0806：定时策略统一迁到节点级；旧 CollectConfig / TaskConfig 字段保留兼容，
  // 新 UI 只写 next.schedule，避免再把定时策略绑定到首节点或采集节点。
  const legacyTask = next.taskCfg as (TaskConfig & Partial<CollectorSchedule>) | undefined
  const legacyCollect = next.collectCfg
  const schedule = next.schedule
  const normalizedSchedule: CollectorSchedule = {
    scheduleType: schedule?.scheduleType ?? legacyCollect?.scheduleType ?? legacyTask?.scheduleType,
    scheduleTime: schedule?.scheduleTime ?? legacyCollect?.scheduleTime ?? legacyTask?.scheduleTime,
    weekdays: schedule?.weekdays ?? legacyCollect?.weekdays ?? legacyTask?.weekdays,
    cron: schedule?.cron ?? legacyCollect?.cron ?? legacyTask?.cron,
  }
  if (Object.values(normalizedSchedule).some((value) => value !== undefined && value !== '')) next.schedule = normalizedSchedule
  // OCR 抓取已并入规则式处理节点（2026-09-22），历史存档里残留的 planned: true 要清掉：
  // isRunnableFlowNode 会跳过规划中节点，上游算不出后继 → 数据视图勾选列与「发后续任务」一起消失。
  if (isOcrNode(next)) {
    next.planned = false
    if ((next.status ?? '').includes('规划中')) next.status = '待配置'
  }
  return {
    ...next,
    inmap: (next.inmap ?? []).map(normalizeInputMapping),
    params: (next.params ?? []).map(normalizeFieldDef),
    output: (next.output ?? []).map(normalizeFieldDef),
  }
}

export function normalizeNodeConfigs(configs: Record<string, NodeConfig | NodeConfigSeed>): Record<string, NodeConfig> {
  return Object.fromEntries(Object.entries(configs).map(([id, cfg]) => [id, normalizeNodeConfig(cfg)]))
}

export function cloneConfig(cfg: NodeConfig): NodeConfig {
  return normalizeNodeConfig(cfg)
}

// ---------- 节点 UI 辅助（与 buildHorizontalLayout 一起用） ----------
/**
 * 节点类型的**展示口径**（0904 I12 / Z6-1）。
 *
 * 走查原话「每个节点你最好定一个类型吧」——卡片上原来只有 `iconFor` 那个两三位数字徽标
 * （`90` / `R` / `NODE`），没在这套系统里泡过的人根本认不出是什么。
 *
 * 判定优先级，从可靠到兜底：
 *   1. **决策 / 分头**：结构节点，跟"抓取类型"不是一个维度；
 *   2. **数据监控 / 规则处理**：靠 `template === 'monitor'`、`ruleCfg` 这类结构信号
 *      （不是标题正则——"数据监控"标题里没有"规则"二字，正则会漏）；
 *   3. **采集节点**：取 `snatchType` 的文案部分，即 `[90] - 网页抓取` → `网页抓取`。
 *      这就是旧平台「抓取类型」，也是落库的 `configType`（2026-08-28 确认）。
 *
 * 2026-09-07 更新：「规则处理」「数据监控」**现在也在** `SNATCH_TYPES` 里了（`600`/`700`）。
 * 此前这里认为它们不该进字典——理由是规则配置 1400998 的 `configType` 实测为 `null`，
 * 字典是落库枚举，臆造值会写脏（0904 §9-Q8 待确认，与产品口头「把它数据加加数据就行了」
 * 的要求方向相反）。重查 `config/sourceTypes` 发现后端已经真补上这两条，编号与名字
 * 跟这里的展示文案逐字对上，Q8 就此解掉：`configTypeFrom()`（nodeConfigPayload.ts）现在
 * 会给 monitor/rule 节点写 700/600，不再是"只加显示、不加落库"。
 */
/**
 * 抓取类型编号（sourceType / configType）→ 类型名称（typeName）。
 * 来源：字典表 cfg_source_type 与系统设置「节点类型」列表（0924 走查）。
 */
export const SOURCE_TYPE_NAME_BY_ID: Record<string, string> = {
  '90': '网页抓取',
  '110': 'EXCEL抓取',
  '120': 'DOC抓取',
  '130': 'PDF抓取',
  '140': 'App抓取',
  '150': 'OCR抓取',
  '160': 'Mail抓取',
  '170': 'Python抓取',
  '300': '校验类',
  '400': '提取数据发邮件',
  '500': '资讯抓取',
  '600': '规则处理',
  '610': '数据监控',
  '620': '数据校验',
  '700': '视频提取音频',
  '710': '音频提取文字',
  '720': '文章生成摘要',
  '730': '文章打标签',
  '800': '翻译助手',
}

/** 节点模板 → 类型名称 */
export const TEMPLATE_TO_TYPE_NAME: Record<string, string> = {
  web: '网页抓取',
  'web-list': '网页抓取',
  'web-detail': '网页抓取',
  ocr: 'OCR抓取',
  translate: '翻译助手',
  'article-tag': '文章打标签',
  'article-summary': '文章生成摘要',
  'audio-text': '音频提取文字',
  'video-audio': '视频提取音频',
  monitor: '数据监控',
  'data-validation': '数据校验',
  validation: '数据校验',
  rule: '规则处理',
  excel: 'EXCEL抓取',
  'excel-collect': 'EXCEL抓取',
  doc: 'DOC抓取',
  'doc-collect': 'DOC抓取',
  pdf: 'PDF抓取',
  'pdf-collect': 'PDF抓取',
  'mail-collect': 'Mail抓取',
  mail: '提取数据发邮件',
  news: '资讯抓取',
  'news-collect': '资讯抓取',
  app: 'App抓取',
  'app-collect': 'App抓取',
  python: 'Python抓取',
  check: '校验类',
  login: '网页抓取',
  'login-collect': '网页抓取',
  file: '网页抓取',
  'browser-html': '网页抓取',
  'wechat-html': '网页抓取',
}

export function nodeTypeLabel(cfg: NodeConfig): string {
  if (cfg.kind === 'decision') return '决策'
  if (cfg.kind === 'parallel') return '分头'

  // 1. 如果显式配置了 configType，优先按字典取真实「类型名称」
  if (cfg.configType && SOURCE_TYPE_NAME_BY_ID[String(cfg.configType)]) {
    return SOURCE_TYPE_NAME_BY_ID[String(cfg.configType)]
  }

  // 2. 结构特征与专门判定（优先精准匹配 OCR/AI/处理类节点）
  if (isOcrNode(cfg) || cfg.template === 'ocr') return 'OCR抓取'
  if (isTranslateNode(cfg) || cfg.template === 'translate') return '翻译助手'
  if (isArticleTagNode(cfg) || cfg.template === 'article-tag') return '文章打标签'
  if (isArticleSummaryNode(cfg) || cfg.template === 'article-summary') return '文章生成摘要'
  if (isVideoAudioNode(cfg) || cfg.template === 'video-audio') return '视频提取音频'
  if (isAudioTextNode(cfg) || cfg.template === 'audio-text') return '音频提取文字'
  if (isMonitorNode(cfg) || cfg.template === 'monitor') return '数据监控'
  if (isDataValidationNode(cfg) || cfg.template === 'data-validation') return '数据校验'

  // 3. template 映射表
  if (cfg.template && TEMPLATE_TO_TYPE_NAME[cfg.template]) {
    return TEMPLATE_TO_TYPE_NAME[cfg.template]
  }

  // 4. collectCfg.snatchType 中解析
  const snatch = cfg.collectCfg?.snatchType || ''
  const named = snatch.split('-').slice(1).join('-').trim()
  if (named) return named
  const codeInSnatch = snatch.match(/^\[(\d+)\]/)?.[1]
  if (codeInSnatch && SOURCE_TYPE_NAME_BY_ID[codeInSnatch]) {
    return SOURCE_TYPE_NAME_BY_ID[codeInSnatch]
  }

  // 5. sub 中的类型编号 [xxx]
  const subCode = (cfg.sub || '').match(/^\[(\d+)\]/)?.[1]
  if (subCode && SOURCE_TYPE_NAME_BY_ID[subCode]) {
    return SOURCE_TYPE_NAME_BY_ID[subCode]
  }

  // 6. 节点名称/配置名称中的关键词匹配
  const titleAndName = `${cfg.title || ''} ${cfg.configName || ''}`
  if (/ocr/i.test(titleAndName)) return 'OCR抓取'
  if (/翻译/.test(titleAndName)) return '翻译助手'
  if (/打标签|标注/.test(titleAndName)) return '文章打标签'
  if (/摘要/.test(titleAndName)) return '文章生成摘要'
  if (/视频/.test(titleAndName)) return '视频提取音频'
  if (/音频|语音|录音/.test(titleAndName)) return '音频提取文字'
  if (/数据监控/.test(titleAndName)) return '数据监控'
  if (/数据校验/.test(titleAndName)) return '数据校验'

  const fromSub = (cfg.sub || '').replace(/^\[[^\]]*\]\s*/, '').split('·')[0].trim()
  if (fromSub && fromSub !== '自定义草稿' && fromSub !== '自定义节点' && fromSub !== '规则处理') return fromSub

  // 7. 规则节点
  if (cfg.ruleCfg) return '规则处理'

  return fromSub || '数据处理'
}

export function iconFor(cfg: NodeConfig): string {
  const sub = cfg.sub || ''
  // 徽标优先取**节点自己的类型编号**：collectCfg.snatchType 最准（用户改过类型的节点也跟得上），
  // 其次看 sub 开头的 `[编号]`。2026-09-17 起字典有 17 条，一条条硬编码必然漏
  // （110/120/130/500/700/710/720 这些新类型当时都会退化成 NODE）。
  const typedCode = cfg.collectCfg?.snatchType?.match(/^\[(\d+)\]/)?.[1] || sub.match(/^\[(\d+)\]/)?.[1]
  if (typedCode) return typedCode
  // 后端字典里没有的伪代码，只服务存量节点（新建不会再产生，见 flowModel.seeds.ts 的 SNATCH_TYPES 注释）
  if (sub.indexOf('[95]') >= 0) return '95'
  if (sub.indexOf('[155]') >= 0) return '155'
  if (sub.indexOf('[BROWSER]') >= 0) return '180'
  if (sub.indexOf('[WECHAT]') >= 0) return '185'
  if (sub.indexOf('[LOGIN]') >= 0) return 'LOGIN'
  if (cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)) return 'IF'
  if (cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)) return 'PAR'
  // cfg.ruleCfg 是结构信号（isRuleNode 同款口径，见 flowModel.ts）：标题正则单独判会漏掉标题
  // 不含"规则"二字的规则类节点（比如"数据监控"模板——0901 新增，配置直接复用 rule 种子）。
  if (cfg.ruleCfg || /规则/.test(cfg.title)) return 'R'
  if (/指标/.test(cfg.title)) return 'M'
  if (/解析/.test(cfg.title)) return 'PARSE'
  if (/清洗/.test(cfg.title)) return 'CLEAN'
  if (/去重/.test(cfg.title)) return 'DEDUP'
  return 'NODE'
}

export function nodeClassFor(cfg: NodeConfig): string {
  if (cfg.planned && /邮件|告警/.test(cfg.title)) return 'mail-node planned'
  if (cfg.planned) return 'planned'
  if (cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)) return 'logic-node'
  if (cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)) return 'parallel-node'
  if (cfg.ruleCfg || /规则/.test(cfg.title)) return 'rule-node'
  if (/校验/.test(cfg.title)) return 'check-node'
  if (/邮件|告警/.test(cfg.title)) return 'mail-node'
  return ''
}

// ---------- 画布布局算法 ----------
// ---------- 结果视图横向布局 / 源 → 链路构造（纯函数，供 flow store 与分屏对比 Phase 5 共用）----------

export const TERMINALS: Record<string, string> = { start: '开始', end: '完成 / 发布候选' }

export interface HPlacedPos { left: number; top: number; width: number; height: number }
export interface HPlacedNode { id: string; cfg: NodeConfig; pos: HPlacedPos; branch: boolean }
export interface HPlacedTerm { id: string; label: string; pos: HPlacedPos }
/**
 * 直角折线路径（纵-横-纵），转角用二次贝塞尔倒圆角（0925）。
 * 流程树的分叉/收拢线此前用 S 形三次贝塞尔：分叉纵向间距只有 30px 时控制点被挤到 15px，
 * 视觉上「先横着甩出去再扎下来」，方向感不对（对照旧平台 data-view 的 buildBezierPath：
 * 它的行距 ~120px 起，同样的公式才成立）。改直角折线后，走向明确、与常见流程图一致。
 */
export function elbowVH(x1: number, y1: number, x2: number, y2: number, radius = 8, busY?: number): string {
  if (Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1) return `M${x1} ${y1} L${x2} ${y2}`
  const vSign = y2 > y1 ? 1 : -1
  const hSign = x2 > x1 ? 1 : -1
  // 母线默认走两端中间；收拢线显式给 busY（所有分支共用一条、贴在汇合点上方），排版更整齐
  const bus = busY ?? (y1 + y2) / 2
  const r = Math.max(1, Math.min(radius, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2,
    Math.abs(bus - y1) / 2, Math.abs(y2 - bus) / 2))
  return `M${x1} ${y1} L${x1} ${bus - vSign * r} Q${x1} ${bus} ${x1 + hSign * r} ${bus}`
    + ` L${x2 - hSign * r} ${bus} Q${x2} ${bus} ${x2} ${bus + vSign * r} L${x2} ${y2}`
}

/**
 * 横向直角折线（横-竖-横），转角用二次贝塞尔倒圆角（0928 数据视图节点条横版分支）。
 * 竖向母线走在 busX（默认两端中间）；同组各行共用一条母线，走向与 elbowVH 对称。
 */
export function elbowHV(x1: number, y1: number, x2: number, y2: number, radius = 8, busX?: number): string {
  if (Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1) return `M${x1} ${y1} L${x2} ${y2}`
  const hSign = x2 > x1 ? 1 : -1
  const vSign = y2 > y1 ? 1 : -1
  const bus = busX ?? (x1 + x2) / 2
  const r = Math.max(1, Math.min(radius, Math.abs(y2 - y1) / 2, Math.abs(bus - x1) / 2, Math.abs(x2 - bus) / 2))
  return `M${x1} ${y1} L${bus - hSign * r} ${y1} Q${bus} ${y1} ${bus} ${y1 + vSign * r}`
    + ` L${bus} ${y2 - vSign * r} Q${bus} ${y2} ${bus + hSign * r} ${y2} L${x2} ${y2}`
}

export interface HEdge {
  d: string
  rule: boolean
  /** 0925：虚线仅用于「旁路挂靠」的 bezier；分支行内的链/收拢线是结构化连线，走实线 */
  dashed?: boolean
}
export interface HorizontalLayout {
  nodes: HPlacedNode[]
  terminals: HPlacedTerm[]
  mainEdges: HEdge[]
  branchEdges: HEdge[]
  totalWidth: number
  totalHeight: number
  axisY: number
}

export interface HorizontalLayoutOptions {
  includeTerminals?: boolean
}

// 0926 REVIEW F-R14：布局常量提为模块级导出——测试（buildSourceSeed.test.ts 的布局断言）
// 引用同一组常量，实现调整时断言自动跟随，不再靠硬编码魔法数字镜像。
export const LAYOUT_NODE_W = 152
export const LAYOUT_NODE_H = 64
export const LAYOUT_TERM_W = 92
export const LAYOUT_TERM_H = 30
export const LAYOUT_GAP = 22
export const LAYOUT_BRANCH_DY = 86 // 旁路相对主链上下偏移
export const LAYOUT_ROW_GAP = 16 // 结果视图分支行纵向间隙（本布局自有口径，与画布 flow store 的 colGap 不同）
export const LAYOUT_FORK_GAP_X = 40 // 分叉带宽度：owner 右边到分支行首节点左边（竖向母线走中间）
export const LAYOUT_PAD_X = 16
export const LAYOUT_PAD_Y = 10

/** 结果视图顶部节点条布局（纯函数版，从 flow store 的 horizontalLayout 计算逻辑提取）
 *  0707 优化·Phase6：扩展支持 FlowBranchGroup 决策/分头节点的分支。
 *  0928：分支改回**横版**——0925 把分支做成「每支一列、向下堆叠」，节点条变成竖向树，跟上面
 *  横向主链方向不一致。现在分叉 owner 的右侧按**行**展开各分支（上下排开、整组以 owner 中线
 *  居中），链节点在行内向右排，链内再分叉递归向右展开；主链下一个节点排在整组分支右侧之外，
 *  各行行尾用横-竖-横折线收拢到它。 */
export function buildHorizontalLayout(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[] = [],
  options: HorizontalLayoutOptions = {},
): HorizontalLayout {
  const isTerm = (id: string) => id === 'start' || id === 'end'
  const visibleMain = options.includeTerminals === false ? main.filter((id) => !isTerm(id)) : main

  interface Pt { x: number; cy: number }
  interface ContRef { pt?: Pt | null }

  // 测量：分支行宽 = 链节点 + 链内嵌套组（组在节点右侧，隔一条分叉带）；行高 = max(节点高, 嵌套组高)
  const measureBranchW = (b: FlowBranch): number => {
    let w = 0
    b.chain.forEach((nid, i) => {
      if (i > 0) w += LAYOUT_GAP
      w += LAYOUT_NODE_W
      const sg = branchGroupOf(branchGroups, nid)
      if (sg) w += LAYOUT_FORK_GAP_X + measureGroupW(sg) + (b.chain[i + 1] ? LAYOUT_FORK_GAP_X - LAYOUT_GAP : 0)
    })
    return w
  }
  const measureGroupW = (g: FlowBranchGroup): number => g.branches.reduce((m, b) => Math.max(m, measureBranchW(b)), 0)
  const measureBranchH = (b: FlowBranch): number => {
    let h = LAYOUT_NODE_H
    for (const nid of b.chain) {
      const sg = branchGroupOf(branchGroups, nid)
      if (sg) h = Math.max(h, measureGroupH(sg))
    }
    return h
  }
  const measureGroupH = (g: FlowBranchGroup): number =>
    g.branches.reduce((sum, b) => sum + measureBranchH(b), 0) + Math.max(0, g.branches.length - 1) * LAYOUT_ROW_GAP

  // 主链顶对齐：上方旁路、或以主链中线居中的分支组伸到主链上方时，在主链上方留出空间
  const hasAbove = branches.some((b) => b.side === 'left')
  const hasBelow = branches.some((b) => b.side === 'right')
  let aboveNeed = hasAbove ? LAYOUT_BRANCH_DY : 0
  for (const id of visibleMain) {
    const g = branchGroupOf(branchGroups, id)
    if (g) aboveNeed = Math.max(aboveNeed, measureGroupH(g) / 2 - LAYOUT_NODE_H / 2)
  }
  const axisY = LAYOUT_PAD_Y + aboveNeed + LAYOUT_NODE_H / 2

  const mainPos: Record<string, HPlacedPos> = {}
  let x = LAYOUT_PAD_X
  visibleMain.forEach((id) => {
    const isT = isTerm(id)
    const w = isT ? LAYOUT_TERM_W : LAYOUT_NODE_W
    const h = isT ? LAYOUT_TERM_H : LAYOUT_NODE_H
    mainPos[id] = { left: x, top: axisY - h / 2, width: w, height: h }
    x += w + LAYOUT_GAP
    // owner 右侧要展开分支行：主链下一个节点排到整组分支右侧之外（收拢母线走在两者之间）
    const g = branchGroupOf(branchGroups, id)
    if (g) x = mainPos[id].left + w + LAYOUT_FORK_GAP_X + measureGroupW(g) + LAYOUT_FORK_GAP_X
  })
  const mainRight = x - LAYOUT_GAP + LAYOUT_PAD_X

  const branchPos: Record<string, HPlacedPos> = {}
  branches.forEach((b) => {
    const anchor = mainPos[b.rowAnchor]
    if (!anchor || !configs[b.id]) return
    branchPos[b.id] = {
      left: anchor.left,
      top: b.side === 'left' ? axisY - LAYOUT_BRANCH_DY - LAYOUT_NODE_H / 2 : axisY + LAYOUT_BRANCH_DY - LAYOUT_NODE_H / 2,
      width: LAYOUT_NODE_W,
      height: LAYOUT_NODE_H,
    }
  })

  const nodes: HPlacedNode[] = []
  const terminals: HPlacedTerm[] = []
  visibleMain.forEach((id) => {
    if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
    else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false })
  })
  branches.forEach((b) => {
    if (branchPos[b.id] && configs[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true })
  })

  // 主链横向连线。分叉 owner → 下一个主链节点不画直线：流向走各分支行，再由收拢线汇入
  // （直线会横穿居中那一行的分支节点）。
  const mainEdges: HEdge[] = []
  for (let i = 0; i < visibleMain.length - 1; i++) {
    const a = mainPos[visibleMain[i]]
    const b = mainPos[visibleMain[i + 1]]
    if (!a || !b) continue
    if (branchGroupOf(branchGroups, visibleMain[i])) continue
    mainEdges.push({
      d: `M${a.left + a.width} ${axisY} L${b.left} ${axisY}`,
      rule: Boolean(configs[visibleMain[i + 1]] && /规则/.test(configs[visibleMain[i + 1]].title)),
    })
  }

  // 旁路 bezier（横向：起点/终点取主链节点中线，弧顶在其上方/下方的旁路节点中线）
  const branchEdges: HEdge[] = []
  branches.forEach((b) => {
    const bp = branchPos[b.id]
    const mainEnd = b.edgeFrom === b.id ? b.edgeTo : b.edgeFrom
    const mp = mainPos[mainEnd]
    if (!bp || !mp) return
    const bx = bp.left + bp.width / 2
    const by = b.side === 'left' ? bp.top + bp.height : bp.top
    const mx = mp.left + mp.width / 2
    const my = axisY
    branchEdges.push({ d: `M${mx} ${my} C${mx} ${(my + by) / 2} ${bx} ${(my + by) / 2} ${bx} ${by}`, rule: false, dashed: true })
  })

  // ---- 分支行（0928 横版）----
  const pendingConverges: Array<{ from: Pt; ref: ContRef }> = []
  const ownerContRefs: Array<{ ownerId: string; ref: ContRef }> = []

  /** 摆放一个分支行：链节点在行中线上向右排，链内嵌套组摆在节点右侧；返回行尾（最后节点右边中点），
   *  行尾节点自己还有嵌套组时返回 null——那一段由嵌套组各行自己收拢。 */
  const placeChain = (b: FlowBranch, left: number, cy: number, contRef: ContRef): { head: Pt | null; tail: Pt | null } => {
    let cx = left
    let head: Pt | null = null
    let tail: Pt | null = null
    let prev: Pt | null = null
    b.chain.forEach((nid, i) => {
      if (!configs[nid]) return
      if (nodes.some((n) => n.id === nid)) return // 同一节点已在别处摆过（旁路/重复分支）
      nodes.push({ id: nid, cfg: configs[nid], pos: { left: cx, top: cy - LAYOUT_NODE_H / 2, width: LAYOUT_NODE_W, height: LAYOUT_NODE_H }, branch: true })
      if (!head) head = { x: cx, cy }
      if (prev) branchEdges.push({ d: `M${prev.x} ${cy} L${cx} ${cy}`, rule: false })
      const right = cx + LAYOUT_NODE_W
      prev = { x: right, cy }
      tail = { x: right, cy }
      cx = right + LAYOUT_GAP
      const sg = branchGroupOf(branchGroups, nid)
      if (sg) {
        const groupRight = right + LAYOUT_FORK_GAP_X + measureGroupW(sg)
        const nextCx = groupRight + LAYOUT_FORK_GAP_X
        const nestedRef: ContRef = b.chain[i + 1] ? { pt: { x: nextCx, cy } } : contRef
        placeGroup(sg, right, cy, nestedRef)
        cx = nextCx
        prev = null // 下一个链节点由嵌套组各行收拢进来，不再与本节点直连
        tail = null
      }
    })
    return { head, tail }
  }

  /** 摆放一个分支组：owner 右边 ownerRight 起隔一条分叉带，各分支行上下排开、以 owner 中线居中 */
  const placeGroup = (g: FlowBranchGroup, ownerRight: number, ownerCy: number, contRef: ContRef) => {
    const heights = g.branches.map(measureBranchH)
    const groupH = heights.reduce((a, h) => a + h, 0) + Math.max(0, heights.length - 1) * LAYOUT_ROW_GAP
    const left = ownerRight + LAYOUT_FORK_GAP_X
    let rowTop = ownerCy - groupH / 2
    g.branches.forEach((b, i) => {
      const rowCy = rowTop + heights[i] / 2
      rowTop += heights[i] + LAYOUT_ROW_GAP
      const { head, tail } = placeChain(b, left, rowCy, contRef)
      if (head) branchEdges.push({ d: elbowHV(ownerRight, ownerCy, head.x, head.cy, 8, ownerRight + LAYOUT_FORK_GAP_X / 2), rule: false })
      if (tail) pendingConverges.push({ from: tail, ref: contRef })
    })
  }

  // 分支从 owner 右边中线展开（主链节点中线 = axisY）
  visibleMain.forEach((id) => {
    const g = branchGroupOf(branchGroups, id)
    const mp = mainPos[id]
    if (!g || !mp) return
    const ref: ContRef = {}
    ownerContRefs.push({ ownerId: id, ref })
    placeGroup(g, mp.left + mp.width, axisY, ref)
  })
  // 收拢目标：owner 在主链上的下一个节点的左边中点
  ownerContRefs.forEach(({ ownerId, ref }) => {
    const nextId = visibleMain[visibleMain.indexOf(ownerId) + 1]
    const np = nextId ? mainPos[nextId] : undefined
    ref.pt = np ? { x: np.left, cy: axisY } : null
  })
  for (const { from, ref } of pendingConverges) {
    const to = ref.pt
    if (!to || to.x <= from.x + 1) continue
    branchEdges.push({ d: elbowHV(from.x, from.cy, to.x, to.cy, 8, to.x - LAYOUT_FORK_GAP_X / 2), rule: false })
  }

  let maxRight = mainRight
  let maxBottom = axisY + LAYOUT_NODE_H / 2 + LAYOUT_PAD_Y
  for (const n of nodes) {
    maxRight = Math.max(maxRight, n.pos.left + n.pos.width + LAYOUT_PAD_X)
    maxBottom = Math.max(maxBottom, n.pos.top + n.pos.height + LAYOUT_PAD_Y)
  }
  for (const t of terminals) {
    maxRight = Math.max(maxRight, t.pos.left + t.pos.width + LAYOUT_PAD_X)
    maxBottom = Math.max(maxBottom, t.pos.top + t.pos.height + LAYOUT_PAD_Y)
  }
  if (hasBelow) maxBottom = Math.max(maxBottom, axisY + LAYOUT_BRANCH_DY + LAYOUT_NODE_H / 2 + LAYOUT_PAD_Y)

  return {
    nodes,
    terminals,
    mainEdges,
    branchEdges,
    totalWidth: Math.max(640, maxRight),
    totalHeight: maxBottom,
    axisY,
  }
}

export interface SourceSeed { main: string[]; branches: BranchSeed[]; configs: Record<string, NodeConfig> }

/** 主链上从 beforeIdx 起向前找最近一个有输出表的节点（不含 beforeIdx 自身），供输入表自动继承（0701 问题五） */
function upstreamOutputTableOf(main: string[], configs: Record<string, NodeConfig>, beforeIdx: number): string {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const c = configs[main[i]]
    if (c) {
      const t = nodeOutputTable(c)
      if (t) return t
    }
  }
  return ''
}

/**
 * 节点有效输入表（0701 问题五）：显式设置优先；否则主链节点继承上一个有输出表的节点，
 * 旁路节点继承锚点节点；均无则空（即"无上游可继承"，通常只发生在主链首节点）。
 * 0707 优化·Phase6 补：决策/分头分支 chain 内节点继承同分支内前一个有输出表的节点；
 * chain 内均无则继承 owner 节点"流入"的表——owner 是决策/分头逻辑节点，本身不产表，
 * 递归取 owner 的 effectiveInputTable（= 流入 owner 的上游数据），而非 owner 自己的输出表（恒为空）。
 */
export function effectiveInputTable(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): string {
  const c = configs[id]
  if (!c) return ''
  const own = nodeInputTable(c)
  if (own) return own
  const idx = main.indexOf(id)
  if (idx >= 0) return upstreamOutputTableOf(main, configs, idx)
  const branch = branches.find((b) => b.id === id)
  if (branch) {
    const anchor = configs[branch.rowAnchor]
    return anchor ? nodeOutputTable(anchor) : ''
  }
  // 0925：递归查找——链内再分叉（subGroups）的节点在嵌套分组里，顶层遍历找不到；
  // 命中后链内向前找最近有输出表的节点，链内无则向上取 owner 的 effectiveInputTable
  const findInGroups = (groups: FlowBranchGroup[]): { chain: string[]; ownerId: string } | undefined => {
    for (const g of groups) {
      for (const b of g.branches) {
        if (b.chain.includes(id)) return { chain: b.chain, ownerId: g.ownerId }
        const nested = findInGroups(b.subGroups ?? [])
        if (nested) return nested
      }
    }
    return undefined
  }
  const found = findInGroups(branchGroups)
  if (found) {
    for (let i = found.chain.indexOf(id) - 1; i >= 0; i--) {
      const t = configs[found.chain[i]] ? nodeOutputTable(configs[found.chain[i]]) : ''
      if (t) return t
    }
    return effectiveInputTable(main, branches, configs, found.ownerId, branchGroups)
  }
  return ''
}

/** 是否主链首个数据节点（无上游节点；0701 问题五："从第二个步骤开始有输入表"，首节点无输入表） */
export function isFirstMainNode(main: string[], configs: Record<string, NodeConfig>, id: string): boolean {
  const idx = main.indexOf(id)
  if (idx < 0) return false
  for (let i = 0; i < idx; i++) {
    if (configs[main[i]]) return false
  }
  return true
}

// ---------- 流程构造辅助（backfillOutputTables 供 seeds.ts 的 makeStandardFlow / buildFlow 使用）----------

/** 链路构造后回填（0701 问题二 Q1/Q2 口径）：非采集数据类节点的输出表默认取上游节点的表；旁路节点取锚点节点的表 */
export function backfillOutputTables(def: FlowDef): FlowDef {
  let upstream = ''
  def.main.forEach((id) => {
    const c = def.configs[id]
    if (!c) return
    const t = nodeOutputTable(c)
    if (t) {
      upstream = t
      return
    }
    if (!c.collectCfg && isDataNode(c) && upstream) c.outputTable = upstream
  })
  def.branches.forEach((b) => {
    const c = def.configs[b.id]
    if (!c || c.collectCfg || !isDataNode(c)) return
    // 此时 c.collectCfg 已 guard 为 undefined，c.outputTable 是必访问字段
    if (c.outputTable) return
    const anchor = def.configs[b.rowAnchor]
    const t = anchor ? nodeOutputTable(anchor) : ''
    if (t) c.outputTable = t
  })
  return def
}
