// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import { useAuthStore } from '../stores/auth'
import { encPassword } from '../api/auth'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
const okEnvelope = (data: unknown) => jsonResponse({ success: true, code: '0', msg: '操作成功', data })

// 修改密码弹窗（对齐旧 UserMenu.vue submitChangePwd）
describe('ChangePasswordDialog', () => {
  const fetchMock = vi.fn()
  let wrapper: VueWrapper
  let bodies: Array<Record<string, string>>

  beforeEach(() => {
    setActivePinia(createPinia())
    bodies = []
    fetchMock.mockReset()
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/user/changePassword.htm') {
        bodies.push(JSON.parse(init?.body as string))
        return Promise.resolve(okEnvelope(null))
      }
      return Promise.resolve(okEnvelope(null))
    })
    vi.stubGlobal('fetch', fetchMock)
    const auth = useAuthStore()
    auth.name = 'htqh' // 哈希入参用 store.name（旧 nickname），不是登录账号
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
  })

  function mountDialog() {
    wrapper = mount(ChangePasswordDialog, {
      props: { modelValue: true },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    return wrapper
  }

  function fields() {
    // el-dialog 渲染到 body，输入框按顺序：原密码/新密码/确认密码
    return Array.from(document.querySelectorAll<HTMLInputElement>('.el-dialog input'))
  }

  async function setField(idx: number, value: string) {
    const input = fields()[idx]
    input.value = value
    input.dispatchEvent(new Event('input'))
    await flushPromises()
  }

  async function clickConfirm() {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.el-dialog button'))
    const ok = buttons.find((b) => b.textContent?.replace(/\s/g, '') === '确定')
    ok?.click()
    await flushPromises()
  }

  it('成功修改：哈希为 md5(name+明文) 单层，提交后关闭弹窗', async () => {
    mountDialog()
    await flushPromises()
    await setField(0, 'oldpass')
    await setField(1, 'newpass')
    await setField(2, 'newpass')
    await clickConfirm()
    expect(bodies.length).toBe(1)
    expect(bodies[0]).toEqual({
      oldPwd: encPassword('htqh', 'oldpass'),
      newPwd: encPassword('htqh', 'newpass'),
    })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  // 注：两次密码不一致的校验拦截不在 jsdom 断言 —— Element Plus 表单校验在 jsdom 下
  // 行为不稳定（validate 误判通过），与登录页同一已知限制，该项走真实浏览器验收（计划 §11.4）。

  it('后端失败：透传 msg 为「修改密码出错, 原因: …」，弹窗保持打开', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse({ success: false, code: '-1', msg: '旧密码校验不通过', data: null })),
    )
    mountDialog()
    await flushPromises()
    await setField(0, 'oldpass')
    await setField(1, 'newpass')
    await setField(2, 'newpass')
    await clickConfirm()
    expect(document.body.textContent).toContain('修改密码出错, 原因: 旧密码校验不通过')
    // 未 emit 关闭
    expect(wrapper.emitted('update:modelValue')?.at(-1)).not.toEqual([false])
  })

  it('哈希入参始终用 store.name 而非任何账号输入', async () => {
    const auth = useAuthStore()
    auth.name = '张三'
    mountDialog()
    await flushPromises()
    await setField(0, 'a')
    await setField(1, 'b')
    await setField(2, 'b')
    await clickConfirm()
    expect(bodies[0].oldPwd).toBe(encPassword('张三', 'a'))
    expect(bodies[0].newPwd).toBe(encPassword('张三', 'b'))
  })
})
