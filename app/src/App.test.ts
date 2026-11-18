// @vitest-environment jsdom
// 2026-11-17：字典只在会话向后端确认有效后才拉，避免会话已死时在登录页多弹「登录失效」。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './stores/auth'
import { useDictStore } from './stores/dict'

const warmUpAuth = vi.fn<() => Promise<boolean>>()
vi.mock('@/router', () => ({ warmUpAuth: () => warmUpAuth() }))

import App from './App.vue'

const userInfo = { roles: ['admin'], name: 'u', avatar: '', id: 1 } as never

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const dict = useDictStore()
  const loadSnatchTypes = vi.spyOn(dict, 'loadSnatchTypes').mockResolvedValue()
  const loadNodeTypeTopics = vi.spyOn(dict, 'loadNodeTypeTopics').mockResolvedValue()
  mount(App, { global: { plugins: [pinia], stubs: { RouterView: true } } })
  return { auth: useAuthStore(), loadSnatchTypes, loadNodeTypeTopics }
}

describe('App 启动时的字典加载', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    warmUpAuth.mockReset()
  })

  it('会话未确认有效（未登录 / 服务端会话已死）时不发字典请求', async () => {
    warmUpAuth.mockResolvedValue(false)
    const { loadSnatchTypes, loadNodeTypeTopics } = setup()
    await flushPromises()
    expect(loadSnatchTypes).not.toHaveBeenCalled()
    expect(loadNodeTypeTopics).not.toHaveBeenCalled()
  })

  it('会话确认有效后拉一次字典', async () => {
    warmUpAuth.mockResolvedValue(true)
    const { loadSnatchTypes, loadNodeTypeTopics } = setup()
    await flushPromises()
    expect(loadSnatchTypes).toHaveBeenCalledTimes(1)
    expect(loadNodeTypeTopics).toHaveBeenCalledTimes(1)
  })

  it('登录成功拿到用户信息后补拉字典，同一会话不重复拉', async () => {
    warmUpAuth.mockResolvedValue(false)
    const { auth, loadSnatchTypes } = setup()
    await flushPromises()
    auth.sessionKey = 'new-session'
    auth.applyUserInfo(userInfo)
    await flushPromises()
    expect(loadSnatchTypes).toHaveBeenCalledTimes(1)
    auth.applyUserInfo({ ...(userInfo as object) } as never)
    await flushPromises()
    expect(loadSnatchTypes).toHaveBeenCalledTimes(1)
  })

  it('登出后换账号重新登录会再拉一次', async () => {
    // 真实的 warmUpAuth 返回 true 时 fetchInfo 已写入用户信息
    warmUpAuth.mockImplementation(async () => {
      useAuthStore().applyUserInfo(userInfo)
      return true
    })
    const { auth, loadSnatchTypes } = setup()
    await flushPromises()
    expect(loadSnatchTypes).toHaveBeenCalledTimes(1)
    auth.clear()
    await flushPromises()
    auth.sessionKey = 'other'
    auth.applyUserInfo(userInfo)
    await flushPromises()
    expect(loadSnatchTypes).toHaveBeenCalledTimes(2)
  })

  it('刷新页面时本地快照里的用户信息不触发字典（没有新的 sessionKey）', async () => {
    warmUpAuth.mockResolvedValue(false)
    const { auth, loadSnatchTypes } = setup()
    await flushPromises()
    auth.applyUserInfo(userInfo)
    await flushPromises()
    expect(loadSnatchTypes).not.toHaveBeenCalled()
  })
})
