// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GlobalSourceSelect from './GlobalSourceSelect.vue'
import { sourceApi } from '@/api'
import type { Source } from '@/api'

function source(id: string, name: string): Source {
  return { sourceId: id, name, url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}

async function mountSelect(modelValue = '') {
  const wrapper = mount(GlobalSourceSelect, { props: { modelValue } })
  await flushPromises()
  return wrapper
}

describe('GlobalSourceSelect（对齐旧平台 FileList2.vue 的"源ID"选择器，用于全部网站模式下的文件中心）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('挂载时不发起任何全局查询——12343+ 源不能一次性拉全，必须先有关键词才搜', async () => {
    const search = vi.spyOn(sourceApi, 'sourcePaged')
    await mountSelect()

    expect(search).not.toHaveBeenCalled()
  })

  it('打字防抖 300ms 后才真正发起搜索，不是逐字符请求', async () => {
    vi.useFakeTimers()
    const search = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('s1', '源一')] })
    const wrapper = mount(GlobalSourceSelect, { props: { modelValue: '' } })
    await wrapper.get('[data-testid="global-source-select-input"]').trigger('focus')

    const input = wrapper.get('[data-testid="global-source-select-input"]')
    await input.setValue('链')
    await input.setValue('链家')
    expect(search).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith({ keyword: '链家', size: 30 })
  })

  it('搜到结果后展示 [源 ID] 源名称，点击触发 update:modelValue', async () => {
    vi.useFakeTimers()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('430002781', '链家-南京')] })
    const wrapper = mount(GlobalSourceSelect, { props: { modelValue: '' } })
    const input = wrapper.get('[data-testid="global-source-select-input"]')
    await input.trigger('focus')
    await input.setValue('链家')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    const option = wrapper.get('[data-testid="global-source-select-option"]')
    expect(option.text()).toContain('链家-南京')
    expect(option.text()).toContain('430002781')

    await option.trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['430002781'])
  })

  it('已选中源时展示 [id] 名称，并提供"全部源"选项清空', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('s1', '源一')] })
    const wrapper = await mountSelect('s1')

    expect(wrapper.get('[data-testid="global-source-select-input"]').attributes('placeholder')).toBe('[s1] 源一')

    await wrapper.get('[data-testid="global-source-select-input"]').trigger('focus')
    await wrapper.get('[data-testid="global-source-select-clear"]').trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([''])
  })

  it('外部传入的初始 sourceId（如 URL 恢复）没有先经过搜索也能解析出展示名', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('s9', '预置源') ] })
    const wrapper = await mountSelect('s9')

    expect(wrapper.get('[data-testid="global-source-select-input"]').attributes('placeholder')).toBe('[s9] 预置源')
    expect(sourceApi.sourcePaged).toHaveBeenCalledWith({ sourceIds: ['s9'], size: 1 })
  })

  it('外部传入的 sourceId 查不到名字时退化为只显示 ID，不报错', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = await mountSelect('s9')

    expect(wrapper.get('[data-testid="global-source-select-input"]').attributes('placeholder')).toBe('[s9]')
  })

  it('请求失败时显示重试，不静默回退成空结果', async () => {
    vi.useFakeTimers()
    const search = vi.spyOn(sourceApi, 'sourcePaged')
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ total: 1, list: [source('s1', '源一')] })
    const wrapper = mount(GlobalSourceSelect, { props: { modelValue: '' } })
    const input = wrapper.get('[data-testid="global-source-select-input"]')
    await input.trigger('focus')
    await input.setValue('源')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(wrapper.get('[data-testid="global-source-select-options"]').text()).toContain('网络错误')

    await wrapper.get('[data-testid="global-source-select-retry"]').trigger('mousedown')
    await flushPromises()

    expect(search).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="global-source-select-option"]').text()).toContain('源一')
  })

  it('清空关键词回到未搜索状态，不残留上一次的结果', async () => {
    vi.useFakeTimers()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('s1', '源一')] })
    const wrapper = mount(GlobalSourceSelect, { props: { modelValue: '' } })
    const input = wrapper.get('[data-testid="global-source-select-input"]')
    await input.trigger('focus')
    await input.setValue('源')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(wrapper.find('[data-testid="global-source-select-option"]').exists()).toBe(true)

    await input.setValue('')
    await flushPromises()

    expect(wrapper.find('[data-testid="global-source-select-option"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('输入源 ID 或名称搜索')
  })
})
