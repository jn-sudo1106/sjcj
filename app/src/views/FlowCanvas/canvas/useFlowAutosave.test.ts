// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { flowVersionApi, itemApi, sourceApi } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { FLOW_AUTOSAVE_MS, FLOW_AUTOSAVE_RETRY_BASE_MS, resetFlowAutosaveForTests, useFlowAutosave } from './useFlowAutosave'
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
  // 0927 H1：输出表/输入表是真实步骤的必有字段（后端非 file 节点 OUT_ENTRY 必填）；
  // fixture 不全会被 outputTableMissing 误判为「缺输出表」而跳过保存。
  inputTable: '6200026',
  outputTable: '6200026',
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
    // 流程版本（2026-10-10）：按未启用处理，写步骤不带版本信息
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    resetFlowAutosaveForTests()
    // element-plus mock 里的 vi.fn() 跨用例累计调用记录（restoreAllMocks 只还原 spyOn），
    // 失败 toast 次数断言需要一个干净的计数起点。
    vi.clearAllMocks()
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

  it('提交失败进入 error；手动 flush 立即重试（0926：5s 后退避自动重试，不再停摆）', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    const { bind, unbind, status, flush } = useFlowAutosave()
    bind()
    flow.setTitle('40600', '改名')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(status.value).toBe('error')
    expect(modify).toHaveBeenCalledTimes(1)
    // 0903：失败原来是个裸 catch，什么都不说——用户刚看过配置保存的绿色提示，
    // 不会再去读头部那行小字，于是"保存成功了"就走了，节点其实根本没落库。
    expect(vi.mocked(ElMessage.error)).toHaveBeenCalledWith(expect.stringContaining('写保护'))
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS * 2)
    expect(modify).toHaveBeenCalledTimes(1)
    modify.mockResolvedValue({ ok: true, message: 'ok' })
    await flush()
    expect(modify).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('saved')
    unbind()
  })

  it('失败原因存进 lastError 供头部 title 展示，成功后清空', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('节点「X」尚未绑定配置，无法保存步骤'))
    const { bind, unbind, lastError, flush } = useFlowAutosave()
    bind()
    flow.setTitle('40600', '改名')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(lastError.value).toContain('尚未绑定配置')

    modify.mockResolvedValue({ ok: true, message: 'ok' })
    await flush()
    expect(lastError.value).toBe('')
    unbind()
  })

  it('新改动打断退避：失败后立即再改，不等 5s 退避到期就重新保存（0926 REVIEW F-R9）', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.setTitle('40600', '改一次')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(status.value).toBe('error')
    expect(modify).toHaveBeenCalledTimes(1)
    // 退避 5s 到期前没有第二次提交
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_RETRY_BASE_MS - 1)
    expect(modify).toHaveBeenCalledTimes(1)
    // 用户又改了一下 → schedule 打断旧退避计时，按正常防抖 800ms 立即重试
    modify.mockResolvedValue({ ok: true, message: 'ok' })
    flow.setTitle('40600', '再改一次')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(modify).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('saved')
    unbind()
  })

  it('切换现场：退避中的失败计数与计时复位，新源改动按正常防抖保存（0926 REVIEW F-R9）', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.setTitle('40600', '旧源的改动')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(status.value).toBe('error')
    expect(modify).toHaveBeenCalledTimes(1)
    // 切到另一个源：stopSource watch 复位失败计数/退避计时，状态回 idle
    flow.loadFromSource(
      { sourceId: '430016399', name: 'test2', url: 'http://y', configId: '1400918', mainTable: '6200027', owner: 'a', state: 'C' } as never,
      [SNAPSHOT],
    )
    await flushPromises()
    expect(status.value).toBe('idle')
    // 新源上的改动不再受旧退避影响：正常防抖后立即保存（等不到 5s 退避）
    modify.mockResolvedValue({ ok: true, message: 'ok' })
    flow.setTitle('40600', '新源上的改动')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(modify).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('saved')
    unbind()
  })

  it('新节点缺 configId 时跳过它、其余节点照常保存，状态仍提示等配置（0926）', async () => {
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
    // 2026-10-10 起已有步骤无改动不回写——给 40600 一处真实改动，验证「其余节点照常保存」
    flow.setTitle('40600', '1400917-详情（改）')
    flow.insertAfter('40600', 'web')
    const localId = flow.selectedId
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    // 0926：不再整体拦截——已有步骤照常保存，草稿节点留在画布上等配置绑定
    expect(create).not.toHaveBeenCalled()
    expect(modify).toHaveBeenCalledTimes(1)
    expect(modify.mock.calls[0][0].stepId).toBe('40600')
    expect(status.value).toBe('pending') // 头部仍提示「请先保存节点配置」
    expect(flow.flowDirty).toBe(false)

    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'
    flow.touch()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(create).toHaveBeenCalledTimes(1)
    // 2026-10-10：40600 上一轮已写过、本轮没再改 → 不重复回写（版本模式下空写会凭空建草稿）
    expect(modify.mock.calls.filter((c) => c[0].stepId === '40600')).toHaveLength(1)
    expect(status.value).toBe('saved')
    expect(flow.flowDirty).toBe(false)
    unbind()
  })

  // 0927 H1：输出表未就绪与「未绑定配置」同款处理——跳过该节点、其余照常保存、
  // 头部 pending「请先补全节点配置」；补上输出表后下一轮落库恢复 saved。
  it('节点缺输出表（已绑配置）：跳过保存其余照常，头部仍提示补全；补表后落库（0927 H1）', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([SNAPSHOT])
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.insertAfter('40600', 'web')
    const localId = flow.selectedId
    flow.configs[localId].configId = '1400999' // 已绑定配置，只差输出表
    flow.touch()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)

    expect(create).not.toHaveBeenCalled() // 缺输出表 → 跳过
    expect(modify).toHaveBeenCalledTimes(1) // 40600 照常回写
    expect(modify.mock.calls[0][0].stepId).toBe('40600')
    expect(status.value).toBe('pending') // 头部仍在提示补全节点配置
    expect(flow.flowDirty).toBe(false)

    flow.configs[localId].outputTable = '6200027'
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: '网页抓取', configId: '1400999', outputTable: '6200027', enabled: false },
    ])
    flow.touch()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(create).toHaveBeenCalledTimes(1) // 补表后落库
    expect(status.value).toBe('saved')
    unbind()
  })

  it('提交失败后退避自动重试，成功后恢复；同一失败段只弹一次 toast（0926）', async () => {
    const flow = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.setTitle('40600', '改名')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(status.value).toBe('error')
    expect(modify).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ElMessage.error)).toHaveBeenCalledTimes(1)
    // 5s 退避窗口内不重试
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_RETRY_BASE_MS - 1)
    expect(modify).toHaveBeenCalledTimes(1)
    // 5s 到点自动重试；仍失败 → 不重复弹 toast，退避翻倍
    await vi.advanceTimersByTimeAsync(1)
    expect(modify).toHaveBeenCalledTimes(2)
    expect(vi.mocked(ElMessage.error)).toHaveBeenCalledTimes(1)
    // 10s 后自动重试成功 → 恢复 saved，后续改动照常自动保存
    modify.mockResolvedValue({ ok: true, message: 'ok' })
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_RETRY_BASE_MS * 2)
    expect(modify).toHaveBeenCalledTimes(3)
    expect(status.value).toBe('saved')
    unbind()
  })

  it('流程工作区（无源上下文、flowIdMode）：节点改动自动落步骤，flowId 锚定（0926）', async () => {
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: '', name: '测试流程', url: '', configId: '1400987', mainTable: '', owner: '', state: 'C' } as never,
      [
        { ...SNAPSHOT, stepId: '41380', name: '流程入口', mainConfig: '1400987', flowId: '1400987', dependsOn: undefined, isRoot: true },
        { ...SNAPSHOT, stepId: '41385', mainConfig: '1400987', flowId: '1400987' },
      ],
    )
    flow.flowId = '1400987'
    flow.setFlowIdMode(true)
    flow.clearSourceCtxKeepSteps()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.setTitle('41385', '改名啦')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(modify).toHaveBeenCalledTimes(1)
    expect(modify.mock.calls[0][0].stepId).toBe('41385')
    expect(modify.mock.calls[0][0].flowId).toBe('1400987')
    expect(status.value).toBe('saved')
    unbind()
  })

  // 0927 P1-5：flowIdMode 下无步骤快照的节点（R2 遗留形态 / 快照拉取失败降级）跳过回写，
  // persistFlowSteps 上报 skipped → autosave 状态停在 pending，不再假装「已保存」。
  it('流程工作区有「只有画布定义、没有步骤行」的幽灵节点：保存后状态停在 pending（0927 P1-5）', async () => {
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: '', name: '测试流程', url: '', configId: '1400987', mainTable: '', owner: '', state: 'C' } as never,
      [
        { ...SNAPSHOT, stepId: '41380', name: '流程入口', mainConfig: '1400987', flowId: '1400987', dependsOn: undefined, isRoot: true },
        { ...SNAPSHOT, stepId: '41385', mainConfig: '1400987', flowId: '1400987' },
      ],
    )
    flow.flowId = '1400987'
    flow.setFlowIdMode(true)
    flow.clearSourceCtxKeepSteps()
    // 幽灵节点：数字 id、有配置、无步骤快照（快照被清空 / 拉取失败降级后的形态）
    flow.configs['41999'] = { ...flow.configs['41385'], title: '幽灵' }
    flow.main.splice(flow.main.indexOf('end'), 0, '41999')
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { bind, unbind, status } = useFlowAutosave()
    bind()
    flow.setTitle('41385', '改名啦')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(modify).toHaveBeenCalledTimes(1) // 41385 照常落库
    expect(status.value).toBe('pending') // 41999 被跳过 → 不假装已保存
    unbind()
  })

  it('drawer 内 A→B 切流程：在飞保存作废，不发成功状态、不落 savedClock（0926 REVIEW F-R3）', async () => {
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: '', name: '流程A', url: '', configId: '1400987', mainTable: '', owner: '', state: 'C' } as never,
      [
        { ...SNAPSHOT, stepId: '41380', name: '流程入口', mainConfig: '1400987', flowId: '1400987', dependsOn: undefined, isRoot: true },
        { ...SNAPSHOT, stepId: '41385', mainConfig: '1400987', flowId: '1400987' },
      ],
    )
    flow.flowId = '1400987'
    flow.setFlowIdMode(true)
    flow.clearSourceCtxKeepSteps()
    // 挂起第一次保存，模拟请求在飞时用户点了流程 B；之后调用立即返回（模拟 B 现场的新一轮保存）
    let settleModify: (value: { ok: boolean; message: string }) => void = () => undefined
    let modifyCalls = 0
    const modify = vi.spyOn(itemApi, 'stepModify').mockImplementation(() => {
      modifyCalls += 1
      if (modifyCalls === 1) return new Promise((resolve) => { settleModify = resolve })
      return Promise.resolve({ ok: true, message: 'ok' })
    })
    const { bind, unbind, status, savedClock } = useFlowAutosave()
    bind()
    flow.setTitle('41385', 'A 的改动')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(modify).toHaveBeenCalledTimes(1)
    expect(status.value).toBe('saving')
    // 切到流程 B：openFlowInWorkspace → load 重填画布，flow.flowId 换成 B 的 id
    const b = useFlowStore()
    b.setFlowIdMode(true)
    b.load({
      id: '1400988',
      name: '流程B',
      main: ['start', '41385', 'end'],
      branches: [],
      configs: { '41385': { title: 'B 节点', template: 'web', kind: 'node', configId: '1400988' } },
      updatedAt: '',
    } as never)
    b.flowId = '1400988'
    // 在飞的那次保存此刻才返回成功——但现场已经切换，必须作废（不落 saved 状态、不更新 savedClock，
    // 状态回 idle 而不是卡在 saving）
    settleModify({ ok: true, message: 'ok' })
    await flushPromises()
    expect(status.value).toBe('idle')
    expect(savedClock.value).toBe('')
    // 作废不破坏后续保存：新画布（B）再改一次，仍能正常自动保存
    b.setTitle('41385', 'B 的第二次改动')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(FLOW_AUTOSAVE_MS)
    expect(status.value).toBe('saved')
    expect(modify.mock.calls[1][0].stepId).toBe('41385')
    unbind()
  })
})
