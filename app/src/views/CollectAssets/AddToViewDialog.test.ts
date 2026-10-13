// @vitest-environment jsdom
// 源列表勾选源后「加入视图」（2026-10-12）：只列手选视图；加入已有视图自动去重；新建视图并加入。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import AddToViewDialog from './AddToViewDialog.vue'
import { setSourceViewBackend, sourceViewApi } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import type { UserInfo } from '@/api/auth'
import { blankSourceListViewState, emptyManualViewState } from '@/views/FlowCanvas/result/sourceListViewState'

let wrapper: VueWrapper
beforeEach(() => {
  setSourceViewBackend('local') // 单测不连后端：用本机实现
  localStorage.clear()
  setActivePinia(createPinia())
  useAuthStore().info = { id: 7 } as UserInfo
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })

async function open(sourceIds: string[]) {
  wrapper = mount(AddToViewDialog, { props: { modelValue: false, sourceIds }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  await new Promise((r) => setTimeout(r, 30))
}
const dom = (sel: string) => document.querySelector(sel) as HTMLElement

describe('加入视图', () => {
  it('把选中的源并进手选视图并去重；条件视图不在候选里', async () => {
    await sourceViewApi.add('7', { viewName: '条件视图', state: { ...blankSourceListViewState(), status: 'E' } })
    await sourceViewApi.add('7', { viewName: '广发重点', state: { ...emptyManualViewState(), scopeIds: ['1', '2'] } })
    await open(['2', '3'])
    dom('[data-testid="add-to-view-submit"]').click()
    await flushPromises()
    const list = await sourceViewApi.list('7')
    expect(list.find((v) => v.viewName === '广发重点')!.state.scopeIds).toEqual(['1', '2', '3'])
    expect(list.find((v) => v.viewName === '条件视图')!.state.scopeIds).toBeNull()
    expect(wrapper.emitted('added')![0]).toEqual(['广发重点', 1])
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([false])
  })

  it('没有手选视图时只能新建：新视图里就是选中的源', async () => {
    await open(['5', '5', '6'])
    ;(dom('input[data-testid="add-to-view-name"]') as HTMLInputElement).value = '广发 · 重点源'
    dom('input[data-testid="add-to-view-name"]').dispatchEvent(new Event('input'))
    dom('[data-testid="add-to-view-submit"]').click()
    await flushPromises()
    const created = (await sourceViewApi.list('7'))[0]
    expect(created.viewName).toBe('广发 · 重点源')
    expect(created.state.scopeIds).toEqual(['5', '6'])
  })

  it('新建视图重名时报错留在弹窗里', async () => {
    await sourceViewApi.add('7', { viewName: 'A', state: { ...blankSourceListViewState(), status: 'E' } })
    await open(['5'])
    ;(dom('input[data-testid="add-to-view-name"]') as HTMLInputElement).value = 'A'
    dom('input[data-testid="add-to-view-name"]').dispatchEvent(new Event('input'))
    dom('[data-testid="add-to-view-submit"]').click()
    await flushPromises()
    expect(dom('[data-testid="add-to-view-error"]').textContent).toContain('视图名称已存在')
    expect(wrapper.emitted('added')).toBeUndefined()
  })
})
