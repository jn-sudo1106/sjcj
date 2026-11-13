/**
 * SQL 条件片段的清理。
 *
 * 这里的输入是**拼进 WHERE 的片段**，不是一条完整语句：
 * `buildLegacyMore` 会把它和时间范围用 AND 串起来，带时间范围时还会包成 `(条件)`。
 * 用户常常直接从数据库客户端复制语句过来，末尾带着 `;`——那在片段语境里一律是语法错误
 * （包进括号后更明显：`(... <> LOWER(TRIM(k23));)`），后端直接报错。
 */

/**
 * 去掉末尾的分号（含分号之间与之后的空白）。
 *
 * **只削末尾**：字符串字面量里的分号必须原样保留，例如 `K2 LIKE '%;%'` 不能动。
 */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/(?:\s*;)+\s*$/, '')
}
