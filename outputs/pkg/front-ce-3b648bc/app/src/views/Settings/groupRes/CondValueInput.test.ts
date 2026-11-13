// 条件值输入控件：按 valueFrom 分发（picker 远程搜索 / 全量 + 组名、bool/date/num/text 原生控件）、
// 受控回填反查名称、加载失败降级为 allow-create 手输 ID。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const sourcePaged = vi.fn()
const sitePaged = vi.fn()
const configPaged = vi.fn()
const searchTables = vi.fn()
const searchDirs = vi.fn()
const pagedSysUser = vi.fn()
const listGroupIds = vi.fn()

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    sourceApi: { sourcePaged: (...args: unknown[]) => sourcePaged(...args) },
    siteApi: { sitePaged: (...args: unknown[]) => sitePaged(...args) },
    configApi: { configPaged: (...args: unknown[]) => configPaged(...args) },
    entryApi: { searchTables: (...args: unknown[]) => searchTables(...args) },
  }
})
vi.mock('@/api/sourceDirs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, searchDirs: (...args: unknown[]) => searchDirs(...args) }
})
vi.mock('@/api/sysUser', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, pagedSysUser: (...args: unknown[]) => pagedSysUser(...args) }
})
vi.mock('@/api/groupRes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/groupRes')>()
  return { ...actual, listGroupIds: (...args: unknown[]) => listGroupIds(...args) }
})

import CondValueInput from './CondValueInput.vue'
import RemoteIdSelect from './RemoteIdSelect.vue'
import { setGroupName } from '@/utils/groupNames'
import type { GroupResField } from '@/api/groupRes'

function field(valueFrom: string, type = 'num', ops: string[] = ['IN', '=']): GroupResField {
  return { field: 'X_ID', name: '测试列', type, ops, valueFrom }
}

function mountInput(props: { field: GroupResField; modelValue?: string[]; multiple?: boolean }) {
  return mount(CondValueInput, {
    props: { modelValue: [], ...props },
    global: { plugins: [ElementPlus] },
  })
}

function remoteSelect(wrapper: VueWrapper) {
  return wrapper.findComponent(RemoteIdSelect)
}

