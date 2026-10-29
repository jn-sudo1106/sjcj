// 流程有没有发布版本（1016）：后端复制流程（copyFlow / copySource flag=1）取的是**已发布版本**，
// 只有草稿的流程复制会报「请先进入流程草稿编辑并重新加载版本信息」。复制产物本身也只有草稿
// （186 实测 state=W、publishId=null），所以「复制品再复制」必然失败——在选流程时提前查、提前说。
import { flowVersionApi } from '@/api'

/** 只有草稿时，复制前给用户看的说明 */
export const UNPUBLISHED_COPY_HINT = '这条流程还没有发布版本（只有草稿），不能复制。请先打开这条流程发布，或换一条已发布的流程。'

/** true = 有发布版本；false = 只有草稿；null = 查不到（不拦，交给后端判断） */
export async function flowHasPublished(flowId: string): Promise<boolean | null> {
  if (!/^\d+$/.test(flowId)) return null
  try {
    return !!(await flowVersionApi.overview(flowId)).publishId
  } catch {
    return null
  }
}

/** 后端「没有发布版本不能复制」的报错 */
export function isUnpublishedFlowError(message: string | undefined): boolean {
  return /草稿|版本信息/.test(message ?? '')
}

/** 复制流程失败的提示：没有发布版本时换成人话，其它原样 */
export function copyFlowErrorText(message: string | undefined): string {
  return isUnpublishedFlowError(message) ? UNPUBLISHED_COPY_HINT : `复制流程失败：${message || '未知原因'}`
}

/** 复制品自动发布失败的提示：只有草稿时采集跑不了、也不能再被复制 */
export function copiedPublishWarning(flowId: string, reason: string): string {
  return `新流程 #${flowId} 自动发布失败（${reason}），现在只有草稿：定时和手动采集都跑不了，也不能再被复制。请打开这条流程手动发布。`
}
