// 系统设置 tab 壳（0924-02）
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Settings from './index.vue'
import CodeRepositoryTab from './CodeRepositoryTab.vue'
import CodeGenerationServersTab from './CodeGenerationServersTab.vue'
import { useAuthStore } from '@/stores/auth'
import type { NavTab } from '@/api/menu'


async function mountAt(
  query: Record<string, string> = {},
  roles: string[] = [],
  opts: { tabs?: NavTab[]; permissions?: string[] } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      // meta.tabs 就是动态路由从后端菜单（sys_menu res_type=2）带下来的页内 tab
      { path: '/settings', component: { template: '<div />' }, meta: { tabs: opts.tabs } },
      { path: '/collect', component: { template: '<div />' } },
      { path: '/user-permission', component: { template: '<div />' } },
    ],
  })
  await router.push({ path: '/settings', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  // 旧用户管理书签继续携带当前会话，具体权限由用户权限设置页判断。
  const auth = useAuthStore()
  auth.roles = roles
  if (opts.permissions) {
    auth.permissions = opts.permissions
    auth.isMenusLoaded = true
  }
  const wrapper = mount(Settings, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('系统设置 · tab 壳', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('原大模型接口链接转到代码生成服务器的模型配置视图，菜单只保留合并入口', async () => {
    const { wrapper, router } = await mountAt({ tab: 'model-interfaces' })
    expect(router.currentRoute.value.query).toEqual({ tab: 'code-servers', view: 'models' })
    expect(wrapper.findComponent(CodeGenerationServersTab).exists()).toBe(true)
    expect(wrapper.findAll('.st-tab-link').map(button => button.text())).not.toContain('大模型接口')
    wrapper.unmount()
  })

  it('生成结果链接保留仓库和配置子目录参数，并传递到仓库页面', async () => {
    const query = { tab: 'code-repos', repoId: 'repo-result', directoryId: 'dir-links', folderPath: 'links/1401218' }
    const { wrapper, router } = await mountAt(query)
    expect(router.currentRoute.value.query).toEqual(query)
    expect(wrapper.findComponent(CodeRepositoryTab).props()).toMatchObject({ repositoryId: 'repo-result', repositoryDirectoryId: 'dir-links', repositoryFolderPath: 'links/1401218', repositoryFilePath: '' })
    wrapper.unmount()
  })

  it('旧节点代码书签跳转到服务器页面，保留筛选上下文', async () => {
    const { wrapper, router } = await mountAt({ tab: 'site-code', configId: '123' })
    expect(wrapper.findAll('.st-tab-link').map(button => button.text())).not.toContain('节点代码')
    expect(wrapper.find('.st-tab-link.active').text()).toBe('服务器')
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners', configId: '123' })
    expect(wrapper.find('[data-testid="settings-server-workspace"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('旧机器配置链接合并到服务器并保留实例和配置筛选', async () => {
    const { wrapper, router } = await mountAt({ tab: 'assignments', runnerId: 'r-2', configId: '123' })
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'r-2', configId: '123' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('服务器')
    expect(wrapper.find('[data-testid="settings-runtime-bindings"]').exists()).toBe(true)
    expect(wrapper.findAll('.st-tab-link').map(button => button.text())).not.toContain('机器配置')
    wrapper.unmount()
  })
  it('系统设置只剩机器与目录类 tab（来源组已迁回源管理，人与权限类已迁到用户权限设置）', async () => {
    const { wrapper } = await mountAt()

    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '部署资源', '运行日志', '程序版本'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
  })

  it('自带卡片的页签不再套外框，其余页签由容器统一套白底卡片（1107 页面盘点）', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.get('.st-content').classes()).not.toContain('is-framed')

    await wrapper.findAll('.st-tab-link').find((b) => b.text() === '处理机')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.st-content').classes()).toContain('is-framed')
  })

  // 2026-10-13：来源组迁回源管理「我的分组」，旧书签跳过去并带上选中的组
  it('?tab=source-group 跳到源管理「我的分组」', async () => {
    const { router } = await mountAt({ tab: 'source-group', group: '3' })
    expect(router.currentRoute.value.path).toBe('/collect')
    expect(router.currentRoute.value.query).toEqual({ tab: 'personal', group: '3' })
  })

  it('部署构建同样展示全部设置入口，直达服务器页签不回落', async () => {
    vi.stubEnv('DEV', false)
    const { wrapper, router } = await mountAt({ tab: 'runners' })
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '部署资源', '运行日志', '程序版本'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('服务器')
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners' })
  })

  // 1030：数据权限设置 / 用户管理整体迁到侧栏「用户权限设置」页，本页不再渲染这两个 tab，
  // 旧书签跳到新菜单并显式带上对应 tab（新页的默认是用户管理，不猜它、也不省略参数）。
  it('?tab=data-permission 跳到用户权限设置的数据权限 tab', async () => {
    const { router } = await mountAt({ tab: 'data-permission' })
    expect(router.currentRoute.value.path).toBe('/user-permission')
    expect(router.currentRoute.value.query).toEqual({ tab: 'data-permission' })
  })

  it('?tab=category 直达分类目录；点回节点类型地址去掉 tab 参数', async () => {
    const { wrapper, router } = await mountAt({ tab: 'category' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('分类目录')
    expect(wrapper.find('[data-testid="settings-category"]').exists()).toBe(true)

    await wrapper.findAll('.st-tab-link')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
  })

  it('非法 tab 回落到节点类型，地址也归一', async () => {
    const { wrapper, router } = await mountAt({ tab: '不存在' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('admin 的旧用户管理书签跳到用户权限设置，系统设置不再展示重复入口', async () => {
    const { wrapper, router } = await mountAt({ tab: 'users' }, ['admin'])
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '部署资源', '运行日志', '程序版本'])
    expect(router.currentRoute.value.path).toBe('/user-permission')
    expect(router.currentRoute.value.query).toEqual({ tab: 'users' })
    expect(wrapper.find('[data-testid="settings-user-management"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('普通 read 账号的旧用户管理书签转交用户权限设置判断权限', async () => {
    const { wrapper, router } = await mountAt({ tab: 'users' }, ['read'])
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).not.toContain('用户管理')
    expect(router.currentRoute.value.path).toBe('/user-permission')
    expect(router.currentRoute.value.query).toEqual({ tab: 'users' })
    wrapper.unmount()
  })

  // 后端菜单下发的页内 tab（动态路由 meta.tabs，来自 sys_menu res_type=2 记录）：
  // 文案 / 顺序 / 权限过滤全部以后端为准，本地 fallbackTabs 只在菜单没下发时兜底。
  it('后端下发的页内 tab 覆盖本地清单：文案、顺序、权限过滤都按后端', async () => {
    const { wrapper } = await mountAt({}, ['read'], {
      tabs: [
        { id: 3, key: 'runtime-logs', label: '运行日志（后端）', permission: 'settings:assignments', order: 2 },
        { id: 1, key: 'node-type', label: '节点类型（后端）', permission: 'settings:nodeType', order: 1 },
        { id: 2, key: 'category', label: '分类目录（后端）', permission: 'settings:secret', order: 3 },
      ],
      permissions: ['settings:nodeType', 'settings:assignments'],
    })

    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型（后端）', '运行日志（后端）'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型（后端）')
    // 本地 fallback 有、后端没下发的入口（服务器 / 程序版本…）不再出现
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).not.toContain('服务器')
    wrapper.unmount()
  })
})
