/**
 * 数据行详情的偏好：空字段开关全局记住；字段预设（全部 / 仅非空 / 下一步）按表记。
 * 开关在抽屉头，不在字段列表里——会上「怎么只能看四条」就是因为开关埋在内容里看不见。
 */
export type RowFieldPreset = 'all' | 'filled' | 'next'

const SHOW_EMPTY_KEY = 'sjcj.rowDetail.showEmpty'
const PRESET_PREFIX = 'sjcj.rowDetail.preset.'

export function readShowEmpty(): boolean {
  try {
    return localStorage.getItem(SHOW_EMPTY_KEY) === '1'
  } catch {
    return false
  }
}

export function writeShowEmpty(value: boolean) {
  try {
    localStorage.setItem(SHOW_EMPTY_KEY, value ? '1' : '0')
  } catch { /* ignore quota */ }
}

export function readFieldPreset(tableId: string): RowFieldPreset {
  if (!tableId) return 'filled'
  try {
    const raw = localStorage.getItem(PRESET_PREFIX + tableId)
    if (raw === 'all' || raw === 'filled' || raw === 'next') return raw
  } catch { /* ignore */ }
  return 'filled'
}

export function writeFieldPreset(tableId: string, preset: RowFieldPreset) {
  if (!tableId) return
  try {
    localStorage.setItem(PRESET_PREFIX + tableId, preset)
  } catch { /* ignore quota */ }
}

/** 空数组 = 不过滤（全部字段）。编辑态调用方应忽略这个列表。 */
export function visibleDetailProps(
  preset: RowFieldPreset,
  fields: { prop: string; empty: boolean }[],
  nextProps: string[],
): string[] {
  if (preset === 'filled') return fields.filter((field) => !field.empty).map((field) => field.prop)
  if (preset === 'next') return nextProps
  return []
}
