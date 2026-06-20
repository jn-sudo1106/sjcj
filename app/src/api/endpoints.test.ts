import { describe, it, expect } from 'vitest'
import { ENDPOINTS, ENDPOINT_PATHS, DANGER_ENDPOINTS } from './endpoints'
import { mockRegistry } from './mock'

describe('端点契约一致性', () => {
  it('契约清单无重复 path', () => {
    expect(ENDPOINT_PATHS.size).toBe(ENDPOINTS.length)
  })
  it('DANGER_ENDPOINTS 从 danger 标记派生', () => {
    expect(DANGER_ENDPOINTS.has('source/sendSnatch')).toBe(true)
    expect(DANGER_ENDPOINTS.has('rule/publish')).toBe(true)
    expect(DANGER_ENDPOINTS.has('source/sourcePaged')).toBe(false)
  })
  it('所有已注册 mock 端点都在契约清单内', () => {
    for (const key of Object.keys(mockRegistry)) {
      expect(ENDPOINT_PATHS.has(key), `${key} 不在契约清单`).toBe(true)
    }
  })
  it('标记 impl 的端点都有专属 mock handler', () => {
    for (const e of ENDPOINTS.filter((x) => x.impl)) {
      expect(typeof mockRegistry[e.path], `${e.path} 缺 mock handler`).toBe('function')
    }
  })
})
