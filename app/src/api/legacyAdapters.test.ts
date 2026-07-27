import { describe, expect, it } from 'vitest'
import {
  configFromLegacy,
  configToLegacy,
  dataRowFromLegacy,
  dataTableFromLegacy,
  entryTypeFromLegacy,
  entryTypeGroupFromLegacy,
  entryTypeToLegacy,
  paramFromLegacy,
  paramPageFromLegacy,
  paramToLegacy,
} from './legacyAdapters'

describe('旧平台参数模型适配', () => {
  it('把旧参数类型和值明细转换为新页面模型', () => {
    const param = paramFromLegacy({
      paramId: 1035,
      paramName: '价格区间',
      batchId: '车型',
      paramType: 'list',
      values: [{ valueId: 7, seq: 1, paramValue: '5万以下' }],
    })

    expect(param).toMatchObject({
      paramId: '1035',
      name: '价格区间',
      group: '车型',
      kind: 'list',
      values: ['5万以下'],
      valueItems: [{ valueId: '7', seq: 1, value: '5万以下' }],
    })
  })

  it('转换序列定义并保持旧平台字段名', () => {
    const param = paramFromLegacy({
      paramId: '20',
      paramName: '页码',
      paramType: 'seq',
      valueDef: '{"start":1,"end":10,"step":2}',
    })
    expect(param.seq).toEqual({ start: 1, end: 10, step: 2 })
    expect(paramToLegacy(param)).toMatchObject({
      paramId: '20',
      paramName: '页码',
      paramType: 'seq',
      valueDef: '{"start":1,"end":10,"step":2}',
    })
  })

  it('valueDef 非严格 JSON（裸键名）也能解析出序列', () => {
    const param = paramFromLegacy({
      paramId: '21',
      paramName: '旧序列',
      paramType: 'seq',
      valueDef: "{start:1,end:10,step:2}",
    })
    expect(param.seq).toEqual({ start: 1, end: 10, step: 2 })
  })

  it('valueDef 非法内容时 seq 为 undefined，不抛异常', () => {
    const param = paramFromLegacy({
      paramId: '22',
      paramName: '损坏数据',
      paramType: 'seq',
      valueDef: 'not a valid def at all',
    })
    expect(param.seq).toBeUndefined()
  })

  it('转换分页列表', () => {
    const page = paramPageFromLegacy({ total: 1, list: [{ paramId: '1', paramName: '日期', paramType: 'date' }] })
    expect(page).toEqual({
      total: 1,
      list: [expect.objectContaining({ paramId: '1', name: '日期', kind: 'date' })],
    })
  })
})

describe('旧平台配置模型适配', () => {
  it('转换配置基础字段、状态和绑定参数', () => {
    const config = configFromLegacy({
      configId: 81909,
      configName: '评论抓取',
      configUrl: 'https://example.com',
      entryTypeId: 2001,
      enable: 0,
      templetCode: 'login',
      isMulti: 0,
      params: [{ id: 1, paramId: 8, paramName: '页码' }],
    })

    expect(config).toMatchObject({
      configId: '81909',
      name: '评论抓取',
      url: 'https://example.com',
      entryTypeId: '2001',
      enabled: true,
      isLogin: true,
      isDetail: true,
      paramRefs: ['8'],
    })
    expect(configToLegacy(config)).toMatchObject({
      configId: '81909',
      configName: '评论抓取',
      entryTypeId: '2001',
    })
  })
})

