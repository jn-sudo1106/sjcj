// AppShell 组合冒烟测试（补 P2-2 拆分遗留的测试缺口 · 之前完全零覆盖）
// AppShell.vue 本身在拆分后只剩纯组合（无逻辑），业务逻辑测试见 AppTopBar/AppSidebar/AppModuleHead.test.ts；
// 本文件只验证 3 个子组件 + router-view 能正确拼装挂载，不重复测子组件内部行为。
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AppShell from './AppShell.vue'
import { getAiChatHistoryPage, listAiSessions, streamAgentChat, type AgentChatEvent } from '@/api/aiChat'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api/aiChat', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/aiChat')>(),
  listAiSessions: vi.fn().mockResolvedValue([]),
  getAiChatHistoryPage: vi.fn().mockResolvedValue({ messages: [], total: 0, pageNo: 1, pageSize: 100 }),
  listRecommendedQuestions: vi.fn().mockResolvedValue([]),
  streamAgentChat: vi.fn(),
}))

async function mountShell(path = '/overview', authenticated = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/overview', component: { template: '<div class="page-stub">页面内容</div>' } },
      // 全宽个人页有两种识别方式：path 兜底（/workbench，防动态路由覆盖 meta）与 meta 标注
      { path: '/workbench', component: { template: '<div class="workbench-stub">工作台内容</div>' } },
      { path: '/workbench-meta', component: { template: '<div class="workbench-stub">工作台内容</div>' }, meta: { layout: 'fullwidth' } },
      { path: '/ai-chat', component: { template: '<div class="duplicate-chat-stub" />' }, meta: { permission: 'ai-chat' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  if (authenticated) {
    useAuthStore().$patch({
      token: 'test-session', isMenusLoaded: true, permissions: ['ai-chat'],
      info: { id: 156, name: 'leo', roles: [], groups: [], avatar: '', introduction: '', group: 1 },
    })
  }
  const wrapper = mount(AppShell, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return wrapper
}

describe('AppShell', () => {
  it('拼装 TopBar / Sidebar / ModuleHead 三个子组件 + router-view', async () => {
    const wrapper = await mountShell()
    expect(wrapper.findComponent({ name: 'AppTopBar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppSidebar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppModuleHead' }).exists()).toBe(true)
  })

  it('router-view 渲染当前路由对应的页面内容', async () => {
    const wrapper = await mountShell()
    expect(wrapper.find('.page-stub').text()).toBe('页面内容')
  })

  it('工作台保留统一侧栏和面包屑，主区保持单一滚动', async () => {
    const wrapper = await mountShell('/workbench')
    expect(wrapper.findComponent({ name: 'AppTopBar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppSidebar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppModuleHead' }).exists()).toBe(true)
    expect(wrapper.get('.rc-bc h1').text()).toBe('我的工作台')
    expect(wrapper.find('.rc-app').classes()).toContain('rc-app--full')
    expect(wrapper.find('.rc-shell').classes()).not.toContain('rc-shell--full')
    expect(wrapper.find('.rc-main').classes()).not.toContain('rc-main--full')
    expect(wrapper.find('.workbench-stub').text()).toBe('工作台内容')
  })

  it('meta.layout=fullwidth 的路由同样走全宽布局', async () => {
    const wrapper = await mountShell('/workbench-meta')
    expect(wrapper.find('.rc-app').classes()).toContain('rc-app--full')
    expect(wrapper.findComponent({ name: 'AppSidebar' }).exists()).toBe(false)
  })

  it('标准路由保持侧栏 + 模块标题区布局', async () => {
    const wrapper = await mountShell()
    expect(wrapper.findComponent({ name: 'AppSidebar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppModuleHead' }).exists()).toBe(true)
    expect(wrapper.find('.rc-app').classes()).not.toContain('rc-app--full')
  })

  it('问数首次打开才加载，浮窗切完整页继续同一条 SSE 并保留输入及澄清选择', async () => {
    vi.mocked(listAiSessions).mockClear().mockResolvedValueOnce([
      { id: '219', title: '上次的历史会话', updatedAt: '昨天', group: 'week' },
    ])
    vi.mocked(getAiChatHistoryPage).mockClear()
    await import('@/views/TemplateConfig/AiChat/index.vue')
    await import('@/views/TemplateConfig/AiChat/ClarificationCard.vue')
    await import('@/components/MarkdownOutput.vue')
    let release!: () => void
    let notify!: (event: AgentChatEvent) => void
    vi.mocked(streamAgentChat).mockReset().mockImplementation((_params, onEvent) => {
      notify = onEvent
      return new Promise<void>((resolve) => { release = resolve })
    })
    const wrapper = await mountShell('/overview', true)
    try {
      expect(listAiSessions).not.toHaveBeenCalled()
      await wrapper.get('.ask-launcher').trigger('click')
      await flushPromises()
      expect(wrapper.find('.ask-panel [data-testid="new-session-view"]').exists()).toBe(true)
      const capabilities = wrapper.findAll('.ask-panel .rc-feature-item').map((item) => item.text())
      expect(capabilities).toEqual(['智能问数', '对话建源', '对话建表'])
      expect(getAiChatHistoryPage).not.toHaveBeenCalled()
      const textarea = wrapper.get('.ask-panel textarea')
      await textarea.setValue('有哪些源未配置流程？')
      await wrapper.get('[data-testid="send-btn"]').trigger('click')
      expect(streamAgentChat).toHaveBeenCalledTimes(1)
      const signal = vi.mocked(streamAgentChat).mock.calls[0][0].signal
      await wrapper.get('.ask-close').trigger('click')
      await wrapper.get('.ask-launcher').trigger('click')
      expect(wrapper.get('.ask-panel .rc-topbar-session-title').text()).toContain('有哪些源未配置流程？')
      expect(signal?.aborted).toBe(false)

      notify({ type: 'clarification', clarification: {
        kind: 'table_choice', reason: 'TOO_MANY', question: '选择数据表', allowFreeText: true, maxSelect: 2,
        options: [{ entryTypeId: 1, tableName: 'sources', typeName: '源管理' }],
      } })
      await flushPromises()
      await wrapper.get('[data-testid="clarification-option-1"]').trigger('click')
      await textarea.setValue('准备继续追问')
      await wrapper.get('.ask-open-full').trigger('click')
      await flushPromises()
      expect(wrapper.get('.rc-ask-full textarea').element).toBe(textarea.element)
      expect(wrapper.get<HTMLTextAreaElement>('.rc-ask-full textarea').element.value).toBe('准备继续追问')
      expect(wrapper.get('.rc-ask-full [data-testid="clarification-confirm"]').attributes('disabled')).toBeUndefined()
      expect(wrapper.find('.duplicate-chat-stub').exists()).toBe(false)
      expect(signal?.aborted).toBe(false)
      notify({ type: 'session_assigned', sessionId: '431', threadId: 'source-thread' })
      notify({ type: 'done' })
      release()
      await flushPromises()
      expect(wrapper.get('.rc-ask-full .rc-session-item.active').text()).toContain('有哪些源未配置流程？')
      expect(wrapper.get('.rc-ask-full .rc-aichat-sidebar').text()).toContain('上次的历史会话')
      expect(streamAgentChat).toHaveBeenCalledTimes(1)
      expect(listAiSessions).toHaveBeenCalledTimes(1)
      expect(getAiChatHistoryPage).not.toHaveBeenCalled()
      await wrapper.vm.$router.push('/overview')
      await flushPromises()
      expect(wrapper.get('.ask-panel').isVisible()).toBe(false)
      await wrapper.get('.ask-launcher').trigger('click')
      expect(wrapper.get('.ask-panel textarea').element).toBe(textarea.element)
      expect(wrapper.find('.ask-panel [data-testid="new-session-view"]').exists()).toBe(true)
      expect(wrapper.get<HTMLTextAreaElement>('.ask-panel textarea').element.value).toBe('')
      await wrapper.get('.ask-open-full').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.rc-ask-full .rc-feature-item').map((item) => item.text())).toEqual(capabilities)
    } finally {
      wrapper.unmount()
    }
  })

  it('明确无问数权限时收起入口并离开完整问数页', async () => {
    const wrapper = await mountShell('/overview', true)
    try {
      expect(wrapper.find('.ask-launcher').exists()).toBe(true)
      useAuthStore().permissions = []
      await flushPromises()
      expect(wrapper.find('.ask-launcher').exists()).toBe(false)
      await wrapper.vm.$router.push('/ai-chat')
      await flushPromises()
      expect(wrapper.vm.$router.currentRoute.value.path).toBe('/overview')
    } finally {
      wrapper.unmount()
    }
  })

  it('四向拖动与缩放分别保存偏好，拖动结束不误开浮窗', async () => {
    localStorage.removeItem('rc:ai-ask-floating:v1:156')
    const wrapper = await mountShell('/overview', true)
    try {
      const launcher = wrapper.get<HTMLButtonElement>('.ask-launcher')
      const initialLeft = launcher.element.style.left
      const from = { clientX: 970, clientY: 625, pointerId: 1, button: 0 }
      const to = { ...from, clientX: 600, clientY: 540 }
      launcher.element.dispatchEvent(new PointerEvent('pointerdown', from))
      window.dispatchEvent(new PointerEvent('pointermove', { ...from, clientX: 920 }))
      window.dispatchEvent(new PointerEvent('pointermove', to))
      await new Promise(requestAnimationFrame)
      expect(launcher.element.style.transform).toBe('translate3d(-370px, -85px, 0)')
      expect(launcher.element.style.left).toBe(initialLeft)
      expect(localStorage.getItem('rc:ai-ask-floating:v1:156')).toBeNull()
      window.dispatchEvent(new PointerEvent('pointerup', to))
      launcher.element.dispatchEvent(new MouseEvent('click', { detail: 1 }))
      await flushPromises()
      expect(wrapper.get('.ask-panel').isVisible()).toBe(false)
      expect(launcher.element.style.transform).toBe('')
      expect(JSON.parse(localStorage.getItem('rc:ai-ask-floating:v1:156')!).launcher.x).toBeLessThan(0.75)

      await launcher.trigger('click')
      const panel = wrapper.get<HTMLElement>('.ask-panel')
      await panel.get('.ask-resize--se').trigger('keydown', { key: 'ArrowLeft' })
      await panel.get('.ask-resize--se').trigger('keydown', { key: 'ArrowUp' })
      expect(panel.element.style.width).toBe('404px')
      expect(panel.element.style.height).toBe('504px')
      await panel.get('.ask-close').trigger('click')
      await launcher.trigger('click')
      expect(panel.element.style.width).toBe('404px')
    } finally {
      wrapper.unmount()
      localStorage.removeItem('rc:ai-ask-floating:v1:156')
    }
  })
})
