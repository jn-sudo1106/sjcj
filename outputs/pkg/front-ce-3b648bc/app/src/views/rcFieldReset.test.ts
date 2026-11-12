import { describe, expect, it } from 'vitest'

// tokens.css 里的 .rc-field 是**工具栏用的横向 pill**：
//   inline-flex + height: 34px + padding: 0 11px + border + 白底
// 面板/弹窗里要竖排「标签在上、控件在下」，用这个类名就必须把上面几项整套重置掉，
// 否则表现是：内容被压进一个 34px 的带框盒子，控件溢出到框外。
//
// 2026-08-28 连着踩了两次——EditNodeSourceDialog 完全没重置、ParamsTab 只重置了一半
// （补了 display/min-width，漏了定高和边框）。所以这条从"盯某个文件"升级成全仓不变量：
// 只要模板里用了 class="rc-field"，样式里就必须有完整重置。
const RAW = import.meta.glob('./**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const REQUIRED = [
  { key: 'border', re: /border:\s*0/ },
  { key: 'background', re: /background:\s*transparent/ },
  { key: 'height', re: /height:\s*auto/ },
  { key: 'padding', re: /padding:\s*0[;\s]/ },
]

function localRcFieldRule(source: string): string | null {
  const style = source.slice(source.indexOf('<style'))
  const match = style.match(/^\.rc-field\s*\{[^}]*\}/m)
  return match ? match[0] : null
}

describe('.rc-field 在面板里必须整套重置全局 pill 样式', () => {
  const users = Object.entries(RAW).filter(([, src]) => src.includes('class="rc-field'))

  it('扫到了使用者（防止 glob 失效导致这条测试变成空转）', () => {
    expect(users.length).toBeGreaterThan(5)
  })

  it.each(users.map(([path]) => path))('%s 重置完整', (path) => {
    const source = RAW[path]
    const rule = localRcFieldRule(source)
    expect(rule, `${path} 用了 class="rc-field" 却没有局部 .rc-field 规则`).not.toBeNull()
    const missing = REQUIRED.filter((item) => !item.re.test(rule!)).map((item) => item.key)
    expect(missing, `${path} 的 .rc-field 重置缺少：${missing.join(' / ')}`).toEqual([])
  })
})
