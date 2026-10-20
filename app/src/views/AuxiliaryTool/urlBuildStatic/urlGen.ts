// 「URL生成静态[备]」的纯计算部分 —— 从旧 `UrlBuild3.vue` 里抠出来做单测。
//
// 与隔壁 urlBuild 的关键区别：这一屏**不调后端**。占位符写成 `$p1$` / `$p2$`，
// 生成时直接字符串替换（`url.replace('$p1$', 值)`），没有表达式求值。
// 所以它是旧那些"生成 URL"实验里最省事的一版，保留下来当离线备胎。

/** 一块参数粘贴区的行拆分（旧 utils/util.js 的 parseToList）：按 \n 拆，去空行 */
export function parseToList(text?: string): string[] {
  if (!text) return []
  return String(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/** 占位符替换：`$p{n}$` → 第 n 个参数的值。用 `String.replace(字符串, …)` 只换首个，与旧版逐字一致 */
function fill(template: string, combo: string[]): string {
  let out = template
  combo.forEach((value, index) => {
    out = out.replace('$p' + (index + 1) + '$', value)
  })
  return out
}

export interface GenResult {
  /** 出错文案（等长校验不通过时），成功为 null */
  error: string | null
  lines: string[]
}

/** 简单模式：各参数第 i 行配对；行数不一致直接报错（旧版的行为） */
export function genSimple(rows: string[][], urlTpl: string, nameTpl: string): GenResult {
  let lastLength: number | null = null
  for (const row of rows) {
    if (lastLength === null) {
      lastLength = row.length
      continue
    }
    if (row.length !== lastLength) {
      return { error: `多个参数数量不匹配: ${row.length}, vs , ${lastLength}`, lines: [] }
    }
  }
  const count = lastLength ?? 0
  const lines: string[] = []
  for (let i = 0; i < count; i += 1) {
    const combo = rows.map((row) => row[i] ?? '')
    lines.push(`${fill(nameTpl, combo)} ; ${fill(urlTpl, combo)}`)
  }
  return { error: null, lines }
}

/** 笛卡尔集模式：所有参数全组合 */
export function genCartesian(rows: string[][], urlTpl: string, nameTpl: string): GenResult {
  // 任一参数为空 → 组合为空（旧版在这里会 reduce 抛错，这里按空结果处理）
  if (!rows.length || rows.some((row) => row.length === 0)) return { error: null, lines: [] }
  const combos = rows.reduce<string[][]>(
    (acc, row) => {
      const out: string[][] = []
      acc.forEach((prefix) => row.forEach((value) => out.push([...prefix, value])))
      return out
    },
    [[]],
  )
  return {
    error: null,
    lines: combos.map((combo) => `${fill(nameTpl, combo)} ; ${fill(urlTpl, combo)}`),
  }
}

/**
 * 去重 / 差集（旧 genDistinct）。
 *   distinct(values)            → 自身去重（保留首次出现顺序）
 *   distinct(other, values)     → other 里有、values 里没有的（旧版三个按钮就是这几种组合）
 */
export function distinctValues(values: string[], other?: string[]): string[] {
  if (!other) return [...new Set(values)]
  const base = new Set(other)
  return values.filter((item) => !base.has(item))
}
