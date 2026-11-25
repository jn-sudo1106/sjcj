// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { configApi, dataApi, sourceApi, type Config, type Source } from '@/api'
import DataImportDialog from './DataImportDialog.vue'

let wrapper: VueWrapper
const source: Source = { sourceId: '391008025', name: '企业客户类型标签', configId: '81952', mainTable: '2102180', url: '', owner: 'admin', state: 'C' }
const config = (configId: string, entryTypeId?: string): Config => ({ configId, name: `配置${configId}`, enabled: true, entryTypeId })

// config/configDetail 只用来校验「配置的输出实体 == 目标表」；configPaged 反查本表可用配置。
function mockConfigs(details: Config[], tableConfigs: Config[] = []) {
  vi.spyOn(configApi, 'configDetail').mockImplementation(async (id: string) => details.find(item => item.configId === id) ?? null)
  vi.spyOn(configApi, 'configPaged').mockResolvedValue({ total: tableConfigs.length, list: tableConfigs })
}

beforeEach(() => {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
  vi.spyOn(dataApi, 'importData').mockResolvedValue({ success: true, message: '导入成功' })
  mockConfigs([config('81952', '2102181'), config('81950', '2102181')])
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
  it('源的配置属于本表时直接沿用，上传保留目标表并携带 Excel、源和配置', async () => {
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
  it('源的配置属于别的表时改按目标表反查配置（证券基本信息 2102205 → 1910079）', async () => {
    // 复现 2026-11-25 的故障：源 491000039 的主配置 1910077 是入口配置，ENTRY_TYPE_ID 为空，
    // 原样提交会被后端 TbEntryBatchController 拒绝：「传入的configId与实体ID不匹配」。
    vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ ...source, sourceId: '491000039', configId: '1910077' })
    mockConfigs([config('1910077')], [config('1910079', '2102205')])
    wrapper = mount(DataImportDialog, {
      props: { modelValue: false, tableId: '2102205', sourceId: '491000039', initialConfigId: '' },
      global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(configApi.configPaged).toHaveBeenCalledWith(expect.objectContaining({ entryTypeId: '2102205' }))
    expect(configInput().props('modelValue')).toBe('1910079')
    expect(wrapper.text()).toContain('已按目标表自动选择配置 1910079')
  })
  it('关闭或切换源后，旧请求不能覆盖当前导入配置', async () => {
    let finish!: (source: Source) => void
    vi.mocked(sourceApi.sourceDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await open()
    expect(configInput().props('disabled')).toBe(true)
    await wrapper.setProps({ modelValue: false })
    vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ ...source, sourceId: '391008026', configId: '81953' })
    mockConfigs([config('81952', '2102181'), config('81953', '2102181')])
    await wrapper.setProps({ modelValue: true, sourceId: '391008026' })
    await flushPromises()
    finish(source)
    await flushPromises()
    expect(configInput().props('modelValue')).toBe('81953')
  })
  it('读源配置失败显示真实原因；本表也没有配置时允许留空导入', async () => {
    vi.mocked(sourceApi.sourceDetail).mockRejectedValue(new Error('配置读取失败'))
    await open()
    expect(wrapper.text()).toContain('配置读取失败')
    expect(wrapper.text()).toContain('本表暂无可用配置')
    expect(configInput().props('disabled')).toBe(false)
    expect(configInput().props('modelValue')).toBe('')
    const file = await chooseFile()
    await upload()
    expect(dataApi.importData).toHaveBeenCalledWith({ file, tableId: '2102181', sourceId: '391008025', configId: '' })
  })
  it('读源配置失败但本表有配置时自动补上，手填非法配置被拦下', async () => {
    vi.mocked(sourceApi.sourceDetail).mockRejectedValue(new Error('配置读取失败'))
    mockConfigs([config('81952', '2102181')], [config('81952', '2102181')])
    await open()
    expect(configInput().props('modelValue')).toBe('81952')
    configInput().vm.$emit('update:modelValue', 'abc')
    await chooseFile()
    await upload()
    expect(dataApi.importData).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('配置 ID 只能是数字')
    expect(wrapper.emitted('uploaded')).toBeUndefined()
  })
  it('上传业务失败保留真实错误', async () => {
    await open()
    await chooseFile()
    vi.mocked(dataApi.importData).mockResolvedValue({ success: false, message: 'Excel 表头不匹配' })
    await upload()
    expect(wrapper.text()).toContain('Excel 表头不匹配')
    expect(wrapper.emitted('uploaded')).toBeUndefined()
  })
})