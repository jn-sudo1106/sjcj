// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { runnerManagementApi, type DeploymentTaskDetail, type GeneratedDeploymentJob } from '@/api/runnerManagement'
import DeploymentTaskProcess from './DeploymentTaskProcess.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { deploymentTaskDetail: vi.fn(), runtimeConfigurations: vi.fn() } }))
const job = { jobId: 'a'.repeat(32), status: 'success', deliveryId: 'b'.repeat(32), createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:05Z' } as GeneratedDeploymentJob
const result = { ...job, finishedAt: job.updatedAt, historyAvailable: true, events: [
  { eventId: 'e1', time: job.createdAt, stage: 'verify', message: '本次执行时校验摘要和签名通过', detail: 'SHA256 已匹配', level: 'info' },
] } as DeploymentTaskDetail
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
it('完成任务显示已保存的执行过程，不请求运行配置或重复校验', async () => {
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockResolvedValue(result)
  wrapper = mount(DeploymentTaskProcess, { props: { job }, global: { plugins: [ElementPlus] } }); await flushPromises()
  expect(wrapper.text()).toContain('任务已结束')
  expect(wrapper.text()).toContain('5.0 秒')
  expect(wrapper.text()).toContain('摘要和签名校验')
  expect(wrapper.text()).toContain('SHA256 已匹配')
  await wrapper.setProps({ job: { ...job } }); await flushPromises()
  expect(runnerManagementApi.deploymentTaskDetail).toHaveBeenCalledTimes(1)
  await wrapper.get('button').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deploymentTaskDetail).toHaveBeenCalledTimes(2)
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
})
it('切换任务时忽略旧任务迟到的记录', async () => {
  let finish!: (value: DeploymentTaskDetail) => void
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  wrapper = mount(DeploymentTaskProcess, { props: { job }, global: { plugins: [ElementPlus] } })
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockResolvedValueOnce({ ...result, jobId: 'c'.repeat(32), events: [] })
  await wrapper.setProps({ job: { ...job, jobId: 'c'.repeat(32) } }); await flushPromises()
  finish(result); await flushPromises()
  expect(wrapper.text()).not.toContain('SHA256 已匹配')
})
it('过程输出页签按智能体任务风格展示时间、阶段和原始执行详情，切换页签不重复请求', async () => {
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockResolvedValue({ ...result, events: [...result.events,
    { eventId: 'e2', time: job.updatedAt, stage: 'failed', message: '写入失败', detail: 'EXE 文件被占用 <script>test</script>', level: 'error' },
  ] })
  wrapper = mount(DeploymentTaskProcess, { props: { job }, slots: { default: '<p>Git 和目标机器配置</p>' }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  await wrapper.findAll('[role="tab"]').find(tab => tab.text() === '过程输出')!.trigger('click')
  const output = wrapper.get('[data-testid="deployment-process-output"]')
  expect(output.isVisible()).toBe(true)
  expect(output.text()).toContain('[INFO] 摘要和签名校验')
  expect(output.text()).toContain('SHA256 已匹配')
  expect(output.text()).toContain('[ERROR] 执行失败：写入失败')
  expect(output.text()).toContain('<script>test</script>')
  expect(output.find('script').exists()).toBe(false)
  expect(runnerManagementApi.deploymentTaskDetail).toHaveBeenCalledTimes(1)
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
})
