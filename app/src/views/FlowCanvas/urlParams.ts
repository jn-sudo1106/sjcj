// URL 参数纯函数（0711 R9）：源 URL 里的 $PARAM$_id 占位符——id 直接写在 token 里，
// "绑定"不是"选择要用哪个参数"，而是根据 token 里已经写死的 id 去查参数定义是否存在。
// 例：https://www.dongchedi.com/usedcar/...#price=$PARAM$_1035&series_type=$PARAM$_1036

/**
 * 匹配 token 用的正则；调用方按需自建实例，不共享 /g 状态（避免 lastIndex 踩坑）。
 * id 字符类故意不含 `-`（0721 会议·参数源发现的真实 bug）：本功能默认拼接符就是 `-`，
 * 若 id 允许含 `-` 会被贪婪匹配把相邻的拼接符也吞进 id 里（如 "$PARAM$_913-$PARAM$_912"
 * 会把 "913-" 当成 id），导致 UrlParamEditor 对着已绑定的参数误报"尚未绑定"。
 * 本系统 $PARAM$_id 的 id 沿用旧平台 paramId 编号体系，实际只会是数字/字母/下划线。
 */
const TOKEN_PATTERN = '\\$PARAM\\$_([A-Za-z0-9_]+)'

/** 从 URL 中解析出全部 $PARAM$_id 占位符引用的参数 id，去重、保留首次出现顺序 */
export function extractUrlParamIds(url: string): string[] {
  if (!url) return []
  const matches = [...url.matchAll(new RegExp(TOKEN_PATTERN, 'g'))]
  const seen = new Set<string>()
  const ids: string[] = []
  for (const m of matches) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      ids.push(m[1])
    }
  }
  return ids
}

/** URL 的 #fragment 部分里是否含 $PARAM$ 占位符——fragment 是浏览器端概念，普通服务端网页抓取（HTTP 请求）看不到它，
 *  只有真正渲染页面的浏览器抓取节点能读到 location.hash，故这类 URL 只能用浏览器抓取。 */
export function hasFragmentParams(url: string): boolean {
  const hashIdx = url.indexOf('#')
  if (hashIdx < 0) return false
  return new RegExp(TOKEN_PATTERN).test(url.slice(hashIdx))
}

export interface UrlExpansionResult {
  urls: string[]
  total: number
  errors: string[]
  truncated: boolean
}

export const URL_EXPANSION_LIMIT = 1000

/**
 * 按参数取值展开 URL 模板为具体 URL 列表（笛卡尔积）。
 * valuesByParam：参数 id → 候选取值列表（通常来自 paramApi.genValues，也可以是用户为该子源选定的单值 [value]）。
 * 任一参数缺少取值直接判失败（errors 非空时 urls 为空，调用方应阻断试跑/保存）。
 * 组合数超过 limit 时截断，truncated=true。
 */
export function expandParameterizedUrl(url: string, valuesByParam: Record<string, string[]>, limit = URL_EXPANSION_LIMIT): UrlExpansionResult {
  const ids = extractUrlParamIds(url)
  if (!ids.length) return { urls: url ? [url] : [], total: url ? 1 : 0, errors: [], truncated: false }

  const errors: string[] = []
  const valueLists = ids.map((id) => {
    const vals = valuesByParam[id]
    if (!vals || !vals.length) errors.push(`参数 ${id} 缺少可用取值`)
    return vals ?? []
  })
  if (errors.length) return { urls: [], total: 0, errors, truncated: false }

  let combos: string[][] = [[]]
  let truncated = false
  for (const vals of valueLists) {
    const next: string[][] = []
    outer: for (const combo of combos) {
      for (const v of vals) {
        if (next.length >= limit) {
          truncated = true
          break outer
        }
        next.push([...combo, v])
      }
    }
    combos = next
    if (truncated) break
  }

  const urls = combos.map((combo) => {
    let result = url
    ids.forEach((id, i) => {
      result = result.replace(new RegExp(`\\$PARAM\\$_${id}\\b`, 'g'), encodeURIComponent(combo[i]))
    })
    return result
  })
  return { urls, total: urls.length, errors: [], truncated }
}

// ==================== 分组感知展开（0721 会议·参数源）====================
// 与上面的 expandParameterizedUrl 并存：后者是节点级"单值覆盖"场景的纯笛卡尔积；
// 这里服务加源弹窗的"参数源"——按分组推导拼接规则：同组=顺序拼（对齐取值），
// 不同组/无组=组间笛卡尔积。分组是"这次绑到这个源"的用法属性，不读 Param.group。

export interface ParamGroupRef {
  paramId: string
  group?: string | null
}

/** 拼接类型：全部无组、或每组仅 1 个成员（退化）视为纯笛卡尔积；单组覆盖全部参数视为纯顺序拼；混合分组两者兼有 */
export type JoinType = 'cartesian' | 'zip' | 'grouped'

interface ParamFactor {
  paramIds: string[]
  count: number
}

/** 每个分组一个因子（组内按 max 取值数对齐）+ 每个无组参数各一个因子；因子间做笛卡尔积 */
function groupFactors(refs: ParamGroupRef[], countOf: Record<string, number>): ParamFactor[] {
  const groups = new Map<string, string[]>()
  const factors: ParamFactor[] = []
  for (const ref of refs) {
    if (!ref.group) {
      factors.push({ paramIds: [ref.paramId], count: countOf[ref.paramId] ?? 0 })
      continue
    }
    if (!groups.has(ref.group)) groups.set(ref.group, [])
    groups.get(ref.group)!.push(ref.paramId)
  }
  for (const group of [...groups.keys()].sort()) {
    const paramIds = groups.get(group)!
    factors.push({ paramIds, count: Math.max(...paramIds.map((id) => countOf[id] ?? 0)) })
  }
  return factors
}

