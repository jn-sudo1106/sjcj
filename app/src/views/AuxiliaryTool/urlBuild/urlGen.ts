// URL 生成的纯计算部分（不做网络请求）—— 从旧 `UrlBuild.vue` 的 genUrlsSimple / genUrlsDKR 里
// 把「拆分参数 → 组合 → 造上下文」这段抠出来，方便单测。
//
// 旧页面这两段混在组件方法里、还顺手 `this.$notification` / `this.handleCheck` 发请求，
// 逻辑本身不难，难的是它跟「每行一次 comm/exp 表达式计算」缠在一起（url 模板是**表达式**，
// 不是字符串模板：`'http://' + p1 + '-' + p2` 里的 p1/p2 是上下文变量）。
// 所以这里只负责到「组合 + 上下文」为止，表达式求值留给页面（api/exp.ts）。

/** 一块参数粘贴区的行拆分（旧 utils/util.js 的 parseToList）：按 \n 拆，去掉空行与纯空白行 */
export function parseToList(text?: string): string[] {
  if (!text) return []
  return String(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/** 简单模式的长度一致性检查：返回错误文案，一致/无需检查时返回 null（旧版就是逐个比长度） */
export function lengthMismatch(rows: string[][]): string | null {
  let lastLength: number | null = null
  for (const row of rows) {
    if (lastLength === null) {
      lastLength = row.length
      continue
    }
    if (row.length !== lastLength) {
      return `多个参数数量不匹配: ${row.length}, vs , ${lastLength}`
    }
  }
  return null
}

/**
 * 多参数笛卡尔集（旧 genUrlsDKR 的 reduce 拼接）：返回**组合数组**而不是拼接串。
 * 旧版用 `par1 + '$$$' + par2` 拼成一个串再 split 回来，参数值里一旦自带 `$$$` 就串位了；
 * 这里直接留下数组，行为一致但没有这个坑。
 * 任一参数为空 → 返回空数组（组合结果本来就是空集，旧版在这里会 reduce 抛错）。
 */
export function cartesianRows(rows: string[][]): string[][] {
  if (!rows.length) return []
  if (rows.some((row) => row.length === 0)) return []
  return rows.reduce<string[][]>(
    (acc, row) => {
      const out: string[][] = []
      acc.forEach((prefix) => row.forEach((value) => out.push([...prefix, value])))
      return out
    },
    [[]],
  )
}

/**
 * 一行组合 → 表达式上下文（旧版 env 构造，逐字对齐）：
 *   env.p{n} = 值；若该参数开了「转义」，env.p{n} 换成 encodeURI(值)，
 *   同时把原始值放到 `env['p' + key]`（= `pp1`，这是旧版的写法，不是笔误，改了会跟旧页面结果不一致）。
 */
export function buildEnv(combo: string[], encodes: boolean[]): Record<string, string> {
  const env: Record<string, string> = {}
  combo.forEach((value, index) => {
    const key = `p${index + 1}`
    env[key] = value
    if (encodes[index]) {
      env[key] = encodeURI(value)
      env[`p${key}`] = value
    }
  })
  return env
}

/** 每行的求值表达式：旧版就是 `名称表达式 + ' ; ' + URL表达式` 拼出来的一个字符串 */
export function buildRule(nameTpl: string, urlTpl: string): string {
  return `${nameTpl} + ' ; ' + ${urlTpl}`
}
