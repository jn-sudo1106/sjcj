// @vitest-environment jsdom
// 系统目录勾选源后「加入视图目录」（2026-10-13 目录版；10-14 没有根目录）：选视图 → 选目录或当场新建一级目录；也能当场新建视图（连同目录）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import AddToViewDialog from './AddToViewDialog.vue'
import { setSourceViewBackend, sourceViewApi } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import type { UserInfo } from '@/api/auth'
import { addDir, addSources, emptyTree } from './viewDirs'

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
const vm = () => wrapper.vm as unknown as { viewId: string; dirId: string; newName: string; newDirName: string; submit: () => Promise<void> }

describe('加入视图目录', () => {
  it('加到某个视图的某个目录：已在的去重，报新增个数', async () => {
    const r = addDir(emptyTree(), null, '宏观')
    const v = await sourceViewApi.add('7', { viewName: '广发', tree: addSources(r.tree, r.id, ['1']) })
    await open(['1', '2'])
    expect(vm().viewId).toBe(v.viewId)
    expect(vm().dirId).toBe(r.id) // 默认选第一个目录
    await vm().submit()
    await flushPromises()
    const saved = (await sourceViewApi.list('7'))[0]
    expect(saved.tree.dirs[0].sources).toEqual(['1', '2'])
    expect(wrapper.emitted('added')![0]).toEqual(['广发', '宏观', 1])
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([false])
  })

  it('视图还没有目录：当场新建一级目录再加进去；目录名为空时报错', async () => {
    await sourceViewApi.add('7', { viewName: '广发' })
    await open(['5'])
    expect(vm().dirId).toBe('__new__')
    await vm().submit()
    await flushPromises()
    expect((document.querySelector('[data-testid="add-to-view-error"]') as HTMLElement).textContent).toContain('目录名称为1到40个字符')
    vm().newDirName = '宏观'
    await vm().submit()
    await flushPromises()
    const dirs = (await sourceViewApi.list('7'))[0].tree.dirs
    expect(dirs.map((d) => [d.name, d.parentId, d.sources])).toEqual([['宏观', null, ['5']]])
    expect(wrapper.emitted('added')![0]).toEqual(['广发', '宏观', 1])
  })

  it('没有视图时新建一个（连同一个目录）；重名报错留在弹窗里', async () => {
    await open(['5', '5', '6'])
    expect(vm().viewId).toBe('__new__')
    vm().newName = '广发 · 重点源'
    vm().newDirName = '重点'
    await vm().submit()
    await flushPromises()
    const created = (await sourceViewApi.list('7'))[0]
    expect(created.viewName).toBe('广发 · 重点源')
    expect(created.tree.dirs.map((d) => [d.name, d.sources])).toEqual([['重点', ['5', '6']]])

    wrapper.unmount()
    await open(['7'])
    vm().viewId = '__new__'
    vm().newName = '广发 · 重点源'
    vm().newDirName = '重点'
    await vm().submit()
    await flushPromises()
    expect((document.querySelector('[data-testid="add-to-view-error"]') as HTMLElement).textContent).toContain('视图名称已存在')
  })
})
