// @vitest-environment jsdom
// 系统目录勾选源后「加入视图目录」（2026-10-13 目录版）：选视图 → 选目录（含根目录）；也能当场新建视图。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import AddToViewDialog from './AddToViewDialog.vue'
import { setSourceViewBackend, sourceViewApi } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import type { UserInfo } from '@/api/auth'
import { ROOT_ID, addDir, addSources, emptyTree } from './viewDirs'

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
const vm = () => wrapper.vm as unknown as { viewId: string; dirId: string; newName: string; submit: () => Promise<void> }

describe('加入视图目录', () => {
  it('加到某个视图的某个目录：已在的去重，报新增个数', async () => {
    const r = addDir(emptyTree(), null, '宏观')
    const v = await sourceViewApi.add('7', { viewName: '广发', tree: addSources(r.tree, r.id, ['1']) })
    await open(['1', '2'])
    expect(vm().viewId).toBe(v.viewId)
    expect(vm().dirId).toBe(ROOT_ID)
    vm().dirId = r.id
    await vm().submit()
    await flushPromises()
    const saved = (await sourceViewApi.list('7'))[0]
    expect(saved.tree.dirs[0].sources).toEqual(['1', '2'])
    expect(wrapper.emitted('added')![0]).toEqual(['广发', '宏观', 1])
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([false])
  })

  it('默认加到根目录', async () => {
    await sourceViewApi.add('7', { viewName: '广发' })
    await open(['5'])
    await vm().submit()
    await flushPromises()
    expect((await sourceViewApi.list('7'))[0].tree.root.sources).toEqual(['5'])
  })

  it('没有视图时新建一个，源放在它的根目录；重名报错留在弹窗里', async () => {
    await open(['5', '5', '6'])
    expect(vm().viewId).toBe('__new__')
    vm().newName = '广发 · 重点源'
    await vm().submit()
    await flushPromises()
    const created = (await sourceViewApi.list('7'))[0]
    expect(created.viewName).toBe('广发 · 重点源')
    expect(created.tree.root.sources).toEqual(['5', '6'])

    wrapper.unmount()
    await open(['7'])
    vm().viewId = '__new__'
    vm().newName = '广发 · 重点源'
    await vm().submit()
    await flushPromises()
    expect((document.querySelector('[data-testid="add-to-view-error"]') as HTMLElement).textContent).toContain('视图名称已存在')
  })
})
