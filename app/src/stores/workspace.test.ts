// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorkspaceStore, MAX_SOURCE_TABS } from './workspace'

describe('workspace 源详情多页签（优化 0701 问题三）', () => {
  let ws: ReturnType<typeof useWorkspaceStore>
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    ws = useWorkspaceStore()
  })

  it('open：新开并激活，重复打开去重只激活', () => {
    expect(ws.open('s1', '源一')).toBe(true)
    expect(ws.open('s2', '源二')).toBe(true)
    expect(ws.tabs.length).toBe(2)
    expect(ws.activeSourceId).toBe('s2')
    expect(ws.open('s1', '源一')).toBe(true)
    expect(ws.tabs.length).toBe(2)
    expect(ws.activeSourceId).toBe('s1')
  })

  it(`open：超出上限 ${MAX_SOURCE_TABS} 个返回 false`, () => {
    for (let i = 0; i < MAX_SOURCE_TABS; i++) expect(ws.open(`s${i}`, `源${i}`)).toBe(true)
    expect(ws.open('overflow', '超限源')).toBe(false)
    expect(ws.tabs.length).toBe(MAX_SOURCE_TABS)
  })

  it('close：关闭活动页签激活右邻，无右邻激活左邻，关完为空', () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    ws.open('s3', '源三')
    ws.activate('s2')
    expect(ws.close('s2')).toBe('s3') // 右邻
    expect(ws.close('s3')).toBe('s1') // 无右邻 → 左邻
    expect(ws.close('s1')).toBe('') // 关完
    expect(ws.tabs.length).toBe(0)
  })

  it('close：关闭非活动页签不改变活动页签', () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    expect(ws.close('s1')).toBe('s2')
    expect(ws.activeSourceId).toBe('s2')
  })

  it('saveSnapshot：任务视图（0706 Phase4）与流程/数据同样可记忆恢复', () => {
    ws.open('s1', '源一')
    ws.saveSnapshot('s1', { view: 'task' })
    expect(ws.snapshotOf('s1')?.view).toBe('task')
  })

  it('saveSnapshot 合并保存，close 后清理快照', () => {
    ws.open('s1', '源一')
    ws.saveSnapshot('s1', { view: 'data', page: 3 })
    ws.saveSnapshot('s1', { selectedNodeId: 'n2' })
    expect(ws.snapshotOf('s1')).toEqual({ view: 'data', page: 3, selectedNodeId: 'n2' })
    // 未打开的源不落快照
    ws.saveSnapshot('ghost', { page: 9 })
    expect(ws.snapshotOf('ghost')).toBeUndefined()
    ws.close('s1')
    expect(ws.snapshotOf('s1')).toBeUndefined()
  })

  it('sessionStorage 持久化：新 pinia 实例恢复页签与快照', async () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    ws.saveSnapshot('s2', { view: 'data', page: 2 })
    // 持久化写入节流为 300ms，等过防抖窗口再读
    await new Promise((r) => setTimeout(r, 350))
    setActivePinia(createPinia())
    const ws2 = useWorkspaceStore()
    expect(ws2.tabs.map((t) => t.sourceId)).toEqual(['s1', 's2'])
    expect(ws2.activeSourceId).toBe('s2')
    expect(ws2.snapshotOf('s2')).toEqual({ view: 'data', page: 2 })
  })
})

describe('workspace 分屏对比（优化 0701 问题三 · 方案 C）', () => {
  let ws: ReturnType<typeof useWorkspaceStore>
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    ws = useWorkspaceStore()
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    ws.open('s3', '源三')
    ws.activate('s1')
  })

  it('enterCompare：与活动页签不同且已打开才成功', () => {
    expect(ws.enterCompare('s1')).toBe(false) // 不能对比自己
    expect(ws.enterCompare('ghost')).toBe(false) // 未打开的源
    expect(ws.compareSourceId).toBe('')
    expect(ws.enterCompare('s2')).toBe(true)
    expect(ws.compareSourceId).toBe('s2')
  })

  it('exitCompare：清空对比态', () => {
    ws.enterCompare('s2')
    ws.exitCompare()
    expect(ws.compareSourceId).toBe('')
  })

  it('close：关闭右栏源自动退出对比', () => {
    ws.enterCompare('s2')
    ws.close('s2')
    expect(ws.compareSourceId).toBe('')
  })

  it('close：关闭活动页签导致左右栏重合时自动退出对比', () => {
    ws.enterCompare('s2')
    // 关闭活动页签 s1 → 按"右邻优先"策略下一个活动应为 s2，与对比目标重合，需退出对比
    ws.close('s1')
    expect(ws.activeSourceId).toBe('s2')
    expect(ws.compareSourceId).toBe('')
  })

  it('close：关闭与对比无关的页签不影响对比态', () => {
    ws.enterCompare('s2')
    ws.close('s3')
    expect(ws.compareSourceId).toBe('s2')
  })
})
