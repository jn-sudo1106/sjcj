/**
 * 生成服务（/api/answer/data-process）会把模型整段回复原样存成 .py，
 * 常见形态是 ```python … ``` 包着正文，执行端点按 Python 解析时第 1 行就报语法错误。
 * 数据监控与规则处理节点共用这份清理口径（2026-11-17 186 实测规则节点即因此无法测试）。
 *
 * 目标：能拿出一个像 Python 脚本的正文就接受；实在拿不到才报错，并把收到的内容写进错误里便于定位。
 */
export function cleanGeneratedPython(raw: string): string {
  const text = (raw || '').trim()
  if (!text) throw new Error('生成结果为空：模型没有返回任何内容，未保存候选文件')

  // 没有围栏：沿用旧行为，直接当正文（老模型/兜底纯文本流就是这样）
  if (!text.includes('```')) return text

  const blocks = [...text.matchAll(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/gi)]
    .map((m) => (m[1] || '').trim())
    .filter(Boolean)

  if (!blocks.length) {
    // 只有开围栏没有闭围栏 —— 通常是生成被截断
    const hint = describeIncompleteReply(text)
    throw new Error(`生成结果不完整：代码围栏没有闭合，可能被截断了，未保存候选文件（${hint}）`)
  }
  if (blocks.length === 1) return blocks[0]!

  // 多个代码块：只在「恰好一个带 def main」时才敢取，否则不猜
  const withMain = blocks.filter((code) => /def\s+main\s*\(/.test(code))
  if (withMain.length === 1) return withMain[0]!
  const hint = describeIncompleteReply(text)
  throw new Error(`生成结果包含多个代码块，无法确定哪个是正式脚本：未保存候选文件（${hint}）`)
}

/** 只有 .py 目标且正文里带围栏时才需要清理；其他（XML 抓取配置、纯正文）原样保留 */
export function needsPythonCleanup(script: string, path: string): boolean {
  return path.trim().toLowerCase().endsWith('.py') && (script || '').includes('```')
}

/** 把「收到的内容大概长什么样」压成一句，便于用户/我们判断是模型跑偏还是被截断 */
function describeIncompleteReply(text: string): string {
  const fences = (text.match(/```/g) || []).length
  const head = text.replace(/\s+/g, ' ').slice(0, 60)
  const tail = text.replace(/\s+/g, ' ').slice(-60)
  const flags = [
    fences ? `围栏 ${fences} 个` : '没有代码围栏',
    /def\s+main\s*\(/.test(text) ? '含 def main(' : '没有 def main(',
    `共 ${text.length} 字`,
  ].join('、')
  return `${flags}。开头：${head}… 结尾：…${tail}`
}
