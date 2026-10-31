// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { dataApi, sourceApi, type Source } from '@/api'
import DataImportDialog from './DataImportDialog.vue'

let wrapper: VueWrapper
const source: Source = { sourceId: '391008025', name: '企业客户类型标签', configId: '81952', mainTable: '2102180', url: '', owner: 'admin', state: 'C' }
beforeEach(() => {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
  vi.spyOn(dataApi, 'importData').mockResolvedValue({ success: true, message: '导入成功' })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function open(initialConfigId = '') {
  wrapper = mount(DataImportDialog, {
    props: { modelValue: false, tableId: '2102181', sourceId: '391008025', initialConfigId },
    global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
}
function configInput() { return wrapper.findAllComponents({ name: 'ElInput' })[2]! }
async function chooseFile() {
  const file = new File(['Excel test fixture'], '企业类型标签.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  return file
}
async function upload() {
  await wrapper.findAll('button').find(button => button.text() === '开始上传')!.trigger('click')
  await flushPromises()
}
describe('Excel 数据导入', () => {
  it('空表从所选源补齐配置，上传保留目标表并携带 Excel、源和配置', async () => {
    await open()
    expect(sourceApi.sourceDetail).toHaveBeenCalledWith('391008025')
    expect(configInput().props('modelValue')).toBe('81952')
    const file = await chooseFile()
    await upload()
    expect(dataApi.importData).toHaveBeenCalledWith({ file, tableId: '2102181', sourceId: '391008025', configId: '81952' })
    expect(wrapper.emitted('uploaded')).toHaveLength(1)
  })
  it('已有当前源的配置时保留原值，不额外请求源详情', async () => {
    await open('81950')
    expect(sourceApi.sourceDetail).not.toHaveBeenCalled()
    expect(configInput().props('modelValue')).toBe('81950')
  })
  it('关闭或切换源后，旧请求不能覆盖当前导入配置', async () => {
    let finish!: (source: Source) => void
    vi.mocked(sourceApi.sourceDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await open()
    expect(configInput().props('disabled')).toBe(true)
    await wrapper.setProps({ modelValue: false })
    vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ ...source, sourceId: '391008026', configId: '81953' })
    await wrapper.setProps({ modelValue: true, sourceId: '391008026' })
    await flushPromises()
    finish(source)
    await flushPromises()
    expect(configInput().props('modelValue')).toBe('81953')
  })
  it('读取配置失败显示真实原因并允许手填，上传业务失败保留错误', async () => {
    vi.mocked(sourceApi.sourceDetail).mockRejectedValue(new Error('配置读取失败'))
    await open()
    expect(wrapper.text()).toContain('配置读取失败')
    expect(configInput().props('disabled')).toBe(false)
    configInput().vm.$emit('update:modelValue', '81952')
    await chooseFile()
    vi.mocked(dataApi.importData).mockResolvedValue({ success: false, message: 'Excel 表头不匹配' })
    await upload()
    expect(wrapper.text()).toContain('Excel 表头不匹配')
    expect(wrapper.emitted('uploaded')).toBeUndefined()
  })
})
