import { describe, expect, it } from 'vitest'
import {
  configFromLegacy,
  configToLegacy,
  dataRowFromLegacy,
  dataTableFromLegacy,
  entryDetailFromLegacy,
  entryTypeFromLegacy,
  entryTypeGroupFromLegacy,
  entryTypeToLegacy,
  paramFromLegacy,
  paramPageFromLegacy,
  paramToLegacy,
  ruleOrchestrationDetailFromLegacy,
  parseRuleOrchestrationStreamText,
  pickRuleIdFromComposeList,
  ruleOrchestrationGenerateFormBody,
  ruleOrchestrationGenerateFromLegacy,
  ruleOrchestrationGenerateToLegacy,
  ruleOrchestrationSaveMetaFromLegacy,
  ruleOrchestrationSaveMetaToLegacy,
  ruleOrchestrationSaveScriptFromLegacy,
  ruleOrchestrationSaveScriptToLegacy,
  ruleOrchestrationTestFromLegacy,
  ruleOrchestrationTestToLegacy,
  summaryRowFromLegacy,
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

  it('entryTypeToLegacy：required 数值化为 0/1（真实联调实测，后端 CfgEntryItem.required 按 Integer 反序列化，传布尔会 500）', () => {
    const legacy = entryTypeToLegacy({
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: true, columnName: 'K1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, columnName: 'K2', seq: 2 },
      ],
    })
    expect(legacy.items).toMatchObject([
      { itemCode: 'a', required: 1 },
      { itemCode: 'b', required: 0 },
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
  it('entryTypeGroupFromLegacy：main 是默认选中表 ID（标量），list1/list2/list3 才是分组列表；list3 按旧前端行为反转', () => {
    const group = entryTypeGroupFromLegacy({
      main: '2',
      list1: [{ entryTypeId: '2', tableName: 't2' }],
      list2: [],
      list3: [{ entryTypeId: '3', tableName: 't3' }, { entryTypeId: '4', tableName: 't4' }],
    })
    expect(group.main).toBe('2')
    expect(group.list1).toEqual([expect.objectContaining({ tableId: '2' })])
    expect(group.list2).toEqual([])
    // 源顺序 3,4 → 反转后 4,3
    expect(group.list3.map((e) => e.tableId)).toEqual(['4', '3'])
  })

  it('entryTypeGroupFromLegacy：分组键缺失时按空数组处理，main 缺失时为 undefined，不抛错', () => {
    const group = entryTypeGroupFromLegacy({ main: '1' })
    expect(group.list1).toEqual([])
    expect(group.list2).toEqual([])
    expect(group.list3).toEqual([])

    const empty = entryTypeGroupFromLegacy({})
    expect(empty.main).toBeUndefined()
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

describe('数据详情 / 统计行适配（E 包 T1c）', () => {
  it('entryDetailFromLegacy：showItems/subs 从行字段中摘出，不落进 row.values', () => {
    const detail = entryDetailFromLegacy({
      ENTRY_ID: '88231', SOURCE_ID: '161725', K1: '正文',
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '正文', value: '正文' }],
      subs: [{ ENTRY_ID: '88232', SOURCE_ID: '161725' }],
    })
    expect(detail.row).toMatchObject({ dataId: '88231', sourceId: '161725' })
    expect(detail.row.values).toEqual({ K1: '正文' })
    expect(detail.showItems).toEqual([{ itemId: '1', columnName: 'K1', itemName: '正文', value: '正文' }])
    expect(detail.subs).toEqual([expect.objectContaining({ dataId: '88232' })])
  })

  it('entryDetailFromLegacy：subs 缺失时为 undefined，不是空数组', () => {
    const detail = entryDetailFromLegacy({ ENTRY_ID: '1', showItems: [] })
    expect(detail.subs).toBeUndefined()
    expect(detail.showItems).toEqual([])
  })

  it('summaryRowFromLegacy：动态分组列原样保留，CNT 规整为 number', () => {
    const row = summaryRowFromLegacy({ K2: '161725', K3: '2026-07-18', CNT: '42' })
    expect(row).toEqual({ K2: '161725', K3: '2026-07-18', CNT: 42 })
  })
})

// 以下 fixture 取自 vrule 线上实测（2026-08-01，getComposeById?id=173 / fastapi/execute/dynamic），
// 详见 0801-规则编排迁入规则处理节点_开发设计方案.md §4.2/§4.4。
describe('规则编排模型适配（vrule，0801 方案 §4）', () => {
  const REAL_DETAIL_173 = {
    id: 173,
    ruleName: '邮箱附件转换指标数据规则',
    nlDescribe: '【转换规则】…',
    state: 1,
    codePath: '/code01/20260721/1784639958876.py',
    createTime: '2026-07-21 21:18:54',
    systemPrompt: '## 核心逻辑…',
    targetTable: 'sense_data.TB_email_XQ',
    inputFields: 'date,time_period,excel_name,category1,category2,zb_name,zb_value,zb_tb,zb_unit,tb_unit,frequence,source,sheet_name,table_name',
    outputFields: 'information_publish_date,end_date,indicator_code,indicator_data,information_source_title,insert_time_original',
    ruleType: '数据处理',
    dataSource: 'dp-wwdata',
    userCode: 'gf',
  }

  it('ruleOrchestrationDetailFromLegacy：id→ruleId 转 string，state 1→enabled true，targetTable→inputTable', () => {
    const cfg = ruleOrchestrationDetailFromLegacy(REAL_DETAIL_173)
    expect(cfg.mode).toBe('ref')
    expect(cfg.ruleId).toBe('173')
    expect(cfg.name).toBe('邮箱附件转换指标数据规则')
    expect(cfg.describe).toBe('【转换规则】…')
    expect(cfg.enabled).toBe(true)
    expect(cfg.scriptPath).toBe('/code01/20260721/1784639958876.py')
    expect(cfg.inputTable).toBe('sense_data.TB_email_XQ')
    expect(cfg.dataSource).toBe('dp-wwdata')
    expect(cfg.inputFields).toHaveLength(14)
    expect(cfg.inputFields).toContain('zb_value')
    expect(cfg.outputFields).toEqual([
      'information_publish_date', 'end_date', 'indicator_code',
      'indicator_data', 'information_source_title', 'insert_time_original',
    ])
    // 详情响应无 outputTable / script 字段（拍板 #5 / 需单独读脚本），不应凭空捏造
    expect(cfg.outputTable).toBeUndefined()
    expect(cfg.script).toBeUndefined()
  })

  it('ruleOrchestrationDetailFromLegacy：state 非 1 时 enabled 为 false；逗号串为空时字段数组为空', () => {
    const cfg = ruleOrchestrationDetailFromLegacy({ ...REAL_DETAIL_173, state: 0, inputFields: '', outputFields: undefined })
    expect(cfg.enabled).toBe(false)
    expect(cfg.inputFields).toEqual([])
    expect(cfg.outputFields).toEqual([])
  })

  it('ruleOrchestrationSaveMetaToLegacy：字段数组 join 逗号串，userCode 由调用方显式传入', () => {
    const body = ruleOrchestrationSaveMetaToLegacy(
      {
        mode: 'new',
        name: '邮箱附件转换指标数据规则',
        describe: '……',
        dataSource: 'dp-wwdata',
        inputTable: 'sense_data.TB_email_XQ',
        outputTable: 'sense_data.TB_INDICATOR_DATA',
        inputFields: ['date', 'zb_value'],
        outputFields: ['end_date', 'indicator_data'],
      },
      'ht_poc',
    )
    expect(body).toEqual({
      state: 1,
      ruleType: '数据处理',
      dataSource: 'dp-wwdata',
      userCode: 'ht_poc',
      ruleName: '邮箱附件转换指标数据规则',
      targetTable: 'sense_data.TB_email_XQ',
      outputTable: 'sense_data.TB_INDICATOR_DATA',
      inputFields: 'date,zb_value',
      outputFields: 'end_date,indicator_data',
    })
  })

  it('ruleOrchestrationTestToLegacy：取 rows[0] 作为 params，timeout 固定 300', () => {
    const body = ruleOrchestrationTestToLegacy({
      ruleId: '173',
      inputTable: 'sense_data.TB_email_XQ',
      inputFields: ['date', 'zb_value'],
      outputFields: ['end_date'],
      rows: [{ date: '2025年', zb_value: '49.7' }],
    })
    expect(body).toEqual({ rule_id: '173', params: { date: '2025年', zb_value: '49.7' }, timeout: 300 })
  })

  it('ruleOrchestrationTestFromLegacy：一条输入两条输出（实测 173 · zb_value + zb_tb 同时有值）', () => {
    const result = ruleOrchestrationTestFromLegacy({
      success: true,
      result: [
        { information_publish_date: null, end_date: null, indicator_data: '49.700000' },
        { information_publish_date: null, end_date: null, indicator_data: '23.630000' },
      ],
      error: null,
      execution_time: 0.30226659774780273,
      code_hash: 'eae9f5bd009626d4835e0c695d158dec',
    })
    expect(result.success).toBe(true)
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs?.[0].indicator_data).toBe('49.700000')
    expect(result.outputs?.[1].indicator_data).toBe('23.630000')
    expect(result.executionTime).toBeCloseTo(0.302, 3)
    expect(result.codeHash).toBe('eae9f5bd009626d4835e0c695d158dec')
  })

  it('ruleOrchestrationTestFromLegacy：result 缺失时 outputs 为空数组，不是 undefined', () => {
    const result = ruleOrchestrationTestFromLegacy({ success: false, error: '脚本为空', execution_time: 0 })
    expect(result.outputs).toEqual([])
    expect(result.error).toBe('脚本为空')
  })

  it('ruleOrchestrationSaveScriptToLegacy：映射为旧接口固定字段名 codeFileName/scriptCode', () => {
    const body = ruleOrchestrationSaveScriptToLegacy({
      ruleId: '173',
      scriptPath: '/code01/20260801/123.py',
      script: 'def main(date):\n    return {}',
    })
    expect(body).toEqual({
      ruleId: '173',
      codeFileName: '/code01/20260801/123.py',
      scriptCode: 'def main(date):\n    return {}',
    })
  })

  it('ruleOrchestrationSaveMetaFromLegacy：兼容裸 id / {id} / {ruleId}', () => {
    expect(ruleOrchestrationSaveMetaFromLegacy(173)).toEqual({ ruleId: '173', message: '业务规则已保存' })
    expect(ruleOrchestrationSaveMetaFromLegacy({ id: 173, msg: 'ok' })).toEqual({ ruleId: '173', message: 'ok' })
    expect(ruleOrchestrationSaveMetaFromLegacy({ ruleId: 'orch-1' }).ruleId).toBe('orch-1')
  })

  it('ruleOrchestrationSaveScriptFromLegacy：缺省回退请求侧 path', () => {
    expect(ruleOrchestrationSaveScriptFromLegacy(null, { ruleId: '173', scriptPath: '/a.py' })).toEqual({
      ruleId: '173',
      scriptPath: '/a.py',
      message: '规则脚本已保存',
    })
    expect(ruleOrchestrationSaveScriptFromLegacy({ codePath: '/b.py' }, { ruleId: '173', scriptPath: '/a.py' })).toEqual({
      ruleId: '173',
      scriptPath: '/b.py',
      message: undefined,
    })
  })

  it('ruleOrchestrationGenerateToLegacy：form 字段 ruleId/query/userPrompt（缺省用兜底，避免 400）', () => {
    expect(
      ruleOrchestrationGenerateToLegacy({
        mode: 'ref',
        ruleId: '173',
        describe: '转换',
        systemPrompt: 'sys',
        inputFields: ['date', 'zb_value'],
        outputFields: ['end_date'],
      }),
    ).toEqual({ ruleId: '173', query: '转换', userPrompt: 'sys' })
    const emptyPrompt = ruleOrchestrationGenerateToLegacy({ mode: 'ref', ruleId: '173', describe: '转换', systemPrompt: '' })
    expect(emptyPrompt.userPrompt).toBeTruthy()
    expect(ruleOrchestrationGenerateFormBody({
      mode: 'ref', ruleId: '173', describe: '转换', systemPrompt: 'a b',
    })).toBe('ruleId=173&query=%E8%BD%AC%E6%8D%A2&userPrompt=a+b')
    expect(ruleOrchestrationGenerateFromLegacy({ code: 'def main():\n  pass', codePath: '/x.py' })).toEqual({
      script: 'def main():\n  pass',
      scriptPath: '/x.py',
    })
  })

  it('parseRuleOrchestrationStreamText：从 MinIO 系统消息行取 scriptPath（全角/半角冒号）', () => {
    const textFull = [
      'def main(date):',
      '    return {"end_date": date}',
      '# [系统消息] 当前文件已经保存至MinIO：/code01/20260801/123.py',
    ].join('\n')
    expect(parseRuleOrchestrationStreamText(textFull)).toEqual({
      script: textFull,
      scriptPath: '/code01/20260801/123.py',
    })
    const textHalf = 'print(1)\n# [系统消息] 当前文件已经保存至MinIO:/code01/x.py'
    expect(parseRuleOrchestrationStreamText(textHalf).scriptPath).toBe('/code01/x.py')
  })

  it('pickRuleIdFromComposeList：按规则名+输入表匹配', () => {
    const records = [
      { id: 174, ruleName: '测试', targetTable: 'sense_data.TB_ENTRY' },
      { id: 173, ruleName: '邮箱附件', targetTable: 'sense_data.TB_email_XQ' },
    ]
    expect(pickRuleIdFromComposeList(records, { name: '邮箱附件', inputTable: 'sense_data.TB_email_XQ' })).toBe('173')
    expect(pickRuleIdFromComposeList(records, { name: '测试', inputTable: '' })).toBe('174')
    expect(pickRuleIdFromComposeList(records, { name: '不存在', inputTable: 'x' })).toBeUndefined()
  })
})
