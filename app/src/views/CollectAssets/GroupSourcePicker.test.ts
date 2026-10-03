// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import GroupSourcePicker from './GroupSourcePicker.vue'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import { useAuthStore } from '@/stores/auth'
import { sourceApi, type Source } from '@/api'
import type { UserInfo } from '@/api/auth'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAuthStore().info = { id: 1 } as UserInfo
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
it('跨页选择保留，刷新沿用当前页和筛选，保存只改分组关系', async () => {
  const groups = useSourceGroupsStore()
  const id = groups.saveGroup('宏观组')
  const pageApi = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async query => ({
    total: 40,
    list: [{ sourceId: query?.page === 2 ? '20' : '10', name: '测试源' } as Source],
  }))
  const wrapper = mount(GroupSourcePicker, { props: { modelValue: false, groupId: id }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await wrapper.setProps({ modelValue: true }); await flushPromises()
  const check = () => document.querySelector('tbody input[type=checkbox]') as HTMLInputElement
  check().click(); await flushPromises()
  const pagination = wrapper.findComponent({ name: 'ElPagination' })
  pagination.vm.$emit('update:current-page', 2)
  pagination.vm.$emit('current-change', 2)
  await flushPromises()
  check().click(); await flushPromises()
  expect(document.body.textContent).toContain('已选 2 个源')
  const refresh = document.querySelector('button[aria-label="刷新源列表"]') as HTMLButtonElement
  refresh.click(); await flushPromises()
  expect(pageApi).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, size: 20 }))
  const save = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '加入分组')!
  save.click(); await flushPromises()
  expect(groups.groups[0]?.sourceIds).toEqual(['10', '20'])
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  wrapper.unmount()
})
