import { describe, expect, it } from 'vitest'
import { buildHorizontalLayout, buildSourceSeed } from '@/views/FlowCanvas/canvas/flowModel'
import type { Source, Step } from '@/api'

// 0903 YB-B：按 dependsOn（旧 lastStep）还原真实拓扑。
// 在此之前这里把子步骤一律推进 main、branchGroups 恒为空，有分支的历史流程被画成直线，
// 自动保存再据此重算 lastStep 就会把分支静默拍平（真实源 920663 命中，见 YB-A）。
const SOURCE = {
  sourceId: '430016824', name: '明阳科技-公司新闻-企业动态', url: 'http://www.mykj-sz.com/article_qydt.html',
  configId: '1400935', mainTable: '900', owner: 'a', state: 'C',
} as Source

const step = (stepId: string, name: string, dependsOn: string[]): Step =>
  ({ stepId, sourceId: '430016824', name, dependsOn, inputTable: '900', outputTable: '900', enabled: true }) as Step

const numeric = (main: string[]) => main.filter((id) => /^\d+$/.test(id))

describe('buildSourceSeed · 分支拓扑还原（0903 YB-B）', () => {
  it('920663 真实形状：主链走到分叉点为止，两支各成 chain', () => {
    const steps = [
      step('40597', '1400935-详情', ['0']),
      step('40598', '1400935-详情', ['40597']),
      step('40620', '1400935-详情', ['40597']),
    ]
    const seed = buildSourceSeed(SOURCE, steps)

    expect(numeric(seed.main)).toEqual(['40597'])
    expect(seed.branchGroups).toHaveLength(1)
    // owner 是分叉点那个**普通采集节点**本身，不合成决策节点
    expect(seed.branchGroups[0].ownerId).toBe('40597')
    expect(seed.branchGroups[0].branches.map((b) => b.chain)).toEqual([['40598'], ['40620']])
    // 配置里三个节点都在（chain 内节点仍归 configs 所有）
    expect(Object.keys(seed.configs).sort()).toEqual(['40597', '40598', '40620'])
  })

  it('分支上不复制 condition：条件的真值只有一份，在目标步骤自己的 entryCondition 上', () => {
    const withCond = [
      step('40597', 'A', ['0']),
      { ...step('40598', 'B', ['40597']), condition: "_from == 'api'" },
      { ...step('40620', 'C', ['40597']), condition: 'K24=="正文抓取失败"' },
    ]
    const seed = buildSourceSeed(SOURCE, withCond)

    expect(seed.branchGroups[0].branches.every((b) => b.condition === undefined)).toBe(true)
    expect(seed.configs['40620'].collectCfg?.entryCondition?.expr).toBe('K24=="正文抓取失败"')
  })

  it('直链流程照旧全在 main 上，不产生分支分组', () => {
    const steps = [
      step('1', 'A', ['0']),
      step('2', 'B', ['1']),
      step('3', 'C', ['2']),
    ]
    const seed = buildSourceSeed(SOURCE, steps)
    expect(numeric(seed.main)).toEqual(['1', '2', '3'])
    expect(seed.branchGroups).toEqual([])
  })

  it('分支链有多个节点时按 dependsOn 串下去', () => {
    const steps = [
      step('1', 'A', ['0']),
      step('2', 'B', ['1']),
      step('3', 'C', ['1']),
      step('4', 'D', ['2']),
    ]
    const seed = buildSourceSeed(SOURCE, steps)
    expect(numeric(seed.main)).toEqual(['1'])
    expect(seed.branchGroups[0].branches.map((b) => b.chain)).toEqual([['2', '4'], ['3']])
  })

  it('dependsOn 指向集合外步骤的孤儿不会消失——画得不准可以接受，节点凭空少了不行', () => {
    const steps = [
      step('1', 'A', ['0']),
      step('9', '孤儿', ['99999']),
    ]
    const seed = buildSourceSeed(SOURCE, steps)
    expect(numeric(seed.main)).toContain('9')
    expect(Object.keys(seed.configs)).toContain('9')
  })

  it('没有子步骤时按源本身兜出一个起点节点（既有行为不变）', () => {
    const seed = buildSourceSeed(SOURCE, [])
    expect(seed.main).toContain(`source:${SOURCE.sourceId}`)
    expect(seed.branchGroups).toEqual([])
  })
})

