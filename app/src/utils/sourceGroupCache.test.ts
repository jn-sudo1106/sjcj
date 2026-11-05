// @vitest-environment jsdom
// 来源组列表本机缓存（1105）：只做加速，读失败一律当没有缓存。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceGroup } from '@/api'
import {
  clearSourceGroupCache,
  parseSourceGroupCache,
  readSourceGroupCache,
  sourceGroupCacheKey,
  writeSourceGroupCache,
} from './sourceGroupCache'

const GROUP: SourceGroup = {
  sourceGroupId: '3',
  sourceGroupCode: 'twitter1',
  sourceGroupName: 'twitter1',
  state: 'ACTIVE',
  flowIds: ['21000005'],
  defaultFlowId: '21000005',
  revision: 2,
}
const KEY = sourceGroupCacheKey('7', 'http://186|test')

describe('sourceGroupCache', () => {
  beforeEach(() => clearSourceGroupCache())
  afterEach(() => clearSourceGroupCache())

  it('key 带账号与环境，换账号/换后端不串数据', () => {
    expect(sourceGroupCacheKey('7', 'http://186|test')).not.toBe(sourceGroupCacheKey('8', 'http://186|test'))
    expect(sourceGroupCacheKey('7', 'http://186|test')).not.toBe(sourceGroupCacheKey('7', 'http://217|production'))
    expect(sourceGroupCacheKey('', '')).toContain('ce:source-groups:v1:')
  })

  it('写进去能读出来', () => {
    writeSourceGroupCache(KEY, [GROUP])
    expect(readSourceGroupCache(KEY)).toEqual([GROUP])
  })

  it('空列表不覆盖旧缓存（权限过滤/请求异常时不把可用内容冲掉）', () => {
    writeSourceGroupCache(KEY, [GROUP])
    writeSourceGroupCache(KEY, [])
    expect(readSourceGroupCache(KEY)).toEqual([GROUP])
  })

  it('格式不对、字段缺失、超过 24h 都当作没缓存', () => {
    expect(readSourceGroupCache(KEY)).toBeNull()
    expect(parseSourceGroupCache('not json')).toBeNull()
    expect(parseSourceGroupCache(JSON.stringify({ version: 1, savedAt: Date.now(), groups: [{ sourceGroupId: '1' }] }))).toBeNull()
    expect(parseSourceGroupCache(JSON.stringify({ version: 2, savedAt: Date.now(), groups: [GROUP] }))).toBeNull()
    const old = Date.now() - 25 * 60 * 60 * 1000
    expect(parseSourceGroupCache(JSON.stringify({ version: 1, savedAt: old, groups: [GROUP] }))).toBeNull()
  })

  it('clearSourceGroupCache 不带 key 时清掉所有来源组缓存', () => {
    writeSourceGroupCache(sourceGroupCacheKey('7', 'a'), [GROUP])
    writeSourceGroupCache(sourceGroupCacheKey('8', 'b'), [GROUP])
    clearSourceGroupCache()
    expect(readSourceGroupCache(sourceGroupCacheKey('7', 'a'))).toBeNull()
    expect(readSourceGroupCache(sourceGroupCacheKey('8', 'b'))).toBeNull()
  })
})