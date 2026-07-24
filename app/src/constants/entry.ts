// 实体表（表 ID 列表）相关常量。统一编辑器 / 提取字段 / 导出 CSV 三个口径。
// 引用方案：表 ID 列表迁移 §1.4（数据表编辑），《表ID列表迁移_开发方案_2026-07-17.md》。

/**
 * 字段默认列宽（varchar 长度）。
 *
 * 历史口径（迁移前）：
 * - EntryEditorDrawer blankField：固定 255
 * - EntryTab 提取表字段：255（兜底）
 * - EntryTab 导出 CSV：128（兜底）—— **不一致**，本次统一为 255。
 *
 * 255 是 MySQL 5.x utf8mb4 单列最大字节上限的安全选择，旧平台默认就是 255。
 */
export const ENTRY_FIELD_DEFAULT_WIDTH = 255

/**
 * 字段列宽合理下限。
 *
 * 旧 EntryTab 提取表字段脚本用 `f.width < 10` 当「未配置」判断，10 是历史 magic number，
 * 推测是「中文长标题 < 10 字符视为漏填」之类的口径，未找到具体依据，保留。
 *
 * 低于此值的 width 一律按 ENTRY_FIELD_DEFAULT_WIDTH 兜底，保证：
 * - 编辑器新建字段默认 255
 * - 提取字段 / 导出 CSV 对漏填字段统一兜底为 255
 */
export const ENTRY_FIELD_MIN_REASONABLE_WIDTH = 10

/**
 * 取字段有效列宽。null / undefined / 0 / 负数 / 低于合理下限 → 兜底默认值。
 *
 * 使用方：编辑器、提取表字段脚本、CSV 导出，三个口径统一。
 */
export function getEffectiveWidth(width: number | undefined | null): number {
  if (width == null || width <= 0 || width < ENTRY_FIELD_MIN_REASONABLE_WIDTH) {
    return ENTRY_FIELD_DEFAULT_WIDTH
  }
  return width
}
