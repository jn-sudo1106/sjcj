// 1105 会议：部分表只有表定义、数据库里没有实体表（迁移时没导全），点开查数据直接报 SQL 错。
// 后端还没有返回「表缺失」状态字段，前端先按数据库报错文本识别，给出可读的提示。
// MySQL 1146 / ClickHouse UNKNOWN_TABLE（code 60）/ 通用「表不存在」文案都算。
const MISSING_TABLE_PATTERNS = [
  /doesn'?t exist/i,
  /unknown table/i,
  /no such table/i,
  /\b1146\b/,
  /UNKNOWN_TABLE/,
  /表.{0,40}不存在/,
]

export function isMissingTableError(message: string): boolean {
  return MISSING_TABLE_PATTERNS.some((pattern) => pattern.test(message))
}

export const MISSING_TABLE_HINT = '数据库里没有这张表的实体表（只有表定义），暂无数据可查'
