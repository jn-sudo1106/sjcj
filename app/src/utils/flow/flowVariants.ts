// 流程变体与模板推荐（1105 会议：流程中心按「流程模板 → 变体」两级归类；
// 1106 §4.2/§4.3：结构变体内部再按配置签名拆「配置组」，比较口径带算法版本）。
//
// 后端还没有流程指纹，这里先在前端算：同一模板下的流程，按步骤的节点类型序列和上下游关系
// 分组，结构完全一致的算同一个结构变体；结构变体内部再按对齐后的步骤配置（输入 / 输出表 +
// 脚本、规则类字段）分配置组。变体之间按节点类型序列做最长公共子序列比对，标出多了 / 少了
// 哪些节点。两个流程之间的配置差异按对齐后的步骤逐字段比。
//
// §4.3 一期边界：只比较已归入同一模板、结构完整可对齐的流程；节点对齐全靠照片段类型序列，
// 不实现通用图同构；配置签名命中后本来就是规范化内容比较，不拿哈希摘要直接判等 / 合并。
// 后端以后返回流程指纹时，flowFingerprint 会自动优先用它（见下方注释），分组和比对逻辑不变。
import type { FlowDefinition, Step } from '@/api'
import { SOURCE_TYPE_NAME_BY_ID } from '@/views/FlowCanvas/canvas/flowModel'

/** 数据监控节点复用规则处理的类型编号，回读时只能靠名字认（同 flowModel.seeds 的 templateKeyForStep） */
const MONITOR_CODE = '610'

/**
 * 流程变体 / 配置组算法版本（1106 §4.3「比较口径带算法版本」）。
 * 结构指纹、配置签名或差异摘要的口径一变就 +1：缓存 key 里带版本号，升级后旧结果自然失效，
 * 不需要另做一次「清缓存」。
 */
export const VARIANT_ALGORITHM_VERSION = 2

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

/**
 * 配置组签名只看执行配置：输入 / 输出表 + 脚本、规则类字段（1106 §4.2「步骤用什么配置」）。
 * 节点名称是显示属性、启用态属于结构口径（§4.3 结构比较含启停属性），都不进配置签名，
 * 避免「只改了节点名 / 临时停用」就把同一份配置拆成两组；启用的差异仍在流程对比里能看到。
 *
 * 暂不纳入（§4.3 二阶段「引用签名 / 字段映射」待后端配置摘要字段就绪）：
 * paramBindings（参数绑定 / 字段映射）和 configId 引用身份。只在前端按当前步骤字段比，
 * 避免出现「签名判成不同配置组、差异摘要却为空」的口径不一致；后端补引用签名后在这里加。
 */
const CONFIG_SIGNATURE_FIELDS = COMPARE_FIELDS.filter(({ key }) => key !== 'name' && key !== 'enabled')
/** 表差异单独汇总成「输出表不同」，这里只列其余脚本字段 */
const SCRIPT_FIELD_LABELS = CONFIG_SIGNATURE_FIELDS
  .filter(({ key }) => key !== 'inputTable' && key !== 'outputTable')
  .map(({ label }) => label)

