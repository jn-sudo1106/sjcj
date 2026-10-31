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


async function mountAt(query: Record<string, string> = {}, roles: string[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }, { path: '/collect', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  // 用户管理 tab 只对 admin 可见（1027 决策），其余 tab 的可见性不看角色
  useAuthStore().roles = roles
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
  it('系统设置保留节点类型、分类目录、数据权限设置，并增加 Runner 管理入口（来源组已迁回源管理）', async () => {
    const { wrapper } = await mountAt()

    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '运行日志', '程序版本', '数据权限设置'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
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
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '运行日志', '程序版本', '数据权限设置'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('服务器')
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners' })
  })

  it('?tab=data-permission 直达数据权限设置', async () => {
    const { wrapper } = await mountAt({ tab: 'data-permission' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('数据权限设置')
    expect(wrapper.find('[data-testid="settings-data-permission"]').exists()).toBe(true)
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

  // 1027：admin 是唯一的系统超管，账号维护只对他开放（后端 /api/v1/sys-user/** 同样只认 roles[admin]）
  it('admin 会话多出「用户管理」tab，?tab=users 直达', async () => {
    const { wrapper } = await mountAt({ tab: 'users' }, ['admin'])
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '运行日志', '程序版本', '数据权限设置', '用户管理'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('用户管理')
    expect(wrapper.find('[data-testid="settings-user-management"]').exists()).toBe(true)
  })

  it('普通 read 账号看不到「用户管理」，书签直达也回落到节点类型', async () => {
    const { wrapper, router } = await mountAt({ tab: 'users' }, ['read'])
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).not.toContain('用户管理')
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(router.currentRoute.value.query).toEqual({})
  })
})
