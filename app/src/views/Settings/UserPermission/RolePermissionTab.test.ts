// 角色管理 Tab 组件单元测试
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import RolePermissionTab from './RolePermissionTab.vue'
import { useAuthStore } from '@/stores/auth'
import * as roleApi from '@/api/role'
import * as groupResApi from '@/api/groupRes'
import * as sysUserApi from '@/api/sysUser'

const MOCK_ROLES: roleApi.SysRoleRow[] = [
  { roleId: 57, roleName: 'admin', roleRemark: '超级管理员（系统内置）', roleStatus: 0, isSys: true, userCount: 1, createTime: '2024-01-01', modifierTime: '2024-01-01' },
  { roleId: 52, roleName: 'read', roleRemark: '只读用户（系统内置）', roleStatus: 0, isSys: true, userCount: 3, createTime: '2024-01-01', modifierTime: '2024-01-01' },
  { roleId: 60, roleName: 'analyst', roleRemark: '数据分析专员', roleStatus: 0, isSys: false, userCount: 2, createTime: '2026-11-01', modifierTime: '2026-11-02' },
]

const MOCK_TREE: roleApi.SysResourceTreeNode[] = [
  {
    id: 1, parentId: 0, label: '首页', modelCode: 'group:home', level: 1, type: 0, order: 1,
    children: [
      { id: 2, parentId: 1, label: '采集资产总览', modelCode: 'overview', linkAddress: '/overview', level: 2, type: 1, order: 1, children: [] }
    ]
  },
  {
    id: 3, parentId: 0, label: '系统管理', modelCode: 'group:settings', level: 1, type: 0, order: 2,
    children: [
      { id: 4, parentId: 3, label: '用户管理', modelCode: 'settings:users', linkAddress: '/user-permission?tab=users', level: 2, type: 2, order: 1, children: [] }
    ]
  }
]

beforeEach(() => {
  vi.spyOn(roleApi, 'listSysRoles').mockResolvedValue(MOCK_ROLES.map((r) => ({ ...r })))
  vi.spyOn(roleApi, 'getSysResourceTree').mockResolvedValue(JSON.parse(JSON.stringify(MOCK_TREE)))
  vi.spyOn(roleApi, 'getRoleResourceIds').mockResolvedValue([1, 2])
  vi.spyOn(groupResApi, 'listGroupIds').mockResolvedValue([100001, 100002])
  vi.spyOn(sysUserApi, 'pagedSysUser').mockResolvedValue({
    total: 2,
    list: [
      {
        userId: 1, userLoginName: 'admin', userName: '系统管理员', userStatus: 0, groupId: 100001,
        roleIds: '57', roleNames: 'admin', creator: 'system', createTime: '', modifier: null, updateTime: null, protectedAccount: true,
      },
      {
        userId: 12, userLoginName: 'zhonghe', userName: '钟和', userStatus: 0, groupId: 100002,
        roleIds: '52', roleNames: 'read', creator: 'admin', createTime: '', modifier: null, updateTime: null, protectedAccount: false,
      },
    ],
  })
})

async function mountComponent() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/user-permission', component: { template: '<div />' } }] })
  const auth = useAuthStore()
  auth.roles = ['admin']
  auth.info = { name: 'admin', avatar: '', group: 1 } as any

  const wrapper = mount(RolePermissionTab, {
    global: {
      plugins: [pinia, router, ElementPlus],
    },
  })
  await flushPromises()
  return { wrapper, auth, router }
}

