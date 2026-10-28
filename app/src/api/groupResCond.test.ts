// STRUCT 条件（condJson）帮助函数的纯逻辑测试：解析容错、序列化口径、与后端
// GroupResFieldMeta.compileItem 同规则的前端预检（错误文案含"第 N 项"序号）。
import { describe, expect, it } from 'vitest'
import { condItemsError, parseCondJson, stringifyCondJson, type GroupResCondItem, type GroupResField } from './groupRes'

const FIELDS: GroupResField[] = [
  { field: 'SOURCE_ID', name: '数据源ID', type: 'num', ops: ['IN', '=', '>', '<', '>=', '<='], valueFrom: 'sourcePicker' },
  { field: 'CATEGORY_ID', name: '所属目录', type: 'num', ops: ['IN', '='], valueFrom: 'categoryTree' },
  { field: 'TAGS', name: '标签', type: 'str', ops: ['LIKE'], valueFrom: 'text' },
  { field: 'CREATE_DT', name: '创建时间', type: 'date', ops: ['>', '<', '>=', '<='], valueFrom: 'date' },
]

describe('parseCondJson', () => {
  it('标准数组原样解析', () => {
    const json = '[{"field":"CATEGORY_ID","op":"IN","values":["9009250","9009237"]}]'
    expect(parseCondJson(json)).toEqual([{ field: 'CATEGORY_ID', op: 'IN', values: ['9009250', '9009237'] }])
  })

  it('空串 / null / 非法 JSON / 非数组一律回 []（详情回显容错）', () => {
    expect(parseCondJson('')).toEqual([])
    expect(parseCondJson(null)).toEqual([])
    expect(parseCondJson(undefined)).toEqual([])
    expect(parseCondJson('{oops')).toEqual([])
    expect(parseCondJson('{"field":"A"}')).toEqual([])
  })

  it('数字 values 转字符串，缺键回退默认值，非对象元素被丢弃', () => {
    const json = '[{"field":"SOURCE_ID","op":"=","values":[430001300]},1,{"op":"IN"}]'
    expect(parseCondJson(json)).toEqual([
      { field: 'SOURCE_ID', op: '=', values: ['430001300'] },
      { field: '', op: 'IN', values: [] },
    ])
  })
})

describe('stringifyCondJson', () => {
  it('trim 并剔除空白值（与后端 compileItem 的 trim+skip 同口径）', () => {
    const items: GroupResCondItem[] = [{ field: ' CATEGORY_ID ', op: ' IN ', values: [' 9009250 ', '', '9009237'] }]
    expect(JSON.parse(stringifyCondJson(items))).toEqual([{ field: 'CATEGORY_ID', op: 'IN', values: ['9009250', '9009237'] }])
  })

  it('parse → stringify 往返一致', () => {
    const json = '[{"field":"TAGS","op":"LIKE","values":["%新闻%"]},{"field":"SOURCE_ID","op":">","values":["430001300"]}]'
    expect(stringifyCondJson(parseCondJson(json))).toBe(json)
  })
})

describe('condItemsError（对齐后端 §2.10 校验）', () => {
  const ok: GroupResCondItem[] = [{ field: 'CATEGORY_ID', op: 'IN', values: ['9009250', '9009237'] }]

  it('合法条件通过', () => {
    expect(condItemsError(ok, FIELDS)).toBeNull()
  })

  it('空数组拦截', () => {
    expect(condItemsError([], FIELDS)).toBe('请至少添加一个条件')
  })

  it('字段不在白名单 / 操作符不支持', () => {
    expect(condItemsError([{ field: 'PASSWORD', op: '=', values: ['1'] }], FIELDS)).toContain('不在可选列中')
    expect(condItemsError([{ field: 'TAGS', op: 'IN', values: ['a'] }], FIELDS)).toContain('不支持操作符')
  })

  it('values 全空白 = 值为空；非 IN 多值拦截', () => {
    expect(condItemsError([{ field: 'TAGS', op: 'LIKE', values: ['  '] }], FIELDS)).toContain('值不能为空')
    expect(condItemsError([{ field: 'SOURCE_ID', op: '>', values: ['1', '2'] }], FIELDS)).toContain('只能有一个值')
  })

  it('num 字段值必须纯数字（含负号），str/date 不要求', () => {
    expect(condItemsError([{ field: 'SOURCE_ID', op: '=', values: ['12a'] }], FIELDS)).toContain('需要一个数字值')
    expect(condItemsError([{ field: 'SOURCE_ID', op: '=', values: ['-3'] }], FIELDS)).toBeNull()
    expect(condItemsError([{ field: 'CREATE_DT', op: '>', values: ['2026-01-01 00:00:00'] }], FIELDS)).toBeNull()
    expect(condItemsError([{ field: 'TAGS', op: 'LIKE', values: ['新闻'] }], FIELDS)).toBeNull()
  })

  it('错误文案带"第 N 项"序号（第二个条件行出错时报 第 2 项）', () => {
    const err = condItemsError([...ok, { field: 'SOURCE_ID', op: '=', values: ['x'] }], FIELDS)
    expect(err).toContain('第 2 项')
  })

  it('fields 未加载（undefined）时视为白名单缺失，不放行', () => {
    expect(condItemsError(ok, undefined)).toContain('不在可选列中')
  })
})
