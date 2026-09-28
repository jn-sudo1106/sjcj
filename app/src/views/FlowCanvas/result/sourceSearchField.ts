/**
 * 源视图查询框的字段自动识别（2026-09-28 产品：「选择要点 2 下」「url 这种可以自动识别」）。
 *
 * 0917-11 把源 ID / 源名称 / 源 URL 并成「字段 ▾ ＋ 一个输入框」时刻意做成手动选字段，
 * 理由是猜错会静默漏结果（实测 `name=centec` 0 条、`sourceUrl=centec` 1 条）。
 * 现在改成**能明确判断的才自动**，说不准的（单个英文词）按名称查，查空了再提示改按 URL——
 * 见 SourceOverviewView 的 urlFallback。下拉框保留并跟着切，用户看得到按什么查，也能手动改。
 */
export type SourceSearchField = 'sourceIds' | 'name' | 'sourceUrl'

/** 纯数字，或用逗号 / 中文逗号 / 空白分隔的一串数字 */
const IDS = /^\d+(?:\s*[,，\s]\s*\d+)*$/
/** 明确的网址开头 */
const URL_PREFIX = /^(?:https?:\/\/|www\.)/i
/** 形如 `xxx.com`、`a.b.cn/path`：最后一段是 2 个以上字母的域名后缀；避免把「v2.0」这类当网址 */
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i

export function detectSourceSearchField(text: string): SourceSearchField | null {
  const value = text.trim()
  if (!value) return null
  if (IDS.test(value)) return 'sourceIds'
  if (URL_PREFIX.test(value) || DOMAIN.test(value)) return 'sourceUrl'
  return 'name'
}

/**
 * 按名称没查到时，要不要提示「改按 URL 查」：只对**可能是网址片段**的输入——
 * 一个不含空白、全是可见 ASCII 的词（如 `centec`、`sanyoumed`）。含中文的肯定不是网址，不提示。
 */
export function mightBeUrlFragment(text: string): boolean {
  return /^[\x21-\x7e]+$/.test(text.trim())
}
