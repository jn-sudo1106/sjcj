// @vitest-environment jsdom
// 流程列表（flowMode=list）：数据来自 source-group 绑定；入组的源整体只读，没有任何兼容模式提示。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import SourceWorkflowList from './SourceWorkflowList.vue'
import { workflowBindingApi, type WorkflowBinding } from '@/api'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, ElMessageBox: { prompt: vi.fn(), confirm: vi.fn() } }
})

const row = (id: string, primary: boolean, inherited = false): WorkflowBinding => ({
  id: `b-${id}`, bindType: inherited ? 'SOURCE_GROUP' : 'SOURCE', bindId: '100', workflowId: id, workflowCode: `FLOW-${id}`,
  workflowName: `流程${id}`, publishedFlowId: id, versionStatus: 'PUBLISHED', workflowStatus: 'ACTIVE', versionManaged: false,
  followsCurrentVersion: true, role: primary ? 'MAIN' : 'AUX', primary, priority: 0, status: 'ACTIVE', inherited,
})

async function mountList() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/canvas', query: { sourceId: '100', view: 'flow', flowMode: 'list' } })
  await router.isReady()
  const wrapper = mount(SourceWorkflowList, {
    props: { sourceId: '100' },
    global: { plugins: [pinia, router, ElementPlus], stubs: { CanvasHeader: true, ReplaceFlowDialog: true } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(ElMessageBox.confirm).mockReset()
})

describe('SourceWorkflowList', () => {
  it('独立源：列出关联流程；非默认流程可设为主流程、可解除；没有版本列、没有用途选择、没有兼容提示', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([row('11', true), row('12', false)])
    const wrapper = await mountList()

    expect(wrapper.text()).toContain('流程11')
    expect(wrapper.text()).toContain('流程12')
    expect(wrapper.text()).not.toContain('版本状态')
    expect(wrapper.text()).not.toContain('兼容')
    expect(wrapper.find('.swl-role').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workflow-group-locked"]').exists()).toBe(false)
    const ops = wrapper.findAll('.swl-op').map((b) => b.text())
    expect(ops).toEqual(['打开', '打开', '设为主流程', '解除'])
    expect(wrapper.findAll('button').some((b) => b.text() === '关联已有')).toBe(true)
  })

  it('设为主流程：确认后调 setPrimary 并刷新；解除同理', async () => {
    const list = vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([row('11', true), row('12', false)])
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const setPrimary = vi.spyOn(workflowBindingApi, 'setPrimary').mockResolvedValue(undefined)
    const unbind = vi.spyOn(workflowBindingApi, 'unbind').mockResolvedValue(undefined)
    const wrapper = await mountList()

    await wrapper.findAll('.swl-op').find((b) => b.text() === '设为主流程')!.trigger('click')
    await flushPromises()
    expect(setPrimary).toHaveBeenCalledWith('100', '12')
    expect(list).toHaveBeenCalledTimes(2)

    await wrapper.findAll('.swl-op').find((b) => b.text() === '解除')!.trigger('click')
    await flushPromises()
    expect(unbind).toHaveBeenCalledWith('100', '12')
  })

  it('入组的源：整个列表只读，说明原因，不出现关联 / 新增 / 设主流程 / 解除', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([row('21', true, true), row('22', false, true)])
    const wrapper = await mountList()

    expect(wrapper.get('[data-testid="workflow-group-locked"]').text()).toContain('退出来源组')
    expect(wrapper.text()).toContain('来源组统一流程')
    expect(wrapper.findAll('.swl-op').map((b) => b.text())).toEqual(['打开', '打开'])
    expect(wrapper.findAll('button').some((b) => b.text() === '关联已有' || b.text().includes('新增流程'))).toBe(false)
  })
})
