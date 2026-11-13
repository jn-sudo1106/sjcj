// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElCheckbox, ElSelect } from 'element-plus'
import { runnerManagementApi as api, type GeneratedDeploymentJob } from '@/api/runnerManagement'
import DeploymentFilesDrawer from './DeploymentFilesDrawer.vue'

afterEach(() => vi.restoreAllMocks())
const job = { jobId: 'job', configId: '1401218', environment: 'test', gitCommit: 'a'.repeat(40) } as GeneratedDeploymentJob
const snapshot = { jobId: 'job', deliveryId: 'delivery', artifactDigest: 'sha256:digest', gitCommit: job.gitCommit, directory: 'D:\\Runner2\\instance\\links\\1401218', files: [
  { path: 'main.py', size: 10, sha256: 'a', taskFile: false }, { path: 'sites/new.example.py', size: 20, sha256: 'b', taskFile: true },
] }
function setup() { return mount(DeploymentFilesDrawer, { props: { job }, global: { plugins: [ElementPlus], stubs: { ElDrawer: { template: '<div><slot /></div>' } } } }) }

it('默认打开本次结果文件，可切换完整部署快照，不查询仓库最新分支', async () => {
  vi.spyOn(api, 'deploymentFiles').mockResolvedValue(snapshot)
  vi.spyOn(api, 'deploymentFileContent').mockImplementation(async (_, path) => ({ ...snapshot, path, content: path === 'main.py' ? 'OLD_MAIN = 1' : 'DEPLOYED_VERSION = 1', size: 20, sha256: 'deployed-hash' }))
  const w = setup(); await flushPromises()
  expect(api.deploymentFileContent).toHaveBeenLastCalledWith(job.jobId, 'sites/new.example.py')
  expect(w.get('[data-testid="deployment-file-content"]').text()).toBe('DEPLOYED_VERSION = 1')
  w.findComponent(ElCheckbox).vm.$emit('update:modelValue', true)
  w.findComponent(ElCheckbox).vm.$emit('change', true); await flushPromises()
  w.findComponent(ElSelect).vm.$emit('update:modelValue', 'main.py')
  w.findComponent(ElSelect).vm.$emit('change', 'main.py'); await flushPromises()
  expect(api.deploymentFileContent).toHaveBeenLastCalledWith(job.jobId, 'main.py')
  expect(w.get('[data-testid="deployment-file-content"]').text()).toBe('OLD_MAIN = 1')
  w.unmount()
})

it('签名版本读取失败时保留真实错误，不回退到其他版本', async () => {
  vi.spyOn(api, 'deploymentFiles').mockResolvedValue(snapshot)
  vi.spyOn(api, 'deploymentFileContent').mockRejectedValue(new Error('部署文件快照缺失或校验失败'))
  const w = setup(); await flushPromises()
  expect(w.text()).toContain('部署文件快照缺失或校验失败')
  expect(w.find('[data-testid="deployment-file-content"]').exists()).toBe(false)
  w.unmount()
})
