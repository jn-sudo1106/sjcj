import { describe, expect, it } from 'vitest'
import { buildHorizontalLayout, buildSourceSeed, effectiveInputTable } from '@/views/FlowCanvas/canvas/flowModel'
// 0926 REVIEW F-R14：布局断言引用 impl 导出的同一组常量（flowModel.layout.ts），
// 实现调整时断言自动跟随，不再硬编码镜像的魔法数字。
import { LAYOUT_COL_GAP, LAYOUT_GAP, LAYOUT_NODE_H, LAYOUT_NODE_W } from '@/views/FlowCanvas/canvas/flowModel.layout'
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
    // 0925 起孤儿不再平铺进 main 尾：带显式 lastStep 的挂根步骤并到入口根下方作分支链，
    // 节点一个不少（main 与分支 chain 合计覆盖全部）
    expect(seed.main).toContain('1')
    const all = (seed: { main: string[]; branchGroups: { branches: { chain: string[] }[] }[] }) =>
      seed.main.filter((id) => /^\d+$/.test(id))
        .concat(seed.branchGroups.flatMap((g) => g.branches.flatMap((b) => b.chain)))
    expect(all(seed).sort()).toEqual(['1', '9'])
    expect(seed.branchGroups).toHaveLength(1)
    expect(seed.branchGroups[0].ownerId).toBe('1')
    expect(seed.branchGroups[0].branches.map((b) => b.chain)).toEqual([['9']])
    expect(Object.keys(seed.configs).sort()).toEqual(['1', '9'])
    // 0925：指向集合外的步骤标记为孤儿（画布带「孤儿·关联」徽标，可修复归属）
    expect(seed.orphanIds).toEqual(['9'])
  })

  it('分支链内再分叉：嵌套 subGroups 递归还原，链在该节点截断、子树整体归位', () => {
    const steps = [
      step('1', 'A', ['0']),        // 入口根（直链继续）
      step('2', 'B', ['1']),        // 分叉点：两儿子
      step('3', 'C', ['2']),        // 分支一：链头，自身又分叉
      step('4', 'D', ['2']),        // 分支二
      step('5', 'E', ['3']),        // 3 的分支一：链头（单后继链）
      step('6', 'F', ['3']),        // 3 的分支二
      step('7', 'G', ['5']),        // 5 的后续（链内继续）
    ]
    const seed = buildSourceSeed(SOURCE, steps)

    // 主链只走到 2（单后继），分叉点在 2
    expect(numeric(seed.main)).toEqual(['1', '2'])
    expect(seed.branchGroups).toHaveLength(1)
    const g2 = seed.branchGroups[0]
    expect(g2.ownerId).toBe('2')
    const b3 = g2.branches.find((b) => b.chain[0] === '3')
    const b4 = g2.branches.find((b) => b.chain[0] === '4')
    expect(b4?.chain).toEqual(['4'])
    // 3 的分叉不再摊平进 2 的 chain：链在 3 截断，subGroups 装着 3 自己的两支
    expect(b3?.chain).toEqual(['3'])
    expect(b3?.subGroups).toHaveLength(1)
    const g3 = b3!.subGroups![0]
    expect(g3.ownerId).toBe('3')
    expect(g3.branches.map((b) => b.chain)).toEqual([['5', '7'], ['6']])
    // 七个节点一个不少：main + 顶层分支 chain + 嵌套分支 chain
    const chains = seed.branchGroups.flatMap((g) => g.branches.flatMap((b) => [b.chain ?? [], ...(b.subGroups ?? []).flatMap((sg) => sg.branches.map((sb) => sb.chain))]))
    const allIds = [...numeric(seed.main), ...chains.flat()].sort()
    expect(allIds).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(Object.keys(seed.configs).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    // 全部分布式从 dependsOn 解析成功，无孤儿
    expect(seed.orphanIds).toEqual([])
  })

  it('嵌套分叉的子树里的孤儿同样带标记（2 的缺失使 3/4 成孤儿，5 仍挂在 3 下）', () => {
    const steps = [
      step('1', 'A', ['0']),
      step('3', 'C', ['99']),    // 父 99 不在集合内 → 孤儿
      step('4', 'D', ['99']),    // 同上
      step('5', 'E', ['3']),     // 父 3 在集合内 → 正常（随 3 的子树归位）
    ]
    const seed = buildSourceSeed(SOURCE, steps)
    // 顶层分叉点 = 入口根 1（虚拟根行不存在时，孤儿挂到主链最后一个可落库节点下方）
    expect(seed.branchGroups[0].ownerId).toBe('1')
    const chains = (g: typeof seed.branchGroups[number]): string[] =>
      g.branches.flatMap((b) => [...b.chain, ...(b.subGroups ?? []).flatMap((sg) => chains(sg))])
    expect(chains(seed.branchGroups[0]).sort()).toEqual(['3', '4', '5'])
    expect(seed.orphanIds.sort()).toEqual(['3', '4'])
  })

  it('没有子步骤时按源本身兜出一个起点节点（既有行为不变）', () => {
    const seed = buildSourceSeed(SOURCE, [])
    expect(seed.main).toContain(`source:${SOURCE.sourceId}`)
    expect(seed.branchGroups).toEqual([])
  })
})

