// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { sourceApi, type Source } from '@/api'
import * as dirs from '@/api/sourceDirs'
import BizDirPickerDialog from './BizDirPickerDialog.vue'

const sources = [{ sourceId: '10', name: '已归类源' }, { sourceId: '20', name: '未归类源' }] as Source[]
beforeEach(() => {
  dirs.resetSourceDirCache()
  vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId) => {
    if (parentId === '-2') return [{ id: '900', name: '股票数据' }, { id: '200', name: '基金数据' }]
    if (parentId === '900') return [{ id: '901', name: '股票行情', parentId: '900' }]
    return []
  })
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (query) => {
    const list = query?.sourceIds ? sources.filter((s) => String(query.sourceIds).split(',').includes(s.sourceId)) : sources
    return { total: list.length, list }
  })
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; dirs.resetSourceDirCache() })

async function open(sourceIds: string[] = ['20'], directoryIds: string[] = ['900']) {
  const wrapper = mount(BizDirPickerDialog, {
    props: { initialSourceIds: sourceIds, initialDirectoryIds: directoryIds },
    global: { plugins: [createPinia(), ElementPlus] }, attachTo: document.body,
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('业务目录单步加入', () => {
  it('同一弹窗预选源与当前目录，目录 checkbox 多选，父目录不连带写入子级', async () => {
    const add = vi.spyOn(dirs, 'addSourcesToBizDir').mockResolvedValue(1)
    const wrapper = await open()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: '20' }))
    expect((document.querySelector('tbody input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
    const tree = wrapper.findComponent({ name: 'ElTree' })
    expect(tree.props('showCheckbox')).toBe(true)
    expect(tree.props('checkStrictly')).toBe(true)
    expect(tree.vm.getCheckedKeys()).toEqual(['900'])
    tree.vm.setChecked('200', true, false)
    tree.vm.$emit('check')
    await flushPromises()
    expect(document.querySelector('[data-testid="biz-dir-picker-targets"]')?.textContent).toContain('已选 2 个目录')
    ;(document.querySelector('[data-testid="biz-dir-picker-ok"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(add.mock.calls).toEqual([['900', ['20']], ['200', ['20']]])
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('默认目录位于子级时自动展开祖先并显示勾选，未选目录时不能提交', async () => {
    await dirs.loadDirChildren('biz')
    await dirs.expandDirIds('biz', ['900'])
    const wrapper = await open(['20'], ['901'])
    const tree = wrapper.findComponent({ name: 'ElTree' })
    expect(tree.props('defaultExpandedKeys')).toEqual(['900'])
    expect(tree.vm.getCheckedKeys()).toEqual(['901'])
    tree.vm.setChecked('901', false, false)
    tree.vm.$emit('check')
    await flushPromises()
    expect((document.querySelector('[data-testid="biz-dir-picker-ok"]') as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('未预选源时查询全库，未归类源可勾选；只取消不写入', async () => {
    const add = vi.spyOn(dirs, 'addSourcesToBizDir').mockResolvedValue(1)
    const wrapper = await open([], [])
    expect(vi.mocked(sourceApi.sourcePaged).mock.lastCall?.[0]).not.toHaveProperty('sourceIds')
    expect(document.body.textContent).toContain('未归类源')
    expect((document.querySelector('[data-testid="biz-dir-picker-ok"]') as HTMLButtonElement).disabled).toBe(true)
    const cancel = [...document.querySelectorAll('.picker-footer button')].find((b) => b.textContent?.trim() === '取消') as HTMLButtonElement
    cancel.click()
    await flushPromises()
    expect(add).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('部分目录失败时保留弹窗和勾选，刷新已完成的变更，允许重试', async () => {
    const add = vi.spyOn(dirs, 'addSourcesToBizDir').mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('网络中断'))
    const wrapper = await open(['20'], ['900', '200'])
    const confirm = () => document.querySelector('[data-testid="biz-dir-picker-ok"]') as HTMLButtonElement
    confirm().click()
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(document.querySelector('[data-testid="biz-dir-picker-error"]')?.textContent).toContain('已完成 1 个目录，其余加入失败')
    expect(wrapper.findComponent({ name: 'ElTree' }).vm.getCheckedKeys()).toEqual(['900', '200'])
    add.mockResolvedValue(0)
    confirm().click()
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(add).toHaveBeenCalledTimes(4)
    wrapper.unmount()
  })
})
