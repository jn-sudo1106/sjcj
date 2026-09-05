// @vitest-environment jsdom
// 0904 I16/I17 · Y9：流程详情抽屉里能直接改流程属性（分类/标签/描述），随「保存流程」一并提交。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessage } from 'element-plus'
import FlowDetailDrawer from './FlowDetailDrawer.vue'
import { flowCenterApi, type FlowRecord } from '@/api'

afterEach(() => vi.restoreAllMocks())

const FLOW = {
  id: 'flow-1', name: '新闻采集', version: 1, updatedAt: '2026-09-05 10:00',
  categoryId: '9009289', flowTags: 'a,b', description: '原描述', bizType: '',
  definition: {
    main: ['start', 'web-list', 'end'], branches: [], branchGroups: [],
    configs: { 'web-list': { title: '列表页', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400774' } },
  },
} as unknown as FlowRecord

function mountDrawer(flow: FlowRecord = FLOW) {
  setActivePinia(createPinia())
  return mount(FlowDetailDrawer, {
    props: { flow, categories: [{ id: '9009289', name: '财经' }, { id: '9009290', name: '公告' }] },
    global: {
      directives: { loading: {} },
      stubs: {
        FlowBoard: { template: '<div />' },
        NodeInspector: { template: '<div />' },
      },
    },
  })
}
const saveButton = (w: ReturnType<typeof mountDrawer>) =>
  w.findAll('button').find((b) => b.text().includes('保存流程'))!

describe('流程详情抽屉 · 属性编辑（Y9）', () => {
  it('回填流程现值，改完随保存一起提交，标签按统一口径归一', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOW, version: 2 })
    const w = mountDrawer()
    await flushPromises()

    expect((w.get('[data-testid="flow-meta-category"]').element as HTMLSelectElement).value).toBe('9009289')
    expect((w.get('[data-testid="flow-meta-tags"]').element as HTMLInputElement).value).toBe('a,b')
    expect((w.get('[data-testid="flow-meta-desc"]').element as HTMLInputElement).value).toBe('原描述')

    await w.get('[data-testid="flow-meta-category"]').setValue('9009290')
    await w.get('[data-testid="flow-meta-tags"]').setValue('公告，公告  年报')
    await w.get('[data-testid="flow-meta-desc"]').setValue('  新描述  ')
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'flow-1', categoryId: '9009290', flowTags: '公告,年报', description: '新描述',
    }))
  })

  // saveFlow 是全量保存：抽屉里清空 = 真的要清空，所以空串必须照传（与新建表单相反）。
  it('清空分类/标签/描述会提交空串，而不是被当成"没填"跳过', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue(FLOW)
    const w = mountDrawer()
    await flushPromises()
    await w.get('[data-testid="flow-meta-category"]').setValue('')
    await w.get('[data-testid="flow-meta-tags"]').setValue('')
    await w.get('[data-testid="flow-meta-desc"]').setValue('')
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ categoryId: '', flowTags: '', description: '' }))
  })

  // 保存失败必须把后端原文说出来（Y9）：只说"保存失败"排查不了权限/字段这类问题。
  it('保存失败时把后端错误原文带进提示', async () => {
    vi.spyOn(flowCenterApi, 'save').mockRejectedValue(new Error('flowName 已存在'))
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)
    const w = mountDrawer()
    await flushPromises()
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(error).toHaveBeenCalledWith(expect.stringContaining('flowName 已存在'))
  })

  // bizType 只读（0904 Q3）：生产 200 条流程全为空，枚举无从照抄，不做下拉。
  it('业务大类不提供选择', () => {
    const w = mountDrawer()
    expect(w.find('[data-testid="flow-meta-biztype"]').exists()).toBe(false)
  })
})
