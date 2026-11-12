// STRUCT 条件行编辑器：加行默认值、删行、换字段重置 op/values、换 op 收敛单值、值控件经 CondValueInput 分发。
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// CondValueInput 会拉起 @/api 聚合桶（端点表很大），单测里部分 mock；本组件只测行编辑逻辑
vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sourceApi: {}, siteApi: {}, configApi: {}, entryApi: {} }
})
vi.mock('@/api/sourceDirs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, searchDirs: vi.fn(async () => []) }
})
vi.mock('@/api/sysUser', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, pagedSysUser: vi.fn(async () => ({ total: 0, list: [] })) }
})

import StructCondEditor from './StructCondEditor.vue'
import type { GroupResCondItem, GroupResField } from '@/api/groupRes'

/** 字符串选择器返回 WrapperLike，收敛成 VueWrapper 才能取 vm/props */
function sel(wrapper: VueWrapper, testid: string): VueWrapper {
  return wrapper.findComponent(`[data-testid="${testid}"]`) as VueWrapper
}

const FIELDS: GroupResField[] = [
  { field: 'SOURCE_ID', name: '数据源ID', type: 'num', ops: ['IN', '=', '>'], valueFrom: 'sourcePicker' },
  { field: 'USED_FLAG', name: '是否启用', type: 'num', ops: ['='], valueFrom: 'bool' },
  { field: 'CREATE_DT', name: '创建时间', type: 'date', ops: ['>', '<'], valueFrom: 'date' },
  { field: 'TAGS', name: '标签', type: 'str', ops: ['LIKE'], valueFrom: 'text' },
]

function mountEditor(modelValue: GroupResCondItem[] = []) {
  return mount(StructCondEditor, {
    props: { modelValue, fields: FIELDS },
    global: { plugins: [ElementPlus] },
  })
}

describe('StructCondEditor', () => {
  it('初始为空时显示引导文案，没有条件行', () => {
    const wrapper = mountEditor()
    expect(wrapper.find('[data-testid="struct-cond-editor"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('还没有条件')
    expect(wrapper.findAll('[data-testid^="struct-cond-row-"]')).toHaveLength(0)
  })

  it('加行：默认取白名单第一个字段和它的第一个操作符，值为空', async () => {
    const wrapper = mountEditor()
    await wrapper.get('[data-testid="struct-cond-add"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([{ field: 'SOURCE_ID', op: 'IN', values: [] }])
  })

  it('删行：按序号移除', async () => {
    const wrapper = mountEditor([
      { field: 'SOURCE_ID', op: 'IN', values: ['1'] },
      { field: 'TAGS', op: 'LIKE', values: ['a'] },
    ])
    await wrapper.get('[data-testid="struct-row-del-0"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([{ field: 'TAGS', op: 'LIKE', values: ['a'] }])
  })

  it('换字段：op 重置为新字段第一个操作符、values 清空（防跨字段脏值）', async () => {
    const wrapper = mountEditor([{ field: 'SOURCE_ID', op: '>', values: ['100'] }])
    sel(wrapper, 'struct-field-0').vm.$emit('update:modelValue', 'TAGS')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([{ field: 'TAGS', op: 'LIKE', values: [] }])
  })

  it('换 op 成非 IN：values 收敛到最多 1 个', async () => {
    const wrapper = mountEditor([{ field: 'SOURCE_ID', op: 'IN', values: ['1', '2', '3'] }])
    sel(wrapper, 'struct-op-0').vm.$emit('update:modelValue', '>')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([{ field: 'SOURCE_ID', op: '>', values: ['1'] }])
  })

  it('值控件经 CondValueInput 按 valueFrom / type 分发：picker 走远程选择，bool/date/number/text 走原生控件', () => {
    // num + sourcePicker → picker 分支（远程选择），不是数字框
    const pickerRow = mountEditor([{ field: 'SOURCE_ID', op: '=', values: [] }])
    expect(pickerRow.findComponent('[data-testid="struct-values-0"]').exists()).toBe(true)

    const boolRow = mountEditor([{ field: 'USED_FLAG', op: '=', values: [] }])
    expect(boolRow.findComponent('[data-testid="struct-values-0"]').exists()).toBe(true)

    const dateRow = mountEditor([{ field: 'CREATE_DT', op: '>', values: [] }])
    expect(dateRow.findComponent({ name: 'ElDatePicker' }).exists()).toBe(true)

    const strRow = mountEditor([{ field: 'TAGS', op: 'LIKE', values: [] }])
    expect(strRow.findComponent({ name: 'ElInput' }).exists()).toBe(true)

    const inRow = mountEditor([{ field: 'SOURCE_ID', op: 'IN', values: ['1'] }])
    const multi = sel(inRow, 'struct-values-0')
    expect(multi.findComponent({ name: 'ElSelect' }).props('multiple')).toBe(true)
  })

  it('IN 多值变更原样上抛字符串数组', async () => {
    const wrapper = mountEditor([{ field: 'SOURCE_ID', op: 'IN', values: ['1'] }])
    sel(wrapper, 'struct-values-0').vm.$emit('update:modelValue', ['1', '2'])
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([{ field: 'SOURCE_ID', op: 'IN', values: ['1', '2'] }])
  })
})
