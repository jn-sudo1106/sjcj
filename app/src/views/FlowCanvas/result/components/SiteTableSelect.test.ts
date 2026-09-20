// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteTableSelect from './SiteTableSelect.vue'
import { siteApi } from '@/api'
import type { SiteTablesResult } from '@/api'

function result(overrides: Partial<SiteTablesResult> = {}): SiteTablesResult {
  return {
    tables: [
      { tableId: 't1', tableName: 'T1', name: '正文表' },
      { tableId: 't2', tableName: 'T2' },
    ],
    ...overrides,
  }
}

async function mountSelect(modelValue = '') {
  const wrapper = mount(SiteTableSelect, { props: { siteId: 'site-a', modelValue } })
  await flushPromises()
  return wrapper
}

describe('SiteTableSelect', () => {
  afterEach(() => vi.restoreAllMocks())

  it('挂载后加载表并展示表名、ID', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    const options = wrapper.findAll('[data-testid="site-table-select-option"]')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('正文表')
    expect(options[0].text()).toContain('t1')
    expect(options[0].text()).not.toContain('源引用')
  })

  it('无初始选表时默认选择目录中的首张表', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    expect(wrapper.emitted('update:modelValue')).toContainEqual(['t1'])
  })

  it('按表 ID 或表名称本地过滤', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')

    await wrapper.get('[data-testid="site-table-select-input"]').setValue('t2')
    expect(wrapper.findAll('[data-testid="site-table-select-option"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="site-table-select-option"]').text()).toContain('T2')
  })

  it('点击选项触发 update:modelValue', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')

    await wrapper.get('[data-testid="site-table-select-option"]').trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['t1'])
  })

  it('目录加载失败时在下拉区域显示错误', async () => {
    vi.spyOn(siteApi, 'siteTables').mockRejectedValue(new Error('目录请求失败'))
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(wrapper.find('.sts-error').text()).toContain('目录请求失败')
  })

  it('不显示虚假的部分源失败提示', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    expect(wrapper.find('[data-testid="site-table-select-partial-fail"]').exists()).toBe(false)
    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(wrapper.findAll('[data-testid="site-table-select-option"]')).toHaveLength(2)
  })

  it('切换 siteId 时清空已选并重新加载', async () => {
    const siteTables = vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect('t1')

    await wrapper.setProps({ siteId: 'site-b' })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[''], ['t1']])
    expect(siteTables).toHaveBeenCalledWith('site-b', expect.objectContaining({ force: false }))
  })

  it('当前选中的表不在新目录时自动切换到首张表', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result({ tables: [{ tableId: 't9', tableName: 'T9' }] }))
    const wrapper = await mountSelect('t1')

    expect(wrapper.emitted('update:modelValue')).toEqual([['t9']])
  })

  it('点击刷新按钮强制重新加载', async () => {
    const siteTables = vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    await wrapper.get('[title="刷新表列表"]').trigger('click')
    await flushPromises()

    expect(siteTables).toHaveBeenLastCalledWith('site-a', expect.objectContaining({ force: true }))
  })

  it('默认收起，不管有没有已选表', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    expect(wrapper.find('[data-testid="site-table-select-options"]').exists()).toBe(false)
  })

  it('选完一张表后，输入框焦点未变也能再点开选别的表', async () => {
    vi.spyOn(siteApi, 'siteTables').mockResolvedValue(result())
    const wrapper = await mountSelect()
    const input = wrapper.get('[data-testid="site-table-select-input"]')

    await input.trigger('focus')
    await wrapper.get('[data-testid="site-table-select-option"]').trigger('mousedown')
    expect(wrapper.find('[data-testid="site-table-select-options"]').exists()).toBe(false)

    // 选中后输入框焦点没丢（mousedown.prevent 保住的），这里不再 trigger('focus')，
    // 模拟真实场景下浏览器不会重复派发 focus 事件，只靠 mousedown 兜底重新展开。
    await input.trigger('mousedown')
    expect(wrapper.findAll('[data-testid="site-table-select-option"]')).toHaveLength(2)
  })
})
