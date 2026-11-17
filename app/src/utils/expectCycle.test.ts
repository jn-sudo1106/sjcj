import { describe, expect, it } from 'vitest'
import { expectCycleText } from './expectCycle'
import { sourceCategoriesFromLegacy } from '@/api/legacyAdapters'

describe('expectCycle', () => {
  it('24 的倍数写天，否则写小时，未配置写 —', () => {
    expect(expectCycleText(24)).toBe('1 天')
    expect(expectCycleText(720)).toBe('30 天')
    expect(expectCycleText(36)).toBe('36 小时')
    expect(expectCycleText(0)).toBe('—')
    expect(expectCycleText(null)).toBe('—')
  })

  it('categoryPaged 行的 expectCycleHours 映射进 SourceCategory，null / 0 不带', () => {
    const [a, b, c] = sourceCategoriesFromLegacy([
      { categoryId: 1, categoryName: 'A', expectCycleHours: 24 },
      { categoryId: 2, categoryName: 'B', expectCycleHours: null },
      { categoryId: 3, categoryName: 'C', expectCycleHours: 0 },
    ])
    expect(a!.expectCycleHours).toBe(24)
    expect('expectCycleHours' in b!).toBe(false)
    expect('expectCycleHours' in c!).toBe(false)
  })
})
