/**
 * 业务目录预期产出周期（1114 源产出监控一期 C，cfg_category.EXPECT_CYCLE_HOURS，单位小时）。
 * 后端只收 0～8784 的整数小时（8784 = 366 天），0 表示清空。
 */
export const EXPECT_CYCLE_MAX_HOURS = 8784

export const EXPECT_CYCLE_PRESETS: { hours: number; label: string }[] = [
  { hours: 24, label: '1 天' },
  { hours: 72, label: '3 天' },
  { hours: 168, label: '7 天' },
  { hours: 720, label: '30 天' },
]

/** 24 的整倍数写「N 天」，否则写「N 小时」；未配置写「—」 */
export function expectCycleText(hours?: number | null): string {
  if (!hours) return '—'
  return hours % 24 === 0 ? `${hours / 24} 天` : `${hours} 小时`
}
