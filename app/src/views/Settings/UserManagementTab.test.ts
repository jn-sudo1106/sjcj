// 系统设置 → 用户管理（SYS_USER）列表页接线回归。
// 钉五件容易回退的事：admin 账号只读、新建的组 ID 默认沿用创建人所在组、初始密码必填、
// 停用要先确认且真的调到 update-status、非 admin 会话看不到任何写入口。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import UserManagementTab from './UserManagementTab.vue'
import SysUserDetailDrawer from './SysUserDetailDrawer.vue'
import * as sysUserApi from '@/api/sysUser'
import { useAuthStore } from '@/stores/auth'
import type { SysUserRow } from '@/api/sysUser'

// el-table 在 jsdom 里要量宽
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const ROWS: SysUserRow[] = [
  {
    userId: 1, userLoginName: 'admin', userName: '系统管理员', userStatus: 0, groupId: 1, groupName: '系统管理组',
    roleIds: '1', roleNames: 'admin', creator: 'system', createTime: '2024-01-08 09:12:00',
    modifier: null, updateTime: null, protectedAccount: true,
  },
  {
    userId: 12, userLoginName: 'zhonghe', userName: '钟和', userStatus: 0, groupId: 100001, groupName: '研发部',
    roleIds: '2', roleNames: 'read', creator: 'admin', createTime: '2026-09-14 10:22:00',
    modifier: null, updateTime: null, protectedAccount: false,
  },
  {
    userId: 14, userLoginName: 'like', userName: '李可', userStatus: 1, groupId: 100002, groupName: '运营部',
    roleIds: null, roleNames: null, creator: 'admin', createTime: '2026-08-30 11:02:00',
    modifier: 'admin', updateTime: '2026-10-20 17:30:00', protectedAccount: false,
  },
]

function dialogEl(): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('.el-dialog')].find((d) => d.offsetParent !== null || d.style.display !== 'none')
  if (!el) throw new Error('dialog not open')
  return el
}
function dialogField(testid: string): HTMLInputElement {
  const el = dialogEl().querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)
  if (!el) throw new Error(`field not found: ${testid}`)
  return el
}
async function setValue(el: HTMLInputElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

/** creatorGroup = 会话里当前登录用户的组，新建时作为所属组默认值 */
async function mountAs(roles: string[], creatorGroup?: number) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.roles = roles
  auth.info = creatorGroup === undefined ? null : {
    roles, name: 'admin', groups: [], avatar: '', id: 1, introduction: 'hello', group: creatorGroup,
  }
  vi.spyOn(sysUserApi, 'pagedSysUser').mockResolvedValue({ total: ROWS.length, list: ROWS.map((row) => ({ ...row })) })
  const wrapper = mount(UserManagementTab, { global: { plugins: [pinia, ElementPlus] } })
  await flushPromises()
  return wrapper
}

/** 列表按 ROWS 顺序渲染，操作列里的图标按同一顺序排列 */
function statusSwitch(wrapper: ReturnType<typeof mount>, userId: number) {
  return wrapper.find(`[data-testid="sys-user-status-${userId}"]`)
}

