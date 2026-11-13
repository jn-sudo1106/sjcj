// ck_source 监控源配置同步（vanv-data-engine SourceController，2026-09-05）：
// 数据监控节点保存时按当前流程的 sourceId 查 ck_source（GET /api/source/list），
// 无则 insert、有则 update。NodeInspector 底部「保存」（编排配置 Tab）与
// RuleOrchestrationTab「保存脚本」两条保存路径共用，抽在这里保证 payload 口径一致。
import { ckSourceApi, entryApi } from '@/api'
import { updateSourceCheck } from '@/api/monitor'
import {
  makeDefaultRuleOrchestration,
  type CollectorSchedule,
  type MonitorAlertConfig,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import type { CkSourcePayload, CkSourceRecord, RuleOrchestration } from '@/api'
import { nodeScheduleCron } from './scheduleCron'

/**
 * ck_source 落库时的固定值（2026-09-16 定下的写入口径）：insert / update 都要带上，
 * 不是「只有新建才写」。这四个字段之外，运行状态类字段（LAST_RUN/NEXT_RUN/LOCK_STATE 等）
 * 一概不传——后端 SourceService 只写非空字段，不传即保留原值。
 *
 * IS_DELETE 写 **0 = 在用**：这张表里 1 才是停用/逻辑删除（旧平台监控列表
 * `enabled = isDelete === 0`、调度侧筛选 `coalesce(IS_DELETE, 0) = 0`、告警面板的
 * `sourceCheckApi.changeEnable` 0=在用/1=停用 都是这个方向）。写 1 会让刚保存的监控
 * 直接落在「停用」态、也不会被排期，所以这里必须是 0。
 */
const CK_SOURCE_STATE = 'E'
const CK_SOURCE_IS_DELETE = 0
const CK_SOURCE_VER = 12

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
 * 为空省略「表=…」；state 只有 'E' 算启用（这张表用 1 表示停用/逻辑删除，见文件头 IS_DELETE 说明）；
 * updateDt 是后端 LocalDateTime 的 ISO 串，这里转成 `YYYY-MM-DD HH:mm` 展示，缺省时省略该段。
 */
export function describeCkSourceConflictRows(rows: CkSourceRecord[]): string[] {
  return rows.map((row) => {
    const parts = [row.name?.trim() || '未命名检查项']
    parts.push(`id=${row.id}`)
    const tableName = row.tableName?.trim()
    if (tableName) parts.push(`表=${tableName}`)
    parts.push(row.state === 'E' ? '已启用' : '已停用')
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
 * ck_source.CREATE_DT 的文本格式：**ISO-8601 本地时间** `YYYY-MM-DDTHH:mm:ss`。
 *
 * 后端 CkSource.createDt 是 `LocalDateTime`，Spring 默认的 Jackson（JSR-310）只认 ISO-8601，
 * 带空格的旧平台写法 `2026-09-16 18:24:38` 会在反序列化阶段就抛 HttpMessageNotReadableException，
 * 接口直接 400 Bad Request（不写库、也没有任何业务错误信息，实测 2026-09-16）。
 * 不带时区是因为 LocalDateTime 本身无时区语义，带上 Z 会被当成字面量解析成本地时间。
 */
function formatDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
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
    result.notifyOn = alertConfig?.enabled === false ? 'disabled' : 'error'
  }
  const notifyType = notifyTypeOf(alertConfig, previous.notifyType)
  if (notifyType) result.notifyType = notifyType
  return result
}

function buildCheckConf(
  node: NodeConfig | undefined,
  orchestration: Omit<RuleOrchestration, 'systemPrompt' | 'script'>,
  previous: Record<string, unknown>,
): string {
  return JSON.stringify({
    ...previous,
    ...alertCheckConfOf(node?.alertConfig, previous),
    monitorMethods: node?.monitorMethods ?? [],
    orchestration,
  })
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
 * ⚠️ 只在该源恰好一条 ck_source 时按主键更新（2026-11-13 起带 ver 乐观锁）；多条时同样抛
 * MultipleCkSourceRowsError——告警配置虽然概念上是源级的，但落库是按检查项一行，没有「改哪一条」
 * 的依据就不能整包覆盖（2026-09-16 实测：一个带数据监控节点的源在 ck_source 里有 4 行同名记录）。
 */
export async function syncMonitorAlertConfig(
  sourceId: string | undefined,
  node: NodeConfig | undefined,
  alertConfig: MonitorAlertConfig | undefined,
): Promise<void> {
  const trimmed = sourceId?.trim()
  if (!trimmed) throw new Error('缺少源 ID')
  const existing = await ckSourceApi.list(trimmed)
  if (!existing.length) {
    await syncMonitorCkSource(trimmed, node ? { ...node, alertConfig } : undefined)
    return
  }
  if (existing.length > 1) throw new MultipleCkSourceRowsError(trimmed, existing)
  const current = existing[0]
  const previousConf = parseCheckConf(current.checkConf)
  // 按主键（C01）而不是按 sourceId 更新：只命中这一条，且带上 ver 做乐观锁——
  // 页面读到记录后别人又改过时，后端会拒绝而不是静默覆盖。
  await updateSourceCheck({
    id: current.id,
    ver: current.ver,
    sourceId: Number(trimmed),
    checkConf: JSON.stringify({ ...previousConf, ...alertCheckConfOf(alertConfig, previousConf) }),
  })
}

/**
 * 按 sourceId 同步 ck_source：无则 insert、有则 update。两条保存路径（编排配置 Tab 底部「保存」、
 * 「保存脚本」）都走这里。
 *
 * 字段口径（2026-09-16 对齐后）：
 *   sourceId=流程源ID、name=节点名称、
 *   schedule=**节点配置 Tab「定时策略」里那个 cron**（节点 → collectCfg → 源 三层合并 + 策略推导，
 *   见 scheduleCron.ts，不是直接读 node.schedule.cron；三层都没配过时取界面兜底值
 *   `0 0 0 * * ?`，不再留空——调度侧要求 SCHEDULE 非空），
 *   tableName=**表配置 Tab 选中的输入表**物理名（只有表 ID 时回查一次表详情）、
 *   checkConf=监控方法+编排配置序列化的 JSON。
 *
 * 写入边界：
 *   - **新建**才补 state/isDelete/createDt/ver（新记录要能进调度）；
 *   - **更新**走 C01 按主键 `/api/v1/source/check/update`，只写上面四个定义字段 + id/ver
 *     （ver 是乐观锁基线，由后端比较并递增）——画布保存不能重新启用已停用的检查项，
 *     也不能改别人的创建时间；
 *   - 该源在 ck_source 里已有多条记录时直接抛 MultipleCkSourceRowsError（画布无法表达「改哪一条」），
 *     不再按 sourceId 整包覆盖。
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
): Promise<void> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return // 流程未绑源（草稿态）时跳过，不阻塞保存
  const orchCfg = monitorOrchestrationOf(node)
  // checkConf 不落 systemPrompt / script（2026-09-07 约定）：系统提示词与脚本体都属于生成
  // 脚本的中间产物，ck_source 只需要监控执行所需的配置（脚本路径、表、字段、调度等）。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 解构剔除这两个键：ck_source 不落提示词与脚本体
  const { systemPrompt: _omitPrompt, script: _omitScript, ...orchestration } = orchCfg
  const existing = await ckSourceApi.list(trimmed)
  if (existing.length > 1) throw new MultipleCkSourceRowsError(trimmed, existing)
  const previousConf = parseCheckConf(existing[0]?.checkConf)
  // update 只提交「定义」字段：name / schedule / tableName / checkConf。
  // state（启用状态）、isDelete（逻辑删除）、createDt、ver 属于运行/生命周期字段，
  // 画布保存不得重置——否则「停用的检查项」会被一次节点保存重新启用（2026-11-12 最小保护）。
  const definition: CkSourcePayload = {
    sourceId: Number(trimmed),
    name: node?.title ?? '',
    schedule: nodeScheduleCron(node, sourceSchedule),
    tableName: await resolveInputTableName(node, orchCfg),
    checkConf: buildCheckConf(node, orchestration, previousConf),
  }
  if (existing.length) {
    const current = existing[0]
    // 单条记录：按主键更新（C01 /api/v1/source/check/update），并带 ver 做乐观锁。
    // 旧 /api/source/update 只认 sourceId，一条 payload 命中该源所有行，才有多行时只能拒绝的问题。
    await updateSourceCheck({
      ...definition,
      id: current.id,
      ver: current.ver,
    })
    return
  }
  // 只有新建才补生命周期字段：新记录直接进入可调度状态（2026-09-07 约定）。
  await ckSourceApi.insert({
    ...definition,
    state: CK_SOURCE_STATE,
    isDelete: CK_SOURCE_IS_DELETE,
    createDt: formatDateTime(new Date()),
    ver: CK_SOURCE_VER,
  })
}
