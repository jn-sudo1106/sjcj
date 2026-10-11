// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DeploymentConfigurationList from './DeploymentConfigurationList.vue'
import type { DeploymentConfiguration, RuntimeConfiguration } from '@/api/runnerManagement'

const base: DeploymentConfiguration = { deploymentId: 'deploy1', name: '新闻抓取', pathStyle: 'config', configId: '123', queueName: 'news_list', siteHost: '', codeId: '', directoryTemplate: '{configId}', entryPoint: '', nodes: [], revision: 'v1', sourceNode: { flowId: 'flow1', flowName: '新闻流程', stepId: 'step1', nodeName: '列表节点', configId: '123' } }
const items = Array.from({ length: 25 }, (_, i) => ({ ...base, deploymentId: `deploy${i}`, name: `新闻抓取${i}` }))
it('查询条件组合过滤，重置恢复全部，刷新保留当前页', async () => {
  const wrapper = mount(DeploymentConfigurationList, { props: { items, runtimes: [], loading: false, canWrite: true, failed: false }, global: { plugins: [ElementPlus] } })
  const table = wrapper.getComponent({ name: 'ElTable' })
  const pagination = wrapper.getComponent({ name: 'ElPagination' })
  pagination.vm.$emit('update:current-page', 2); await wrapper.vm.$nextTick()
  expect(table.props('data')).toHaveLength(5)
  await wrapper.get('button[aria-label="刷新部署列表"]').trigger('click')
  await wrapper.setProps({ items: [...items] })
  expect(pagination.props('currentPage')).toBe(2)
  await wrapper.get('input[aria-label="查询来源流程"]').setValue('列表节点')
  await wrapper.get('input[aria-label="查询任务队列"]').setValue('missing')
  await wrapper.get('form').trigger('submit')
  expect(table.props('data')).toHaveLength(0)
  expect(pagination.props('currentPage')).toBe(1)
  await wrapper.get('input[aria-label="查询任务队列"]').setValue('news')
  await wrapper.get('input[aria-label="查询节点配置 ID"]').setValue('123')
  await wrapper.get('input[aria-label="查询部署名称"]').setValue('新闻抓取24')
  await wrapper.get('form').trigger('submit')
  expect(table.props('data')).toEqual([items[24]])
  await wrapper.findAll('button').find(item => item.text() === '重置')!.trigger('click')
  expect(table.props('data')).toHaveLength(20)
  wrapper.unmount()
})
it('机器数按实例去重，缺失更新时间不伪造，只读用户仅能查看', async () => {
  const runtimes = [{ deploymentId: 'deploy1', runnerId: 'r1' }, { deploymentId: 'deploy1', runnerId: 'r1' }, { deploymentId: 'deploy1', runnerId: 'r2' }] as RuntimeConfiguration[]
  const wrapper = mount(DeploymentConfigurationList, { props: { items: [base], runtimes, loading: false, canWrite: false, failed: false }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(wrapper.get('[title="按 Runner 实例去重统计"]').text()).toBe('2')
  expect(wrapper.get('[title="历史配置未记录更新时间"]').text()).toBe('—')
  expect(wrapper.find('[data-testid="deployment-new"]').exists()).toBe(false)
  await wrapper.get('[data-testid="deployment-open-deploy1"]').trigger('click')
  expect(wrapper.emitted('open')).toEqual([['deploy1']])
  wrapper.unmount()
})
