// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
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
import { mockSourceCreate, mockSourceUpdate, SOURCES } from './sources'

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

  it('paramDetail：0721 参数源演示参数（913 页码 / 912 栏目）可查，genValues 有值', () => {
    expect(mockParamDetail({ paramId: '913' })?.name).toBe('页码')
    expect(mockGenValues({ paramId: '913' }).length).toBeGreaterThan(0)
    expect(mockParamDetail({ paramId: '912' })?.values).toHaveLength(26)
    expect(mockGenValues({ paramId: '912' })).toEqual(mockParamDetail({ paramId: '912' })?.values)
  })
})

describe('参数绑定关系（0721 会议 T6：参数源反查绑定它的参数）', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  // mockSourceCreate 是 unshift 到模块级 SOURCES 单例，测试间不会自动重置，手动清掉本组测试建的源，
  // 避免上一条用例的绑定残留污染下一条用例的反查结果。
  afterEach(() => {
    for (let i = SOURCES.length - 1; i >= 0; i--) {
      if (SOURCES[i].sourceId.startsWith('bind-test-')) SOURCES.splice(i, 1)
    }
  })

  it('参数源保存后，paramDetail / paramPaged 都能查到反向绑定；未被引用时是空数组', () => {
    expect(mockParamDetail({ paramId: '913' })?.paramSourceRefs).toEqual([])

    const res = mockSourceCreate({
      source: {
        sourceId: 'bind-test-1', name: '绑定测试源', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C',
        kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913',
        paramRefs: [{ paramId: '913', group: null }],
      },
    })
    expect(res.ok).toBe(true)

    expect(mockParamDetail({ paramId: '913' })?.paramSourceRefs).toEqual([{ sourceId: 'bind-test-1', sourceName: '绑定测试源' }])
    const paged = mockParamPaged({ paramId: '913' })
    expect(paged.list[0]?.paramSourceRefs).toEqual([{ sourceId: 'bind-test-1', sourceName: '绑定测试源' }])
    // 没被这个源引用的参数不受影响
    expect(mockParamDetail({ paramId: '912' })?.paramSourceRefs).toEqual([])
  })

  it('多个参数源引用同一个参数时全部列出；编辑参数源改掉引用后绑定关系跟着变', () => {
    mockSourceCreate({
      source: {
        sourceId: 'bind-test-2', name: '绑定测试源二', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C',
        kind: 'param', baseUrl: 'http://base2', urlTemplate: 'http://base2-$PARAM$_912',
        paramRefs: [{ paramId: '912', group: null }],
      },
    })
    mockSourceCreate({
      source: {
        sourceId: 'bind-test-3', name: '绑定测试源三', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C',
        kind: 'param', baseUrl: 'http://base3', urlTemplate: 'http://base3-$PARAM$_912',
        paramRefs: [{ paramId: '912', group: null }],
      },
    })
    // mockSourceCreate 用 unshift 落库，新创建的排前面，反查顺序跟着是后创建的在前
    expect(mockParamDetail({ paramId: '912' })?.paramSourceRefs).toEqual([
      { sourceId: 'bind-test-3', sourceName: '绑定测试源三' },
      { sourceId: 'bind-test-2', sourceName: '绑定测试源二' },
    ])

    // 编辑「绑定测试源二」改成不再引用 912，绑定关系应实时反映（不是持久化的死快照）
    mockSourceUpdate({
      source: {
        sourceId: 'bind-test-2', name: '绑定测试源二', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C',
        kind: 'param', baseUrl: 'http://base2', urlTemplate: 'http://base2-$PARAM$_913', paramRefs: [{ paramId: '913', group: null }],
      },
    })
    expect(mockParamDetail({ paramId: '912' })?.paramSourceRefs).toEqual([{ sourceId: 'bind-test-3', sourceName: '绑定测试源三' }])
    expect(mockParamDetail({ paramId: '913' })?.paramSourceRefs).toEqual([{ sourceId: 'bind-test-2', sourceName: '绑定测试源二' }])
  })
})

describe('参数 mock（新建/编辑/复制/删除）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('新增生成两个时间，编辑保留创建时间，复制生成新时间', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-26T00:00:00Z'))
      const created = mockParamCreate({ param: { paramId: '9999', name: '时间参数', kind: 'list', values: [] } }).param!
      expect(created.createdAt).toBe('2026-10-26T00:00:00.000Z')
      expect(created.updatedAt).toBe(created.createdAt)
      vi.setSystemTime(new Date('2026-10-26T01:00:00Z'))
      const updated = mockParamUpdate({ param: { ...created, name: '修改参数', createdAt: '1970-01-01' } }).param!
      expect(updated.createdAt).toBe(created.createdAt)
      expect(updated.updatedAt).toBe('2026-10-26T01:00:00.000Z')
      vi.setSystemTime(new Date('2026-10-26T02:00:00Z'))
      expect(mockParamCopy({ paramId: created.paramId }).ok).toBe(true)
      const copy = mockParamPaged({ size: 100 }).list.find((p) => p.name === '修改参数_副本')!
      expect(copy.createdAt).toBe('2026-10-26T02:00:00.000Z')
      expect(copy.updatedAt).toBe(copy.createdAt)
    } finally {vi.useRealTimers()}
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
