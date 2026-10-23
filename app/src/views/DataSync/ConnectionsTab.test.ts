// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import ConnectionsTab from './ConnectionsTab.vue'
import { syncApi, type SyncClient, type SyncDatabase } from '@/api/dataSync'
import { useAuthStore } from '@/stores/auth'

// 弹窗内容 teleport 到 body，同 TaskListTab.test.ts 的取法
const body = () => new DOMWrapper(document.body)

// el-input 的明文落在 input/textarea 的 value 上，text() 取不到，只能读控件值
const controlValues = () => body().findAll('input, textarea').map((item) => (item.element as HTMLInputElement | HTMLTextAreaElement).value ?? '')

/** script setup 的内部状态不对外暴露，测试按用到的那几个入口声明形状 */
interface TabVm {
  openClient: (row?: SyncClient) => void
  clientForm: { customerId: string | number; clientName: string; timingSync: string; fileSync: string; realtimeSync: string }
  submitClient: () => Promise<void>
  openDatabase: (row?: SyncDatabase) => void
  databaseForm: {
    customerId: string | number; appId: string | number; name: string; sourceCode: string
    databaseType: number; dbSchema: string; type: number; remark: string
  }
  submitDatabase: () => Promise<void>
}

let wrapper: VueWrapper | undefined

async function mountTab() {
  setActivePinia(createPinia())
  useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
  vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 5, customerName: '测试客户' }])
  vi.spyOn(syncApi, 'customerPage').mockResolvedValue({ list: [], total: 0 })
  vi.spyOn(syncApi, 'clients').mockResolvedValue({ list: [], total: 0 })
  vi.spyOn(syncApi, 'databases').mockResolvedValue({ list: [], total: 0 })
  wrapper = mount(ConnectionsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper.vm as unknown as TabVm
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('环境配置页的写入表单', () => {
  it('新增客户端提交 on/off，并把一次性密钥显示出来', async () => {
    const vm = await mountTab()
    const save = vi.spyOn(syncApi, 'saveClient').mockResolvedValue({ id: 1201, clientName: '新客户端', secretKey: 'SEC-ONCE' })
    vm.openClient()
    vm.clientForm.customerId = 5
    vm.clientForm.clientName = ' 新客户端 '
    vm.clientForm.timingSync = 'on'
    await vm.submitClient()
    // 客户端把开关值转小写后与 off 比较，所以送出去只能是 on/off，不能是 0/1 或空
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 5, clientName: '新客户端', timingSync: 'on', fileSync: 'off', realtimeSync: 'off',
    }))
    expect(body().text()).toContain('client.id=1201')
    expect(controlValues()).toContain('SEC-ONCE')
  })

  it('编辑回填把存量的 1/0 开关按 0 关 1 开归一，避免保存时把开写成关', async () => {
    const vm = await mountTab()
    vm.openClient({ id: 1200, customerId: 5, clientName: '老客户端', timingSync: '1', fileSync: '0', realtimeSync: 'on' } as SyncClient)
    expect(vm.clientForm.timingSync).toBe('on')
    expect(vm.clientForm.fileSync).toBe('off')
    expect(vm.clientForm.realtimeSync).toBe('on')
  })

  it('关系型库不填 schema 不发请求，补齐后才提交', async () => {
    const vm = await mountTab()
    const save = vi.spyOn(syncApi, 'saveDatabase').mockResolvedValue({})
    vm.openDatabase()
    Object.assign(vm.databaseForm, {
      customerId: 5, appId: 1200, name: '主库', sourceCode: 'master', databaseType: 1, dbSchema: '', type: 0, remark: '',
    })
    await vm.submitDatabase()
    expect(save).not.toHaveBeenCalled()
    vm.databaseForm.dbSchema = 'gzh_db'
    await vm.submitDatabase()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ appId: 1200, sourceCode: 'master', databaseType: 1, dbSchema: 'gzh_db' })
  })

  it('ClickHouse 与 Elasticsearch 不要求 schema', async () => {
    const vm = await mountTab()
    const save = vi.spyOn(syncApi, 'saveDatabase').mockResolvedValue({})
    for (const databaseType of [4, 5]) {
      vm.openDatabase()
      Object.assign(vm.databaseForm, {
        customerId: 5, appId: 1200, name: `目标端${databaseType}`, sourceCode: `sink_${databaseType}`,
        databaseType, dbSchema: '', type: 0, remark: '',
      })
      await vm.submitDatabase()
    }
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ databaseType: 5, dbSchema: '' })
  })

  it('操作列改为图标热区：客户端给「编辑/重置签名密钥/删除」，数据源给「编辑/删除」', async () => {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 5, customerName: '测试客户' }])
    vi.spyOn(syncApi, 'clients').mockResolvedValue({
      list: [{ id: 1200, customerId: 5, clientName: '客户端A', timingSync: 'on', fileSync: 'off', realtimeSync: 'off' } as SyncClient], total: 1,
    })
    vi.spyOn(syncApi, 'databases').mockResolvedValue({
      list: [{ id: 1, customerId: 5, appId: 1200, name: '主库', sourceCode: 'master', databaseType: 1, dbSchema: 'gzh_db', type: 0 } as SyncDatabase], total: 1,
    })
    wrapper = mount(ConnectionsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()

    const tips = () => wrapper!.findAll('.el-table__row')[0]
      .findAllComponents({ name: 'ElTooltip' })
      .filter((item: VueWrapper) => item.find('.rc-op-icon').exists())
      .map((item: VueWrapper) => (item.props() as { content?: string }).content)
    expect(tips()).toEqual(['编辑', '重置签名密钥', '删除'])

    // 切到数据源页签：只剩编辑与删除，且不再残留文字按钮
    ;(wrapper!.vm as unknown as { active: string }).active = 'databases'
    await flushPromises()
    expect(tips()).toEqual(['编辑', '删除'])
    expect(wrapper!.findAll('.el-table__row')[0].text()).not.toContain('重置密钥')
  })
})
