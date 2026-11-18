// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { runnerManagementApi as api, type GeneratedDeploymentJob } from '@/api/runnerManagement'
import DeploymentFilesDrawer from './DeploymentFilesDrawer.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { deploymentFiles: vi.fn(), deploymentFileContent: vi.fn() } }))
const job = { jobId: 'job', gitCommit: 'a'.repeat(40), configId: '1401218', environment: 'test' } as GeneratedDeploymentJob
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.mocked(api.deploymentFiles).mockResolvedValue({ jobId: 'job', directory: 'links/1401218', files: [
    { path: 'sites/a.py', taskFile: true }, { path: 'sites/b.py', taskFile: true },
  ] } as never)
  vi.mocked(api.deploymentFileContent).mockImplementation(async (id, path) => ({ jobId: id, path, size: 10, sha256: 'a'.repeat(64), content: path + ' contents' } as never))
})
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
it('内嵌展示点击的部署文件，同任务切文件复用清单且不弹出抽屉', async () => {
  wrapper = mount(DeploymentFilesDrawer, { props: { job, embedded: true, initialPath: 'sites/b.py' }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(wrapper.findComponent({ name: 'ElDrawer' }).exists()).toBe(false)
  expect(wrapper.get('[data-testid="deployment-file-content"]').text()).toBe('sites/b.py contents')
  await wrapper.setProps({ initialPath: 'sites/a.py' }); await flushPromises()
  expect(api.deploymentFiles).toHaveBeenCalledTimes(1)
  expect(wrapper.get('[data-testid="deployment-file-content"]').text()).toBe('sites/a.py contents')
})
it('指定文件不属于该部署版本时显示错误，不替换成其他文件', async () => {
  wrapper = mount(DeploymentFilesDrawer, { props: { job, embedded: true, initialPath: 'sites/missing.py' }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(wrapper.text()).toContain('本次部署版本中不存在该文件')
  expect(api.deploymentFileContent).not.toHaveBeenCalled()
})
