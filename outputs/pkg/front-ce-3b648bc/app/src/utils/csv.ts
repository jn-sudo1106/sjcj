// 前端生成 CSV 并下载（2026-09-11）。
//
// 用在"数据本来就在前端手里、后端没有对应导出接口"的场景——比如按条件查源之后，
// 侧栏那批命中源是前端算出来的，没法像数据导出那样甩给后端拼 URL。

/** 一个单元格。数字与 null 都按文本处理，导出这件事上不需要保留类型。 */
export type CsvCell = string | number | null | undefined

/**
 * 按 RFC 4180 转义一个单元格：含逗号、引号、换行时整体加引号，内部引号翻倍。
 *
 * 另有一条不在 RFC 里但必须做的：**以 = + - @ 开头的值前面补一个单引号**。
 * Excel / WPS 会把这类值当公式执行（CSV 注入），源名称是用户可改的自由文本，
 * 一个叫 `=cmd|...` 的源就能让打开这份表的人中招。
 */
export function csvCell(value: CsvCell): string {
  const s = value == null ? '' : String(value)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * 拼一份 CSV 文本。
 *
 * 行尾用 CRLF、开头带 BOM：少了 BOM，Excel 会按本地编码打开，中文列名直接乱码——
 * 这是导出功能最常见的投诉，默认就带上。
 */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))]
  return `﻿${lines.join('\r\n')}`
}

/** 触发浏览器下载。文件名里的非法字符会被替换掉，避免某些系统上存不下。 */
export function downloadCsv(filename: string, content: string): void {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = safeName.endsWith('.csv') ? safeName : `${safeName}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 在部分浏览器上会让下载拿不到内容，放到下一轮事件循环
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** `20260911` 这样的日期后缀，拼在导出文件名里 */
export function csvDateTag(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
