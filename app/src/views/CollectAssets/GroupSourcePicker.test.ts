// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import GroupSourcePicker from './GroupSourcePicker.vue'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import { useAuthStore } from '@/stores/auth'
import { sourceApi, sourceGroupApi, workflowBindingApi, type Source } from '@/api'
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

it('backend 模式：保存调 changeMembers 加入来源组，选中的源分属不同组时分批提交', async () => {
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async () => ({
    total: 3,
    list: [
      { sourceId: '10', name: '独立源', sourceGroupId: undefined } as Source,
      { sourceId: '20', name: '组3源', sourceGroupId: '3' } as Source,
      { sourceId: '30', name: '组1源', sourceGroupId: '1' } as Source,
    ],
  }))
  const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
  // 1021-03：入组前查自有流程；独立源 10 没有自有流程 → 不出入组确认；组内源 20 / 30 不查
  const view = vi.spyOn(workflowBindingApi, 'view').mockImplementation(async (id) => ({ sourceId: id, flowIds: [], bindings: [], ownFlowIds: [], ownBindings: [] }))
  const wrapper = mount(GroupSourcePicker, { props: { modelValue: false, groupId: '9', backendMode: true }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await wrapper.setProps({ modelValue: true }); await flushPromises()
  // 勾选全部 3 个源
  document.querySelectorAll('tbody input[type=checkbox]').forEach((c) => (c as HTMLInputElement).click())
  await flushPromises()
  expect(document.body.textContent).toContain('已选 3 个源')
  const save = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '加入分组')!
  save.click(); await flushPromises()
  expect(view).toHaveBeenCalledTimes(1)
  expect(view).toHaveBeenCalledWith('10')
  // 按 expected 分批：null（独立）、3、1
  expect(changeMembers).toHaveBeenCalledTimes(3)
  expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['10'], sourceGroupId: '9', expectedSourceGroupId: null })
  expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['20'], sourceGroupId: '9', expectedSourceGroupId: '3' })
  expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['30'], sourceGroupId: '9', expectedSourceGroupId: '1' })
  // 成功后发 saved 事件并关闭
  expect(wrapper.emitted('saved')).toBeTruthy()
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  wrapper.unmount()
})

it('backend 模式：跨页勾选的源也一起加入（1021-03 顺带修：原来只交当前页的勾选）', async () => {
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (query) => ({
    total: 4,
    list: query?.page === 2 ? [{ sourceId: '30', name: '丙' } as Source] : [{ sourceId: '10', name: '甲' } as Source],
  }))
  vi.spyOn(workflowBindingApi, 'view').mockImplementation(async (id) => ({ sourceId: id, flowIds: [], bindings: [], ownFlowIds: [], ownBindings: [] }))
  const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
  const wrapper = mount(GroupSourcePicker, { props: { modelValue: false, groupId: '9', backendMode: true }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await wrapper.setProps({ modelValue: true }); await flushPromises()
  ;(document.querySelector('tbody input[type=checkbox]') as HTMLInputElement).click()
  await flushPromises()
  // 翻到第 2 页再勾一个
  const vm = wrapper.vm as unknown as { page: number; load: () => Promise<void> }
  vm.page = 2; await vm.load(); await flushPromises()
  ;(document.querySelector('tbody input[type=checkbox]') as HTMLInputElement).click()
  await flushPromises()
  ;(document.querySelector('[data-testid="picker-save"]') as HTMLButtonElement).click()
  await flushPromises()
  expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['10', '30'], sourceGroupId: '9', expectedSourceGroupId: null })
  wrapper.unmount()
})

// 2026-10-12：表头「全选本页」——只动当前页，其它页已选的保留；部分选中显示半选
it('表头「全选本页」：全选 / 取消只影响当前页，跨页已选保留，部分选中是半选', async () => {
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (query) => ({
    total: 6,
    list: query?.page === 2
      ? [{ sourceId: '30', name: '丙' } as Source, { sourceId: '40', name: '丁' } as Source]
      : [{ sourceId: '10', name: '甲' } as Source, { sourceId: '20', name: '乙' } as Source],
  }))
  const wrapper = mount(GroupSourcePicker, { props: { modelValue: false, groupId: 'x', pickMode: true }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await wrapper.setProps({ modelValue: true }); await flushPromises()
  const head = () => document.querySelector('[data-testid="picker-select-page"]') as HTMLElement
  const headInput = () => head().querySelector('input') as HTMLInputElement
  // 先勾一个：表头半选
  ;(document.querySelector('tbody input[type=checkbox]') as HTMLInputElement).click(); await flushPromises()
  expect(head().querySelector('.el-checkbox__input')!.classList.contains('is-indeterminate')).toBe(true)
  // 点表头：当前页全选
  headInput().click(); await flushPromises()
  expect(document.body.textContent).toContain('已选 2 个源')
  expect(head().classList.contains('is-checked')).toBe(true)
  // 翻到第 2 页，全选本页：累计 4 个
  const pagination = wrapper.findComponent({ name: 'ElPagination' })
  pagination.vm.$emit('update:current-page', 2)
  pagination.vm.$emit('current-change', 2)
  await flushPromises()
  expect(head().classList.contains('is-checked')).toBe(false)
  headInput().click(); await flushPromises()
  expect(document.body.textContent).toContain('已选 4 个源')
  // 再点一次取消本页：只剩第 1 页的 2 个
  headInput().click(); await flushPromises()
  expect(document.body.textContent).toContain('已选 2 个源')
  // 提交的是跨页累计的 ID
  const done = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '加入分组')
  expect(done).toBeTruthy()
  wrapper.unmount()
})

// 1016：视图绑定来源组是快照，组里之后新加的源要提示「未在这里」，可只看这些、一键全选后加入
it('已绑定的来源组：提示未在这里的源，只看这些按源 ID 查，一键全选后 pick 出去', async () => {
  vi.spyOn(sourceGroupApi, 'list').mockResolvedValue([{ sourceGroupId: '3', sourceGroupName: 'twitter1', state: 'ACTIVE' }] as never)
  const pageApi = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (query) => ({
    total: query?.sourceIds ? 2 : 5,
    list: [{ sourceId: '503', name: '新源A' }, { sourceId: '501', name: '老源' }] as Source[],
  }))
  const wrapper = mount(GroupSourcePicker, {
    props: {
      modelValue: false, groupId: '', pickMode: true, groupFilter: true, boundGroups: ['3'],
      missingByGroup: { 3: ['503', '504'] }, initialGroupId: '3', initialMissingOnly: true,
    },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  await wrapper.setProps({ modelValue: true }); await flushPromises()
  expect(pageApi).toHaveBeenLastCalledWith(expect.objectContaining({ sourceGroupId: '3', sourceIds: '503,504' }))
  expect(document.querySelector('[data-testid="picker-missing-hint"]')?.textContent).toContain('2 个源还没在这里')
  // 行上只给未在这里的标记
  expect(document.querySelectorAll('[data-testid="picker-missing-tag"]')).toHaveLength(1)

  ;(document.querySelector('[data-testid="picker-missing-only"]') as HTMLButtonElement).click(); await flushPromises()
  expect(pageApi.mock.lastCall?.[0]).not.toHaveProperty('sourceIds')

  ;(document.querySelector('[data-testid="picker-select-missing"]') as HTMLButtonElement).click(); await flushPromises()
  expect(document.body.textContent).toContain('已选 2 个源')
  const confirm = [...document.querySelectorAll('.picker-footer button')].at(-1) as HTMLButtonElement
  confirm.click(); await flushPromises()
  expect(wrapper.emitted('pick')?.[0]).toEqual([['503', '504']])
})
