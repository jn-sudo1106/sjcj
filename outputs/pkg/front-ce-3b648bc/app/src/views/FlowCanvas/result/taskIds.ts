/**
 * 任务实例上的「数据 ID」与「父任务 ID」口径（2026-09-28 生产实测纠正）。
 *
 * **数据 ID 是 `parentId`，不是 `bizId`**：
 * - `parentId` = 触发这条任务的那条数据的 ENTRY_ID（旧平台 TaskInst.vue 的「父ID」筛选、数据行「查后续任务」
 *   都按它把任务挂到数据上）。实测源 430017712 的 OCR 任务 64248867：parentId=1035124，
 *   在 6200029 表里正好查到这个源的那一行；
 * - `bizId` 是本轮运行的上下文 ID（vars 里的 `$csId$`）：根任务生成，一路传给下游——
 *   同一轮里处理不同数据的任务 bizId 全是 42848739，拿它去表里查恒为 0 条。
 * 根任务（流程第一步的抓取）没有 parentId：它不是由某条数据触发的，就没有数据 ID。
 *
 * **父任务 ID 在 vars.pTaskId**，不是 parentId（此前详情抽屉把 parentId 标成「父任务 ID」，是错的）。
 */
import type { TaskInst } from '@/api'

function realId(value: unknown): string {
  const text = value == null ? '' : String(value).trim()
  return text && text !== '0' ? text : ''
}

export function taskDataId(task: Pick<TaskInst, 'parentId'>): string {
  return realId(task.parentId)
}

export function taskParentTaskId(task: Pick<TaskInst, 'vars'>): string {
  if (!task.vars) return ''
  try {
    const vars = JSON.parse(task.vars) as Record<string, unknown>
    return realId(vars.pTaskId)
  } catch {
    return ''
  }
}
