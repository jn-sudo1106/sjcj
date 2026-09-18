import { describe, expect, it } from 'vitest'
import { importProgressText } from './importProgress'

// 2026-09-18 用户反馈：导 100 个源，通知全程停在「已导入 0 / 100」。
// 根因是 changeSite ≤300 个走单片，服务端不回报中间进度。
describe('importProgressText', () => {
  it('不分片时不报数字进度——报了也只会是恒定的 0 / N', () => {
    expect(importProgressText(0, 100, false)).toBe('正在导入 100 个源，请勿关闭页面…')
    // 即便调用方传了进度，单片场景也不显示（它只会在请求返回那一刻跳到满值）
    expect(importProgressText(100, 100, false)).toBe('正在导入 100 个源，请勿关闭页面…')
  })

  it('分片时报数，且措辞是「已提交」不是「已导入」', () => {
    expect(importProgressText(300, 900, true)).toBe('已提交 300 / 900 个源，请勿关闭页面…')
    expect(importProgressText(0, 900, true)).toBe('已提交 0 / 900 个源，请勿关闭页面…')
  })
})
