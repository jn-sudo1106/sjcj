// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { workflowBindingApi, type FlowRecord, type SourceFlowsView } from '@/api'
import { useAuthStore } from '@/stores/auth'
import * as client from '@/api/client'
import BatchBindFlowsDialog from './BatchBindFlowsDialog.vue'

const flows = [{ id: '20', name: '流程二' }, { id: '30', name: '流程三' }] as FlowRecord[]
const view = (overrides: Partial<SourceFlowsView> = {}): SourceFlowsView => ({
  flowIds: [], bindings: [], ownFlowIds: [], ownBindings: [], ...overrides,
})
function render(sourceIds = ['1', '2']) {
  return mount(BatchBindFlowsDialog, {
    props: { sourceIds },
    global: {
      plugins: [ElementPlus],
      stubs: {
        ElDialog: { name: 'ElDialog', template: '<div><slot /><slot name="footer" /></div>' },
        FlowPickerDialog: true,
      },
    },
  })
}
async function pick(wrapper: ReturnType<typeof render>) {
  await wrapper.get('[data-testid="batch-bind-pick"]').trigger('click')
  wrapper.findComponent({ name: 'FlowPickerDialog' }).vm.$emit('confirm', flows)
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('源列表批量绑定流程', () => {
  it('所选流程全部已有时跳过写入；显式调整默认流程时仅更新原绑定', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(view({ ownFlowIds: ['10', '20', '30'], ownDefaultFlowId: '10' }))
    const request = vi.spyOn(client, 'request').mockResolvedValue({})
    const wrapper = render(['1'])
    await pick(wrapper)
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    await flushPromises()
    expect(request).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="batch-bind-result"]').text()).toContain('1 个源已绑定所选流程且默认流程无需调整，已跳过写入')
    wrapper.unmount()

    const updateDefault = render(['1'])
    await pick(updateDefault)
    updateDefault.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '30')
    await flushPromises()
    await updateDefault.get('[data-testid="batch-bind-submit"]').trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ flowIds: ['10', '20', '30'], defaultFlowId: '30' })
    updateDefault.unmount()
  })

  it('复用真实保存适配器，为每个源提交自己的最新并发快照', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockImplementation(async (id) => view({
      ownFlowIds: [id === '1' ? '10' : '11'], ownDefaultFlowId: id === '1' ? '10' : '11',
    }))
    const request = vi.spyOn(client, 'request').mockResolvedValue({})
    const wrapper = render()
    await pick(wrapper)
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)
    for (const [id, previous] of [['1', '10'], ['2', '11']]) {
      const body = { sourceId: id, expectedFlowIds: [previous], expectedDefaultFlowId: previous, flowIds: [previous, '20', '30'], defaultFlowId: previous }
      expect(request).toHaveBeenCalledWith('source-group/bindSourceFlows', body, { method: 'POST', httpEndpoint: 'source-group/bindSourceFlows', httpParams: body })
    }
    wrapper.unmount()
  })

  it('逐源合并且去重，保留原默认；无默认的源使用第一条所选流程', async () => {
    const changes = new Map()
    vi.spyOn(workflowBindingApi, 'save').mockImplementation(async (id, change) => {
      changes.set(id, change(id === '1' ? view({ ownFlowIds: ['10', '20'], ownDefaultFlowId: '10' }) : view()))
    })
    const wrapper = render(['1', '2', '1'])
    expect(wrapper.get('[data-testid="batch-bind-submit"]').attributes('disabled')).toBeDefined()
    await pick(wrapper)
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    await flushPromises()
    expect(changes.get('1')).toEqual({ flowIds: ['10', '20', '30'], defaultFlowId: '10' })
    expect(changes.get('2')).toEqual({ flowIds: ['20', '30'], defaultFlowId: '20' })
    expect(workflowBindingApi.save).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="batch-bind-result"]').text()).toContain('绑定成功 2 个源，未绑定 0 个源')
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(expect.arrayContaining(['1', '2']))
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('可统一设置默认流程，仍保留已有流程', async () => {
    let next
    vi.spyOn(workflowBindingApi, 'save').mockImplementation(async (_id, change) => {
      next = change(view({ ownFlowIds: ['10'], ownDefaultFlowId: '10' }))
    })
    const wrapper = render(['1'])
    await pick(wrapper)
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '30')
    await flushPromises()
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    await flushPromises()
    expect(next).toEqual({ flowIds: ['10', '20', '30'], defaultFlowId: '30' })
    wrapper.unmount()
  })

  it('组内源在读取最新绑定后拦截；并发冲突与网络失败列出源 ID，继续处理其余源', async () => {
    const writes: string[] = []
    vi.spyOn(workflowBindingApi, 'save').mockImplementation(async (id, change) => {
      change(id === '1' ? view({ sourceGroupId: '88' }) : view())
      if (id === '2') throw new Error('来源流程关联已变化，请重新查询')
      if (id === '3') throw new Error('网络连接失败')
      writes.push(id)
    })
    const wrapper = render(['1', '2', '3', '4', '5'])
    await pick(wrapper)
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    await flushPromises()
    expect(writes.sort()).toEqual(['4', '5'])
    const result = wrapper.get('[data-testid="batch-bind-result"]').text()
    expect(result).toContain('绑定成功 2 个源，未绑定 3 个源')
    expect(result).toContain('1：属于来源组 #88')
    expect(result).toContain('2：来源流程关联已变化，请重新查询')
    expect(result).toContain('3：网络连接失败')
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(expect.arrayContaining(['4', '5']))
    wrapper.unmount()
  })

  it('提交中禁止重复提交、改流程和关闭，限定最多四个源同时处理', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const save = vi.spyOn(workflowBindingApi, 'save').mockImplementation(() => pending)
    const wrapper = render(['1', '2', '3', '4', '5'])
    await pick(wrapper)
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    expect(save).toHaveBeenCalledTimes(4)
    expect(wrapper.get('[data-testid="batch-bind-pick"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findComponent({ name: 'ElDialog' }).attributes('close-on-click-modal')).toBe('false')
    finish()
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(5)
    expect(wrapper.get('[data-testid="batch-bind-result"]').text()).toContain('绑定成功 5 个源')
    wrapper.unmount()
  })

  it('非管理员不能提交，空选也不发写请求', async () => {
    const save = vi.spyOn(workflowBindingApi, 'save').mockResolvedValue()
    useAuthStore().roles = ['viewer']
    const wrapper = render()
    await pick(wrapper)
    await wrapper.get('[data-testid="batch-bind-submit"]').trigger('click')
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
    useAuthStore().roles = ['admin']
    const empty = render([])
    await pick(empty)
    await empty.get('[data-testid="batch-bind-submit"]').trigger('click')
    expect(save).not.toHaveBeenCalled()
    empty.unmount()
  })
})
