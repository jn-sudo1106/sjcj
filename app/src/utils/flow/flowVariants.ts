// 流程变体与模板推荐（1105 会议：流程中心按「流程模板 → 变体」两级归类）。
//
// 后端还没有流程指纹，这里先在前端算：同一模板下的流程，按步骤的节点类型序列和上下游关系
// 分组，结构完全一致的算同一个变体；变体之间按节点类型序列做最长公共子序列比对，标出多了 /
// 少了哪些节点。两个流程之间的配置差异按对齐后的步骤逐字段比。
// 后端以后返回指纹时，只需把 flowShape 换成读字段，分组和比对逻辑不变。
import type { FlowDefinition, Step } from '@/api'
import { SOURCE_TYPE_NAME_BY_ID } from '@/views/FlowCanvas/canvas/flowModel'

/** 数据监控节点复用规则处理的类型编号，回读时只能靠名字认（同 flowModel.seeds 的 templateKeyForStep） */
const MONITOR_CODE = '610'

export function stepTypeCode(step: Step): string {
  if (/数据监控/.test(step.name || '')) return MONITOR_CODE
  return String(step.configType || step.stepType || step.nodeType || '').trim() || '?'
}

export function typeLabel(code: string): string {
  return SOURCE_TYPE_NAME_BY_ID[code] ?? (code === '?' ? '未知类型' : `类型 ${code}`)
}

/** 按上下游拓扑排序；同层保持接口原顺序。环或悬空依赖的步骤按原顺序补在后面，不丢节点 */
export function orderSteps(steps: Step[]): Step[] {
  const ids = new Set(steps.map((step) => step.stepId))
  const placed = new Set<string>()
  const ordered: Step[] = []
  let progressed = true
  while (ordered.length < steps.length && progressed) {
    progressed = false
    for (const step of steps) {
      if (placed.has(step.stepId)) continue
      const parents = (step.dependsOn ?? []).filter((id) => ids.has(id) && id !== step.stepId)
      if (parents.every((id) => placed.has(id))) {
        ordered.push(step)
        placed.add(step.stepId)
        progressed = true
      }
    }
  }
  return [...ordered, ...steps.filter((step) => !placed.has(step.stepId))]
}

export interface FlowShape {
  /** 拓扑序下每个步骤的类型编号 */
  codes: string[]
  /** 每个步骤的上游在拓扑序里的下标，-1 = 没有上游 */
  parents: number[]
  /** 结构指纹：类型序列 + 上下游关系完全相同的流程指纹相同 */
  key: string
  steps: Step[]
}

export function flowShape(steps: Step[]): FlowShape {
  const ordered = orderSteps(steps)
  const index = new Map(ordered.map((step, i) => [step.stepId, i]))
  const codes = ordered.map(stepTypeCode)
  const parents = ordered.map((step) => {
    const parent = (step.dependsOn ?? []).map((id) => index.get(id)).find((i) => i !== undefined)
    return parent ?? -1
  })
  return { codes, parents, key: `${codes.join('>')}#${parents.join(',')}`, steps: ordered }
}

/** 有分支（某步骤的上游不是紧挨着的前一个）时，链式展示要说明它挂在谁后面 */
export function shapeLabels(shape: Pick<FlowShape, 'codes' | 'parents'>): string[] {
  return shape.codes.map((code, i) => {
    const parent = shape.parents[i] ?? -1
    const branch = i > 0 && parent !== i - 1 && parent >= 0 ? `（接第 ${parent + 1} 个）` : ''
    return `${typeLabel(code)}${branch}`
  })
}

export interface FlowVariant<T> {
  /** A、B、C…，按流程数从多到少 */
  letter: string
  key: string
  codes: string[]
  parents: number[]
  items: T[]
}

export function groupVariants<T>(items: T[], shapeOf: (item: T) => FlowShape): FlowVariant<T>[] {
  const byKey = new Map<string, FlowVariant<T>>()
  for (const item of items) {
    const shape = shapeOf(item)
    const variant = byKey.get(shape.key)
    if (variant) variant.items.push(item)
    else byKey.set(shape.key, { letter: '', key: shape.key, codes: shape.codes, parents: shape.parents, items: [item] })
  }
  return [...byKey.values()]
    .sort((a, b) => b.items.length - a.items.length || a.codes.length - b.codes.length)
    .map((variant, i) => ({ ...variant, letter: variantLetter(i) }))
}

function variantLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`
}

/** 最长公共子序列的对齐结果：base 里有、target 没有 = missing；target 多出来的 = added */
export type AlignOp<A, B> = { op: 'same'; a: A; b: B } | { op: 'missing'; a: A } | { op: 'added'; b: B }

export function alignByCode<A, B>(base: A[], target: B[], codeA: (a: A) => string, codeB: (b: B) => string): AlignOp<A, B>[] {
  const n = base.length, m = target.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = codeA(base[i]!) === codeB(target[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const ops: AlignOp<A, B>[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (codeA(base[i]!) === codeB(target[j]!)) { ops.push({ op: 'same', a: base[i]!, b: target[j]! }); i++; j++ }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ op: 'missing', a: base[i]! }); i++ }
    else { ops.push({ op: 'added', b: target[j]! }); j++ }
  }
  while (i < n) ops.push({ op: 'missing', a: base[i++]! })
  while (j < m) ops.push({ op: 'added', b: target[j++]! })
  return ops
}

/** 结构相似度 0~1：2 × 公共节点数 /（两边节点数之和） */
export function shapeSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1
  const same = alignByCode(a, b, (x) => x, (x) => x).filter((op) => op.op === 'same').length
  return (2 * same) / (a.length + b.length)
}

/** 低于这个相似度不推荐，宁可留在未归类让人手动判断 */
export const RECOMMEND_THRESHOLD = 0.6

export interface TemplateShape { id: string; name: string; codes: string[] }
export interface TemplateRecommendation { id: string; name: string; score: number }

export function recommendTemplate(codes: string[], templates: TemplateShape[]): TemplateRecommendation | undefined {
  let best: TemplateRecommendation | undefined
  for (const template of templates) {
    const score = shapeSimilarity(normalizeCollectCodes(codes), normalizeCollectCodes(template.codes))
    if (!best || score > best.score) best = { id: template.id, name: template.name, score }
  }
  return best && best.score >= RECOMMEND_THRESHOLD ? best : undefined
}

/** 结构模板的节点类型序列：画布顺序去掉开始 / 结束两个端点 */
export function templateCodes(definition: FlowDefinition): string[] {
  return definition.main
    .filter((id) => id !== 'start' && id !== 'end')
    .map((id) => String(definition.configs[id]?.configType ?? '').trim() || '?')
}

/** 模板只区分「网页抓取」不区分列表 / 详情，801（网页抓取CS）也按网页抓取比 */
function normalizeCollectCodes(codes: string[]): string[] {
  return codes.map((code) => (code === '801' ? '90' : code))
}

/** 两个流程逐步骤比对时看的字段：拓扑、表、执行规则和配置里的关键项 */
const COMPARE_FIELDS: { key: keyof Step; label: string }[] = [
  { key: 'name', label: '节点名称' },
  { key: 'inputTable', label: '输入表' },
  { key: 'outputTable', label: '输出表' },
  { key: 'url', label: '任务 URL 规则' },
  { key: 'condition', label: '执行条件' },
  { key: 'failAction', label: '失败动作' },
  { key: 'topic', label: '队列' },
  { key: 'enabled', label: '启用' },
  { key: 'runPolicy', label: '运行策略' },
  { key: 'dedupType', label: '去重方式' },
  { key: 'codeRule', label: '代码规则' },
  { key: 'contentRule', label: '内容规则' },
  { key: 'coreParam', label: '核心参数' },
]

function fieldText(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

export interface StepFieldDiff { label: string; a: string; b: string }
export interface StepCompareRow {
  op: 'same' | 'missing' | 'added'
  typeLabel: string
  a?: Step
  b?: Step
  /** 只列有差异的字段；结构上对不上的步骤（missing / added）不比字段 */
  diffs: StepFieldDiff[]
}

export function compareFlows(aSteps: Step[], bSteps: Step[]): StepCompareRow[] {
  const ops = alignByCode(orderSteps(aSteps), orderSteps(bSteps), stepTypeCode, stepTypeCode)
  return ops.map((op) => {
    if (op.op === 'missing') return { op: op.op, typeLabel: typeLabel(stepTypeCode(op.a)), a: op.a, diffs: [] }
    if (op.op === 'added') return { op: op.op, typeLabel: typeLabel(stepTypeCode(op.b)), b: op.b, diffs: [] }
    const diffs = COMPARE_FIELDS
      .map(({ key, label }) => ({ label, a: fieldText(op.a[key]), b: fieldText(op.b[key]) }))
      .filter((diff) => diff.a !== diff.b)
    return { op: op.op, typeLabel: typeLabel(stepTypeCode(op.a)), a: op.a, b: op.b, diffs }
  })
}
