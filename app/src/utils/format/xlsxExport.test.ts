import { describe, expect, it } from 'vitest'
import { buildXlsx, colLetter, xmlEscape } from './xlsxExport'

function asText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

describe('colLetter / xmlEscape', () => {
  it('列号从 0 起算：0=A，25=Z，26=AA', () => {
    expect(colLetter(0)).toBe('A')
    expect(colLetter(25)).toBe('Z')
    expect(colLetter(26)).toBe('AA')
  })

  it('单元格里的 & < > " 要转义，控制字符丢掉', () => {
    expect(xmlEscape('a&b<c>"d')).toBe('a&amp;b&lt;c&gt;&quot;d')
    expect(xmlEscape('ok\u0000x')).toBe('okx')
  })
})

describe('buildXlsx', () => {
  it('是未压缩 ZIP，工作表里能直接读到单元格文字', () => {
    const bytes = buildXlsx([['源 ID', '源名称'], ['src-1', '财经资讯']], '源列表')
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('PK\u0003\u0004')
    const text = asText(bytes)
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('源 ID')
    expect(text).toContain('财经资讯')
    expect(text).toContain('name="源列表"')
    expect(text).toContain('t="inlineStr"')
  })

  it('特殊字符进单元格后按 XML 转义，不把工作表写坏', () => {
    const text = asText(buildXlsx([['a<b&c>"d']]))
    expect(text).toContain('a&lt;b&amp;c&gt;&quot;d')
    expect(text).not.toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">a<b')
  })
})
