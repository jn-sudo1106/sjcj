import { describe, expect, it } from 'vitest'
import { convertChatLogsToMessages, extractTableSwitchSuggestions } from './aiChat'

// 2026-11-19 现场截图里的原样回答：表已锁定但整表零行，模型用正文建议「换一张表」
const ZERO_ROW_ANSWER = [
  '您再次确认的是同一张表 中指-二手房销售价格（`sense_data.TB_ZZ_MONTH_OLD_PRICE`）。',
  '',
  '我如实向您说明：这张表当前整表无任何数据记录（已分别用精确匹配、模糊匹配、全表地区列表三种方式验证，均为 0 行），属于底层数据缺失状态，并非查询条件问题。因此无论怎么查，都无法从这张表得到南京二手房的最新价格。',
  '',
  '建议换一张有数据的表继续查询。之前检索命中的二手房相关数据源包括：',
  '',
  '• 贝壳二手房-在售（`sense_data.TB_ke_com_ershoufang_sale`）',
  '• 贝壳二手房-成交信息（`sense_data.TB_ke_com_chengjiao_esf`）',
  '• 中指-二手房销售套数/面积/销售额（`TB_ZZ_MONTH_OLD_CNT/AREA/SUM`）',
  '• 南京网上房地产（`sense_data.TB_NJWSFDC`）',
  '',
  '请问您希望我换哪一张表继续查询南京二手房价格？或者我直接帮您从「贝壳二手房-在售」表里查南京的最新挂牌价格？',
].join('\n')

const EXPECTED_ACTIONS = [
  '改用「贝壳二手房-在售」继续查询',
  '改用「贝壳二手房-成交信息」继续查询',
  '改用「中指-二手房销售套数/面积/销售额」继续查询',
  '改用「南京网上房地产」继续查询',
]

describe('零行回答的「改查」胶囊', () => {
  it('截图文案解析出 4 个改查胶囊，文案可直接作为下一轮提问', () => {
    expect(extractTableSwitchSuggestions(ZERO_ROW_ANSWER)).toEqual({ actions: EXPECTED_ACTIONS })
  })

  it('业务数据表格（日期/价格）不出胶囊', () => {
    const businessTable = [
      '为您查询到南京二手房最新价格记录如下：',
      '',
      '| 编号 | 日期 | 价格 |',
      '| --- | --- | --- |',
      '| 1 | 2026-10-18 | 5,557 |',
      '| 2 | 2026-10-18 | 17,574 |',
    ].join('\n')
    expect(extractTableSwitchSuggestions(businessTable)).toBeNull()
  })

  it('只是列举本次用到的表、没有换表意图时不出胶囊', () => {
    const usedTables = [
      '本次查询用到的表：',
      '',
      '• 贝壳二手房-在售（`sense_data.TB_ke_com_ershoufang_sale`）',
      '• 贝壳二手房-成交信息（`sense_data.TB_ke_com_chengjiao_esf`）',
    ].join('\n')
    expect(extractTableSwitchSuggestions(usedTables)).toBeNull()
  })

  it('有换表意图但只有一张候选表时不出胶囊（单选不值得占一排按钮）', () => {
    const single = [
      '这张表没数据，建议换一张表：',
      '',
      '• 贝壳二手房-在售（`sense_data.TB_ke_com_ershoufang_sale`）',
    ].join('\n')
    expect(extractTableSwitchSuggestions(single)).toBeNull()
  })

  it('列表项是业务值（日期/金额）时不当成候选表', () => {
    const numericRows = [
      '这张表查不到，建议换一张表试试：',
      '',
      '• 2026-10-18（5,557）',
      '• 2026-10-19（6,120）',
    ].join('\n')
    expect(extractTableSwitchSuggestions(numericRows)).toBeNull()
  })

  it('历史回放：从落库正文恢复胶囊，刷新后不丢', () => {
    const messages = convertChatLogsToMessages([
      {
        id: 1,
        sessionId: 1,
        msg: '南京二手房最新价格',
        modelMsg: ZERO_ROW_ANSWER,
        status: 'SUCCESS',
      },
    ])
    expect(messages).toHaveLength(2)
    expect(messages[1].clarification).toBeUndefined()
    expect(messages[1].suggestions).toEqual(EXPECTED_ACTIONS)
    expect(messages[1].suggestionsKind).toBe('table_switch')
  })
})
