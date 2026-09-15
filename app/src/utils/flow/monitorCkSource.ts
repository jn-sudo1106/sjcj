// ck_source 监控源配置同步（vanv-data-engine SourceController，2026-09-05）：
// 数据监控节点保存时按当前流程的 sourceId 查 ck_source（GET /api/source/list），
// 无则 insert、有则 update。NodeInspector 底部「保存」（编排配置 Tab）与
// RuleOrchestrationTab「保存脚本」两条保存路径共用，抽在这里保证 payload 口径一致。
import { ckSourceApi } from '@/api'
import {
  makeDefaultRuleOrchestration,
  type MonitorAlertConfig,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import type { RuleOrchestration } from '@/api'

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
 * 按 sourceId 同步 ck_source：无则 insert、有则 update。
 * 字段：sourceId=流程源ID、name=节点名称、schedule=cron、tableName=输入表、
 * checkConf=监控方法+编排配置序列化的 JSON。失败向上抛，由调用方决定提示与回滚策略。
 */
export async function syncMonitorCkSource(sourceId: string | undefined, node: NodeConfig | undefined): Promise<void> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return // 流程未绑源（草稿态）时跳过，不阻塞保存
  const orchCfg = monitorOrchestrationOf(node)
  // checkConf 不落 systemPrompt / script（2026-09-07 约定）：系统提示词与脚本体都属于生成
  // 脚本的中间产物，ck_source 只需要监控执行所需的配置（脚本路径、表、字段、调度等）。
  const { systemPrompt: _omitPrompt, script: _omitScript, ...orchestration } = orchCfg
  const existing = await ckSourceApi.list(trimmed)
  const previousConf = parseCheckConf(existing[0]?.checkConf)
  const payload = {
    sourceId: Number(trimmed),
    name: node?.title ?? '',
    schedule: node?.schedule?.cron ?? '',
    tableName: orchCfg.inputTable ?? '',
    checkConf: buildCheckConf(node, orchestration, previousConf),
  }
  if (existing.length) {
    // update 不带 state：后端 body 里为 null 的字段保留原列值，运行状态由后台任务维护，前端不覆盖。
    const updated = await ckSourceApi.update(payload)
    if (!updated) throw new Error('按 sourceId 未命中任何行')
    return
  }
  // insert 默认 state='E'（启用）：新建的监控源记录直接进入可调度状态（2026-09-07 约定）。
  await ckSourceApi.insert({ ...payload, state: 'E' })
}
