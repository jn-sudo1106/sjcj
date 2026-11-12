/**
 * 「下一步字段」——一条数据往下一个节点走时，真正会被用到的那些列。
 *
 * 0831 会议 F10：结果表动辄三四十列，人打开数据视图第一眼要看的是"这条能不能往下走"，
 * 而不是把每个字段都扫一遍。会上原话是"下一步需要什么字段就展示什么字段"。
 *
 * 取三处的并集（都是**已有**配置，本函数不引入新的配置项）：
 *   ① 后继节点的**进入条件**引用的列 —— 决定这行能不能进下一个节点
 *   ② 后继节点的 `taskCfg.contextMap`（上下文来源）—— 下一个节点真正读走的列
 *   ③ 当前节点的 `taskCfg.outColumns`（出参列）—— 当前节点声明要往下传的列
 *
 * 三种来源存的东西不是一个口径，必须都认：
 *   - `outColumns` 存 **prop**（itemCode，如 `title`），见 ParamsTab.vue:35
 *   - `contextMap` 存 **columnName**（物理列，如 `K1`），见 TaskTab.vue:97-100
 *   - `entryCondition.items[].field` 两种都可能——ConditionRow.vue:62-69 会在表字段到位后
 *     把 columnName 重映射成 prop，但**没到位就保存过**的旧数据里留的是 columnName
 *
 * 所以解析一律走 prop ↔ columnName 双向查表，认不出来的 token 直接丢掉（宁可少显示几列，
 * 也不要把一个不存在的列塞进预设里）。
 */
import {
  directSuccessorIds,
  nodeEntryCondition,
  type ConditionGroup,
  type FlowBranchGroup,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'

/** 表格列的最小形状：与 DataGrid 的 `cols` 一致（prop 是键，columnName 是物理列） */
export interface ColumnLike {
  prop: string
  columnName?: string
}

export interface NextStepColumnsInput {
  /** 当前展示表的全部列，返回值按这个数组的原始顺序排 */
  columns: ColumnLike[]
  main: string[]
  configs: Record<string, NodeConfig>
  branchGroups?: FlowBranchGroup[]
  nodeId: string
}

/** 进入条件里引用到的列。结构化模式取 items[].field，表达式模式退回正则扫 K 列。 */
function conditionTokens(group: ConditionGroup | undefined): string[] {
  if (!group) return []
  if (group.mode === 'expr') {
    // 表达式是自由文本，只能靠形状认物理列；`K12` 这种字面量误伤的代价是多显示一列，可接受
    return group.expr?.match(/\bK\d+\b/g) ?? []
  }
  return (group.items ?? []).map((item) => item.field).filter(Boolean)
}

/** 下一步会用到的字段 token（物理列或 prop，未对当前表做换算）。任务视图只展示清单，不需要表 meta。 */
export function nextStepTokens(input: Omit<NextStepColumnsInput, 'columns'>): string[] {
  const { main, configs, branchGroups = [], nodeId } = input
  if (!nodeId) return []
  const successors = directSuccessorIds(main, configs, nodeId, branchGroups)
    .map((id) => configs[id])
    .filter((cfg): cfg is NodeConfig => !!cfg)
  if (!successors.length) return []
  const tokens = new Set<string>()
  for (const cfg of successors) {
    for (const token of conditionTokens(nodeEntryCondition(cfg))) tokens.add(token)
    for (const token of cfg.taskCfg?.contextMap ?? []) tokens.add(token)
  }
  for (const token of configs[nodeId]?.taskCfg?.outColumns ?? []) tokens.add(token)
  return [...tokens]
}

/**
 * 计算当前节点在数据视图里应当默认展示的列（返回 prop 列表，按 `columns` 原序）。
 *
 * 返回空数组有两种情况，调用方都应当**退回全部列**而不是显示空表：
 *   - 没有后继（末节点）
 *   - 后继有，但三处配置都没填（现网大量源属于这种）
 */
export function nextStepColumns(input: NextStepColumnsInput): string[] {
  const { columns, nodeId } = input
  if (!nodeId || !columns.length) return []
  const tokens = nextStepTokens(input)
  if (!tokens.length) return []

  const byProp = new Map(columns.map((c) => [c.prop, c.prop]))
  const byColumn = new Map(
    columns.filter((c) => c.columnName).map((c) => [c.columnName as string, c.prop]),
  )
  const wanted = new Set<string>()
  for (const token of tokens) {
    const prop = byProp.get(token) ?? byColumn.get(token)
    if (prop) wanted.add(prop)
  }
  return columns.map((c) => c.prop).filter((prop) => wanted.has(prop))
}
