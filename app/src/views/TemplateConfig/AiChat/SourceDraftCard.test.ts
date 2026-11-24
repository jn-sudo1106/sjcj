// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import ElementPlus from 'element-plus'

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  isProductionCreateEnabled: () => true,
}))
const resolveSourceDraft = vi.fn()
vi.mock('@/utils/aiChat/sourceDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/aiChat/sourceDraft')>()),
  resolveSourceDraft: (...args: unknown[]) => resolveSourceDraft(...args),
}))
// 目录树会请求分类接口，这里只关心卡片本身
vi.mock('@/views/FlowCanvas/source/CategoryTreePicker.vue', () => ({ default: { name: 'CategoryTreePicker', template: '<div data-testid="category-picker" />' } }))

import SourceDraftCard from './SourceDraftCard.vue'
import type { SourceDraftHints, SourceDraftState } from '@/utils/aiChat/sourceDraft'

function hints(over: Partial<SourceDraftHints> = {}): SourceDraftHints {
  return {
    existingSite: null, matchedCategory: { dirId: '9009100', category: '房产' },
    templates: [{ id: 't1', name: '通用列表详情' }], matchedTemplateId: 't1',
    siteSources: [], duplicates: {}, warnings: [], ...over,
  }
}

function state(over: Partial<SourceDraftState> = {}): SourceDraftState {
  return {
    draft: {
      siteName: '南京网上房地产', category: '房产', flowTemplate: '通用列表详情', templateSource: '',
      sources: [{ name: '南京二手房挂牌', url: 'http://a' }, { name: '南京二手房成交', url: '' }], remark: '成交源未提供 URL',
    },
    status: 'pending',
    ...over,
  }
}

function mountCard(s: SourceDraftState) {
  return mount(SourceDraftCard, { props: { state: s }, global: { plugins: [ElementPlus], stubs: { RouterLink: RouterLinkStub } } })
}

describe('SourceDraftCard', () => {
  it('回查后渲染：新建网站、分类已匹配、空 URL 提示占位、同名源提示；确认带出表单', async () => {
    resolveSourceDraft.mockResolvedValue(hints({ duplicates: { 南京二手房挂牌: '430011' } }))
    const wrapper = mountCard(state())
    await flushPromises()
    expect(wrapper.text()).toContain('智能体提醒：成交源未提供 URL')
    expect(wrapper.text()).toContain('库中没有同名网站')
    expect(wrapper.text()).toContain('已按「房产」匹配')
    expect(wrapper.text()).toContain('将使用占位 URL')
    expect(wrapper.text()).toContain('已存在同名源（ID 430011）')
    expect(wrapper.findAll('[data-testid="source-draft-row"]')).toHaveLength(2)
    await wrapper.find('[data-testid="source-draft-confirm"]').trigger('click')
    const [form] = wrapper.emitted('confirm')![0] as [Record<string, unknown>]
    expect(form).toMatchObject({ siteMode: 'new', siteName: '南京网上房地产', dirId: '9009100', flowMode: 'template', templateId: 't1' })
  })

  it('校验不过不发 confirm（新建网站没匹配到分类）', async () => {
    resolveSourceDraft.mockResolvedValue(hints({ matchedCategory: null }))
    const wrapper = mountCard(state())
    await flushPromises()
    await wrapper.find('[data-testid="source-draft-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('[data-testid="source-draft-errors"]').text()).toContain('新建网站需要选择业务分类')
  })

  it('没有网站名 → 不关联网站，业务分类必选（源的业务目录）', async () => {
    resolveSourceDraft.mockResolvedValue(hints({ matchedCategory: null }))
    const wrapper = mountCard(state({ draft: { ...state().draft, siteName: '', category: '' } }))
    await flushPromises()
    expect(wrapper.text()).toContain('不归属网站')
    expect(wrapper.find('[data-testid="source-draft-category"]').exists()).toBe(true)
    await wrapper.find('[data-testid="source-draft-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('[data-testid="source-draft-errors"]').text()).toContain('不关联网站也需要选择业务分类')
  })

  it('不关联网站且已匹配到分类 → 可直接确认', async () => {
    resolveSourceDraft.mockResolvedValue(hints())
    const wrapper = mountCard(state({ draft: { ...state().draft, siteName: '' } }))
    await flushPromises()
    await wrapper.find('[data-testid="source-draft-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')![0][0]).toMatchObject({ siteMode: 'none', dirId: '9009100' })
  })

  it('历史回放已创建：不回查，只展示回传结果，没有确认按钮', async () => {
    resolveSourceDraft.mockClear()
    const wrapper = mountCard(state({ status: 'created', resultText: '【建源结果】已创建 1 个源（不关联网站）：A（源 ID 1）。' }))
    await flushPromises()
    expect(resolveSourceDraft).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="source-draft-replay"]').text()).toContain('源 ID 1')
    expect(wrapper.find('[data-testid="source-draft-confirm"]').exists()).toBe(false)
    // 回放也能进画布：从回传文本取源 ID
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ path: '/canvas', query: { sourceId: '1', view: 'flow' } })
  })
})
