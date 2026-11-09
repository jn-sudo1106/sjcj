// @vitest-environment jsdom
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FavoriteEntry from './FavoriteEntry.vue'
import { favoriteSiteIds, favoriteSitesLoaded } from '@/utils/siteFavorites'
import { favoriteSourceIds, favoriteSourcesLoaded } from '@/utils/sourceFavorites'
import { favoriteEntryIds, favoriteEntriesLoaded } from '@/utils/entryFavorites'
import { loadFavoriteSummary, resetFavoriteSummaryForTest } from '@/utils/favoriteSummary'

const listIds = vi.fn<(itemType: string) => Promise<string[]>>()

vi.mock('@/api', () => ({
  favoriteApi: {
    listIds: (itemType: string) => listIds(itemType),
    add: vi.fn(() => Promise.resolve({ ok: true })),
    remove: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

type Wrapper = VueWrapper<unknown>

let wrapper: Wrapper | null = null
let router: ReturnType<typeof createRouter>

function resetFavorites() {
  favoriteSiteIds.value = new Set()
  favoriteSourceIds.value = new Set()
  favoriteEntryIds.value = new Set()
  favoriteSitesLoaded.value = false
  favoriteSourcesLoaded.value = false
  favoriteEntriesLoaded.value = false
  resetFavoriteSummaryForTest()
}

async function mountEntry() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/overview', component: { template: '<div />' } },
      { path: '/collect', component: { template: '<div />' } },
      { path: '/data', component: { template: '<div />' } },
    ],
  })
  await router.push('/overview')
  await router.isReady()
  wrapper = mount(FavoriteEntry, {
    attachTo: document.body,
    global: { plugins: [createPinia(), ElementPlus, router] },
  })
  return wrapper
}

beforeEach(() => {
  resetFavorites()
  listIds.mockReset()
  document.body.innerHTML = ''
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('总览·我的收藏入口', () => {
  it('三类收藏拉回来后在胶囊上显示合计数', async () => {
    listIds.mockImplementation(async (itemType) => {
      if (itemType === 'SITE') return ['1', '2']
      if (itemType === 'SOURCE') return ['9']
      if (itemType === 'ENTRY_TYPE') return ['a', 'b', 'c']
      return []
    })
    await loadFavoriteSummary()
    const w = await mountEntry()
    await flushPromises()

    const chip = w.get('[data-testid="overview-favorite-entry"]')
    expect(chip.text()).toContain('我的收藏')
    expect(chip.text()).toContain('6')
    expect(chip.attributes('aria-label')).toBe('我的收藏，共 6 项')
  })

  it('加载中先不显示数字，展开后是骨架与"正在统计"', async () => {
    // 卡住三类的返回：既验证加载态，又要在用例结束前放行，否则三份 loader 的 in-flight
    // promise 会一直挂着，后续用例 await 到它直接超时
    const pending: ((ids: string[]) => void)[] = []
    listIds.mockImplementation(() => new Promise<string[]>((resolve) => { pending.push(resolve) }))
    void loadFavoriteSummary()
    const w = await mountEntry()
    await flushPromises()

    const chip = w.get('[data-testid="overview-favorite-entry"]')
    expect(chip.text()).not.toMatch(/\d/)
    expect(chip.attributes('aria-label')).toBe('我的收藏')

    await chip.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('正在统计')
    expect(document.body.textContent).toContain('—')

    pending.forEach((resolve) => resolve([]))
    await flushPromises()
  })

  it('接口失败不抛错：胶囊不显示数字，弹层仍能用两行跳转', async () => {
    listIds.mockRejectedValue(new Error('未登录'))
    await loadFavoriteSummary()
    const w = await mountEntry()
    await flushPromises()

    const chip = w.get('[data-testid="overview-favorite-entry"]')
    expect(chip.text()).toBe('我的收藏')

    await chip.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('收藏数量加载失败')

    const rows = document.body.querySelectorAll<HTMLButtonElement>('.ov-fav-row')
    expect(rows).toHaveLength(2)
    rows[0].click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/collect')
    expect(router.currentRoute.value.query.tab).toBe('favorite')

    await chip.trigger('click')
    await flushPromises()
    const rowsAgain = document.body.querySelectorAll<HTMLButtonElement>('.ov-fav-row')
    rowsAgain[1].click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/data')
    expect(router.currentRoute.value.query.tab).toBe('entry')
    // 1108 补的深链：表 ID 列表直接落在「只看收藏」
    expect(router.currentRoute.value.query.fav).toBe('1')
  })

  it('一条收藏都没有时给引导，而不是两行 0', async () => {
    listIds.mockResolvedValue([])
    await loadFavoriteSummary()
    const w = await mountEntry()
    await flushPromises()

    const chip = w.get('[data-testid="overview-favorite-entry"]')
    expect(chip.text()).toBe('我的收藏')
    expect(chip.classes()).toContain('is-empty')

    await chip.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('还没有收藏任何内容')
    expect(document.body.textContent).toContain('去采集资产逛逛')
    expect(document.body.querySelectorAll('.ov-fav-row')).toHaveLength(0)
  })

  it('两行分别给出各自的数量（第 1 行是网站 + 源）', async () => {
    listIds.mockImplementation(async (itemType) => {
      if (itemType === 'SITE') return ['1', '2', '3', '4', '5']
      if (itemType === 'SOURCE') return ['9', '10', '11', '12']
      return ['a', 'b', 'c']
    })
    await loadFavoriteSummary()
    const w = await mountEntry()
    await flushPromises()

    await w.get('[data-testid="overview-favorite-entry"]').trigger('click')
    await flushPromises()

    const rows = document.body.querySelectorAll<HTMLButtonElement>('.ov-fav-row')
    expect(rows[0].textContent).toContain('网站 5 · 源 4')
    expect(rows[0].textContent).toContain('9')
    expect(rows[1].textContent).toContain('数据中心 · 表 ID 列表')
    expect(rows[1].textContent).toContain('3')
  })
})