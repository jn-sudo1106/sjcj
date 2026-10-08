// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { runnerManagementApi, type QueueAssignment, type RunnerInstance, type SiteCodeVersion } from '@/api/runnerManagement'
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
  it('在列表新增一行，选择节点代码后自动显示队列，无独立版本选择', async () => {
    const wrapper = await renderAssignments()
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(true)
    expect(wrapper.find('.el-dialog').exists()).toBe(false)
    expect(wrapper.get('[data-testid="assignment-node-code"]').text()).toContain('news_list · #c-1 · sites/www.realcan.cn.py')
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
    expect(wrapper.get('[role="alert"]').text()).toContain('请选择节点代码和 Runner 实例')
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
