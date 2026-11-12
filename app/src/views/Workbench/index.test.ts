// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import Workbench from './index.vue'
import { useAuthStore } from '@/stores/auth'
import { personalWorkbenchApi } from '@/api/personalWorkbench'
vi.mock('@/api/personalWorkbench', () => ({ WORKBENCH_TRUNCATED_NOTE: '数据量较大，仅展示最近一部分；完整列表请到对应页面查看', personalWorkbenchApi: { collections: vi.fn(), recents: vi.fn(), resources: vi.fn(), alarms: vi.fn(), removeFavorite: vi.fn() } }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }))
const item = { id: '1', kind: 'SITE' as const, name: '测试网站', subtitle: 'example.com', at: '2026-11-11 10:00:00' }
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
  const unavailable = Object.assign(new Error('个人归属接口待提供'), { name: 'WorkbenchUnavailableError' })
  vi.mocked(personalWorkbenchApi.resources).mockRejectedValue(unavailable)
  vi.mocked(personalWorkbenchApi.alarms).mockRejectedValue(unavailable)
  vi.mocked(personalWorkbenchApi.removeFavorite).mockResolvedValue(undefined)
})
describe('PersonalWorkbench', () => {
  it('matches new module order and real user; unavailable is not zero or demo data', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('h1').text()).toContain('真实用户')
    expect(wrapper.findAll('h3').map(x => x.text())).toEqual(['我的相关告警', '我的收藏', '最近访问'])
    expect(wrapper.findAll('.num').map(x => x.text())).toEqual(['1', '1', '—'])
    expect(wrapper.text()).not.toContain('我负责的')
    expect(personalWorkbenchApi.resources).not.toHaveBeenCalled()
    expect(wrapper.get('a[href="/overview"]').text()).toContain('返回资产总览')
    expect(wrapper.text()).toContain('接口未就绪')
    expect(wrapper.text()).not.toContain('沪深行情快照')
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
