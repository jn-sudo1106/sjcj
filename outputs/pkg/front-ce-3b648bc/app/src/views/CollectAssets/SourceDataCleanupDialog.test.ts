// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { dataApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import SourceDataCleanupDialog from './SourceDataCleanupDialog.vue'

let wrapper: VueWrapper
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
  vi.stubEnv('VITE_API_PROXY_TARGET', 'http://124.223.180.186:9999')
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ list1: [{ tableId: '6200042', name: '测试数据', tableName: 'tb_test', fields: [] }], list2: [], list3: [] })
  vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({ tableId: '6200042', tableName: 'tb_test', state: 'C', fields: [] })
  vi.spyOn(dataApi, 'rowDelete').mockResolvedValue({ success: 2 })
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
})
async function open(ids = ['1001', '1002']) {
  wrapper = mount(SourceDataCleanupDialog, { props: { modelValue: true, sourceIds: ids }, global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
  await flushPromises()
}
async function preview() {
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '6200042')
  await flushPromises()
  await wrapper.get('[data-testid="cleanup-preview"]').trigger('click')
  await flushPromises()
}
describe('批量清理源数据', () => {
  it('校验源 ID 和目标表，预览不发删除请求，字段变更后确认失效', async () => {
    await open()
    await wrapper.get('[data-testid="cleanup-preview"]').trigger('click')
    expect(wrapper.text()).toContain('请选择目标数据表')
    await wrapper.get('textarea').setValue('1001，1002 1001\n1003')
    await preview()
    expect(wrapper.get('[data-testid="cleanup-review"]').text()).toContain('3 个源')
    expect(wrapper.text()).toContain('6200042')
    expect(dataApi.rowDelete).not.toHaveBeenCalled()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 1)
    await flushPromises()
    expect(wrapper.find('[data-testid="cleanup-submit"]').exists()).toBe(false)
    await wrapper.get('textarea').setValue('1001 OR 1=1')
    await wrapper.get('[data-testid="cleanup-preview"]').trigger('click')
    expect(wrapper.text()).toContain('请输入有效的数字源 ID')
    expect(dataApi.rowDelete).not.toHaveBeenCalled()
  })
  it('逐个传入单源和目标表，全部成功后不能重复提交', async () => {
    await open()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 1)
    await preview()
    await wrapper.get('[data-testid="cleanup-submit"]').trigger('click')
    await flushPromises()
    expect(dataApi.rowDelete).toHaveBeenNthCalledWith(1, '6200042', { sourceId: '1001', all: 1 })
    expect(dataApi.rowDelete).toHaveBeenNthCalledWith(2, '6200042', { sourceId: '1002', all: 1 })
    expect(wrapper.text()).toContain('已完成 2/2 个源')
    expect(wrapper.text()).toContain('清理 4 条')
    expect(wrapper.find('[data-testid="cleanup-submit"]').exists()).toBe(false)
    expect(wrapper.emitted('cleaned')).toHaveLength(1)
  })
  it('部分失败停止，保留失败与未发起的源，不自动重试', async () => {
    vi.mocked(dataApi.rowDelete).mockResolvedValueOnce({ success: 2 }).mockRejectedValueOnce(new Error('网络中断'))
    await open(['1001', '1002', '1003'])
    await preview()
    await wrapper.get('[data-testid="cleanup-submit"]').trigger('click')
    await flushPromises()
    expect(dataApi.rowDelete).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已完成 1/3 个源')
    expect(wrapper.text()).toContain('源 1002 清理未完成：网络中断')
    expect(wrapper.get('textarea').element).toHaveProperty('value', '1002, 1003')
  })
  it('正式表拒绝清理，取消确认不发请求', async () => {
    vi.mocked(dataApi.tableMeta).mockResolvedValueOnce({ tableId: '6200042', tableName: 'tb_test', state: 'AC', fields: [] })
    await open()
    await preview()
    expect(wrapper.text()).toContain('仅支持清理测试表')
    expect(wrapper.find('[data-testid="cleanup-submit"]').exists()).toBe(false)
    await preview()
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
    await wrapper.get('[data-testid="cleanup-submit"]').trigger('click')
    await flushPromises()
    expect(dataApi.rowDelete).not.toHaveBeenCalled()
  })
  it.each(['production', 'protected-backend', 'read'])('权限边界：%s 无法预览或清理', async mode => {
    if (mode === 'production') vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    else if (mode === 'protected-backend') vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    else useAuthStore().roles = ['read']
    await open()
    expect(wrapper.text()).toContain('仅管理员可在非生产环境清理源数据')
    expect(wrapper.get('[data-testid="cleanup-preview"]').attributes('disabled')).toBeDefined()
    expect(dataApi.tableMeta).not.toHaveBeenCalled()
    expect(dataApi.rowDelete).not.toHaveBeenCalled()
  })
})
