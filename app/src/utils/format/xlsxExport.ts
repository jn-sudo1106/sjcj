/**
 * 前端生成一份单表 xlsx（不引入 exceljs / xlsx 依赖）。
 *
 * 旧平台源列表本身没有后端导出端点，导出走浏览器；0831 源视图要的是
 * 按查询条件全量下载。这里只覆盖「二维字符串 → 一个工作表」，单元格用
 * inlineStr，避免再维护 sharedStrings。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    table[i] = crc >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(n: number): Uint8Array {
  const out = new Uint8Array(2)
  out[0] = n & 0xff
  out[1] = (n >>> 8) & 0xff
  return out
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  out[0] = n & 0xff
  out[1] = (n >>> 8) & 0xff
  out[2] = (n >>> 16) & 0xff
  out[3] = (n >>> 24) & 0xff
  return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function dosDateTime(now = new Date()): { time: number; date: number } {
  const year = Math.max(1980, now.getFullYear())
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  }
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>, now = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = utf8(file.name)
    const crc = crc32(file.data)
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(time), u16(date),
      u32(crc), u32(file.data.length), u32(file.data.length),
      u16(name.length), u16(0), name, file.data,
    ])
    locals.push(local)
    centrals.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(time), u16(date),
      u32(crc), u32(file.data.length), u32(file.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
      name,
    ]))
    offset += local.length
  }
  const central = concat(centrals)
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ])
  return concat([...locals, central, eocd])
}

export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 0 起算的列号 → A / Z / AA */
export function colLetter(index: number): string {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\[\]:*?/\\]/g, '').slice(0, 31).trim()
  return cleaned || 'Sheet1'
}

function sheetXml(rows: string[][]): string {
  const body = rows.map((row, rowIndex) => {
    const r = rowIndex + 1
    const cells = row.map((cell, colIndex) => {
      const ref = `${colLetter(colIndex)}${r}`
      const text = xmlEscape(cell == null ? '' : String(cell))
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
    }).join('')
    return `<row r="${r}">${cells}</row>`
  }).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

function workbookXml(sheetName: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  )
}

const CONTENT_TYPES = (
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>'
)

const ROOT_RELS = (
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'
)

const WORKBOOK_RELS = (
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>'
)

export function buildXlsx(rows: string[][], sheetName = 'Sheet1'): Uint8Array {
  const name = safeSheetName(sheetName)
  return zipStore([
    { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
    { name: '_rels/.rels', data: utf8(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: utf8(workbookXml(name)) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(WORKBOOK_RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(rows)) },
  ])
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function downloadXlsx(filename: string, rows: string[][], sheetName = 'Sheet1'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new Error('downloadXlsx 只能在浏览器环境调用')
  }
  // TS 5.x 下 Uint8Array<ArrayBufferLike> 与 BlobPart 的 ArrayBufferView 约束对不上，拷一份保证 buffer 是 ArrayBuffer。
  const bytes = buildXlsx(rows, sheetName)
  const blob = new Blob([bytes.slice()], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
