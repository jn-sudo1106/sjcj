// @vitest-environment jsdom
// 关联流程选择器（1030 会议议题 3、4）：服务端分页搜索、节点数、只看本网站在用、勾选回传
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import FlowPickerDialog from './FlowPickerDialog.vue'
import { configApi, entryApi, flowCenterApi, type FlowRecord } from '@/api'

const FLOWS = [
  { id: '11', name: '列表流程', sourceCnt: 5 },
  { id: '12', name: '详情流程', sourceCnt: 2 },
] as FlowRecord[]

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

async function mountPicker(siteFlowCounts: Record<string, number> = {}, selected: string[] = []) {
  const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: FLOWS.length, list: FLOWS })
  vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([{}, {}] as never)
  // 预览：没有根行时按流程配置合成起点；画布按表 ID 查表名
  vi.spyOn(configApi, 'configDetail').mockResolvedValue(null as never)
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(null as never)
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
    // 列表变窄后「本网站」列只显示数字，完整说明在悬停提示里
    const siteCell = rows()[0].querySelector('td[title^="本网站"]') as HTMLElement
    expect(siteCell.textContent).toBe('3')
    expect(siteCell.title).toBe('本网站 3 个源在用')
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

  // 10-31：预览改成左右两栏，右侧是与流程工作区同样式的只读画布
  it('打开时默认预览第一条：只读画布画出节点，右侧只读配置区看配置 / 输出表 / URL；点另一行切换预览', async () => {
    const STEPS = [
      { stepId: '41623', sourceId: '', name: '列表页', isRoot: true, nodeType: '网页抓取', configId: '1401069', outputTable: '6200029', url: 'http://example.com/list', dependsOn: [] },
      { stepId: '41628', sourceId: '', name: '详情页', nodeType: '网页抓取', configId: '1401070', outputTable: '6200030', dependsOn: ['41623'] },
    ]
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue(STEPS as never)
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: FLOWS.length, list: FLOWS })
    vi.spyOn(configApi, 'configDetail').mockResolvedValue(null as never)
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(null as never)
    const wrapper = mount(FlowPickerDialog, {
      props: { selected: [], siteFlowCounts: {} },
      global: { plugins: [ElementPlus], directives: { loading: {} } },
      attachTo: document.body,
    })
    await flushPromises()
    expect(flowCenterApi.steps).toHaveBeenCalledWith('11')
    expect(rows()[0].classList).toContain('previewing')
    const nodes = [...document.querySelectorAll('[data-testid="flow-readonly-node"]')] as HTMLElement[]
    expect(nodes.map((n) => n.textContent)).toEqual([expect.stringContaining('列表页'), expect.stringContaining('详情页')])
    // 只读：没有插入 / 删除这些编辑入口
    expect(document.querySelector('[data-testid="flow-readonly-canvas"] button')).toBeNull()

    // 右侧只读配置区（对照工作区配置区）：默认选中第一个节点，配置条 + 节点配置页签
    const panel = () => document.querySelector('[data-testid="flow-node-panel"]') as HTMLElement
    expect(nodes[0].classList).toContain('active')
    expect(panel().textContent).toContain('#1401069')
    expect(panel().textContent).toContain('http://example.com/list')
    expect(panel().querySelector('input, select, textarea')).toBeNull()
    ;(panel().querySelector('[data-testid="flow-node-tab-table"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(panel().textContent).toContain('6200029')
    nodes[1].click()
    await flushPromises()
    expect(panel().textContent).toContain('详情页')
    expect(panel().textContent).toContain('#1401070')

    rows()[1].click()
    await flushPromises()
    expect(flowCenterApi.steps).toHaveBeenLastCalledWith('12')
    expect(rows()[1].classList).toContain('previewing')
    // 点行只是预览，不会勾选
    expect(document.body.textContent).toContain('已选 0 个')
    wrapper.unmount()
  })

  it('勾选框选择 / 取消，确定时回传勾选的流程（含打开前已选的）', async () => {
    const { wrapper } = await mountPicker({}, ['99'])
    const checks = () => [...document.querySelectorAll('[data-testid="flow-picker-check"] input')] as HTMLInputElement[]
    checks()[0].click()
    checks()[1].click()
    await flushPromises()
    checks()[1].click()
    await flushPromises()
    ;(document.querySelector('[data-testid="flow-picker-confirm"]') as HTMLButtonElement).click()
    const picked = wrapper.emitted('confirm')?.[0]?.[0] as FlowRecord[]
    expect(picked.map((f) => f.id)).toEqual(['99', '11'])
    expect(picked[1].name).toBe('列表流程')
    wrapper.unmount()
  })

  it('刷新按当前已提交的条件重查', async () => {
    const { wrapper, paged } = await mountPicker({ '11': 3 })
    const input = document.querySelector('[data-testid="flow-picker-search"]') as HTMLInputElement
    input.value = '详情'
    input.dispatchEvent(new Event('input'))
    ;(document.querySelector('[data-testid="flow-picker-refresh"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(2)
    expect(paged.mock.calls[1][0]).toEqual(paged.mock.calls[0][0])
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
