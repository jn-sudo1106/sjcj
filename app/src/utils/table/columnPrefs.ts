/** 数据表列显隐 + 显示顺序。按 tableId 记在 localStorage，不写后端。 */

export interface ColumnPrefs {
  hidden: string[]
  order: string[]
}

// 0903 Y1-5：PARENT_ID 并入身份列——它和 ENTRY_ID/SOURCE_ID 一样回答的是"这行是谁"，
// 而不是业务内容；异表回溯要靠它，不能在「仅身份列」和「下一步字段」两个预设里被筛掉。
export const IDENTITY_COL_PROPS = ['ENTRY_ID', 'SOURCE_ID', 'PARENT_ID'] as const

export function columnPrefsKey(tableId: string, scope = 'datagrid'): string {
  return `jn.${scope}.cols.${tableId}`
}

export function readColumnPrefs(tableId: string, scope = 'datagrid'): ColumnPrefs | null {
  if (!tableId) return null
  try {
    const raw = localStorage.getItem(columnPrefsKey(tableId, scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((v): v is string => typeof v === 'string') : []
    const order = Array.isArray(parsed.order) ? parsed.order.filter((v): v is string => typeof v === 'string') : []
    return { hidden, order }
  } catch {
    return null
  }
}

export function writeColumnPrefs(tableId: string, prefs: ColumnPrefs, scope = 'datagrid'): void {
  if (!tableId) return
  try {
    localStorage.setItem(columnPrefsKey(tableId, scope), JSON.stringify({
      hidden: prefs.hidden,
      order: prefs.order,
    }))
  } catch {
    // 隐私模式 / 配额满：记住失败不挡用表
  }
}

/** 已存顺序里仍在 schema 的列靠前，schema 新增的接到末尾，已删的丢掉。 */
export function mergeColumnOrder(schemaProps: string[], savedOrder?: string[]): string[] {
  const allowed = new Set(schemaProps)
  const seen = new Set<string>()
  const out: string[] = []
  for (const prop of savedOrder ?? []) {
    if (!allowed.has(prop) || seen.has(prop)) continue
    out.push(prop)
    seen.add(prop)
  }
  for (const prop of schemaProps) {
    if (seen.has(prop)) continue
    out.push(prop)
    seen.add(prop)
  }
  return out
}

export function reorderProps(order: string[], fromProp: string, toProp: string): string[] {
  if (fromProp === toProp) return order
  const from = order.indexOf(fromProp)
  const to = order.indexOf(toProp)
  if (from < 0 || to < 0) return order
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, fromProp)
  return next
}

/**
 * 筛选后只在可见子集里拖：把 full 里等于 filteredBefore 的那些位置，
 * 按 filteredAfter 的新顺序写回去，其余列不动。
 */
export function mergeFilteredReorder(full: string[], filteredBefore: string[], filteredAfter: string[]): string[] {
  if (filteredBefore.length !== filteredAfter.length) return full
  let i = 0
  return full.map((prop) => (filteredBefore.includes(prop) ? filteredAfter[i++] : prop))
}
