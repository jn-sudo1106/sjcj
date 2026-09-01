import { describe, expect, it } from 'vitest'
import { compileCond, fieldLabel, parseCond, type CondField } from './condCompile'

const fields: CondField[] = [
  { prop: 'title', columnName: 'K1', desc: '标题', type: 'string' },
  { prop: 'count', columnName: 'K8', desc: '数量', type: 'number' },
]

describe('condCompile', () => {
  it('LIKE 自动补引号和通配符，文案与列头一致', () => {
    expect(fieldLabel(fields[0])).toBe('标题-K1')
    expect(compileCond([{ field: 'title', op: 'LIKE', value: '金融' }], 'AND', fields)).toBe("K1 LIKE '%金融%'")
  })

  it('等号给字符串加引号，数值型字段不加', () => {
    expect(compileCond([{ field: 'K1', op: '=', value: '金融' }], 'AND', fields)).toBe("K1 = '金融'")
    expect(compileCond([{ field: 'K8', op: '>', value: '12' }], 'AND', fields)).toBe('K8 > 12')
  })

  it('值里的单引号转义，IS NULL 不需要值', () => {
    expect(compileCond([{ field: 'K1', op: '=', value: "O'Brien" }], 'AND', fields)).toBe("K1 = 'O''Brien'")
    expect(compileCond([{ field: 'K1', op: 'IS NULL', value: '' }], 'AND', fields)).toBe('K1 IS NULL')
  })

  it('能解析自己生成的 SQL；手改非法语法返回 null', () => {
    const sql = compileCond(
      [{ field: 'K1', op: 'LIKE', value: '金融' }, { field: 'K8', op: '>', value: '1' }],
      'AND',
      fields,
    )
    expect(parseCond(sql, fields)).toEqual({
      joiner: 'AND',
      rows: [
        { field: 'K1', op: 'LIKE', value: '金融' },
        { field: 'K8', op: '>', value: '1' },
      ],
    })
    expect(parseCond("K1 LIKE 金融", fields)).toBeNull()
  })
})
