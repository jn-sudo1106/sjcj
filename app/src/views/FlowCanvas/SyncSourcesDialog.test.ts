// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'
import SyncSourcesDialog from './SyncSourcesDialog.vue'
import type { Source } from '../../api'

const siteSources = vi.fn()
const siteSyncFlow = vi.fn()

vi.mock('../../api', () => ({
  siteApi: {
    siteSources: (...args: unknown[]) => siteSources(...args),
    siteSyncFlow: (...args: unknown[]) => siteSyncFlow(...args),
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const dialogStub = {
  props: ['modelValue'],
  template: '<div><slot /><slot name="footer" /></div>',
}

const fromSource = { sourceId: 'src-a', name: '来源子源', siteId: 'site-1' } as Source

function mountDialog() {
  return mount(SyncSourcesDialog, {
    props: { open: true, siteId: 'site-1', fromSource },
    global: { stubs: { 'el-dialog': dialogStub } },
  })
}

describe('SyncSourcesDialog（0716 子源间流程同步）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    siteSources.mockReset()
    siteSyncFlow.mockReset()
    siteSources.mockResolvedValue([
      { sourceId: 'src-a', name: '来源子源', siteId: 'site-1' },
      { sourceId: 'src-b', name: '普通子源', siteId: 'site-1' },
      { sourceId: 'src-c', name: '已调整子源', siteId: 'site-1', detached: true },
    ] as Source[])
    siteSyncFlow.mockResolvedValue({ ok: true, message: '已同步到 1 个子源（本地演示）' })
  })

  it('列表排除来源自身；detached 子源带警示且默认不勾选', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="sync-row"]')
    expect(rows.length).toBe(2)
    expect(rows.some((r) => r.text().includes('来源子源'))).toBe(false)

    const normal = rows.find((r) => r.text().includes('普通子源'))!
    const detached = rows.find((r) => r.text().includes('已调整子源'))!
    expect((normal.find('input').element as HTMLInputElement).checked).toBe(true)
    expect((detached.find('input').element as HTMLInputElement).checked).toBe(false)
    expect(detached.text()).toContain('已单独调整')
  })

  it('确认按钮显示覆盖数量，按勾选调用 siteSyncFlow(siteId, fromSourceId, sourceIds)', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const confirm = wrapper.find('[data-testid="sync-confirm"]')
    expect(confirm.text()).toContain('覆盖 1 个子源的流程')

    await confirm.trigger('click')
    await flushPromises()

    expect(siteSyncFlow).toHaveBeenCalledWith('site-1', 'src-a', ['src-b'])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('清空勾选后确认按钮禁用；全选把 detached 子源也纳入', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const toggleAll = wrapper.find('[data-testid="sync-toggle-all"]')
    // 初始只勾了非 detached 的 1 个 → 第一次全选补齐到 2 个
    await toggleAll.trigger('change')
    expect(wrapper.find('[data-testid="sync-confirm"]').text()).toContain('覆盖 2 个子源的流程')

    await toggleAll.trigger('change')
    expect(wrapper.find('[data-testid="sync-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('来源变更时重新加载，并忽略先前请求的过期响应', async () => {
    let resolveFirst!: (sources: Source[]) => void
    siteSources
      .mockReturnValueOnce(new Promise<Source[]>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce([
        { sourceId: 'src-x', name: '新来源子源', siteId: 'site-2' },
        { sourceId: 'src-y', name: '新目标子源', siteId: 'site-2' },
      ] as Source[])

    const wrapper = mountDialog()
    expect(siteSources).toHaveBeenCalledWith('site-1')

    await wrapper.setProps({
      siteId: 'site-2',
      fromSource: { sourceId: 'src-x', name: '新来源子源', siteId: 'site-2' } as Source,
    })
    await flushPromises()
    expect(siteSources).toHaveBeenCalledWith('site-2')

    resolveFirst([
      { sourceId: 'src-a', name: '旧来源子源', siteId: 'site-1' },
      { sourceId: 'src-b', name: '旧目标子源', siteId: 'site-1' },
    ] as Source[])
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="sync-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('新目标子源')
  })

  it('加载子源列表失败时清空旧状态并给出错误提示', async () => {
    siteSources.mockRejectedValueOnce(new Error('列表请求失败'))

    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="sync-row"]')).toHaveLength(0)
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('加载子源列表失败'))
  })

  it('同步请求抛错时保持弹窗打开并给出错误提示', async () => {
    siteSyncFlow.mockRejectedValueOnce(new Error('同步请求失败'))
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-testid="sync-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('同步失败'))
    expect(wrapper.find('[data-testid="sync-confirm"]').attributes('disabled')).toBeUndefined()
  })
})