export function joinType(refs: ParamGroupRef[]): JoinType {
  if (!refs.length) return 'cartesian'
  const groupSizes = new Map<string, number>()
  for (const ref of refs) if (ref.group) groupSizes.set(ref.group, (groupSizes.get(ref.group) ?? 0) + 1)
  const hasMultiMemberGroup = [...groupSizes.values()].some((size) => size >= 2)
  if (!hasMultiMemberGroup) return 'cartesian'
  const groupedRefCount = refs.filter((ref) => ref.group).length
  if (groupSizes.size === 1 && groupedRefCount === refs.length) return 'zip'
  return 'grouped'
}

export function countGroupedUrls(refs: ParamGroupRef[], countOf: Record<string, number>): number {
  if (!refs.length) return 0
  return groupFactors(refs, countOf).reduce((total, factor) => total * factor.count, 1)
}

/** 同组参数取值数不一致时报警（计数按 §六-4 口径暂取组内最大值对齐展示） */
export function groupMismatchWarnings(refs: ParamGroupRef[], countOf: Record<string, number>): { group: string; paramIds: string[] }[] {
  const groups = new Map<string, ParamGroupRef[]>()
  for (const ref of refs) {
    if (!ref.group) continue
    if (!groups.has(ref.group)) groups.set(ref.group, [])
    groups.get(ref.group)!.push(ref)
  }
  const warnings: { group: string; paramIds: string[] }[] = []
  for (const [group, items] of groups) {
    if (items.length < 2) continue
    if (new Set(items.map((ref) => countOf[ref.paramId] ?? 0)).size > 1) {
      warnings.push({ group, paramIds: items.map((ref) => ref.paramId) })
    }
  }
  return warnings
}

/**
 * 按已知 id 逐个做 \b 边界替换（同 expandParameterizedUrl 的既有写法），而不是用通配符捕获组通吃：
 * TOKEN_PATTERN 的 id 字符类包含 `-`，若用它整体匹配再查表，遇到默认拼接符 `-` 会被贪婪吞进 id 里
 * （如 "$PARAM$_913-$PARAM$_912" 会把 "913-" 当成 id，而不是 "913"），逐 id 替换从根上避开这个坑。
 * 值先 encodeURIComponent 再作为替换串传入（非函数形式），$ 已被转义不会触发 JS replace 特殊语法；
 * combo 里没有的 id（模板里多出的未知占位符）原样保留。
 */
function renderGroupedUrl(template: string, combo: Record<string, string>): string {
  let result = template
  for (const id of Object.keys(combo)) {
    result = result.replace(new RegExp(`\\$PARAM\\$_${id}\\b`, 'g'), encodeURIComponent(combo[id]))
  }
  return result
}

/** 因子按声明顺序进位，第一个因子变化最快（笛卡尔积：1-a、2-a、3-a…；顺序拼：对齐取值 1-a、2-b…） */
function enumerateGroupedCombos(refs: ParamGroupRef[], valuesByParam: Record<string, string[]>, limit: number) {
  const countOf: Record<string, number> = {}
  for (const ref of refs) countOf[ref.paramId] = (valuesByParam[ref.paramId] ?? []).length
  const factors = groupFactors(refs, countOf)
  const fullTotal = factors.reduce((acc, factor) => acc * factor.count, 1)
  const truncated = fullTotal > limit
  const n = Math.min(fullTotal, limit)
  const idx = factors.map(() => 0)
  const combos: Record<string, string>[] = []
  for (let c = 0; c < n; c++) {
    const combo: Record<string, string> = {}
    factors.forEach((factor, fi) => {
      factor.paramIds.forEach((paramId) => { combo[paramId] = (valuesByParam[paramId] ?? [])[idx[fi]] ?? '' })
    })
    combos.push(combo)
    for (let fi = 0; fi < factors.length; fi++) {
      idx[fi]++
      if (idx[fi] < factors[fi].count) break
      idx[fi] = 0
    }
  }
  return { combos, truncated }
}

/** 拼接后预览用：取前 limit 条组合（不做取值缺失校验，供实时预览） */
export function firstGroupedCombos(refs: ParamGroupRef[], valuesByParam: Record<string, string[]>, limit: number): Record<string, string>[] {
  if (!refs.length) return []
  return enumerateGroupedCombos(refs, valuesByParam, limit).combos
}

export type GroupedExpansionResult = UrlExpansionResult

/** 按分组推导的组合展开：同组顺序拼、跨组笛卡尔积；任一参数缺取值直接判失败（同 expandParameterizedUrl 口径） */
export function expandGroupedParameterizedUrl(
  template: string,
  refs: ParamGroupRef[],
  valuesByParam: Record<string, string[]>,
  limit = URL_EXPANSION_LIMIT,
): GroupedExpansionResult {
  if (!refs.length) return { urls: template ? [template] : [], total: template ? 1 : 0, errors: [], truncated: false }
  const errors = refs
    .filter((ref) => !valuesByParam[ref.paramId]?.length)
    .map((ref) => `参数 ${ref.paramId} 缺少可用取值`)
  if (errors.length) return { urls: [], total: 0, errors, truncated: false }

  const { combos, truncated } = enumerateGroupedCombos(refs, valuesByParam, limit)
  const urls = combos.map((combo) => renderGroupedUrl(template, combo))
  return { urls, total: urls.length, errors: [], truncated }
}
