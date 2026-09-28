// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import type { TaskInst } from '@/api'
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

  it('正确渲染抽屉标题与标识区字段', () => {
    const task = mockTask()
    const wrapper = mount(TaskDetailDrawer, {
      props: {
        modelValue: true,
        task,
        sourceName: '财经源1',
        stepName: '详情解析节点',
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
    expect(wrapper.find('[data-testid="task-detail-typeName"]').text()).toBe('详情抓取')
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
