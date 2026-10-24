// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import { sourceApi, configApi } from '@/api'
import type { DeploymentConfiguration } from '@/api/runnerManagement'
import DeploymentConfigDrawer from './DeploymentConfigDrawer.vue'

vi.mock('@/api', () => ({ sourceApi: { sourcePaged: vi.fn() }, configApi: { configDetailRaw: vi.fn() } }))
const item: DeploymentConfiguration = { deploymentId: 'deployment', name: '新闻部署', configId: '123',
  pathStyle: 'config', codeId: '', queueName: 'news_list', siteHost: '', directoryTemplate: '{configId}', entryPoint: '', nodes: [], revision: 'v1' }
const config = { configId: '123', configName: '新闻列表配置', configUrl: 'https://example.com/news', topic: 'news_list', snatchConf: '<xml>完整抓取配置</xml>', coreParam: '完整核心参数', params: [] }
const source = { sourceId: '456', siteId: '789', name: '新闻源', url: 'https://example.com/news', configId: '123' }
beforeEach(() => {
  vi.mocked(configApi.configDetailRaw).mockResolvedValue(config)
  vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ list: [source], total: 1 } as never)
})
afterEach(() => { vi.resetAllMocks(); document.body.innerHTML = '' })
function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }, { path: '/flows', component: { template: '<div />' } }] })
  return mount(DeploymentConfigDrawer, { global: { plugins: [router, ElementPlus], stubs: { ElDrawer: { props: ['modelValue'], template: '<aside v-if="modelValue"><slot /></aside>' } } } })
}
it('点击配置显示完整配置和关联源，源链接保留网站与源身份并在新标签页打开', async () => {
  const wrapper = setup()
  await wrapper.vm.open(item); await flushPromises()
  expect(configApi.configDetailRaw).toHaveBeenCalledWith('123', { backendScope: 'default' })
  expect(sourceApi.sourcePaged).toHaveBeenCalledWith({ configId: '123', page: 1, size: 5 })
  expect(wrapper.text()).toContain('新闻列表配置')
  expect(wrapper.text()).toContain('完整抓取配置')
  expect(wrapper.text()).toContain('完整核心参数')
  const link = wrapper.get('[data-testid="deployment-config-source-456"]')
  expect(link.attributes('target')).toBe('_blank')
  const target = new URL(link.attributes('href')!, 'http://localhost')
  expect(target.pathname).toBe('/canvas')
  expect(Object.fromEntries(target.searchParams)).toEqual({ sourceId: '456', siteId: '789', view: 'overview' })
  expect(wrapper.text()).toContain('历史部署未记录具体来源流程节点')
  wrapper.unmount()
})
it('流程节点部署沿用流程后台并提供来源流程入口', async () => {
  const wrapper = setup()
  await wrapper.vm.open({ ...item, sourceNode: { flowId: 'flow1', flowName: '新闻流程', stepId: 'step1', nodeName: '抓取列表', configId: '123' } }); await flushPromises()
  expect(configApi.configDetailRaw).toHaveBeenCalledWith('123', { backendScope: 'flow' })
  expect(wrapper.get('[data-testid="deployment-config-flow"]').text()).toContain('抓取列表')
  expect(wrapper.get('[data-testid="deployment-config-flow"] a').attributes('href')).toBe('/flows?q=flow1')
  wrapper.unmount()
})
it('历史配置显示反查的全部来源，同时保持原有配置详情接口范围', async () => {
  const wrapper = setup()
  await wrapper.vm.open({ ...item, relatedSourceNodes: [
    { flowId: '10', flowName: '原流程', stepId: '100', nodeName: '原节点', configId: '123' },
    { flowId: '11', flowName: '新流程', stepId: '101', nodeName: '新节点', configId: '123', isDraft: true },
  ] }); await flushPromises()
  expect(configApi.configDetailRaw).toHaveBeenCalledWith('123', { backendScope: 'default' })
  expect(wrapper.findAll('[data-testid="deployment-config-flow"]')).toHaveLength(2)
  expect(wrapper.text()).toContain('新流程（草稿）')
  expect(wrapper.text()).toContain('流程 ID：11 · 节点 ID：101')
  wrapper.unmount()
})
it('关联源查询失败不阻止配置详情展示，并支持刷新重试', async () => {
  vi.mocked(sourceApi.sourcePaged).mockRejectedValueOnce(new Error('服务暂时不可用'))
  const wrapper = setup(); await wrapper.vm.open(item); await flushPromises()
  expect(wrapper.text()).toContain('关联源查询失败：服务暂时不可用')
  expect(wrapper.text()).toContain('新闻列表配置')
  await wrapper.get('[data-testid="deployment-config-source-refresh"]').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-testid="deployment-config-source-456"]').exists()).toBe(true)
  wrapper.unmount()
})
it('快速切换配置时较早的关联源响应不会覆盖新的配置', async () => {
  let finish!: (value: never) => void
  vi.mocked(sourceApi.sourcePaged).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const wrapper = setup()
  const first = wrapper.vm.open(item); await flushPromises()
  await wrapper.vm.open({ ...item, configId: '999', name: '第二个配置' }); await flushPromises()
  finish({ list: [{ ...source, sourceId: 'old', name: '旧结果' }], total: 1 } as never); await first; await flushPromises()
  expect(wrapper.get('[data-testid="deployment-config-context"]').text()).toContain('第二个配置')
  expect(wrapper.text()).not.toContain('旧结果')
  wrapper.unmount()
})