describe('用户管理页面', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('进页面直接查第一页，状态与角色按后端值渲染（无角色标红提示）', async () => {
    const wrapper = await mountAs(['admin'])
    expect(sysUserApi.pagedSysUser).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sysUserApi.pagedSysUser).mock.lastCall?.[0]).toEqual({ loginName: '', userName: '', userStatus: '', page: 1, limit: 20 })
    const text = wrapper.text()
    expect(text).toContain('zhonghe')
    expect(text).toContain('研发部')
    expect(text).toContain('read')
    expect(text).toContain('无角色')
    expect(text).toContain('失效')
  })

  it('内置 admin 行：操作列只渲染「详情」，状态开关禁用（③B）', async () => {
    const wrapper = await mountAs(['admin'])

    // 三行都有详情；编辑 / 重置密码只出现在两个普通账号行——
    // 给内置行渲染置灰图标（甚至解析失败的占位）会让该行比别的多占槽位，图标就歪了
    expect(wrapper.findAll('[data-testid="sys-user-detail"]')).toHaveLength(3)
    expect(wrapper.findAll('[data-testid="sys-user-edit"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="sys-user-password"]')).toHaveLength(2)
    expect(statusSwitch(wrapper, 1).find('input').attributes('disabled')).toBeDefined()
  })

  it('整页没有解析失败的组件（图标漏 import 会渲染成空占位，正是操作列错位的成因）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountAs(['admin'])
    const logged = warn.mock.calls.flat().map(String).join(' | ')
    expect(logged).not.toContain('Failed to resolve component')
  })

  it('新建用户：所属组默认填当前登录管理员自己的组（⑤补充口径）', async () => {
    const wrapper = await mountAs(['admin'], 100001)
    await wrapper.get('[data-testid="sys-user-create"]').trigger('click')
    await flushPromises()

    expect(dialogField('sys-user-group-id').value).toBe('100001')
    expect(dialogEl().textContent).toContain('只读（read）')
  })

  it('新建缺初始密码时前端就拦下：不发请求，也不让弹窗关闭（①C）', async () => {
    const wrapper = await mountAs(['admin'], 100001)
    const warning = vi.spyOn(ElMessage, 'warning')
    const add = vi.spyOn(sysUserApi, 'addSysUser').mockResolvedValue({ ok: true, data: 99 })
    await wrapper.get('[data-testid="sys-user-create"]').trigger('click')
    await flushPromises()

    await setValue(dialogField('sys-user-login-name'), 'newbie')
    await setValue(dialogField('sys-user-name'), '新人')
    dialogEl().querySelector<HTMLElement>('[data-testid="sys-user-save"]')!.click()
    await flushPromises()

    expect(warning).toHaveBeenCalledWith('请填写初始密码')
    expect(add).not.toHaveBeenCalled()
  })

  it('编辑用户：角色可以选择，保存时带上选中的 roleId', async () => {
    const wrapper = await mountAs(['admin'])
    const update = vi.spyOn(sysUserApi, 'updateSysUser').mockResolvedValue({ ok: true })
    const editBtns = wrapper.findAll('[data-testid="sys-user-edit"]')
    await editBtns[0].trigger('click')
    await flushPromises()

    const roleSelect = dialogEl().querySelector('[data-testid="sys-user-role-select"]')
    expect(roleSelect).not.toBeNull()

    dialogEl().querySelector<HTMLElement>('[data-testid="sys-user-save"]')!.click()
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]![0]).toMatchObject({
      userId: 12,
      userLoginName: 'zhonghe',
      roleId: 2,
    })
  })

  it('点状态开关停用要二次确认，确认后按 status=1 调接口并重查列表（只改状态，不解绑角色）', async () => {
    const wrapper = await mountAs(['admin'])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const change = vi.spyOn(sysUserApi, 'changeSysUserStatus').mockResolvedValue({ ok: true, message: '已失效（角色绑定保持不变）' })

    await statusSwitch(wrapper, 12).trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(confirm.mock.calls[0]![0]).toContain('角色绑定保持不变')
    expect(change).toHaveBeenCalledWith(12, 1)
    // 停用后重新拉一次列表，状态与展示保持准确
    expect(vi.mocked(sysUserApi.pagedSysUser)).toHaveBeenCalledTimes(2)
  })

  it('二次确认里点取消：不发状态请求', async () => {
    const wrapper = await mountAs(['admin'])
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const change = vi.spyOn(sysUserApi, 'changeSysUserStatus').mockResolvedValue({ ok: true })

    await statusSwitch(wrapper, 12).trigger('click')
    await flushPromises()

    expect(change).not.toHaveBeenCalled()
  })

  it('启用没有角色的账号：后端拒绝的文案原样透出，开关不翻转（空角色启用守卫）', async () => {
    const wrapper = await mountAs(['admin'])
    const error = vi.spyOn(ElMessage, 'error')
    vi.spyOn(sysUserApi, 'changeSysUserStatus').mockRejectedValue(new Error('该用户没有任何角色绑定，直接启用会被当成管理员'))

    await statusSwitch(wrapper, 14).trigger('click')
    await flushPromises()

    expect(error).toHaveBeenCalledWith('状态更新失败：该用户没有任何角色绑定，直接启用会被当成管理员')
  })

  it('普通 read 账号：新建按钮不渲染，状态开关全部禁用', async () => {
    const wrapper = await mountAs(['read'])
    expect(wrapper.find('[data-testid="sys-user-create"]').exists()).toBe(false)
    const switches = wrapper.findAll('.el-switch')
    expect(switches.length).toBe(ROWS.length)
    switches.forEach((item) => expect(item.find('input').attributes('disabled')).toBeDefined())
  })

  it('用户列表与详情抽屉均展示组名称而非组 ID', async () => {
    const wrapper = await mountAs(['admin'])
    const text = wrapper.text()
    expect(text).toContain('研发部')
    expect(text).toContain('运营部')
    expect(text).toContain('系统管理组')

    // 打开钟和的详情抽屉
    const detailBtns = wrapper.findAll('[data-testid="sys-user-detail"]')
    await detailBtns[1].trigger('click')
    await flushPromises()

    const drawer = wrapper.findComponent(SysUserDetailDrawer)
    expect(drawer.exists()).toBe(true)
    expect(drawer.props('user')?.groupName).toBe('研发部')
    expect(drawer.text()).toContain('用户组')
    expect(drawer.text()).not.toContain('所属组')
    expect(drawer.text()).toContain('研发部')
  })

  it('编辑用户弹窗中正确展示用户组名称而非组 ID，且标签为用户组', async () => {
    const wrapper = await mountAs(['admin'])
    const editBtns = wrapper.findAll('[data-testid="sys-user-edit"]')
    // 点钟和 (groupId 100001, 研发部) 的编辑
    await editBtns[0].trigger('click')
    await flushPromises()

    expect(dialogEl().textContent).toContain('用户组')
    expect(dialogEl().textContent).not.toContain('所属组')
    expect(dialogField('sys-user-group-id').value).toBe('100001')
    const groupSelect = dialogEl().querySelector('[data-testid="sys-user-group-select"]')
    expect(groupSelect?.textContent).toContain('研发部')
  })
})
