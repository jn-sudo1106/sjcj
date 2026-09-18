/**
 * 批量导入（按源 ID）进行中的通知文案。
 *
 * **为什么要分两种说法**（2026-09-18 用户反馈「进度条不显示」）：
 * `sourceApi.changeSite` 只有超过 `CHANGE_SITE_CHUNK`（300）才分片串行提交；不到这个数
 * 就是**一次请求把整批发出去**，服务端不回报中间进度，`onProgress` 要等请求返回才被调用
 * 一次，而那一刻通知已经关闭了。结果就是导 100 个源全程停在「已导入 0 / 100」，看着像卡死。
 *
 * 所以：不分片时不假装有逐条进度，只说"正在导入 N 个"；分片时才报数，且报的是
 * **已提交**而不是"已导入"——`onProgress` 累计的是已提交的片（含失败与待回查确认的），
 * 不是确认落库的条数。
 */
export function importProgressText(progress: number, total: number, chunked: boolean): string {
  if (!chunked) return `正在导入 ${total} 个源，请勿关闭页面…`
  return `已提交 ${progress} / ${total} 个源，请勿关闭页面…`
}
