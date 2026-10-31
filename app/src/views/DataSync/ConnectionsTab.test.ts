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
  clientForm: { customerId: string | number; clientName: string; timingSync: string; fileSync: string }
  submitClient: () => Promise<void>
  openDatabase: (row?: SyncDatabase) => Promise<void>
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
      customerId: 5, clientName: '新客户端', timingSync: 'on', fileSync: 'off',
    }))
    // 实时同步与消息主题已从两侧一起去掉，提交体里不该再出现
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('realtimeSync')
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('topics')
    expect(body().text()).toContain('client.id=1201')
    expect(controlValues()).toContain('SEC-ONCE')
  })

  it('编辑回填把存量的 1/0 开关按 0 关 1 开归一，避免保存时把开写成关', async () => {
    const vm = await mountTab()
    vm.openClient({ id: 1200, customerId: 5, clientName: '老客户端', timingSync: '1', fileSync: '0' } as SyncClient)
    expect(vm.clientForm.timingSync).toBe('on')
    expect(vm.clientForm.fileSync).toBe('off')
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
      list: [{ id: 1200, customerId: 5, clientName: '客户端A', timingSync: 'on', fileSync: 'off' } as SyncClient], total: 1,
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

describe('环境配置页的归属名称显示', () => {
  // 186 实测存量：数据源 customerId=1 的客户已不在名单里、appId=0 从没归属过客户端
  const dangling = { id: 11, customerId: 1, appId: 0, name: 'xuntu', sourceCode: 'target_mysql',
    databaseType: 1, dbSchema: 'wechat', type: 0 } as SyncDatabase

  async function mountDangling() {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 406, customerName: '讯兔',
      createTime: '2024-05-28 18:19:18', updateTime: '2026-10-14 14:41:18' }])
    vi.spyOn(syncApi, 'customerPage').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(syncApi, 'clients').mockResolvedValue({
      list: [{ id: 101, customerId: 406, clientName: '讯兔客户端', timingSync: 'on', fileSync: 'on' } as SyncClient], total: 1,
    })
    vi.spyOn(syncApi, 'databases').mockResolvedValue({ list: [dangling], total: 1 })
    wrapper = mount(ConnectionsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    const vm = wrapper!.vm as unknown as TabVm & { active: string }
    vm.active = 'databases'
    await flushPromises()
    return vm
  }

  it('数据源列表把客户与归属客户端翻成文字，取不到时显示 #ID / 未归属而不是裸数字', async () => {
    await mountDangling()
    const cells = wrapper!.findAll('.el-table__row')[0].findAll('td').map((td) => td.text())
    expect(cells).toContain('#1')
    expect(cells).toContain('未归属')
  })

  it('编辑弹窗给取不到的归属补一条说清原因的候选，el-select 不再把裸 ID 顶在界面上', async () => {
    const vm = await mountDangling()
    await vm.openDatabase(dangling)
    await flushPromises()
    expect(body().text()).toContain('客户 #1（不在客户名单里，需重新选择）')
    expect(body().text()).toContain('未归属客户端（需选择归属）')
  })

  it('归属正常时按名称显示，不出现兜底文案', async () => {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 406, customerName: '讯兔' }])
    vi.spyOn(syncApi, 'clients').mockResolvedValue({
      list: [{ id: 101, customerId: 406, clientName: '讯兔客户端', timingSync: 'on', fileSync: 'on' } as SyncClient], total: 1,
    })
    vi.spyOn(syncApi, 'databases').mockResolvedValue({
      list: [{ id: 12, customerId: 406, appId: 101, name: 'oss', sourceCode: 'oss', databaseType: 1, dbSchema: 'wechat', type: 1 }] as never, total: 1,
    })
    wrapper = mount(ConnectionsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    ;(wrapper!.vm as unknown as { active: string }).active = 'databases'
    await flushPromises()

    const text = wrapper!.findAll('.el-table__row')[0].text()
    expect(text).toContain('讯兔')
    expect(text).toContain('讯兔客户端')
    expect(text).not.toContain('需重新选择')
  })

  it('客户配置页签展示创建时间与更新时间', async () => {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customers').mockResolvedValue([])
    vi.spyOn(syncApi, 'clients').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(syncApi, 'customerPage').mockResolvedValue({
      list: [{ id: 406, customerName: '讯兔', createTime: '2024-05-28 18:19:18', updateTime: '2026-10-14 14:41:18' }], total: 1,
    })
    wrapper = mount(ConnectionsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    ;(wrapper!.vm as unknown as { active: string }).active = 'customers'
    await flushPromises()

    const header = wrapper!.find('.el-table__header').text()
    expect(header).toContain('创建时间')
    expect(header).toContain('更新时间')
    expect(wrapper!.findAll('.el-table__row')[0].text()).toContain('2024-05-28 18:19:18')
  })
})

