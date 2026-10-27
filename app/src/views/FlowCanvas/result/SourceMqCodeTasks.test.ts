// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceMqCodeTasks from './SourceMqCodeTasks.vue'
import { sourceApi, flowCenterApi, type Source } from '@/api'
vi.mock('@/api', () => ({ sourceApi: { sourceDetail: vi.fn(), sendCodeConfig: vi.fn() }, flowCenterApi: { steps: vi.fn() } }))
const source = { sourceId: '123', name: '网站新闻', flowId: '55', url: 'https://example.net' } as Source
beforeEach(() => {
  vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ ...source, defaultFlowId: '66' })
  vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: '1', name: '首步', sourceId: '', configId: '101', enabled: true, isRoot: true }])
  vi.mocked(sourceApi.sendCodeConfig).mockResolvedValue({ sourceId: '123', configId: '900', queue: 'code-default', requestCnt: 1, sendCnt: 1, failCnt: 0, taskIds: ['9223372036854775806'], tasks: [] })
})
afterEach(() => vi.resetAllMocks())
const mountPanel = (sources = [source]) => mount(SourceMqCodeTasks, { props: { sources }, global: { plugins: [ElementPlus] } })
const submit = async (w: ReturnType<typeof mountPanel>) => { await w.find('button').trigger('click'); await flushPromises() }
it('默认不传 configId 和 queue；以节点 stepId 生成，不能把节点 configId 当派发配置', async () => {
  const w = mountPanel(); await submit(w)
  expect(flowCenterApi.steps).toHaveBeenCalledWith('66', { withConfigDetails: false })
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '123', flowId: '66', stepId: '1' })
  expect(w.text()).toContain('code-default'); expect(w.text()).toContain('9223372036854775806')
  w.unmount()
})
it('指定 201 配置和队列通过 JSON 发送，ID 保持字符串精度', async () => {
  const w = mountPanel()
  await w.find('[aria-label="201 派发配置 ID"]').setValue(' 9223372036854775806 ')
  await w.find('[aria-label="派发队列"]').setValue('custom')
  await w.find('[aria-label="队列名称"]').setValue('  code-manual  ')
  await submit(w)
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '123', flowId: '66', stepId: '1', configId: '9223372036854775806', queue: 'code-manual' })
  w.unmount()
})
it('指定队列为空或多队列时不发送；切回默认队列不携带旧值', async () => {
  const w = mountPanel(); await w.find('[aria-label="派发队列"]').setValue('custom'); await submit(w)
  expect(w.text()).toContain('请指定一个有效队列'); expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  await w.find('[aria-label="队列名称"]').setValue('a,b'); await submit(w)
  expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  await w.find('[aria-label="派发队列"]').setValue('default'); await submit(w)
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '123', flowId: '66', stepId: '1' })
  w.unmount()
})
it('单个源失败继续派发其他源，并保留真实错误与部分失败任务信息', async () => {
  vi.mocked(sourceApi.sourceDetail).mockImplementation(async id => ({ ...source, sourceId: id }))
  vi.mocked(sourceApi.sendCodeConfig).mockRejectedValueOnce(new Error('没有启用的 config_type=201 配置')).mockResolvedValueOnce({ sourceId: '124', configId: '900', queue: 'code-default', requestCnt: 2, sendCnt: 1, failCnt: 1, taskIds: ['1001'], tasks: [{ stepId: '1', taskIds: ['1001'], errors: ['broker unavailable'] }] })
  const w = mountPanel([source, { ...source, sourceId: '124' }]); await submit(w)
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledTimes(2)
  expect(w.text()).toContain('没有启用的 config_type=201 配置'); expect(w.text()).toContain('broker unavailable'); expect(w.text()).toContain('1001')
  w.unmount()
})
it('没有有效默认流程或 ROOT 节点时不发送', async () => {
  vi.mocked(flowCenterApi.steps).mockResolvedValue([])
  const w = mountPanel(); await submit(w)
  expect(w.text()).toContain('默认流程没有可用的 ROOT 步骤'); expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ ...source, flowId: undefined }); await submit(w)
  expect(w.text()).toContain('源没有生效的默认流程')
  w.unmount()
})
it('指定步骤沿用页面流程与版本，派发配置仍由表单独立填写', async () => {
  const w = mount(SourceMqCodeTasks, { props: { targets: [{ sourceId: '123', flowId: '77', stepId: '2', ver: '99' }] }, global: { plugins: [ElementPlus] } })
  await w.find('[aria-label="201 派发配置 ID"]').setValue('900')
  await submit(w)
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '123', flowId: '77', stepId: '2', ver: '99', configId: '900' })
  expect(sourceApi.sourceDetail).not.toHaveBeenCalled(); expect(flowCenterApi.steps).not.toHaveBeenCalled()
  w.unmount()
})
it('跨源数据分别用各源的默认流程与入参表发后续代码，不误发 ROOT', async () => {
  vi.mocked(sourceApi.sourceDetail).mockImplementation(async id => ({ ...source, sourceId: id, defaultFlowId: id === '123' ? '66' : '77' }))
  const w = mount(SourceMqCodeTasks, { props: { targets: [{ sourceId: '123', entryTypeId: 11, entryIds: ['901'] }, { sourceId: '124', entryTypeId: 11, entryIds: ['902'] }] }, global: { plugins: [ElementPlus] } })
  await submit(w)
  expect(sourceApi.sendCodeConfig).toHaveBeenNthCalledWith(1, { sourceId: '123', flowId: '66', entryTypeId: 11, entryIds: ['901'] })
  expect(sourceApi.sendCodeConfig).toHaveBeenNthCalledWith(2, { sourceId: '124', flowId: '77', entryTypeId: 11, entryIds: ['902'] })
  expect(flowCenterApi.steps).not.toHaveBeenCalled()
  expect(w.emitted('busy')).toEqual([[true], [false]])
  w.unmount()
})
it('生成指定节点的数据脚本时携带 stepId，保留数据上下文', async () => {
  const w = mount(SourceMqCodeTasks, { props: { targets: [{ sourceId: '123', flowId: '77', stepId: '2', entryTypeId: 11, entryIds: ['901'] }] }, global: { plugins: [ElementPlus] } })
  await submit(w)
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '123', flowId: '77', stepId: '2', entryTypeId: 11, entryIds: ['901'] })
  w.unmount()
})
