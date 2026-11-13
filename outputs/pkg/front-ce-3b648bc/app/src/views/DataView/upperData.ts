// 「上层数据」（1021-05，设计方案 §5.3）：PARENT_ID 不再原样给用户看。
// -1 / -2 / 0 / 空都是后端表示「没有上层」的内部值，一律显示「—」；原始值只放详情抽屉的「技术字段」。

/** 有上层时返回上层数据 ID，没有（空、0、负数）返回 '' */
export function upperDataId(parentId?: string | null): string {
  const id = parentId == null ? '' : String(parentId).trim()
  if (!id) return ''
  const n = Number(id)
  return Number.isFinite(n) && n <= 0 ? '' : id
}

/**
 * 列表 / 详情里的显示文字：知道上层表时「来自 表名 #ID」，不知道时只显示 ID，没有上层「—」。
 * 上层表后端不直接返回（CATEGORY_ID 在异表链路下是本行自己的表，不能当上层表用，见 ResultView 的 2026-09-04 修复），
 * 目前只有「按步骤」看某节点输出表、且该节点输入表不同时才能确定。
 */
export function upperDataText(parentId?: string | null, upperTableName?: string): string {
  const id = upperDataId(parentId)
  if (!id) return '—'
  return upperTableName ? `来自 ${upperTableName} #${id}` : id
}