// 2026-09-25：源视角（svg=true 虚拟起点 itemConfig=0 那一行 stepId='0'）下，「挂在根上」
// 的 lastStep='0' 曾一律被当成无父，全部步骤变成"根"，互相挤成一条直线；真正按多个步骤
// 实际 lastStep 构建时，它们都是虚拟起点行的直接子步骤（分叉点就是那行 0）。
describe('buildSourceSeed · 虚拟根（itemConfig=0）锚定（0925）', () => {
  const step = (stepId: string, name: string, dependsOn: string[]): Step =>
    ({ stepId, sourceId: '430016824', name, dependsOn, inputTable: '900', outputTable: '900', enabled: true }) as Step
  const wrapper = (): Step => step('0', '源名', [])

  it('920663 源视角形状：0 行 + 40597 挂根 → 40597 下分叉依然还原', () => {
    const steps = [wrapper(), step('40597', '1400935-详情', ['0']), step('40598', '1400935-详情', ['40597']), step('40620', '1400935-详情', ['40597'])]
    const seed = buildSourceSeed(SOURCE, steps)

    // 主链只走虚拟根 + 单后继 40597，分叉点落在 40597
    expect(seed.main).toContain('0')
    expect(numeric(seed.main)).toEqual(['0', '40597'])
    expect(seed.branchGroups).toHaveLength(1)
    expect(seed.branchGroups[0].ownerId).toBe('40597')
    expect(seed.branchGroups[0].branches.map((b) => b.chain)).toEqual([['40598'], ['40620']])
    // 虚拟根行自身也在画布上（configs 有 0），一个节点不少
    expect(Object.keys(seed.configs).sort()).toEqual(['0', '40597', '40598', '40620'])
  })

  it('多个挂根步骤是虚拟根下的分支，不再是挤成一条直线', () => {
    const steps = [
      wrapper(),
      step('40597', '分支一', ['0']),
      step('40206', '分支二', ['0']),
      step('40207', '分支二-子', ['40206']),
    ]
    const seed = buildSourceSeed(SOURCE, steps)

    expect(numeric(seed.main)).toEqual(['0'])
    expect(seed.branchGroups).toHaveLength(1)
    expect(seed.branchGroups[0].ownerId).toBe('0')
    expect(seed.branchGroups[0].branches.map((b) => b.chain)).toEqual([['40597'], ['40206', '40207']])
  })

  it('没有显式 lastStep 的步骤（mock/演示源）保持平铺，不编造拓扑', () => {
    const seed = buildSourceSeed(SOURCE, [
      { stepId: 's1', sourceId: 's1', name: '列表抓取', enabled: true } as Step,
      { stepId: 's2', sourceId: 's1', name: '详情解析', enabled: true } as Step,
    ])
    expect(seed.main).toEqual(['start', 's1', 's2', 'end'])
    expect(seed.branchGroups).toEqual([])
    // 没有任何一行带 dependsOn → 无 lastStep 语义，不标记孤儿（演示源不该满屏徽标）
    expect(seed.orphanIds).toEqual([])
  })
})

