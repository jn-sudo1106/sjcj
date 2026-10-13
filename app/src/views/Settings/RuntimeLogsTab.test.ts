// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type RuntimeLogDetail, type RuntimeLogRecord } from '@/api/runnerManagement'
import RuntimeLogsTab from './RuntimeLogsTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { runtimeLogs: vi.fn(), runtimeLogDetail: vi.fn(), runtimeLogEntries: vi.fn(), downloadRuntimeLog: vi.fn(), instances: vi.fn(), runtimeLogPolicy: vi.fn(), saveRuntimeLogPolicy: vi.fn() } }))
const record: RuntimeLogRecord = { recordId: 'a'.repeat(32), runnerId: 'r1', runtimeId: 'binding1', deploymentId: 'd1', assignmentId: 'q1', parentId: '', kind: 'run', status: 'failed', requestedAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:01Z', finishedAt: '2026-10-12T00:00:01Z', error: '缺少公共模块 helper', snapshot: { name: '网页列表抓取', ipAddress: '10.0.0.8', installDirectory: 'E:\\runner', entryPoint: 'main.py', releaseDigest: 'sha256:adopted', revision: 'v1' } }
const details: RuntimeLogDetail = { ...record, events: [{ eventId: 'e1', time: record.requestedAt, stage: 'failed', level: 'error', message: '模块不存在', detail: 'Traceback\nModuleNotFoundError: helper' }], streams: [{ streamId: 'b'.repeat(32), lastSeq: 1, byteCount: 100, updatedAt: record.updatedAt }], runs: [], run: { slot: 0, pid: 1234, entry: 'E:\\runner\\main.py', working_directory: 'E:\\runner', interpreter: 'python.exe', exit_code: 1, started_at: record.requestedAt, ended_at: record.finishedAt, reason: '启动失败' } }
beforeEach(() => {
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [structuredClone(record)], total: 1, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue(structuredClone(details))
  vi.mocked(runnerManagementApi.runtimeLogEntries).mockResolvedValue({ entries: [{ seq: 1, index: 0, text: '<script>literal</script>', time: record.requestedAt, source: 'console' }], cursor: 1, firstCursor: 1, lastSeq: 1, hasEarlier: false })
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([])
  vi.mocked(runnerManagementApi.runtimeLogPolicy).mockResolvedValue({ directory: 'E:\\ce\\runner-logs', retentionDays: 30, quotaMb: 1024, hasLogs: true })
})
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals() })
async function setup(query: Record<string, string> = { tab: 'runtime-logs', runtimeId: 'binding1' }, keepAlive = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = ['admin']
  const visible = ref(true)
  const component = keepAlive ? defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => visible.value ? h(RuntimeLogsTab) : null }) }) : RuntimeLogsTab
  const wrapper = mount(component, { global: { plugins: [router, pinia, ElementPlus] } }); await flushPromises()
  return { wrapper, router, visible }
}
it('按绑定查询，展示失败阶段、异常堆栈、采用版本和真实退出码', async () => {
  const { wrapper } = await setup()
  expect(runnerManagementApi.runtimeLogs).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'binding1', pageSize: 20 }))
  expect(wrapper.text()).toContain('Traceback'); expect(wrapper.text()).toContain('缺少公共模块')
  await wrapper.get('#log-tab-info').trigger('click')
  expect(wrapper.text()).toContain('sha256:adopted'); expect(wrapper.text()).toContain('1234'); expect(wrapper.text()).toContain('python.exe')
  await wrapper.get('#log-tab-results').trigger('click')
  expect(wrapper.text()).toContain('业务结果未上报')
  wrapper.unmount()
})
it('处理机入口按实例、分配、PID 与并发定位记录，直接展示对应程序输出', async () => {
  const other = { ...record, recordId: 'c'.repeat(32) }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [other, record], total: 2, page: 1, pageSize: 20 })
  const { wrapper, router } = await setup({ tab: 'runtime-logs', runtimeId: 'binding1', runnerId: 'r1', assignmentId: 'q1', processPid: '1234', processSlot: '0', recordId: record.recordId })
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ runnerId: 'r1', assignmentId: 'q1', processPid: 1234, processSlot: 0, kind: 'run', since: '' }))
  expect(runnerManagementApi.runtimeLogDetail).toHaveBeenLastCalledWith(record.recordId)
  expect(wrapper.get('#log-tab-output').attributes('aria-selected')).toBe('true')
  expect(wrapper.get('[data-testid="process-log-context"]').text()).toContain('PID 1234 · 并发 1')
  // Switching to a sibling must clear previous record/output, despite the same runtimeId.
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [other], total: 1, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, ...other, run: { ...details.run!, pid: 5678, slot: 1 }, streams: [] })
  await router.replace({ path: '/settings', query: { ...router.currentRoute.value.query, recordId: other.recordId, processPid: '5678', processSlot: '1' } }); await flushPromises()
  expect(runnerManagementApi.runtimeLogDetail).toHaveBeenLastCalledWith(other.recordId)
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ processPid: 5678, processSlot: 1 }))
  expect(wrapper.get('[data-testid="process-log-context"]').text()).toContain('PID 5678 · 并发 2')
  expect(wrapper.find('[data-testid="log-console"]').exists()).toBe(false)
  wrapper.unmount()
})
it('进程日志未上报时不回退到全局或其他操作记录，清除范围后恢复普通查询', async () => {
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  const { wrapper } = await setup({ tab: 'runtime-logs', runnerId: 'old-runner', assignmentId: 'q1', processPid: '999', processSlot: '2', recordId: 'd'.repeat(32) })
  expect(runnerManagementApi.runtimeLogDetail).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('当前进程暂无符合条件的日志')
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ runnerId: 'old-runner', assignmentId: 'q1', processPid: 999, processSlot: 2 }))
  await wrapper.findAll('button').find(button => button.text() === '查看全部日志')!.trigger('click'); await flushPromises()
  const filters = vi.mocked(runnerManagementApi.runtimeLogs).mock.lastCall![0]!
  expect(filters).not.toHaveProperty('processPid'); expect(filters).not.toHaveProperty('assignmentId'); expect(filters.runnerId).toBe('')
  wrapper.unmount()
})
it('缓存日志页离开后从另一个进程进入，丢弃旧记录和旧输出', async () => {
  const query = { tab: 'runtime-logs', runtimeId: 'binding1', runnerId: 'r1', assignmentId: 'q1', processPid: '1234', processSlot: '0' }
  const { wrapper, router, visible } = await setup(query, true)
  await wrapper.get('[aria-label="搜索程序输出"]').setValue('old-search')
  visible.value = false; await flushPromises()
  const next = { ...record, recordId: 'e'.repeat(32) }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [next], total: 1, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, ...next, run: { ...details.run!, slot: 1, pid: 5678 }, streams: [] })
  await router.replace({ path: '/settings', query: { ...query, processPid: '5678', processSlot: '1' } })
  visible.value = true; await flushPromises()
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ processPid: 5678, processSlot: 1 }))
  expect(runnerManagementApi.runtimeLogDetail).toHaveBeenLastCalledWith(next.recordId)
  expect(wrapper.get('[data-testid="process-log-context"]').text()).toContain('PID 5678')
  expect((wrapper.get('[aria-label="搜索程序输出"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.find('[data-testid="log-console"]').exists()).toBe(false)
  wrapper.unmount()
})
it('程序输出按文本展示，搜索不执行 HTML；可暂停实时跟随', async () => {
  const { wrapper } = await setup()
  await wrapper.get('#log-tab-output').trigger('click')
  expect(wrapper.get('[data-testid="log-console"]').text()).toContain('<script>literal</script>')
  expect(wrapper.find('script').exists()).toBe(false)
  await wrapper.get('[aria-label="搜索程序输出"]').setValue('missing')
  expect(wrapper.findAll('.rl-line')).toHaveLength(0)
  wrapper.unmount()
})
it('重试暂停后在执行过程顶部直接展示程序异常，过滤不隐藏原因且可以查看完整输出', async () => {
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, status: 'paused', error: '5 分钟内失败 5 次，已达到尝试上限' })
  vi.mocked(runnerManagementApi.runtimeLogEntries).mockResolvedValue({ entries: [
    { seq: 1, index: 0, text: 'Traceback (most recent call last):', time: record.requestedAt, source: 'console' },
    { seq: 1, index: 1, text: "ModuleNotFoundError: No module named 'save_batches'", time: record.requestedAt, source: 'console' },
  ], cursor: 1, firstCursor: 1, lastSeq: 1, hasEarlier: false })
  const { wrapper } = await setup()
  expect(wrapper.get('#log-tab-events').attributes('aria-selected')).toBe('true')
  expect(wrapper.get('[data-testid="program-error"]').text()).toContain("ModuleNotFoundError: No module named 'save_batches'")
  await wrapper.get('[data-testid="program-error"] button').trigger('click')
  expect(wrapper.get('#log-tab-output').attributes('aria-selected')).toBe('true')
  expect(wrapper.get('[data-testid="log-console"]').text()).toContain('Traceback')
  await wrapper.get('[aria-label="搜索程序输出"]').setValue('absent')
  expect(wrapper.findAll('.rl-line')).toHaveLength(0)
  expect(wrapper.get('[data-testid="program-error"]').text()).toContain('save_batches')
  wrapper.unmount()
})
it('过期输出明确显示清理原因，不重复请求不存在的更早批次', async () => {
  vi.mocked(runnerManagementApi.runtimeLogEntries).mockResolvedValue({ entries: [], cursor: 0, firstCursor: 0, lastSeq: 25, earliestSeq: 0, expired: true, hasEarlier: false })
  const { wrapper } = await setup()
  await wrapper.get('#log-tab-output').trigger('click')
  expect(wrapper.text()).toContain('程序输出已按日志保留期限清理')
  expect(wrapper.text()).not.toContain('加载更早日志')
  wrapper.unmount()
})
it('切换记录忽略迟到的旧详情和输出，查询保留绑定范围', async () => {
  const { wrapper } = await setup()
  const other = { ...record, recordId: 'c'.repeat(32), error: '新错误' }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [record, other], total: 2, page: 1, pageSize: 20 })
  await wrapper.get('[aria-label="刷新运行日志"]').trigger('click'); await flushPromises()
  let resolve!: (value: RuntimeLogDetail) => void
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await wrapper.findAll('[data-testid="log-record"]')[0]!.trigger('click')
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, ...other, streams: [], events: [] })
  await wrapper.findAll('[data-testid="log-record"]')[1]!.trigger('click'); await flushPromises()
  resolve(details); await flushPromises()
  expect(wrapper.text()).toContain('新错误'); expect(wrapper.find('pre').exists()).toBe(false)
  await wrapper.get('[aria-label="搜索运行日志"]').setValue('news_list')
  await wrapper.get('[aria-label="查询运行日志"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'news_list', runtimeId: 'binding1', page: 1 }))
  wrapper.unmount()
})
it('日志和列表网络异常显式提示，卸载后停止轮询', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { wrapper } = await setup()
  vi.mocked(runnerManagementApi.runtimeLogEntries).mockRejectedValue(new Error('日志接口不可达'))
  await vi.advanceTimersByTimeAsync(3000); await flushPromises()
  await wrapper.get('#log-tab-output').trigger('click')
  expect(wrapper.text()).toContain('日志接口不可达')
  const calls = vi.mocked(runnerManagementApi.runtimeLogs).mock.calls.length
  wrapper.unmount(); await vi.advanceTimersByTimeAsync(5000)
  expect(runnerManagementApi.runtimeLogs).toHaveBeenCalledTimes(calls)
})
it('旧 Runner 没有日志能力时明确提示升级，开始记录可进入具体并发实例', async () => {
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, logAvailable: false, streams: [], run: null, kind: 'start', runs: [record] })
  const { wrapper } = await setup()
  await wrapper.get('#log-tab-output').trigger('click')
  expect(wrapper.text()).toContain('此 Runner 未上报日志能力')
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue(details)
  await wrapper.get('.rl-instances button').trigger('click'); await flushPromises()
  expect(runnerManagementApi.runtimeLogDetail).toHaveBeenLastCalledWith(record.recordId)
  wrapper.unmount()
})
it('日志设置保存错误保留表单，已有日志时目录不可直接更改', async () => {
  const { wrapper } = await setup()
  await wrapper.findAll('button').find(button => button.text() === '日志设置')!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('服务器日志目录')
  const drawer = wrapper.findComponent({ name: 'ElDrawer' })
  expect(drawer.findComponent({ name: 'ElInput' }).props('disabled')).toBe(true)
  vi.mocked(runnerManagementApi.saveRuntimeLogPolicy).mockRejectedValue(new Error('服务器目录不可写'))
  await drawer.findAll('button').find(button => button.text() === '保存')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeLogPolicy).toHaveBeenCalledWith(expect.objectContaining({ retentionDays: 30, quotaMb: 1024 }))
  expect(wrapper.text()).toContain('服务器目录不可写')
  wrapper.unmount()
})
