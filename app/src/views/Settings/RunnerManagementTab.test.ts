// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { runnerManagementApi, type ArtifactRelease, type QueueAssignment, type RunnerInstance, type SiteCodeVersion } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import RunnerManagementTab from './RunnerManagementTab.vue'

const instances: RunnerInstance[] = [
  { runnerId: 'r-1', name: '正式', ipAddress: '10.0.0.8', installDirectory: 'D:\\runner-prod', platform: 'windows', capabilities: [], status: 'online', lastHeartbeat: '2026-10-04 12:00', desiredDigest: 'abc', actualDigest: 'abc', assignmentCount: 1 },
  { runnerId: 'r-2', name: '测试', ipAddress: '10.0.0.8', installDirectory: 'D:\\runner-test', platform: 'windows', capabilities: [], status: 'offline', lastHeartbeat: null, desiredDigest: 'def', actualDigest: null, assignmentCount: 0 },
]

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
})

function render() {
  return mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus] } })
}

describe('Runner 实例页面', () => {
  it('Runner 版本页面只显示 Runner 自身版本，隐藏处理程序及业务代码', async () => {
    const common = { digest: 'sha256:runner', kind: 'runner' as const, name: 'Runner 程序', platform: 'any',
      gitCommit: 'local', status: 'published' as const, publishedAt: '', signature: '', usedBy: 0 }
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([common,
      { ...common, digest: 'sha256:processor', kind: 'processor', name: '网页处理程序' },
      { ...common, digest: 'sha256:script', kind: 'script', name: '流程业务代码' }])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'releases' }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('Runner 程序')
    expect(wrapper.text()).not.toContain('网页处理程序')
    expect(wrapper.text()).not.toContain('流程业务代码')
    wrapper.unmount()
  })

  it('Runner 版本的发布入口只调用 Runner 发布接口并刷新列表', async () => {
    useAuthStore().roles = ['admin']
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const publish = vi.spyOn(runnerManagementApi, 'publishRunner').mockResolvedValue({ digest: 'sha256:runner', created: true })
    const processor = vi.spyOn(runnerManagementApi, 'publishProcessor')
    const wrapper = mount(RunnerManagementTab, { props: { section: 'releases' }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('生成处理程序版本')
    expect(wrapper.text()).not.toContain('连接测试程序')
    expect(wrapper.text()).not.toContain('网页列表抓取')
    await wrapper.findAll('button').find(item => item.text() === '生成 Runner 版本')!.trigger('click'); await flushPromises()
    expect(publish).toHaveBeenCalledOnce()
    expect(processor).not.toHaveBeenCalled()
    expect(runnerManagementApi.releases).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('同 IP 不同目录分别展示，不把实例按 IP 合并', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = render()
    await flushPromises()
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('runner-prod')
    expect(rows[1]!.text()).toContain('runner-test')
    wrapper.unmount()
  })

  it('接口不可用时显示真实错误，不使用演示实例', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockRejectedValue(new Error('服务未部署'))
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('服务未部署')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('runner-prod')
    wrapper.unmount()
  })

  it('运行机器展示 Runner 心跳版本和升级目标，源码运行显示本地源码', async () => {
    const actual = 'sha256:' + 'a'.repeat(64), desired = 'sha256:' + 'b'.repeat(64)
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, actualDigest: actual, desiredDigest: desired }, { ...instances[1]!, actualDigest: 'source-local', desiredDigest: null }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = render(); await flushPromises()
    expect(wrapper.findAll('th').map(item => item.text())).toContain('Runner 版本')
    const versions = wrapper.findAll('[data-testid="runner-version"]')
    expect(versions[0]!.text()).toContain('当前：aaaaaaaaaaaa')
    expect(versions[0]!.text()).toContain('目标：bbbbbbbbbbbb')
    expect(versions[0]!.get('span').attributes('title')).toContain(actual)
    expect(versions[1]!.text()).toContain('本地源码（source-local）')
    expect(versions[1]!.text()).toContain('目标：未设置')
    wrapper.unmount()
  })

  it('设置版本仅提供已发布 Runner 制品，提交完整 Runner 摘要', async () => {
    useAuthStore().roles = ['admin']
    const release: ArtifactRelease = { digest: 'sha256:' + 'c'.repeat(64), kind: 'runner', name: 'native-runner', platform: 'win32', gitCommit: 'local', status: 'published', publishedAt: '', signature: '', usedBy: 0 }
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, actualDigest: 'source-local', desiredDigest: null }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([release, { ...release, digest: 'processor', kind: 'processor', name: '处理程序' }, { ...release, digest: 'script', kind: 'script', name: '业务代码' }, { ...release, digest: 'candidate', status: 'candidate', name: '未发布 Runner' }])
    const desired = vi.spyOn(runnerManagementApi, 'setDesiredRunner').mockResolvedValue({ runnerId: 'r-1', digest: release.digest })
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { stubs: assignmentStubs, directives: { loading: {} } } })
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '设置 Runner 版本')!.trigger('click')
    const choice = wrapper.get('[data-testid="runner-upgrade-version"]')
    expect(choice.findAll('option').filter(item => item.attributes('value'))).toHaveLength(1)
    expect(choice.text()).toContain('native-runner')
    expect(choice.text()).not.toContain('处理程序')
    expect(choice.text()).not.toContain('业务代码')
    expect(choice.text()).not.toContain('未发布 Runner')
    await choice.setValue(release.digest)
    await wrapper.findAll('button').find(item => item.text() === '应用升级')!.trigger('click'); await flushPromises()
    expect(desired).toHaveBeenCalledWith('r-1', release.digest)
    wrapper.unmount()
  })

  it('列表展示 Runner PID，详情按任务队列展示每个并发进程 PID', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, runnerPid: 7788, workerProcesses: [
      { assignmentId: 'a-1', queue: 'news_list', slot: 0, pid: 9001 },
      { assignmentId: 'a-1', queue: 'news_list', slot: 1, pid: 9002 },
    ] }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus], stubs: { ElDrawer: assignmentStubs.ElDrawer } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="runner-pid"]').text()).toBe('PID：7788')
    expect(wrapper.text()).toContain('2 个进程')
    await wrapper.findAll('button').find(item => item.text() === '详情')!.trigger('click')
    const panel = wrapper.get('[data-testid="runner-process-detail"]')
    expect(panel.text()).toContain('news_list')
    expect(panel.text()).toContain('9001')
    expect(panel.text()).toContain('9002')
    // 刷新后详情使用新的心跳快照，而不是打开时的旧对象。
    vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ ...instances[0]!, runnerPid: 7799, workerProcesses: [] }])
    await wrapper.findAll('button').find(item => item.text() === '刷新')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="runner-pid"]').text()).toBe('PID：7799')
    expect(wrapper.get('[data-testid="runner-process-detail"]').text()).toContain('最近心跳未上报存活的任务进程')
    wrapper.unmount()
  })

  it('旧版 Runner 不把缺少的进程报告解释为零个进程', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus], stubs: { ElDrawer: assignmentStubs.ElDrawer } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="runner-pid"]').text()).toBe('PID：未上报')
    expect(wrapper.text()).not.toContain('0 个进程')
    await wrapper.findAll('button').find(item => item.text() === '详情')!.trigger('click')
    expect(wrapper.get('[data-testid="runner-process-detail"]').text()).toContain('请更新 Runner')
    wrapper.unmount()
  })
})

