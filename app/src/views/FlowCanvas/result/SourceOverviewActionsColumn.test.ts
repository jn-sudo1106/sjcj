// @vitest-environment jsdom
// 源列表最右侧「操作」列（2026-11-09）：默认只露一个 ⋯，点开菜单里是「保存时JSON」，
// 选中后开右侧抽屉。这层守两件事：列在（且是最后一列），以及菜单命令确实把抽屉打开了。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceOverviewView from './SourceOverviewView.vue'
import JsonSnapshotDrawer from '@/views/CollectAssets/JsonSnapshotDrawer.vue'
import { favoriteApi, fileApi, sourceApi, type Source } from '@/api'
import { createPinia, setActivePinia } from 'pinia'

const source: Source = {
  sourceId: 'src-1',
  name: '当前网站源',
  url: 'https://example.com',
  configId: 'cfg-1',
  mainTable: 'TB_1',
  owner: 'tester',
  state: 'C',
  siteId: 'site-current',
  dataCount: 3,
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
  vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({ list: [], total: 0 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SourceOverviewView · 操作列', () => {
  it('操作列在最右侧，默认一个 ⋯；菜单选「保存时JSON」打开抽屉', async () => {
    const wrapper = mount(SourceOverviewView, {
      props: { currentSiteId: 'site-current' },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const headers = wrapper.findAll('thead th')
    expect(headers.at(-1)!.text()).toBe('操作')

    const trigger = wrapper.find('[data-testid="source-actions-src-1"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toBe('⋯')

    const dropdown = wrapper.findAllComponents({ name: 'ElDropdown' }).at(-1)!
    dropdown.vm.$emit('command', 'json-snapshot')
    await flushPromises()

    const drawer = wrapper.findComponent(JsonSnapshotDrawer)
    expect(drawer.exists()).toBe(true)
    expect((drawer.props('source') as Source).sourceId).toBe('src-1')

    wrapper.unmount()
  })
})