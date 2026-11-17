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
  const clients = vi.spyOn(syncApi, 'clients').mockResolvedValue({
    list: [{ id: 10, customerId: 5, clientName: '测试客户端', timingSync: 'on', fileSync: 'on' }],
    total: 1,
  })
  const logs = vi.spyOn(syncApi, 'logs').mockResolvedValue({ list: [], total: 0 })
  const stats = vi.spyOn(syncApi, 'statistics').mockResolvedValue({ list: [], total: 0 })
  const fileLogs = vi.spyOn(syncApi, 'fileLogs').mockResolvedValue({
    list: [{
      id: 101,
      clientId: 10,
      fileName: 'contract_01.pdf',
      sourceTable: 'tb_contract',
      sourceCode: 'src_mysql',
      targetCode: 'oss_target',
      filePath: '/data/files/contract_01.pdf',
      targetUrl: 'oss://bucket/contract_01.pdf',
      fileSize: 2048,
      status: 4,
      downloadStartTime: '2026-11-17 10:00:00',
      downloadEndTime: '2026-11-17 10:00:05',
      uploadStartTime: '2026-11-17 10:00:05',
      uploadEndTime: '2026-11-17 10:00:10',
      createTime: '2026-11-17 10:00:00',
      remark: '同步成功',
    }],
    total: 1,
  })
  wrapper = mount(LogsTab, { attachTo: document.body, global: { plugins: [ElementPlus] } })
  await flushPromises()
  return { clients, logs, stats, fileLogs }
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

  it('展示「任务日志」「统计日志」「文件同步列表」三个页签，切换到文件同步列表使用相同筛选条件', async () => {
    const { fileLogs } = await mountTab()
    const tabPanes = wrapper!.findAll('.el-tabs__item')
    expect(tabPanes.map((t) => t.text())).toEqual(['任务日志', '统计日志', '文件同步列表'])

    // 点击「文件同步列表」
    await tabPanes[2].trigger('click')
    await flushPromises()

    // 切到文件同步列表后，替换为「源表」输入框（去掉 DB 筛选，增加 sourceTable 查询）
    const inputsAfter = wrapper!.findAllComponents(ElInput).filter((item) => item.classes('sync-input'))
    expect(inputsAfter).toHaveLength(1)
    expect(inputsAfter[0].props('placeholder')).toBe('源表')

    expect(fileLogs).toHaveBeenCalledTimes(1)
    const callArgs = fileLogs.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArgs).toMatchObject({
      customerId: '',
      clientId: '',
      schemaName: '',
      sourceTable: '',
      taskIdSet: [],
      status: '',
      type: '',
      pageNo: 1,
      pageSize: 10,
    })
    expect(callArgs.startTime).toBeDefined()
    expect(callArgs.endTime).toBeDefined()

    // 输入源表并查询
    inputsAfter[0].vm.$emit('update:modelValue', 'tb_contract')
    await flushPromises()
    const searchBtn = wrapper!.findAll('.sync-filter-actions .el-button')[0]
    await searchBtn.trigger('click')
    await flushPromises()

    const latestCall = fileLogs.mock.calls[fileLogs.mock.calls.length - 1]?.[0] as Record<string, unknown>
    expect(latestCall.sourceTable).toBe('tb_contract')
    expect(latestCall.schemaName).toBe('')

    // 渲染文件列表表格
    expect(wrapper!.text()).toContain('contract_01.pdf')
    expect(wrapper!.text()).toContain('tb_contract')
    expect(wrapper!.text()).toContain('测试客户端')
    expect(wrapper!.text()).toContain('同步完成')
    expect(wrapper!.text()).toContain('2.0 KB')

    // 点击详情打开抽屉
    const detailBtn = wrapper!.find('[data-testid="file-detail"]')
    expect(detailBtn.exists()).toBe(true)
    await detailBtn.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('文件同步详情')
    expect(wrapper!.text()).toContain('oss://bucket/contract_01.pdf')
    expect(wrapper!.text()).toContain('src_mysql')
    expect(wrapper!.text()).toContain('oss_target')
  })
})