const code: SiteCodeVersion & { environments: ('test' | 'prd')[] } = {
  codeId: 'code-1', configId: 'c-1', queueName: 'news_list', siteHost: 'www.realcan.cn',
  storagePath: 'code/c-1/code-1.py', deliveryPath: 'sites/www.realcan.cn.py', gitUrl: '', gitCommit: 'a'.repeat(40),
  scriptDigest: 'sha256:node-code', publishedAt: '', prompt: '', url: '', repoId: 'repo-1', repoName: '网页代码仓库', environments: [],
}
const assigned: QueueAssignment = { assignmentId: 'a-1', runnerId: 'r-2', queue: code.queueName, processorType: 'newslink_nourl',
  releaseDigest: 'sha256:processor', concurrency: 3, environment: 'production', enabled: true,
  codeId: code.codeId, configId: code.configId, scriptDigest: code.scriptDigest, deliveryPath: code.deliveryPath, repoName: code.repoName || '', gitCommit: code.gitCommit }
const assignmentStubs = {
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ElSelect: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="" /><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  ElInputNumber: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<input type="number" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', Number($event.target.value))" />' },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
}
async function renderAssignments() {
  useAuthStore().roles = ['admin']
  vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
  vi.spyOn(runnerManagementApi, 'assignments').mockResolvedValue([])
  vi.spyOn(runnerManagementApi, 'siteCodeCatalog').mockResolvedValue([code])
  const wrapper = mount(RunnerManagementTab, { props: { section: 'assignments' }, global: { stubs: assignmentStubs, directives: { loading: {} } } })
  await flushPromises()
  return wrapper
}

