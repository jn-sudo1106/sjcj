// @vitest-environment jsdom
// 2026-10-21 源管理「系统目录」页签左侧目录：父子联动同旧平台、点名称只看一个、系统/业务二选一、可折叠
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceDirPanel, { type DirScope } from './SourceDirPanel.vue'
import { sourceApi, type SourceCategory } from '@/api'
import { resetSourceDirCache } from '@/api/sourceDirs'

const cat = (id: string, name: string, parentId = ''): SourceCategory => ({ id, name, ...(parentId ? { parentId } : {}) })
const TREE: Record<string, SourceCategory[]> = {
  root: [cat('100', '财经资讯'), cat('-1', '视图目录'), cat('-2', '业务分类'), cat('200', '海外社媒')],
  '100': [cat('101', '证券之星', '100'), cat('102', '雪球', '100')],
  '101': [cat('111', '港股', '101')],
  '102': [], '111': [], '200': [],
  '-2': [cat('900', '股票数据', '-2')],
  '900': [cat('901', '股票行情', '900')],
  '901': [],
}

beforeEach(() => {
  resetSourceDirCache()
  vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => TREE[parentId ?? 'root'] ?? [])
})
afterEach(() => vi.restoreAllMocks())

async function mountPanel(collapsed = false) {
  const wrapper = mount(SourceDirPanel, { props: { collapsed }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}
const row = (w: Awaited<ReturnType<typeof mountPanel>>, id: string) => w.get(`[data-testid="dir-node"][data-dir="${id}"]`)
const lastScope = (w: Awaited<ReturnType<typeof mountPanel>>) => w.emitted('change')!.at(-1)![0] as DirScope
async function expand(w: Awaited<ReturnType<typeof mountPanel>>, id: string) {
  await row(w, id).get('button.sdp-caret').trigger('click')
  await flushPromises()
}

describe('SourceDirPanel', () => {
  it('系统目录根层不出现 -1 / -2', async () => {
    const w = await mountPanel()
    expect(w.findAll('[data-testid="dir-name"]').map((n) => n.text())).toEqual(['财经资讯', '海外社媒'])
  })

  it('勾父目录：子孙全勾，范围含子级；取消一个子目录后父级半选', async () => {
    const w = await mountPanel()
    await expand(w, '100')
    await row(w, '100').get('[data-testid="dir-check"]').setValue(true)
    await flushPromises()
    expect(lastScope(w).dirIds.sort()).toEqual(['100', '101', '102', '111'])
    expect(lastScope(w).labels.map((l) => l.path)).toEqual(['财经资讯'])
    expect((row(w, '102').get('[data-testid="dir-check"]').element as HTMLInputElement).checked).toBe(true)

    await row(w, '102').get('[data-testid="dir-check"]').setValue(false)
    await flushPromises()
    const parent = row(w, '100').get('[data-testid="dir-check"]').element as HTMLInputElement
    expect(parent.checked).toBe(false)
    expect(parent.indeterminate).toBe(true)
    expect(lastScope(w).dirIds.sort()).toEqual(['101', '111'])
    expect(lastScope(w).labels.map((l) => l.path)).toEqual(['财经资讯 / 证券之星'])
  })

  it('子目录全勾上后父级跟着勾上', async () => {
    const w = await mountPanel()
    await expand(w, '100')
    await row(w, '101').get('[data-testid="dir-check"]').setValue(true)
    await flushPromises()
    await row(w, '102').get('[data-testid="dir-check"]').setValue(true)
    await flushPromises()
    expect((row(w, '100').get('[data-testid="dir-check"]').element as HTMLInputElement).checked).toBe(true)
    expect(lastScope(w).labels.map((l) => l.path)).toEqual(['财经资讯'])
  })

  it('点名称：清掉勾选，只看这一个目录（含子级）；再点一次取消', async () => {
    const w = await mountPanel()
    await row(w, '200').get('[data-testid="dir-check"]').setValue(true)
    await flushPromises()
    await row(w, '100').get('[data-testid="dir-name"]').trigger('click')
    await flushPromises()
    expect(lastScope(w).dirIds.sort()).toEqual(['100', '101', '102', '111'])
    expect((row(w, '200').get('[data-testid="dir-check"]').element as HTMLInputElement).checked).toBe(false)
    await row(w, '100').get('[data-testid="dir-name"]').trigger('click')
    await flushPromises()
    expect(lastScope(w).dirIds).toEqual([])
  })

  it('切到业务目录：根层是 -2 的子级，两边的选择各自保留', async () => {
    const w = await mountPanel()
    await row(w, '200').get('[data-testid="dir-name"]').trigger('click')
    await flushPromises()
    await w.get('[data-testid="dir-kind-biz"]').trigger('click')
    await flushPromises()
    expect(lastScope(w)).toMatchObject({ kind: 'biz', dirIds: [] })
    expect(w.findAll('[data-testid="dir-name"]').map((n) => n.text())).toEqual(['股票数据'])
    await w.get('[data-testid="dir-kind-sys"]').trigger('click')
    await flushPromises()
    expect(lastScope(w)).toMatchObject({ kind: 'sys', dirIds: ['200'] })
  })

  it('没有目录编辑入口；折叠按钮发 update:collapsed，折叠态显示窄条和已选数', async () => {
    const w = await mountPanel()
    const buttons = w.findAll('button').map((b) => b.text())
    expect(buttons.some((t) => /新增|编辑|重命名|删除/.test(t))).toBe(false)
    expect(w.text()).toContain('系统设置')
    await w.get('[data-testid="dir-panel-fold"]').trigger('click')
    expect(w.emitted('update:collapsed')![0]).toEqual([true])

    await row(w, '200').get('[data-testid="dir-name"]').trigger('click')
    await flushPromises()
    await w.setProps({ collapsed: true })
    expect(w.find('[data-testid="source-dir-panel"]').exists()).toBe(false)
    expect(w.get('[data-testid="dir-panel-rail"]').text()).toContain('1')
  })

  it('清空：当前这套目录的勾选和点选都清掉', async () => {
    const w = await mountPanel()
    await row(w, '200').get('[data-testid="dir-check"]').setValue(true)
    await flushPromises()
    await w.get('[data-testid="dir-clear"]').trigger('click')
    await flushPromises()
    expect(lastScope(w).dirIds).toEqual([])
  })
})
