// ck_source 监控源配置同步（C01 /api/v1/source/check/*，2026-11-13 切新接口）：
// 数据监控节点保存时按当前流程的 sourceId 查 ck_source（GET /api/source/list，只读沿用旧接口），
// 认领「绑定到本节点」的那条（check_conf.binding.nodeKey，C12 前端半），无则新增
//（POST /api/v1/source/check/add）、有则按主键更新（POST /api/v1/source/check/update，带 ver
// 乐观锁）。NodeInspector 底部「保存」（编排配置 Tab）与 RuleOrchestrationTab「保存脚本」两条保存
// 路径共用，抽在这里保证 payload 口径一致。
import { ckSourceApi, entryApi } from '@/api'
import { addSourceCheck, updateSourceCheck } from '@/api/monitor'
import type { MonitorCheckBinding, MonitorScopeType } from '@/api/types/monitorCenter'
import {
  makeDefaultRuleOrchestration,
  type CollectorSchedule,
  type MonitorAlertConfig,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import type { CkSourcePayload, CkSourceRecord, RuleOrchestration } from '@/api'
import { nodeScheduleCron } from './scheduleCron'
import { isWritableStepId } from './stepPersist'

/**
 * 一个源在 ck_source 里有多条记录时，画布同步必须停手（2026-11-12 最小保护）。
 *
 * 监控中心的模型是「一源多检查项、各自独立记录」，而画布节点只有一个 sourceId、没有绑定
 * 到具体某个检查项（C12 显式绑定尚未落地）。**单条**记录时按主键更新（带 ver 乐观锁），
 * 这是唯一能确定「改哪一条」的情况；多条时无法从画布侧判断用户想改哪条，因此这里不猜、
 * 直接拒绝，由用户到监控中心按记录（monitorId）编辑。
 */
export class MultipleCkSourceRowsError extends Error {
  /** 冲突的源 ID（调用方直接展示用，message 里也带了一份） */
  readonly sourceId: string
  /** 冲突的 ck_source 行；UI 用它列出「是哪几条」 */
  readonly rows: CkSourceRecord[]

  constructor(sourceId: string, rows: CkSourceRecord[]) {
    super(`该源在监控记录里已有 ${rows.length} 条检查项，画布保存不再按源覆盖；请到监控中心按检查项编辑（sourceId=${sourceId}）`)
    this.name = 'MultipleCkSourceRowsError'
    this.sourceId = sourceId
    this.rows = rows
  }

  get count(): number {
    return this.rows.length
  }
}

/**
 * 把冲突的 ck_source 行整理成逐条清单，供保存失败的提示直接展示：
 * `检查项A｜id=7｜表=sense_data.TB_X｜已启用｜更新 2026-09-18 10:00`
 *
 * 字段口径（见 api/types/rule.ts 的 CkSourceRecord）：name 为空写「未命名检查项」；tableName
 * 为空省略「表=…」；启停看 `isDelete`（0 = 在用、1 = 停用，语义是反的），**不要用 `state`**——
 * `state` 是最近一次执行结果（C 完成 / E 异常 / D 停用 / L 运行中），拿它判断启停会把异常的措施显示成「已启用」；
 * updateDt 是后端 LocalDateTime 的 ISO 串，这里转成 `YYYY-MM-DD HH:mm` 展示，缺省时省略该段。
 */
export function describeCkSourceConflictRows(rows: CkSourceRecord[]): string[] {
  return rows.map((row) => {
    const parts = [row.name?.trim() || '未命名检查项']
    parts.push(`id=${row.id}`)
    const tableName = row.tableName?.trim()
    if (tableName) parts.push(`表=${tableName}`)
    parts.push(Number(row.isDelete) === 0 ? '在用' : '已停用')
    const updatedAt = formatConflictUpdateDt(row.updateDt)
    if (updatedAt) parts.push(`更新 ${updatedAt}`)
    return parts.join('｜')
  })
}

/** ck_source.UPDATE_DT（ISO-8601 本地时间）→ `YYYY-MM-DD HH:mm`；格式不认得时原样展示。 */
function formatConflictUpdateDt(value: string | undefined): string {
  const raw = value?.trim()
  if (!raw) return ''
  const matched = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(raw)
  return matched ? `${matched[1]} ${matched[2]}` : raw
}

/**
 * 数据监控节点的编排配置快照（monitor 复用 rule 种子，isRule 恒 true → ruleCfg）。
 * 与 RuleOrchestrationTab.orchCfg 计算同口径：默认值打底 + 当前 ruleCfg 覆盖 + 名称跟节点走。
 */
export function monitorOrchestrationOf(node: NodeConfig | undefined): RuleOrchestration {
  return {
    ...makeDefaultRuleOrchestration(),
    ...node?.ruleCfg,
    name: node?.title ?? '',
  }
}

/**
 * tableName = 表配置 Tab 里选中的**输入表**。
 *
 * 用户手选表时组件写的是物理表名（`ruleCfg.inputTable`，如 `sense_data.TB_JD_SKU_BASE`），
 * 但流程重新加载后只剩表 ID（步骤里存的是 `inputTable`/`inputTableId`，物理名不落步骤，
 * 见 flowModel.seeds 的 applyRuleStepTables），所以只有 ID 时回查一次表详情取物理名。
 * 查询失败不阻塞保存——这个字段查不到就留空，比整次保存回滚强。
 */
async function resolveInputTableName(node: NodeConfig | undefined, orch: RuleOrchestration): Promise<string> {
  const named = orch.inputTable?.trim()
  if (named) return named
  const tableId = orch.inputTableId?.trim()
    || node?.collectCfg?.inputTable?.trim()
    || node?.inputTable?.trim()
    || ''
  if (!tableId) return ''
  try {
    const entry = await entryApi.entryDetail(tableId)
    return entry?.tableName?.trim() || ''
  } catch {
    return ''
  }
}

function parseCheckConf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/**
 * 本页会话标识：草稿 key 的绑定只在写下它的这一页会话里有效（见 MonitorCheckBinding.draftSession）。
 * 每次加载页面重新生成，不持久化。
 */
const DRAFT_SESSION = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** 画布草稿 key：步骤还没落库（落库后换成后端分配的数字 itemConfig，见 flow.rebindNodeId）。 */
function isDraftNodeKey(nodeKey: string): boolean {
  return !isWritableStepId(nodeKey)
}

/** check_conf.binding → 结构化绑定；没有这个键（旧记录）或结构不对时返回 undefined。 */
function bindingOf(conf: Record<string, unknown>): MonitorCheckBinding | undefined {
  const raw = conf.binding
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const binding: MonitorCheckBinding = {}
  const workflowId = typeof value.workflowId === 'string' ? value.workflowId.trim() : ''
  if (workflowId) binding.workflowId = workflowId
  const nodeKey = typeof value.nodeKey === 'string' ? value.nodeKey.trim() : ''
  if (nodeKey) binding.nodeKey = nodeKey
  const version = Math.trunc(Number(value.bindingVersion))
  if (Number.isFinite(version) && version > 0) binding.bindingVersion = version
  const boundAt = typeof value.boundAt === 'string' ? value.boundAt.trim() : ''
  if (boundAt) binding.boundAt = boundAt
  const draftSession = typeof value.draftSession === 'string' ? value.draftSession.trim() : ''
  if (draftSession) binding.draftSession = draftSession
  return Object.keys(binding).length ? binding : undefined
}

/**
 * 绑定是否指向本节点（C12 前端半，2026-11-13）。
 *
 * `nodeKey` 必须一致；`workflowId` 双方都有时才比较——新建流程还没拿到后端流程 ID 时，
 * 只按节点 ID 认，避免把「同一流程里的节点」判成别人。
 */
export function bindingMatches(
  binding: MonitorCheckBinding | undefined,
  workflowId: string | undefined,
  nodeKey: string | undefined,
): boolean {
  if (!binding?.nodeKey || !nodeKey || binding.nodeKey !== nodeKey) return false
  // 草稿 key 刷新页面后会被新节点复用：只认本页会话写下的草稿绑定（2026-11-16）。
  if (isDraftNodeKey(nodeKey) && binding.draftSession !== DRAFT_SESSION) return false
  if (workflowId && binding.workflowId) return binding.workflowId === workflowId
  return true
}

/** 在已有行里找「属于本节点」的那条：优先按显式绑定认领，不再依赖该源的行数。 */
function pickBoundRow(
  rows: CkSourceRecord[],
  workflowId: string | undefined,
  nodeKey: string | undefined,
): CkSourceRecord | undefined {
  if (!nodeKey) return undefined
  return rows.find((row) => bindingMatches(bindingOf(parseCheckConf(row.checkConf)), workflowId, nodeKey))
}

/**
 * 本节点保存时该改哪一条（undefined = 新建一条）。两条写入路径（节点保存 / 告警面板）共用同一口径：
 *   - 有绑定到本节点的那条 → 改它；
 *   - 一条都没有 → 新建；
 *   - 只有一条：没绑定（旧记录）→ 收养；绑定的是别的节点 → 新建；
 *   - 多条且**全都绑定了别的节点**（同源第 3 个节点、第 3 个共享该源的流程）→ 新建；
 *   - 多条里还有没绑定的旧记录 → 无法判断收养哪条，抛 MultipleCkSourceRowsError 交监控中心处理。
 * 已绑定别的节点的记录在任何情况下都不收养（2026-11-16 场景测试补：此前同源超过两条即拒绝、
 * 告警面板还会直接改 existing[0]）。
 */
function claimRow(
  existing: CkSourceRecord[],
  sourceId: string,
  workflowId: string | undefined,
  nodeKey: string | undefined,
): CkSourceRecord | undefined {
  const bound = pickBoundRow(existing, workflowId, nodeKey)
  if (bound) return bound
  if (!existing.length) return undefined
  const isBound = (row: CkSourceRecord) => !!bindingOf(parseCheckConf(row.checkConf))
  if (existing.length === 1) return isBound(existing[0]) ? undefined : existing[0]
  if (nodeKey && existing.every(isBound)) return undefined
  throw new MultipleCkSourceRowsError(sourceId, existing)
}

/**
 * 绑定版本：节点侧检查范围（输入表 / 时间列）变了才递增，首次绑定从 1 开始。
 * 递增后检查项可以据此提示「范围变了，原脚本/阈值需要复核」，而不是静默沿用旧范围。
 */
function bindingVersionOf(previous: MonitorCheckBinding | undefined, scopeChanged: boolean): number {
  const base = previous?.bindingVersion ?? 0
  return scopeChanged || !base ? base + 1 : base
}

function nowStamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * 检查范围（表 / 时间列）是否相对上次绑定变了。
 *
 * 只比较「会改变检查数据范围」的两项：`tableName`（行上的列）与 `orchestration.timeColumn`。
 * 名称、告警阈值、监控方法的变化不算范围变化——那些不影响「这条检查看哪张表哪段时间」。
 */
function scopeChangedOf(
  previousConf: Record<string, unknown>,
  previousTableName: string | undefined,
  tableName: string,
  orchestration: Omit<RuleOrchestration, 'systemPrompt' | 'script'>,
): boolean {
  const previousOrch = previousConf.orchestration && typeof previousConf.orchestration === 'object'
    ? previousConf.orchestration as Record<string, unknown>
    : {}
  const previousTimeColumn = typeof previousOrch.timeColumn === 'string' ? previousOrch.timeColumn.trim() : ''
  const nextTimeColumn = orchardTimeColumnOf(orchestration).trim()
  const previousTable = previousTableName?.trim() ?? ''
  return previousTable !== tableName.trim() || previousTimeColumn !== nextTimeColumn
}

function orchardTimeColumnOf(orchestration: Omit<RuleOrchestration, 'systemPrompt' | 'script'>): string {
  const value = (orchestration as { timeColumn?: unknown }).timeColumn
  return typeof value === 'string' ? value : ''
}

/** 把绑定合并进 check_conf（对象层合并，其余键原样保留；没有 nodeKey 时退化为旧口径不写绑定）。 */
function withBinding(
  conf: Record<string, unknown>,
  options: {
    workflowId?: string
    nodeKey?: string
    previous?: MonitorCheckBinding
    scopeChanged: boolean
  },
): Record<string, unknown> {
  const { workflowId, nodeKey, previous, scopeChanged } = options
  if (!nodeKey) return conf
  const version = bindingVersionOf(previous, scopeChanged)
  const versionChanged = version !== (previous?.bindingVersion ?? 0)
  const binding: MonitorCheckBinding = {
    ...(workflowId ? { workflowId } : {}),
    nodeKey,
    bindingVersion: version,
    boundAt: versionChanged || !previous?.boundAt ? nowStamp() : previous.boundAt,
    ...(isDraftNodeKey(nodeKey) ? { draftSession: DRAFT_SESSION } : {}),
  }
  return { ...conf, binding }
}

function notifyTypeOf(alertConfig: MonitorAlertConfig | undefined, fallback: unknown): string | undefined {
  const enabledPolicies = alertConfig?.policies?.filter((policy) => policy.enabled) ?? []
  const channelTypes = enabledPolicies.flatMap((policy) => policy.channelTypes)
  if (channelTypes.includes('email')) return 'mail'
  if (channelTypes.includes('dingtalk')) return 'dingtalk'
  return typeof fallback === 'string' ? fallback : undefined
}

function alertCheckConfOf(alertConfig: MonitorAlertConfig | undefined, previous: Record<string, unknown>): Record<string, unknown> {
  const firstPolicy = alertConfig?.policies?.find((policy) => policy.enabled)
  const result: Record<string, unknown> = {}
  if (firstPolicy?.threshold) result.minSize = String(firstPolicy.threshold)
  result.startDt = typeof previous.startDt === 'string' && previous.startDt.trim()
    ? previous.startDt
    : 'DATE_SUB(CURDATE(), INTERVAL 1 DAY)'
  if (firstPolicy) {
    result.cond = [
      firstPolicy.name,
      firstPolicy.metric,
      firstPolicy.operator,
      firstPolicy.threshold,
      `连续${firstPolicy.consecutiveCount}次`,
    ].filter(Boolean).join(' ')
    // 关闭告警必须写后端认得的静音策略 `none`：历史写 `disabled` 会被后端当非法值
    // 归一成 `error`，用户关了告警异常照旧发邮件（2026-11-13 修）。
    result.notifyOn = alertConfig?.enabled === false ? 'none' : 'error'
  }
  const notifyType = notifyTypeOf(alertConfig, previous.notifyType)
  if (notifyType) result.notifyType = notifyType
  return result
}

/**
 * 画布节点写入口径（2026-11-13，1113 设计修订稿）：两类检查在 checkConf 里显式区分归属。
 * 画布数据监控节点检查的是「该节点的输入是否准确」→ 固定写 `node_input`；监控中心的源结果
 * 检查写 `source_result`。旧记录没有这个键（未分类），画布一保存就显式归类。
 *
 * 只做对象层合并：`previous` 里画布不认识的键原样保留，不能因为加字段把别人的配置洗掉。
 */
const NODE_INPUT_SCOPE: MonitorScopeType = 'node_input'

function withNodeInputScope(conf: Record<string, unknown>): Record<string, unknown> {
  return { ...conf, scopeType: NODE_INPUT_SCOPE }
}

function buildCheckConf(
  node: NodeConfig | undefined,
  orchestration: Omit<RuleOrchestration, 'systemPrompt' | 'script'>,
  previous: Record<string, unknown>,
  binding?: {
    workflowId?: string
    nodeKey?: string
    previous?: MonitorCheckBinding
    scopeChanged: boolean
  },
): string {
  const merged = {
    ...previous,
    ...alertCheckConfOf(node?.alertConfig, previous),
    monitorMethods: node?.monitorMethods ?? [],
    orchestration,
  }
  return JSON.stringify(withNodeInputScope(binding ? withBinding(merged, binding) : merged))
}

/**
 * 只同步**告警配置**（监控视图 → 监控配置 Tab，2026-09-16）。
 *
 * 与 syncMonitorCkSource 的差别在写入范围：那个入口手里是画布上的完整节点，checkConf 整包重建
 *（monitorMethods / orchestration / 告警字段一起写）；监控配置 Tab 只有告警面板，节点是从步骤
 * 种子拼出来的骨架——拿它的默认值整包写，会把线上监控真实的监控方法、脚本路径、输入表覆盖掉。
 * 所以已有行**只合入告警相关的几个键**（minSize/cond/notifyOn/notifyType，见 alertCheckConfOf），
 * 其余字段原样保留；该源还没有 ck_source 行时退回 syncMonitorCkSource 的建行口径
 *（没有旧配置可覆盖，按节点信息建一行是对的）。失败向上抛，由调用方决定提示策略。
 *
 * ⚠️ 改哪一条按 claimRow 认领（与节点保存同口径），按主键更新并带 ver 乐观锁；本节点还没有记录时新建，
 * 不改绑定到别的节点的记录；多条里有无法判断归属的旧记录时抛 MultipleCkSourceRowsError——
 * 告警配置落库是按检查项一行，没有「改哪一条」的依据就不能整包覆盖
 *（2026-09-16 实测：一个带数据监控节点的源在 ck_source 里有 4 行同名记录）。
 */
export async function syncMonitorAlertConfig(
  sourceId: string | undefined,
  node: NodeConfig | undefined,
  alertConfig: MonitorAlertConfig | undefined,
  options?: { workflowId?: string; nodeKey?: string },
): Promise<void> {
  const trimmed = sourceId?.trim()
  if (!trimmed) throw new Error('缺少源 ID')
  const existing = await ckSourceApi.list(trimmed)
  // C12：按 claimRow 认领本节点那条；认领不到（本节点还没有记录）就按节点信息新建，
  // 绝不改绑定到别的节点的记录。
  const current = claimRow(existing, trimmed, options?.workflowId?.trim() || undefined, options?.nodeKey?.trim() || undefined)
  if (!current) {
    await syncMonitorCkSource(trimmed, node ? { ...node, alertConfig } : undefined, undefined, options)
    return
  }
  const previousConf = parseCheckConf(current.checkConf)
  // 按主键（C01）而不是按 sourceId 更新：只命中这一条，且带上 ver 做乐观锁——
  // 页面读到记录后别人又改过时，后端会拒绝而不是静默覆盖。
  // 这一路也属于画布节点侧写入，同样补 scopeType='node_input'（旧键原样保留）。
  await updateSourceCheck({
    id: current.id,
    ver: current.ver,
    sourceId: Number(trimmed),
    checkConf: JSON.stringify(withNodeInputScope({ ...previousConf, ...alertCheckConfOf(alertConfig, previousConf) })),
  })
}

/**
 * 草稿节点落库换 ID 后，把它的检查项绑定从草稿 key 迁到数字步骤 ID（2026-11-16）。
 *
 * 节点在步骤落库前就可能保存过监控（绑定写的是 `monitor-5` 这类草稿 key），随后自动保存把节点换成
 * 后端分配的 itemConfig。不迁的话下次保存按新 ID 认领不到，会另建一条、旧那条变成孤儿。
 * 只改 checkConf.binding（nodeKey 换新、去掉 draftSession），其余键与定义字段原样不动，带 ver 乐观锁。
 * 返回是否改了记录；没有对应记录（节点没保存过监控）返回 false。失败向上抛，由调用方提示。
 */
export async function rebindMonitorCkSource(
  sourceId: string | undefined,
  workflowId: string | undefined,
  fromKey: string,
  toKey: string,
): Promise<boolean> {
  const trimmed = sourceId?.trim()
  if (!trimmed || !fromKey || !toKey || fromKey === toKey) return false
  const rows = await ckSourceApi.list(trimmed)
  const row = pickBoundRow(rows, workflowId?.trim() || undefined, fromKey)
  if (!row) return false
  const conf = parseCheckConf(row.checkConf)
  const { draftSession: _dropSession, ...binding } = bindingOf(conf) ?? {} // eslint-disable-line @typescript-eslint/no-unused-vars -- 落库后不再需要会话标识
  await updateSourceCheck({
    id: row.id,
    ver: row.ver,
    sourceId: Number(trimmed),
    checkConf: JSON.stringify({ ...conf, binding: { ...binding, nodeKey: toKey } }),
  })
  return true
}

/**
 * 按 sourceId 同步 ck_source：无则新增、有则更新。两条保存路径（编排配置 Tab 底部「保存」、
 * 「保存脚本」）都走这里。
 *
 * 字段口径（2026-09-16 对齐后）：
 *   sourceId=流程源ID、name=节点名称、
 *   schedule=**节点配置 Tab「定时策略」里那个 cron**（节点 → collectCfg → 源 三层合并 + 策略推导，
 *   见 scheduleCron.ts，不是直接读 node.schedule.cron；三层都没配过时取界面兜底值
 *   `0 0 0 * * ?`，不再留空——调度侧要求 SCHEDULE 非空），
 *   tableName=**表配置 Tab 选中的输入表**物理名（只有表 ID 时回查一次表详情）、
 *   checkConf=监控方法+编排配置序列化的 JSON，并显式写 `scopeType: 'node_input'`（画布节点侧归属）。
 *
 * 写入边界：
 *   - **新建**走 C01 `/api/v1/source/check/add`，只提交上面四个定义字段 + scopeType；
 *     生命周期字段由后端 `CkSourceService.addObject` 补：createDt=服务端当前时间、state='C'（正常）、
 *     isDelete=0（启用）、nextRun 按 schedule 计算——所以新记录仍然**直接进入可调度状态**，
 *     前端不再自己填这些值（填了也会被后端覆盖，反而和调度侧口径分叉）；
 *   - **更新**走 C01 按主键 `/api/v1/source/check/update`，只写上面四个定义字段 + id/ver
 *     （ver 是乐观锁基线，由后端比较并递增）——画布保存不能重新启用已停用的检查项，
 *     也不能改别人的创建时间；
 *   - C12 显式绑定（2026-11-13）：checkConf 里写 `binding = { workflowId, nodeKey, bindingVersion, boundAt }`，
 *     保存时先按 `nodeKey` 认领本节点的记录——同源多节点、复制节点都只改自己那条；认领不到时：
 *     零条 → 建行；唯一一条且无绑定（旧记录）→ 收养并补写绑定；其余（多条且都没有绑定）→
 *     抛 MultipleCkSourceRowsError（画布无法判断改哪一条，交用户到监控中心处理）。
 *
 * `sourceSchedule` 传画布当前源（flow.sourceCfg）：节点没配过定时时，节点配置 Tab 显示的就是
 * 源上的定时，保存就该写同一个值，否则出现「界面有 cron、落库是空」。
 *
 * 失败向上抛，由调用方决定提示与回滚策略。
 */
export async function syncMonitorCkSource(
  sourceId: string | undefined,
  node: NodeConfig | undefined,
  sourceSchedule?: CollectorSchedule | null,
  options?: { workflowId?: string; nodeKey?: string },
): Promise<void> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return // 流程未绑源（草稿态）时跳过，不阻塞保存
  const orchCfg = monitorOrchestrationOf(node)
  // checkConf 不落 systemPrompt / script（2026-09-07 约定）：系统提示词与脚本体都属于生成
  // 脚本的中间产物，ck_source 只需要监控执行所需的配置（脚本路径、表、字段、调度等）。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 解构剔除这两个键：ck_source 不落提示词与脚本体
  const { systemPrompt: _omitPrompt, script: _omitScript, ...orchestration } = orchCfg
  const existing = await ckSourceApi.list(trimmed)
  const workflowId = options?.workflowId?.trim() || undefined
  const nodeKey = options?.nodeKey?.trim() || undefined
  // C12（2026-11-13 前端半）：先按 check_conf.binding 认领本节点的检查项。
  // 认领到 → 只改这一条，同源多节点/复制节点不再互相覆盖，也不再因为「该源有多行」被迫停手。
  // 认领口径见 claimRow：绑定到本节点 → 改；唯一一条旧记录（无绑定）→ 收养并补写绑定；
  // 其余记录都绑定了别的节点 → 按本节点另建一条（「一个源多个监控节点 / 多流程共享源」的目标形态）。
  const adoptTarget = claimRow(existing, trimmed, workflowId, nodeKey)
  const previousConf = parseCheckConf(adoptTarget?.checkConf)
  const previousBinding = bindingOf(previousConf)
  const tableName = await resolveInputTableName(node, orchCfg)
  // 只有「改的是一条已有记录」时才谈范围变化；新建行 / 收养旧记录都算首次绑定（版本从 1 开始）。
  const scopeChanged = adoptTarget ? scopeChangedOf(previousConf, adoptTarget.tableName, tableName, orchestration) : false
  // update 只提交「定义」字段：name / schedule / tableName / checkConf。
  // state（启用状态）、isDelete（逻辑删除）、createDt、ver 属于运行/生命周期字段，
  // 画布保存不得重置——否则「停用的检查项」会被一次节点保存重新启用（2026-11-12 最小保护）。
  const definition: CkSourcePayload = {
    sourceId: Number(trimmed),
    name: node?.title ?? '',
    schedule: nodeScheduleCron(node, sourceSchedule),
    tableName,
    checkConf: buildCheckConf(node, orchestration, previousConf, {
      workflowId,
      nodeKey,
      previous: previousBinding,
      scopeChanged,
    }),
  }
  if (adoptTarget) {
    // 单条记录：按主键更新（C01 /api/v1/source/check/update），并带 ver 做乐观锁。
    // 旧 /api/source/update 只认 sourceId，一条 payload 命中该源所有行，才有多行时只能拒绝的问题。
    await updateSourceCheck({
      ...definition,
      id: adoptTarget.id,
      ver: adoptTarget.ver,
    })
    return
  }
  // 新建走 C01 `/api/v1/source/check/add`：后端 addObject 自己补生命周期字段
  // （createDt / state='C' / isDelete=0 / nextRun），前端不传即不会覆盖服务端口径，
  // 新记录依旧直接可调度（2026-09-07 约定，2026-11-13 切新接口后由后端落实）。
  // 回执 data 里带 { id, ver, ... }，画布侧只负责建行、不需要再按 name+tableName 回查。
  await addSourceCheck({ ...definition })
}
