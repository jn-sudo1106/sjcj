// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceListDialog from './SourceListDialog.vue'
import { sourceApi } from '../../../api'

// 源列表选择弹窗：分类树既做筛选（复选/单选 → categorys），又可编辑（编辑分类）。
describe('SourceListDialog · 源列表选择弹窗', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('加载根分类、懒加载子级，点分类按 categorys 过滤源列表', async () => {
    const categories = vi
      .spyOn(sourceApi, 'sourceCategories')
      .mockImplementation(async (parentId?: string) =>
        parentId ? [{ id: 'finance-stock', name: '股票', count: 8 }] : [{ id: 'finance', name: '财经资讯' }],
      )
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    wrapper = mount(SourceListDialog, {
      attachTo: document.body,
      props: { modelValue: false },
      global: { plugins: [ElementPlus] },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(categories).toHaveBeenCalledWith()
    expect(document.body.textContent).toContain('财经资讯')

    // 展开根节点 → 按 parentId 懒加载子级
    await (document.body.querySelector('.sct-tree .el-tree-node__expand-icon') as HTMLElement).click()
    await flushPromises()
    expect(categories).toHaveBeenCalledWith('finance')
    expect(document.body.textContent).toContain('股票')

    // 点节点 → 单选下钻 → 以 categorys 过滤（对齐旧 SourceList2.queryParam.categorys）
    await (document.body.querySelector('.sct-tree .el-tree-node__content') as HTMLElement).click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ categorys: 'finance', page: 1 }))
  })

  it('进入编辑模式后露出「退出编辑」与节点「…」操作菜单（迁移旧 CategoryTree）', async () => {
    vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([{ id: 'finance', name: '财经资讯' }])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    wrapper = mount(SourceListDialog, {
      attachTo: document.body,
      props: { modelValue: false },
      global: { plugins: [ElementPlus] },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    const toggle = document.body.querySelector('.sct-edit-toggle') as HTMLElement
    expect(toggle.textContent).toContain('编辑分类')
    // 非编辑态：节点「…」菜单不出现
    expect(document.body.querySelector('.sct-node-more')).toBeNull()

    await toggle.click()
    await flushPromises()
    expect(toggle.textContent).toContain('退出编辑')
    expect(document.body.querySelector('.sct-node-more')).not.toBeNull()
  })

  it('URL 列是可点外链（对齐旧 urlSlot 的 <a target="_blank">）：点链接开新窗口，无 URL 的行显示「—」', async () => {
    vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([{ id: 'finance', name: '财经资讯' }])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2,
      list: [
        {
          sourceId: 's1',
          name: '源 A',
          url: 'https://example.com/a?x=1',
          configId: 'c1',
          mainTable: 't1',
          owner: 'u',
          state: 'C',
        },
        { sourceId: 's2', name: '源 B', url: '', configId: 'c2', mainTable: 't2', owner: 'u', state: 'C' },
      ],
    })

    wrapper = mount(SourceListDialog, {
      attachTo: document.body,
      props: { modelValue: false },
      global: { plugins: [ElementPlus] },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    const link = document.body.querySelector('a.sld-url') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('https://example.com/a?x=1')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('title')).toBe('https://example.com/a?x=1')
    expect(link.textContent?.trim()).toBe('https://example.com/a?x=1')

    // 空 URL 的行给占位文本，不能渲染成 href="" 的链接
    const rows = [...document.body.querySelectorAll('.el-table__body tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows[1].querySelector('a')).toBeNull()
    expect(rows[1].textContent).toContain('—')
  })
})
