// @vitest-environment jsdom
// 关联流程选择器（1030 会议议题 3、4）：服务端分页搜索、节点数、只看本网站在用、勾选回传
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import FlowPickerDialog from './FlowPickerDialog.vue'
import { flowCenterApi, type FlowRecord } from '@/api'

const FLOWS = [
  { id: '11', name: '列表流程', sourceCnt: 5 },
  { id: '12', name: '详情流程', sourceCnt: 2 },
] as FlowRecord[]

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

async function mountPicker(siteFlowCounts: Record<string, number> = {}, selected: string[] = []) {
  const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: FLOWS.length, list: FLOWS })
  vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([{}, {}] as never)
  const wrapper = mount(FlowPickerDialog, {
    props: { selected, siteFlowCounts },
    global: { plugins: [ElementPlus], directives: { loading: {} }, },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, paged }
}
const rows = () => [...document.querySelectorAll('[data-testid="flow-picker-row"]')] as HTMLElement[]

describe('关联流程选择器', () => {
  it('本网站有在用流程时默认只看这些流程，并显示在用源数和节点数', async () => {
    const { wrapper, paged } = await mountPicker({ '11': 3 })
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ flowIds: ['11'], field: 'sourceCnt' }))
    expect(rows()[0].textContent).toContain('3 个源')
    expect(rows()[0].textContent).toContain('2')
    wrapper.unmount()
  })

  it('没有本网站在用流程时查全部；搜索名称走 keywords，纯数字走流程 ID', async () => {
    const { wrapper, paged } = await mountPicker()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowIds: undefined }))
    const input = document.querySelector('[data-testid="flow-picker-search"]') as HTMLInputElement
    input.value = '详情'
    input.dispatchEvent(new Event('input'))
    ;(document.querySelector('[data-testid="flow-picker-query"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ keywords: '详情', flowIds: undefined }))
    input.value = '12'
    input.dispatchEvent(new Event('input'))
    ;(document.querySelector('[data-testid="flow-picker-query"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ keywords: undefined, flowIds: ['12'] }))
    wrapper.unmount()
  })

  it('预览在行下展开只读节点列表，再点收起', async () => {
    const { wrapper } = await mountPicker()
    vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: 's1', name: '列表页', nodeType: '网页抓取', configId: '1401069', outputTable: '6200029' }] as never)
    ;(document.querySelector('[data-testid="flow-picker-preview"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('[data-testid="flow-picker-steps"]')?.textContent).toContain('列表页配置 1401069 · 输出表 6200029')
    ;(document.querySelector('[data-testid="flow-picker-preview"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('[data-testid="flow-picker-steps"]')).toBeNull()
    wrapper.unmount()
  })

  it('点行勾选 / 取消，确定时回传勾选的流程（含打开前已选的）', async () => {
    const { wrapper } = await mountPicker({}, ['99'])
    rows()[0].click()
    rows()[1].click()
    rows()[1].click()
    await flushPromises()
    ;(document.querySelector('[data-testid="flow-picker-confirm"]') as HTMLButtonElement).click()
    const picked = wrapper.emitted('confirm')?.[0]?.[0] as FlowRecord[]
    expect(picked.map((f) => f.id)).toEqual(['99', '11'])
    expect(picked[1].name).toBe('列表流程')
    wrapper.unmount()
  })

  // review：翻页失败要看得到错误；只改输入框不点查询，翻页仍按上次条件；空表说明区分「没在用」和「没命中」
  it('翻页失败清掉旧行并显示错误；未提交的搜索词不参与翻页；空表说明区分搜索没命中', async () => {
    const { wrapper, paged } = await mountPicker({ '11': 3 })
    const input = document.querySelector('[data-testid="flow-picker-search"]') as HTMLInputElement
    input.value = '999'
    input.dispatchEvent(new Event('input'))
    paged.mockRejectedValueOnce(new Error('超时'))
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(2)
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowIds: ['11'], keywords: undefined }))
    expect(rows()).toHaveLength(0)
    expect(document.querySelector('[data-testid="flow-picker-empty"]')?.textContent).toContain('流程列表加载失败：超时')

    ;(document.querySelector('[data-testid="flow-picker-query"]') as HTMLButtonElement).click()
    await flushPromises()
    // 999 不在本网站在用的流程里，不发请求，提示可以取消勾选再搜
    expect(paged).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-testid="flow-picker-empty"]')?.textContent).toContain('本网站在用的流程里没有匹配「999」')
    wrapper.unmount()
  })
})
