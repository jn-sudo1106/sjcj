// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { configApi } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { nameForCopiedConfig, useDuplicateNode } from './useDuplicateNode'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
})

afterEach(() => vi.restoreAllMocks())

describe('nameForCopiedConfig', () => {
  it('节点名未被占用时直接用节点名', async () => {
    vi.spyOn(configApi, 'configNameExists').mockResolvedValue(false)
    await expect(nameForCopiedConfig('公告列表抓取（复制）', '公告列表配置_copy', '1400981'))
      .resolves.toBe('公告列表抓取（复制）')
  })

  it('节点名已被占用则加 _2', async () => {
    vi.spyOn(configApi, 'configNameExists').mockImplementation(async (name: string) => name === '公告列表抓取（复制）')
    await expect(nameForCopiedConfig('公告列表抓取（复制）', '公告列表配置_copy', '1400981'))
      .resolves.toBe('公告列表抓取（复制）_2')
  })
})

describe('useDuplicateNode', () => {
  it('copyAll 之后把新配置改名为节点名再绑定', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.bindCopiedConfig('web-list', '1400774', '证券之星列表配置')

    vi.spyOn(configApi, 'copyConfigAndLocate').mockResolvedValue({
      ok: true, configId: '1400981', name: '证券之星列表配置_copy',
    })
    vi.spyOn(configApi, 'configNameExists').mockResolvedValue(false)
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({ configName: '证券之星列表配置_copy' })
    const update = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })

    const duplicateNode = useDuplicateNode()
    const newId = await duplicateNode('web-list')
    expect(newId).toBeTruthy()
    const expectedName = flow.configs[newId!].title
    expect(expectedName).toContain('（复制）')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({
      configId: '1400981',
      configName: expectedName,
    })
    expect(flow.configs[newId!].configId).toBe('1400981')
    expect(flow.configs[newId!].configName).toBe(expectedName)
  })

  it('改名失败仍绑定 copyAll 出来的配置，不沿用原 configId', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.bindCopiedConfig('web-list', '1400774', '证券之星列表配置')

    vi.spyOn(configApi, 'copyConfigAndLocate').mockResolvedValue({
      ok: true, configId: '1400981', name: '证券之星列表配置_copy',
    })
    vi.spyOn(configApi, 'configNameExists').mockResolvedValue(false)
    vi.spyOn(configApi, 'configDetailRaw').mockRejectedValue(new Error('详情失败'))

    const duplicateNode = useDuplicateNode()
    const newId = await duplicateNode('web-list')
    expect(flow.configs[newId!].configId).toBe('1400981')
    expect(flow.configs[newId!].configName).toBe('证券之星列表配置_copy')
  })
})
