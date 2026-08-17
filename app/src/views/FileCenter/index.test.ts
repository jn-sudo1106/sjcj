// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import FileCenter from './index.vue'
import { siteApi, type Site } from '@/api'

const sites: Site[] = [
  { siteId: 'site-a', name: '网站 A', category: '财经', owner: 'tester', sourceCount: 2, errorCount: 0 },
  { siteId: 'site-b', name: '网站 B', category: '资讯', owner: 'tester', sourceCount: 1, errorCount: 0 },
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/files', component: FileCenter }],
  })
}

describe('FileCenter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('默认不查询全平台，先提示选择网站', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push('/files')
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: true } },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="file-center-empty"]').text()).toContain('请先选择网站')
    expect(wrapper.findComponent({ name: 'SiteFileView' }).exists()).toBe(false)
  })

  it('从 URL 恢复网站和源预筛选，并把源条件交给文件视图', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push({ path: '/files', query: { siteId: 'site-a', sourceId: 'source-2' } })
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: true } },
    })
    await flushPromises()

    const fileView = wrapper.findComponent({ name: 'SiteFileView' })
    expect(fileView.props('siteId')).toBe('site-a')
    expect(fileView.props('initialSourceId')).toBe('source-2')
  })

  it('选择网站后更新 URL，并保留网站范围', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push('/files')
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: true } },
    })
    await flushPromises()

    await wrapper.get('[data-testid="file-center-site-select"]').setValue('site-b')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/files?siteId=site-b')
  })
})
