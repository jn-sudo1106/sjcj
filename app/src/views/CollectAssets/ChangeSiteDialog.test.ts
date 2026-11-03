// 批量修改所属网站弹窗（2026-11-03）：源管理「归类」下拉里的一项。
// 一个源只属于一个网站，所以这是搬移；「不绑定网站」走 changeSite(ids, '0')，与侧栏右键同口径。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import ChangeSiteDialog from './ChangeSiteDialog.vue'
import { siteApi, sourceApi } from '@/api'

enableAutoUnmount(afterEach)

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
})

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.mocked(ElMessage.success).mockClear()
  vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({
    total: 2,
    list: [{ siteId: '77', name: '目标站' }, { siteId: '88', name: '另一个站' }] as never,
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountDialog(sourceIds = ['1', '2']) {
  const wrapper = mount(ChangeSiteDialog, { props: { sourceIds }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

/** 目标网站下拉：直接改 v-model，绕开 popper 里点选 */
async function pick(wrapper: VueWrapper, siteId: string) {
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', siteId)
  await flushPromises()
}

const submitBtn = () => document.querySelector('[data-testid="change-site-submit"]') as HTMLButtonElement

describe('批量修改所属网站弹窗', () => {
  it('加载网站候选；选目标后提交带全部源 ID，成功提示并回调刷新', async () => {
    const change = vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: true, message: '' })
    const wrapper = await mountDialog()
    expect(siteApi.sitePaged).toHaveBeenCalled()
    // el-dialog 内容 teleport 到 body，断言走 document
    expect(document.body.textContent).toContain('修改 2 个源的所属网站')
    // 没选目标不能提交
    expect(submitBtn().disabled).toBe(true)
    await pick(wrapper, '77')
    expect(submitBtn().disabled).toBe(false)
    submitBtn().click()
    await flushPromises()
    expect(change).toHaveBeenCalledWith(['1', '2'], '77', expect.any(Function))
    expect(ElMessage.success).toHaveBeenCalledWith('已将 2 个源改到「目标站」')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('「不绑定网站」按 0 提交，提示解除后只能按源 ID 找回', async () => {
    const change = vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: true, message: '' })
    const wrapper = await mountDialog(['1'])
    await pick(wrapper, '0')
    expect(document.querySelector('[data-testid="change-site-hint"]')?.textContent).toContain('不属于任何网站')
    submitBtn().click()
    await flushPromises()
    expect(change).toHaveBeenCalledWith(['1'], '0', expect.any(Function))
    expect(ElMessage.success).toHaveBeenCalledWith('已将 1 个源解除网站关联')
  })

  it('后端返回失败时显示原因、刷新列表但不清空当前选择，可重试', async () => {
    const change = vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: false, message: '共 3 个源：成功 1 个、失败 2 个，请对失败部分重试' })
    const wrapper = await mountDialog(['1', '2'])
    await pick(wrapper, '77')
    submitBtn().click()
    await flushPromises()
    expect(change).toHaveBeenCalled()
    expect(document.querySelector('[data-testid="change-site-error"]')?.textContent).toContain('失败 2 个')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})
