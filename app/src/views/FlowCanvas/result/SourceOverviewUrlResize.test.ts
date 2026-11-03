// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { favoriteApi, sourceApi, type Source } from '@/api'
import { columnPrefsKey } from '@/utils/table/columnPrefs'
import SourceOverviewView from './SourceOverviewView.vue'
import { blankSourceListViewState } from './sourceListViewState'

const prefsKey = columnPrefsKey('sources', 'source-overview')
const source = {
  sourceId: '100', name: '长链接源', url: `https://example.com/${'long-path/'.repeat(40)}`,
  siteId: '10', configId: '200', mainTable: '', owner: '', state: 'C',
} as Source

function movePointer(clientX: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX }))
}

describe('源列表 URL 列宽拖动', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.removeItem(prefsKey)
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(prefsKey)
    sessionStorage.clear()
  })

  it.each([
    ['我的分组', { scopeSourceGroupId: '3' }],
    ['系统目录', { scopeCategoryIds: ['1000'] as string[], groupOps: true }],
  ] as const)('%s可拖宽 URL，保留链接与查询范围，松开后记住宽度', async (_, scope) => {
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', ...scope }, global: { plugins: [ElementPlus] } })
    try {
      await flushPromises()
      const calls = vi.mocked(sourceApi.sourcePaged).mock.calls.length
      const oldCursor = document.body.style.cursor
      const oldSelect = document.body.style.userSelect
      wrapper.get('[data-testid="source-url-resizer"]').element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 300, bubbles: true }))
      expect(document.body.style.cursor).toBe('col-resize')
      movePointer(600)
      await flushPromises()
      expect(wrapper.get('.sov-table').attributes('style')).toContain('--sov-url-width: 520px')
      expect(wrapper.get('.sov-url a').attributes('href')).toBe(source.url)
      expect(wrapper.get('.sov-url a').text()).toBe(source.url)
      window.dispatchEvent(new MouseEvent('pointerup'))
      expect(document.body.style.cursor).toBe(oldCursor)
      expect(document.body.style.userSelect).toBe(oldSelect)
      expect(JSON.parse(localStorage.getItem(prefsKey)!).widths.url).toBe(520)
      expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(calls)
      expect(wrapper.emitted('openSource')).toBeUndefined()
      movePointer(900)
      await flushPromises()
      expect(wrapper.get('.sov-table').attributes('style')).toContain('--sov-url-width: 520px')
    } finally {
      wrapper.unmount()
    }
  })

  it('拖窄保留最小宽度，卸载时清理拖动监听和鼠标状态', async () => {
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '10' }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    const oldCursor = document.body.style.cursor
    const oldSelect = document.body.style.userSelect
    wrapper.get('[data-testid="source-url-resizer"]').element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 300, bubbles: true }))
    movePointer(-500)
    await flushPromises()
    expect(wrapper.get('[data-testid="source-url-resizer"]').attributes('aria-valuenow')).toBe('80')
    wrapper.unmount()
    expect(document.body.style.cursor).toBe(oldCursor)
    expect(document.body.style.userSelect).toBe(oldSelect)
    movePointer(1000)
    expect(JSON.parse(localStorage.getItem(prefsKey)!).widths.url).toBe(80)
  })

  it('重新打开沿用保存宽度，键盘可微调，隐藏 URL 时不残留拖动手柄', async () => {
    localStorage.setItem(prefsKey, JSON.stringify({ widths: { url: 500 } }))
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '10' }, global: { plugins: [ElementPlus] } })
    try {
      await flushPromises()
      expect(wrapper.get('[data-testid="source-url-resizer"]').attributes('aria-valuenow')).toBe('500')
      await wrapper.get('[data-testid="source-url-resizer"]').trigger('keydown', { key: 'ArrowRight' })
      expect(JSON.parse(localStorage.getItem(prefsKey)!).widths.url).toBe(520)
      await wrapper.setProps({ viewState: { ...blankSourceListViewState(), hiddenColumns: ['url'] } })
      expect(wrapper.find('[data-testid="source-url-resizer"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
})
