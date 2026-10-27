// 系统设置 → 用户管理（SYS_USER）列表页接线回归。
// 钉五件容易回退的事：admin 账号只读、新建的组 ID 默认沿用创建人所在组、初始密码必填、
// 停用要先确认且真的调到 update-status、非 admin 会话看不到任何写入口。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import UserManagementTab from './UserManagementTab.vue'
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
    userId: 1, userLoginName: 'admin', userName: '系统管理员', userStatus: 0, groupId: 1,
    roleIds: '1', roleNames: 'admin', creator: 'system', createTime: '2024-01-08 09:12:00',
    modifier: null, updateTime: null, protectedAccount: true,
  },
  {
    userId: 12, userLoginName: 'zhonghe', userName: '钟和', userStatus: 0, groupId: 100001,
    roleIds: '2', roleNames: 'read', creator: 'admin', createTime: '2026-09-14 10:22:00',
    modifier: null, updateTime: null, protectedAccount: false,
  },
  {
    userId: 14, userLoginName: 'like', userName: '李可', userStatus: 1, groupId: 100002,
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
const ROW_ORDER = ROWS.map((row) => row.userId)
function editIcon(wrapper: ReturnType<typeof mount>, userId: number) {
  return wrapper.findAll('[data-testid="sys-user-edit"]')[ROW_ORDER.indexOf(userId)]!
}
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
    expect(text).toContain('read')
    expect(text).toContain('无角色')
    expect(text).toContain('失效')
  })

  it('内置 admin 行：状态开关禁用，点编辑只给原因、不发请求（③B）', async () => {
    const wrapper = await mountAs(['admin'])
    const warning = vi.spyOn(ElMessage, 'warning')
    const update = vi.spyOn(sysUserApi, 'updateSysUser').mockResolvedValue({ ok: true })

    expect(statusSwitch(wrapper, 1).find('input').attributes('disabled')).toBeDefined()
    await editIcon(wrapper, 1).trigger('click')
    await flushPromises()

    expect(warning).toHaveBeenCalledWith('内置 admin 账号不允许在此修改')
    expect(update).not.toHaveBeenCalled()
    expect(document.querySelector('.el-dialog')).toBeNull()
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

  it('点状态开关停用要二次确认，确认后按 status=1 调接口并重查列表（②C）', async () => {
    const wrapper = await mountAs(['admin'])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const change = vi.spyOn(sysUserApi, 'changeSysUserStatus').mockResolvedValue({ ok: true, message: '已失效，并解除 1 条角色绑定' })

    await statusSwitch(wrapper, 12).trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(confirm.mock.calls[0]![0]).toContain('必须先在后台数据库把角色绑定补回来')
    expect(change).toHaveBeenCalledWith(12, 1)
    // 停用后重新拉一次列表，才能拿到已被清空的角色绑定
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

  it('启用没有角色的账号：后端拒绝的文案原样透出，开关不翻转（启用闸门）', async () => {
    const wrapper = await mountAs(['admin'])
    const error = vi.spyOn(ElMessage, 'error')
    vi.spyOn(sysUserApi, 'changeSysUserStatus').mockRejectedValue(new Error('该用户已没有角色，直接启用会拿到管理员权限'))

    await statusSwitch(wrapper, 14).trigger('click')
    await flushPromises()

    expect(error).toHaveBeenCalledWith('状态更新失败：该用户已没有角色，直接启用会拿到管理员权限')
  })

  it('普通 read 账号：新建按钮不渲染，状态开关全部禁用', async () => {
    const wrapper = await mountAs(['read'])
    expect(wrapper.find('[data-testid="sys-user-create"]').exists()).toBe(false)
    const switches = wrapper.findAll('.el-switch')
    expect(switches.length).toBe(ROWS.length)
    switches.forEach((item) => expect(item.find('input').attributes('disabled')).toBeDefined())
  })
})
