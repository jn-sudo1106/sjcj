// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import { fileApi, type TaskInst } from '@/api'
import * as clipboard from '@/utils/clipboard'

const ElDrawerStub = {
  name: 'ElDrawer',
  props: ['modelValue', 'size', 'withHeader'],
  template: '<div class="drawer-stub" :data-size="size"><slot /></div>',
}

function mockTask(overrides: Partial<TaskInst> = {}): TaskInst {
  return {
    taskId: '88801',
    state: 'E',
    typeName: '详情抓取',
    taskName: '文章抓取任务',
    sourceId: 'src_1001',
    node: 'node_detail',
    topic: 'queue_article',
    parentId: '88800',
    fileId: 'file_99',
    updatedAt: '2026-09-17 10:00:20',
    bizId: 'data_777',
    taskUrl: 'https://example.com/item/1',
    params: '{"page":1,"limit":20}',
    taskResult: '{"status":"error","message":"timeout"}',
    vars: '{"retryCount":2,"pTaskId":"88790"}',
    createdAt: '2026-09-17 10:00:00',
    startedAt: '2026-09-17 10:00:05',
    endedAt: '2026-09-17 10:00:15',
    ...overrides,
  }
}

describe('TaskDetailDrawer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('执行节点 IP 不当作流程节点，真实步骤单独展示', async () => {
    const wrapper = mount(TaskDetailDrawer, {
      props: { modelValue: true, task: mockTask({ node: '172.18.0.1' }) },
      global: { stubs: { ElDrawer: ElDrawerStub, TaskExecutionLinks: true } },
    })
    expect(wrapper.get('[data-testid="task-detail-nodeName"]').text()).toBe('—')
    expect(wrapper.get('[data-testid="task-detail-executionNode"]').text()).toBe('172.18.0.1')
    await wrapper.setProps({ task: mockTask({ node: '172.18.0.1', stepId: '41895' }) })
    expect(wrapper.get('[data-testid="task-detail-nodeName"]').text()).toBe('41895')
    await wrapper.setProps({ task: mockTask({ node: '172.18.0.1', stepId: '0' }), stepName: '0' })
    expect(wrapper.get('[data-testid="task-detail-nodeName"]').text()).toBe('—')
    wrapper.unmount()
  })

  it('正确渲染抽屉标题与标识区字段', () => {
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
        sourceName: '财经源1',
        stepName: '详情解析节点',
        nodeTypeName: '网页抓取',
      },
      global: {
        stubs: { ElDrawer: ElDrawerStub },
      },
    })

    expect(wrapper.text()).toContain('文章抓取任务')
    expect(wrapper.text()).toContain('任务 ID 88801')
    expect(wrapper.text()).toContain('所属源 财经源1')

    // 检查标识区字段
    expect(wrapper.find('[data-testid="task-detail-taskId"]').text()).toBe('88801')
    // 数据 ID 是 parentId（触发任务的那条数据），bizId 是运行上下文 ID、不展示为数据 ID（2026-09-28 实测）
    expect(wrapper.find('[data-testid="task-detail-biz-link"]').text()).toBe('88800')
    expect(wrapper.find('[data-testid="task-detail-source-link"]').text()).toBe('财经源1')
    expect(wrapper.find('[data-testid="task-detail-nodeName"]').text()).toBe('详情解析节点')
    expect(wrapper.find('[data-testid="task-detail-topic"]').text()).toBe('queue_article')
    // 父任务 ID 在 vars.pTaskId，不是 parentId
    expect(wrapper.find('[data-testid="task-detail-parentId"]').text()).toBe('88790')
    expect(wrapper.find('[data-testid="task-detail-fileId"]').text()).toBe('file_99')
    expect(wrapper.find('[data-testid="task-detail-typeName"]').text()).toBe('网页抓取')
    expect(wrapper.find('.rc-status.err').text()).toContain('异常')

    // 检查外链
    const urlLink = wrapper.find('[data-testid="task-detail-url-link"]')
    expect(urlLink.exists()).toBe(true)
    expect(urlLink.attributes('href')).toBe('https://example.com/item/1')

    wrapper.unmount()
  })

  it('0917-02 · 点击所属源（标题区及标识区）发出 openSource 事件', async () => {
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
        sourceName: '财经源1',
      },
      global: {
        stubs: { ElDrawer: ElDrawerStub },
      },
    })

    const sourceLink = wrapper.find('[data-testid="task-detail-source-link"]')
    expect(sourceLink.exists()).toBe(true)
    await sourceLink.trigger('click')
    expect(wrapper.emitted('openSource')).toHaveLength(1)
    expect(wrapper.emitted('openSource')![0]).toEqual([task])

    const headSourceLink = wrapper.find('[data-testid="task-detail-head-source-link"]')
    expect(headSourceLink.exists()).toBe(true)
    await headSourceLink.trigger('click')
    expect(wrapper.emitted('openSource')).toHaveLength(2)
    expect(wrapper.emitted('openSource')![1]).toEqual([task])

    wrapper.unmount()
  })

  it('正确渲染执行时间与更新时间', () => {
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
      },
      global: {
        stubs: { ElDrawer: ElDrawerStub },
      },
    })

    expect(wrapper.find('[data-testid="task-detail-createdAt"]').text()).toBe('2026-09-17 10:00:00')
    expect(wrapper.find('[data-testid="task-detail-startedAt"]').text()).toBe('2026-09-17 10:00:05')
    expect(wrapper.find('[data-testid="task-detail-endedAt"]').text()).toBe('2026-09-17 10:00:15')
    expect(wrapper.find('[data-testid="task-detail-updatedAt"]').text()).toBe('2026-09-17 10:00:20')

    wrapper.unmount()
  })

  it('排错区长文本 JSON 美化并支持一键复制', async () => {
    const copySpy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true)
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
      },
      global: {
        stubs: { ElDrawer: ElDrawerStub },
      },
    })

    const resultPre = wrapper.find('[data-testid="task-result-content"]')
    expect(resultPre.exists()).toBe(true)
    // 应该已经被 JSON 缩进美化
    expect(resultPre.text()).toContain('"status": "error"')

    const paramsPre = wrapper.find('[data-testid="params-content"]')
    expect(paramsPre.text()).toContain('"page": 1')

    const varsPre = wrapper.find('[data-testid="vars-content"]')
    expect(varsPre.text()).toContain('"retryCount": 2')

    // 点击复制
    await wrapper.find('[data-testid="copy-task-result"]').trigger('click')
    expect(copySpy).toHaveBeenCalledWith(expect.stringContaining('"status": "error"'), '执行结果')

    wrapper.unmount()
  })

  it.each(['L', 'E', 'C'] as const)('结果为空时区分执行中与未返回结果，状态 %s 保持接口原值', (state) => {
    const wrapper = mount(TaskDetailDrawer, {
      props: { modelValue: true, task: mockTask({ state, taskResult: '  ' }) },
      global: { stubs: { ElDrawer: ElDrawerStub } },
    })
    expect(wrapper.get('[data-testid="task-result-empty"]').text()).toBe(
      state === 'L' ? '执行中，结果尚未返回' : '后端未返回执行结果',
    )
    expect(wrapper.find('[data-testid="copy-task-result"]').exists()).toBe(false)
    const sections = wrapper.find('[data-testid="task-detail-drawer"]').element.children
    expect(sections[1]!.getAttribute('data-testid')).toBe('task-detail-result')
    wrapper.unmount()
  })

  it('长结果默认折叠，完整原文可展开和复制；切换任务重置折叠状态', async () => {
    const copySpy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true)
    const raw = '执行失败详情\n'.repeat(120) + '原文结尾'
    const wrapper = mount(TaskDetailDrawer, {
      props: { modelValue: true, task: mockTask({ taskResult: raw }) },
      global: { stubs: { ElDrawer: ElDrawerStub } },
    })
    expect(wrapper.get('[data-testid="task-result-preview"]').text()).not.toContain('原文结尾')
    const details = wrapper.get('details')
    expect((details.element as HTMLDetailsElement).open).toBe(false)
    ;(details.element as HTMLDetailsElement).open = true
    expect(wrapper.get('[data-testid="task-result-content"]').text()).toBe(raw)
    await wrapper.get('[data-testid="copy-task-result"]').trigger('click')
    expect(copySpy).toHaveBeenCalledWith(raw, '执行结果')
    await wrapper.setProps({ task: mockTask({ taskId: 'next-task', taskResult: raw }) })
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(false)
    wrapper.unmount()
  })

  it('点击数据 ID 触发 locateData 事件', async () => {
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
      },
      global: {
        stubs: { ElDrawer: ElDrawerStub },
      },
    })

    const bizLink = wrapper.find('[data-testid="task-detail-biz-link"]')
    await bizLink.trigger('click')
    expect(wrapper.emitted('locateData')).toHaveLength(1)
    expect(wrapper.emitted('locateData')![0]).toEqual([task])

    wrapper.unmount()
  })

  // 2026-11-09：旧平台只能在源列表「查询 → 保存时Json」里翻快照，任务详情看不到该步骤存了什么（钉钉反馈）。
  // 这里按当前任务 ID 直接查一次 fileJsonPaged，抽屉里给最近 5 份直链。
  it('保存时 JSON：按任务 ID 查快照，给出 readJson 直链与超量提示', async () => {
    const snapshots = [{
      id: '7400100', sourceId: 'src_1001', taskId: '88801', realName: 'news_main',
      showName: 'snap-7400100.json', storePath: '/sense-data/json/snap-7400100.json',
      fileSize: 2048, state: 'C', createDt: '2026-11-09 10:00:00',
    }]
    const jsonPaged = vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({ list: snapshots, total: 7 })

    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: { modelValue: true, task },
      global: { stubs: { ElDrawer: ElDrawerStub } },
    })
    await flushPromises()

    expect(jsonPaged).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src_1001', taskId: '88801', page: 1, size: 5 }),
    )
    expect(wrapper.find('[data-testid="task-snapshots"]').exists()).toBe(true)
    const links = wrapper.findAll('[data-testid="task-snapshot-open"]')
    expect(links).toHaveLength(1)
    expect(links[0]!.attributes('href')).toContain('readJson?id=7400100')
    expect(links[0]!.attributes('href')).toContain('sourceId=src_1001')
    expect(wrapper.text()).toContain('共 7 份')
    // 抽屉里只列最近几份，超量由「查看全部」打开完整抽屉（2026-11-10：不再让人回源列表）
    const hint = wrapper.find('[data-testid="task-snapshot-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('点「查看全部」打开完整列表')

    await wrapper.get('[data-testid="task-snapshot-all"]').trigger('click')
    expect(wrapper.emitted('openSnapshots')).toHaveLength(1)
    expect(wrapper.emitted('openSnapshots')![0]).toEqual([task])

    wrapper.unmount()
  })

  it('保存时 JSON：查询失败只显示一行提示，不影响详情其余内容', async () => {
    vi.spyOn(fileApi, 'jsonPaged').mockRejectedValue(new Error('接口 502'))
    const wrapper = mount(TaskDetailDrawer, {
      props: { modelValue: true, task: mockTask() },
      global: { stubs: { ElDrawer: ElDrawerStub } },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="task-snapshots"]').text()).toContain('接口 502')
    expect(wrapper.find('[data-testid="task-result-content"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('点击关闭按钮触发 update:modelValue(false)', async () => {
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
      },
      global: {
        stubs: { ElDrawer: ElDrawerStub },
      },
    })

    await wrapper.find('.ffd-close').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])

    wrapper.unmount()
  })
})
