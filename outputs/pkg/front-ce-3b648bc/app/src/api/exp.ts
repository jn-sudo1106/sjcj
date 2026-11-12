// 函数表达式计算 —— 旧 data-view `src/api/util.js` 的 `checkExp`（`/v1/comm/exp`）。
//
// 契约（逐字对齐旧文件）：
//   POST /v1/comm/exp   body { value, rule, env }
//   · value = 表达式里的「当前值」，脚本中通过 value 变量引用
//   · rule  = 表达式本身（IF-ELSE 脚本 / 嵌套函数 / 逻辑运算）
//   · env   = **字符串**（页面传 JSON.stringify(map)），后端拿它建上下文 Map；
//             注意它不是对象——旧页面就是 `JSON.stringify(env)` 之后才发的
//
// 谁在用：辅助工具「函数工具」（单个表达式）与「URL生成工具」（每行组合各算一次）。
import { request } from './client'

/** 计算一个表达式（旧 checkExp）。成功时返回后端的原始载荷，展示口径见 expResultText。 */
export async function checkExp(value: string, rule: string, env: string): Promise<unknown> {
  return request<unknown>('comm/exp', { value, rule, env }, { method: 'POST' })
}

/**
 * 把 `comm/exp` 的返回摊成一行可读文本。
 *
 * 为什么不直接 `JSON.stringify(res)`（旧函数工具就是这么干的）：旧版拿到的 `res` 是整层信封
 * `{code,msg,data}`，页面上「结果」框里显示的其实是 `{"code":"0","msg":"成功","data":"600001.sh"}`；
 * 而新 client 的 normalizeHttpPayload 已经把信封拆开（标量 data 会归到 `{ok,message,data}`，
 * 对象/数组直接透传），再 stringify 一遍就成了「两层壳套着」的怪东西。
 *
 * 这里统一按「有 data 就取 data，没有就原样」的口径输出：
 *   · data 是字符串 → 原样（后端最常见：返回计算结果字符串）
 *   · data 是对象/数组 → JSON 串（例如返回 map）
 *   · 压根没 data（响应体就是裸值）→ 原样 / JSON 串
 */
export function expResultText(res: unknown): string {
  if (res === undefined || res === null) return ''
  if (typeof res === 'object' && !Array.isArray(res) && 'data' in (res as Record<string, unknown>)) {
    const data = (res as Record<string, unknown>).data
    if (data === undefined || data === null) return ''
    return typeof data === 'string' ? data : JSON.stringify(data)
  }
  return typeof res === 'string' ? res : JSON.stringify(res)
}
