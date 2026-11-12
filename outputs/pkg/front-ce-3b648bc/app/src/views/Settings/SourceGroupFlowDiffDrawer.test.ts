// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { flowCenterApi, flowVersionApi, sourceApi, workflowBindingApi, type SourceGroup } from '@/api'
import SourceGroupFlowDiffDrawer from './SourceGroupFlowDiffDrawer.vue'

const group = { sourceGroupId: '3', sourceGroupName: '测试组', sourceGroupCode: 'test', state: 'ACTIVE', flowIds: ['20'], defaultFlowId: '20', revision: 1 } as SourceGroup
const source = (id: string) => ({ sourceId: id, name: `源${id}` })
const view = (bindings: unknown[], ownFlowIds: string[] = []) => ({ sourceGroupId: '3', flowIds: ['20'], bindings: [], ownBindings: bindings, ownFlowIds, ownDataAvailable: true })
const bind = (flowId: string, state = 'ACTIVE') => ({ flowId, state })
const q = (selector: string) => document.body.querySelector(selector) as HTMLElement
function mountDrawer() { return mount(SourceGroupFlowDiffDrawer, { props: { group, defaultFlowLabel: '当前流程 · 20' }, global: { plugins: [ElementPlus] }, attachTo: document.body }) }
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('来源组历史流程排查', () => {
  it('大组分页读取全部成员，并限制历史绑定请求并发', async () => {
    const members = Array.from({ length: 205 }, (_, i) => source(String(i + 1)))
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async params => ({
      list: members.slice(((params?.page || 1) - 1) * 100, (params?.page || 1) * 100), total: members.length,
    } as never))
    let active = 0
    let maxActive = 0
    vi.spyOn(workflowBindingApi, 'view').mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active--
      return view([bind('10')]) as never
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 1, list: [{ id: '10', name: '历史流程甲' }] } as never)
    const wrapper = mountDrawer()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(3)
    expect(maxActive).toBeLessThanOrEqual(5)
    expect(q('[data-testid="sfd-flow"]').textContent).toContain('205 个源保留')
    expect(document.querySelectorAll('.sfd-table tbody tr')).toHaveLength(20)
    expect(document.querySelector('.el-pagination')).toBeTruthy()
    wrapper.unmount()
  })

  it('对每个源的历史绑定去重汇总，区分无绑定、停用和读取失败，并查看节点', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ list: ['1', '2', '3', '4', '5'].map(source), total: 5 } as never)
    vi.spyOn(workflowBindingApi, 'view').mockImplementation(async id => {
      if (id === '1') return view([bind('10'), bind('10')], ['10']) as never
      if (id === '2') return view([bind('10', 'DISABLED'), bind('11')]) as never
      if (id === '3') return view([]) as never
      if (id === '4') throw new Error('网络异常')
      return { ...view([]), ownDataAvailable: false } as never
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [{ id: '10', name: '历史流程甲' }, { id: '11', name: '历史流程乙' }] } as never)
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: true, publishId: '5', draftId: '6', versions: [] } as never)
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([{ stepId: '1', name: '采集', configId: '100', outputTable: '200' }] as never)
    const wrapper = mountDrawer()
    await flushPromises()
    const flows = [...document.querySelectorAll('[data-testid="sfd-flow"]')] as HTMLElement[]
    expect(flows).toHaveLength(2)
    expect(flows[0].textContent).toContain('2 个源保留')
    expect(document.body.textContent).toContain('1 个源读取失败')
    expect(document.body.textContent).toContain('1 个源的历史绑定未由后端返回')
    expect(document.body.textContent).toContain('1 个源没有保留历史自有流程')
    expect(document.body.textContent).toContain('已停用')
    q('[data-testid="sfd-steps-toggle"]').click()
    await flushPromises()
    expect(steps).toHaveBeenCalledWith('10', { withConfigDetails: false, versionId: '5' })
    expect(q('[data-testid="sfd-steps"]').textContent).toContain('配置 ID：100')
    flows[1].click()
    await flushPromises()
    expect(document.body.textContent).toContain('涉及的源 · 历史流程乙')
    expect(document.body.textContent).not.toContain('配置 ID：100')
    wrapper.unmount()
  })

  it('成员列表获取失败时显示错误并允许重试', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockRejectedValueOnce(new Error('查询超时')).mockResolvedValueOnce({ list: [], total: 0 } as never)
    const wrapper = mountDrawer()
    await flushPromises()
    expect(document.body.textContent).toContain('读取失败：查询超时')
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('重试'))!
    retry.click()
    await flushPromises()
    expect(document.body.textContent).toContain('没有可展示的历史自有流程')
    wrapper.unmount()
  })
})
