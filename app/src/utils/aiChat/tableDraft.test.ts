import { describe, it, expect, vi } from 'vitest'
import {
  buildTableDraftPrompt,
  createTableFromDraft,
  extractTableDraftFromText,
  formatTableCreatedMessage,
  isTableDraftPrompt,
  normalizeTableDraft,
  parseTableCreatedMessage,
  stripTableDraftBlock,
  stripTableDraftPrompt,
  tableDraftFromPayload,
  tableDraftToEntry,
  validateTableDraft,
  type TableDraft,
} from './tableDraft'
import { convertChatLogsToMessages, type BackendChatLog } from '@/api/aiChat'

function draft(overrides: Partial<TableDraft> = {}): TableDraft {
  return {
    name: '统计局指标',
    tableName: 'TB_TJJZB',
    dsKind: 'CK',
    remark: '统计局月度指标',
    fields: [
      { code: 'indicator', desc: '指标名称', type: 'string', dedup: true },
      { code: 'period', desc: '时间', type: 'date', dedup: true },
      { code: 'value', desc: '数值', type: 'number', dedup: false },
    ],
    ...overrides,
  }
}

const ANSWER = `按指标+时间去重。

\`\`\`table-draft
{"name":"统计局指标","tableName":"TB_TJJZB","dsKind":"CK","remark":"月度","fields":[
  {"code":"indicator","desc":"指标名称","type":"varchar(255)","dedup":true},
  {"code":"period","desc":"时间","type":"datetime","dedup":"true"},
  {"code":"value","desc":"数值","type":"decimal"}
]}
\`\`\`

确认后即可创建。`

describe('建表草稿 · 解析', () => {
  it('从正文 table-draft 代码块提取，类型别名归一', () => {
    const result = extractTableDraftFromText(ANSWER)
    expect(result).toMatchObject({ name: '统计局指标', tableName: 'TB_TJJZB', dsKind: 'CK' })
    expect(result!.fields.map((f) => [f.type, f.dedup])).toEqual([['string', true], ['date', true], ['number', false]])
  })

  it('没有代码块、JSON 不合法、未闭合时都不出草稿', () => {
    expect(extractTableDraftFromText('普通回答')).toBeNull()
    expect(extractTableDraftFromText('```table-draft\n{坏的}\n```')).toBeNull()
    expect(extractTableDraftFromText('```table-draft\n{"name":"a","fields":[')).toBeNull()
  })

  it('正文渲染去掉代码块，流式未闭合的半截也藏掉', () => {
    expect(stripTableDraftBlock(ANSWER)).toBe('按指标+时间去重。\n\n\n\n确认后即可创建。')
    expect(stripTableDraftBlock('说明\n```table-draft\n{"name":')).toBe('说明')
  })

  it('SSE 结构化载荷：顶层 tableDraft 或 proposal.table，字段名有出入也认', () => {
    expect(tableDraftFromPayload({ tableDraft: { typeName: 'A', tableName: 'TB_A', items: [{ itemCode: 'x', itemName: 'X' }] } }))
      .toMatchObject({ name: 'A', tableName: 'TB_A', dsKind: 'MYSQL', fields: [{ code: 'x', desc: 'X', type: 'string' }] })
    expect(tableDraftFromPayload({ proposal: { table: { name: 'B', tableName: 'TB_B', storage: 'ClickHouse', columns: [{ name: 'y' }] } } }))
      .toMatchObject({ name: 'B', dsKind: 'CK', fields: [{ code: 'y', desc: 'y' }] })
    expect(tableDraftFromPayload({ choices: [] })).toBeNull()
    expect(normalizeTableDraft({ name: '无字段', fields: [] })).toBeNull()
  })
})

