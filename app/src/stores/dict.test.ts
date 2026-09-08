// 字典 store 行为契约：
//  - 初始 = seeds 里的 SNATCH_TYPES 快照；
//  - load 成功且与快照一致 → 替换为后端值、不告警（仅更新 lastSyncAt）；
//  - load 成功但有漂移 → 替换 + console.warn 附「同步 seeds/REAL_SOURCE_TYPES」提示；
//  - load 成功但返回空数组 → 保持快照 + warn（空字典会架空 configType 校验）；
//  - load 失败 → 保持快照 + warn；
//  - 模板映射越界（编号不在字典）→ warn 含 orphans。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { configApi } from '@/api'
import { SNATCH_TYPES, TEMPLATE_TO_SNATCH } from '@/views/FlowCanvas/canvas/flowModel'
import { useDictStore } from './dict'

vi.mock('@/api', () => ({
  configApi: {
    sourceTypes: vi.fn(),
  },
}))

const mockedSourceTypes = vi.mocked(configApi.sourceTypes)

describe('useDictStore 抓取类型字典', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setActivePinia(createPinia())
    mockedSourceTypes.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('初始 snatchTypes 等于 seeds 快照', () => {
    const d = useDictStore()
    expect(d.snatchTypes).toEqual([...SNATCH_TYPES])
    expect(d.lastSyncAt).toBeNull()
    expect(d.loading).toBe(false)
  })

  it('后端返回与快照一致：不告警，替换列表并记录 lastSyncAt', async () => {
    mockedSourceTypes.mockResolvedValue(
      SNATCH_TYPES.map((display) => {
        const code = display.match(/^\[(\d+)\]/)![1]
        return { sourceType: code, typeName: display.replace(/^\[\d+\] - /, '') }
      }),
    )
    const d = useDictStore()
    await d.loadSnatchTypes()

    expect(d.snatchTypes).toEqual([...SNATCH_TYPES])
    expect(d.lastSyncAt).not.toBeNull()
    // 漂移 + 模板越界 warn 都不应出现
    const messages = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.find((m) => m.includes('字典与本地快照不一致'))).toBeUndefined()
    expect(messages.find((m) => m.includes('TEMPLATE_TO_SNATCH 映射到了后端字典外的编号'))).toBeUndefined()
  })

  it('后端多出新条目：告警含新增条目与同步提示', async () => {
    // 后端比快照多一条 800 - 新类型
    mockedSourceTypes.mockResolvedValue([
      { sourceType: '90', typeName: '网页抓取' },
      { sourceType: '600', typeName: '规则处理' },
      { sourceType: '800', typeName: '新类型' },
    ])
    const d = useDictStore()
    await d.loadSnatchTypes()

    expect(d.snatchTypes).toContain('[800] - 新类型')
    const driftWarn = warnSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('字典与本地快照不一致'))
    expect(driftWarn).toBeDefined()
    expect(driftWarn).toContain('[800] - 新类型')
    expect(driftWarn).toContain('同步 flowModel.seeds.ts')
  })

  it('快照有而后端无：告警含本地多出的条目', async () => {
    // 后端只有 90（其它条目都没了）
    mockedSourceTypes.mockResolvedValue([{ sourceType: '90', typeName: '网页抓取' }])
    const d = useDictStore()
    await d.loadSnatchTypes()

    const driftWarn = warnSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('字典与本地快照不一致'))
    expect(driftWarn).toBeDefined()
    // 本地多出 12 条（快照 13 - 后端 1）
    expect(driftWarn).toMatch(/本地多出 12 条/)
  })

  it('后端返回空数组：保持快照 + 告警', async () => {
    mockedSourceTypes.mockResolvedValue([])
    const d = useDictStore()
    await d.loadSnatchTypes()

    expect(d.snatchTypes).toEqual([...SNATCH_TYPES])
    expect(d.lastSyncAt).toBeNull()
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('返回空列表'))).toBe(true)
  })

  it('后端请求失败：保持快照 + 告警', async () => {
    mockedSourceTypes.mockRejectedValue(new Error('网络挂了'))
    const d = useDictStore()
    await d.loadSnatchTypes()

    expect(d.snatchTypes).toEqual([...SNATCH_TYPES])
    expect(d.lastSyncAt).toBeNull()
    // console.warn 用的是 (format, ...args) 形式，错误对象作为第二参数传入——把所有参数拼起来检查
    const warn = warnSpy.mock.calls.find((c) => String(c[0]).includes('加载抓取类型字典失败'))
    expect(warn).toBeDefined()
    expect(warn!.map(String).join(' ')).toContain('网络挂了')
  })

  it('模板映射越界（编号不在字典）：告警含 orphans 编号', async () => {
    // 后端只返 90：TEMPLATE_TO_SNATCH 里 140/150/160/170 都成 orphans
    mockedSourceTypes.mockResolvedValue([{ sourceType: '90', typeName: '网页抓取' }])
    const d = useDictStore()
    await d.loadSnatchTypes()

    const orphanWarn = warnSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('TEMPLATE_TO_SNATCH 映射到了后端字典外的编号'))
    expect(orphanWarn).toBeDefined()
    const expectedOrphans = Object.values(TEMPLATE_TO_SNATCH)
      .map((s) => s.match(/^\[(\d+)\]/)![1])
      .filter((c) => c !== '90')
    for (const code of expectedOrphans) {
      expect(orphanWarn).toContain(code)
    }
  })

  it('后端条目格式全非法：保持快照 + 告警', async () => {
    mockedSourceTypes.mockResolvedValue([
      { sourceType: '', typeName: '空编号' },
      { sourceType: '90', typeName: '' },
    ] as never)
    const d = useDictStore()
    await d.loadSnatchTypes()

    expect(d.snatchTypes).toEqual([...SNATCH_TYPES])
    expect(d.lastSyncAt).toBeNull()
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('全部条目格式不合法'))).toBe(true)
  })
})
