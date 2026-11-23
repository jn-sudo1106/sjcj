/**
 * 源还没有绑定流程（对话建源选「暂不建流程」、或只建源未建流程）时，后端按源读步骤
 * （item/next/nextConfigPaged）返回 success:false「源未绑定有效流程，sourceId=…」。
 * 这是「还没配置」的正常空状态，不是加载失败：文件 / 任务视图据此显示空状态，不报错、不兜底拉全局表。
 */
export function isSourceWithoutFlowError(error: unknown): boolean {
  const e = error as { message?: unknown; cause?: { message?: unknown } } | null
  const text = `${String(e?.message ?? '')} ${String(e?.cause?.message ?? '')}`
  return text.includes('源未绑定有效流程')
}
