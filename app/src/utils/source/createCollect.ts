// 新建采集的共用收尾动作：建流程并绑定、加入业务目录。
// 「新建采集」页（NewSiteWizard）和 AI 问数对话建源（utils/aiChat/sourceDraft）共用，口径必须一致。
// 网站和源此时已经落库：这里的失败都不回滚，只返回说明，画布里还能用流程标签栏「＋」补建。
import { workflowBindingApi } from '@/api'
import { addSourcesToBizDir } from '@/api/sourceDirs'
import { createFlowFromTemplate } from '@/utils/flow/createFromTemplate'

export interface SharedFlowResult {
  /** 建出来的流程 ID（建流程本身失败时没有） */
  flowId?: string
  /** 失败说明；全部成功为空串 */
  note: string
}

/**
 * 2026-10-12：217 后端按源读步骤要求源已绑流程，只建源不建流程，进画布就报「源未绑定有效流程」。
 * 用户定：同一次新建采集的源共用一条流程（名称 = 网站名），建好后整批绑上并设为默认。
 */
export async function createSharedFlow(name: string, sourceIds: string[], templateId: string): Promise<SharedFlowResult> {
  if (!sourceIds.length) return { note: '' }
  let flowId: string
  try {
    flowId = (await createFlowFromTemplate(templateId, name)).id
  } catch (error) {
    return { note: `网站和源已创建，但新建流程失败：${(error as Error)?.message ?? String(error)}。可在画布流程标签栏点「＋」新建` }
  }
  const failed: string[] = []
  for (const sourceId of sourceIds) {
    try {
      await workflowBindingApi.bind({ sourceId, workflowId: flowId, primary: true })
    } catch {
      failed.push(sourceId)
    }
  }
  return {
    flowId,
    note: failed.length
      ? `网站、源和流程 #${flowId} 已创建，但 ${failed.length} 个源关联流程失败（${failed.join('、')}），可在流程中心给它们关联`
      : '',
  }
}

/** 新建的源加入所选业务目录；失败返回说明（成功或没选目录返回空串） */
export async function addSourcesToBizDirNote(dir: { dirId?: string; category?: string }, sourceIds: string[]): Promise<string> {
  if (!dir.dirId || !sourceIds.length) return ''
  try {
    await addSourcesToBizDir(dir.dirId, sourceIds)
    return ''
  } catch (error) {
    return `源已创建，但加入业务目录「${dir.category || dir.dirId}」失败：${(error as Error)?.message ?? String(error)}。可在源管理「归类 → 加入业务目录」补上（源 ID：${sourceIds.join(',')}）`
  }
}
