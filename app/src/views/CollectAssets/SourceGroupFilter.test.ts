// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { sourceGroupApi, type SourceGroup } from '@/api'
import SourceGroupFilter from './SourceGroupFilter.vue'

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())
const groups: SourceGroup[] = Array.from({ length: 25 }, (_, i) => ({
  sourceGroupId: String(i + 1), sourceGroupCode: `g${i + 1}`, sourceGroupName: `来源组 ${i + 1}`,
  state: i === 1 ? 'DISABLED' : 'ACTIVE', flowIds: [], revision: 1,
}))
beforeEach(() => vi.spyOn(sourceGroupApi, 'list').mockResolvedValue(groups))

describe('来源组左栏筛选', () => {
  it('一次展示全部组并支持搜索，不分页或查询成员；停用组不可选，不提供非法 ID', async () => {
    const members = vi.spyOn(sourceGroupApi, 'members')
    const wrapper = mount(SourceGroupFilter)
    await flushPromises()
    expect(wrapper.findAll('[data-group-id]')).toHaveLength(25)
    expect(wrapper.get('[data-group-id="2"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-group-id="-1"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="下一页来源组"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="上一页来源组"]').exists()).toBe(false)
    await wrapper.get('input').setValue('来源组 25')
    expect(wrapper.findAll('[data-group-id]')).toHaveLength(1)
    await wrapper.get('[data-group-id="25"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['25'])
    expect(members).not.toHaveBeenCalled()
  })

  it('刷新保持当前搜索与选择，候选变少也不自动清除所选范围', async () => {
    const wrapper = mount(SourceGroupFilter, { props: { modelValue: '15' } })
    await flushPromises()
    await wrapper.get('[aria-label="刷新来源组"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-group-id="15"]').attributes('aria-pressed')).toBe('true')
    vi.mocked(sourceGroupApi.list).mockResolvedValue(groups.slice(0, 3))
    await wrapper.get('[aria-label="刷新来源组"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-group-id]')).toHaveLength(3)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('input').setValue('不存在')
    await wrapper.get('[aria-label="刷新来源组"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('不存在')
    expect(wrapper.text()).toContain('没有匹配的来源组')
  })

  it('失败显示真实错误，刷新可恢复；失败不清除已选范围', async () => {
    vi.mocked(sourceGroupApi.list).mockRejectedValueOnce(new Error('网络中断'))
    const wrapper = mount(SourceGroupFilter, { props: { modelValue: '15' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络中断')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('[aria-label="刷新来源组"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('[data-testid="source-group-all"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  })
})
