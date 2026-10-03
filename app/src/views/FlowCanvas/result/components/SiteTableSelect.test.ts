// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteTableSelect from './SiteTableSelect.vue'
import { dataApi, siteApi } from '@/api'
import type { SiteUsedTablesResult, UsedTable } from '@/api'

function table(tableId: string, tableName: string, name = tableName): UsedTable {
  return { tableId, tableName, name, sourceIds: ['s1'], sourceCnt: 1, role: 'MAIN' }
}
function result(overrides: Partial<SiteUsedTablesResult> = {}): SiteUsedTablesResult {
  return {
    tables: [table('t1', 'T1', '正文表'), table('t2', 'T2')],
    noFlowSourceCnt: 0,
    failedFlowIds: [],
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

  it('0924-12：只列本站用到的表（siteUsedTables），不再拉全库表目录', async () => {
    const usedTables = vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const catalog = vi.spyOn(dataApi, 'entryTypesGroup')
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(usedTables).toHaveBeenCalledWith('site-a', { force: false })
    expect(catalog).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-testid="site-table-select-option"]').map((o) => o.text())).toEqual(['正文表t1', 'T2t2'])
  })

  it('0924-12：名单可能不全时，下拉底部写明原因（与左栏数据表列表同口径）', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result({ noFlowSourceCnt: 3, failedFlowIds: ['f1'] }))
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(wrapper.get('[data-testid="site-table-select-partial-hint"]').text()).toBe('3 个源未关联流程，仅统计了主表；1 个流程的节点没查到')
  })

  it('名单完整时不显示不全提示', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(wrapper.find('[data-testid="site-table-select-partial-hint"]').exists()).toBe(false)
  })

  it('挂载后加载表并展示表名、ID', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    const options = wrapper.findAll('[data-testid="site-table-select-option"]')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('正文表')
    expect(options[0].text()).toContain('t1')
    expect(options[0].text()).not.toContain('源引用')
  })

  it('无初始选表时默认选择目录中的首张表', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    expect(wrapper.emitted('update:modelValue')).toContainEqual(['t1'])
  })

  it('按表 ID 或表名称本地过滤', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')

    await wrapper.get('[data-testid="site-table-select-input"]').setValue('t2')
    expect(wrapper.findAll('[data-testid="site-table-select-option"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="site-table-select-option"]').text()).toContain('T2')
  })

  it('点击选项触发 update:modelValue', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()
    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')

    await wrapper.get('[data-testid="site-table-select-option"]').trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['t1'])
  })

  it('目录加载失败时在下拉区域显示错误', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockRejectedValue(new Error('目录请求失败'))
    const wrapper = await mountSelect()

    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(wrapper.find('.sts-error').text()).toContain('目录请求失败')
  })

  it('不显示虚假的部分源失败提示', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    expect(wrapper.find('[data-testid="site-table-select-partial-fail"]').exists()).toBe(false)
    await wrapper.get('[data-testid="site-table-select-input"]').trigger('focus')
    expect(wrapper.findAll('[data-testid="site-table-select-option"]')).toHaveLength(2)
  })

  it('切换 siteId 时清空已选并重新加载', async () => {
    const siteUsedTables = vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect('t1')

    await wrapper.setProps({ siteId: 'site-b' })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[''], ['t1']])
    expect(siteUsedTables).toHaveBeenCalledWith('site-b', expect.objectContaining({ force: false }))
  })

  it('当前选中的表不在新目录时自动切换到首张表', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result({ tables: [table('t9', 'T9')] }))
    const wrapper = await mountSelect('t1')

    expect(wrapper.emitted('update:modelValue')).toEqual([['t9']])
  })

  it('点击刷新按钮强制重新加载', async () => {
    const siteUsedTables = vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    await wrapper.get('[title="刷新表列表"]').trigger('click')
    await flushPromises()

    expect(siteUsedTables).toHaveBeenLastCalledWith('site-a', expect.objectContaining({ force: true }))
  })

  it('默认收起，不管有没有已选表', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
    const wrapper = await mountSelect()

    expect(wrapper.find('[data-testid="site-table-select-options"]').exists()).toBe(false)
  })

  it('选完一张表后，输入框焦点未变也能再点开选别的表', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result())
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