describe('建表草稿 · 校验与落库组装', () => {
  it('合法草稿无错误；表名、编码格式与重复都拦', () => {
    expect(validateTableDraft(draft())).toEqual([])
    const errors = validateTableDraft(draft({
      tableName: '1表',
      fields: [
        { code: 'a', desc: 'A', type: 'string', dedup: false },
        { code: 'A', desc: '', type: 'string', dedup: false },
        { code: 'b-c', desc: 'B', type: 'string', dedup: false },
      ],
    }))
    expect(errors).toEqual([
      '物理表名只能用字母、数字、下划线，且以字母开头',
      '第 2 个字段展示名为空',
      '第 3 个字段编码「b-c」只能用字母、数字、下划线',
      '字段编码重复：a',
    ])
  })

  it('与源上新建表口径一致：K 序物理列、编码-列号、去重列、CK 存储默认值', () => {
    const entry = tableDraftToEntry(draft())
    expect(entry.fields.map((f) => [f.prop, f.columnName, f.seq])).toEqual([
      ['indicator-K1', 'K1', 1],
      ['period-K2', 'K2', 2],
      ['value-K3', 'K3', 3],
    ])
    expect(entry).toMatchObject({
      tableId: '',
      keyField: 'K1,K2',
      dedupMode: 'source',
      dsKind: 'CK',
      storageEngine: 'ReplacingMergeTree',
      sorted: 'ENTRY_ID',
    })
    expect(tableDraftToEntry(draft({ dsKind: 'MYSQL' }))).toMatchObject({ dsKind: 'MYSQL', storageEngine: 'InnoDB' })
  })

  it('createTableFromDraft：校验不过不发请求；没拿到表 ID 视为失败', async () => {
    const save = vi.fn().mockResolvedValue({ tableId: '2101999', message: 'ok' })
    await expect(createTableFromDraft(draft({ name: '' }), save)).rejects.toThrow('表名称必填')
    expect(save).not.toHaveBeenCalled()

    await expect(createTableFromDraft(draft(), save)).resolves.toEqual({ tableId: '2101999', message: 'ok' })
    expect(save.mock.calls[0][0]).toMatchObject({ tableName: 'TB_TJJZB' })

    save.mockResolvedValueOnce({ tableId: '', message: '实体表已保存' })
    await expect(createTableFromDraft(draft(), save)).rejects.toThrow('勿重复提交')
  })
})

describe('建表模式 · 提示词与结果回传', () => {
  it('提示词追加在原文后，可按标记还原', () => {
    const prompt = buildTableDraftPrompt('  建一张表存统计局指标 ')
    expect(isTableDraftPrompt(prompt)).toBe(true)
    expect(prompt).toContain('```table-draft')
    expect(stripTableDraftPrompt(prompt)).toBe('建一张表存统计局指标')
    expect(stripTableDraftPrompt('普通问题')).toBe('普通问题')
  })

  it('结果消息可往返解析', () => {
    const text = formatTableCreatedMessage(draft(), '2101999')
    expect(text).toContain('存储 CK，字段 indicator（指标名称，去重）、period（时间，去重）、value（数值）')
    expect(parseTableCreatedMessage(text)).toEqual({ tableName: 'TB_TJJZB', tableId: '2101999', name: '统计局指标', dsKind: 'CK' })
    // 兼容不带存储字段的早期格式
    expect(parseTableCreatedMessage('【建表结果】已创建数据表「A」，物理表 TB_A，表 ID 1。')).toEqual({ tableName: 'TB_A', tableId: '1', name: 'A' })
    expect(parseTableCreatedMessage('已创建 TB_X')).toBeNull()
  })

  it('历史回放：用户原文还原、草稿出卡片，后面有建表结果回传的标成已创建', () => {
    const logs: BackendChatLog[] = [
      { id: 1, sessionId: 9, msg: buildTableDraftPrompt('建统计局指标表'), modelMsg: ANSWER, status: 'SUCCESS' },
      // 用户在卡片里把 CK 改成 MySQL 后建表：回放时卡片按回传结果显示 MySQL
      { id: 2, sessionId: 9, msg: formatTableCreatedMessage(draft({ dsKind: 'MYSQL' }), '2101999'), modelMsg: '已确认：\n\n| 字段 | 中文名 | 去重 |\n|---|---|---|\n| indicator | 指标名称 | 是 |\n| period | 时间 | 是 |\n| value | 数值 | 否 |', status: 'SUCCESS' },
      { id: 3, sessionId: 9, msg: buildTableDraftPrompt('再建一张'), modelMsg: ANSWER.replace(/TB_TJJZB/g, 'TB_OTHER'), status: 'SUCCESS' },
    ]
    const messages = convertChatLogsToMessages(logs)
    expect(messages[0].content).toBe('建统计局指标表')
    expect(messages[1]).toMatchObject({ draftMode: 'table', question: '建统计局指标表' })
    expect(messages[1].tableDraft).toMatchObject({ status: 'created', tableId: '2101999', draft: { dsKind: 'MYSQL' } })
    expect(messages[1].chartData).toBeUndefined()
    // 对建表结果的回复里复述的字段表是表结构，不渲染成统计图
    expect(messages[3].chartData).toBeUndefined()
    expect(messages[5].tableDraft).toMatchObject({ status: 'pending' })
  })
})
