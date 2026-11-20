// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import Workbench from './index.vue'
import { useAuthStore } from '@/stores/auth'
import { personalWorkbenchApi } from '@/api/personalWorkbench'
import type { WorkbenchAlarm } from '@/api/personalWorkbench'
vi.mock('@/api/personalWorkbench', () => ({
  WORKBENCH_TRUNCATED_NOTE: '数据量较大，仅展示最近一部分；完整列表请到对应页面查看',
  personalWorkbenchApi: { collections: vi.fn(), recents: vi.fn(), resources: vi.fn(), alarms: vi.fn(), removeFavorite: vi.fn() },
  // 视图只把 404 转成的 WorkbenchUnavailableError 判成「接口未就绪」
  isWorkbenchUnavailableError: (error: unknown) => (error as { name?: string } | null)?.name === 'WorkbenchUnavailableError',
}))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }))
const item = { id: '1', kind: 'SITE' as const, name: '测试网站', subtitle: 'example.com', at: '2026-11-11 10:00:00' }
const alarm = (id: string, level: WorkbenchAlarm['level'] = 'fail'): WorkbenchAlarm => ({
  id, sourceId: `10${id}`, name: `源${id}`, description: '采集失败', level, at: '2026-11-20 09:00:00', resolved: level === 'recover',
})
const alarmPage = (list: WorkbenchAlarm[], total: number) => ({ list, total })
async function setup() {
  const pinia = createPinia(); setActivePinia(pinia)
  const auth = useAuthStore(); auth.name = '真实用户'
  const router = createRouter({ history: createMemoryHistory(), routes: ['/workbench', '/canvas', '/data', '/collect', '/monitor'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push('/workbench')
  const wrapper = mount(Workbench, { global: { plugins: [pinia, router], stubs: { 'el-drawer': { props: ['modelValue'], template: '<aside v-if="modelValue"><slot /></aside>' } } } })
  await flushPromises()
  return { wrapper, router, auth }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(personalWorkbenchApi.collections).mockResolvedValue({ list: [item], total: 1 })
  vi.mocked(personalWorkbenchApi.recents).mockResolvedValue({ list: [item], total: 1 })
  vi.mocked(personalWorkbenchApi.resources).mockResolvedValue({ list: [], total: 0 })
  // scope=open 3 条未恢复，scope=all 7 条（含已恢复）——计数必须来自服务端 count，不能数当前页
  vi.mocked(personalWorkbenchApi.alarms).mockImplementation((scope: 'open' | 'all' = 'open') =>
    Promise.resolve(scope === 'open' ? alarmPage([alarm('1'), alarm('2'), alarm('3')], 3) : alarmPage([alarm('1'), alarm('2'), alarm('3'), alarm('4', 'recover')], 7)))
  vi.mocked(personalWorkbenchApi.removeFavorite).mockResolvedValue(undefined)
})
describe('PersonalWorkbench', () => {
  it('matches new module order and real user; counts come from server totals', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('h1').text()).toContain('真实用户')
    expect(wrapper.findAll('h3').map(x => x.text())).toEqual(['我的相关告警', '我的收藏', '最近访问'])
    expect(wrapper.findAll('.num').map(x => x.text())).toEqual(['1', '1', '3'])
    expect(wrapper.text()).not.toContain('我负责的')
    expect(personalWorkbenchApi.resources).not.toHaveBeenCalled()
    expect(wrapper.get('a[href="/overview"]').text()).toContain('返回资产总览')
    expect(wrapper.text()).not.toContain('沪深行情快照')
    wrapper.unmount()
  })
  it('alert tabs read count per scope and refetch the list on switch', async () => {
    const { wrapper } = await setup()
    const tabs = wrapper.findAll('.seg button')
    expect(tabs.map(x => x.text())).toEqual(['未恢复 (3)', '全部 (7)'])
    expect(tabs[0].attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.alert-row')).toHaveLength(3)
    await tabs[1].trigger('click'); await flushPromises()
    expect(personalWorkbenchApi.alarms).toHaveBeenCalledWith('all', 20)
    expect(wrapper.findAll('.alert-row')).toHaveLength(4)
    expect(wrapper.findAll('.seg button')[1].attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })
  it('alert jump keeps the monitor tab and the source filter', async () => {
    const { wrapper, router } = await setup()
    await wrapper.get('.alert-name').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/monitor')
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'sourceCheck', sourceId: '101' })
    wrapper.unmount()
  })
  it('shows a cap note when server has more alarms than the card shows, and pages in the drawer', async () => {
    vi.mocked(personalWorkbenchApi.alarms).mockImplementation((scope: 'open' | 'all' = 'open', limit = 20, page = 1) => {
      if (page === 2) return Promise.resolve(alarmPage([alarm('9')], 25))
      if (scope === 'all') return Promise.resolve(alarmPage([], 5))
      return Promise.resolve(alarmPage(limit === 1 ? [alarm('1')] : [alarm('1'), alarm('2'), alarm('3')], 25))
    })
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('仅展示最近 3 条，共 25 条')
    await wrapper.get('.alert-footer .open').trigger('click'); await flushPromises()
    expect(wrapper.findAll('aside .alert-row')).toHaveLength(3)
    const more = wrapper.findAll('.drawer-more button')[0]
    await more.trigger('click'); await flushPromises()
    expect(personalWorkbenchApi.alarms).toHaveBeenCalledWith('open', 20, 2)
    expect(wrapper.findAll('aside .alert-row')).toHaveLength(4)
    wrapper.unmount()
  })
  it('keeps the not-ready state for old backends instead of showing an empty list', async () => {
    vi.mocked(personalWorkbenchApi.alarms).mockRejectedValue(Object.assign(new Error('我的相关告警接口未就绪（后端未部署该端点）'), { name: 'WorkbenchUnavailableError' }))
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('接口未就绪')
    expect(wrapper.findAll('.num')[2].text()).toBe('—')
    wrapper.unmount()
  })
  it('toggles common content and favorite shortcut restores it', async () => {
    const { wrapper } = await setup()
    await wrapper.get('[aria-controls="wb-secondary"]').trigger('click')
    expect(wrapper.get('#wb-secondary').isVisible()).toBe(false)
    await wrapper.get('.btn-fav').trigger('click')
    expect((wrapper.get('#wb-secondary').element as HTMLElement).style.display).not.toBe('none')
    expect(wrapper.get('[aria-controls="wb-secondary"]').attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })
  it('successful remove updates row and KPI, failed remove preserves row', async () => {
    const { wrapper } = await setup()
    vi.mocked(personalWorkbenchApi.removeFavorite).mockRejectedValueOnce(new Error('网络失败'))
    await wrapper.get('.star').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.fav-row')).toHaveLength(1)
    expect(ElMessage.error).toHaveBeenCalledWith('网络失败')
    await wrapper.get('.star').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.fav-row')).toHaveLength(0)
    expect(wrapper.findAll('.num')[0].text()).toBe('0')
    wrapper.unmount()
  })
  it('read failure shows error not empty and supports module retry', async () => {
    vi.mocked(personalWorkbenchApi.collections).mockRejectedValueOnce(new Error('收藏读取失败'))
    const { wrapper } = await setup()
    expect(wrapper.findAll('.num')[0].text()).toBe('—')
    expect(wrapper.text()).toContain('收藏读取失败')
    const retry = wrapper.findAll('button').find(x => x.text() === '重新加载')!
    await retry.trigger('click'); await flushPromises()
    expect(wrapper.findAll('.fav-row')).toHaveLength(1)
    expect(personalWorkbenchApi.recents).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('resource navigation uses actual IDs and return context', async () => {
    const { wrapper, router } = await setup()
    await wrapper.get('.fav-left').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query).toMatchObject({ siteId: '1', returnTo: '/workbench', view: 'source' })
    wrapper.unmount()
  })
  it('does not expose a capped result as a complete total', async () => {
    vi.mocked(personalWorkbenchApi.collections).mockResolvedValueOnce({ list: [item], truncated: true })
    const { wrapper } = await setup()
    expect(wrapper.findAll('.num')[0].text()).toBe('—')
    expect(wrapper.text()).toContain('数据量较大，仅展示最近一部分')
    wrapper.unmount()
  })
  it('ignores previous account responses after account switch', async () => {
    let finish!: (value: { list: typeof item[]; total: number }) => void
    vi.mocked(personalWorkbenchApi.collections).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { wrapper, auth } = await setup()
    auth.sessionKey = 'next-account-session'
    await flushPromises()
    finish({ list: [{ ...item, name: '旧账号私有名称' }], total: 100 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧账号私有名称')
    expect(wrapper.findAll('.num')[0].text()).toBe('1')
    wrapper.unmount()
  })
  it('table navigation uses supported entryTypeId filter', async () => {
    vi.mocked(personalWorkbenchApi.recents).mockResolvedValueOnce({ list: [{ ...item, kind: 'ENTRY_TYPE' }], total: 1 })
    const { wrapper, router } = await setup()
    await wrapper.get('.visit-row').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'entry', entryTypeId: '1' })
    wrapper.unmount()
  })
  it('does not apply late response after unmount', async () => {
    let finish!: (value: { list: typeof item[]; total: number }) => void
    vi.mocked(personalWorkbenchApi.collections).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { wrapper } = await setup(); wrapper.unmount()
    finish({ list: [item], total: 100 }); await flushPromises()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})