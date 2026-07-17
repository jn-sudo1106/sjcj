// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import LoginView from './index.vue'
import { encPassword } from '../../api/auth'

const Stub = { template: '<div />' }

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const okEnvelope = (data: unknown) => jsonResponse({ success: true, code: '0', msg: '操作成功', data })

describe('登录页组件（对齐旧 views/user/Login.vue 交互）', () => {
  const fetchMock = vi.fn()
  let captchaUids: string[]
  let loginBodies: Array<Record<string, string>>
  let loginResponder: () => Promise<Response>
  let router: Router
  let wrapper: VueWrapper

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    captchaUids = ['uid-1', 'uid-2', 'uid-3']
    loginBodies = []
    loginResponder = () => Promise.resolve(okEnvelope({ token: 'tok-e2e' }))
    fetchMock.mockReset()
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/captchaImage') {
        return Promise.resolve(okEnvelope({ uid: captchaUids.shift() ?? 'uid-x', img: 'AAAA' }))
      }
      if (url === '/api/loginCheck2.htm') {
        loginBodies.push(JSON.parse(init?.body as string))
        return loginResponder()
      }
      return Promise.resolve(okEnvelope(null))
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function mountLogin(initialUrl = '/user/login') {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/user/login', component: LoginView },
        { path: '/overview', component: Stub },
        { path: '/data', component: Stub },
      ],
    })
    await router.push(initialUrl)
    wrapper = mount(LoginView, { global: { plugins: [ElementPlus, createPinia(), router] } })
    await flushPromises()
    return wrapper
  }

  async function fill(account: string, password: string, code: string) {
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue(account)
    await inputs[1].setValue(password)
    await inputs[2].setValue(code)
  }

  it('页面进入立即请求验证码并渲染图片（沿用旧 gif 前缀）', async () => {
    await mountLogin()
    expect(fetchMock).toHaveBeenCalledWith('/api/captchaImage', expect.anything())
    expect(wrapper.find('.lg-captcha-img img').attributes('src')).toBe('data:image/gif;base64,AAAA')
  })

  it('密码可见性按钮始终显示并切换输入类型', async () => {
    await mountLogin()
    const passwordInput = wrapper.find('input[placeholder="请输入密码"]')
    const toggle = wrapper.find('.lg-password-toggle')
    expect(passwordInput.attributes('type')).toBe('password')
    expect(toggle.attributes('aria-label')).toBe('显示密码')
    await toggle.trigger('click')
    expect(passwordInput.attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('隐藏密码')
  })

  // 注：必填字段拦截与错误文案渲染不在 jsdom 断言 —— Element Plus 表单校验编排在 jsdom
  // 下行为不稳定（无输入事件时 validate 挂起、有输入事件后放行），该项走真实浏览器验收
  // （见开发计划 §5 Phase 4 任务 3），jsdom 只覆盖可稳定复现的提交链路行为。

  it('验证码图片点击刷新，提交时用最新 uid 参与双 MD5（旧 uid 不再生效）', async () => {
    await mountLogin()
    await wrapper.find('.lg-captcha-img').trigger('click')
    await flushPromises()
    await fill('htqh', 'secret', '8')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(loginBodies.length).toBe(1)
    expect(loginBodies[0].password).toBe(encPassword(encPassword('htqh', 'secret'), '-uid-2'))
    expect(loginBodies[0].username).toBe('htqh')
    expect(loginBodies[0].email).toBeUndefined()
    expect(loginBodies[0].code).toBe('8')
  })

  it('邮箱格式账号按 email 字段提交，哈希输入仍用原值', async () => {
    await mountLogin()
    await fill('a@b.com', 'secret', '8')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(loginBodies[0].email).toBe('a@b.com')
    expect(loginBodies[0].username).toBeUndefined()
    expect(loginBodies[0].password).toBe(encPassword(encPassword('a@b.com', 'secret'), '-uid-1'))
  })

  it('请求中重复提交不会发第二次登录请求', async () => {
    await mountLogin()
    await fill('htqh', 'secret', '8')
    let release!: (r: Response) => void
    loginResponder = () => new Promise((resolve) => (release = resolve))
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(loginBodies.length).toBe(1)
    release(okEnvelope({ token: 't' }))
    await flushPromises()
  })

  it('登录失败：显示后端文案，约 1s 后刷新验证码，DOM 不出现明文密码', async () => {
    vi.useFakeTimers()
    await mountLogin()
    await fill('htqh', 'secret', '8')
    loginResponder = () => Promise.resolve(jsonResponse({ success: false, code: '-1', msg: '验证码错误', data: null }))
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.lg-error').text()).toContain('验证码错误')
    expect(wrapper.html()).not.toContain('secret')
    const captchaCallsBefore = fetchMock.mock.calls.filter((c) => c[0] === '/api/captchaImage').length
    await vi.advanceTimersByTimeAsync(1000)
    const captchaCallsAfter = fetchMock.mock.calls.filter((c) => c[0] === '/api/captchaImage').length
    expect(captchaCallsAfter).toBe(captchaCallsBefore + 1)
  })

  it('登录成功：优先回 redirect 参数指向的页面', async () => {
    await mountLogin('/user/login?redirect=%2Fdata')
    await fill('htqh', 'secret', '8')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/data')
  })

  it('redirect 已由路由解码，不重复解码其中的百分号内容', async () => {
    await mountLogin('/user/login?redirect=%2Fdata%3Fvalue%3D%25252F')
    await fill('htqh', 'secret', '8')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/data?value=%252F')
  })

  it('登录成功且无 redirect 参数：进入 /overview', async () => {
    await mountLogin()
    await fill('htqh', 'secret', '8')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/overview')
  })
})
