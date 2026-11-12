// @vitest-environment jsdom
// 1111 数据中心「数据查询」源搜索：跟网站数据视图左栏「源列表」一样的入口（搜索源 / 来源组），
// 选中源即切到该源的查询结果；空关键词时回落当前数据表里的源预览。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceSearchPicker from './SourceSearchPicker.vue'
import { sourceApi, sourceGroupApi, type Source, type SourceGroup } from '../../api'

function makeSource(overrides: Partial<Source>): Source {
  return {
    sourceId: 's-1',
    name: '示例源',
    url: 'https://example.com',
    configId: 'c-1',
    mainTable: 't1',
    owner: 'ops',
    state: 'C',
    ...overrides,
  }
}

const GROUPS: SourceGroup[] = [
  { sourceGroupId: '3', sourceGroupCode: 'G3', sourceGroupName: '财经来源组', state: 'ACTIVE', flowIds: [], revision: 1 },
  { sourceGroupId: '7', sourceGroupCode: 'G7', sourceGroupName: '政务来源组', state: 'ACTIVE', flowIds: [], revision: 1 },
]

describe('数据中心 · 源搜索', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.spyOn(sourceGroupApi, 'list').mockResolvedValue(GROUPS)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function mountPicker(props: Record<string, unknown> = {}) {
    wrapper = mount(SourceSearchPicker, {
      props: { preview: [], ...props },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    await flushPromises()
    return wrapper
  }

  function input() {
    return wrapper!.get('[data-testid="data-source-search-input"]')
  }

  async function type(value: string) {
    await input().setValue(value)
    await vi.advanceTimersByTimeAsync(320)
    await flushPromises()
  }

  it('空关键词聚焦时展示当前数据表的源预览', async () => {
    await mountPicker({ preview: [{ sourceId: '600519', name: '贵州茅台' }] })
    await input().trigger('focus')
    const options = wrapper!.findAll('[data-testid="data-source-search-option"]')
    expect(options).toHaveLength(1)
    expect(options[0].text()).toContain('贵州茅台')
    expect(options[0].text()).toContain('600519')
  })

  it('输入源名走后端检索，并显示源名 + 源 ID + 网站 + 来源组', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [makeSource({ sourceId: '600519', name: '贵州茅台', siteName: '东方财富', sourceGroupId: '3' })],
    })
    await mountPicker({ currentTable: 't9' })
    await input().trigger('focus')
    await type('茅台')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: '茅台', size: 30 }))
    const options = wrapper!.findAll('[data-testid="data-source-search-option"]')
    expect(options).toHaveLength(1)
    expect(options[0].text()).toContain('贵州茅台')
    expect(options[0].text()).toContain('600519')
    expect(options[0].text()).toContain('东方财富')
    expect(options[0].text()).toContain('财经来源组')
    // 源主表不是当前表时标出来（仍可直接选中，用于给当前表录首条数据）
    expect(options[0].text()).toContain('主表 t1')
  })

  it('纯数字关键词先按源 ID 精确命中', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (query) => {
      const list = query?.sourceIds ? [makeSource({ sourceId: '600519' })] : []
      return { total: list.length, list }
    })
    await mountPicker()
    await input().trigger('focus')
    await type('600519')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: ['600519'] }))
    expect(wrapper!.findAll('[data-testid="data-source-search-option"]')).toHaveLength(1)
  })

  it('来源组来自 source-group/list，选中后按组检索', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [makeSource({ sourceId: 'g-1', name: '组内源', sourceGroupId: '3' })] })
    const picker = await mountPicker()
    const select = picker.get('[data-testid="data-source-search-group"]')
    const optionTexts = select.findAll('option').map((option) => option.text())
    expect(optionTexts).toEqual(['全部来源组', '财经来源组', '政务来源组'])
    await select.setValue('3')
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: '3' }))
    await input().trigger('focus')
    expect(picker.findAll('[data-testid="data-source-search-option"]')).toHaveLength(1)
  })

  it('选中源后回传源 ID 与源信息（含 mainTable 供父级切表）', async () => {
    vi.useFakeTimers()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [makeSource({ sourceId: '600519', name: '贵州茅台' })] })
    const picker = await mountPicker()
    await input().trigger('focus')
    await type('茅台')
    await picker.findAll('[data-testid="data-source-search-option"]')[0].trigger('mousedown')
    expect(picker.emitted('update:modelValue')?.[0]).toEqual(['600519'])
    expect(picker.emitted('picked')?.[0]).toEqual([expect.objectContaining({ sourceId: '600519', name: '贵州茅台', mainTable: 't1' })])
    expect(picker.find('[data-testid="data-source-search-panel"]').exists()).toBe(false)
  })

  it('已选源收起时显示「源 ID 源名」，点清除回传空并通知父级重新查询', async () => {
    const picker = await mountPicker({ modelValue: '600519', modelLabel: '贵州茅台' })
    expect((input().element as HTMLInputElement).value).toBe('600519 贵州茅台')
    await picker.get('[data-testid="data-source-search-clear"]').trigger('click')
    expect(picker.emitted('update:modelValue')?.[0]).toEqual([''])
    expect(picker.emitted('picked')?.[0]).toEqual([null])
  })

  it('没有匹配结果与搜索失败都有明确提示', async () => {
    vi.useFakeTimers()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const picker = await mountPicker()
    await input().trigger('focus')
    await type('不存在的源')
    expect(picker.text()).toContain('没有匹配的源')

    vi.mocked(sourceApi.sourcePaged).mockRejectedValueOnce(new Error('网络错误'))
    await type('再搜一次')
    expect(picker.text()).toContain('搜索失败')
  })

  it('来源组加载失败时可重试', async () => {
    vi.mocked(sourceGroupApi.list).mockRejectedValueOnce(new Error('500'))
    const picker = await mountPicker()
    await input().trigger('focus')
    expect(picker.text()).toContain('来源组加载失败')
    await picker.get('.ssp-retry').trigger('click')
    await flushPromises()
    expect(picker.findAll('[data-testid="data-source-search-group"] option')).toHaveLength(3)
  })
})