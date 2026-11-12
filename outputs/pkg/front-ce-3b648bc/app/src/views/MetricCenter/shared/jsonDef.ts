// 共享层的纯函数：JSON 字段的加载美化与保存前压缩校验。
//
// 直接照搬旧平台 `data-view/src/utils/jsonField.js`（编辑弹窗的 `type === 'json'` 列用它），
// 逻辑一字未改，只补了类型。放一份在指标中心内，避免跨视图文件夹引用
// （本轮迁移的约定：页面级组件一律在 MetricCenter 内自建）。
import type { ColumnDef } from './types'

/** 加载时格式化：合法 JSON 输出为 2 空格缩进的字符串，否则原样返回。
 *  兼容字符串与已解析对象/数组两种形态（对象形态先序列化，避免 String() 得到 '[object Object]'）。 */
export function prettyJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  const s = String(value)
  if (s.trim() === '') return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

/** 保存前校验：逐个校验 cols 中的 json 字段，合法则压缩存储。
 *  返回错误信息，全部合法时返回空字符串。 */
export function compactJsonFields(
  cols: ColumnDef[] | undefined,
  form: Record<string, unknown>,
): string {
  for (const item of cols || []) {
    if (item.type !== 'json') continue
    const v = form[item.dataIndex]
    if (v === null || v === undefined) continue
    if (String(v).trim() === '') continue
    let s: string
    if (typeof v !== 'string') {
      try {
        s = JSON.stringify(v)
      } catch (e) {
        return `[${item.title || item.dataIndex}] 不是合法的JSON: ${(e as Error).message}`
      }
    } else {
      s = v
    }
    try {
      form[item.dataIndex] = JSON.stringify(JSON.parse(s))
    } catch (e) {
      return `[${item.title || item.dataIndex}] 不是合法的JSON: ${(e as Error).message}`
    }
  }
  return ''
}

/**
 * 指标结果页的「动态列」取值：旧平台行是扁平的 `{ENTRY_ID, SOURCE_ID, K1, K2, ...}`，
 * 这里兼容地取一次（优先直接命中，其次 values 里）。
 * 空值统一按旧页表格的 `-` 展示（`原始` 列就是这么写的），由调用方决定。
 */
export function cellValue(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key]
  const values = row.values as Record<string, unknown> | undefined
  return values?.[key]
}
