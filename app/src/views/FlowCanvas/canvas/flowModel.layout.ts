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
 * U 形直角折线（下-横-上）：两端点都在母线 busY 之上，用于「分支列收拢回主链」——
 * 母线走在整组分支列的下方，横向段不会切到任何分支节点。
 */
export function elbowU(x1: number, y1: number, x2: number, y2: number, busY: number, radius = 8): string {
  if (Math.abs(x2 - x1) < 1) return `M${x1} ${y1} L${x2} ${y2}`
  const hSign = x2 > x1 ? 1 : -1
  const r = Math.max(2, Math.min(radius, Math.abs(x2 - x1) / 2, Math.abs(busY - y1) / 2, Math.abs(busY - y2) / 2))
  return `M${x1} ${y1} L${x1} ${busY - r} Q${x1} ${busY} ${x1 + hSign * r} ${busY}`
    + ` L${x2 - hSign * r} ${busY} Q${x2} ${busY} ${x2} ${busY - r} L${x2} ${y2}`
}

export interface HEdge {
  d: string
  rule: boolean
  /** 0925：虚线仅用于「旁路挂靠」的 bezier；分支列内的链/收拢线是结构化连线，走实线 */
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
export const LAYOUT_COL_GAP = 16 // 结果视图分支列横向间隙（本布局自有口径；0927 P2-6：与画布 flow store 的 colGap=32 不同，勿再称「同口径」）
export const LAYOUT_PAD_X = 16
export const LAYOUT_PAD_Y = 10

/** 结果视图顶部节点条布局（纯函数版，从 flow store 的 horizontalLayout 计算逻辑提取，二者算法一致）
 *  0707 优化·Phase6：扩展支持 FlowBranchGroup 决策/分头节点的分支列（chain 节点平铺在 owner 节点下方一行） */
export function buildHorizontalLayout(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[] = [],
  options: HorizontalLayoutOptions = {},
): HorizontalLayout {
  const isTerm = (id: string) => id === 'start' || id === 'end'
  const visibleMain = options.includeTerminals === false ? main.filter((id) => !isTerm(id)) : main
  // 主链顶对齐：仅当有"上方旁路"时才在主链上方留空，否则贴顶；下方旁路/分支列向下扩展高度
  const hasAbove = branches.some((b) => b.side === 'left')
  const hasBelow = branches.some((b) => b.side === 'right')
  const axisY = (hasAbove ? LAYOUT_BRANCH_DY : LAYOUT_PAD_Y) + LAYOUT_NODE_H / 2

  // 0925 视觉重写：分支不再"平铺在同一行"（那样第二条分支起要用一条横穿前支节点的长弧线连接），
  // 改为与画布纵向布局同款——每个分支独占一列、链节点在列内向下堆叠，列内再分叉递归下探；
  // 先测量列宽/列高，再按槽位摆放，收拢线从该列子树最深节点出发。
  interface Pt { cx: number; y: number }
  interface ContRef { pt?: Pt | null }

  const measureBranchW = (b: FlowBranch): number => {
    let w = LAYOUT_NODE_W
    for (const nid of b.chain) {
      const sg = branchGroupOf(branchGroups, nid)
      if (sg) w = Math.max(w, measureGroupW(sg))
    }
    return w
  }
  const measureGroupW = (g: FlowBranchGroup): number =>
    g.branches.reduce((sum, b) => sum + measureBranchW(b), 0) + Math.max(0, g.branches.length - 1) * LAYOUT_COL_GAP
  const measureBranchH = (b: FlowBranch): number => {
    let total = 0
    for (const nid of b.chain) {
      total += LAYOUT_NODE_H + LAYOUT_GAP
      const sg = branchGroupOf(branchGroups, nid)
      if (sg) total += measureGroupH(sg) + LAYOUT_GAP
    }
    return Math.max(0, total - LAYOUT_GAP)
  }
  const measureGroupH = (g: FlowBranchGroup): number => g.branches.reduce((m, b) => Math.max(m, measureBranchH(b)), 0)

  // 主链左留白：分支列以 owner 中心对称展开，最宽组可能顶出左边界 → 先算需要多少额外左留白
  let needLeft = 0
  let cursor = LAYOUT_PAD_X
  visibleMain.forEach((id) => {
    const w = isTerm(id) ? LAYOUT_TERM_W : LAYOUT_NODE_W
    const g = branchGroupOf(branchGroups, id)
    if (g) {
      needLeft = Math.max(needLeft, measureGroupW(g) / 2 - (cursor + w / 2 - LAYOUT_PAD_X))
      // 与下方摆放同样的"让位"推进（只影响后续节点，不影响本 owner 的 x）
      cursor = Math.max(cursor + w + LAYOUT_GAP, cursor + w / 2 + measureGroupW(g) / 2 + LAYOUT_GAP)
    } else {
      cursor += w + LAYOUT_GAP
    }
  })
  const leftPad = Math.max(0, needLeft)

  const mainPos: Record<string, HPlacedPos> = {}
  let x = LAYOUT_PAD_X + leftPad
  visibleMain.forEach((id) => {
    const isT = isTerm(id)
    const w = isT ? LAYOUT_TERM_W : LAYOUT_NODE_W
    const h = isT ? LAYOUT_TERM_H : LAYOUT_NODE_H
    mainPos[id] = { left: x, top: axisY - h / 2, width: w, height: h }
    x += w + LAYOUT_GAP
    // 0925：owner 下方要挂分支列时，主链给它让出横向空间——下一个主链节点排到整组分支列右侧之外。
    // 这样收拢线的竖直段（走下一个节点所在的 x）不会从分支列中间穿过去，也符合"分支占一块地方"的直觉。
    const g = branchGroupOf(branchGroups, id)
    if (g) {
      const groupRight = mainPos[id].left + w / 2 + measureGroupW(g) / 2
      const need = groupRight + LAYOUT_GAP - x
      if (need > 0) x += need
    }
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

  // 主链横向连线（分叉 owner 的直线保留：横向主链在分支列上方继续向右，不穿过任何分支节点）
  const mainEdges: HEdge[] = []
  for (let i = 0; i < visibleMain.length - 1; i++) {
    const a = mainPos[visibleMain[i]]
    const b = mainPos[visibleMain[i + 1]]
    if (!a || !b) continue
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

  // ---- 分支列（0925 同画布算法）----
  const pendingConverges: Array<{ from: Pt; ref: ContRef; groupMark: number }> = []
  const groupBus = new Map<number, number>()
  const ownerContRefs: Array<{ ownerId: string; ref: ContRef }> = []
  let deepestBottom = 0

  interface PlacedColumnHead { deepest: Pt; head: Pt | null }

  const placeChain = (b: FlowBranch, colCx: number, top: number, contRef: ContRef): PlacedColumnHead => {
    let cy = top
    let deepest: Pt = { cx: colCx, y: top }
    let head: Pt | null = null
    let prev: Pt | null = null
    b.chain.forEach((nid, i) => {
      if (!configs[nid]) return
      if (nodes.some((n) => n.id === nid)) return // 同一节点已在别处摆过（旁路/重复分支）
      nodes.push({ id: nid, cfg: configs[nid], pos: { left: colCx - LAYOUT_NODE_W / 2, top: cy, width: LAYOUT_NODE_W, height: LAYOUT_NODE_H }, branch: true })
      if (!head) head = { cx: colCx, y: cy }
      if (prev) branchEdges.push({ d: `M${prev.cx} ${prev.y} L${colCx} ${cy}`, rule: false })
      const bottom = cy + LAYOUT_NODE_H
      deepest = { cx: colCx, y: bottom }
      prev = { cx: colCx, y: bottom }
      cy = bottom + LAYOUT_GAP
      // 链内再分叉：嵌套列摆在链节点正下方；本列下一个链节点在嵌套组之后
      const sg = branchGroupOf(branchGroups, nid)
      if (sg) {
        const groupTop = cy
        const groupH = measureGroupH(sg)
        const nestedRef: ContRef = b.chain[i + 1] ? { pt: { cx: colCx, y: groupTop + groupH + LAYOUT_GAP } } : contRef
        const nested = placeGroup(sg, colCx, bottom, nestedRef)
        if (nested.y > deepest.y) deepest = nested
        cy = groupTop + groupH + LAYOUT_GAP
      }
    })
    return { deepest, head }
  }

  let groupSeq = 0
  const placeGroup = (g: FlowBranchGroup, ownerCx: number, ownerBottom: number, contRef: ContRef): Pt => {
    const groupMark = ++groupSeq
    const widths = g.branches.map(measureBranchW)
    const groupW = widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * LAYOUT_COL_GAP
    const top = ownerBottom + LAYOUT_GAP
    let gx = ownerCx - groupW / 2
    let groupDeepest: Pt = { cx: ownerCx, y: ownerBottom }
    g.branches.forEach((b, i) => {
      const colCx = gx + widths[i] / 2
      gx += widths[i] + LAYOUT_COL_GAP
      const { deepest, head } = placeChain(b, colCx, top, contRef)
      if (head) pendingConverges.push({ from: deepest, ref: contRef, groupMark })
      if (deepest.y > groupDeepest.y) groupDeepest = deepest
      groupBus.set(groupMark, groupDeepest.y + LAYOUT_GAP / 2)
      // owner 底边 → 列首节点顶边（弧线；端点在两节点边缘，箭头指向列首）
      if (head) {
        // 0925：直角折线（同组各列共用分叉带中间的水平母线）
        branchEdges.push({ d: elbowVH(ownerCx, ownerBottom, colCx, head.y), rule: false })
      }
    })
    return groupDeepest
  }

  // 分支列起点：owner 底边（若该 owner 下方还挂着旁路节点，则让到旁路节点之下，避免叠在一起）
  const belowBottomOf = new Map<string, number>()
  branches.forEach((b) => {
    const pos = branchPos[b.id]
    if (!pos || b.side !== 'right') return
    belowBottomOf.set(b.rowAnchor, Math.max(belowBottomOf.get(b.rowAnchor) ?? 0, pos.top + pos.height))
  })
  visibleMain.forEach((id) => {
    const g = branchGroupOf(branchGroups, id)
    const mp = mainPos[id]
    if (!g || !mp) return
    const ownerBottom = Math.max(mp.top + mp.height, belowBottomOf.get(id) ?? 0)
    const ref: ContRef = {}
    ownerContRefs.push({ ownerId: id, ref })
    const deepest = placeGroup(g, mp.left + mp.width / 2, ownerBottom, ref)
    deepestBottom = Math.max(deepestBottom, deepest.y)
  })
  // 收拢目标：owner 在主链上的下一个节点的底边中心（分支在下方，向上收进下一个节点）
  ownerContRefs.forEach(({ ownerId, ref }) => {
    const idx = visibleMain.indexOf(ownerId)
    const nextId = visibleMain[idx + 1]
    const np = nextId ? mainPos[nextId] : undefined
    ref.pt = np ? { cx: np.left + np.width / 2, y: np.top + np.height } : null
  })
  for (const { from, ref, groupMark } of pendingConverges) {
    const to = ref.pt
    if (!to || Math.abs(to.y - from.y) <= 1) continue
    if (to.y > from.y) {
      // 向下收进本列下一个链节点：分叉带中间转弯
      branchEdges.push({ d: elbowVH(from.cx, from.y, to.cx, to.y), rule: false })
    } else {
      // 向上收进主链下一个节点：U 形，母线走在整组分支列下方（横向段不切任何分支节点）
      const busY = Math.max(groupBus.get(groupMark) ?? from.y + LAYOUT_GAP, from.y + LAYOUT_GAP / 2)
      branchEdges.push({ d: elbowU(from.cx, from.y, to.cx, to.y, busY), rule: false })
    }
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
  if (deepestBottom) maxBottom = Math.max(maxBottom, deepestBottom + LAYOUT_PAD_Y)

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