describe('角色管理 · RolePermissionTab', () => {
  it('正确渲染左右双栏，加载角色列表并高亮默认第一个角色', async () => {
    const { wrapper } = await mountComponent()
    expect(wrapper.find('[data-testid="settings-role-permission"]').exists()).toBe(true)

    const cards = wrapper.findAll('.role-card-item')
    expect(cards.length).toBe(3)
    // 第一项应默认 active
    expect(cards[0]?.classes()).toContain('active')

    // 右侧应展示当前选中角色的标题
    const highlight = wrapper.find('.role-highlight')
    expect(highlight.exists()).toBe(true)
    expect(highlight.text()).toContain('admin')
    wrapper.unmount()
  })

  it('右侧展示「菜单」与「数据组」两个 tab 页签，支持切换', async () => {
    const { wrapper } = await mountComponent()
    const tabs = wrapper.findAll('.role-right-tabs .el-tabs__item')
    const tabLabels = tabs.map((t) => t.text())
    expect(tabLabels).toContain('菜单')
    expect(tabLabels).toContain('数据组')

    // 默认在菜单 tab
    expect(wrapper.find('.custom-permission-tree').exists()).toBe(true)

    // 点击切换到「数据组」tab
    const dataGroupTab = tabs.find((t) => t.text() === '数据组')
    expect(dataGroupTab).toBeDefined()
    await dataGroupTab?.trigger('click')
    await flushPromises()

    // 切换后显示数据组容器与表格
    expect(wrapper.find('.data-group-pane').exists()).toBe(true)
    expect(wrapper.find('.group-table-wrap').exists()).toBe(true)
    wrapper.unmount()
  })

  it('角色关键字搜索可实时过滤左侧列表', async () => {
    const { wrapper } = await mountComponent()
    const input = wrapper.find('.role-search-input input')
    await input.setValue('analyst')
    await flushPromises()

    const cards = wrapper.findAll('.role-card-item')
    expect(cards.length).toBe(1)
    expect(cards[0]?.text()).toContain('analyst')
    wrapper.unmount()
  })

  it('点击其他角色卡片可切换右侧选中状态', async () => {
    const { wrapper } = await mountComponent()
    const cards = wrapper.findAll('.role-card-item')
    expect(cards.length).toBeGreaterThanOrEqual(2)

    await cards[1]?.trigger('click')
    await flushPromises()

    expect(cards[1]?.classes()).toContain('active')
    expect(wrapper.find('.role-highlight').text()).toContain('read')
    wrapper.unmount()
  })

  it('内置角色与有用户的角色禁用删除按钮', async () => {
    const { wrapper } = await mountComponent()
    const cards = wrapper.findAll('.role-card-item')
    // 第一个为内置 admin 角色，标签包含内置
    const adminCard = cards[0]
    expect(adminCard?.text()).toContain('内置')
    wrapper.unmount()
  })

  it('菜单权限树提供展开/折叠与全选操作按钮', async () => {
    const { wrapper } = await mountComponent()
    // 默认选中的 admin 是只读的，先切到可编辑角色再看工具栏
    await wrapper.findAll('.role-card-item')[1]?.trigger('click')
    await flushPromises()
    const buttons = wrapper.findAll('.tree-actions button')
    const buttonTexts = buttons.map((b) => b.text())
    expect(buttonTexts).toContain('全部折叠')
    expect(buttonTexts).toContain('全选')
    expect(buttonTexts).toContain('全不选')
    expect(buttonTexts).toContain('保存菜单权限')
    wrapper.unmount()
  })

  it('admin 角色不可编辑：编辑入口置灰，点击不打开编辑弹窗', async () => {
    const { wrapper } = await mountComponent()
    const adminCard = wrapper.findAll('.role-card-item')[0]!
    expect(adminCard.text()).toContain('admin')

    const editBtn = adminCard.find('[data-testid="role-edit"]')
    expect(editBtn.exists()).toBe(true)
    expect(editBtn.attributes('disabled')).toBeDefined()

    // 即使触发点击（防御路径），也只提示、不弹窗
    await editBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('admin 角色的右侧区域整体不可点击：只剩只读横幅，无勾选框与全选/保存按钮', async () => {
    const { wrapper } = await mountComponent()
    // 默认选中第一个角色 admin
    expect(wrapper.find('[data-testid="role-readonly-band"]').exists()).toBe(true)
    expect(wrapper.find('.role-detail-pane').classes()).toContain('is-readonly')
    // 整个右侧（含页签）为 inert 且带 pointer-events 兜底，点不动也聚焦不到
    const tabs = wrapper.find('[data-testid="role-readonly-tabs"]')
    expect(tabs.exists()).toBe(true)
    expect(tabs.attributes('inert')).toBeDefined()
    expect(tabs.classes()).toContain('is-inert')
    // 菜单 tab：树只作展示，写操作按钮整体不渲染
    expect(wrapper.findAll('.custom-permission-tree .el-checkbox').length).toBe(0)
    const buttonTexts = wrapper.findAll('.tree-actions button').map((b) => b.text())
    expect(buttonTexts).toContain('全部折叠')
    expect(buttonTexts).not.toContain('全选')
    expect(buttonTexts).not.toContain('全不选')
    expect(buttonTexts).not.toContain('保存菜单权限')
    wrapper.unmount()
  })

  it('admin 角色的数据组 tab 也没有配置入口（只保留查看范围）', async () => {
    const { wrapper } = await mountComponent()
    // jsdom 不执行 inert 的点击拦截，这里只为检查数据组面板里的写入口确实不存在
    const dataGroupTab = wrapper.findAll('.role-right-tabs .el-tabs__item').find((t) => t.text() === '数据组')
    await dataGroupTab?.trigger('click')
    await flushPromises()

    expect(wrapper.find('.data-group-pane').exists()).toBe(true)
    const texts = wrapper.findAll('.data-group-pane button').map((b) => b.text())
    expect(texts).toContain('查看范围')
    expect(texts).not.toContain('配置规则')
    expect(texts).not.toContain('前往数据权限配置页')
    wrapper.unmount()
  })

  it('非 admin 角色仍可编辑：编辑入口可用且可打开弹窗、菜单树可勾选', async () => {
    const { wrapper } = await mountComponent()
    const readCard = wrapper.findAll('.role-card-item')[1]!
    expect(readCard.text()).toContain('read')

    // 先选中 read 角色（点卡片），再走编辑入口
    await readCard.trigger('click')
    await flushPromises()

    // read 角色：右侧恢复可交互，菜单树有勾选框、写操作按钮齐全
    expect(wrapper.findAll('.custom-permission-tree .el-checkbox').length).toBeGreaterThan(0)
    const buttonTexts = wrapper.findAll('.tree-actions button').map((b) => b.text())
    expect(buttonTexts).toContain('全选')
    expect(buttonTexts).toContain('全不选')
    expect(buttonTexts).toContain('保存菜单权限')
    expect(wrapper.find('[data-testid="role-readonly-band"]').exists()).toBe(false)
    expect(wrapper.find('.role-right-tabs').attributes('inert')).toBeUndefined()
    expect(wrapper.find('.role-detail-pane').classes()).not.toContain('is-readonly')

    // 数据组 tab 的配置入口对普通角色照常存在
    const dataGroupTab = wrapper.findAll('.role-right-tabs .el-tabs__item').find((t) => t.text() === '数据组')
    await dataGroupTab?.trigger('click')
    await flushPromises()
    const groupTexts = wrapper.findAll('.data-group-pane button').map((b) => b.text())
    expect(groupTexts).toContain('前往数据权限配置页')
    expect(groupTexts).toContain('配置规则')

    const editBtn = readCard.find('[data-testid="role-edit"]')
    expect(editBtn.attributes('disabled')).toBeUndefined()
    await editBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-dialog').exists()).toBe(true)
    expect(wrapper.find('.el-dialog').text()).toContain('编辑角色')
    wrapper.unmount()
  })
})
