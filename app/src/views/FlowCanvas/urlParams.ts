// URL 参数纯函数（0711 R9）：源 URL 里的 $PARAM$_id 占位符——id 直接写在 token 里，
// "绑定"不是"选择要用哪个参数"，而是根据 token 里已经写死的 id 去查参数定义是否存在。
// 例：https://www.dongchedi.com/usedcar/...#price=$PARAM$_1035&series_type=$PARAM$_1036

/** 匹配 token 用的正则；调用方按需自建实例，不共享 /g 状态（避免 lastIndex 踩坑） */
const TOKEN_PATTERN = '\\$PARAM\\$_([A-Za-z0-9_-]+)'

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
