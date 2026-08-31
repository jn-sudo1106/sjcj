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

/**
 * 预处理（旧 `clearRule`）的候选预设。
 *
 * **逐字照抄旧平台** `page/config/modules/EntryTypeEdit.vue` 的 `clearRuleOptions`。
 * 2026-08-28 订正：新平台原先第 5 条编成了 `value ? '有' : '无'`，旧平台其实是那条
 * 按股票代码前缀补交易所后缀的 if 表达式——它同时也是"预处理里可以写多行脚本"的示例，
 * 换成一个三元表达式就把这个信息丢了。
 *
 * 两套表编辑界面共用（采集资产抽屉 / 画布弹窗），避免两边给的候选不一样。
 */
export const ENTRY_PREPROCESS_PRESETS = [
  "date('yyyy-MM-dd')",
  'SOURCE_NAME',
  'SOURCE_URL',
  "subIndex(value, 'c', 1, -1)",
  "if(string.startsWith(K1, '600')) { return value + '.sh';} else {  return value + '.sz'; }",
]

/**
 * 字段级「校验」（旧 `CfgEntryItem.checkRule`）的候选。
 *
 * 照抄旧平台 `EntryTypeEdit.vue` 的 `checkSelect`：只有「-不校验-」（空串）和「校验非空」（`Y`）两项。
 * 旧平台的下拉还支持 `handleNextSearch` 把用户输入的任意值补进选项——即**允许自定义校验表达式**，
 * 新平台用 `el-select` 的 `filterable + allow-create` 等价实现。
 */
export const ENTRY_CHECK_RULE_PRESETS = ['', 'Y']

/** 校验取值 → 展示文案；清单外的值（用户自定义）原样显示 */
export function entryCheckRuleLabel(value: string): string {
  if (value === '') return '不校验'
  if (value === 'Y') return '校验非空'
  return value
}
