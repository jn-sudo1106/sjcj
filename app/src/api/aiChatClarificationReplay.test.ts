import { describe, it, expect } from 'vitest'
import { convertChatLogsToMessages, matchClarificationReply, stripHistorySummary, type Clarification } from './aiChat'

const clarification: Clarification = {
  kind: 'table_choice',
  reason: 'AMBIGUOUS',
  question: '请选择要分析的数据源或表：',
  allowFreeText: true,
  maxSelect: 2,
  options: [
    { entryTypeId: 11, ordinal: 1, tableName: 'sense_data.TB_SOURCE_CODE', typeName: 'source_code' },
    { entryTypeId: 22, ordinal: 2, tableName: 'sense_data.TB_CSXXDT', typeName: '城市信息动态' },
  ],
}

describe('澄清卡片历史回放', () => {
  it('按确认回传的单表文本反推勾选项', () => {
    expect(matchClarificationReply(clarification, '城市信息动态（sense_data.TB_CSXXDT）')).toEqual({
      selectedEntryTypeIds: [22],
      freeText: '',
    })
  })

  it('多选与补充要求都能还原', () => {
    expect(
      matchClarificationReply(
        clarification,
        '已确认选择：source_code（sense_data.TB_SOURCE_CODE）、城市信息动态（sense_data.TB_CSXXDT）；补充要求：近 7 天',
      ),
    ).toEqual({ selectedEntryTypeIds: [11, 22], freeText: '近 7 天' })
  })

  it('兼容直接回编号', () => {
    expect(matchClarificationReply(clarification, '1，2')?.selectedEntryTypeIds).toEqual([11, 22])
  })

  it('无关的后续追问不算确认', () => {
    expect(matchClarificationReply(clarification, '换个问题：最近一周告警数')).toBeNull()
  })

  it('回放时把卡片标为已确认并带上勾选项', () => {
    const messages = convertChatLogsToMessages([
      { id: 1, msg: '查询新加坡近7天的城市资讯', modelMsg: '命中 2 张候选表', data: JSON.stringify({ clarification: { ...clarification, confirmed: true } }) },
      { id: 2, msg: '城市信息动态（sense_data.TB_CSXXDT）', modelMsg: '结果如下' },
    ] as never)
    const card = messages.find((m) => m.id === 'm-1-a')?.clarification
    expect(card?.confirmed).toBe(true)
    expect(card?.selectedEntryTypeIds).toEqual([22])
  })
})

describe('历史对话摘要标记', () => {
  const marked = '新加坡近七天资讯查询\n\n[以上为历史对话摘要，以下是最近的对话内容，请直接继续对话]\n\n命中 2 张候选表'

  it('去掉标记及其前面的摘要', () => {
    expect(stripHistorySummary(marked)).toBe('命中 2 张候选表')
    expect(stripHistorySummary('普通回答')).toBe('普通回答')
  })

  it('回放时用户消息只剩摘要就不出空气泡', () => {
    const messages = convertChatLogsToMessages([
      { id: 3, msg: '新加坡近七天资讯查询\n[以上为历史对话摘要，以下是最近的对话内容，请直接继续对话]', modelMsg: marked },
    ] as never)
    expect(messages.map((m) => m.role)).toEqual(['assistant'])
    expect(messages[0].content).toBe('命中 2 张候选表')
  })
})
