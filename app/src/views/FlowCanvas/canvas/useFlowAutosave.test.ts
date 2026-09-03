// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { itemApi, sourceApi } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { FLOW_AUTOSAVE_MS, resetFlowAutosaveForTests, useFlowAutosave } from './useFlowAutosave'
import type { Step } from '@/api'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm: vi.fn().mockResolvedValue(true) },
  }
})

const SNAPSHOT: Step = {
  stepId: '40600',
  sourceId: '-1',
  name: '1400917-详情',
  configId: '1400917',
  mainConfig: '1400917',
  url: '$VAL$',
  itemId: '52000351',
  enabled: false,
}

function loadTestSource() {
  const flow = useFlowStore()
  flow.loadFromSource(
    { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
    [SNAPSHOT],
  )
  return flow
}

describe('useFlowAutosave', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetFlowAutosaveForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    resetFlowAutosaveForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('flowDirty 后 800ms 才提交，成功后头部是已保存且只清流程脏', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { bind, unbind, status, savedClock } = useFlowAutosave()
    bind()
    flow.patchCollect('40600', { url: 'http://keep-config-dirty' })
    flow.setEntryCondition('40600', { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' })
    await flushPromises()
    expect(modify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS - 1)
    expect(modify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(modify).toHaveBeenCalledTimes(1)
    expect(modify.mock.calls[0][0].condition).toBe('K6==nil')
    expect(status.value).toBe('saved')
    expect(savedClock.value).toMatch(/^\d{2}:\d{2}$/)
    expect(flow.flowDirty).toBe(false)
    expect(flow.configDirty).toBe(true)
    unbind()
  })

  it('提交失败后暂停自动重试，点击 flush 才再提交', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    const { bind, unbind, status, flush } = useFlowAutosave()
    bind()
    flow.setTitle('40600', '改名')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(status.value).toBe('error')
    expect(modify).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS * 2)
    expect(modify).toHaveBeenCalledTimes(1)
    modify.mockResolvedValue({ ok: true, message: 'ok' })
    await flush()
    expect(modify).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('saved')
    unbind()
  })

  it('新节点缺 configId 时等待配置保存，绑定后自动提交', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: '网页抓取', configId: '1400999', enabled: false },
    ])
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.insertAfter('40600', 'web')
    const localId = flow.selectedId
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(modify).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(status.value).toBe('pending')
    expect(flow.flowDirty).toBe(true)

    flow.configs[localId].configId = '1400999'
    flow.touch()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(create).toHaveBeenCalledTimes(1)
    expect(modify).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('saved')
    expect(flow.flowDirty).toBe(false)
    unbind()
  })
})
