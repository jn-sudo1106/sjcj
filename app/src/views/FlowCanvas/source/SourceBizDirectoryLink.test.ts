// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as sourceDirs from '@/api/sourceDirs'
import SourceBizDirectoryLink from './SourceBizDirectoryLink.vue'

enableAutoUnmount(afterEach)
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(sourceDirs, 'dirPath').mockImplementation(id => ['行业数据', id === 'd1' ? '化工' : '能源'])
})
const render = () => mount(SourceBizDirectoryLink, { props: { sourceId: 's1' }, attachTo: document.body, global: { plugins: [ElementPlus] } })

describe('网站源视图业务目录入口', () => {
  it('加载中不显示未归类，单目录展示完整路径并只发出定位事件', async () => {
    let done!: (value: Map<string, string[]>) => void
    vi.spyOn(sourceDirs, 'bizMembership').mockReturnValue(new Promise(resolve => { done = resolve }))
    const wrapper = render()
    expect(wrapper.text()).toContain('目录加载中')
    expect(wrapper.text()).not.toContain('未归类')
    done(new Map([['s1', ['d1']]]))
    await flushPromises()
    expect(wrapper.get('.sbd-path').text()).toBe('行业数据 / 化工')
    await wrapper.get('.sbd-path').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['d1']])
    expect(wrapper.find('.sbd-more').exists()).toBe(false)
  })

  it('失败提供重试，只有成功返回空结果才显示未归类', async () => {
    const query = vi.spyOn(sourceDirs, 'bizMembership').mockRejectedValueOnce(new Error('目录接口超时')).mockResolvedValue(new Map())
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('加载失败，重试')
    expect(wrapper.text()).not.toContain('未归类')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(query).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('未归类')
  })

  it('多目录浮层支持按完整路径搜索和选择，选中后关闭浮层', async () => {
    vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map([['s1', ['d1', 'd2']]]))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('.sbd-more').text()).toBe('+1')
    await wrapper.get('.sbd-more').trigger('click')
    await flushPromises()
    const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索业务目录"]')!
    input.value = '能源'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const options = document.querySelectorAll<HTMLButtonElement>('.sbd-option')
    expect(options).toHaveLength(1)
    expect(options[0]!.textContent).toContain('行业数据 / 能源')
    options[0]!.click()
    await flushPromises()
    expect(wrapper.emitted('navigate')).toEqual([['d2']])
    expect(wrapper.findComponent({ name: 'ElPopover' }).props('visible')).toBe(false)
  })

  it('切换源后丢弃旧源晚到的目录结果', async () => {
    let old!: (value: Map<string, string[]>) => void
    vi.spyOn(sourceDirs, 'bizMembership').mockReturnValueOnce(new Promise(resolve => { old = resolve })).mockResolvedValue(new Map([['s2', ['d2']]]))
    const wrapper = render()
    await wrapper.setProps({ sourceId: 's2' })
    await flushPromises()
    old(new Map([['s1', ['d1']]]))
    await flushPromises()
    expect(wrapper.get('.sbd-path').text()).toBe('行业数据 / 能源')
  })
})
