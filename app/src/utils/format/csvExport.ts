// CSV 导出工具：通用 toCsv + 实体表字段专用 exportFieldsAsCsv。
// 引用：表 ID 列表迁移 §1.5（导出字段 CSV），《表ID列表迁移_开发方案_2026-07-17.md》。
//
// 设计要点：
// - 通用 toCsv 处理 RFC 4180 兼容的转义（双引号 / 换行 / 逗号）+ UTF-8 BOM（Excel 中文不乱码）
// - exportFieldsAsCsv 封装 EntryType → CSV 行的转换 + 浏览器下载触发
// - 列宽兜底走 constants/entry.getEffectiveWidth，与编辑器/提取字段保持一致

import type { EntryType } from '@/api/types'
import { getEffectiveWidth } from '@/constants/entry'

/**
 * 把二维字符串数组转成 RFC 4180 兼容的 CSV 文本。
 *
 * 转义规则：
 * - 任何字段值整体加双引号（最稳，避免意外字符触发 Excel 解析问题）
 * - 字段值内的双引号 → `""`
 * - 行分隔符 `\n`（CRLF 也兼容，Excel / Numbers / WPS 都吃）
 *
 * 编码：UTF-8 BOM 前缀（`\uFEFF`），让 Excel 打开中文 CSV 不乱码。
 */
export function toCsv(rows: string[][]): string {
  const body = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  return `﻿${body}`
}

/**
 * 触发浏览器下载 CSV 文件。
 *
 * 浏览器侧触发，避免在 jsdom 测试里调用 `a.click()`（无意义），由调用方判断环境。
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    // 非浏览器环境（SSR / Node 测试）直接抛错，让调用方决定
    throw new Error('downloadCsv 只能在浏览器环境调用')
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 实体表 schema 导出 CSV 的列定义。
 * 序号 / 内部ID / 数据库列 / 字段编码 / 字段名称 / 数据类型
 */
const ENTRY_FIELD_CSV_HEADER = ['序号', '内部ID', '数据库列', '字段编码', '字段名称', '数据类型']

/**
 * 把 EntryType 的字段列表转成 CSV 二维数组（不含 BOM，由 toCsv 统一加）。
 *
 * 数据类型列：string 类型字段显示为 `varchar(width)`，width 走 getEffectiveWidth 兜底；
 * 其他类型（text/longtext）直接显示原类型名。
 */
export function entryFieldsToRows(entry: EntryType): string[][] {
  const rows = entry.fields.map((f, i) => [
    String(f.seq ?? i + 1),
    f.itemId ?? '',
    f.columnName ?? '',
    f.prop,
    f.desc,
    f.type === 'string' ? `varchar(${getEffectiveWidth(f.width)})` : f.type,
  ])
  return [ENTRY_FIELD_CSV_HEADER, ...rows]
}

/**
 * 实体表 schema 导出 CSV 完整流程：构造 + 下载。
 *
 * 文件名：`表字段_{tableName}_{YYYYMMDD}.csv`，tableName 去掉 schema 前缀（如 `sense_data.TB_X` → `TB_X`）。
 */
export function exportFieldsAsCsv(entry: EntryType): void {
  const tableNameShort = entry.tableName.includes('.')
    ? entry.tableName.split('.').slice(1).join('.')
    : entry.tableName
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const csv = toCsv(entryFieldsToRows(entry))
  downloadCsv(`表字段_${tableNameShort}_${date}.csv`, csv)
}