describe('旧平台实体表模型适配', () => {
  it('dedup 按 keyField 匹配 columnName 派生（接口本身不返回 uniqueKey）', () => {
    const entry = entryTypeFromLegacy({
      entryTypeId: 2102157,
      tableName: 'sense_data.TB_ZFB_COMMENT',
      typeName: '支付宝评论',
      keyField: 'K1',
      items: [
        { itemId: 1, itemCode: 'feed_id', itemName: '评论 ID', columnName: 'K1', dataType: 'string', seq: 1 },
        { itemId: 2, itemCode: 'code', itemName: '基金代码', columnName: 'K2', dataType: 'string', seq: 2 },
      ],
    })
    expect(entry.fields[0]).toMatchObject({ columnName: 'K1', dedup: true })
    expect(entry.fields[1]).toMatchObject({ columnName: 'K2', dedup: false })
  })

  it('dedup 支持多字段去重（keyField 逗号分隔）', () => {
    const entry = entryTypeFromLegacy({
      entryTypeId: 2101020,
      tableName: 'sense_data.TB_STOCK_QUOTE',
      keyField: 'K1,K4',
      items: [
        { itemCode: 'code', columnName: 'K1', seq: 1 },
        { itemCode: 'price', columnName: 'K2', seq: 2 },
        { itemCode: 'ts', columnName: 'K4', seq: 3 },
      ],
    })
    expect(entry.fields.filter((f) => f.dedup).map((f) => f.columnName)).toEqual(['K1', 'K4'])
  })

  it('keyField 为空时全部字段 dedup=false，不抛异常', () => {
    const entry = entryTypeFromLegacy({
      entryTypeId: 2100001,
      tableName: 'sense_data.TB_NO_KEY',
      items: [{ itemCode: 'a', columnName: 'K1', seq: 1 }],
    })
    expect(entry.keyField).toBeUndefined()
    expect(entry.fields[0].dedup).toBe(false)
  })

  it('记录若已带 uniqueKey（如 mock 新形态数据）优先采用，不按 keyField 覆盖', () => {
    const entry = entryTypeFromLegacy({
      entryTypeId: 2100002,
      tableName: 'sense_data.TB_OVERRIDE',
      keyField: 'K1',
      items: [{ itemCode: 'a', columnName: 'K1', uniqueKey: false, seq: 1 }],
    })
    expect(entry.fields[0].dedup).toBe(false)
  })

  it('entryTypeFromLegacy 对已是新形态的数据（mock 分页结果）原样直通，不二次转换', () => {
    const alreadyNew = { tableId: '9', tableName: 't', fields: [{ prop: 'a', desc: 'A', type: 'string', required: false, dedup: true }] }
    expect(entryTypeFromLegacy(alreadyNew)).toBe(alreadyNew)
  })

  it('entryTypeToLegacy 往返：字段名映射、uniqueKey 回填一致', () => {
    const entry = entryTypeFromLegacy({
      entryTypeId: 2102157,
      tableName: 'sense_data.TB_ZFB_COMMENT',
      typeName: '支付宝评论',
      keyField: 'K1',
      remark: '备注',
      state: 'AC',
      items: [
        { itemId: 1, itemCode: 'feed_id', itemName: '评论 ID', columnName: 'K1', dataType: 'string', width: 160, seq: 1 },
      ],
    })
    const legacy = entryTypeToLegacy(entry)
    expect(legacy).toMatchObject({
      entryTypeId: '2102157',
      typeName: '支付宝评论',
      tableName: 'sense_data.TB_ZFB_COMMENT',
      keyField: 'K1',
      remark: '备注',
      state: 'AC',
    })
    expect(legacy.items).toMatchObject([
      { itemId: '1', itemCode: 'feed_id', itemName: '评论 ID', columnName: 'K1', dataType: 'string', width: 160, uniqueKey: true, seq: 1 },
    ])
  })

  it('entryTypeToLegacy 新建（无 tableId）时不带 entryTypeId', () => {
    const legacy = entryTypeToLegacy({ tableId: '', tableName: 'tb_new', fields: [] })
    expect(legacy.entryTypeId).toBeUndefined()
  })
})

