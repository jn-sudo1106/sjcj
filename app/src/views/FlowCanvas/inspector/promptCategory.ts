import { collectorCapabilityOf, decisionOrParallelKind, isArticleSummaryNode, isArticleTagNode, isDataNode, isDataValidationNode, isMonitorNode, isRuleNode, isTranslateNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import type { PromptCategory } from '@/api'

export interface PromptCategoryOption {
  label: PromptCategory
  value: PromptCategory
}

export interface PromptCategoryGroup {
  label: string
  options: PromptCategoryOption[]
}

const COLLECTOR_OPTIONS: PromptCategoryOption[] = [
  { label: '网页抓取', value: '网页抓取' },
  { label: 'APP抓取', value: 'APP抓取' },
  { label: '文件下载', value: '文件下载' },
  { label: 'Python抓取', value: 'Python抓取' },
  { label: '浏览器抓取', value: '浏览器抓取' },
  { label: '公众号抓取', value: '公众号抓取' },
  { label: '网页登录', value: '网页登录' },
]

const DATA_PROCESS_OPTIONS: PromptCategoryOption[] = [{ label: '数据处理', value: '数据处理' }]
const LOGIC_OPTIONS: PromptCategoryOption[] = [
  { label: '决策分支', value: '决策分支' },
  { label: '分头处理', value: '分头处理' },
]
const RULE_OPTIONS: PromptCategoryOption[] = [{ label: '规则处理', value: '规则处理' }]
// 数据监控节点（monitor 复用 rule 种子，isRuleNode 也为真）：单独的提示词分类，不跟「规则处理」混用
const MONITOR_OPTIONS: PromptCategoryOption[] = [{ label: '数据监控', value: '数据监控' }]
const DATA_VALIDATION_OPTIONS: PromptCategoryOption[] = [{ label: '数据校验', value: '数据校验' }]
// 文章生成摘要（720）：提示词表里 category=rule、node_type_name=文章生成摘要（实测 2026-09-17）
const ARTICLE_SUMMARY_OPTIONS: PromptCategoryOption[] = [{ label: '文章生成摘要', value: '文章生成摘要' }]
// 翻译助手（800）：提示词表里那一行是 node_type='article_translate'、node_type_name='翻译'、category='rule'
//（2026-09-18 用户补上了 category，此前是 NULL——那会儿查模板必须不带 category，现在跟其它规则类一样带 rule）
const TRANSLATE_OPTIONS: PromptCategoryOption[] = [{ label: '翻译', value: '翻译' }]
// 文章打标签（730）：提示词行 node_type_name='文章打标签'、category='rule'（2026-09-18 读库核对）
const ARTICLE_TAG_OPTIONS: PromptCategoryOption[] = [{ label: '文章打标签', value: '文章打标签' }]
const METRIC_OPTIONS: PromptCategoryOption[] = [{ label: '指标引用', value: '指标引用' }]
const NOTIFY_OPTIONS: PromptCategoryOption[] = [
  { label: '提取数据发邮件', value: '提取数据发邮件' },
  { label: '异常告警', value: '异常告警' },
]
const OTHER_OPTIONS: PromptCategoryOption[] = [{ label: '自定义节点', value: '自定义节点' }]
const COLLECTOR_DEFAULTS: Record<string, PromptCategory> = {
  web: '网页抓取',
  app: 'APP抓取',
  file_download: '文件下载',
  python: 'Python抓取',
  browser_html: '浏览器抓取',
  wechat_official_html: '公众号抓取',
  login: '网页登录',
}

function nodeText(cfg?: NodeConfig): string {
  return `${cfg?.title ?? ''}${cfg?.sub ?? ''}`
}

function dataProcessLike(cfg?: NodeConfig): boolean {
  if (!cfg || collectorCapabilityOf(cfg) || isRuleNode(cfg) || (cfg && decisionOrParallelKind(cfg))) return false
  if (!isDataNode(cfg)) return false
  const text = nodeText(cfg)
  return /数据处理|解析|清洗|校验|去重|结构化|AI提取|OCR|字段映射|提取单值|提取表格/.test(text)
}

function metricLike(cfg?: NodeConfig): boolean {
  return /指标/.test(nodeText(cfg))
}

function notifyLike(cfg?: NodeConfig): boolean {
  return /邮件|告警/.test(nodeText(cfg))
}

export function promptCategoryGroupsForNode(cfg?: NodeConfig): PromptCategoryGroup[] {
  if (cfg && collectorCapabilityOf(cfg)) {
    return [{ label: '采集类', options: COLLECTOR_OPTIONS }]
  }
  // 先判 monitor 再判 rule：monitor 复用 rule 种子（isRuleNode 为真），须在规则分支之前截住，否则会落到「规则处理」
  if (isMonitorNode(cfg)) return [{ label: '规则类', options: MONITOR_OPTIONS }]
  if (isDataValidationNode(cfg)) return [{ label: '规则类', options: DATA_VALIDATION_OPTIONS }]
  if (isRuleNode(cfg)) return [{ label: '规则类', options: RULE_OPTIONS }]
  // 文章生成摘要：提示词表里是独立一档（category=rule + node_type_name=文章生成摘要），
  // 必须在 dataProcessLike() 之前判——否则会落到'数据处理/自定义节点'，取不到模板
  if (isArticleSummaryNode(cfg)) return [{ label: '数据处理', options: ARTICLE_SUMMARY_OPTIONS }]
  if (isTranslateNode(cfg)) return [{ label: '数据处理', options: TRANSLATE_OPTIONS }]
  if (isArticleTagNode(cfg)) return [{ label: '数据处理', options: ARTICLE_TAG_OPTIONS }]
  const logicKind = cfg ? decisionOrParallelKind(cfg) : undefined
  if (logicKind) {
    return [{ label: '逻辑', options: LOGIC_OPTIONS.filter((item) => (logicKind === 'decision' ? item.value === '决策分支' : item.value === '分头处理')) }]
  }
  if (dataProcessLike(cfg)) return [{ label: '数据处理', options: DATA_PROCESS_OPTIONS }]
  if (metricLike(cfg)) return [{ label: '引用类', options: METRIC_OPTIONS }]
  if (notifyLike(cfg)) return [{ label: '通知类', options: NOTIFY_OPTIONS }]
  return [{ label: '其他', options: OTHER_OPTIONS }]
}

export function defaultPromptCategoryForNode(cfg?: NodeConfig): PromptCategory {
  const cap = cfg ? collectorCapabilityOf(cfg) : undefined
  if (cap) return COLLECTOR_DEFAULTS[cap.kind] ?? '网页抓取'
  const logicKind = cfg ? decisionOrParallelKind(cfg) : undefined
  if (logicKind === 'decision') return '决策分支'
  if (logicKind === 'parallel') return '分头处理'
  if (isMonitorNode(cfg)) return '数据监控'
  if (isDataValidationNode(cfg)) return '数据校验'
  if (isArticleSummaryNode(cfg)) return '文章生成摘要'
  if (isTranslateNode(cfg)) return '翻译'
  if (isArticleTagNode(cfg)) return '文章打标签'
  if (isRuleNode(cfg)) return '规则处理'
  return promptCategoryGroupsForNode(cfg)[0]?.options[0]?.value ?? '自定义节点'
}

export function resolvePromptCategoryForNode(cfg?: NodeConfig, value?: PromptCategory): PromptCategory {
  const options = promptCategoryGroupsForNode(cfg).flatMap((group) => group.options)
  return options.some((option) => option.value === value) ? value! : defaultPromptCategoryForNode(cfg)
}

export function promptListCategoryForNode(cfg?: NodeConfig): string {
  if (cfg && collectorCapabilityOf(cfg)) return 'collect'
  if (isRuleNode(cfg)) return 'rule'
  // 文章生成摘要的模板行落在 category=rule（后端实测），不是 data_process
  if (isArticleSummaryNode(cfg)) return 'rule'
  // 翻译助手 / 文章打标签的模板行都在 category='rule' 下（与规则处理、数据监控、文章摘要同一档）
  if (isTranslateNode(cfg)) return 'rule'
  if (isArticleTagNode(cfg)) return 'rule'
  const logicKind = cfg ? decisionOrParallelKind(cfg) : undefined
  if (logicKind) return 'logic'
  if (dataProcessLike(cfg)) return 'data_process'
  if (metricLike(cfg)) return 'reference'
  if (notifyLike(cfg)) return 'notify'
  return 'other'
}