describe('环境配置页的客户端开关与客户密钥', () => {
  async function mountTab() {
    setActivePinia(createPinia())
    useAuthStore().info = { name: 'admin', id: 1, roles: [], groups: [], avatar: '', introduction: '', group: 1 } as never
    vi.spyOn(syncApi, 'customers').mockResolvedValue([{ id: 406, customerName: '讯兔' }])
    vi.spyOn(syncApi, 'customerPage').mockResolvedValue({
      list: [{ id: 406, customerName: '讯兔', createTime: '2024-05-28 18:19:18', updateTime: '2026-10-14 14:41:18' }], total: 1,
    })
    vi.spyOn(syncApi, 'clients').mockResolvedValue({
      list: [{ id: 101, customerId: 406, clientName: '讯兔客户端', timingSync: 'on', fileSync: 'off', extendConfig: '' } as SyncClient], total: 1,
    })
    vi.spyOn(syncApi, 'databases').mockResolvedValue({ list: [], total: 0 })
    wrapper = mount(ConnectionsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
  }

  function switchTo(tab: 'clients' | 'customers') {
    ;(wrapper!.vm as unknown as { active: string }).active = tab
    return flushPromises()
  }

  it('客户端表格只剩「数据同步 / 文件同步」两个开关，实时同步与消息主题已去掉', async () => {
    await mountTab()
    const header = wrapper!.find('.el-table__header').text()
    expect(header).toContain('数据同步')
    expect(header).toContain('文件同步')
    expect(header).not.toContain('定时同步')
    expect(header).not.toContain('实时同步')
    expect(header).not.toContain('消息主题')
  })

  it('客户操作列给「生成/重置客户密钥」，确认后按客户口径显示一次性明文', async () => {
    await mountTab()
    const reset = vi.spyOn(syncApi, 'resetCustomerSecret').mockResolvedValue({ id: 406, customerName: '讯兔', secretKey: 'SK-CUSTOMER' })
    await switchTo('customers')

    const key = body().findAll('.el-table__row [data-testid="conn-customer-reset-secret"]')[0]
    if (!key) throw new Error('找不到客户密钥入口')
    await key.trigger('click')
    await flushPromises()
    const confirm = body().findAll('.el-message-box__btns button').find((item) => item.text().includes('生成'))
    if (!confirm) throw new Error('找不到确认按钮')
    await confirm.trigger('click')
    await flushPromises()

    expect(reset).toHaveBeenCalledWith(406)
    expect(body().text()).toContain('客户密钥')
    expect(body().text()).toContain('讯兔')
    expect(controlValues()).toContain('SK-CUSTOMER')
    // 客户密钥不参与签名，不能按客户端那套 client.id / client.key 口径提示
    expect(body().text()).not.toContain('client.id=')
    expect(body().text()).toContain('没有校验方消费')
  })

  /** 列表只拿到掩码，明文必须由这一列的眼睛按行去取；预先拉全量明文等于把整页密钥下发出去 */
  function mockMaskedCustomerRow(plain: string) {
    vi.spyOn(syncApi, 'customerPage').mockResolvedValue({
      list: [{ id: 406, customerName: '讯兔', secretKey: 'CUST••••••EY-5' }], total: 1,
    })
    return vi.spyOn(syncApi, 'customerSecret').mockResolvedValue({ id: 406, customerName: '讯兔', secretKey: plain })
  }

  it('客户表格有「密钥 (sk)」列：默认显示掩码，明文不在 DOM 里也不预先取', async () => {
    await mountTab()
    const secret = mockMaskedCustomerRow('MDEyMzQ1Njc4OWFiY2RlZg==')
    await switchTo('customers')

    expect(wrapper!.find('.el-table__header').text()).toContain('密钥 (sk)')
    const row = wrapper!.findAll('.el-table__row')[0].text()
    expect(row).toContain('CUST••••••EY-5')
    expect(row).not.toContain('MDEyMzQ1Njc4OWFiY2RlZg==')
    expect(secret).not.toHaveBeenCalled()
  })

  it('点眼睛才按行取明文，再点收回；收回后行内不留明文', async () => {
    await mountTab()
    const secret = mockMaskedCustomerRow('MDEyMzQ1Njc4OWFiY2RlZg==')
    await switchTo('customers')

    await wrapper!.find('[data-testid="conn-customer-secret-toggle"]').trigger('click')
    await flushPromises()
    expect(secret).toHaveBeenCalledWith(406)
    expect(wrapper!.findAll('.el-table__row')[0].text()).toContain('MDEyMzQ1Njc4OWFiY2RlZg==')

    await wrapper!.find('[data-testid="conn-customer-secret-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper!.findAll('.el-table__row')[0].text()).not.toContain('MDEyMzQ1Njc4OWFiY2RlZg==')
    expect(secret).toHaveBeenCalledTimes(1)
  })

  it('明文不是合法 AES 密钥才挂角标——只有掩码时判不出形态，不能瞎标', async () => {
    await mountTab()
    mockMaskedCustomerRow('CUSTOMER-KEY-5')
    await switchTo('customers')
    expect(wrapper!.findAll('.el-table__row')[0].text()).not.toContain('非 AES 密钥')

    await wrapper!.find('[data-testid="conn-customer-secret-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper!.findAll('.el-table__row')[0].text()).toContain('非 AES 密钥')
  })

  it('编辑客户不回填密钥：留空提交整个键不出现，填非法形态在前端就拦下', async () => {
    await mountTab()
    mockMaskedCustomerRow('MDEyMzQ1Njc4OWFiY2RlZg==')
    await switchTo('customers')
    const save = vi.spyOn(syncApi, 'saveCustomer').mockResolvedValue({})
    const vm = wrapper!.vm as unknown as {
      openCustomer: (row?: Record<string, unknown>) => void
      customerForm: { secretKey: string }
      submitCustomer: () => Promise<void>
    }

    vm.openCustomer({ id: 406, customerName: '讯兔', secretKey: 'CUST••••••EY-5' })
    await flushPromises()
    expect(vm.customerForm.secretKey).toBe('')
    await vm.submitCustomer()
    expect(save).toHaveBeenCalledWith({ id: 406, customerName: '讯兔' })

    vm.customerForm.secretKey = 'CUSTOMER-KEY-5'
    save.mockClear()
    await vm.submitCustomer()
    expect(save).not.toHaveBeenCalled()
    expect(body().text()).toContain('密钥不可用')
  })
})