/** 字段分隔用 Unit Separator、步骤之间用 Record Separator，避免和配置正文里的可见字符冲突 */
const FIELD_SEP = '\u001f'
const STEP_SEP = '\u001e'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return configValueToken(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/**
 * 字段值规范化为带类型的 token。必须区分「字段不存在」（undefined：后端没回这个键）
 * 与「空值」（null / 空串）：§4.3 明确要求 null、空串、未配置按适配后的真实语义处理，
 * 不能一律合并。对象键排序；规则执行顺序、分支顺序和字段映射顺序原样保留（只有契约声明为
 * 集合的数组才排序，这里不排序任何数组）。
 */
function configValueToken(value: unknown): string {
  if (value === undefined) return 'absent'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') return stableStringify(value)
  return String(value)
}

/**
 * 配置签名：alignByCode 对齐后的步骤配置逐字段规范化。
 * 结构组内所有流程的 codes 相同，拓扑序即对齐结果；传入 referenceCodes 时按变体骨架对齐，
 * 同结构但步骤顺序 / 残缺的流程也能落到同一位置比较，对不上的位置记 missing / added，
 * 不会把节点配置错位当成差异。
 */
export function configSignature(steps: Step[], referenceCodes?: string[]): string {
  const ordered = orderSteps(steps)
  const codes = referenceCodes ?? flowShape(ordered).codes
  const ops = alignByCode(
    codes.map((code, i) => ({ code, i })),
    ordered.map((step) => ({ code: stepTypeCode(step), step })),
    (x) => x.code,
    (x) => x.code,
  )
  return ops.map((op) => {
    if (op.op === 'missing') return `missing:${op.a.code}`
    if (op.op === 'added') return `added:${stepTypeCode(op.b.step)}`
    return CONFIG_SIGNATURE_FIELDS.map(({ key }) => `${key}=${configValueToken(op.b.step[key])}`).join(FIELD_SEP)
  }).join(STEP_SEP)
}

/** 配置组之间的差异摘要（相对同结构下流程最多的第一个配置组） */
export interface ConfigDifference {
  /** 差异维度：输入表 / 输出表 / 脚本类字段 */
  kind: 'inputTable' | 'outputTable' | 'script'
  /** 如「输出表不同」「节点「规则处理」脚本字段不同」 */
  label: string
  /** 如「tb_a / tb_b」；脚本差异为具体字段和值 */
  detail: string
}

export interface ConfigGroup<T> {
  /** 展示编号 A1 / A2（结构变体字母 + 组序号），组内流程多者靠前 */
  id: string
  /** 规范化配置签名：相同即配置等价；不同即拆组（签名本身就是规范化内容，不是哈希索引） */
  signature: string
  /** 组内流程（抽屉里 T 是 Analyzed：带 flow / steps / shape） */
  flows: T[]
  /** 组内出现过的输入表（去重，保持首次出现顺序） */
  inputTables: string[]
  /** 组内出现过的输出表（去重，保持首次出现顺序） */
  outputTables: string[]
  /** 与同结构下第一个配置组的差异；首组为空 */
  differences: ConfigDifference[]
  /** 有配置差异的步骤数（含结构对不上的步骤），仅供摘要提示 */
  diffCount: number
}

export interface FlowVariant<T> {
  /** A、B、C…，按流程数从多到少 */
  letter: string
  key: string
  codes: string[]
  parents: number[]
  items: T[]
  /** 结构变体内部的配置组；只有调用方传了 stepsOf 才计算，未传时为空数组 */
  configGroups: ConfigGroup<T>[]
}

export interface GroupVariantsOptions<T> {
  /** 取流程步骤：传了才会在结构变体内部再按配置签名拆配置组 */
  stepsOf?: (item: T) => Step[]
}

export function groupVariants<T>(items: T[], shapeOf: (item: T) => FlowShape, options: GroupVariantsOptions<T> = {}): FlowVariant<T>[] {
  const byKey = new Map<string, FlowVariant<T>>()
  for (const item of items) {
    const shape = shapeOf(item)
    const variant = byKey.get(shape.key)
    if (variant) variant.items.push(item)
    else byKey.set(shape.key, { letter: '', key: shape.key, codes: shape.codes, parents: shape.parents, items: [item], configGroups: [] })
  }
  const variants = [...byKey.values()]
    .sort((a, b) => b.items.length - a.items.length || a.codes.length - b.codes.length)
  variants.forEach((variant, i) => {
    variant.letter = variantLetter(i)
    variant.configGroups = options.stepsOf ? groupConfigGroups(variant, options.stepsOf) : []
  })
  return variants
}

function variantLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`
}

interface ConfigTables { inputTables: string[]; outputTables: string[] }

function collectTables<T>(flows: T[], stepsOf: (item: T) => Step[]): ConfigTables {
  const inputTables: string[] = []
  const outputTables: string[] = []
  for (const item of flows) {
    for (const step of stepsOf(item)) {
      const input = step.inputTable?.trim()
      if (input && !inputTables.includes(input)) inputTables.push(input)
      const output = step.outputTable?.trim()
      if (output && !outputTables.includes(output)) outputTables.push(output)
    }
  }
  return { inputTables, outputTables }
}

function sameTables(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((table, i) => table === sortedB[i])
}

/** 「a / b」形式的差异值；空列表用「—」，避免把「没有表」显示成空白 */
function tablePair(base: string[], current: string[]): string {
  return `${base.join('、') || '—'} / ${current.join('、') || '—'}`
}

interface ConfigDiffResult { differences: ConfigDifference[]; diffCount: number }

function describeConfigDifference<T>(
  base: T,
  baseTables: ConfigTables,
  current: T,
  currentTables: ConfigTables,
  stepsOf: (item: T) => Step[],
): ConfigDiffResult {
  const differences: ConfigDifference[] = []
  if (!sameTables(baseTables.inputTables, currentTables.inputTables)) {
    differences.push({ kind: 'inputTable', label: '输入表不同', detail: tablePair(baseTables.inputTables, currentTables.inputTables) })
  }
  if (!sameTables(baseTables.outputTables, currentTables.outputTables)) {
    differences.push({ kind: 'outputTable', label: '输出表不同', detail: tablePair(baseTables.outputTables, currentTables.outputTables) })
  }
  const rows = compareFlows(stepsOf(base), stepsOf(current))
  const diffRows = rows.filter((row) => row.op !== 'same' || row.diffs.length)
  for (const row of diffRows) {
    const scriptDiffs = row.diffs.filter((diff) => SCRIPT_FIELD_LABELS.includes(diff.label))
    if (!scriptDiffs.length) continue
    const name = row.a?.name || row.b?.name || row.typeLabel
    differences.push({
      kind: 'script',
      label: `节点「${name}」脚本字段不同`,
      detail: scriptDiffs.map((diff) => `${diff.label}：${diff.a} / ${diff.b}`).join('；'),
    })
  }
  return { differences, diffCount: diffRows.length }
}

function groupConfigGroups<T>(variant: FlowVariant<T>, stepsOf: (item: T) => Step[]): ConfigGroup<T>[] {
  interface Bucket { signature: string; flows: T[] }
  const buckets: Bucket[] = []
  const bySignature = new Map<string, Bucket>()
  for (const item of variant.items) {
    const signature = configSignature(stepsOf(item), variant.codes)
    const bucket = bySignature.get(signature)
    if (bucket) bucket.flows.push(item)
    else {
      const created = { signature, flows: [item] }
      bySignature.set(signature, created)
      buckets.push(created)
    }
  }
  const ordered = [...buckets].sort((a, b) => b.flows.length - a.flows.length)
  const baseFlows = ordered[0]?.flows ?? []
  const baseTables = collectTables(baseFlows, stepsOf)
  return ordered.map((bucket, i) => {
    const tables = collectTables(bucket.flows, stepsOf)
    const diff = i === 0 || !baseFlows.length
      ? { differences: [], diffCount: 0 }
      : describeConfigDifference(baseFlows[0]!, baseTables, bucket.flows[0]!, tables, stepsOf)
    return {
      id: `${variant.letter}${i + 1}`,
      signature: bucket.signature,
      flows: bucket.flows,
      inputTables: tables.inputTables,
      outputTables: tables.outputTables,
      differences: diff.differences,
      diffCount: diff.diffCount,
    }
  })
}

// ---- 算法版本缓存（1106 §4.3：不能首屏逐流程全量现拉、不能无限缓存） ----

/** 参与指纹的流程字段：FlowRecord 上可能没有 fingerprint / updateDt，后端就绪后补 */
export interface FlowFingerprintInput {
  id: string
  /** 后端流程内容指纹（1106 §4.3 的后端依赖）。字段不存在时退回本地口径，存在时优先。 */
  fingerprint?: string | null
  /** 列表接口的更新时间（FlowRecord.updatedAt） */
  updatedAt?: string | null
  /** 旧平台 / 后端 DTO 的更新时间字段名，两个都看，避免只认一种拼出恒等指纹 */
  updateDt?: string | null
  /** 流程版本号（后端有就参与指纹） */
  version?: number | string | null
}

/**
 * 一组流程的内容指纹：流程 id + 各自更新时间 / 版本号。
 *
 * 1106 §4.3 要求「后端批处理或按模板延迟计算、比较口径带算法版本、发布/配置变更后失效重算」。
 * 后端流程指纹（contentHash 类字段）尚未返回，先由前端按列表接口已有字段拼一个；后端补上
 * `fingerprint` 后这里自动优先用后端的（一个流程一个指纹，拼起来仍是集合指纹），调用方不用改。
 */
export function flowFingerprint(flows: FlowFingerprintInput[]): string {
  return flows
    .map((flow) => {
      if (flow.fingerprint) return `${flow.id}:fp:${flow.fingerprint}`
      const stamp = flow.updateDt ?? flow.updatedAt ?? ''
      return `${flow.id}:${stamp}:${flow.version ?? ''}`
    })
    .join('|')
}

/** 变体分析缓存 key = 模板 / 组 id + 算法版本 + 流程集合指纹（算法或流程变化后必须失效） */
export function variantCacheKey(groupId: string, flows: FlowFingerprintInput[]): string {
  return `${groupId}::v${VARIANT_ALGORITHM_VERSION}::${flowFingerprint(flows)}`
}

/** 缓存条目存活上限：流程发布 / 配置变更可能没来得及带出更新时间，给个兜底，不做无限缓存 */
export const VARIANT_CACHE_TTL_MS = 5 * 60 * 1000
/** 最多缓存几个组结果（超了按最久未写入淘汰），避免切换模板时无限增长 */
export const VARIANT_CACHE_MAX = 8

interface VariantCacheEntry { at: number; value: unknown }
const variantCache = new Map<string, VariantCacheEntry>()

export function readVariantCache<T>(key: string): T | undefined {
  const hit = variantCache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > VARIANT_CACHE_TTL_MS) {
    variantCache.delete(key)
    return undefined
  }
  return hit.value as T
}

export function writeVariantCache<T>(key: string, value: T): void {
  const now = Date.now()
  for (const [cached, entry] of [...variantCache]) {
    if (now - entry.at > VARIANT_CACHE_TTL_MS) variantCache.delete(cached)
  }
  variantCache.delete(key)
  variantCache.set(key, { at: now, value })
  while (variantCache.size > VARIANT_CACHE_MAX) {
    const oldest = variantCache.keys().next().value
    if (oldest === undefined) break
    variantCache.delete(oldest)
  }
}

/** 归类成功后主动失效缓存（传 groupId 只清该组，不传清全部）；TTL / 算法版本之外的最后一道 */
export function invalidateVariantCache(groupId?: string): void {
  if (groupId === undefined) {
    variantCache.clear()
    return
  }
  for (const key of [...variantCache.keys()]) {
    if (key.startsWith(`${groupId}::`)) variantCache.delete(key)
  }
}

/** 仅供测试：重置内存缓存 */
export function clearVariantCache(): void {
  variantCache.clear()
}

// ---- 相似度与模板推荐 ----

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