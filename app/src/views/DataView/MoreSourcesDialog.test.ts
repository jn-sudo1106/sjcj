// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import { sourceApi } from '../../api'

describe('MoreSourcesDialog · 分类树', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('首屏读取根分类，展开时按 parentId 懒加载，选择分类后筛选源列表', async () => {
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => (
      parentId
        ? [{ id: 'finance-stock', name: '股票', count: 8 }]
        : [{ id: 'finance', name: '财经资讯' }]
    ))
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    wrapper = mount(MoreSourcesDialog, {
      attachTo: document.body,
      props: { modelValue: false },
      global: { plugins: [ElementPlus] },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(categories).toHaveBeenCalledWith()
    expect(document.body.textContent).toContain('财经资讯')
    expect(document.body.textContent).not.toContain('财经资讯（0）')

    const root = document.body.querySelector('.dv-category-tree .el-tree-node')!
    await (root.querySelector('.el-tree-node__expand-icon') as HTMLElement).click()
    await flushPromises()
    expect(categories).toHaveBeenCalledWith('finance')
    expect(document.body.textContent).toContain('股票')

    await (root.querySelector('.el-tree-node__content') as HTMLElement).click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'finance', page: 1 }))
  })
})
