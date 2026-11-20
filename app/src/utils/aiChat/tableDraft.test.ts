import { describe, it, expect, vi } from 'vitest'
import {
  buildTableDraftPrompt,
  isCreateTableIntent,
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
      { code: 'period', desc: '时间', type: 'string', dedup: true },
      { code: 'value', desc: '数值', type: 'string', dedup: false },
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
  it('从正文 table-draft 代码块提取，类型按数据表编辑的 string/text/longtext 归一', () => {
    const result = extractTableDraftFromText(ANSWER)
    expect(result).toMatchObject({ name: '统计局指标', tableName: 'TB_TJJZB', dsKind: 'CK', dedupMode: 'source' })
    expect(result!.fields.map((f) => [f.type, f.dedup])).toEqual([['string', true], ['string', true], ['string', false]])
    expect(normalizeTableDraft({ name: 'A', dedupMode: '表内去重', fields: [{ code: 'u', type: 'url' }, { code: 'j', type: 'json' }, { code: 't', type: 'text' }] }))
      .toMatchObject({ dedupMode: 'table', fields: [{ type: 'string' }, { type: 'longtext' }, { type: 'text' }] })
  })

  it('没有代码块、JSON 不合法、未闭合时都不出草稿', () => {
    expect(extractTableDraftFromText('普通回答')).toBeNull()
    expect(extractTableDraftFromText('```table-draft\n{坏的}\n```')).toBeNull()
    expect(extractTableDraftFromText('```table-draft\n{"name":"a","fields":[')).toBeNull()
  })

  it('模型手写 JSON 括号错位、尾逗号也能认（186 实测：fields 数组用 } 收尾）', () => {
    const broken = '```table-draft\n{"name":"招聘岗位测试","dsKind":"MYSQL","fields":[\n  {"code":"job_url","desc":"岗位链接","type":"url","dedup":true},\n  }\n}\n```'
    expect(extractTableDraftFromText(broken)).toMatchObject({ name: '招聘岗位测试', fields: [{ code: 'job_url', dedup: true }] })
    expect(extractTableDraftFromText('```table-draft\n{"name":"A{]","fields":[{"code":"a","desc":"x"}]\n```')).toMatchObject({ name: 'A{]' })
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
    expect(tableDraftToEntry(draft({ dedupMode: 'table' }))).toMatchObject({ dedupMode: 'table' })
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

  it('历史回放：草稿没给物理表名（卡片按名称生成）时，认它之后第一条建表结果，不跨到下一份草稿', () => {
    const noName = ANSWER.replace('"tableName":"TB_TJJZB",', '')
    const logs: BackendChatLog[] = [
      { id: 1, sessionId: 9, msg: '建统计局指标表', modelMsg: noName, status: 'SUCCESS' },
      { id: 2, sessionId: 9, msg: formatTableCreatedMessage(draft({ tableName: 'TB_TJJZB_V2' }), '2102000'), modelMsg: '好的', status: 'SUCCESS' },
      { id: 3, sessionId: 9, msg: '再建一张', modelMsg: noName, status: 'SUCCESS' },
    ]
    const messages = convertChatLogsToMessages(logs)
    expect(messages[1].tableDraft).toMatchObject({ status: 'created', tableId: '2102000', draft: { tableName: 'TB_TJJZB_V2' } })
    expect(messages[5].tableDraft).toMatchObject({ status: 'pending', draft: { tableName: '' } })
  })
})

describe('isCreateTableIntent', () => {
  it('明确要新建表时命中', () => {
    for (const t of ['我要建一张表去存南京二手房的信息', '帮我建个表存商品价格', '新建一张CK表', '创建统计局指标表', '建表：存招聘信息']) {
      expect(isCreateTableIntent(t), t).toBe(true)
    }
  })
  it('查询类说法、建表结果回传不命中', () => {
    for (const t of ['最近新建的表有哪些', '创建了哪些表', '查一下二手房表的数据', '【建表结果】已创建数据表「南京二手房」，物理表 TB_NJESF，表 ID 1', '']) {
      expect(isCreateTableIntent(t), t).toBe(false)
    }
  })
})

describe('2806 智能体 ```json + table_draft 写法', () => {
  const body = `{
  "table_draft": {
    "table_name": "TB_NJ_ERSHOUFANG",
    "table_comment": "南京二手房房源信息表",
    "primary_key": "fangyuan_id",
    "dedup_key": ["fangyuan_id"],
    "source": "南京网上房地产/贝壳等",
    "fields": [
      {"name": "fangyuan_id", "type": "varchar(64)", "required": true, "comment": "房源唯一ID（主键，去重）"},
      {"name": "xiaoqu_name", "type": "varchar(128)", "required": true, "comment": "小区名称"},
      {"name": "area_sqm", "type": "decimal(10,2)", "required": true, "comment": "建筑面积（平方米）"},
      {"name": "listing_date", "type": "date", "required": false, "comment": "挂牌时间"},
      {"name": "crawl_time", "type": "datetime", "required": true, "comment": "抓取/入库时间"}
    ]
  }
}`
  for (const lang of ['json', '']) {
    it(`识别 \`\`\`${lang || '（无语言）'} 代码块并归一化`, () => {
      const text = `设计思路如下。\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n草稿已就绪，请在卡片上确认后执行建表。`
      const draft = extractTableDraftFromText(text)!
      expect(draft).toMatchObject({ name: '南京二手房房源信息表', tableName: 'TB_NJ_ERSHOUFANG', dsKind: 'MYSQL', remark: '数据来源：南京网上房地产/贝壳等' })
      expect(draft.fields.map((f) => [f.code, f.desc, f.type, f.dedup])).toEqual([
        ['fangyuan_id', '房源唯一ID（主键，去重）', 'string', true],
        ['xiaoqu_name', '小区名称', 'string', false],
        ['area_sqm', '建筑面积（平方米）', 'string', false],
        ['listing_date', '挂牌时间', 'string', false],
        ['crawl_time', '抓取/入库时间', 'string', false],
      ])
      const stripped = stripTableDraftBlock(text)
      expect(stripped).not.toContain('table_draft')
      expect(stripped).toContain('草稿已就绪')
    })
  }

  it('流式未闭合的 json 草稿块先藏掉；普通 json 代码块不动', () => {
    expect(stripTableDraftBlock(`说明\n\n\`\`\`json\n{\n  "table_draft": {\n    "table_name": "TB_X"`)).toBe('说明')
    const plain = '示例：\n```json\n{"a": 1}\n```'
    expect(extractTableDraftFromText(plain)).toBeNull()
    expect(stripTableDraftBlock(plain)).toBe(plain)
  })
})
