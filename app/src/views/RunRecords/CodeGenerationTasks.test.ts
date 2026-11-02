// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { provide, inject, ref, toRef, type Ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { sourceApi, flowCenterApi, type TaskInst } from '@/api'
import { runnerManagementApi } from '@/api/runnerManagement'
import CodeGenerationTasks from './CodeGenerationTasks.vue'

const task: TaskInst = { taskId: '123', configId: '2011', sourceId: '', state: 'W', taskName: '生成脚本', typeName: '', updatedAt: '', vars: '{"codeSourceId":"source-1","sourceFlowId":"flow-2","stepConfigId":"node-3"}' }
function render(rowTask: TaskInst = task, role = 'admin') {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [role]
  return mount(CodeGenerationTasks, { global: { plugins: [pinia], directives: { loading: {} }, stubs: {
    ElTable: { name: 'ElTable', props: ['data'], setup: props => { provide('code-task-rows', toRef(props, 'data')) }, template: '<div><slot /></div>' },
    ElTableColumn: { template: '<div><slot v-for="row in tableRows" :row="row" /></div>', setup: () => ({ tableRows: inject<Ref<TaskInst[]>>('code-task-rows', ref([rowTask])) }) },
    ElButton: { template: '<button><slot /></button>' },
    ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
    ElAlert: { props: ['title', 'description'], template: '<div>{{ title }} {{ description }}</div>' },
    ElTabs: { template: '<div><slot /></div>' }, ElTabPane: { template: '<div><slot /></div>' },
    GlobalSourceSelect: { name: 'GlobalSourceSelect', props: ['modelValue'], emits: ['update:modelValue'], template: '<div />' },
    RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
    ElSelect: true, ElOption: true, ElInput: true, ElPagination: true,
    ElEmpty: { props: ['description'], template: '<div>{{ description }}</div>' },
  } } })
}
describe('代码生成任务', () => {
  beforeEach(() => {
    vi.spyOn(runnerManagementApi, 'mqCodeJobSummaries').mockResolvedValue({ items: [] })
    vi.spyOn(runnerManagementApi, 'modelInterfaces').mockResolvedValue({ items: [], revision: 1 })
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
  })
  afterEach(() => vi.restoreAllMocks())
  it.each([
    { files: ['links/node-3/cn.chinahdht.com.py'], label: 'cn.chinahdht.com.py', query: { filePath: 'links/node-3/cn.chinahdht.com.py' } },
    { files: ['links/node-3/news.py', 'links/node-3/lib/helper.py'], label: 'node-3', query: { folderPath: 'links/node-3' } },
  ])('列表结果 $label 使用任务归档的位置跳转仓库，无需先打开详情', async ({ files, label, query }) => {
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ list: [task], total: 1 })
    vi.mocked(runnerManagementApi.mqCodeJobSummaries).mockResolvedValue({ items: [{
      taskId: task.taskId, serverId: 'server-1', configId: 'node-3', queue: '', status: 'succeeded', callbackSent: true, message: '', finishedAt: '2026-10-31T03:24:24Z',
      archive: { repoId: 'repo-code', directoryId: 'dir-links', directoryPath: 'links', files: files.map(path => ({ path })) },
    }] })
    const wrapper = render(); await flushPromises()
    const link = wrapper.findAllComponents({ name: 'RouterLink' }).find(component => component.attributes('data-testid') === `code-task-repository-${task.taskId}`)!
    expect(link.text()).toBe(label)
    expect(link.props('to')).toEqual({ path: '/settings', query: { tab: 'code-repos', repoId: 'repo-code', directoryId: 'dir-links', ...query } })
    expect(wrapper.get('.task-list-panel').text()).toContain(files.length > 1 ? '2 个文件' : label)
    expect(wrapper.get(`[data-testid="code-task-status-${task.taskId}"]`).text()).toBe('已完成')
    expect(wrapper.get('.task-list-panel').text()).toContain('完成 2026-10-31 11:24:24')
    expect(wrapper.get('[data-testid="code-task-detail-panel"]').text()).toContain('选择左侧任务')
    wrapper.unmount()
  })
  it('尚无仓库归档的任务不推测生成结果的仓库位置', async () => {
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ list: [task], total: 1 })
    const wrapper = render(); await flushPromises()
    expect(wrapper.find(`[data-testid="code-task-repository-${task.taskId}"]`).exists()).toBe(false)
    wrapper.unmount()
  })
  it('查询数据库生成任务，并展示尚未领取的任务及源节点关系', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成代码', topic: 'code_mq', entryTypeId: null }])
    const paged = vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [task] })
    const execution = vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: null })
    const wrapper = render()
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ configId: '', page: 1, size: 20 }))
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await flushPromises()
    expect(execution).toHaveBeenCalledWith('123')
    expect(wrapper.text()).toContain('任务可能尚未被领取')
    expect(wrapper.text()).toContain('等待处理')
    expect(wrapper.text()).toContain('source-1')
    expect(wrapper.text()).toContain('node-3')
    wrapper.unmount()
  })
  it('不依赖201派发配置即可查询生成任务', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([])
    const paged = vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 0, list: [] })
    const wrapper = render()
    await flushPromises()
    expect(paged).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('尚未领取的任务展示提交时模型快照和提示词，不误报已请求', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成', topic: 'code_mq', entryTypeId: null }])
    const queuedTask = { ...task, vars: JSON.stringify({
      _codeOrchestration: { aiGeneration: { interfaceId: 'wb', systemPrompt: '系统规范', userPrompt: '抓取公司新闻', modelCall: {
        interfaceId: 'wb', name: 'WB Agent', model: 'hy3', kind: 'agent', endpoint: 'http://192.168.1.171:6000/wb/agent', method: 'POST', timeoutSeconds: 300,
      } } },
    }) }
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [queuedTask] })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: null })
    const wrapper = render(queuedTask); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="generation-model-info"]').text()).toContain('WB Agent / wb')
    expect(wrapper.text()).toContain('hy3')
    expect(wrapper.text()).toContain('POST http://192.168.1.171:6000/wb/agent')
    expect(wrapper.text()).toContain('系统规范')
    expect(wrapper.text()).toContain('抓取公司新闻')
    expect(wrapper.get('[data-testid="generation-model-request"]').text()).toContain('尚未构造模型请求')
    wrapper.unmount()
  })
  it('工作空间准备失败也展示执行端模型配置，保留没有 HTTP 请求的事实', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成', topic: 'code_mq', entryTypeId: null }])
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [task] })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: {
      taskId: '123', serverId: 'server-1', configId: 'node-3', queue: 'code_mq', status: 'failed', createdAt: '', startedAt: '2026-10-31', message: 'tasks 拒绝访问', callbackSent: true, stages: [], output: '',
      modelCall: { interfaceId: 'gemini', name: 'Gemini Agent', model: '', kind: 'gemini-agent', endpoint: 'http://model/gemini/agent', method: 'POST', timeoutSeconds: 600, serverName: 'home171' },
    } })
    const wrapper = render(); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Gemini Agent')
    expect(wrapper.text()).toContain('执行端记录的调用配置')
    expect(wrapper.text()).toContain('home171')
    expect(wrapper.text()).toContain('接口默认模型')
    expect(wrapper.get('[data-testid="generation-model-request"]').text()).toContain('尚未构造模型请求')
    wrapper.unmount()
  })
  it('旧任务仅有接口ID时展示当前配置参考，不冒充历史快照', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成', topic: 'code_mq', entryTypeId: null }])
    const historical = { ...task, vars: JSON.stringify({ orchestration: { aiGeneration: { interfaceId: 'old-model' } } }) }
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [historical] })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: null })
    vi.spyOn(runnerManagementApi, 'modelInterfaces').mockResolvedValue({ revision: 1, items: [{ id: 'old-model', name: '当前模型', kind: 'agent', model: 'hy3', endpoint: 'http://model/wb/agent?token=private', timeoutSeconds: 300 } as never] })
    const wrapper = render(historical); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('当前接口配置参考（历史任务未保存快照，不代表当时的实际配置）')
    expect(wrapper.get('[data-testid="generation-model-info"]').text()).toContain('当前模型')
    expect(wrapper.text()).not.toContain('token=private')
    wrapper.unmount()
  })
  it('业务状态为L但尚无执行记录时显示等待处理', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: null, topic: null, entryTypeId: null }])
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [{ ...task, state: 'L' }] })
    const wrapper = render()
    await flushPromises()
    expect(runnerManagementApi.mqCodeJobSummaries).toHaveBeenCalledWith(['123'])
    expect(wrapper.text()).toContain('等待处理')
    wrapper.unmount()
  })
  it('展示生成过程、实际模型请求和代码结果', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: null, topic: null, entryTypeId: null }])
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [task] })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: {
      taskId: '123', serverId: 'server-1', configId: 'node-3', queue: 'code_mq', status: 'succeeded', createdAt: '', message: '已提交 Git',
      callbackSent: true, stages: ['开始生成'], output: '模型正在处理',
      request: { method: 'POST', url: 'http://model/wb/agent', headers: { 'Content-Type': 'application/json' }, body: { prompt: '生成采集代码' } },
      result: { fileName: 'news.py', code: 'print("done")', warnings: [], archive: {
        archiveId: 'internal-archive-id', status: 'committed', message: '', configId: 'node-3', repoId: 'repo-code', directoryId: 'dir-links', directoryPath: 'links', taskId: '123', serverId: 'server-1',
        createdAt: '', gitCommit: 'a'.repeat(40), pushed: true, serverCodeDirectory: 'D:\\workspace\\node-3\\code', files: [
          { path: 'links/node-3/news.py', relativePath: 'node-3/news.py', sha256: 'hash', size: 10, serverPath: 'D:\\workspace\\node-3\\code\\news.py' },
          { path: 'links/node-3/lib/helper.py', relativePath: 'node-3/lib/helper.py', sha256: 'hash2', size: 20, serverPath: 'D:\\workspace\\node-3\\code\\lib\\helper.py' },
        ],
      } },
    } })
    const wrapper = render()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('生成成功 · 结果已保存')
    expect(wrapper.text()).toContain('模型正在处理')
    expect(wrapper.text()).toContain('POST http://model/wb/agent')
    expect(wrapper.text()).toContain('news.py')
    const result = wrapper.get('[data-testid="generation-result"]')
    expect(result.text()).not.toContain('print("done")')
    expect(result.text()).not.toContain('internal-archive-id')
    expect(result.text()).toContain('2 个文件')
    expect(result.text()).toContain('已提交并推送')
    const serverLink = wrapper.findAllComponents({ name: 'RouterLink' }).filter(link => link.attributes('data-testid') === 'generation-server-file-link')
    const gitLinks = wrapper.findAllComponents({ name: 'RouterLink' }).filter(link => link.attributes('data-testid') === 'generation-git-file-link')
    expect(serverLink).toHaveLength(2); expect(gitLinks).toHaveLength(2)
    expect(serverLink[0]!.props('to')).toEqual({ path: '/settings', query: { tab: 'code-servers', serverId: 'server-1', serverFolder: 'D:/workspace/node-3/code' } })
    expect(serverLink[1]!.props('to')).toEqual({ path: '/settings', query: { tab: 'code-servers', serverId: 'server-1', serverFolder: 'D:/workspace/node-3/code/lib' } })
    expect(gitLinks[0]!.props('to')).toEqual({ path: '/settings', query: { tab: 'code-repos', repoId: 'repo-code', directoryId: 'dir-links', filePath: 'links/node-3/news.py' } })
    wrapper.unmount()
  })
  it('执行详情服务失败仍保留任务事实，不误报任务不存在', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: null, topic: null, entryTypeId: null }])
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [task] })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockRejectedValue(new Error('HTTP 502'))
    const wrapper = render()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('执行详情加载失败：HTTP 502')
    expect(wrapper.text()).toContain('任务 ID：123')
    expect(wrapper.text()).not.toContain('任务可能尚未被领取')
    wrapper.unmount()
  })
  it('执行摘要查询失败时仍展示业务任务列表', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: null, topic: null, entryTypeId: null }])
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ total: 1, list: [task] })
    vi.mocked(runnerManagementApi.mqCodeJobSummaries).mockRejectedValue(new Error('HTTP 502'))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('执行状态查询失败：HTTP 502')
    expect(wrapper.text()).toContain('123')
    expect(wrapper.text()).toContain('执行状态待查询')
    wrapper.unmount()
  })
  it('按源查询并在列表显示源、流程节点和模型地址，详情固定在右侧', async () => {
    const identified = { ...task, taskName: '生成步骤脚本[智能采集]-示例源', vars: JSON.stringify({ codeSourceId: 43001, sourceFlowId: 40, stepConfigId: 101, stepId: 45,
      _codeOrchestration: { aiGeneration: { modelCall: { interfaceId: 'wb', name: 'WB Agent', model: 'hy3', endpoint: 'http://model/wb/agent' } } } }) }
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成', topic: 'code_mq', entryTypeId: null }])
    const paged = vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ list: [identified], total: 1 })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: null })
    vi.mocked(flowCenterApi.detail).mockResolvedValue({ name: '新闻采集流程' } as never)
    const wrapper = render(identified); await flushPromises()
    const list = wrapper.get('.task-list-panel')
    expect(list.text()).toContain('示例源')
    expect(list.text()).toContain('新闻采集流程 / 智能采集')
    expect(list.text()).toContain('http://model/wb/agent')
    expect(wrapper.get('[data-testid="code-task-detail-panel"]').text()).toContain('选择左侧任务')
    await wrapper.findComponent({ name: 'GlobalSourceSelect' }).vm.$emit('update:modelValue', '43001'); await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: '43001', page: 1 }))
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="code-task-detail-panel"]').text()).toContain('任务 ID：123')
    expect(wrapper.findComponent({ name: 'ElDrawer' }).exists()).toBe(false)
    wrapper.unmount()
  })
  it('删除成功重新查询并清理右侧详情，不伪造删除结果', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成', topic: 'code_mq', entryTypeId: null }])
    const paged = vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValueOnce({ list: [task], total: 1 }).mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: null })
    const remove = vi.spyOn(runnerManagementApi, 'deleteCodeGenerationTask').mockResolvedValue({ ok: true, message: '任务已删除' })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = render(); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="delete-code-task"]').trigger('click'); await flushPromises()
    expect(remove).toHaveBeenCalledWith('123', '2011')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('将从数据库删除'), '删除任务', expect.anything())
    expect(paged).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="code-task-detail-panel"]').text()).toContain('选择左侧任务')
    wrapper.unmount()
  })
  it('删除失败保留任务和可见错误，只读账号没有删除入口', async () => {
    vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '2011', name: '生成', topic: 'code_mq', entryTypeId: null }])
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValue({ list: [task], total: 1 })
    vi.spyOn(runnerManagementApi, 'deleteCodeGenerationTask').mockRejectedValue(new Error('任务正在生成'))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = render(); await flushPromises()
    await wrapper.get('[data-testid="delete-code-task"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('删除任务失败：任务正在生成')
    expect(wrapper.get('.task-list-panel').text()).toContain('123')
    wrapper.unmount()
    const reader = render(task, 'read'); await flushPromises()
    expect(reader.find('[data-testid="delete-code-task"]').exists()).toBe(false)
    expect(reader.find('[data-testid="delete-selected-code-tasks"]').exists()).toBe(false)
    reader.unmount()
  })
  it('批量删除逐项展示失败，保留失败任务详情', async () => {
    const failed = { ...task, taskId: '124' }
    vi.spyOn(runnerManagementApi, 'codeGenerationTasks').mockResolvedValueOnce({ list: [task, failed], total: 2 }).mockResolvedValue({ list: [failed], total: 1 })
    vi.spyOn(runnerManagementApi, 'mqCodeJob').mockResolvedValue({ job: null })
    const remove = vi.spyOn(runnerManagementApi, 'deleteCodeGenerationTasks').mockResolvedValue({ deletedCount: 1, failedCount: 1, items: [
      { taskId: '123', ok: true, message: '已删除' }, { taskId: '124', ok: false, message: '任务正在生成' },
    ] })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = render(); await flushPromises()
    await wrapper.findAll('button').filter(button => button.text() === '查看详情')[1]!.trigger('click'); await flushPromises()
    wrapper.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', [task, failed]); await flushPromises()
    await wrapper.get('[data-testid="delete-selected-code-tasks"]').trigger('click'); await flushPromises()
    expect(remove).toHaveBeenCalledWith(['123', '124'], '')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('将从数据库删除'), '批量删除任务', expect.anything())
    expect(wrapper.text()).toContain('124：任务正在生成')
    expect(wrapper.get('[data-testid="code-task-detail-panel"]').text()).toContain('任务 ID：124')
    wrapper.unmount()
  })
})
