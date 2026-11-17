// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { type VNode } from 'vue'
import { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type RunnerInstance, type RuntimeConfiguration } from '@/api/runnerManagement'
import { prepareDeploymentProcesses } from './deploymentProcesses'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  instances: vi.fn(), runtimeConfigurations: vi.fn(), stopRuntimeProgram: vi.fn(),
} }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn() } }))
const process = { assignmentId: 'a1', pid: 123, slot: 0, queue: 'news', entry: 'D:/Runner/instance/links/1401218/bin/newslink.exe', workingDirectory: 'D:/Runner/instance/links/1401218' }
const runner = { runnerId: 'r1', name: 'Runner 1', ipAddress: '192.168.1.172', installDirectory: 'D:/Runner/instance',
  status: 'online', workerProcesses: [process] } as RunnerInstance
const runtime = { runtimeId: 'runtime1', runnerId: 'r1', assignmentId: 'a1', revision: 'rev1', directoryTemplate: 'links/1401218', assignment: { enabled: true } } as RuntimeConfiguration
const targets = [{ runnerId: 'r1', directory: 'links/1401218' }]
const confirmed = 'confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>
beforeEach(() => {
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([runner])
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([runtime])
  vi.mocked(runnerManagementApi.stopRuntimeProgram).mockResolvedValue({ ...runtime, assignment: { ...runtime.assignment!, enabled: false } })
  vi.mocked(ElMessageBox.confirm).mockResolvedValue(confirmed)
})
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })
function chooseKeep(node: VNode) {
  if (node.type === 'input' && node.props?.value === 'keep') node.props.onChange()
  if (Array.isArray(node.children)) for (const child of node.children) if (child && typeof child === 'object') chooseKeep(child as VNode)
}
it('只在提交时检查，目标没有进程时直接继续', async () => {
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ ...runner, workerProcesses: [] }])
  expect(await prepareDeploymentProcesses(targets, () => true)).toEqual({ proceed: true, stoppedCount: 0 })
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
  expect(ElMessageBox.confirm).not.toHaveBeenCalled()
})
it('关闭后等待进程退出，Windows 路径忽略大小写，其他目录和其他机器不受影响', async () => {
  vi.useFakeTimers()
  const reported = [{ ...runner, workerProcesses: [process, { ...process, assignmentId: 'unrelated', pid: 456, workingDirectory: 'D:/Runner/instance/links/14012180' }] },
    { ...runner, runnerId: 'r2' }]
  vi.mocked(runnerManagementApi.instances).mockResolvedValueOnce(reported).mockResolvedValueOnce(reported).mockResolvedValue([{ ...runner, workerProcesses: [] }])
  const pending = prepareDeploymentProcesses([{ runnerId: 'r1', directory: 'd:\\runner\\INSTANCE\\links\\1401218' }], () => true)
  await flushPromises()
  expect(runnerManagementApi.stopRuntimeProgram).toHaveBeenCalledExactlyOnceWith('runtime1', 'rev1')
  await vi.advanceTimersByTimeAsync(1000)
  expect(await pending).toEqual({ proceed: true, stoppedCount: 1 })
})
it('仅有其他目录中的进程时不弹窗，也不关闭任何进程', async () => {
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ ...runner, workerProcesses: [{ ...process, workingDirectory: 'D:/Runner/instance/other' }] }])
  expect((await prepareDeploymentProcesses(targets, () => true)).proceed).toBe(true)
  expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  expect(runnerManagementApi.stopRuntimeProgram).not.toHaveBeenCalled()
})
it('用户保持运行时继续提交，不发送关闭请求', async () => {
  vi.mocked(ElMessageBox.confirm).mockImplementation(async message => { chooseKeep(message as VNode); return confirmed })
  expect(await prepareDeploymentProcesses(targets, () => true)).toEqual({ proceed: true, stoppedCount: 0 })
  expect(runnerManagementApi.stopRuntimeProgram).not.toHaveBeenCalled()
})
it('取消确认或切换上下文后不关闭进程、不继续提交', async () => {
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  expect((await prepareDeploymentProcesses(targets, () => true)).proceed).toBe(false)
  let current = true
  vi.mocked(ElMessageBox.confirm).mockImplementationOnce(async () => { current = false; return confirmed })
  expect((await prepareDeploymentProcesses(targets, () => current)).proceed).toBe(false)
  expect(runnerManagementApi.stopRuntimeProgram).not.toHaveBeenCalled()
})
it('关闭失败、机器离线或超时未退出时，不继续提交部署', async () => {
  vi.mocked(runnerManagementApi.stopRuntimeProgram).mockRejectedValueOnce(new Error('修订号冲突'))
  await expect(prepareDeploymentProcesses(targets, () => true)).rejects.toThrow('未提交部署任务：修订号冲突')
  vi.mocked(runnerManagementApi.instances).mockResolvedValueOnce([runner]).mockResolvedValueOnce([{ ...runner, status: 'offline' }])
  await expect(prepareDeploymentProcesses(targets, () => true)).rejects.toThrow('目标机器离线')
  vi.useFakeTimers()
  const pending = prepareDeploymentProcesses(targets, () => true)
  const assertion = expect(pending).rejects.toThrow('尚未确认进程退出')
  await vi.advanceTimersByTimeAsync(60000); await assertion
})
