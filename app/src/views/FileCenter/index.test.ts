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

const fileViewStub = {
  name: 'SiteFileView',
  props: ['siteId', 'initialSourceId'],
  template: '<div><slot name="toolbar-prefix" /></div>',
}

describe('FileCenter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('默认查询全部网站，不要求先选择网站', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push('/files')
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: fileViewStub } },
    })
    await flushPromises()

    const fileView = wrapper.findComponent({ name: 'SiteFileView' })
    expect(fileView.exists()).toBe(true)
    expect(fileView.props('siteId')).toBeUndefined()
  })

  it('从 URL 恢复网站和源预筛选，并把源条件交给文件视图', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push({ path: '/files', query: { siteId: 'site-a', sourceId: 'source-2' } })
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: fileViewStub } },
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
      global: { plugins: [router], stubs: { SiteFileView: fileViewStub } },
    })
    await flushPromises()

    await wrapper.findAll('[data-testid="file-center-site-row"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/files?siteId=site-b')
    expect(wrapper.findAll('[data-testid="file-center-site-row"]')[1]!.classes()).toContain('on')

    await wrapper.get('[data-testid="file-center-site-all"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/files')
  })

  it('左侧搜索按网站名称或 ID 在本地过滤', async () => {
    const paged = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push('/files')
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: fileViewStub } },
    })
    await flushPromises()

    await wrapper.get('[data-testid="file-center-site-search"]').setValue('site-b')
    expect(wrapper.findAll('[data-testid="file-center-site-row"]').map((row) => row.text())).toEqual(['网站 B1'])
    await wrapper.get('[data-testid="file-center-site-search"]').setValue('不存在')
    expect(wrapper.text()).toContain('没有匹配的网站')
    expect(paged).toHaveBeenCalledTimes(1)
  })

  it('网站列表加载失败时文件视图照常可用，左侧给出重试', async () => {
    const paged = vi.spyOn(siteApi, 'sitePaged').mockRejectedValueOnce(new Error('后端 500')).mockResolvedValue({ total: sites.length, list: sites })
    const router = makeRouter()
    await router.push('/files')
    const wrapper = shallowMount(FileCenter, {
      global: { plugins: [router], stubs: { SiteFileView: fileViewStub } },
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'SiteFileView' }).exists()).toBe(true)
    expect(wrapper.text()).toContain('后端 500')
    await wrapper.get('[data-testid="file-center-retry"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-testid="file-center-site-row"]')).toHaveLength(2)
  })
})
