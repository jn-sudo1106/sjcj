// 流程版本（2026-10-10）：217 起发布版只读，改步骤写进草稿；首次写入自动建草稿，每写一次刷新 ver。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flowVersionApi, type FlowVersionOverview, type FlowVersionRef } from '@/api'
import { useFlowVersionStore } from './flowVersion'

const row = (versionId: string, over: Partial<FlowVersionOverview['versions'][number]> = {}) => ({
  versionId, flowVer: 1, ver: 1, state: 'C', isLock: 0, isDelete: 0, baseId: null, ...over,
})
const published: FlowVersionOverview = {
  enabled: true, curVer: 1, nextVer: 2, publishId: '748', draftId: null, versions: [row('748')],
}
const withDraft = (ver: number, extra: Partial<ReturnType<typeof row>> = {}): FlowVersionOverview => ({
  ...published, draftId: '1033', versions: [row('1033', { flowVer: 2, ver, state: 'W', baseId: '748', ...extra }), row('748')],
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('useFlowVersionStore', () => {
  it('流程未启用版本：写入收到 null，照旧写，不建草稿', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ ...published, enabled: false })
    const action = vi.spyOn(flowVersionApi, 'action')
    const store = useFlowVersionStore()
    const seen: Array<FlowVersionRef | null> = []
    await store.withDraft('21000003', async (ref) => { seen.push(ref) })
    expect(seen).toEqual([null])
    expect(action).not.toHaveBeenCalled()
  })

  it('发布版可直接改：没有草稿时第一次写入自动从发布版生成草稿，带草稿的 versionId / ver 写（10-11 定）', async () => {
    const overview = vi.spyOn(flowVersionApi, 'overview')
      .mockResolvedValueOnce(published)
      .mockResolvedValueOnce(withDraft(1))
      .mockResolvedValue(withDraft(2))
    const action = vi.spyOn(flowVersionApi, 'action').mockResolvedValue({ versionId: '1033' })
    const store = useFlowVersionStore()
    await store.load('21000003')
    expect(store.readonly).toBe(false)
    const seen: Array<FlowVersionRef | null> = []
    await store.withDraft('21000003', async (ref) => { seen.push(ref) })
    expect(action).toHaveBeenCalledWith('draft', { flowId: '21000003', versionId: '748', ver: 1, expectedPublishId: '748' })
    expect(seen).toEqual([{ flowId: '21000003', versionId: '1033', ver: 1 }])
    expect(overview).toHaveBeenCalledTimes(3)
    expect(store.draft?.ver).toBe(2)
    expect(store.viewVersionId).toBe('1033')
  })

  it('已有草稿：继续写在这个草稿里，不重复生成', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(withDraft(5))
    const action = vi.spyOn(flowVersionApi, 'action')
    const store = useFlowVersionStore()
    await store.load('21000003')
    const seen: Array<FlowVersionRef | null> = []
    await store.withDraft('21000003', async (ref) => { seen.push(ref) })
    expect(action).not.toHaveBeenCalled()
    expect(seen).toEqual([{ flowId: '21000003', versionId: '1033', ver: 5 }])
  })

  it('锁定的草稿算只读', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(withDraft(1, { isLock: 1 }))
    const store = useFlowVersionStore()
    await store.load('21000003')
    expect(store.readonly).toBe(true)
  })

  it('连续两次写入串行：第二次拿到第一次写完后的新 ver，不会撞「内容已变更」', async () => {
    let ver = 1
    vi.spyOn(flowVersionApi, 'overview').mockImplementation(async () => withDraft(ver))
    const store = useFlowVersionStore()
    await store.load('21000003')
    const seen: number[] = []
    const write = (ref: FlowVersionRef | null) => { seen.push(ref!.ver); ver += 1; return Promise.resolve() }
    await Promise.all([store.withDraft('21000003', write), store.withDraft('21000003', write)])
    expect(seen).toEqual([1, 2])
  })

  it('写入失败也重读 ver；失败原样抛给调用方', async () => {
    const overview = vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(withDraft(3))
    const store = useFlowVersionStore()
    await store.load('21000003')
    await expect(store.withDraft('21000003', async () => { throw new Error('内容已变更，请重新加载') })).rejects.toThrow('内容已变更')
    expect(overview).toHaveBeenCalledTimes(2)
  })

  it('草稿已锁定：拒绝写入并说明原因', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(withDraft(1, { isLock: 1 }))
    const store = useFlowVersionStore()
    const fn = vi.fn()
    await expect(store.withDraft('21000003', fn)).rejects.toThrow('草稿 V2 已锁定')
    expect(fn).not.toHaveBeenCalled()
  })

  it('写别的流程（复制配置的目标流程）不改变画布当前流程的版本状态', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockImplementation(async (id: string) => (id === '1' ? withDraft(1) : { ...published, enabled: false }))
    const store = useFlowVersionStore()
    await store.load('1')
    await store.withDraft('2', async () => undefined)
    expect(store.flowId).toBe('1')
    expect(store.viewVersionId).toBe('1033')
  })

  it('发布 / 放弃：带草稿的 versionId / ver 与当前发布 ID', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(withDraft(4))
    const action = vi.spyOn(flowVersionApi, 'action').mockResolvedValue({ versionId: null })
    const store = useFlowVersionStore()
    await store.load('21000003')
    await store.publish()
    await store.abandon()
    expect(action).toHaveBeenNthCalledWith(1, 'publish', { flowId: '21000003', versionId: '1033', ver: 4, expectedPublishId: '748' })
    expect(action).toHaveBeenNthCalledWith(2, 'abandon', { flowId: '21000003', versionId: '1033', ver: 4, expectedPublishId: '748' })
  })
})
