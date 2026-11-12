// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import ElementPlus, { ElMessageBox, ElSelect } from 'element-plus'
import { monitorBatchesApi, type MonitorBatch } from '@/api/monitorBatches'
import Dialog from './MonitorBatchDialog.vue'

vi.mock('@/api/monitorBatches', () => ({ monitorBatchesApi: {
  list: vi.fn(), create: vi.fn(), get: vi.fn(), action: vi.fn(), delivery: vi.fn(),
} }))

const job = (patch: Partial<MonitorBatch> = {}): MonitorBatch => ({
  batchId: 'batch1', status: 'previewed', action: 'preview', createdAt: '2026-11-11', message: '预检完成',
  total: 1, prepared: 1, counts: { ready: 1 }, options: { window: 'hours', hours: 24, schedule: '0 0 * * * ?' },
  items: [{ sourceId: '100', name: '测试源', tableId: '1', tableName: 'sense_data.news', status: 'ready', checkedCount: 0 }],
  ...patch,
})
let wrapper: VueWrapper
async function open() {
  vi.mocked(monitorBatchesApi.list).mockResolvedValue([job()])
  vi.mocked(monitorBatchesApi.create).mockResolvedValue({ batchId: 'batch1' })
  vi.mocked(monitorBatchesApi.get).mockResolvedValue(job())
  wrapper = mount(Dialog, { props: { modelValue: false, siteId: '200' }, global: { plugins: [ElementPlus], stubs: {
    ElDialog: defineComponent({ props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' }),
    SourceListDialog: true,
  } } })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
}
function button(text: string) { return wrapper.findAll('button').find(row => row.text().includes(text))! }
async function preview() {
  await wrapper.find('textarea').setValue('100\n101')
  await button('开始预检').trigger('click')
  await flushPromises()
}
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })

describe('批量补齐入库监控', () => {
  it('先预检圈定范围，确认后才新增', async () => {
    await open()
    await preview()
    expect(monitorBatchesApi.create).toHaveBeenCalledWith({ scope: { sourceIds: ['100', '101'], siteId: '200', name: '' }, allSources: false,
      options: { window: 'hours', hours: 24, schedule: '0 0 * * * ?' } })
    expect(monitorBatchesApi.action).not.toHaveBeenCalled()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await button('补齐 1 项检查').trigger('click')
    await flushPromises()
    expect(monitorBatchesApi.action).toHaveBeenCalledWith('batch1', 'apply')
  })

  it('恢复历史批次，失败回执不能显示 SMTP 已接受', async () => {
    await open()
    vi.mocked(monitorBatchesApi.get).mockResolvedValue(job({ status: 'completed', counts: { executed: 1 },
      delivery: { configured: true, enabled: true, recipient: 'test@example.com', error: '', receipts: [
        { status: 'failed', subject: '数据异常', messageId: '<test@local>', recipient: 'test@example.com', message: 'SMTP 登录失败', createdAt: '2026-11-11' },
      ] } }))
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'batch1')
    wrapper.findComponent(ElSelect).vm.$emit('change', 'batch1')
    await flushPromises()
    expect(wrapper.text()).toContain('投递失败')
    expect(wrapper.text()).not.toContain('SMTP 已接受')
    expect(wrapper.text()).toContain('已启用')
  })

  it('关闭弹窗停止前端轮询，重新打开恢复回查', async () => {
    vi.useFakeTimers()
    await open()
    vi.mocked(monitorBatchesApi.get).mockResolvedValue(job({ status: 'preparing' }))
    await preview()
    const count = vi.mocked(monitorBatchesApi.get).mock.calls.length
    await wrapper.setProps({ modelValue: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitorBatchesApi.get).toHaveBeenCalledTimes(count)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(monitorBatchesApi.get).toHaveBeenCalledTimes(count + 1)
  })

  it('预检网络错误保留源输入并显示真实错误', async () => {
    await open()
    vi.mocked(monitorBatchesApi.create).mockRejectedValue(new Error('业务接口超时'))
    await preview()
    expect(wrapper.text()).toContain('业务接口超时')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('100\n101')
    expect(monitorBatchesApi.action).not.toHaveBeenCalled()
  })
})
