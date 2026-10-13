/**
 * 保存定时失败的人话提示（2026-10-12）。
 *
 * 新建采集 / 新建空白流程建出来的流程在 217 / 开发环境上只有「草稿 v1」，没有发布版；后端 `source/createJobs`
 * 只能给**已发布**且起始节点（ROOT）配好入口的流程建定时，否则回
 * 「以下源无法按所选流程调度（未关联或ROOT缺失），未创建任何调度：{源ID}」，用户看不出该做什么。
 */

/** 流程还没有发布版本时，新建定时之前就拦下来说明（不发请求） */
export function unpublishedFlowCronHint(flowId: string, draftVersion?: number | string): string {
  return `定时没保存：这条流程（#${flowId}）还没有发布版本，后端只能给已发布的流程建定时。请先把起始节点配好，`
    + `${draftVersion != null ? `点画布上方的「发布 v${draftVersion}」` : '发布这条流程'}，再回来保存定时。`
}

/** 后端回的「无法按所选流程调度 / ROOT 缺失 / 没有有效发布版本」翻成能照着做的提示；不认识的原样返回 null */
export function cronSaveErrorHint(message: string): string | null {
  if (!/无法按所选流程调度|ROOT缺失|ROOT未配置|没有有效发布版本/.test(message)) return null
  return '定时保存失败：这个源关联的流程还不能调度——流程没有发布版本，或起始节点（ROOT）没有配置入口，或源没有关联这条流程。'
    + '请先把流程的起始节点配好并发布，再保存定时。'
}
