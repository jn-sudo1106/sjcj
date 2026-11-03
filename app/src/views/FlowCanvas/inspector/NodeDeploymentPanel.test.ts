// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElOption, ElRadioGroup, ElSelect } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type GeneratedDeploymentJob, type RunnerInstance } from '@/api/runnerManagement'
import NodeDeploymentPanel from './NodeDeploymentPanel.vue'
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { generatedDeployments: vi.fn(), nodeDeploymentResource: vi.fn(), saveNodeDeploymentResource: vi.fn(), instances: vi.fn(), generatedDeploymentAction: vi.fn(), deployGeneratedArchive: vi.fn() } }))
const resources = [
  { resourceId: 'default-resource', resourceName: '网页抓取测试机', isDefault: true, configType: '90', configTypeName: '网页抓取', environment: 'test' as const, runnerId: 'runner2', directoryTemplate: '{configId}/{environment}', enabled: true },
  { resourceId: 'alternative-resource', resourceName: '备用抓取机', isDefault: false, configType: '90', configTypeName: '网页抓取', environment: 'test' as const, runnerId: 'runner3', directoryTemplate: '{configId}/{environment}', enabled: true },
]
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockImplementation(async context => ({ ...context, resourceId: '', revision: 'v1', defaultResourceId: context.environment === 'test' ? 'default-resource' : '', effectiveResourceId: context.environment === 'test' ? 'default-resource' : '', resources: context.environment === 'test' ? resources : [], targetPath: `${context.configId}/test`, deploymentDirectory: context.environment === 'test' ? `D:\\Runner2\\instance\\${context.configId}\\test` : '', pathError: context.environment === 'test' ? '' : '待选择可用部署资源' }))
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementation(async body => ({ ...body, revision: 'v2', defaultResourceId: 'default-resource', effectiveResourceId: body.resourceId || 'default-resource', resources,
    targetPath: `${body.configId}/test`, deploymentDirectory: `D:\\${body.resourceId ? 'Runner1' : 'Runner2'}\\instance\\${body.configId}\\test` }))
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ runnerId: 'runner2', name: '服务器201', ipAddress: '192.168.1.201', installDirectory: 'D:\\Runner2\\instance' }, { runnerId: 'runner3', name: '服务器202', ipAddress: '192.168.1.202', installDirectory: 'D:\\Runner1\\instance', status: 'offline' }] as RunnerInstance[])
})
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
async function setup(admin = true) {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'read']
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings', component: { template: '<div />' } }] })
  await router.push('/'); await router.isReady()
  wrapper = mount(NodeDeploymentPanel, { props: { sourceId: '430024910', flowId: '21000040', stepId: '41895', configId: '1401218', configType: '90' }, global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises(); return wrapper
}
it('自动展示默认值和同类型备选资源，节点内没有修改默认入口', async () => {
  const w = await setup()
  expect(runnerManagementApi.generatedDeployments).toHaveBeenCalledWith({ sourceId: '430024910', flowId: '21000040', stepId: '41895', configId: '1401218', size: 100 })
  expect(w.text()).toContain('网页抓取测试机 · 192.168.1.201')
  expect(w.text()).not.toContain('服务器201')
  expect(w.text()).toContain('生成并提交成功后自动部署测试')
  expect(w.getComponent(ElSelect).props('modelValue')).toBe('default-resource')
  expect(w.text()).not.toContain('修改默认资源')
  expect(w.getComponent(ElSelect).text()).toContain('默认资源')
})
it('选择备选资源只保存节点与环境，再切回默认不修改全局资源', async () => {
  const w = await setup()
  expect(w.get('[data-testid="node-final-deployment-directory"]').text()).toContain('D:\\Runner2\\instance\\1401218\\test')
  w.getComponent(ElSelect).vm.$emit('change', 'alternative-resource'); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledWith({ sourceId: '430024910', flowId: '21000040', stepId: '41895', configId: '1401218', configType: '90', environment: 'test', resourceId: 'alternative-resource', revision: 'v1' })
  expect(w.getComponent(ElSelect).props('modelValue')).toBe('alternative-resource')
  expect(w.get('[data-testid="node-final-deployment-directory"]').text()).toContain('D:\\Runner1\\instance\\1401218\\test')
  w.getComponent(ElSelect).vm.$emit('change', 'default-resource'); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenLastCalledWith(expect.objectContaining({ environment: 'test', resourceId: '', revision: 'v2' }))
  expect(w.getComponent(ElSelect).props('modelValue')).toBe('default-resource')
  expect(w.get('[data-testid="node-final-deployment-directory"]').text()).toContain('D:\\Runner2\\instance\\1401218\\test')
})
it('所选资源失效时保留选择并显示错误，不能悄悄回到默认', async () => {
  const w = await setup()
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockRejectedValue(new Error('所选资源不属于当前节点类型和环境，或已经停用'))
  w.getComponent(ElSelect).vm.$emit('change', 'bad-resource'); await flushPromises()
  expect(w.get('[role="alert"]').text()).toContain('已经停用')
  expect(w.getComponent(ElSelect).props('modelValue')).toBe('default-resource')
})
it('切换生产显示生产部署记录和等待状态，不把测试机器当生产默认', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [{ environment: 'production', status: 'waiting_resource', gitCommit: 'a'.repeat(40), message: '等待生产资源' } as GeneratedDeploymentJob], total: 1 })
  const w = await setup()
  w.getComponent(ElRadioGroup).vm.$emit('update:modelValue', 'production'); await flushPromises()
  expect(w.text()).toContain('待分配资源'); expect(w.text()).toContain('等待部署资源')
  expect(w.text()).not.toContain('网页抓取测试机 · 192.168.1.201')
})
it('历史生成结果可直接部署，并提交当前源节点归属', async () => {
  vi.mocked(runnerManagementApi.deployGeneratedArchive).mockResolvedValue({} as GeneratedDeploymentJob)
  const w = await setup()
  await w.setProps({ archiveId: 'archive-existing' }); await flushPromises()
  await w.findAll('button').find(button => button.text() === '部署已有代码')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenCalledWith({ archiveId: 'archive-existing', configId: '1401218', sourceId: '430024910', flowId: '21000040', stepId: '41895' })
})
it('切换节点立即清除旧节点的重试入口，不等待新请求返回', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValueOnce({ items: [{ jobId: 'old-node-job', environment: 'test', status: 'failed', gitCommit: 'a'.repeat(40) } as GeneratedDeploymentJob], total: 1 })
  const w = await setup()
  expect(w.text()).toContain('重试部署')
  vi.mocked(runnerManagementApi.generatedDeployments).mockReturnValueOnce(new Promise(() => {}))
  await w.setProps({ stepId: '41896', configId: '1401219' })
  expect(w.findAll('button').some(button => button.text() === '重试部署')).toBe(false)
})
it('只读用户可看到默认机器，不能修改节点资源或全局默认值', async () => {
  const w = await setup(false)
  expect(w.text()).toContain('网页抓取测试机 · 192.168.1.201')
  expect(w.getComponent(ElSelect).props('disabled')).toBe(true)
  expect(w.text()).not.toContain('修改默认')
})
it('最终部署目录跟随环境，保留与当前配置不同的上次部署目录', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockImplementation(async context => ({ ...context, resourceId: '', revision: 'v1', resources: [{ ...resources[0]!, environment: context.environment }], defaultResourceId: 'default-resource', effectiveResourceId: 'default-resource', targetPath: `${context.configId}/${context.environment === 'test' ? 'test' : 'prod'}`, deploymentDirectory: `D:\\Runner2\\instance\\${context.configId}\\${context.environment === 'test' ? 'test' : 'prod'}` }))
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [{ environment: 'test', status: 'success', runnerId: 'old-runner', gitCommit: 'a'.repeat(40), installedPath: 'D:\\OldRunner\\1401218\\test' } as GeneratedDeploymentJob], total: 1 })
  const w = await setup()
  expect(w.get('[data-testid="node-final-deployment-directory"]').text()).toContain('D:\\Runner2\\instance\\1401218\\test')
  expect(w.text()).toContain('上次部署：D:\\OldRunner\\1401218\\test')
  w.getComponent(ElRadioGroup).vm.$emit('update:modelValue', 'production'); await flushPromises()
  expect(w.get('[data-testid="node-final-deployment-directory"]').text()).toContain('D:\\Runner2\\instance\\1401218\\prod')
})

it('默认资源仅展示一项，重复点击当前资源不再次保存', async () => {
  const w = await setup()
  expect(w.findAllComponents(ElOption).map(option => option.props('value'))).toEqual(['default-resource', 'alternative-resource'])
  w.getComponent(ElSelect).vm.$emit('change', 'default-resource'); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
})

it('生产和测试通用资源在两个环境都只显示一次', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockImplementation(async context => ({ ...context, resourceId: '', revision: 'v1', defaultResourceId: 'default-resource', effectiveResourceId: 'default-resource', resources: [{ ...resources[0]!, environment: 'both' }] }))
  const w = await setup()
  expect(w.findAllComponents(ElOption).map(option => option.props('value'))).toEqual(['default-resource'])
  w.getComponent(ElRadioGroup).vm.$emit('update:modelValue', 'production'); await flushPromises()
  expect(w.findAllComponents(ElOption).map(option => option.props('value'))).toEqual(['default-resource'])
  expect(w.getComponent(ElSelect).props('modelValue')).toBe('default-resource')
})
