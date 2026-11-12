// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElInput, ElOption, ElSelect } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import LogsTab from './LogsTab.vue'
import { syncApi } from '@/api/dataSync'
import { useAuthStore } from '@/stores/auth'

let wrapper: VueWrapper | undefined

async function mountTab() {
  setActivePinia(createPinia())
  useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
  vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 5, customerName: '测试客户' }])
  const clients = vi.spyOn(syncApi, 'clients').mockResolvedValue({ list: [], total: 0 })
  const logs = vi.spyOn(syncApi, 'logs').mockResolvedValue({ list: [], total: 0 })
  wrapper = mount(LogsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
  await flushPromises()
  return { clients, logs }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('LogsTab · 筛选栏', () => {
  it('状态与类型不再给「全部」选项，每个筛选下拉都能清除且清除即重查', async () => {
    const { logs } = await mountTab()
    const selects = wrapper!.findAllComponents(ElSelect).filter((item) => item.classes('sync-input'))
    const inputs = wrapper!.findAllComponents(ElInput).filter((item) => item.classes('sync-input'))
    // 客户 / 客户端 / 任务名称 / 状态 / 类型
    expect(selects).toHaveLength(5)
    expect(inputs).toHaveLength(1)
    expect(selects.every((item) => item.props('clearable') === true)).toBe(true)
    expect(inputs[0].props('clearable')).toBe(true)

    const labels = selects.flatMap((item) => item.findAllComponents(ElOption).map((o) => String(o.props('label'))))
    expect(labels.filter((label) => label.startsWith('全部'))).toEqual([])
    expect(labels).toEqual(expect.arrayContaining(['运行中', '运行完成', '运行异常', '定时同步', '手动同步']))

    const calls = logs.mock.calls.length
    await selects[3].vm.$emit('clear')
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(calls + 1)
  })

  it('不选客户即全部客户，客户端候选跟着给全量', async () => {
    const { clients } = await mountTab()
    expect(clients).toHaveBeenCalledWith({ pageNo: 1, pageSize: 500 })
  })
})
