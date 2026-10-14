// @vitest-environment jsdom
// 模板配置的 tab 壳（1015）：侧栏原 8 个子项收进页内 tab，这里只测壳本身
// ——有哪几个 tab、选中哪个渲染哪个组件、URL 怎么同步。各子模块的内部功能沿用原有测试。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

// 8 个 tab 的真实组件都要打 /api/poc 接口，壳的测试不关心它们内部，换成占位组件。
// vi.mock 会被提到 import 之前执行，工厂里不能引用外部变量，所以逐个写死。
vi.mock('./SqlTemplatePage.vue', () => ({ default: { name: 'SqlTemplatePage', template: '<div data-testid="stub-sql-template">SQL模板配置内容</div>' } }))
vi.mock('./TableTemplate/index.vue', () => ({ default: { name: 'TableTemplatePage', template: '<div data-testid="stub-table-template">表模板配置内容</div>' } }))
vi.mock('./DicTemplate/index.vue', () => ({ default: { name: 'DicTemplatePage', template: '<div data-testid="stub-dic-template">自动补全配置内容</div>' } }))
vi.mock('./QuestionDic/index.vue', () => ({ default: { name: 'QuestionDicPage', template: '<div data-testid="stub-question-dic">问句改写配置内容</div>' } }))
vi.mock('./DataIndexSync/index.vue', () => ({ default: { name: 'DataIndexSyncPage', template: '<div data-testid="stub-data-index-sync">数据索引同步内容</div>' } }))
vi.mock('./DataIndexConfig/index.vue', () => ({ default: { name: 'DataIndexConfigPage', template: '<div data-testid="stub-data-index-config">数据字典配置内容</div>' } }))
vi.mock('./ChatFlowStep/index.vue', () => ({ default: { name: 'ChatFlowStepPage', template: '<div data-testid="stub-chat-flow-step">提示词配置内容</div>' } }))
vi.mock('./WordSegmentConfig/index.vue', () => ({ default: { name: 'WordSegmentConfigPage', template: '<div data-testid="stub-word-segment-config">分词配置内容</div>' } }))

async function mountCenter(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/template-config', component: { template: '<div />' } }],
  })
  await router.push({ path: '/template-config', query })
  await router.isReady()
  setActivePinia(createPinia())
  const TemplateConfig = (await import('./index.vue')).default
  const wrapper = mount(TemplateConfig, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('模板配置 · tab 壳', () => {
  it('8 个 tab，顺序与原侧栏子项一致', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.findAll('[data-testid="template-config-tab"]').map((b) => b.text())).toEqual([
      'SQL模板配置',
      '表模板配置',
      '自动补全配置',
      '问句改写配置',
      '数据索引同步',
      '数据字典配置',
      '提示词配置',
      '分词配置',
    ])
  })

  it('默认落 SQL模板配置', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.find('[data-testid="stub-sql-template"]').exists()).toBe(true)
  })

  it('URL 带 tab=word-segment-config 时直接落分词配置（深链与刷新）', async () => {
    const { wrapper } = await mountCenter({ tab: 'word-segment-config' })
    expect(wrapper.find('[data-testid="stub-word-segment-config"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-sql-template"]').exists()).toBe(false)
  })

  it('点提示词配置：切内容并把 tab 写进 URL', async () => {
    const { wrapper, router } = await mountCenter()
    await wrapper.findAll('[data-testid="template-config-tab"]')[6].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'chat-flow-step' })
    expect(wrapper.find('[data-testid="stub-chat-flow-step"]').exists()).toBe(true)
  })

  it('切回默认 tab 时不留 tab 参数，/template-config 地址保持干净', async () => {
    const { wrapper, router } = await mountCenter({ tab: 'dic-template' })
    await wrapper.findAll('[data-testid="template-config-tab"]')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('非法 tab 回落 SQL模板配置并把地址归一，不渲染空白页', async () => {
    const { wrapper, router } = await mountCenter({ tab: '不存在的tab' })
    await flushPromises()
    expect(wrapper.find('[data-testid="stub-sql-template"]').exists()).toBe(true)
    expect(router.currentRoute.value.query).toEqual({})
  })
})
