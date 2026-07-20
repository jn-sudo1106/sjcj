// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import {
  mockAddParamValues,
  mockDeleteParamValue,
  mockDeleteParams,
  mockGenValues,
  mockParamCopy,
  mockParamCreate,
  mockParamDetail,
  mockParamPaged,
  mockParamUpdate,
} from './params'

describe('参数 mock（0711 R9：URL 参数场景）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('paramDetail：懂车帝演示参数（1035~1039）可查', () => {
    expect(mockParamDetail({ paramId: '1036' })?.name).toBe('懂车帝-级别参数(series_type)')
    expect(mockGenValues({ paramId: '1036' })).toContain('SUV')
  })

  it('paramDetail：不存在的参数返回 null，不静默兜底成别的参数（0711 修复）', () => {
    expect(mockParamDetail({ paramId: 'ghost-param-id' })).toBeNull()
  })

  it('paramCreate：成功创建后 paramDetail/paramPaged 都能查到；重复 id 报错', () => {
    const res = mockParamCreate({ param: { paramId: '9999', name: '测试参数', kind: 'list', values: ['a', 'b'] } })
    expect(res.ok).toBe(true)
    expect(mockParamDetail({ paramId: '9999' })?.name).toBe('测试参数')
    expect(mockParamPaged({ keyword: '9999', size: 10 }).list.some((p) => p.paramId === '9999')).toBe(true)

    const dup = mockParamCreate({ param: { paramId: '9999', name: '重复', kind: 'list', values: [] } })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('已存在')
  })

  it('paramCreate：缺少必填字段报错', () => {
    expect(mockParamCreate({ param: { paramId: '', name: '', kind: 'list' } }).ok).toBe(false)
  })

  it('paramCreate：未传 ID 时生成 ID，并保留分组、默认值和日期序列定义', () => {
    const res = mockParamCreate({
      param: {
        name: '近七日',
        group: '公告',
        kind: 'date_sequence',
        dateExpr: '$CUR_DATE,-1,yyyy-MM-dd',
        seq: { start: 1, end: 7, step: 1 },
        defaultValue: '2026-07-11',
      },
    })

    expect(res.ok).toBe(true)
    expect(res.param?.paramId).toMatch(/^param-/)
    expect(res.param).toMatchObject({ group: '公告', kind: 'date_sequence', defaultValue: '2026-07-11' })
    expect(mockGenValues({ paramId: res.param?.paramId })).toHaveLength(7)
  })

  it('paramPaged 支持参数 ID 与名称筛选', () => {
    expect(mockParamPaged({ paramId: '1036', size: 10 }).list.map((param) => param.paramId)).toEqual(['1036'])
    expect(mockParamPaged({ paramName: '年限参数', size: 10 }).list.map((param) => param.paramId)).toEqual(['1038'])
  })

  it('paramUpdate：更新全局定义但保留参数 ID', () => {
    const created = mockParamCreate({ param: { name: '可编辑参数', kind: 'list', values: ['旧值'] } }).param!
    const res = mockParamUpdate({ param: { ...created, group: '采集', values: ['新值'], defaultValue: '新值' } })

    expect(res).toMatchObject({ ok: true, param: { paramId: created.paramId, group: '采集', defaultValue: '新值' } })
    expect(mockParamDetail({ paramId: created.paramId })?.values).toEqual(['新值'])
  })

  it('参数值、新副本和删除在 mock 中真实反映到列表/详情', () => {
    const created = mockParamCreate({ param: { name: '操作测试', kind: 'list', values: ['旧值'] } }).param!
    expect(mockAddParamValues({ paramId: created.paramId, paramValues: '新值' }).ok).toBe(true)
    const detail = mockParamDetail({ paramId: created.paramId })!
    expect(detail.values).toEqual(['旧值', '新值'])

    expect(mockDeleteParamValue({ valueId: detail.valueItems![0].valueId }).ok).toBe(true)
    expect(mockParamDetail({ paramId: created.paramId })?.values).toEqual(['新值'])

    expect(mockParamCopy({ paramId: created.paramId }).ok).toBe(true)
    expect(mockParamPaged({ paramName: '操作测试', size: 10 }).total).toBe(2)

    expect(mockDeleteParams({ paramIds: [created.paramId] }).ok).toBe(true)
    expect(mockParamDetail({ paramId: created.paramId })).toBeNull()
  })
})
