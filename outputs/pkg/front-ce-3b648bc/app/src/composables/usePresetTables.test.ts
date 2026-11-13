// 0903 欠账 A2：「常用默认表」四个硬编码 ID 在真实后端一个都不存在
// （2026-09-05 实测 config/entryType 全部回「未找到相关ID…」，它们是 mock 里的 ID）。
// 点一下会把输出表设成无效 ID、出参变「共 0 个可选」，界面还不报错。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { usePresetTables, __resetPresetTableCache } from './usePresetTables'
import { entryApi, type EntryType } from '@/api'

const PRESETS = [
  { name: '资讯列表', tableId: '2103330' },
  { name: '资源表', tableId: '2101001' },
]
const REAL = { tableId: '2101001', tableName: 'sense_data.TB_X', name: '资源表', fields: [] } as EntryType

afterEach(() => { __resetPresetTableCache(); vi.restoreAllMocks() })

describe('usePresetTables', () => {
  it('只留下真实存在的表；查不到的（接口抛错）被过滤掉', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(async (id) => {
      if (id === '2101001') return REAL
      throw new Error('未找到相关ID2103330')
    })
    const { availablePresets } = usePresetTables(PRESETS)
    await flushPromises()
    expect(availablePresets.value.map((p) => p.tableId)).toEqual(['2101001'])
  })

  it('一个都不存在时返回空数组——调用方据此整行不显示，不留死按钮', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockRejectedValue(new Error('未找到'))
    const { availablePresets } = usePresetTables(PRESETS)
    await flushPromises()
    expect(availablePresets.value).toEqual([])
  })

  it('校验完成前是空的：宁可先不显示，也不要先显示再消失或让人点到无效的', () => {
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(() => new Promise(() => {}))
    const { availablePresets } = usePresetTables(PRESETS)
    expect(availablePresets.value).toEqual([])
  })

  it('接口回了空对象（不抛错）也算不存在，不能只靠 catch 兜', async () => {
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({ tableId: '', tableName: '', name: '', fields: [] } as EntryType)
    const { availablePresets } = usePresetTables(PRESETS)
    await flushPromises()
    expect(availablePresets.value).toEqual([])
  })

  it('同一个 tableId 只问一次后端：这个面板会被反复打开', async () => {
    const detail = vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(REAL)
    usePresetTables(PRESETS)
    await flushPromises()
    usePresetTables(PRESETS)
    await flushPromises()
    expect(detail).toHaveBeenCalledTimes(PRESETS.length)
  })
})
