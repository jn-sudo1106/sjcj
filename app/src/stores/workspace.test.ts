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

  it('renameTab：只改页签名，不切换活动页签、不新建', () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    expect(ws.activeSourceId).toBe('s2')
    ws.renameTab('s1', '源一改名')
    expect(ws.tabs.find((t) => t.sourceId === 's1')?.name).toBe('源一改名')
    expect(ws.activeSourceId).toBe('s2')
    expect(ws.tabs.length).toBe(2)
    ws.renameTab('missing', '不存在')
    expect(ws.tabs.length).toBe(2)
  })

  it('deactivate：让出活动页签，之前的页签不再被判定为已激活', () => {
    ws.open('s1', '源一')
    expect(ws.activeSourceId).toBe('s1')
    ws.deactivate()
    expect(ws.activeSourceId).toBe('')
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

  it('saveSnapshot：文件视图（0711 R11）同样可记忆恢复', () => {
    ws.open('s1', '源一')
    ws.saveSnapshot('s1', { view: 'file' })
    expect(ws.snapshotOf('s1')?.view).toBe('file')
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

describe('workspace 分屏对比（0710 会议 B4：与页签解耦，左右均为真实 sourceId）', () => {
  let ws: ReturnType<typeof useWorkspaceStore>
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    ws = useWorkspaceStore()
  })

  it('enterCompare：左右为不同真实源即可，不要求已打开页签；site: 伪 id 被拒', () => {
    expect(ws.enterCompare('s2')).toBe(false) // 尚无左栏
    expect(ws.enterCompare('s2', 's2')).toBe(false) // 不能对比自己
    expect(ws.enterCompare('s2', 'site:a')).toBe(false) // 网站伪 id 不参与对比
    expect(ws.enterCompare('site:a', 's1')).toBe(false)
    expect(ws.compareSourceId).toBe('')
    expect(ws.enterCompare('s2', 's1')).toBe(true) // s1/s2 均未开页签，跨站直接按 id 对比
    expect(ws.compareLeftId).toBe('s1')
    expect(ws.compareSourceId).toBe('s2')
    // 对比中只换右栏：缺省沿用现有左栏
    expect(ws.enterCompare('s3')).toBe(true)
    expect(ws.compareLeftId).toBe('s1')
    expect(ws.compareSourceId).toBe('s3')
  })

  it('exitCompare：左右栏一并清空', () => {
    ws.enterCompare('s2', 's1')
    ws.exitCompare()
    expect(ws.compareSourceId).toBe('')
    expect(ws.compareLeftId).toBe('')
  })

  it('close：关闭活动页签退出对比；关闭非活动页签不影响对比态', () => {
    ws.open('site:a', '站A')
    ws.open('draft-1', '草稿源') // 活动页签
    ws.enterCompare('s2', 's1')
    ws.close('site:a') // 非活动
    expect(ws.compareSourceId).toBe('s2')
    ws.close('draft-1') // 活动页签关闭 = 离开对比上下文
    expect(ws.compareSourceId).toBe('')
    expect(ws.compareLeftId).toBe('')
  })
})
