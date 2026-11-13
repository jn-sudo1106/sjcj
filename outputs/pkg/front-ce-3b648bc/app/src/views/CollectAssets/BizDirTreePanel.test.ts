// @vitest-environment jsdom
// 2026-10-31「我的分组」来源组栏里的业务目录树：只有业务目录、可勾选多个目录（父目录含子孙）、点「完成」回组列表
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import BizDirTreePanel from './BizDirTreePanel.vue'
import { sourceApi, type SourceCategory } from '@/api'
import { resetSourceDirCache } from '@/api/sourceDirs'

const cat = (id: string, name: string, parentId = ''): SourceCategory => ({ id, name, ...(parentId ? { parentId } : {}) })
const TREE: Record<string, SourceCategory[]> = {
  root: [cat('100', '财经资讯'), cat('-2', '业务分类')],
  '-2': [cat('900', '股票数据', '-2'), cat('950', '宏观', '-2')],
  '900': [cat('901', '股票行情', '900')],
  '901': [], '950': [],
}

beforeEach(() => {
  resetSourceDirCache()
  vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => TREE[parentId ?? 'root'] ?? [])
})
afterEach(() => vi.restoreAllMocks())

async function mountTree(props: { selected?: string[] } = {}) {
  const wrapper = mount(BizDirTreePanel, { props: { selected: [], ...props }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}
const row = (w: Awaited<ReturnType<typeof mountTree>>, id: string) => w.get(`[data-testid="biz-dir-node"][data-dir="${id}"]`)
const box = (w: Awaited<ReturnType<typeof mountTree>>, id: string) => row(w, id).get('input[type="checkbox"]').element as HTMLInputElement
const lastPick = (w: Awaited<ReturnType<typeof mountTree>>) => w.emitted('select')!.at(-1)![0]

describe('BizDirTreePanel', () => {
  it('只列业务目录（-2 根下），不列系统目录', async () => {
    const w = await mountTree()
    const names = w.findAll('[data-testid="biz-dir-name"]').map((n) => n.text())
    expect(names).toEqual(['股票数据', '宏观'])
  })

  it('可勾选多个目录，回传带路径的目录列表；再点取消', async () => {
    const w = await mountTree()
    await row(w, '900').get('[data-testid="biz-dir-check"]').setValue(true)
    await flushPromises()
    expect(lastPick(w)).toEqual([{ id: '900', path: '股票数据' }])
    await w.setProps({ selected: ['900'] })
    await row(w, '950').get('[data-testid="biz-dir-check"]').setValue(true)
    await flushPromises()
    expect(lastPick(w)).toEqual([{ id: '900', path: '股票数据' }, { id: '950', path: '宏观' }])
    await w.setProps({ selected: ['900', '950'] })
    expect(w.text()).toContain('已选 2 个目录（含子级）')
    expect(row(w, '900').classes()).toContain('on')
    await row(w, '900').get('[data-testid="biz-dir-check"]').setValue(false)
    expect(lastPick(w)).toEqual([{ id: '950', path: '宏观' }])
  })

  it('勾了父目录，子目录算在内（已勾、不能单独操作）；父目录勾上时去掉单独勾过的子目录', async () => {
    const w = await mountTree({ selected: ['901'] })
    await row(w, '900').get('button.bdt-caret').trigger('click')
    await flushPromises()
    expect(box(w, '901').checked).toBe(true)
    await row(w, '900').get('[data-testid="biz-dir-check"]').setValue(true)
    await flushPromises()
    expect(lastPick(w)).toEqual([{ id: '900', path: '股票数据' }])
    await w.setProps({ selected: ['900'] })
    expect(box(w, '901').checked).toBe(true)
    expect(box(w, '901').disabled).toBe(true)
    expect(row(w, '901').classes()).toContain('covered')
  })

  it('「清空」回传空列表，「完成」通知父级回到组列表', async () => {
    const w = await mountTree({ selected: ['900'] })
    await w.get('[data-testid="biz-dir-clear"]').trigger('click')
    expect(lastPick(w)).toEqual([])
    await w.get('[data-testid="biz-dir-fold"]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})
