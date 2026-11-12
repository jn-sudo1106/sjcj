// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteSourceSelect from './SiteSourceSelect.vue'
import { siteApi } from '@/api'
import type { Source } from '@/api'

function source(id: string, name: string): Source {
  return { sourceId: id, name, url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}

async function mountSelect(modelValue = '') {
  const wrapper = mount(SiteSourceSelect, { props: { siteId: 'site-a', modelValue } })
  await flushPromises()
  return wrapper
}

describe('SiteSourceSelect', () => {
  afterEach(() => vi.restoreAllMocks())

  it('挂载后加载当前网站的源，展示 "全部源" 与各源的 [源 ID] 源名称', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-source-select-input"]').trigger('focus')
    expect(wrapper.find('[data-testid="site-source-select-option-all"]').exists()).toBe(true)
    const options = wrapper.findAll('[data-testid="site-source-select-option"]')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('源一')
    expect(options[0].text()).toContain('s1')
  })

  it('按源 ID 或源名称本地过滤', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-source-select-input"]').trigger('focus')

    await wrapper.get('[data-testid="site-source-select-input"]').setValue('s2')
    expect(wrapper.findAll('[data-testid="site-source-select-option"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="site-source-select-option"]').text()).toContain('源二')
    // 过滤时不再显示"全部源"这个特殊项
    expect(wrapper.find('[data-testid="site-source-select-option-all"]').exists()).toBe(false)
  })

  it('点击具体源选项触发 update:modelValue', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一')])
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-source-select-input"]').trigger('focus')

    await wrapper.get('[data-testid="site-source-select-option"]').trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['s1'])
  })

  it('开启 defaultFirst 时加载完成自动选中第一个源', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    const wrapper = mount(SiteSourceSelect, { props: { siteId: 'site-default', modelValue: '', defaultFirst: true } })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['s1'])
  })

  it('已选具体源时，点开下拉点"全部源"选项能清空回到全部源（不额外放一个常驻按钮，只有下拉这一个入口）', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一')])
    const wrapper = await mountSelect('s1')

    expect(wrapper.find('[data-testid="site-source-select-clear"]').exists()).toBe(false)
    await wrapper.get('[data-testid="site-source-select-input"]').trigger('focus')
    await wrapper.get('[data-testid="site-source-select-option-all"]').trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([''])
  })

  it('选完一个源后，输入框焦点未变也能再点开选别的源（不依赖 focus 事件重复触发）', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    const wrapper = await mountSelect()
    const input = wrapper.get('[data-testid="site-source-select-input"]')

    await input.trigger('focus')
    await wrapper.get('[data-testid="site-source-select-option"]').trigger('mousedown')
    expect(wrapper.find('[data-testid="site-source-select-options"]').exists()).toBe(false)

    // 选中后输入框焦点没丢（mousedown.prevent 保住的），这里不再 trigger('focus')，
    // 模拟真实场景下浏览器不会重复派发 focus 事件，只靠 mousedown 兜底重新展开。
    await input.trigger('mousedown')
    expect(wrapper.findAll('[data-testid="site-source-select-option"]')).toHaveLength(2)
  })

  it('请求失败时显示重试，不回退为其他数据；点击重试重新发起请求', async () => {
    const siteSources = vi.spyOn(siteApi, 'siteSources')
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce([source('s1', '源一')])
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-source-select-input"]').trigger('focus')

    expect(wrapper.find('[data-testid="site-source-select-options"]').text()).toContain('网络错误')
    expect(wrapper.find('[data-testid="site-source-select-option"]').exists()).toBe(false)

    await wrapper.get('[data-testid="site-source-select-retry"]').trigger('mousedown')
    await flushPromises()

    expect(siteSources).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="site-source-select-option"]').text()).toContain('源一')
  })

  it('切换 siteId 时清空已选并重新加载该网站的源', async () => {
    const siteSources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一')])
    const wrapper = await mountSelect('s1')

    await wrapper.setProps({ siteId: 'site-b' })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([''])
    expect(siteSources).toHaveBeenLastCalledWith('site-b')
  })
})
