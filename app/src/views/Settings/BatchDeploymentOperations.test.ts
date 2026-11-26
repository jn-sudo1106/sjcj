// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api, type DeploymentConfiguration, type RuntimeConfiguration, type DirectoryDelivery } from '@/api/runnerManagement'
import { prepareDeploymentProcesses } from '@/utils/deploymentProcesses'
import BatchDeploymentOperations from './BatchDeploymentOperations.vue'

vi.mock('@/utils/deploymentProcesses', () => ({ prepareDeploymentProcesses: vi.fn() }))
const layout = { deploymentId: 'deployment-1', name: '智能采集', configId: '1401218', entryPoint: 'bin/newslink.exe',
  directoryTemplate: 'links/1401218', revision: 'layout-v1', nodes: [], deploymentEnvironment: 'test' } as unknown as DeploymentConfiguration
const runtimes: RuntimeConfiguration[] = [1, 2, 3].map(index => ({ runtimeId: `runtime-${index}`, deploymentId: layout.deploymentId,
  name: layout.name, runnerId: `runner-${index}`, revision: `revision-${index}`, directoryTemplate: layout.directoryTemplate,
  entryPoint: layout.entryPoint, assignmentId: `assignment-${index}`, layoutRevision: layout.revision, appliedRevision: layout.revision,
  binding: { bindingType: 'deployment', ownerId: layout.deploymentId, runnerId: `runner-${index}`, directoryTemplate: layout.directoryTemplate, entryPoint: layout.entryPoint, createdAt: '' },
  assignment: { assignmentId: `assignment-${index}`, environment: index === 3 ? 'production' : 'test', enabled: false },
} as RuntimeConfiguration))
const machines = [1, 2, 3].map(index => ({ runnerId: `runner-${index}`, name: `Runner ${index}`, ipAddress: `192.168.1.${170 + index}`,
  installDirectory: `D:/Runner${index}/instance`, status: index === 3 ? 'offline' : 'online', workerProcesses: [] }))
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  setActivePinia(createPinia()); useAuthStore().roles = ['admin']
  vi.spyOn(api, 'runtimeConfigurations').mockResolvedValue(structuredClone(runtimes))
  vi.spyOn(api, 'deploymentConfigurations').mockResolvedValue([layout])
  vi.spyOn(api, 'instances').mockResolvedValue(machines as never)
  vi.spyOn(api, 'startRuntimeProgram').mockImplementation(async id => ({ ...structuredClone(runtimes.find(row => row.runtimeId === id)!), revision: 'updated', assignment: { ...runtimes[0]!.assignment!, enabled: true } }))
  vi.spyOn(api, 'stopRuntimeProgram').mockImplementation(async id => ({ ...structuredClone(runtimes.find(row => row.runtimeId === id)!), revision: 'updated', assignment: { ...runtimes[0]!.assignment!, enabled: false } }))
  vi.spyOn(api, 'directoryDeliveryPreview').mockImplementation(async binding => ({ revision: 'preview-layout-' + binding.runnerId,
    targetPath: `D:/Runner${binding.runnerId.at(-1)}/instance/links/1401218`, baselineDigest: 'baseline-' + binding.runnerId,
    sourceMode: 'current-git', sourceRevision: 'git-v1', items: [
      { path: 'bin/newslink.py', kind: 'file', status: 'modified', size: 120 },
      { path: 'requirements.txt', kind: 'file', status: 'unchanged', size: 30 },
    ] }))
  vi.spyOn(api, 'deliverDirectoryBinding').mockImplementation(async binding => ({ ...binding, deliveryId: `delivery-${binding.runnerId}`, status: 'pending' } as unknown as DirectoryDelivery))
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  vi.mocked(prepareDeploymentProcesses).mockResolvedValue({ proceed: true, stoppedCount: 0 })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(admin = true) {
  useAuthStore().roles = [admin ? 'admin' : 'read']
  const router = createRouter({ history: createMemoryHistory(), routes: ['/settings', '/tasks'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push('/settings')
  const wrapper = mount(BatchDeploymentOperations, { global: { plugins: [router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises()
  return wrapper
}
async function choose(wrapper: ReturnType<typeof mount>, testid: string, value: string) {
  wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('data-testid') === testid)!.vm.$emit('update:modelValue', value)
  await flushPromises()
}
async function select(wrapper: ReturnType<typeof mount>) {
  await choose(wrapper, 'batch-config', 'config:1401218')
  await wrapper.get('input[aria-label="全选当前配置的机器"]').setValue(true)
  await flushPromises()
}

it('按配置跨资源列出机器，默认在线，改变环境或搜索清除勾选', async () => {
  const wrapper = await setup()
  expect(wrapper.text()).toContain('请选择部署配置')
  await select(wrapper)
  expect(wrapper.findAll('tbody tr[data-testid]')).toHaveLength(2)
  expect(wrapper.text()).toContain('已选 2 / 2 项')
  await choose(wrapper, 'batch-status', '')
  expect(wrapper.findAll('tbody tr[data-testid]')).toHaveLength(3)
  expect(wrapper.text()).toContain('已选 0 / 3 项')
  await choose(wrapper, 'batch-environment', 'production')
  expect(wrapper.get('tbody').text()).toContain('192.168.1.173')
  expect(wrapper.get('tbody').text()).not.toContain('192.168.1.171')
  await wrapper.get('input[aria-label="全选当前配置的机器"]').setValue(true)
  await wrapper.get('[aria-label="搜索批量机器"]').setValue('nothing'); await flushPromises()
  expect(wrapper.get('[data-testid="batch-start"]').attributes('disabled')).toBeDefined()
  expect(api.startRuntimeProgram).not.toHaveBeenCalled()
})

it('批量启动只操作勾选的对应实例，一台失败不阻断其他实例，并保留真实错误', async () => {
  vi.mocked(api.startRuntimeProgram).mockRejectedValueOnce(new Error('启动文件不存在'))
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-start"]').trigger('click'); await flushPromises()
  expect(api.startRuntimeProgram).toHaveBeenCalledTimes(2)
  expect(api.startRuntimeProgram).toHaveBeenCalledWith('runtime-1', 'revision-1')
  expect(api.startRuntimeProgram).toHaveBeenCalledWith('runtime-2', 'revision-2')
  expect(wrapper.get('[data-testid="batch-row-runtime-1"]').text()).toContain('启动文件不存在')
  expect(wrapper.get('[data-testid="batch-row-runtime-2"]').text()).toContain('启动指令已提交，等待 Runner 上报进程')
  expect(api.startRuntimeProgram).not.toHaveBeenCalledWith('runtime-3', expect.anything())
})

it('取消批量停止不发送指令，确认后分别记录停止请求', async () => {
  vi.mocked(api.runtimeConfigurations).mockResolvedValue(runtimes.map(row => ({ ...row, assignment: { ...row.assignment!, enabled: true } })))
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-stop"]').trigger('click'); await flushPromises()
  expect(api.stopRuntimeProgram).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="batch-stop"]').trigger('click'); await flushPromises()
  expect(api.stopRuntimeProgram).toHaveBeenCalledTimes(2)
  expect(wrapper.get('tbody').text()).toContain('停止指令已提交，等待 Runner 确认')
})

it('预览不下发或停止，确认后按各机器独立基线及 Git 版本只提交变更文件', async () => {
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  expect(api.directoryDeliveryPreview).toHaveBeenCalledTimes(2)
  expect(api.deliverDirectoryBinding).not.toHaveBeenCalled()
  expect(prepareDeploymentProcesses).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="batch-submit"]').text()).toContain('2 个部署任务')
  await wrapper.get('[data-testid="batch-submit"]').trigger('click'); await flushPromises()
  expect(prepareDeploymentProcesses).toHaveBeenCalledWith([
    { runnerId: 'runner-1', directory: 'D:/Runner1/instance/links/1401218' },
    { runnerId: 'runner-2', directory: 'D:/Runner2/instance/links/1401218' },
  ], expect.any(Function), expect.any(Function))
  for (const index of [1, 2]) expect(api.deliverDirectoryBinding).toHaveBeenCalledWith({ bindingType: 'deployment', ownerId: layout.deploymentId,
    runnerId: `runner-${index}`, revision: `preview-layout-runner-${index}`, scope: 'selected', paths: ['bin/newslink.py'],
    baselineDigest: `baseline-runner-${index}`, sourceMode: 'current-git', sourceRevision: 'git-v1' })
  expect(wrapper.find('[data-testid="batch-submit"]').exists()).toBe(false)
  expect(wrapper.get('tbody').text()).toContain('等待 Runner 执行')
  expect(wrapper.findAll('a').some(link => link.attributes('href')?.includes('/tasks?tab=deployment'))).toBe(true)
})

it('取消进程处理确认不下发，预览可再次提交', async () => {
  vi.mocked(prepareDeploymentProcesses).mockResolvedValue({ proceed: false, stoppedCount: 0 })
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="batch-submit"]').trigger('click'); await flushPromises()
  expect(api.deliverDirectoryBinding).not.toHaveBeenCalled()
  expect(wrapper.find('[data-testid="batch-submit"]').exists()).toBe(true)
})

it('文件一致不创建任务，预览失败不会停止相应机器，其他机器仍可下发', async () => {
  vi.mocked(api.directoryDeliveryPreview).mockRejectedValueOnce(new Error('Git 凭据失效')).mockResolvedValueOnce({ revision: 'same', baselineDigest: null, targetPath: 'links/1401218', items: [{ path: 'main.py', kind: 'file', status: 'unchanged', size: 1 }] })
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('Git 凭据失效')
  expect(wrapper.text()).toContain('文件一致，无需下发')
  expect(wrapper.find('[data-testid="batch-submit"]').exists()).toBe(false)
  expect(prepareDeploymentProcesses).not.toHaveBeenCalled()
})

it('预览后配置被修改时禁止关闭进程或下发过期代码', async () => {
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  vi.mocked(api.runtimeConfigurations).mockResolvedValue(runtimes.map(row => ({ ...row, revision: 'changed' })))
  await wrapper.get('[data-testid="batch-submit"]').trigger('click'); await flushPromises()
  expect(prepareDeploymentProcesses).not.toHaveBeenCalled()
  expect(api.deliverDirectoryBinding).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('请重新预览')
})

it('更改下发范围使旧预览失效，全部范围仍使用预览锁定版本', async () => {
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  await choose(wrapper, 'batch-delivery-scope', 'all')
  expect(wrapper.find('[data-testid="batch-submit"]').exists()).toBe(false)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="batch-submit"]').trigger('click'); await flushPromises()
  expect(api.deliverDirectoryBinding).toHaveBeenCalledWith(expect.objectContaining({ scope: 'all', sourceRevision: 'git-v1' }))
  expect(vi.mocked(api.deliverDirectoryBinding).mock.calls[0]![0]).not.toHaveProperty('paths')
})

it('下发部分失败时保留逐台结果及进程关闭提示', async () => {
  vi.mocked(api.deliverDirectoryBinding).mockRejectedValueOnce(new Error('运行目录被占用'))
  vi.mocked(prepareDeploymentProcesses).mockResolvedValue({ proceed: true, stoppedCount: 2 })
  const wrapper = await setup(); await select(wrapper)
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="batch-submit"]').trigger('click'); await flushPromises()
  expect(api.deliverDirectoryBinding).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('运行目录被占用')
  expect(wrapper.text()).toContain('部署完成后手动启动')
  expect(wrapper.text()).toContain('部署任务已提交')
})

it('只读账号能查看配置，不能勾选或执行批量动作', async () => {
  const wrapper = await setup(false)
  await choose(wrapper, 'batch-config', 'config:1401218')
  expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
  expect(wrapper.find('[data-testid="batch-start"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="batch-preview"]').exists()).toBe(false)
  expect(api.deliverDirectoryBinding).not.toHaveBeenCalled()
})

it('支持从路由预选配置、按真实程序状态筛选、结果汇总仅勾选失败项，以及预览后取消个别机器再提交', async () => {
  const runningMachines = machines.map((m, idx) => idx === 0
    ? { ...m, workerProcesses: [{ assignmentId: 'assignment-1', pid: 4321, slot: 0, queue: 'q' }] }
    : m)
  const mixedRuntimes = runtimes.map((row, idx) => idx === 0
    ? { ...row, assignment: { ...row.assignment!, enabled: true, concurrency: 1 } }
    : row)
  vi.mocked(api.instances).mockResolvedValue(runningMachines as never)
  vi.mocked(api.runtimeConfigurations).mockResolvedValue(mixedRuntimes)

  const router = createRouter({ history: createMemoryHistory(), routes: ['/settings', '/tasks'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push({ path: '/settings', query: { tab: 'runners', view: 'batch', batchConfig: 'config:1401218' } })
  const wrapper = mount(BatchDeploymentOperations, { global: { plugins: [router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises()

  // 1) 自动预选配置并展示实时程序状态
  expect(wrapper.findAll('tbody tr[data-testid]')).toHaveLength(2)
  expect(wrapper.get('[data-testid="batch-row-runtime-1"]').text()).toContain('运行中')
  expect(wrapper.get('[data-testid="batch-row-runtime-1"]').text()).toContain('PID 4321')
  expect(wrapper.get('[data-testid="batch-row-runtime-2"]').text()).toContain('已停止')

  // 2) 按程序状态筛选
  await choose(wrapper, 'batch-program-status', 'running')
  expect(wrapper.findAll('tbody tr[data-testid]')).toHaveLength(1)
  expect(wrapper.find('[data-testid="batch-row-runtime-1"]').exists()).toBe(true)
  await choose(wrapper, 'batch-program-status', '')
  expect(wrapper.findAll('tbody tr[data-testid]')).toHaveLength(2)

  // 3) 预览后取消勾选 1 台，提交按钮动态缩减为 1 台，且只提交保留的那台
  await wrapper.get('input[aria-label="全选当前配置的机器"]').setValue(true); await flushPromises()
  await wrapper.get('[data-testid="batch-preview"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="batch-submit"]').text()).toContain('2 个部署任务')
  await wrapper.get('[data-testid="batch-row-runtime-1"] input[type="checkbox"]').setValue(false); await flushPromises()
  expect(wrapper.get('[data-testid="batch-submit"]').text()).toContain('1 个部署任务')
  await wrapper.get('[data-testid="batch-submit"]').trigger('click'); await flushPromises()
  expect(api.deliverDirectoryBinding).toHaveBeenCalledTimes(1)
  expect(api.deliverDirectoryBinding).toHaveBeenCalledWith(expect.objectContaining({ runnerId: 'runner-2' }))

  // 4) 部分失败后展示汇总条，并支持一键仅勾选失败项
  vi.mocked(api.startRuntimeProgram).mockRejectedValueOnce(new Error('端口冲突'))
  await wrapper.get('input[aria-label="全选当前配置的机器"]').setValue(true); await flushPromises()
  await wrapper.get('[data-testid="batch-start"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="batch-outcome-summary"]').text()).toContain('失败 1')
  await wrapper.get('[data-testid="batch-select-failed"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('已选 1 / 2 项')
})