// 0903 YB-7：chain 里的节点此前只被摆到 owner 下面那一行、**没有任何连线**，
// 三个盒子悬在那里看不出谁接谁。分支还原后这个缺口更明显，补上 owner→链头、链内相邻两类连线。
describe('buildHorizontalLayout · 分支连线（0903 YB-7）', () => {
  it('分叉后画出 owner→各链头的连线；链内相邻节点也连起来', () => {
    const steps = [
      step('1', 'A', ['0']),
      step('2', 'B', ['1']),
      step('3', 'C', ['1']),
      step('4', 'D', ['2']),
    ]
    const seed = buildSourceSeed(SOURCE, steps)
    const layout = buildHorizontalLayout(seed.main, seed.branches, seed.configs, seed.branchGroups)

    // 两条 owner→链头 + 一条链内（2→4）= 3 条
    expect(layout.branchEdges).toHaveLength(3)
    expect(layout.nodes.filter((n) => n.branch).map((n) => n.id).sort()).toEqual(['2', '3', '4'])
  })

  it('直链流程不产生分支连线', () => {
    const seed = buildSourceSeed(SOURCE, [step('1', 'A', ['0']), step('2', 'B', ['1'])])
    const layout = buildHorizontalLayout(seed.main, seed.branches, seed.configs, seed.branchGroups)
    expect(layout.branchEdges).toEqual([])
  })
})

// 2026-09-04：流程视图（FlowDetailDrawer）的节点数跟旧平台拓扑图对不上。
// 真实样本流程 1400760「境外浏览器下载源码」：旧平台画 6 个节点 / 6 条连线，
// 而 nextConfigPaged 不带 svg 返回 **13 条**——多出来的 40206~40213 是同一条链
// 早先那一代的遗留（名字都还叫「1400667-详情」「翻译」「时间处理」），旧平台不画。
// 带 svg=true 后端只回 6 条（根 + 5 步），跟旧平台完全一致。
// 修复即 flowCenterApi.steps() 补 svg=true + 有真根就不再合成假根。
describe('流程视图拓扑与旧平台对齐（真实流程 1400760）', () => {
  const FLOW_STUB = { sourceId: '', name: '境外浏览器下载源码', url: '', configId: '1400760', mainTable: '6200023', owner: '', state: 'C' } as Source
  // nextConfigPaged?flowId=1400760&svg=true 的真实返回（已按 stepFromLegacy 映射）
  const svgSteps: Step[] = [
    { stepId: '41227', sourceId: '', name: '境外浏览器下载源码', isRoot: true, outputTable: '6200023', configId: '1400760', enabled: true },
    { stepId: '40216', sourceId: '-1', name: '列表解析', dependsOn: ['41227'], inputTable: '6200023', outputTable: '2100249', configId: '1400762', enabled: true },
    { stepId: '40217', sourceId: '-1', name: '详情源码下载', dependsOn: ['40216'], inputTable: '2100249', outputTable: '2100249', configId: '1400761', enabled: true },
    { stepId: '40218', sourceId: '-1', name: '详情解析', dependsOn: ['40217'], inputTable: '2100249', outputTable: '2100249', configId: '1400763', enabled: true },
    { stepId: '40219', sourceId: '-1', name: '翻译机', dependsOn: ['40218'], inputTable: '2100249', outputTable: '2100249', configId: '1400569', enabled: true },
    { stepId: '40220', sourceId: '-1', name: '时间处理函数', dependsOn: ['40219'], inputTable: '2100249', outputTable: '2100249', configId: '1400742', enabled: true },
  ] as Step[]

  it('svg 返回的 6 条 → 一条直链，节点数与顺序跟旧平台一致，且根节点用后端真实行', () => {
    const seed = buildSourceSeed(FLOW_STUB, svgSteps)

    expect(numeric(seed.main)).toEqual(['41227', '40216', '40217', '40218', '40219', '40220'])
    expect(seed.branchGroups).toHaveLength(0) // 旧平台也是 6 节点 6 连线的直链，没有分叉
    // 根节点是后端真实行：id 是 itemConfig 而不是合成的 'source:'，名字是流程名而不是硬编码「列表抓取」
    expect(seed.configs['41227'].title).toBe('境外浏览器下载源码')
    expect(seed.main).not.toContain('source:')
  })

  it('不带 svg 的 13 条会把旧平台不画的遗留步骤也画出来（修复前的形态）', () => {
    // 只取遗留那一代的前 3 条即可说明问题：它们挂在 lastStep='0' 和彼此身上，
    // 跟当前这代 40216~40220 并存，混在一起画出来的图旧平台从来没有过。
    const legacy: Step[] = [
      { stepId: '40206', sourceId: '-1', name: '1400667-详情', dependsOn: ['0'], inputTable: '6200023', outputTable: '2100249', configId: '1400650', enabled: true },
      { stepId: '40207', sourceId: '-1', name: '1400667-详情', dependsOn: ['40206'], inputTable: '2100249', outputTable: '2100249', configId: '1400688', enabled: true },
      { stepId: '40211', sourceId: '-1', name: '列表解析', dependsOn: ['0'], inputTable: '6200023', outputTable: '2100249', configId: '1400650', enabled: true },
    ] as Step[]
    const seed = buildSourceSeed(FLOW_STUB, [...legacy, ...svgSteps.slice(1)])

    // 8 个节点，远多于旧平台的 5 个子步骤——这正是修复前流程视图的样子
    expect(numeric(seed.main).length + seed.branchGroups.reduce((n, g) => n + g.branches.reduce((m, b) => m + b.chain.length, 0), 0)).toBe(8)
  })
})
