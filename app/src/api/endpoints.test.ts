import { describe, it, expect } from 'vitest'
import { ENDPOINTS, ENDPOINT_PATHS, DANGER_ENDPOINTS, LIVE_ENDPOINTS } from './endpoints'
import { mockRegistry } from './mock'
import { SNATCH_TYPES } from '@/views/FlowCanvas/canvas/flowModel'

describe('端点契约一致性', () => {
  it('抓取类型 mock 覆盖完整数字字典，含 APP、文件下载和 PDF转MD', async () => {
    const rows = await mockRegistry['config/sourceTypes']() as { sourceType: string; typeName: string }[]
    expect(rows.map((r) => `[${r.sourceType}] - ${r.typeName}`)).toEqual(SNATCH_TYPES)
  })
  it('契约清单无重复 path', () => {
    expect(ENDPOINT_PATHS.size).toBe(ENDPOINTS.length)
  })
  it('DANGER_ENDPOINTS 从 danger 标记派生', () => {
    expect(DANGER_ENDPOINTS.has('source/sendSnatch')).toBe(true)
    expect(DANGER_ENDPOINTS.has('rule/publish')).toBe(true)
    expect(DANGER_ENDPOINTS.has('source/sourcePaged')).toBe(false)
  })
  it('问题标记写入已标 live，日常 mock 模式也会打真实 markBatch / setColor（真实 path，不是逻辑名）', () => {
    expect(LIVE_ENDPOINTS.has('source/markBatch')).toBe(true)
    expect(LIVE_ENDPOINTS.has('source/tagSource')).toBe(false)
    expect(LIVE_ENDPOINTS.has('source/setColor')).toBe(true)
  })
  it('源启停 / 换网站 / 复制源已标 live（真实 path，不是逻辑名）', () => {
    expect(LIVE_ENDPOINTS.has('source/changeEnable')).toBe(true)
    expect(LIVE_ENDPOINTS.has('source/changeSourceEnable')).toBe(false)
    expect(LIVE_ENDPOINTS.has('source/changeSite')).toBe(true)
    expect(LIVE_ENDPOINTS.has('source/copySource')).toBe(true)
  })
  it('源检查分页已按监控视图真实契约放行 live', () => {
    expect(LIVE_ENDPOINTS.has('source/check/paged')).toBe(true)
  })
  it('源检查日志分页已按监控日志真实契约放行 live', () => {
    expect(LIVE_ENDPOINTS.has('source/check/paged-logs')).toBe(true)
  })
  it('源检查的写操作与定时预览一并放行 live（对齐旧 MonitorList 全量直连）', () => {
    for (const path of [
      'source/check/add',
      'source/check/update',
      'source/check/delete',
      'source/check/changeEnable',
      'source/check/check-one',
      'source/check/runNow',
      'source/lastRun',
    ]) {
      expect(LIVE_ENDPOINTS.has(path), `${path} 未标 live`).toBe(true)
    }
    // 纯只读的同步状态列表不做额外放行（列表页不用它）
    expect(LIVE_ENDPOINTS.has('source/check/syncPaged')).toBe(false)
  })
  it('步骤写接口已标 live，日常 mock 模式也会打真实 item/next', () => {
    expect(LIVE_ENDPOINTS.has('item/next/saveItemConfig')).toBe(true)
    expect(LIVE_ENDPOINTS.has('item/next/stepModify')).toBe(true)
    expect(LIVE_ENDPOINTS.has('item/next/enable')).toBe(true)
    expect(LIVE_ENDPOINTS.has('item/next/delete')).toBe(true)
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