describe('CondValueInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('picker 类 valueFrom 渲染 RemoteIdSelect，原生类不渲染', () => {
    expect(remoteSelect(mountInput({ field: field('sourcePicker') })).exists()).toBe(true)
    expect(remoteSelect(mountInput({ field: field('groupPicker') })).exists()).toBe(true)
    expect(remoteSelect(mountInput({ field: field('text', 'str', ['LIKE']) })).exists()).toBe(false)
  })

  it('sourcePicker：搜索走 sourcePaged(name)，选项是「名称（ID）」；选中上抛 ID 字符串数组', async () => {
    sourcePaged.mockResolvedValue({ total: 2, list: [{ sourceId: '430001300', name: '新浪' }, { sourceId: '430001301', name: '搜狐' }] })
    const wrapper = mountInput({ field: field('sourcePicker'), multiple: true })
    await flushPromises()

    await remoteSelect(wrapper).props('search')!('新浪')
    expect(sourcePaged).toHaveBeenCalledWith(expect.objectContaining({ name: '新浪' }))

    remoteSelect(wrapper).vm.$emit('update:modelValue', ['430001300'])
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['430001300'])
  })

  it('sourcePicker 受控回填：挂载时用 sourceIds 反查名称进候选（label 带名称）', async () => {
    sourcePaged.mockResolvedValue({ total: 1, list: [{ sourceId: '430001300', name: '新浪' }] })
    const wrapper = mountInput({ field: field('sourcePicker'), modelValue: ['430001300'], multiple: true })
    await flushPromises()

    expect(sourcePaged).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: '430001300' }))
    const labels = remoteSelect(wrapper).findAllComponents({ name: 'ElOption' }).map((o) => o.props('label'))
    expect(labels).toContain('新浪（430001300）')
  })

  it('groupPicker：候选来自 listGroupIds，已登记组名的显示「名称（ID）」，未登记显示裸 ID', async () => {
    listGroupIds.mockResolvedValue([100001, 100002])
    setGroupName(100001, '研发一组')
    const wrapper = mountInput({ field: field('groupPicker') })
    await flushPromises()

    const search = remoteSelect(wrapper).props('search') as (kw: string) => Promise<{ value: string; label: string }[]>
    const options = await search('')
    expect(options).toEqual([
      { value: '100001', label: '研发一组（100001）' },
      { value: '100002', label: '100002' },
    ])
    // 关键字按名称或 ID 过滤
    expect(await search('研发')).toEqual([options[0]])
    expect(await search('100002')).toEqual([options[1]])
  })

  it('groupPicker 带「登记组名」按钮（用户要求组 ID 与组名同时显示，组名自维护）', () => {
    listGroupIds.mockResolvedValue([])
    const wrapper = mountInput({ field: field('groupPicker') })
    expect(wrapper.find('[data-testid="group-name-edit"]').exists()).toBe(true)
  })

  it('搜索接口挂掉：不抛全局错误，降级为 allow-create 手输（候选清空但仍可输入 ID）', async () => {
    sourcePaged.mockRejectedValue(new Error('network down'))
    const wrapper = mountInput({ field: field('sourcePicker'), modelValue: ['999'], multiple: true })
    await flushPromises()
    const search = remoteSelect(wrapper).props('search') as (kw: string) => Promise<unknown[]>
    await expect(search('x')).resolves.toEqual([])
    expect(remoteSelect(wrapper).findComponent({ name: 'ElSelect' }).props('allowCreate')).toBe(true)
  })

  it('bool：0/1 下拉，选中上抛字符串数组', async () => {
    const wrapper = mountInput({ field: field('bool', 'num', ['=']) })
    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', '1')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['1'])
  })

  it('date 单值：日期选择器，值格式 YYYY-MM-DD HH:mm:ss', () => {
    const wrapper = mountInput({ field: field('date', 'date', ['>', '<']) })
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    expect(picker.exists()).toBe(true)
    expect(picker.props('valueFormat')).toBe('YYYY-MM-DD HH:mm:ss')
  })

  it('num 单值：数字输入框；空串 ↔ undefined 代理不产生 NaN', async () => {
    const wrapper = mountInput({ field: field('number') })
    const num = wrapper.findComponent({ name: 'ElInputNumber' })
    expect(num.exists()).toBe(true)
    num.vm.$emit('update:modelValue', 42)
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['42'])
    num.vm.$emit('update:modelValue', undefined)
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([])
  })

  it('text 多选（op=IN 且无 picker）：tag 输入原样上抛', async () => {
    const wrapper = mountInput({ field: field('text', 'str', ['IN']), multiple: true })
    const select = wrapper.findComponent({ name: 'ElSelect' })
    expect(select.props('multiple')).toBe(true)
    select.vm.$emit('update:modelValue', ['a', 'b'])
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['a', 'b'])
  })

  it('sitePicker：全量拉一次后客户端过滤（后端不支持按 siteIds 反查）', async () => {
    sitePaged.mockResolvedValue({ total: 2, list: [{ siteId: '3001', name: '新浪网' }, { siteId: '3002', name: '网易' }] })
    const wrapper = mountInput({ field: field('sitePicker') })
    await flushPromises()
    const search = remoteSelect(wrapper).props('search') as (kw: string) => Promise<{ value: string; label: string }[]>
    expect(await search('')).toHaveLength(2)
    expect(await search('新浪')).toEqual([{ value: '3001', label: '新浪网（3001）' }])
    // 全量只拉一次（第二次过滤不再发请求）
    expect(sitePaged).toHaveBeenCalledTimes(1)
  })
})
