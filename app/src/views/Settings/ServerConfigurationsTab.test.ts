// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ServerConfigurationsTab from './ServerConfigurationsTab.vue'

const instances = [1, 2].map(index => ({ runnerId: `runner-${index}`, name: `实例${index}`, ipAddress: '10.0.0.8', installDirectory: `E:/runner-${index}`, status: 'online', platform: 'win32', osType: 'Windows', osVersion: `Windows 11-${index}`, runnerPid: 7000 + index, actualDigest: `sha256:${String(index).repeat(64)}`, desiredDigest: 'source-local', launcherVersion: '2026.10.29.2', capabilities: ['python'], assignmentCount: index, lastHeartbeat: '2026-10-29T11:00:00+00:00', workerProcesses: [{ pid: 9000 + index }], lastError: index === 2 ? '测试进程异常' : '' }))
async function setup(query: Record<string, string> = {}, role = 'admin') {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [role]
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query: { tab: 'runners', ...query } })
  const wrapper = mount(ServerConfigurationsTab, { global: { plugins: [router, pinia], stubs: {
    RunnerManagementTab: { name: 'RunnerManagementTab', props: { compact: Boolean, selectionDisabled: Boolean, selectedRunnerId: String }, emits: ['selectRunner', 'instancesChange', 'visibleInstancesChange', 'releasesChange', 'openDetails', 'editVersion'], data: () => ({ keyword: '', instances }), mounted() { this.$emit('instancesChange', this.instances); this.$emit('visibleInstancesChange', this.instances); this.$emit('releasesChange', [{ digest: this.instances[0]!.actualDigest, kind: 'runner', publishedAt: '2026-10-28T10:00:00Z' }]) },
      methods: { openInstanceDetails(id: string) { this.$emit('openDetails', id) }, editInstanceVersion(id: string) { this.$emit('editVersion', id) } },
      template: '<div class="server-manager"><input v-model="keyword" data-testid="server-search" /><button :disabled="selectionDisabled" @click="$emit(\'selectRunner\',\'runner-2\')">选择第二个实例</button></div>' },
    RunnerBindingTab: { name: 'RunnerBindingTab', props: ['runnerId'], emits: ['busy', 'resetFilters'], methods: { resetFilters() { this.$emit('resetFilters') } }, template: '<div class="bindings">{{ runnerId }}</div>' },
    ProcessorProcessesTab: { name: 'ProcessorProcessesTab', props: ['runnerId'], template: '<div class="running-instances">{{ runnerId }}</div>' },
    DeploymentResourcesTab: { name: 'DeploymentResourcesTab', props: { runnerId: String, resourcesOnly: Boolean }, emits: ['busy'], template: '<div class="resource-settings">{{ runnerId }}</div>' },
    RunnerFilesDrawer: { name: 'RunnerFilesDrawer', props: { runner: Object, directory: String, embedded: Boolean, workspace: Boolean, editable: Boolean }, template: '<div class="deployment-files">{{ runner.runnerId }}</div>' },
    ElButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    ElSelect: { name: 'ElSelect', props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<div><slot /></div>' },
    ElOption: true,
    ElEmpty: true,
    ElAlert: true,
  } } })
  await flushPromises()
  return { wrapper, router }
}
describe('服务器与机器配置统一页面', () => {
  it('部署空间浏览当前实例根目录，切换机器仍保留部署空间，不提供机器侧入口设置', async () => {
    const { wrapper, router } = await setup()
    await wrapper.get('[data-testid="deployment-workspace"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('files')
    expect(wrapper.getComponent({ name: 'RunnerFilesDrawer' }).props()).toMatchObject({ runner: instances[0], directory: '', embedded: true, workspace: true, editable: true })
    expect(wrapper.getComponent({ name: 'RunnerFilesDrawer' }).attributes('allow-set-entry')).toBeUndefined()
    await wrapper.get('.server-manager button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ runnerId: 'runner-2', view: 'files' })
    expect(wrapper.get('.deployment-files').text()).toBe('runner-2')
    expect(wrapper.find('.bindings').exists()).toBe(false)
    wrapper.unmount()
  })
  it('资源配置并入机器详情，编辑时锁定切换，完成后可切换实例', async () => {
    const { wrapper, router } = await setup()
    await wrapper.get('[data-testid="runner-instance-info"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'runners', view: 'runner' })
    expect(wrapper.find('[data-testid="deployment-resource-settings"]').exists()).toBe(false)
    const resources = wrapper.findComponent({ name: 'DeploymentResourcesTab' })
    expect(resources.props()).toMatchObject({ runnerId: 'runner-1', resourcesOnly: true })
    resources.vm.$emit('busy', true); await flushPromises()
    expect(wrapper.get('.server-manager button').attributes('disabled')).toBeDefined()
    resources.vm.$emit('busy', false); await flushPromises()
    await wrapper.get('.server-manager button').trigger('click'); await flushPromises()
    expect(wrapper.get('.resource-settings').text()).toBe('runner-2')
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'runner-2', view: 'runner' })
    wrapper.unmount()
  })
  it('部署资源可切换运行实例，实例列表随当前机器切换', async () => {
    const { wrapper, router } = await setup()
    await wrapper.get('[data-testid="deployment-running-instances"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'runners', view: 'instances' })
    expect(wrapper.get('.running-instances').text()).toBe('runner-1')
    expect(wrapper.find('.bindings').exists()).toBe(false)
    await wrapper.get('.server-manager button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.bindings').text()).toBe('runner-2')
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'runner-2' })
    wrapper.unmount()
  })
  it('Runner 实例页签集中展示基础信息和升级操作，切换机器仍停留在该页签', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.find('[data-testid="server-machine-information"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="server-machine-summary"]').exists()).toBe(false)
    await wrapper.get('[data-testid="runner-instance-info"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('runner')
    const information = () => wrapper.get('[data-testid="server-machine-information"]').text()
    expect(information()).toContain('runner-1'); expect(information()).toContain('E:/runner-1')
    expect(information()).toContain(instances[0]!.actualDigest)
    expect(wrapper.find('.bindings').exists()).toBe(false)
    await wrapper.get('.server-manager button').trigger('click'); await flushPromises()
    expect(information()).toContain('runner-2'); expect(information()).toContain('测试进程异常')
    expect(router.currentRoute.value.query.view).toBe('runner')
    await wrapper.get('[data-testid="server-open-detail"]').trigger('click')
    await wrapper.get('[data-testid="server-set-version"]').trigger('click')
    const manager = wrapper.findComponent({ name: 'RunnerManagementTab' })
    expect(manager.emitted('openDetails')).toEqual([['runner-2']])
    expect(manager.emitted('editVersion')).toEqual([['runner-2']])
    await wrapper.findAll('button').find(item => item.text() === '部署配置')!.trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="server-machine-information"]').exists()).toBe(false)
    expect(wrapper.get('.bindings').text()).toBe('runner-2')
    wrapper.unmount()
  })
  it('只读账号在Runner实例页签可查看信息，不能升级', async () => {
    const { wrapper } = await setup({}, 'read')
    await wrapper.get('[data-testid="runner-instance-info"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="server-machine-information"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="server-open-detail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="server-set-version"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('左右同时展示并默认选中第一实例，切换实例保留左侧搜索', async () => {
    const { wrapper, router } = await setup({ configId: '123' })
    expect(wrapper.get('.bindings').text()).toBe('runner-1')
    expect(wrapper.findComponent({ name: 'RunnerManagementTab' }).props('compact')).toBe(true)
    expect(wrapper.find('.server-main').exists()).toBe(true)
    await wrapper.get('[data-testid="server-search"]').setValue('10.0.0.8')
    await wrapper.get('.server-manager button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'runner-2' })
    expect(wrapper.get('.bindings').text()).toBe('runner-2')
    expect(wrapper.get('.server-manager').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="server-search"]').element).toHaveProperty('value', '10.0.0.8')
    wrapper.unmount()
  })
  it('配置编辑期间禁用左侧切换，未知实例保留明确筛选范围', async () => {
    const { wrapper } = await setup({ runnerId: 'unknown' })
    expect(wrapper.get('.bindings').text()).toBe('unknown')
    wrapper.findComponent({ name: 'RunnerBindingTab' }).vm.$emit('busy', true); await flushPromises()
    expect(wrapper.findComponent({ name: 'RunnerManagementTab' }).props('selectionDisabled')).toBe(true)
    expect(wrapper.get('.server-manager button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('筛选机器后右侧联动，零匹配清空配置，清除筛选后恢复展示', async () => {
    const { wrapper, router } = await setup()
    const sidebar = wrapper.findComponent({ name: 'RunnerManagementTab' })
    sidebar.vm.$emit('visibleInstancesChange', [instances[1]], true); await flushPromises()
    expect(wrapper.get('.bindings').text()).toBe('runner-2')
    expect(router.currentRoute.value.query.runnerId).toBe('runner-2')
    sidebar.vm.$emit('visibleInstancesChange', [], true); await flushPromises()
    expect(wrapper.find('.bindings').exists()).toBe(false)
    expect(router.currentRoute.value.query.runnerId).toBeUndefined()
    expect(wrapper.findComponent({ name: 'ElEmpty' }).attributes('description')).toContain('没有符合筛选条件的机器')
    sidebar.vm.$emit('visibleInstancesChange', instances, false); await flushPromises()
    expect(wrapper.get('.bindings').text()).toBe('runner-1')
    wrapper.unmount()
  })
  it('编辑期间保留当前配置，编辑结束后应用最新机器筛选', async () => {
    const { wrapper } = await setup()
    const binding = wrapper.findComponent({ name: 'RunnerBindingTab' })
    binding.vm.$emit('busy', true); await flushPromises()
    wrapper.findComponent({ name: 'RunnerManagementTab' }).vm.$emit('visibleInstancesChange', [], true); await flushPromises()
    expect(wrapper.get('.bindings').text()).toBe('runner-1')
    binding.vm.$emit('busy', false); await flushPromises()
    expect(wrapper.find('.bindings').exists()).toBe(false)
    wrapper.unmount()
  })
  it('离开服务器查看部署配置后，后台机器刷新不会把页面切回服务器', async () => {
    const { wrapper, router } = await setup()
    const sidebar = wrapper.findComponent({ name: 'RunnerManagementTab' })
    await router.replace({ path: '/settings', query: { tab: 'directory-layout', deploymentId: 'deployment-1' } })
    sidebar.vm.$emit('visibleInstancesChange', instances, false); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'directory-layout', deploymentId: 'deployment-1' })
    await router.replace({ path: '/settings', query: { tab: 'runners' } }); await flushPromises()
    sidebar.vm.$emit('visibleInstancesChange', instances, false); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'runner-1' })
    wrapper.unmount()
  })
  it('切到日志后，晚到的编辑结束事件不会触发机器自动选择', async () => {
    const { wrapper, router } = await setup()
    const binding = wrapper.findComponent({ name: 'RunnerBindingTab' })
    binding.vm.$emit('busy', true); await flushPromises()
    await router.replace({ path: '/settings', query: { tab: 'runtime-logs', runtimeId: 'runtime-1' } })
    wrapper.findComponent({ name: 'RunnerManagementTab' }).vm.$emit('visibleInstancesChange', instances, false)
    binding.vm.$emit('busy', false); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'runtime-logs', runtimeId: 'runtime-1' })
    wrapper.unmount()
  })
})
