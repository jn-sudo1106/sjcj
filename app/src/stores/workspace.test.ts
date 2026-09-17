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
    // 新页签插最前（2026-09-17），所以此刻顺序是 s3 · s2 · s1
    expect(ws.tabs.map((t) => t.sourceId)).toEqual(['s3', 's2', 's1'])
    ws.activate('s2')
    // 返回接任页签的引用而不是 sourceId：混排之后右邻可能是网站页签（2026-09-17）
    expect(ws.close('s2')).toEqual({ kind: 'source', id: 's1' }) // 右邻
    expect(ws.close('s1')).toEqual({ kind: 'source', id: 's3' }) // 无右邻 → 左邻
    expect(ws.close('s3')).toBeNull() // 关完
    expect(ws.tabs.length).toBe(0)
  })

  // 2026-09-17 走查：页签条从左往右读，新开的排最左一打开就在眼前；
  // 追加到末尾的话页签一多就落在横向滚动区外，还得滚过去找。
  it('open：新页签插在最前，不是追加到末尾', () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    ws.open('s3', '源三')
    expect(ws.tabs.map((t) => t.sourceId)).toEqual(['s3', 's2', 's1'])
    // 重复打开已有页签只激活，不改变它的位置
    ws.open('s1', '源一')
    expect(ws.tabs.map((t) => t.sourceId)).toEqual(['s3', 's2', 's1'])
    expect(ws.activeSourceId).toBe('s1')
  })

  // 下标是**混排后**（orderedTabs）的，store 落位后重写整条 seq
  it('moveTab：拖动调整顺序，越界忽略，不改变活动页签', () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    ws.open('s3', '源三') // s3 · s2 · s1
    ws.activate('s2')

    ws.moveTab(0, 2) // 把 s3 拖到最后
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['s2', 's1', 's3'])
    ws.moveTab(2, 0) // 再拖回最前
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['s3', 's2', 's1'])

    // 拖动不等于切换：活动页签始终没变
    expect(ws.activeSourceId).toBe('s2')

    // 越界 / 原地不动都安全
    ws.moveTab(1, 1)
    ws.moveTab(-1, 0)
    ws.moveTab(0, 99)
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['s3', 's2', 's1'])
  })

  // 2026-09-17：网站页签与源页签排在同一条序列里，后打开的在左；
  // 关掉一个就落到它右边那个，哪怕右边是另一类页签。
  it('orderedTabs：两类页签按打开先后混排，新的在左', () => {
    ws.open('s1', '源一')
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.open('s2', '源二')

    expect(ws.orderedTabs.map((t) => `${t.kind}:${t.id}`)).toEqual(['source:s2', 'site:site-1', 'source:s1'])
    // 关掉最左的源页签 → 右邻是网站页签
    expect(ws.close('s2')).toEqual({ kind: 'site', id: 'site-1' })
    // 关掉网站页签 → 右邻是剩下那个源页签
    expect(ws.closeSiteTab('site-1')).toEqual({ kind: 'source', id: 's1' })
    expect(ws.closeSiteTab('site-1')).toBeNull() // 已经不在了
  })

  it('moveTab 拖过网站页签也成立，拖完再开新页签仍排最左', () => {
    ws.open('s1', '源一')
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.open('s2', '源二') // s2 · site-1 · s1

    ws.moveTab(0, 2) // 把 s2 拖到最后
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['site-1', 's1', 's2'])
    ws.open('s3', '源三')
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['s3', 'site-1', 's1', 's2'])
  })

  it('close：关闭非活动页签不改变活动页签', () => {
    ws.open('s1', '源一')
    ws.open('s2', '源二')
    expect(ws.close('s1')).toEqual({ kind: 'source', id: 's2' })
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
    expect(ws2.tabs.map((t) => t.sourceId)).toEqual(['s2', 's1']) // 新页签插最前
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

// 0915-02：网站页签（页签条上的「全部 · 网站名」），可多个、可关闭、与源页签共用 8 个额度
describe('网站页签', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('ensureSiteTab 幂等：同一网站只往"更好的名字"方向更新', () => {
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-1')
    expect(ws.siteTabs).toEqual([expect.objectContaining({ siteId: 'site-1', name: 'site-1' })])

    ws.ensureSiteTab('site-1', '新浪财经')
    expect(ws.siteTabs[0].name).toBe('新浪财经')
    // 深链只拿得到 siteId 时不能把真名盖回去
    ws.ensureSiteTab('site-1')
    expect(ws.siteTabs[0].name).toBe('新浪财经')
  })

  it('多个网站各自成页签、各自留快照，互不覆盖', () => {
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.saveSiteSnapshot('site-1', { view: 'data' })
    ws.ensureSiteTab('site-2', '天天基金')
    ws.saveSiteSnapshot('site-2', { view: 'monitor' })

    // 新开的排最左（与源页签同一个方向，2026-09-17 改；原来这里是 push 到组尾）
    expect(ws.siteTabs.map((t) => t.name)).toEqual(['天天基金', '新浪财经'])
    // 关键回归：开了第二个网站不能把第一个的快照冲掉（跨网站开源页签时会踩到）
    expect(ws.siteSnapshotOf('site-1')).toEqual({ view: 'data' })
    expect(ws.siteSnapshotOf('site-2')).toEqual({ view: 'monitor' })
  })

  it('关闭网站页签会连同它的快照一起丢掉', () => {
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.saveSiteSnapshot('site-1', { view: 'data' })
    ws.closeSiteTab('site-1')
    expect(ws.siteTabs).toEqual([])
    expect(ws.siteSnapshotOf('site-1')).toBeUndefined()
  })

  it('与源页签共用 8 个额度：满了以后网站页签静默不建、源页签也开不进来', () => {
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.ensureSiteTab('site-2', '天天基金')
    for (let i = 0; i < 6; i += 1) expect(ws.open(`s${i}`, `源 ${i}`)).toBe(true)
    expect(ws.tabs.length + ws.siteTabs.length).toBe(8)

    // 再开第 9 个：源页签返回 false（调用方负责提示），网站页签静默 false
    expect(ws.open('s6', '源 6')).toBe(false)
    expect(ws.ensureSiteTab('site-3', '第三个网站')).toBe(false)
    expect(ws.siteTabs).toHaveLength(2)

    // 腾出位置后就能建
    ws.close('s0')
    expect(ws.ensureSiteTab('site-3', '第三个网站')).toBe(true)
  })

  it('saveSiteSnapshot 只认页签条上真实存在的网站', () => {
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.saveSiteSnapshot('site-other', { view: 'file' })
    expect(ws.siteSnapshotOf('site-other')).toBeUndefined()
  })

  it('网站页签随 sessionStorage 恢复', async () => {
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.saveSiteSnapshot('site-1', { view: 'monitor' })
    await new Promise((resolve) => setTimeout(resolve, 400))

    setActivePinia(createPinia())
    const next = useWorkspaceStore()
    expect(next.siteTabs).toEqual([expect.objectContaining({ siteId: 'site-1', name: '新浪财经' })])
    expect(next.siteSnapshotOf('site-1')).toEqual({ view: 'monitor' })
  })

  it('读得懂没有网站页签字段的老存档（升级前存的），不能整份丢弃', () => {
    sessionStorage.setItem('rc-source-tabs', JSON.stringify({
      tabs: [{ sourceId: 's1', name: '源一' }],
      activeSourceId: 's1',
      snapshots: { s1: { view: 'data' } },
    }))
    setActivePinia(createPinia())
    const ws = useWorkspaceStore()
    // 老存档没有 seq，不能因此丢弃或报错——orderedTabs 按 0 处理
    expect(ws.tabs).toEqual([{ sourceId: 's1', name: '源一' }])
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['s1'])
    expect(ws.activeSourceId).toBe('s1')
    expect(ws.siteTabs).toEqual([])
  })
})