describe('旧平台实体数据行适配', () => {
  it('dataRowFromLegacy：values 排除 systemKeys，title/summary 用业务字段推导', () => {
    const row = dataRowFromLegacy({
      ENTRY_ID: '1042',
      SOURCE_ID: 'src-7',
      CONFIG_ID: 'cfg-1',
      STATE: 'C',
      NEXT_FLAG: '1',
      title: '新闻标题',
      pub_date: '2026-07-17',
    })
    // systemKeys 不应出现在 values
    expect(row.values).not.toHaveProperty('ENTRY_ID')
    expect(row.values).not.toHaveProperty('SOURCE_ID')
    expect(row.values).not.toHaveProperty('CONFIG_ID')
    expect(row.values).not.toHaveProperty('STATE')
    expect(row.values).not.toHaveProperty('NEXT_FLAG')
    // 业务字段保留
    expect(row.values).toMatchObject({ title: '新闻标题', pub_date: '2026-07-17' })
    // 标量字段从 record 取
    expect(row.dataId).toBe('1042')
    expect(row.sourceId).toBe('src-7')
    expect(row.state).toBe('C')
    expect(row.title).toBe('新闻标题')
  })

  it('dataRowFromLegacy：业务字段不存在时回退到 ENTRY_ID 作为 title', () => {
    const row = dataRowFromLegacy({ ENTRY_ID: 'only-id' })
    expect(row.title).toBe('only-id')
    expect(row.values).not.toHaveProperty('ENTRY_ID')
  })

  it('dataRowFromLegacy：K0 属系统列（原始 JSON ID），K1 起才是动态值列', () => {
    const row = dataRowFromLegacy({ ENTRY_ID: '1', K0: 'json-771', K1: '正文', K10: '尾列' })
    expect(row.k0).toBe('json-771')
    expect(row.values).toEqual({ K1: '正文', K10: '尾列' })
  })

  it('dataRowFromLegacy：CATEGORY_ID 缺失时 categoryId 为空（父 ID 列据此判不可点）', () => {
    const row = dataRowFromLegacy({ ENTRY_ID: '1', PARENT_ID: '412' })
    expect(row.parentId).toBe('412')
    expect(row.categoryId).toBeUndefined()
  })

  it('dataRowFromLegacy：时间列与后续标识不落进 values', () => {
    const row = dataRowFromLegacy({
      ENTRY_ID: '1', NEXT_FLAG: '-1', DETAIL_ID: 'TK-1',
      CREATE_DT: '2026-07-18 09:12:00', UPDATE_DT: '2026-07-18 10:00:00', K1: '正文',
    })
    expect(row).toMatchObject({
      nextFlag: '-1', detailId: 'TK-1',
      createDt: '2026-07-18 09:12:00', updateDt: '2026-07-18 10:00:00',
    })
    expect(row.values).toEqual({ K1: '正文' })
  })
})

describe('选表分组与动态表结构适配（E 包 T1b）', () => {
  it('entryTypeGroupFromLegacy：四个分组各自转换，list3 按旧前端行为反转', () => {
    const group = entryTypeGroupFromLegacy({
      main: [{ entryTypeId: '1', tableName: 't1' }],
      list1: [{ entryTypeId: '2', tableName: 't2' }],
      list2: [],
      list3: [{ entryTypeId: '3', tableName: 't3' }, { entryTypeId: '4', tableName: 't4' }],
    })
    expect(group.main).toEqual([expect.objectContaining({ tableId: '1' })])
    expect(group.list1).toEqual([expect.objectContaining({ tableId: '2' })])
    expect(group.list2).toEqual([])
    // 源顺序 3,4 → 反转后 4,3
    expect(group.list3.map((e) => e.tableId)).toEqual(['4', '3'])
  })

  it('entryTypeGroupFromLegacy：分组键缺失时按空数组处理，不抛错', () => {
    const group = entryTypeGroupFromLegacy({ main: [{ entryTypeId: '1' }] })
    expect(group.list1).toEqual([])
    expect(group.list2).toEqual([])
    expect(group.list3).toEqual([])
  })

  it('dataTableFromLegacy：透传 columnName/required/width（动态列渲染依据）', () => {
    const table = dataTableFromLegacy({
      entryTypeId: '1042',
      tableName: 'sense_data.TB_NEWS',
      items: [
        { itemCode: 'title', itemName: '标题', columnName: 'K1', dataType: 'string', width: 140, required: true },
        { itemCode: 'raw', itemName: '原始', columnName: 'K9', dataType: 'string', width: 80, required: false },
      ],
    })
    expect(table.fields).toEqual([
      expect.objectContaining({ prop: 'title', columnName: 'K1', required: true, width: 140 }),
      expect.objectContaining({ prop: 'raw', columnName: 'K9', required: false, width: 80 }),
    ])
  })
})
