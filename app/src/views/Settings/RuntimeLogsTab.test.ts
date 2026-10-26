// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type RunnerInstance, type RuntimeLogDetail, type RuntimeLogRecord } from '@/api/runnerManagement'
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
it('同机同名实例按完整 ID 和实例目录区分，切换日志同步更新详情身份', async () => {
  const first = { ...record, runnerId: 'b6ce36d2-ba4c-40fe-b666-5af478c6e0cb', snapshot: { ...record.snapshot, runnerName: '同一机器', installDirectory: 'D:\\Runner1\\instance' } }
  const second = { ...first, recordId: 'c'.repeat(32), runnerId: '68c6a8a7-0e56-48e5-813f-712e34c3d86b', snapshot: { ...first.snapshot, installDirectory: 'D:\\Runner2\\instance' } }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [first, second], total: 2, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockImplementation(async id => ({ ...details, ...(id === first.recordId ? first : second) }))
  const { wrapper } = await setup()
  const cards = wrapper.findAll('[data-testid="log-record"]')
  expect(cards[0]!.text()).toContain(first.runnerId); expect(cards[0]!.text()).toContain('D:\\Runner1\\instance')
  expect(cards[1]!.text()).toContain(second.runnerId); expect(cards[1]!.text()).toContain('D:\\Runner2\\instance')
  expect(wrapper.get('[data-testid="log-detail-instance-id"]').text()).toContain(first.runnerId)
  await cards[1]!.trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="log-detail-instance-id"]').text()).toContain(second.runnerId)
  expect(wrapper.get('.rl-detail-header').text()).toContain('D:\\Runner2\\instance')
  await wrapper.get('#log-tab-output').trigger('click')
  expect(wrapper.get('[data-testid="log-detail-instance-id"]').text()).toContain(second.runnerId)
  expect(wrapper.get('[data-testid="log-detail-instance-id"]').text()).toContain('PID：1234')
  wrapper.unmount()
})
it('历史实例信息优先于当前清单，仅缺失字段按实例 ID 补全，清单不存在仍显示原始 ID', async () => {
  const machine: RunnerInstance = { runnerId: 'r1', name: '已改名实例', ipAddress: '10.0.0.9', installDirectory: 'E:\\new-runner', platform: 'windows', capabilities: [], status: 'online', lastHeartbeat: null, desiredDigest: null, actualDigest: null, assignmentCount: 0 }
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([machine])
  const legacy = { ...record, recordId: 'c'.repeat(32), snapshot: { name: '旧记录' } }
  const removed = { ...legacy, recordId: 'd'.repeat(32), runnerId: 'removed-runner' }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [record, legacy, removed], total: 3, page: 1, pageSize: 20 })
  const { wrapper } = await setup()
  const cards = wrapper.findAll('[data-testid="log-record"]')
  expect(cards[0]!.text()).toContain('10.0.0.8'); expect(cards[0]!.text()).toContain('E:\\runner'); expect(cards[0]!.text()).not.toContain(machine.installDirectory)
  expect(cards[1]!.text()).toContain(machine.ipAddress); expect(cards[1]!.text()).toContain(machine.installDirectory)
  expect(cards[2]!.text()).toContain('removed-runner'); expect(cards[2]!.text()).toContain('实例目录未上报'); expect(cards[2]!.text()).not.toContain(machine.installDirectory)
  wrapper.unmount()
})
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
it('从处理机进入后可切换 Runner，解除旧 PID、绑定和记录范围，显示新实例日志', async () => {
  const { wrapper, router } = await setup({ tab: 'runtime-logs', runtimeId: 'binding1', runnerId: 'r1', assignmentId: 'q1', processPid: '1234', processSlot: '0', recordId: record.recordId })
  const runnerSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
  expect(runnerSelect.props('disabled')).not.toBe(true)
  const next = { ...record, recordId: 'c'.repeat(32), runnerId: 'r2', runtimeId: 'binding2', assignmentId: 'q2', snapshot: { ...record.snapshot, installDirectory: 'D:\\Runner2\\instance' } }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [next], total: 1, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, ...next, streams: [] })
  runnerSelect.vm.$emit('update:modelValue', 'r2'); runnerSelect.vm.$emit('change', 'r2'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'runtime-logs', runnerId: 'r2' })
  const input = vi.mocked(runnerManagementApi.runtimeLogs).mock.lastCall![0]!
  expect(input).toMatchObject({ runnerId: 'r2', kind: '', page: 1 })
  expect(input.runtimeId).toBeUndefined(); expect(input).not.toHaveProperty('processPid'); expect(input).not.toHaveProperty('assignmentId')
  expect(runnerManagementApi.runtimeLogDetail).toHaveBeenLastCalledWith(next.recordId)
  expect(wrapper.get('[data-testid="log-detail-instance-id"]').text()).toContain('r2')
  expect(wrapper.find('[data-testid="process-log-context"]').exists()).toBe(false)
  wrapper.unmount()
})
it('从机器绑定进入后清空实例选择时解除旧绑定，恢复全局查询', async () => {
  const { wrapper, router } = await setup({ tab: 'runtime-logs', runtimeId: 'binding1', runnerId: 'r1' })
  const runnerSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
  runnerSelect.vm.$emit('update:modelValue', ''); runnerSelect.vm.$emit('change', ''); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'runtime-logs' })
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ runnerId: '', runtimeId: undefined }))
  wrapper.unmount()
})
it('当前进程可展开同一 Runner 的全部日志，保留实例筛选并解除 PID 范围', async () => {
  const { wrapper, router } = await setup({ tab: 'runtime-logs', runtimeId: 'binding1', runnerId: 'r1', assignmentId: 'q1', processPid: '1234', processSlot: '0', recordId: record.recordId })
  await wrapper.findAll('button').find(button => button.text() === '查看实例日志')!.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'runtime-logs', runnerId: 'r1' })
  expect(runnerManagementApi.runtimeLogs).toHaveBeenLastCalledWith(expect.objectContaining({ runnerId: 'r1', runtimeId: undefined, kind: '' }))
  expect(vi.mocked(runnerManagementApi.runtimeLogs).mock.lastCall![0]).not.toHaveProperty('processPid')
  wrapper.unmount()
})
it('筛选结果不包含链接中的旧记录时，详情只展示筛选内记录；空结果不读取旧详情', async () => {
  const next = { ...record, recordId: 'c'.repeat(32), runnerId: 'r2' }
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [next], total: 1, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, ...next })
  const { wrapper } = await setup({ tab: 'runtime-logs', recordId: record.recordId, runnerId: 'r2' })
  expect(runnerManagementApi.runtimeLogDetail).toHaveBeenLastCalledWith(next.recordId)
  vi.mocked(runnerManagementApi.runtimeLogs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockClear()
  await wrapper.get('[aria-label="查询运行日志"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.runtimeLogDetail).not.toHaveBeenCalled()
  expect(wrapper.find('[data-testid="log-detail-instance-id"]').exists()).toBe(false)
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
it('默认选择最后更新的日志流，乱序返回也按时间排序，新日志流出现后自动切换', async () => {
  const old = { ...details.streams[0]!, updatedAt: '2026-10-12T00:00:01Z' }
  const latest = { ...old, streamId: 'c'.repeat(32), updatedAt: '2026-10-12T00:01:00Z' }
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, streams: [old, latest] })
  const { wrapper } = await setup()
  expect(runnerManagementApi.runtimeLogEntries).toHaveBeenLastCalledWith(latest.streamId, 0, 0)
  await wrapper.get('#log-tab-output').trigger('click')
  const picker = wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!
  expect(picker.props('modelValue')).toBe(latest.streamId)
  const options = picker.findAllComponents({ name: 'ElOption' })
  expect(options.map(item => item.props('value'))).toEqual([latest.streamId, old.streamId])
  expect(options[0]!.props('label')).toContain('最新')
  const newest = { ...latest, streamId: 'd'.repeat(32), updatedAt: '2026-10-12T00:02:00Z' }
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, streams: [old, newest, latest] })
  await wrapper.get('[aria-label="刷新运行日志"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.runtimeLogEntries).toHaveBeenLastCalledWith(newest.streamId, 0, 0)
  expect(picker.props('modelValue')).toBe(newest.streamId)
  wrapper.unmount()
})
it('手动选择历史日志后刷新保留选择，重新进入记录恢复默认最新；所选流消失时回退最新', async () => {
  const old = { ...details.streams[0]!, updatedAt: '2026-10-12T00:00:01Z' }
  const latest = { ...old, streamId: 'c'.repeat(32), updatedAt: '2026-10-12T00:01:00Z' }
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, streams: [old, latest] })
  const { wrapper } = await setup()
  await wrapper.get('#log-tab-output').trigger('click')
  const picker = wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!
  picker.vm.$emit('update:modelValue', old.streamId); await flushPromises()
  expect(picker.props('modelValue')).toBe(old.streamId)
  const newest = { ...latest, streamId: 'd'.repeat(32), updatedAt: '2026-10-12T00:02:00Z' }
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, streams: [old, newest, latest] })
  await wrapper.get('[aria-label="刷新运行日志"]').trigger('click'); await flushPromises()
  expect(picker.props('modelValue')).toBe(old.streamId)
  expect(runnerManagementApi.runtimeLogEntries).toHaveBeenLastCalledWith(old.streamId, 1, 0)
  vi.mocked(runnerManagementApi.runtimeLogDetail).mockResolvedValue({ ...details, streams: [newest, latest] })
  await wrapper.get('[aria-label="刷新运行日志"]').trigger('click'); await flushPromises()
  expect(picker.props('modelValue')).toBe(newest.streamId)
  picker.vm.$emit('update:modelValue', latest.streamId); await flushPromises()
  await wrapper.get('[data-testid="log-record"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.runtimeLogEntries).toHaveBeenLastCalledWith(newest.streamId, 0, 0)
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
