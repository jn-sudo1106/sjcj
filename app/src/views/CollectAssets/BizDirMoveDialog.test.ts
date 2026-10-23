// @vitest-environment jsdom
// 2026-10-21 业务目录「移动到…」：目标单选、当前目录不可选、可「仅移出」，失败按步骤提示
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import { sourceApi } from '@/api'
import * as dirs from '@/api/sourceDirs'
import BizDirMoveDialog from './BizDirMoveDialog.vue'

beforeEach(() => {
  dirs.resetSourceDirCache()
  vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId) => {
    if (parentId === '-2') return [{ id: '900', name: '股票数据' }, { id: '200', name: '基金数据' }]
    return []
  })
  vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; dirs.resetSourceDirCache() })

async function open() {
  const wrapper = mount(BizDirMoveDialog, {
    props: { sourceIds: ['1', '2'], fromDirIds: ['900'], fromLabel: '股票数据' },
    global: { plugins: [ElementPlus] }, attachTo: document.body,
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}
const node = (id: string) => document.querySelector(`[data-testid="biz-dir-move-node"][data-dir="${id}"]`) as HTMLElement
const ok = () => document.querySelector('[data-testid="biz-dir-move-ok"]') as HTMLButtonElement

describe('BizDirMoveDialog', () => {
  it('没选目标不能提交；当前目录不可选；点目标后移动，先加后移交给 moveSourcesInBiz', async () => {
    const move = vi.spyOn(dirs, 'moveSourcesInBiz').mockResolvedValue()
    const wrapper = await open()
    expect(ok().disabled).toBe(true)
    expect(node('900').textContent).toContain('当前目录')
    node('900').click()
    await flushPromises()
    expect(ok().disabled).toBe(true)
    node('200').click()
    await flushPromises()
    expect(document.querySelector('[data-testid="biz-dir-move-target"]')?.textContent).toBe('基金数据')
    expect(ok().textContent).toContain('移动 2 个源')
    ok().click()
    await flushPromises()
    expect(move).toHaveBeenCalledWith(['900'], '200', ['1', '2'])
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('勾「仅移出」：不需要目标，目标传 null', async () => {
    const move = vi.spyOn(dirs, 'moveSourcesInBiz').mockResolvedValue()
    await open()
    ;(document.querySelector('[data-testid="biz-dir-move-remove-only"]') as HTMLInputElement).click()
    await flushPromises()
    expect(ok().disabled).toBe(false)
    expect(ok().textContent).toContain('移出 2 个源')
    ok().click()
    await flushPromises()
    expect(move).toHaveBeenCalledWith(['900'], null, ['1', '2'])
  })

  it('已加入目标但移出失败：提示可重试，并通知外层刷新；弹窗不关', async () => {
    vi.spyOn(dirs, 'moveSourcesInBiz').mockRejectedValue(Object.assign(new Error('超时'), { step: 'remove' }))
    const wrapper = await open()
    node('200').click()
    await flushPromises()
    ok().click()
    await flushPromises()
    expect(document.querySelector('[data-testid="biz-dir-move-error"]')?.textContent).toContain('已加入「基金数据」，但从「股票数据」移出失败：超时')
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeFalsy()
  })
})