// 0925：孤儿步骤标记——响应有 lastStep 语义时，解析不出真实前置的步骤列为 orphanIds，
// 画布据此打「孤儿·关联」徽标。判定：无 lastStep / lastStep 指向集合外（0927 P1-7 拍板：
// '0' 挂根合法不标孤儿——lastStep='0' 是旧平台「挂在根上」语义，无 '0' 行时由多根兜底
// 按合法分支链渲染）。
describe('buildSourceSeed · 孤儿步骤判定（0925）', () => {
  const step = (stepId: string, name: string, dependsOn: string[]): Step =>
    ({ stepId, sourceId: '430016824', name, dependsOn, inputTable: '900', outputTable: '900', enabled: true }) as Step

  it('正常链条 + 挂根步骤：一个孤儿都没有', () => {
    const seed = buildSourceSeed(SOURCE, [
      step('0', '源名', []),
      step('1', 'A', ['0']),
      step('2', 'B', ['1']),
    ])
    expect(seed.orphanIds).toEqual([])
  })

  it('lastStep 缺失（行上根本没有 dependsOn）→ 孤儿', () => {
    const seed = buildSourceSeed(SOURCE, [
      step('0', '源名', []),
      step('1', 'A', ['0']),
      { stepId: '9', sourceId: '430016824', name: '无前置', inputTable: '900', enabled: true } as Step,
    ])
    expect(seed.orphanIds).toEqual(['9'])
  })

  it("lastStep='0' 但响应没有 0 行：'0' 挂根合法不标孤儿（0927 P1-7 口径）；指向集合外的才是孤儿；真实根行不标", () => {
    const seed = buildSourceSeed(SOURCE, [
      step('1', 'A', ['0']),
      step('9', '挂根', ['0']),
      step('8', '真孤儿', ['99999']),
      { ...step('2', '根', []), isRoot: true },
    ])
    // 0927 P1-7（口径拍板：'0' 挂根合法，不标孤儿）：'1' 是入口根（roots[0]），'9' 是第二个
    // 挂根步骤——两者都渲染为合法挂根链、不再标孤儿（此前 '9' 被标孤儿，与「多根兜底按
    // 合法分支链渲染」自相矛盾，用户按徽标会把正确归属搬走）；只有指向集合外的 '8' 才是
    // 真孤儿，保留「关联」徽标。
    expect(seed.orphanIds).toEqual(['8'])
    expect(seed.main).toContain('1')
  })

  it('只带一行有依据（sourceId=mainConfig、无 lastStep）的旧数据不标孤儿', () => {
    // 整批响应都没有 dependsOn：没有可参照的 lastStep 语义，按平铺处理（不编造、不标记）
    const seed = buildSourceSeed(SOURCE, [step('1', 'A', []), step('2', 'B', [])])
    expect(seed.orphanIds).toEqual([])
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

    // 0925 视觉重写后：两条 owner→链头 + 一条链内（2→4）+ 两条列尾收拢到 end = 5 条
    expect(layout.branchEdges).toHaveLength(5)
    expect(layout.nodes.filter((n) => n.branch).map((n) => n.id).sort()).toEqual(['2', '3', '4'])
  })

  it('直链流程不产生分支连线', () => {
    const seed = buildSourceSeed(SOURCE, [step('1', 'A', ['0']), step('2', 'B', ['1'])])
    const layout = buildHorizontalLayout(seed.main, seed.branches, seed.configs, seed.branchGroups)
    expect(layout.branchEdges).toEqual([])
  })

  it('0925 嵌套分叉：嵌套 subGroups 的 chain 排到下一行，双向连线都画出', () => {
    const seed = buildSourceSeed(SOURCE, [
      step('1', 'A', ['0']),
      step('2', 'B', ['1']),
      step('3', 'C', ['2']),
      step('4', 'D', ['2']),
      step('5', 'E', ['3']),
      step('6', 'F', ['3']),
    ])
    const layout = buildHorizontalLayout(seed.main, seed.branches, seed.configs, seed.branchGroups)
    // 六个节点全在（1/2 主链 + 3/4 第一行 + 5/6 嵌套第二行）
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
    // 0925 视觉重写：分支各占一列、链在列内向下堆叠（不再平铺到同一行、不再横穿兄弟列）
    const pos2 = layout.nodes.find((n) => n.id === '2')!.pos
    const pos3 = layout.nodes.find((n) => n.id === '3')!.pos
    const pos4 = layout.nodes.find((n) => n.id === '4')!.pos
    const pos5 = layout.nodes.find((n) => n.id === '5')!.pos
    const pos6 = layout.nodes.find((n) => n.id === '6')!.pos
    // 3/4 是 owner 2 的两列：同顶（2 底边 + GAP），4 在 3 右侧一整列之外
    expect(pos3.top).toBe(pos2.top + LAYOUT_NODE_H + LAYOUT_GAP)
    expect(pos4.top).toBe(pos3.top)
    expect(pos4.left).toBeGreaterThanOrEqual(pos3.left + LAYOUT_NODE_W + LAYOUT_COL_GAP)
    // 5/6 是 3 的嵌套两列：比 3 低一行，且以 3 的列中心对称展开
    expect(pos5.top).toBe(pos3.top + LAYOUT_NODE_H + LAYOUT_GAP)
    expect(pos6.top).toBe(pos5.top)
    expect(pos5.left + LAYOUT_NODE_W / 2 + pos6.left + LAYOUT_NODE_W / 2).toBe((pos3.left + LAYOUT_NODE_W / 2) * 2)
    // 嵌套列不得压到兄弟列 4
    expect(pos6.left + LAYOUT_NODE_W).toBeLessThanOrEqual(pos4.left)
    // 连线：owner 2→3/4 的分叉 + 3→5/6 的嵌套分叉 + 各列收拢线，共 8 条
    // （0926 REVIEW F-R12：原 `>= 4` 太宽松，收紧为精确值）
    expect(layout.branchEdges.length).toBe(8)
    // 嵌套列高度计入 totalHeight
    expect(layout.totalHeight).toBeGreaterThan(pos6.top + LAYOUT_NODE_H)
  })

  it('0925 嵌套分叉：effectiveInputTable 递归向上（嵌套链内无表 → 父链 → 主链）', () => {
    const seed = buildSourceSeed(SOURCE, [
      { ...step('1', 'A', ['0']), outputTable: 'TB_UP' },
      step('2', 'B', ['1']),
      step('3', 'C', ['2']),
      step('4', 'D', ['2']),
      step('5', 'E', ['3']),
      step('6', 'F', ['3']),
    ])
    // 摘掉 2/3/5 自己的入表（置空串 = 无显式表，nodeInputTable 按 || 判空）：
    // 5 在嵌套组里（链内无表）→ 上溯 3（仍无表）→ 2（仍无表）→ 主链 1
    for (const id of ['2', '3', '5']) {
      const collect = seed.configs[id].collectCfg
      if (collect) collect.inputTable = ''
    }
    // 1 的输出表 TB_UP 是唯一可继承来源（4/6 的输出表也是默认 900，但不在 5 的祖先链上）
    expect(effectiveInputTable(seed.main, seed.branches, seed.configs, '5', seed.branchGroups)).toBe('TB_UP')
    expect(effectiveInputTable(seed.main, seed.branches, seed.configs, '3', seed.branchGroups)).toBe('TB_UP')
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

// 2026-09-05：「列表页 / 详情页」判据定案 —— 是旧 isMulti，不是"是不是第一个节点"。
// 后端自己的 list/detail 就是从 isMulti 派生的（抽 10 条配置逐个对照，10/10 吻合）：
//   isMulti=1 → list=true, detail=false（列表类）
//   isMulti=2 → list=false, detail=false（非列表类）
// 之前按位置猜，对 isMulti=2 的起点是错的：流程 1400979 的根被画成「列表页」，实际非列表类。
describe('列表/详情按 isMulti 判（不是按位置猜）', () => {
  const SRC = { sourceId: 's1', name: 'x', url: 'http://x.test/', configId: 'c1', mainTable: '900', owner: 'a', state: 'C' } as Source
  const step = (stepId: string, name: string, multiMode?: number): Step =>
    ({ stepId, sourceId: '-1', name, dependsOn: ['0'], inputTable: '900', outputTable: '900', enabled: true, multiMode }) as Step

  it('isMulti=2 的第一个节点是非列表类，不能因为"排第一"就当成列表页', () => {
    const seed = buildSourceSeed(SRC, [step('41383', '纽约市政府市长办公室新闻处_copy', 2)])
    expect(seed.configs['41383'].collectCfg?.webKind).toBe('detail')
    expect(seed.configs['41383'].collectCfg?.isDetail).toBe(true)
  })

  it('isMulti=1 的节点是列表类，哪怕它不排第一', () => {
    const seed = buildSourceSeed(SRC, [step('40215', '起点', 2), step('40216', '列表解析', 1)])
    expect(seed.configs['40216'].collectCfg?.webKind).toBe('list')
    expect(seed.configs['40216'].collectCfg?.isDetail).toBe(false)
  })

  it('拿不到 isMulti 时（configDetail 还没回填）才退回按位置猜', () => {
    const seed = buildSourceSeed(SRC, [step('40217', '某节点', undefined)])
    expect(seed.configs['40217'].collectCfg?.webKind).toBe('list')
  })
})
