import { describe, expect, it } from 'vitest'
import { mockSourcePaged } from './sources'

describe('source mock 筛选', () => {
  it('支持外部变更待确认筛选', () => {
    const result = mockSourcePaged({ state: 'external', size: 999 })

    expect(result.total).toBeGreaterThan(0)
    expect(result.list.every((source) => source.externalChanged)).toBe(true)
  })
})
