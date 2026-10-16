import { describe, expect, it } from 'vitest'
import type { LegacySnatchSaveRequest } from './types/source'
import {
  configFromLegacy,
  siteFromLegacy,
  configToLegacy,
  configUrlFromLegacy,
  dataRowFromLegacy,
  dataTableFromLegacy,
  entryDetailFromLegacy,
  entryTypeFromLegacy,
  stepFromLegacy,
  stepToSaveItemConfigPayload,
  stepToStepModifyPayload,
  sourceFromLegacy,
  sourcePageFromLegacy,
  sourceToLegacyParams,
  flowFromLegacy,
  flowToLegacy,
  entryTypeGroupFromLegacy,
  entryTypeToLegacy,
  paramFromLegacy,
  paramPageFromLegacy,
  paramToLegacy,
  ruleOrchestrationDetailFromLegacy,
  parseRuleOrchestrationStreamText,
  parseDataProcessStreamText,
  stripMinioMarkerLine,
  pickRuleIdFromComposeList,
  isVruleNumericRuleId,
  ruleOrchestrationGenerateFormBody,
  ruleOrchestrationGenerateFromLegacy,
  ruleOrchestrationGenerateToLegacy,
  ruleOrchestrationSaveMetaFromLegacy,
  ruleOrchestrationSaveMetaToLegacy,
  ruleOrchestrationTestFromLegacy,
  ruleOrchestrationTestToLegacy,
  summaryRowFromLegacy,
  assertLegacySnatchSaveLogin,
  legacySnatchSavePayloadFromFlow,
  parseNextStepReceipt,
  taskInstFromLegacy,
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

describe('旧平台新建源登录字段适配', () => {
  it('保持 Step1/2/3 的字段名，并把登录节点映射到 reqLogin/loginUrl/loginName', () => {
    const payload = legacySnatchSavePayloadFromFlow({
      id: 'flow-1', name: '公告源', version: '1', main: ['collect', 'login'], branches: [], updatedAt: '',
      source: {
        sourceId: 'src-1', sourceType: 90, name: '公告源', url: 'https://example.com', configId: '', mainTable: '', owner: 'admin', state: 'C',
        dirId: 'cat-1', tags: ['公告', 'A股'], useProxy: true,
      },
      configs: {
        collect: {
          title: '列表抓取', sub: '', status: '运行', planned: false, collect: true, base: [], fields: [], inmap: [], params: [], output: [],
          collectCfg: { snatchType: '[90] - 网页抓取', webKind: 'list', url: 'https://example.com/list', outputTable: 'tb-1', inputTable: '', inputParams: ['p-date'], isDetail: false, resume: true },
        },
        login: {
          title: '网页登录', sub: '', status: '运行', planned: false, collect: true, base: [], fields: [], inmap: [], params: [], output: [],
          collectCfg: {
            snatchType: '[LOGIN] - 网页登录', webKind: 'list', url: 'https://example.com/login', outputTable: '', inputTable: '', inputParams: [], isDetail: false, collectorKind: 'login',
            loginConfigs: [
              { id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'alice', loginPwd: 'secret-1', newLoginConfig: '1', authConfig: '', enabled: true },
              { id: 'login-2', loginUrl: 'https://example.com/login-2', loginName: 'bob', loginPwd: 'secret-2', newLoginConfig: '1', authConfig: '', enabled: true },
            ],
            defaultLoginConfigId: 'login-1',
          },
        },
      },
    } as never, { configId: 'login-2', newLoginConfig: '1', loginPwd: 'secret' })

    expect(payload).toMatchObject({
      sourceType: 90, sourceUrl: 'https://example.com', sourceName: '公告源', categoryId: 'cat-1', proxy: ['1'], keep: '1',
      tags: '公告,A股', newConfig: '1', isMulti: '1', loginTemplete: '1', entryTypeId: 'tb-1',
      params: [{ paramId: 'p-date' }], reqLogin: '1', newLoginConfig: '1',
      loginUrl: 'https://example.com/login-2', loginName: 'bob', loginPwd: 'secret',
    })
    expect(payload).not.toHaveProperty('credentialRef')
  })

  it('迁移带过来的 isMulti 三态原值原样回写，不被 isDetail 布尔压成列表类', () => {
    // 旧平台 isMulti：1=列表类[按去重字段去重] / 0=详情类[按父ID去重] / 2=更新父表[按父ID更新父表]
    // （旧前端 column.config.js:642）。isDetail 只是布尔，此前无条件用它推导，2 会被压成 1，
    // 去重语义从"按父ID更新父表"变成"按去重字段去重"。
    const flowWith = (collectCfg: Record<string, unknown>) => ({
      id: 'flow-1', name: '源', version: '1', main: ['collect'], branches: [], updatedAt: '',
      source: { sourceId: 'src-1', sourceType: 90, name: '源', url: 'https://example.com', configId: '', mainTable: '', owner: 'admin', state: 'C' },
      configs: {
        collect: {
          title: '抓取', sub: '', status: '运行', planned: false, collect: true, base: [], fields: [], inmap: [], params: [], output: [],
          collectCfg: { snatchType: '[90] - 网页抓取', webKind: 'list', url: 'https://example.com', outputTable: 'tb-1', inputTable: '', inputParams: [], resume: true, ...collectCfg },
        },
      },
    })

    // 迁移数据：更新父表（2）——必须原样回写
    expect(legacySnatchSavePayloadFromFlow(flowWith({ isDetail: false, multiMode: 2 }) as never).isMulti).toBe('2')
    // 迁移数据：详情类（0）
    expect(legacySnatchSavePayloadFromFlow(flowWith({ isDetail: true, multiMode: 0 }) as never).isMulti).toBe('0')
    // 新建节点没有原值：仍按 isDetail 布尔推导，行为不变
    expect(legacySnatchSavePayloadFromFlow(flowWith({ isDetail: true }) as never).isMulti).toBe('0')
    expect(legacySnatchSavePayloadFromFlow(flowWith({ isDetail: false }) as never).isMulti).toBe('1')
  })

  it('新建登录缺旧平台密码时直接阻止提交，不能把 credentialRef 当作 authConfig', () => {
    const payload = {
      reqLogin: '1', newLoginConfig: '1', loginUrl: 'https://example.com/login', loginName: 'alice',
      loginPwd: undefined, sourceUrl: 'https://example.com', sourceName: '源', newConfig: '1', isMulti: '1', loginTemplete: '1', params: [],
    } as LegacySnatchSaveRequest
    expect(() => assertLegacySnatchSaveLogin(payload)).toThrow('loginPwd')
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

  it('isDetail 表示非列表类：isMulti 0 和 2 都算，只有 1 是列表类', () => {
    // 2026-08-27 生产实测：真实详情配置（1400765「python详情解析器_900」）isMulti=2 而不是 0，
    // 原来写死 === 0 等于恒为假。三态原值另在 multiMode 上，要区分 0/2 读它。
    expect(configFromLegacy({ configId: 1, configName: 'a', isMulti: 1 })).toMatchObject({ isDetail: false, multiMode: 1 })
    expect(configFromLegacy({ configId: 2, configName: 'b', isMulti: 0 })).toMatchObject({ isDetail: true, multiMode: 0 })
    expect(configFromLegacy({ configId: 3, configName: 'c', isMulti: 2 })).toMatchObject({ isDetail: true, multiMode: 2 })
    // 没有原值时不臆断
    expect(configFromLegacy({ configId: 4, configName: 'd' })).toMatchObject({ isDetail: false, multiMode: undefined })
  })

  it('配置 URL 认旧字段 configUrl，也兼容已适配的 url', () => {
    expect(configUrlFromLegacy({ configUrl: 'http://www.baidu.com' })).toBe('http://www.baidu.com')
    expect(configUrlFromLegacy({ url: 'https://passport.baidu.com/' })).toBe('https://passport.baidu.com/')
    expect(configUrlFromLegacy({ configUrl: 'http://from-config', url: 'http://from-model' })).toBe('http://from-config')
    expect(configUrlFromLegacy({ configUrl: '' })).toBe('')
    expect(configUrlFromLegacy({ configId: 1 })).toBeUndefined()
    expect(configFromLegacy({ configId: 5, configName: 'x', url: 'http://only-url' }).url).toBe('http://only-url')
  })

  it('configDetail 只有 success/data、没有 code 时仍能读出配置 URL', () => {
    // 旧 ConfigEdit 能显示 URL，画布却空：request() 只在有 code 时拆 data，这种外壳会整包落到适配层。
    const envelope = {
      success: true,
      data: {
        configId: 1400766,
        configName: 'guancha-观察者网-金融科技',
        configUrl: 'https://www.guancha.cn/jinrongkeji',
        isMulti: 1,
        topic: 'dev_web_snatch_5865',
      },
    }
    expect(configUrlFromLegacy(envelope)).toBe('https://www.guancha.cn/jinrongkeji')
    expect(configFromLegacy(envelope)).toMatchObject({
      configId: '1400766',
      name: 'guancha-观察者网-金融科技',
      url: 'https://www.guancha.cn/jinrongkeji',
      multiMode: 1,
      topic: 'dev_web_snatch_5865',
    })
  })
})

describe('旧平台步骤模型适配（item/next，2026-08-26 生产实测源 430016821 修复 lastStep/context 混淆）', () => {
  it('lastStep 只作为依赖排序用的 dependsOn，不再冒充上下文来源；上下文来源来自真实的 context 字段', () => {
    // 取自生产 118.25.96.217 实测响应（源 430016821，第 3 步 itemConfig=40598）：
    // lastStep="40597" 是前一步骤 ID，context="K2,K17" 才是 cond 表达式里引用的字段代号。
    const step = stepFromLegacy({
      itemConfig: 40598,
      sourceId: -1,
      name: '1400935-详情',
      configId: 1400975,
      entryTypeId: 900,
      outEntry: 900,
      lastStep: '40597',
      context: 'K2,K17',
      cond: "K17 != nil && !string.contains(K2,'weixin.qq')",
      isDelete: 0,
    }, '430016821')

    expect(step.dependsOn).toEqual(['40597'])
    expect(step.contextMap).toEqual(['K2', 'K17'])
    // 回归防护：上下文来源不能再混入依赖步骤 ID。
    expect(step.contextMap).not.toContain('40597')
  })

  it('outColumns 读取 outContext（旧响应从无 outColumns 字段，此前一直读错字段名）', () => {
    const step = stepFromLegacy({
      itemConfig: 1, sourceId: '430016821', name: '出参步骤', outContext: 'K3,K4', isDelete: 0,
    }, '430016821')

    expect(step.outColumns).toEqual(['K3', 'K4'])
  })

  it('mainConfig/flowCode/itemId/extName 不再被解析阶段丢弃（取自 2026-08-26 生产实测源 430016516 第 4 步）', () => {
    // 附件入资源表：itemId 4103139 与同源另一步骤（itemConfig 39935）复用，验证不去重、原样保留。
    const step = stepFromLegacy({
      itemConfig: 39944, sourceId: -1, name: '附件入资源表', configId: 1400622, mainConfig: 1400639,
      flowCode: 'WEB_SNATCH', itemId: 4103139, extName: null, entryTypeId: 2100249, outEntry: 6200020,
      lastStep: '39936', cond: 'K7 != nil', isDelete: 0,
    }, '430016516')

    expect(step.mainConfig).toBe('1400639')
    expect(step.flowCode).toBe('WEB_SNATCH')
    expect(step.itemId).toBe('4103139')
    expect(step.extName).toBeUndefined()
  })

  it('url 字段现在被读取（此前 stepFromLegacy 读 urlSourceField/urlRule，但真实响应从无这两个 key，恒为 undefined；真值在 url）', () => {
    const step = stepFromLegacy({
      itemConfig: 40251, sourceId: -1, name: '1400774-详情', configId: 1400765, mainConfig: 1400774,
      flowCode: 'WEB_SNATCH', entryTypeId: 900, outEntry: 900, lastStep: '0', cond: 'K6==nil',
      url: "K2+'#need_upload_xq/xq/'", isDelete: 0,
    }, '430016501')

    expect(step.url).toBe("K2+'#need_upload_xq/xq/'")
    expect(step.urlSourceField).toBeUndefined()
    expect(step.urlRule).toBeUndefined()
  })

  it('flowId 回读：0925 整体切 flowId（bee-top FLOW_ID 列），响应带 flowId 时映射为字符串；老后端不带时为 undefined（双轨兼容）', () => {
    expect(stepFromLegacy({
      itemConfig: 41768, sourceId: -1, name: '网页抓取', configId: 1401078, mainConfig: 1400935,
      flowId: 1400935, flowCode: 'WEB_SNATCH', lastStep: '41767', isDelete: 0,
    }, '430016824').flowId).toBe('1400935')
    expect(stepFromLegacy({
      itemConfig: 41768, sourceId: -1, name: '网页抓取', configId: 1401078, mainConfig: 1400935,
      flowCode: 'WEB_SNATCH', lastStep: '41767', isDelete: 0,
    }, '430016824').flowId).toBeUndefined()
  })

  it('写 payload 带 flowId：0925 契约变更——步骤归属切 flowId，saveItemConfig/stepModify 显式携带数字 flowId；没有 flowId 时不出现该键', () => {
    const withFlow = stepFromLegacy({
      itemConfig: 40600, sourceId: -1, name: '1400917-详情', configId: 1400917, mainConfig: 1400917,
      flowId: 1400935, flowCode: 'WEB_SNATCH', entryTypeId: 6200026, outEntry: 6200026,
      itemId: 52000351, lastStep: '0', url: '$VAL$', isDelete: 1,
    }, '430016398')
    expect(stepToSaveItemConfigPayload(withFlow)).toMatchObject({ flowId: 1400935 })
    expect(stepToStepModifyPayload(withFlow)).toMatchObject({ flowId: 1400935 })
    const withoutFlow = stepFromLegacy({
      itemConfig: 40600, sourceId: -1, name: '1400917-详情', configId: 1400917, mainConfig: 1400917,
      flowCode: 'WEB_SNATCH', entryTypeId: 6200026, outEntry: 6200026, itemId: 52000351,
      lastStep: '0', url: '$VAL$', isDelete: 1,
    }, '430016398')
    expect(stepToSaveItemConfigPayload(withoutFlow)).not.toHaveProperty('flowId')
    expect(stepToStepModifyPayload(withoutFlow)).not.toHaveProperty('flowId')
  })

  it('stepToStepModifyPayload 逐字段对照 2026-08-26 生产实测：源 430016398（test1）itemConfig 40600 原样重新提交 stepModify 抓到的真实请求体，未改动任何数据（提交前后 nextConfigPaged 回读一致）', () => {
    const step = stepFromLegacy({
      authConfig: null, bizType: null, cond: null, configId: 1400917, context: null,
      entryTypeId: 6200026, extName: null, flowCode: 'WEB_SNATCH', isDelete: 1,
      itemConfig: 40600, itemId: 52000351, lastStep: '0', mainConfig: 1400917,
      name: '1400917-详情', nextStep: null, outContext: null, outEntry: 6200026,
      sid: null, sourceId: -1, type: 'entry', url: '$VAL$',
    }, '430016398')

    expect(stepToStepModifyPayload(step)).toEqual({
      lastStep: '0', sourceId: -1, mainConfig: 1400917, entryTypeId: 6200026,
      name: '1400917-详情', url: '$VAL$', extName: null, configId: 1400917,
      cond: null, outEntry: 6200026, outContext: null, itemId: 52000351,
      type: 'entry', flowCode: 'WEB_SNATCH', context: null, bizType: null,
      enabled: false, allField: [], nextStep: null, itemConfig: 40600,
      isDelete: 1, authConfig: null, sid: null, checked: true, show: true,
    })
  })

  it('stepToSaveItemConfigPayload 是 stepModify payload 去掉 itemConfig/isDelete（新建步骤没有已知 ID，也不预置为已删除）', () => {
    const step = stepFromLegacy({
      itemConfig: 40600, sourceId: -1, name: '1400917-详情', configId: 1400917, mainConfig: 1400917,
      flowCode: 'WEB_SNATCH', entryTypeId: 6200026, outEntry: 6200026, itemId: 52000351,
      lastStep: '0', url: '$VAL$', isDelete: 1,
    }, '430016398')

    const createPayload = stepToSaveItemConfigPayload(step)
    expect(createPayload).not.toHaveProperty('itemConfig')
    expect(createPayload).not.toHaveProperty('isDelete')
    expect(createPayload).toMatchObject({ name: '1400917-详情', configId: 1400917, url: '$VAL$' })
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

  it('dataTableFromLegacy：透传表详情元数据和字段元数据', () => {
    const table = dataTableFromLegacy({
      entryTypeId: '1042',
      typeName: '新闻表',
      tableName: 'sense_data.TB_NEWS',
      dataCnt: 20,
      state: 'C',
      keyField: 'K1',
      remark: '新闻数据',
      updateDt: '2026-08-11 10:00:00',
      recFlag: 1,
      checkFlag: 0,
      checkRule: 'K1 非空',
      coreParam: 'news',
      items: [
        { itemId: 'i-1', seq: 1, itemCode: 'title', itemName: '标题', columnName: 'K1', dataType: 'string', width: 140, required: true, clearRule: 'trim', uniqueKey: true, checkRule: '非空' },
        { itemCode: 'raw', itemName: '原始', columnName: 'K9', dataType: 'string', width: 80, required: false },
      ],
    })
    expect(table).toMatchObject({
      name: '新闻表', rowCount: 20, state: 'C', keyField: 'K1', remark: '新闻数据',
      updatedAt: '2026-08-11 10:00:00', recFlag: 1, checkFlag: 0, checkRule: 'K1 非空', coreParam: 'news',
    })
    expect(table.fields).toEqual([
      expect.objectContaining({ prop: 'title', itemId: 'i-1', seq: 1, columnName: 'K1', required: true, width: 140, preprocess: 'trim', dedup: true, checkRule: '非空' }),
      expect.objectContaining({ prop: 'raw', columnName: 'K9', required: false, width: 80 }),
    ])
  })

  it('dataTableFromLegacy：后端没给 dataCnt 时 rowCount 为 undefined，不兜成 0（0930-04 表结构抽屉显示「—」）', () => {
    const table = dataTableFromLegacy({ entryTypeId: '6200029', tableName: 'sense_data.TB_GZHWZ', items: [] })
    expect(table.rowCount).toBeUndefined()
  })
})

describe('数据详情 / 统计行适配（E 包 T1c）', () => {
  it('entryDetailFromLegacy：showItems/subs 从行字段中摘出，不落进 row.values', () => {
    const detail = entryDetailFromLegacy({
      ENTRY_ID: '88231', SOURCE_ID: '161725', K1: '正文',
      sourceName: '新浪财经', entryTypeId: '1042', entryTypeName: '公告正文', ver: '3', flag1: '2026-10-08',
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '正文', value: '正文' }],
      subs: [{ ENTRY_ID: '88232', SOURCE_ID: '161725' }],
    })
    expect(detail.row).toMatchObject({ dataId: '88231', sourceId: '161725' })
    expect(detail.row.values).toEqual({ K1: '正文' })
    // 详情顶部字段（旧平台 ENTRY_DETAIL.base）：camelCase 直读，不落进 values
    expect(detail.row).toMatchObject({ sourceName: '新浪财经', entryTypeId: '1042', entryTypeName: '公告正文', ver: '3', flag1: '2026-10-08' })
    expect(detail.showItems).toEqual([{ itemId: '1', columnName: 'K1', itemName: '正文', value: '正文' }])
    // 0904：subs 现在是 EntrySubRow（row + showItems + tableId/tableName），
    // 不再是裸 DataRow——子行自带 24 个字段，摊平成 DataRow 会把它们全丢掉
    expect(detail.subs).toEqual([expect.objectContaining({ row: expect.objectContaining({ dataId: '88232' }) })])
  })

  it('dataRowFromLegacy：详情顶部字段也认大写键（SOURCE_NAME/ENTRY_TYPE_ID 等），并移出 values', () => {
    const row = dataRowFromLegacy({
      ENTRY_ID: '1', SOURCE_ID: '2',
      SOURCE_NAME: 'twitter1', ENTRY_TYPE_ID: '6200029', ENTRY_TYPE_NAME: '推特抓取', VER: '2', FLAG1: '2026-10-07',
      K1: '内容',
    })
    expect(row).toMatchObject({
      sourceName: 'twitter1', entryTypeId: '6200029', entryTypeName: '推特抓取', ver: '2', flag1: '2026-10-07',
    })
    expect(row.values).toEqual({ K1: '内容' })
  })

  it('dataRowFromLegacy：entryDetail 的系统字段是 camelCase（parentId/detailId/seq 等），必须能读到', () => {
    // fixture 取自 entry/entryDetail 线上实测响应（2026-10-16）：整行系统字段全为 camelCase，
    // 早前只读全大写键，导致这三个键既被 systemKeys 移出 values、又没落进 row，界面上直接空掉。
    const row = dataRowFromLegacy({
      entryId: 5000017, sourceId: 430024667, configId: 1401120, entryTypeId: 6200038,
      parentId: 2800001, categoryId: 9009005, fileId: 0, detailId: '68166879',
      createDt: '2026-10-10 17:42:55', updateDt: '2026-10-14 17:33:25',
      entryTypeName: '公告数据', sourceName: '江苏金租定期报告', ver: 1, seq: 2007286915, K1: '正文',
    })
    expect(row).toMatchObject({
      dataId: '5000017', sourceId: '430024667', configId: '1401120',
      parentId: '2800001', categoryId: '9009005', fileId: '0', detailId: '68166879',
      seq: '2007286915', ver: '1',
      createDt: '2026-10-10 17:42:55', updateDt: '2026-10-14 17:33:25',
    })
    expect(row.values).toEqual({ K1: '正文' })
  })

  it('dataRowFromLegacy：全大写键优先于 camelCase（列表页口径不受影响）', () => {
    const row = dataRowFromLegacy({
      ENTRY_ID: '1', SOURCE_ID: '2', PARENT_ID: '10', DETAIL_ID: '20', SEQ: '30',
      parentId: '999', detailId: '888', seq: '777',
    })
    expect(row).toMatchObject({ dataId: '1', sourceId: '2', parentId: '10', detailId: '20', seq: '30' })
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

  // S3-2 §9.2-2：真机实测 targetTable 传空 + ruleType '数据处理' 直接 200（见开发方案 §9.2），
  // ruleType 参数化只是留个钩子，默认值必须还是 '数据处理'，不传第三个参数时行为不变。
  it('ruleOrchestrationSaveMetaToLegacy：targetTable 可以传空（采集首节点场景），ruleType 可覆盖', () => {
    const cfg = { mode: 'new' as const, describe: '', dataSource: 'dp-wwdata' as const, inputTable: '', outputTable: 'sense_data.TB_X' }
    expect(ruleOrchestrationSaveMetaToLegacy(cfg, 'ht_poc').targetTable).toBe('')
    expect(ruleOrchestrationSaveMetaToLegacy(cfg, 'ht_poc').ruleType).toBe('数据处理')
    expect(ruleOrchestrationSaveMetaToLegacy(cfg, 'ht_poc', '抓取配置').ruleType).toBe('抓取配置')
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

  it('ruleOrchestrationSaveMetaFromLegacy：兼容裸 id / {id} / {ruleId}', () => {
    expect(ruleOrchestrationSaveMetaFromLegacy(173)).toEqual({ ruleId: '173', message: '业务规则已保存' })
    expect(ruleOrchestrationSaveMetaFromLegacy({ id: 173, msg: 'ok' })).toEqual({ ruleId: '173', message: 'ok' })
    expect(ruleOrchestrationSaveMetaFromLegacy({ ruleId: 'orch-1' }).ruleId).toBe('orch-1')
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
    ).toEqual({ ruleId: '173', query: '转换', userPrompt: 'sys', providerCode: '', modelCode: '' })
    // f624f67：模型供应商/模型字段透传（vrule stream 的 providerCode/modelCode form 字段）
    expect(
      ruleOrchestrationGenerateToLegacy({
        mode: 'ref', ruleId: '173', describe: '转换', systemPrompt: 'sys',
        modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
      }),
    ).toEqual({ ruleId: '173', query: '转换', userPrompt: 'sys', providerCode: 'DeepSeek', modelCode: 'deepseek-chat' })
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

  // S3-2：标记行本身不是脚本正文，剥离后的 script 不应再包含它——对 Python 只是少一行注释，
  // 但这条规则本身跟格式无关，对 XML（S3-3）来说是必须的（见 stripMinioMarkerLine 注释）。
  it('parseRuleOrchestrationStreamText：从 MinIO 系统消息行取 scriptPath（全角/半角冒号），标记行从 script 里剥掉', () => {
    const body = ['def main(date):', '    return {"end_date": date}']
    const textFull = [...body, '# [系统消息] 当前文件已经保存至MinIO：/code01/20260801/123.py'].join('\n')
    expect(parseRuleOrchestrationStreamText(textFull)).toEqual({
      script: body.join('\n'),
      scriptPath: '/code01/20260801/123.py',
    })
    const textHalf = 'print(1)\n# [系统消息] 当前文件已经保存至MinIO:/code01/x.py'
    expect(parseRuleOrchestrationStreamText(textHalf)).toEqual({ script: 'print(1)', scriptPath: '/code01/x.py' })
  })

  it('parseRuleOrchestrationStreamText：没有标记行时整段原样返回，scriptPath 为空串', () => {
    expect(parseRuleOrchestrationStreamText('def main():\n    return {}')).toEqual({
      script: 'def main():\n    return {}',
      scriptPath: '',
    })
  })

  it('parseRuleOrchestrationStreamText：JSON 业务失败信封要抛出 msg，不能当成脚本正文', () => {
    expect(() => parseRuleOrchestrationStreamText('{"code":"400","msg":"ruleId 不存在"}')).toThrow(/ruleId 不存在/)
  })

  it('isVruleNumericRuleId：只认正整数，旧步骤占位 -1 / 虚拟起点 0 / orch-* 都不算', () => {
    expect(isVruleNumericRuleId('173')).toBe(true)
    expect(isVruleNumericRuleId('-1')).toBe(false)
    expect(isVruleNumericRuleId('0')).toBe(false)
    expect(isVruleNumericRuleId('orch-173')).toBe(false)
    expect(isVruleNumericRuleId('')).toBe(false)
  })

  it('stripMinioMarkerLine：与 parseRuleOrchestrationStreamText 共用同一实现，可独立单测（S3-2 抽函数）', () => {
    expect(stripMinioMarkerLine('<Config>\n  <Action id="1"/>\n</Config>\n# [系统消息] 当前文件已经保存至MinIO：/x/1.xml')).toEqual({
      script: '<Config>\n  <Action id="1"/>\n</Config>',
      scriptPath: '/x/1.xml',
    })
  })

  // 0831 data-process 实测契约：markdown 代码围栏 + 「# 当前文件已保存到…」标记行
  it('parseDataProcessStreamText：剥围栏与标记行，scriptPath 从「# 当前文件已保存到」行取出', () => {
    const text = [
      '```python',
      'def process(sku_id):',
      '    return {"sku_name": ""}',
      '```',
      '# 当前文件已保存到/code01/202608/1788176138061.py',
    ].join('\n')
    expect(parseDataProcessStreamText(text)).toEqual({
      script: 'def process(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/code01/202608/1788176138061.py',
    })
  })

  it('parseDataProcessStreamText：无围栏时按纯文本处理，无标记行时 scriptPath 为空串', () => {
    expect(parseDataProcessStreamText('def process(a):\n    return {"a": a}')).toEqual({
      script: 'def process(a):\n    return {"a": a}',
      scriptPath: '',
    })
    expect(() => parseDataProcessStreamText('```python\n```')).toThrow('生成脚本未返回内容')
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

describe('nextStep 回执解析（0812 计划 M3-0J，样例取自 2026-08-18 测试环境真实实测）', () => {
  it('全部进入：提交数与 ok 数一致', () => {
    const r = parseNextStepReceipt('本次发送:2 条, 结果:,ok_39025: [2条]')
    expect(r.submitted).toBe(2)
    expect(r.okCount).toBe(2)
    expect(r.rejectCount).toBe(0)
    expect(r.entries).toEqual([{ status: 'ok', nodeId: '39025', count: 2 }])
  })

  it('全部被进入条件拒绝：submitted 不为 0，但 okCount 为 0——不能当成功展示', () => {
    const r = parseNextStepReceipt('本次发送:3 条, 结果:,reject_39025: [3条]')
    expect(r.submitted).toBe(3)
    expect(r.okCount).toBe(0)
    expect(r.rejectCount).toBe(3)
    expect(r.entries).toEqual([{ status: 'reject', nodeId: '39025', count: 3 }])
  })

  it('混合分组：ok 与 reject 分别累加', () => {
    const r = parseNextStepReceipt('本次发送:5 条, 结果:,ok_39025: [3条],reject_39025: [2条]')
    expect(r.submitted).toBe(5)
    expect(r.okCount).toBe(3)
    expect(r.rejectCount).toBe(2)
    expect(r.entries).toHaveLength(2)
  })

  it('全部 ID 无效：没有任何分组，entries 为空数组，调用方应按 submitted 兜底', () => {
    const r = parseNextStepReceipt('本次发送:0 条, 结果:')
    expect(r.submitted).toBe(0)
    expect(r.entries).toEqual([])
    expect(r.okCount).toBe(0)
    expect(r.rejectCount).toBe(0)
  })

  it('无法识别的文本：submitted 与 entries 均为空，不抛错', () => {
    const r = parseNextStepReceipt('')
    expect(r.submitted).toBe(0)
    expect(r.entries).toEqual([])
  })
})

describe('旧平台源列表标记字段', () => {
  it('usedFlag 映射为颜色 key，tags 去掉 # 后回读为问题标记', () => {
    expect(sourceFromLegacy({
      sourceId: 1,
      sourceName: '公告源',
      sourceUrl: 'https://example.com',
      configId: 2,
      entryTypeId: 3,
      tags: '#正文缺失,#内容重复',
      usedFlag: 1,
    })).toMatchObject({
      sourceId: '1',
      tags: ['正文缺失', '内容重复'],
      color: 'red',
    })
  })

  // 0927 G2：ROOT 权威方案的只读反查字段透传（后端源列表/详情已返回）
  it('rootId / rootConfigId 透传为只读字符串；缺省为 undefined', () => {
    expect(sourceFromLegacy({
      sourceId: 1, sourceName: 'a', sourceUrl: 'u', configId: 2, entryTypeId: 3,
      rootId: 41352,
      rootConfigId: 1400935,
    })).toMatchObject({
      rootId: '41352',
      rootConfigId: '1400935',
    })
    expect(sourceFromLegacy({
      sourceId: 1, sourceName: 'a', sourceUrl: 'u', configId: 2, entryTypeId: 3,
    }).rootId).toBeUndefined()
    expect(sourceFromLegacy({
      sourceId: 1, sourceName: 'a', sourceUrl: 'u', configId: 2, entryTypeId: 3,
    }).rootConfigId).toBeUndefined()
  })
})

// 1008-01：217 的 sourceDetail / sourcePaged / site/sources 不再返回 flowId，改成 defaultFlowId（字符串，
// 组内源取来源组的默认流程）并带 sourceGroupId。前端 Source.flowId 要继续有值，画布才显示「当前流程」。
describe('源的流程字段兼容 defaultFlowId（1008-01）', () => {
  const base = { sourceId: 430024667, sourceName: '江苏金租', sourceUrl: 'u', configId: 2, entryTypeId: 3 }

  it('217 新形状：只有 defaultFlowId，flowId 取它；defaultFlowId / sourceGroupId 原样保留为字符串', () => {
    const source = sourceFromLegacy({ ...base, defaultFlowId: '14010130', sourceGroupId: null })
    expect(source.flowId).toBe('14010130')
    expect(source.defaultFlowId).toBe('14010130')
    expect(source.sourceGroupId).toBeUndefined()
    expect(sourceFromLegacy({ ...base, defaultFlowId: '21000006', sourceGroupId: 3 })).toMatchObject({
      flowId: '21000006', defaultFlowId: '21000006', sourceGroupId: '3',
    })
  })

  it('老形状：只有 flowId，照旧；两个字段都没有时都是 undefined', () => {
    const old = sourceFromLegacy({ ...base, flowId: 1400935 })
    expect(old.flowId).toBe('1400935')
    expect(old.defaultFlowId).toBeUndefined()
    const none = sourceFromLegacy(base)
    expect(none.flowId).toBeUndefined()
    expect(none.defaultFlowId).toBeUndefined()
  })

  it('响应带了 defaultFlowId 键就以它为准：它是 null（无可用默认流程）时不能退回旧 flowId 列的陈旧值', () => {
    const source = sourceFromLegacy({ ...base, flowId: 99, defaultFlowId: null })
    expect(source.flowId).toBeUndefined()
    expect(source.defaultFlowId).toBeUndefined()
    // 两个都有且不同：生效的是 defaultFlowId
    expect(sourceFromLegacy({ ...base, flowId: 99, defaultFlowId: '14010130' }).flowId).toBe('14010130')
  })

  it('源列表分页也走同一个映射', () => {
    const page = sourcePageFromLegacy({ total: 1, list: [{ ...base, defaultFlowId: '14010130' }] })
    expect(page.list[0]).toMatchObject({ flowId: '14010130', defaultFlowId: '14010130' })
  })

  it('保存源不会把 flowId 发回后端（入组的源带 flowId 会被后端拒绝）', () => {
    const params = sourceToLegacyParams(sourceFromLegacy({ ...base, defaultFlowId: '14010130', sourceGroupId: 3 }))
    expect(params).not.toHaveProperty('flowId')
    expect(params).not.toHaveProperty('defaultFlowId')
    expect(params).not.toHaveProperty('sourceGroupId')
  })
})

describe('任务实例字段适配', () => {
  it('对照旧 column.config TASK_LIST：actionName/nodeCode/taskTopic/updateDt', () => {
    expect(taskInstFromLegacy({
      taskId: '8348509120',
      state: 'C',
      actionName: '浏览器抓取',
      taskName: '任务A',
      sourceId: '161725',
      configId: '70598',
      nodeCode: 'node1',
      taskTopic: 'topic1',
      updateDt: '2026-07-31 08:00',
    })).toMatchObject({
      taskId: '8348509120',
      typeName: '浏览器抓取',
      node: 'node1',
      topic: 'topic1',
      updatedAt: '2026-07-31 08:00',
    })
  })

  it('已经是新字段名的记录不丢 typeName/node/topic/updatedAt', () => {
    expect(taskInstFromLegacy({
      taskId: '1',
      state: 'L',
      typeName: '采集任务',
      taskName: '列表抓取',
      sourceId: '391007768',
      node: '391007768-s1',
      topic: 'queue_81909',
      updatedAt: '2026-07-13 10:00',
    })).toMatchObject({
      typeName: '采集任务',
      node: '391007768-s1',
      topic: 'queue_81909',
      updatedAt: '2026-07-13 10:00',
    })
  })

  it('0917-01：正确映射 9 个扩展字段（bizId/taskUrl/fileId/flowId/params/taskResult/vars 及 createDt/startDt/endDt 时间改名）', () => {
    const inst = taskInstFromLegacy({
      taskId: '88801',
      state: 'E',
      actionName: '详情抓取',
      taskName: '文章详情',
      sourceId: '1001',
      bizId: '986079',
      taskUrl: 'https://example.com/article/1',
      fileId: 'file_001',
      flowId: 'flow_99',
      params: '{"page":1}',
      taskResult: '{"status":"fail","error":"timeout"}',
      vars: '{"retry":2}',
      createDt: '2026-09-17 10:00:00',
      startDt: '2026-09-17 10:00:05',
      endDt: '2026-09-17 10:00:15',
    })
    expect(inst).toMatchObject({
      bizId: '986079',
      taskUrl: 'https://example.com/article/1',
      fileId: 'file_001',
      flowId: 'flow_99',
      params: '{"page":1}',
      taskResult: '{"status":"fail","error":"timeout"}',
      vars: '{"retry":2}',
      createdAt: '2026-09-17 10:00:00',
      startedAt: '2026-09-17 10:00:05',
      endedAt: '2026-09-17 10:00:15',
    })
  })

  it('0917-01：兼容已是新字段名的记录或别名（entryId/url/taskParams/result/createdAt/startedAt/endedAt）', () => {
    const inst = taskInstFromLegacy({
      taskId: '88802',
      state: 'C',
      entryId: '986080',
      url: 'https://example.com/article/2',
      taskParams: '{"id":2}',
      result: 'success',
      createdAt: '2026-09-17 11:00:00',
      startedAt: '2026-09-17 11:00:02',
      endedAt: '2026-09-17 11:00:08',
    })
    expect(inst.bizId).toBe('986080')
    expect(inst.taskUrl).toBe('https://example.com/article/2')
    expect(inst.params).toBe('{"id":2}')
    expect(inst.taskResult).toBe('success')
    expect(inst.createdAt).toBe('2026-09-17 11:00:00')
    expect(inst.startedAt).toBe('2026-09-17 11:00:02')
    expect(inst.endedAt).toBe('2026-09-17 11:00:08')
  })
})

// 0915-14：后端 2026-09-16 给 cfg_site 加了 tags 列（在此之前这里硬编码空数组）
describe('siteFromLegacy 的标签', () => {
  it('分号分隔的入库形态拆成数组，不带 # 前缀', () => {
    const site = siteFromLegacy({ siteId: 1, siteName: '新浪财经1', tags: '测试;服务', sourceCnt: 2 })
    expect(site.tags).toEqual(['测试', '服务'])
  })

  it('没有标签时是空数组，不是 undefined', () => {
    expect(siteFromLegacy({ siteId: 2, siteName: '新浪3', tags: null, sourceCnt: 0 }).tags).toEqual([])
  })
})

// 0929 F6：cs_flow 启停状态适配（IS_DELETE 0/1/-1 与 STATE C/D 必须精确区分）
describe('flowFromLegacy 的启停状态', () => {
  it('isDelete=1 → disabled=true（禁用 ≠ 删除：仍在列表与有效集合）', () => {
    expect(flowFromLegacy({ flowId: 1, flowName: 'x', isDelete: 1, state: 'C' }).disabled).toBe(true)
  })

  it('isDelete=0 正常 / isDelete=-1 已删（不会出现在 paged 里）都不算 disabled', () => {
    expect(flowFromLegacy({ flowId: 1, flowName: 'x', isDelete: 0, state: 'C' }).disabled).toBe(false)
    expect(flowFromLegacy({ flowId: 1, flowName: 'x', isDelete: -1, state: 'D' }).disabled).toBe(false)
    expect(flowFromLegacy({ flowId: 1, flowName: 'x', isDelete: -1, state: 'D' }).state).toBe('D')
  })

  it('isDelete/state 缺失时保持 undefined（老后端不回这两列）', () => {
    const flow = flowFromLegacy({ flowId: 1, flowName: 'x' })
    expect(flow.disabled).toBeUndefined()
    expect(flow.state).toBeUndefined()
  })
})

// 0929 F5：分类清空哨兵（MyBatis-Plus updateById 跳过 null，「清空」改成传 0）
describe('flowToLegacy 的分类清空哨兵', () => {
  it("categoryId 空串 → payload.categoryId = 0（后端见 <=0 置 null），不再传 null 被跳过", () => {
    const payload = flowToLegacy({ name: 'x', definition: { main: [], branches: [], configs: {} }, categoryId: '' })
    expect(payload.categoryId).toBe(0)
  })

  it('categoryId 合法值原样转数字；不传则 payload 里没有该键（保持后端原值）', () => {
    expect(flowToLegacy({ name: 'x', definition: { main: [], branches: [], configs: {} }, categoryId: '9009289' }).categoryId).toBe(9009289)
    expect('categoryId' in flowToLegacy({ name: 'x', definition: { main: [], branches: [], configs: {} } })).toBe(false)
  })
})
