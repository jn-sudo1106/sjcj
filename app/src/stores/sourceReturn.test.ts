// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'
import { useSourceReturnStore } from './sourceReturn'

function account(id: number) {
  const auth = useAuthStore()
  auth.token = 'test-session'
  auth.info = { id, name: `user-${id}`, roles: ['admin'], groups: [], avatar: '', introduction: '', group: 1 }
  return auth
}

describe('跨模块返回源记录', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://124.223.180.186:9999')
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllEnvs())

  it('保留源、具体流程、视图、节点、配置页签及原列表位置；不保存任意查询参数', () => {
    account(1)
    const store = useSourceReturnStore()
    store.remember('source-a', '源 A', { siteId: '8', sourceGroupId: '3', view: 'flow', flowId: '201', workflowId: '200', nodeId: 'n2', tab: 'table', returnTo: '/collect?tab=personal&group=3', token: 'must-not-persist' })
    expect(store.point).toEqual({ sourceId: 'source-a', name: '源 A', query: { sourceId: 'source-a', siteId: '8', sourceGroupId: '3', view: 'flow', flowId: '201', workflowId: '200', nodeId: 'n2', tab: 'table', returnTo: '/collect?tab=personal&group=3' } })
    expect(sessionStorage.getItem('rc-source-return:124.223.180.186:1')).not.toContain('must-not-persist')
  })

  it('同账号同环境刷新恢复；切账号及环境不显示旧记录', () => {
    account(1)
    useSourceReturnStore().remember('a', '源 A', { view: 'data' })
    setActivePinia(createPinia())
    account(1)
    const restored = useSourceReturnStore()
    expect(restored.point?.sourceId).toBe('a')
    account(2)
    expect(restored.point).toBeNull()
    restored.remember('b', '源 B', { view: 'flow' })
    account(1)
    expect(restored.point?.sourceId).toBe('a')
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    setActivePinia(createPinia())
    account(1)
    expect(useSourceReturnStore().point).toBeNull()
  })

  it('退出清理当前记录；未登录时不记录源', () => {
    const auth = account(1)
    const store = useSourceReturnStore()
    store.remember('a', '源 A', {})
    auth.clear()
    expect(store.point).toBeNull()
    expect(sessionStorage.getItem('rc-source-return:124.223.180.186:1')).toBeNull()
    store.remember('b', '源 B', {})
    expect(store.point).toBeNull()
  })

  it('忽略损坏记录，拒绝外部返回路径，旧请求不能清除较新的源', () => {
    account(1)
    sessionStorage.setItem('rc-source-return:124.223.180.186:1', '{broken')
    const store = useSourceReturnStore()
    expect(store.point).toBeNull()
    store.remember('a', '', { returnTo: '//example.com', view: 'unknown' })
    expect(store.point).toEqual({ sourceId: 'a', name: 'a', query: { sourceId: 'a', view: 'overview' } })
    store.clear('b')
    expect(store.point?.sourceId).toBe('a')
    store.clear('a')
    expect(store.point).toBeNull()
  })
})