describe('队列分配页面', () => {
  it('同一运行代码的历史版本不重复列出，切换环境自动使用该环境采用版本', async () => {
    const wrapper = await renderAssignments()
    const older = { ...code, scriptDigest: 'sha256:older', environments: ['test' as const] }
    vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([{ ...code, environments: ['prd'] }, older])
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    const choice = wrapper.get('[data-testid="assignment-node-code"]')
    expect(choice.findAll('option').filter(option => option.attributes('value'))).toHaveLength(1)
    await choice.setValue(older.scriptDigest)
    await wrapper.get('[data-testid="assignment-environment"]').setValue('production')
    expect((choice.element as HTMLSelectElement).value).toBe(code.scriptDigest)
    wrapper.unmount()
  })
  it('已有队列可以直接进入对应配置的运行版本', async () => {
    const wrapper = await renderAssignments()
    vi.mocked(runnerManagementApi.assignments).mockResolvedValue([assigned])
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '运行版本')!.trigger('click')
    expect(wrapper.emitted('manageVersions')).toEqual([[code.configId]])
    wrapper.unmount()
  })
  it('在列表新增一行，选择节点代码后自动显示队列，无独立版本选择', async () => {
    const wrapper = await renderAssignments()
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(true)
    expect(wrapper.find('.el-dialog').exists()).toBe(false)
    expect(wrapper.get('[data-testid="assignment-node-code"]').text()).toContain('news_list · #c-1 · www.realcan.cn')
    await wrapper.get('[data-testid="assignment-node-code"]').setValue(code.scriptDigest)
    expect(wrapper.get('[data-testid="assignment-selected-queue"]').text()).toBe(code.queueName)
    expect(wrapper.text()).not.toContain('发布版本')
    expect(wrapper.text()).not.toContain('版本摘要')
    wrapper.unmount()
  })

  it('只提交所选节点代码与实例、环境和并发，保存后显示代码关联', async () => {
    const wrapper = await renderAssignments()
    vi.mocked(runnerManagementApi.assignments).mockResolvedValue([assigned])
    const create = vi.spyOn(runnerManagementApi, 'createAssignment').mockResolvedValue(assigned)
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    await wrapper.get('[data-testid="assignment-node-code"]').setValue(code.scriptDigest)
    await wrapper.get('[data-testid="assignment-runner"]').setValue('r-2')
    await wrapper.get('[data-testid="assignment-environment"]').setValue('production')
    await wrapper.get('[data-testid="assignment-concurrency"]').setValue(3)
    await wrapper.get('[data-testid="assignment-save"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ runnerId: 'r-2', scriptDigest: code.scriptDigest, concurrency: 3, environment: 'production' })
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(false)
    expect(wrapper.find('tbody tr').text()).toContain('#c-1 · sites/www.realcan.cn.py')
    expect(wrapper.find('tbody tr').text()).toContain('D:\\runner-test')
    wrapper.unmount()
  })

  it('缺少必选项或接口失败时保留新增行和填写内容', async () => {
    const wrapper = await renderAssignments()
    const create = vi.spyOn(runnerManagementApi, 'createAssignment').mockRejectedValue(new Error('该实例已分配此队列'))
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    await wrapper.get('[data-testid="assignment-save"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('请选择运行代码和运行机器')
    expect(create).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="assignment-node-code"]').setValue(code.scriptDigest)
    await wrapper.get('[data-testid="assignment-runner"]').setValue('r-1')
    await wrapper.get('[data-testid="assignment-save"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('该实例已分配此队列')
    expect(wrapper.get('[data-testid="assignment-selected-queue"]').text()).toBe(code.queueName)
    await wrapper.get('[data-testid="assignment-cancel"]').trigger('click')
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
