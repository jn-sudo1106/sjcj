import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/monitor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/monitor')>()
  return {
    ...actual,
    pagedSourceSummary: vi.fn(async () => ({
      total: 1,
      list: [{ sourceId: 1, sourceName: 'n', monitorTotal: 0, monitorEnabled: 0, dataState: 'none' }],
    })),
  }
})

import { listSourceSummary } from '@/api/monitorCenter'

describe('listSourceSummary', () => {
  it('maps rows', async () => {
    const res = await listSourceSummary()
    expect(res.unavailable).toBe(false)
    expect(res.rows[0].sourceId).toBe('1')
    expect(res.rows[0].unconfigured).toBe(true)
  })
})
