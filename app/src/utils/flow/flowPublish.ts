// 流程有没有发布版本（1016）：旧后端复制流程（copyFlow / copySource flag=1）只认**已发布版本**，
// 只有草稿的流程复制会报「请先进入流程草稿编辑并重新加载版本信息」。186 10-29 起后端没有发布版时改取草稿，
// 前端不再提前查、提前拦（10-30）；217 未确认前保留报错时的说明。

/** 后端拒绝复制只有草稿的流程时，给用户看的说明 */
export const UNPUBLISHED_COPY_HINT = '这条流程还没有发布版本（只有草稿），不能复制。请先打开这条流程发布，或换一条已发布的流程。'

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
