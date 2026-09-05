// 0904 I15（Z8）：后端新建源时 url 必填，不填报错。会上定的是**前端先吃药**——
// 「你不要搞必填，就是相当于你可以让他生成一个……尽量要想个方法去弥补他现在的问题，
//  而不是说按照他现在的问题上去改」。
import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_URL_PREFIX, isPlaceholderUrl, urlOrPlaceholder } from './placeholderUrl'

describe('urlOrPlaceholder', () => {
  it('用户填了就原样返回，只去首尾空白，不做任何清洗', () => {
    expect(urlOrPlaceholder('  https://a.test/x?y=1#z  ')).toBe('https://a.test/x?y=1#z')
  })

  it('空 / 只有空白 / undefined / null 都补占位值', () => {
    for (const v of ['', '   ', undefined, null]) {
      expect(isPlaceholderUrl(urlOrPlaceholder(v, 's1'))).toBe(true)
    }
  })

  it('占位值带上 sourceId，回头能定位是哪个源', () => {
    expect(urlOrPlaceholder('', 'src-42')).toBe(`${PLACEHOLDER_URL_PREFIX}src-42`)
  })

  it('没有 sourceId 时也不能给出空后缀（否则两个源的占位值会一模一样）', () => {
    const a = urlOrPlaceholder('')
    expect(a).not.toBe(PLACEHOLDER_URL_PREFIX)
    expect(isPlaceholderUrl(a)).toBe(true)
  })

  it('用 .invalid 顶级域：保证永不解析，且能一把搜出来清理', () => {
    expect(urlOrPlaceholder('', 's1')).toContain('.invalid/')
  })

  it('isPlaceholderUrl 不误判真实 URL', () => {
    expect(isPlaceholderUrl('https://a.test/')).toBe(false)
    expect(isPlaceholderUrl('')).toBe(false)
    expect(isPlaceholderUrl(undefined)).toBe(false)
  })
})
