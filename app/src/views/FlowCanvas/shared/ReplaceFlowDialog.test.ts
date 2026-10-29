// @vitest-environment jsdom
// 0930 画布「更换流程」选择弹窗：候选是全部流程，可按流程（名称 / ID）或按源（源 ID / 名称 → 所属流程）查。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ReplaceFlowDialog from './ReplaceFlowDialog.vue'
import { flowCenterApi, flowVersionApi, sourceApi, type FlowRecord } from '@/api'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const flowOf = (id: string, name: string, extra: Partial<FlowRecord> = {}) =>
  ({ id, name, updatedAt: '', definition: { main: [], branches: [], configs: {}, branchGroups: [] }, ...extra }) as FlowRecord

async function mountDialog(list: FlowRecord[], currentFlowId = 'cur') {
  // 1016：复制类用途选中即查发布版本；默认都已发布
  vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ publishId: '1', draftId: null } as never)
  const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: list.length, list })
  const wrapper = mount(ReplaceFlowDialog, {
    props: { modelValue: true, currentFlowId },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, paged }
}
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ReplaceFlowDialog', () => {
  it('打开即按创建时间倒序列全部流程（不限模板）', async () => {
    const { paged } = await mountDialog([flowOf('1', '甲')])
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ page: 1, field: 'createDt', order: 'desc', keywords: undefined }))
    expect(paged.mock.calls[0]![0]).not.toHaveProperty('onlyTemplate')
  })

  it('按流程：纯数字按 ID 查，否则按关键字', async () => {
    const { paged } = await mountDialog([])
    const kw = q('[data-testid="replace-flow-keyword"]') as HTMLInputElement
    kw.value = '14010130, 21000001'
    kw.dispatchEvent(new Event('input'))
    q('[data-testid="replace-flow-query"]').click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowIds: ['14010130', '21000001'] }))
  })

  it('按源：切过去默认就分页列全部源，每行带所属流程；输入名称按源名查', async () => {
    const { wrapper, paged } = await mountDialog([])
    const sources = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2,
      list: [
        { sourceId: '430024667', name: '江苏金租定期报告', flowId: '14010130' },
        { sourceId: '430000001', name: '没流程的源', flowId: '0' },
      ],
    } as never)
    paged.mockResolvedValue({ total: 1, list: [flowOf('14010130', '江苏金租定期报告指标')] })

    const mode = q('[data-testid="replace-flow-mode"]') as HTMLSelectElement
    mode.value = 'source'
    mode.dispatchEvent(new Event('change'))
    await flushPromises()
    // 不输关键字也有数据：不带条件分页查源
    expect(sources).toHaveBeenLastCalledWith({ page: 1, size: 20 })
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowIds: ['14010130'] }))
    const text = q('[data-testid="replace-flow-table"]').textContent
    expect(text).toContain('源 ID')
    expect(text).toContain('江苏金租定期报告指标')
    expect(text).toContain('无所属流程')

    const kw = q('[data-testid="replace-flow-keyword"]') as HTMLInputElement
    kw.value = '江苏金租'
    kw.dispatchEvent(new Event('input'))
    q('[data-testid="replace-flow-query"]').click()
    await flushPromises()
    expect(sources).toHaveBeenLastCalledWith(expect.objectContaining({ name: '江苏金租' }))

    // 选中源行 = 选它的所属流程；没流程的源不可选
    const rows = document.body.querySelectorAll('.el-table__body tr')
    ;(rows[1] as HTMLElement).click()
    await flushPromises()
    expect((q('[data-testid="replace-flow-confirm"]') as HTMLButtonElement).disabled).toBe(true)
    ;(rows[0] as HTMLElement).click()
    await flushPromises()
    q('[data-testid="replace-flow-confirm"]').click()
    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ id: '14010130' })
  })

  it('当前流程不可选；选中其他流程后才能确认，确认抛出选中的流程', async () => {
    const { wrapper } = await mountDialog([flowOf('cur', '当前流程'), flowOf('2', '别的流程')])
    const confirm = q('[data-testid="replace-flow-confirm"]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    const rows = document.body.querySelectorAll('.el-table__body tr')
    ;(rows[0] as HTMLElement).click()
    await flushPromises()
    expect(confirm.disabled).toBe(true)

    ;(rows[1] as HTMLElement).click()
    await flushPromises()
    expect(confirm.disabled).toBe(false)
    confirm.click()
    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ id: '2' })
  })

  // 10-29：复制类用途按页逐条查发布版，只有草稿的置灰标「仅草稿」、点不中；关联用途不查
  it('复制类用途：本页只有草稿的流程置灰标「仅草稿」不可选，已发布的可选', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockImplementation(async (id: string) =>
      ({ publishId: id === '2' ? null : '1', draftId: '9' }) as never)
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [flowOf('2', '只有草稿'), flowOf('3', '已发布')] })
    mount(ReplaceFlowDialog, { props: { modelValue: true, purpose: 'copy' }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await flushPromises()
    const rows = document.body.querySelectorAll('.el-table__body tr')
    expect(rows[0]!.className).toContain('rfd-row-off')
    expect(rows[0]!.textContent).toContain('仅草稿')
    expect(rows[1]!.textContent).not.toContain('仅草稿')
    const confirm = q('[data-testid="replace-flow-confirm"]') as HTMLButtonElement
    ;(rows[0] as HTMLElement).click()
    await flushPromises()
    expect(confirm.disabled).toBe(true)
    ;(rows[1] as HTMLElement).click()
    await flushPromises()
    expect(confirm.disabled).toBe(false)
    expect(flowVersionApi.overview).toHaveBeenCalledTimes(2)
  })

  it('关联用途不查发布版，只有草稿的流程照样可选', async () => {
    const overview = vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ publishId: null, draftId: '9' } as never)
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 1, list: [flowOf('2', '只有草稿')] })
    mount(ReplaceFlowDialog, { props: { modelValue: true, purpose: 'bind' }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await flushPromises()
    ;(document.body.querySelectorAll('.el-table__body tr')[0] as HTMLElement).click()
    await flushPromises()
    expect(overview).not.toHaveBeenCalled()
    expect((q('[data-testid="replace-flow-confirm"]') as HTMLButtonElement).disabled).toBe(false)
  })
})
