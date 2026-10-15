// 模板配置域（/api/poc/*）mock —— 内存表，写操作真落库，刷新分页能看到变更
// （与 mock/queueCheck.ts、mock/monitor.ts 同一套路）。
//
// 口径照旧平台，不要"顺手改"：
//   · 分页入参 pageNo/pageSize，返回 {list,total}（真实信封是 {code,count,data}，由 client.ts 归一）；
//   · status 是字符串 '0'=启用 / '1'=禁用；
//   · 新增与修改是同一个端点：form 带 id 即更新，不带即新增（后端自增 id）；
//   · 复制按 id 出一条副本，名称加「-副本」（旧后端行为未在页面暴露，这里按可读的方式模拟）；
//   · 表模板（question-temp）没有复制端点，且 tableArr / sqlTempConfigIds 存的是 JSON **字符串**，
//     不是数组——编辑弹窗在两端来回 JSON.parse / JSON.stringify（旧 QuestionTempEditModal.vue）。
import type { Paged } from '../types/common'
import type { ChatFlowStep, DataIndexConfig, DataIndexCodeOption, DataIndexSync, DicTemplate, EntityConfigField, EntityConfigPayload, MatchTableConfig, PocTableEntry, QuestionDic, SqlTemplate, SysPageConfig, SysPageConfigBatchItem, SystemConfigParam, TableTemplate, VectorTableOption, WordSegmentBatchItem, WordSegmentConfig } from '../types/template'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

const blank = (over: Partial<SqlTemplate>): SqlTemplate => ({
  name: '',
  content: '',
  receiveRule: '',
  rejectRule: '',
  selectRule: '',
  fromTableRule: '',
  whereRule: '',
  groupByRule: '',
  havingRule: '',
  afterRule: '',
  status: '1',
  delFlag: '0',
  ...over,
})

/** 种子数据取自 186 POC 服务的真实行（2026-10-13 抓样），便于 mock 与联调对照 */
const SQL_TEMPLATES: SqlTemplate[] = [
  blank({
    id: 36,
    name: '不校验',
    status: '1',
    createTime: '2025-04-11 11:34:39',
    updateTime: '2025-04-11 11:38:35',
  }),
  blank({
    id: 11,
    name: '多表',
    rejectRule: "string.contains(sql,' group by ') || string.contains(sql,' having ') ",
    selectRule: "check('function','avg') == 0&& check('function','max') == 0",
    afterRule: "StringUtils.isEmpty('')",
    status: '1',
    createTime: '2024-12-17 19:19:52',
    updateTime: '2025-04-11 10:50:13',
  }),
  blank({
    id: 9,
    name: '根据日期查询指标信息',
    content: 'select jgmc,sjrq,khzbmc,指标 from KHFA_KHZBJG_JG  where  sjrq =数据日期  and jgmc=机构名称  and khzbmc =指标名称\n',
    receiveRule: "StringUtils.countMatches(sql,' from ') == 1",
    rejectRule: "string.contains(msg,'同比') ||  string.contains(msg,'环比') || string.contains(sql,' group by ')  || string.contains(sql,' having ')",
    selectRule:
      "  check('indexType','z')  >=1 && columnSize >= 1 && check('function','sum') == 0  && check('function','avg') == 0&& check('function','max') == 0",
    fromTableRule: 'tableSize == 1',
    whereRule: "checkType('date','=') >=1 ",
    status: '0',
    createTime: '2025-01-02 11:02:43',
    updateTime: '2025-04-11 10:50:12',
  }),
  blank({
    id: 8,
    name: '同比环比查询',
    content: "select 维度,指标,日期 from KHFA_KHZBJG_JG where jgmc = '上海分行' and sjrq in（ '20241210'，'20231210') ",
    receiveRule: "string.contains(msg,'同比') || string.contains(msg,'环比')  || string.contains(msg,'同期相比') ",
    rejectRule: "string.contains(sql,' group by ') || string.contains(sql,' having ')",
    fromTableRule: 'tableSize == 1',
    status: '1',
    createTime: '2025-01-02 11:02:43',
    updateTime: '2025-04-11 10:50:11',
  }),
  blank({
    id: 6,
    name: '单指标查询',
    content: "select 维度,指标,日期 from 表 where 维度 = '上海分行' and 日期 = '20241210' ",
    receiveRule: "StringUtils.countMatches(sql,' from ') == 1",
    fromTableRule: 'tableSize == 1',
    whereRule: "checkType('date','=') >=1 ",
    status: '0',
    createTime: '2025-01-02 11:02:43',
    updateTime: '2025-04-11 10:50:09',
  }),
]

let sqlTemplateNextId = 100

/** sql 模板分页：只按模板名称模糊筛（旧 SqlTempConfig 的唯一筛选项）
 * ids：旧「表模板」编辑弹窗反查已选 sql 模板显示名用的入参（sqlTempPage({pageNo,pageSize,name,ids})），
 * 传了就只回这些 id，否则选中的模板在弹窗里只剩数字、看不到名称。 */
export function mockSqlTemplatePaged(params?: Record<string, unknown>): Paged<SqlTemplate> {
  const name = String(params?.name ?? '').trim()
  const rawIds = params?.ids
  const ids = Array.isArray(rawIds) ? rawIds.map(Number) : []
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = SQL_TEMPLATES.filter(
    (row) => (!ids.length || ids.includes(Number(row.id))) && (!name || String(row.name ?? '').includes(name)),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增 / 编辑同一个入口：带 id 就地更新（只覆盖传过来的字段），不带 id 追加 */
export function mockSqlTemplateSave(params?: Record<string, unknown>) {
  const form = params as Partial<SqlTemplate>
  const id = Number(form.id ?? 0)
  if (id) {
    const row = SQL_TEMPLATES.find((r) => Number(r.id) === id)
    if (!row) return { ok: false, message: '未找到要保存的模板' }
    for (const [key, value] of Object.entries(form)) {
      if (key === 'id') continue
      ;(row as Record<string, unknown>)[key] = value
    }
    row.updateTime = stamp(new Date())
    return { ok: true, message: '修改成功（演示）' }
  }
  const nextId = sqlTemplateNextId++
  SQL_TEMPLATES.unshift({ ...blank({}), ...form, id: nextId, createTime: stamp(new Date()), updateTime: stamp(new Date()) })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 启停：status '0' 启用 / '1' 禁用 */
export function mockSqlTemplateChangeStatus(params?: Record<string, unknown>) {
  const row = SQL_TEMPLATES.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的模板' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/** 复制：按 id 出一条副本 */
export function mockSqlTemplateCopy(params?: Record<string, unknown>) {
  const row = SQL_TEMPLATES.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到要复制的模板' }
  const nextId = sqlTemplateNextId++
  SQL_TEMPLATES.unshift({
    ...row,
    id: nextId,
    name: `${row.name ?? ''}-副本`,
    status: '1',
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '复制成功（演示）' }
}

/* ── 表模板配置（旧「模板配置 → 表模板配置」，端点域 /poc/question-temp） ── */

/**
 * 表模板种子数据。
 * ⚠️ 与上面 sql 模板的 186 真实抓样不同，这几行是按旧 QuestionTempEditModal 的字段形状**构造的示例**
 * （本轮环境访问不到 POC 服务，question-temp 的真实行没取到）。联调后请用真实响应校正，
 * 特别是 tableArr / sqlTempConfigIds 的 JSON 字符串口径。
 */
const blankTable = (over: Partial<TableTemplate>): TableTemplate => ({
  name: '',
  rule: '',
  tableArr: '[]',
  sqlTempConfigIds: '[]',
  status: '1',
  delFlag: '0',
  ...over,
})

const TABLE_TEMPLATES: TableTemplate[] = [
  blankTable({
    id: 12,
    name: '查询某机构某日期的指标值',
    rule: "string.contains(msg,'指标') && string.contains(msg,'日期')",
    tableArr: JSON.stringify(['KHFA_KHZBJG_JG']),
    sqlTempConfigIds: JSON.stringify([9]),
    status: '0',
    createTime: '2025-04-15 09:52:07',
    updateTime: '2025-04-15 09:52:07',
  }),
  blankTable({
    id: 11,
    name: '同比环比类问句',
    rule: "string.contains(msg,'同比') || string.contains(msg,'环比')",
    tableArr: JSON.stringify(['KHFA_KHZBJG_JG', 'KHFA_ZB_DEF']),
    sqlTempConfigIds: JSON.stringify([8, 6]),
    status: '1',
    createTime: '2025-01-08 15:21:40',
    updateTime: '2025-04-11 10:50:30',
  }),
  blankTable({
    id: 10,
    name: '未匹配到的兜底问句',
    rule: '',
    tableArr: '[]',
    sqlTempConfigIds: '[]',
    status: '0',
    createTime: '2024-12-20 18:03:11',
    updateTime: '2025-03-02 09:14:55',
  }),
]

let tableTemplateNextId = 100

/** 表模板分页：按「问句样例」（字段名 name）模糊筛，旧 QuestionTempConfig 的唯一筛选项 */
export function mockTableTemplatePaged(params?: Record<string, unknown>): Paged<TableTemplate> {
  const name = String(params?.name ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = TABLE_TEMPLATES.filter((row) => !name || String(row.name ?? '').includes(name))
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增 / 编辑同一个入口：带 id 就地更新，不带 id 追加（旧 questionTempSave） */
export function mockTableTemplateSave(params?: Record<string, unknown>) {
  const form = params as Partial<TableTemplate>
  const id = Number(form.id ?? 0)
  if (id) {
    const row = TABLE_TEMPLATES.find((r) => Number(r.id) === id)
    if (!row) return { ok: false, message: '未找到要保存的模板' }
    for (const [key, value] of Object.entries(form)) {
      if (key === 'id') continue
      ;(row as Record<string, unknown>)[key] = value
    }
    row.updateTime = stamp(new Date())
    return { ok: true, message: '修改成功（演示）' }
  }
  const nextId = tableTemplateNextId++
  TABLE_TEMPLATES.unshift({
    ...blankTable({}),
    ...form,
    id: nextId,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 启停：status '0' 启用 / '1' 禁用（旧 changeQuestionTempStatus，参数走 query） */
export function mockTableTemplateChangeStatus(params?: Record<string, unknown>) {
  const row = TABLE_TEMPLATES.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的模板' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/**
 * 数据表选项（旧 tableList → GET /poc/database/entry-list?name=），表模板「使用表范围」与
 * 表字段管理「选择表」下拉的数据源。
 * 返回**裸数组**（真实信封 {code,data:[...]} 没有 count，client.ts 直接透传 data），按表名模糊筛。
 * ⚠️ 同样是为演示构造的示例表，名称与上面 sql 模板种子里的表名对得上，便于串起完整链路。
 * entryTypeId + 表头字段（aiComment/aiRule/aiDesc/aliasName/useAlias）是表字段管理选中后回填用的形状。
 */
const POC_TABLE_ENTRIES: PocTableEntry[] = [
  { entryTypeId: 1, tableName: 'KHFA_KHZBJG_JG', typeName: '客户指标结果', aiComment: '客户指标结果', aiDesc: '按机构与日期存储的客户指标结果', aiRule: '', aliasName: 'KHFA_KHZBJG_JG', useAlias: 0 },
  { entryTypeId: 2, tableName: 'KHFA_ZB_DEF', typeName: '指标定义', aiComment: '指标定义', aiDesc: '指标口径定义表', aiRule: '', aliasName: 'KHFA_ZB_DEF', useAlias: 0 },
  { entryTypeId: 3, tableName: 'KHFA_JG_DEF', typeName: '机构定义', aiComment: '机构定义', aiDesc: '机构层级与编码', aiRule: '', aliasName: 'KHFA_JG_DEF', useAlias: 0 },
  { entryTypeId: 4, tableName: 'KHFA_KHJBXX', typeName: '客户基本信息', aiComment: '客户基本信息', aiDesc: '客户主档案', aiRule: '', aliasName: 'KHFA_KHJBXX', useAlias: 0 },
  { entryTypeId: 5, tableName: 'DIM_DATE', typeName: '日期维表', aiComment: '日期维表', aiDesc: '自然日维度', aiRule: '', aliasName: 'DIM_DATE', useAlias: 0 },
]

export function mockPocDatabaseEntryList(params?: Record<string, unknown>): PocTableEntry[] {
  const name = String(params?.name ?? '').trim().toUpperCase()
  if (!name) return POC_TABLE_ENTRIES.map((entry) => ({ ...entry }))
  return POC_TABLE_ENTRIES.filter((entry) => entry.tableName.toUpperCase().includes(name)).map((entry) => ({ ...entry }))
}

/**
 * 表字段管理（旧「基础配置 → 表字段管理」，1015 迁入）的字段行内存表，key = entryTypeId。
 * 首次访问按表头种子的列形状构造示例字段；保存（mockPocDatabaseConfigSave）整表覆盖这里与 POC_TABLE_ENTRIES 的表头字段。
 */
const POC_ENTITY_FIELDS = new Map<number, EntityConfigField[]>()

function seedEntityFields(entryTypeId: number): EntityConfigField[] {
  return [
    { itemId: entryTypeId * 100 + 1, itemCode: 'JGMC', itemName: '机构名称', aliasName: 'BRANCH_NAME', dataType: 'VARCHAR2', aiComment: '机构名称', aiRule: '', aiSeq: 1, aiIndexType: 'w', aiBusinessType: 'text', aiBusinessFormat: '', chooseType: 1, chooseRule: '', mappingType: 2, mappingColumn: 'jgmc', subSql: '', trainingData: '0', dataIndex: 1, vector: 0 },
    { itemId: entryTypeId * 100 + 2, itemCode: 'SJRQ', itemName: '数据日期', aliasName: 'DATA_DATE', dataType: 'DATE', aiComment: '数据日期', aiRule: '', aiSeq: 2, aiIndexType: 'date', aiBusinessType: 'date', aiBusinessFormat: 'yyyyMMdd', chooseType: null, chooseRule: '', mappingType: null, mappingColumn: '', subSql: '', trainingData: '0', dataIndex: 0, vector: 0 },
    { itemId: entryTypeId * 100 + 3, itemCode: 'KHZBMC', itemName: '客户指标名称', aliasName: 'ZB_NAME', dataType: 'VARCHAR2', aiComment: '客户指标名称', aiRule: '', aiSeq: 3, aiIndexType: 'z', aiBusinessType: 'float', aiBusinessFormat: 'total', chooseType: 1, chooseRule: '', mappingType: null, mappingColumn: '', subSql: '', trainingData: '1', dataIndex: 1, vector: 0 },
  ]
}

/** 字段列表（旧 tableDesc → GET /poc/database/table-info?tableId=），返回裸数组 */
export function mockPocDatabaseTableInfo(params?: Record<string, unknown>): EntityConfigField[] | { ok: false; message: string } {
  const tableId = Number(params?.tableId)
  if (!POC_TABLE_ENTRIES.some((entry) => Number(entry.entryTypeId) === tableId)) {
    return { ok: false, message: '未找到对应的数据表' }
  }
  if (!POC_ENTITY_FIELDS.has(tableId)) POC_ENTITY_FIELDS.set(tableId, seedEntityFields(tableId))
  return POC_ENTITY_FIELDS.get(tableId)!.map((field) => ({ ...field }))
}

/** 保存配置（旧 saveConfig → POST /poc/database/config）—— {entityType, entityItems} 整表覆盖 */
export function mockPocDatabaseConfigSave(params?: Record<string, unknown>) {
  const payload = params as unknown as EntityConfigPayload
  const entryTypeId = Number(payload?.entityType?.entryTypeId)
  const row = POC_TABLE_ENTRIES.find((entry) => Number(entry.entryTypeId) === entryTypeId)
  if (!row) return { ok: false, message: '未找到要保存的数据表' }
  const { aiComment, aiDesc, aiRule, aliasName, useAlias } = payload.entityType
  Object.assign(row, { aiComment, aiDesc, aiRule, aliasName, useAlias })
  POC_ENTITY_FIELDS.set(
    entryTypeId,
    (payload.entityItems ?? []).map((field) => {
      const clone = { ...field }
      // 页面行上的派生展示键不进"库"（真实后端也只认实体字段），与旧 save 的整行回传口径一致地保留 dataIndex/vector
      if (clone.dataIndexFlag != null) clone.dataIndex = clone.dataIndexFlag ? 1 : 0
      if (clone.vectorFlag != null) clone.vector = clone.vectorFlag ? 1 : 0
      return clone
    }),
  )
  return { ok: true, message: '保存成功（演示）' }
}

/* ── 向量表数据浏览（旧「基础配置 → 向量表数据浏览」，端点域 /poc/vector，1015 迁入） ── */

/**
 * 向量表选项种子。
 * ⚠️ 按旧 VectorTableList.vue 的列形状（name/comment/sourceTable/matchDegree/dataIndexCode/lastSync/updateTime）
 * **构造的示例**，未取到 POC 服务真实行，联调后用真实响应校正。
 */
const VECTOR_TABLES: VectorTableOption[] = [
  { id: 1, name: 'DIM_JG_VECTOR', comment: '机构向量表', sourceTable: 'sense_data.DIM_JG', matchDegree: 0.85, dataIndexCode: '', lastSync: '2026-10-12 09:20:31', updateTime: '2026-10-12 09:20:31' },
  { id: 2, name: 'KHFA_ZB_VECTOR', comment: '客户指标向量表', sourceTable: 'sense_data.KHFA_KHZBJG_JG', matchDegree: 0.9, dataIndexCode: 'ZB', lastSync: '2026-10-13 18:02:07', updateTime: '2026-10-13 18:02:07' },
  { id: 3, name: 'DIC_YHH_VECTOR', comment: '用户号向量表', sourceTable: 'sense_data.DIC_YHH', matchDegree: 0.75, dataIndexCode: 'YHH', lastSync: '2026-09-30 07:45:00', updateTime: '2026-10-08 11:13:26' },
]

/** mock 侧的向量表数据行（形状同上，是构造示例；旧页面不解析它，只整份 JSON 展示） */
interface VectorMockRow {
  id: number
  code: string
  name: string
  alias: string
  score: number
}

const VECTOR_ROWS: Record<string, VectorMockRow[]> = {
  DIM_JG_VECTOR: [
    { id: 101, code: 'JG001', name: '杭州分行', alias: 'hangzhou branch', score: 0.93 },
    { id: 102, code: 'JG002', name: '宁波分行', alias: 'ningbo branch', score: 0.81 },
    { id: 103, code: 'JG003', name: '温州分行', alias: 'wenzhou branch', score: 0.62 },
  ],
  KHFA_ZB_VECTOR: [
    { id: 201, code: 'ZB_AUM', name: '管理资产总额', alias: 'aum', score: 0.88 },
    { id: 202, code: 'ZB_DK', name: '贷款余额', alias: 'loan balance', score: 0.7 },
  ],
  DIC_YHH_VECTOR: [
    { id: 301, code: 'YHH0001', name: '活期存款', alias: 'CNY 活期', score: 0.95 },
  ],
}

/** 向量表下拉（旧 vectorConfigList → GET /poc/vector/config/all?name=），返回裸数组 */
export function mockPocVectorConfigList(params?: Record<string, unknown>): VectorTableOption[] {
  const name = String(params?.name ?? '').trim().toUpperCase()
  if (!name) return VECTOR_TABLES.map((row) => ({ ...row }))
  return VECTOR_TABLES.filter((row) => `${row.name}${row.comment ?? ''}`.toUpperCase().includes(name)).map((row) => ({ ...row }))
}

/**
 * 向量表数据查询（旧 vectorDataQuery → POST /poc/vector/data，body {input, type, pageSize, pageNo}）。
 * 旧页面没有分页控件（pageNo/pageSize 固定 1/20 随表单发出），所以这里按 pageSize 截前若干条、
 * input 对 code/name/alias 做不区分大小写的模糊匹配；type 为空按旧页面「未选表直接查询」的口径回空数组。
 */
export function mockPocVectorDataQuery(params?: Record<string, unknown>): VectorMockRow[] | { ok: false; message: string } {
  const type = String(params?.type ?? '').trim()
  if (!type) return []
  const rows = VECTOR_ROWS[type]
  if (!rows) return { ok: false, message: '未找到对应的向量表' }
  const input = String(params?.input ?? '').trim().toUpperCase()
  const matched = input
    ? rows.filter((row) => `${row.code}${row.name}${row.alias}`.toUpperCase().includes(input))
    : rows
  const pageSize = Number(params?.pageSize ?? 20) || 20
  return matched.slice(0, pageSize).map((row) => ({ ...row }))
}

/* ── 选表规则配置（旧「基础配置 → 选表规则配置」，端点域 /poc/match-table-config，1015 迁入） ── */

/**
 * 选表规则种子数据 —— 取自 186 POC 服务的真实行（2026-10-15 浏览器会话抓样，全库就这 2 条）。
 * 两条都是 text_selection（问句选表）、rule 是 `^(?=.*…)(?=.*(行员|员工)).+$` 这种前瞻正则、且都是**禁用**；
 * tableId / type / delFlag 三列旧页面不展示（编辑时要原样带回，见 MatchTableConfigEditDialog 的 passthrough）。
 * ⚠️ 真实响应的 status 回的是**数字** 1（与 TemplateRow 声明的字符串不一致），列表与筛选一律按 String(row.status) 比；
 * 内存表按实体声明存字符串，与数据索引同步同一口径。
 * ⚠️ 真实后端**不认分页的 status 筛选**（'0'/'1'/数字/不传都回全量），这里按旧页面**期望**的语义实现，
 * 所以 mock 下的「状态」下拉比真实环境更好用 —— 别据此以为后端支持它。
 * 没有 vector_selection 的真实行，向量选表的码值形状按旧弹窗下拉（MatchTableConfigEditor.vue:28-30）保留。
 */
const blankMatchTableConfig = (over: Partial<MatchTableConfig>): MatchTableConfig => ({
  tableName: '',
  selectionType: 'text_selection',
  rule: '',
  type: '0',
  delFlag: '0',
  status: '0',
  ...over,
})

const MATCH_TABLE_CONFIGS: MatchTableConfig[] = [
  blankMatchTableConfig({
    id: 8,
    tableId: 1042,
    tableName: 'YJZB_HY_GHKJ',
    selectionType: 'text_selection',
    rule: '^(?=.*管户口径 )(?=.*(行员|员工)).+$',
    status: '1',
    createTime: '2025-03-11 17:42:41',
    updateTime: '2025-06-13 17:58:29',
  }),
  blankMatchTableConfig({
    id: 7,
    tableId: 1041,
    tableName: 'YJZB_HY_JX',
    selectionType: 'text_selection',
    rule: '^(?=.*绩效口径)(?=.*(行员|员工)).+$',
    status: '1',
    createTime: '2025-03-11 17:42:41',
    updateTime: '2025-06-13 17:58:30',
  }),
]

let matchTableConfigNextId = 9

/**
 * 分页：旧页面两个筛选 —— name（搜索框标签「表名称」，实测按 tableName 模糊筛）与 status（空串 = 全部）。
 */
export function mockMatchTableConfigPaged(params?: Record<string, unknown>): Paged<MatchTableConfig> {
  const name = String(params?.name ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = MATCH_TABLE_CONFIGS.filter(
    (row) => (!name || String(row.tableName ?? '').includes(name)) && (!status || String(row.status ?? '') === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增 / 编辑同一个端点（POST /poc/match-table-config）—— 旧 editor：body 带 id 就地更新，不带 id 追加 */
export function mockMatchTableConfigSave(params?: Record<string, unknown>) {
  const form = params as Partial<MatchTableConfig>
  const id = Number(form.id ?? 0)
  if (id) {
    const row = MATCH_TABLE_CONFIGS.find((r) => Number(r.id) === id)
    if (!row) return { ok: false, message: '未找到要保存的选表规则' }
    for (const [key, value] of Object.entries(form)) {
      if (key === 'id') continue
      ;(row as Record<string, unknown>)[key] = value
    }
    row.updateTime = stamp(new Date())
    return { ok: true, message: '修改成功（演示）' }
  }
  const nextId = matchTableConfigNextId++
  MATCH_TABLE_CONFIGS.unshift({
    ...blankMatchTableConfig({}),
    ...form,
    id: nextId,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 启停（POST /poc/match-table-config/status，参数走 **query**）—— 旧 changeConfigStatus */
export function mockMatchTableConfigChangeStatus(params?: Record<string, unknown>) {
  const row = MATCH_TABLE_CONFIGS.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的选表规则' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/** 删除（POST /poc/match-table-config/delete，id 走 **query**）—— 旧 deleteConfig */
export function mockMatchTableConfigDelete(params?: Record<string, unknown>) {
  const id = Number(params?.id)
  const index = MATCH_TABLE_CONFIGS.findIndex((r) => Number(r.id) === id)
  if (index < 0) return { ok: false, message: '未找到要删除的选表规则' }
  MATCH_TABLE_CONFIGS.splice(index, 1)
  return { ok: true, message: '删除成功（演示）' }
}

/* ── 自动补全配置（旧「模板配置 → 自动补全配置」，端点域 /poc/dic） ── */

/**
 * 自动补全种子数据。
 * ⚠️ 按旧 DicConfig/DicEditor 的字段形状**构造的示例**（content/keyWords/type=1），
 * 未取到 POC 服务真实行，联调后用真实响应校正。
 */
const blankDic = (over: Partial<DicTemplate>): DicTemplate => ({
  content: '',
  keyWords: '',
  type: 1,
  status: '0',
  delFlag: '0',
  ...over,
})

const DIC_TEMPLATES: DicTemplate[] = [
  blankDic({
    id: 3,
    content: '查询某机构某日期的客户指标结果',
    keyWords: '机构 日期 客户指标',
    createTime: '2025-04-15 09:52:07',
    updateTime: '2025-04-15 09:52:07',
  }),
  blankDic({
    id: 2,
    content: '同比环比类指标查询',
    keyWords: '同比 环比',
    createTime: '2025-01-08 15:21:40',
    updateTime: '2025-04-11 10:50:30',
  }),
  blankDic({
    id: 1,
    content: '按日期统计指标信息',
    keyWords: '日期 统计 指标',
    createTime: '2024-12-20 18:03:11',
    updateTime: '2025-03-02 09:14:55',
  }),
]

let dicTemplateNextId = 100

/** 自动补全分页：旧口径筛选参数叫 name，模糊匹配的是「内容」content */
export function mockDicTemplatePaged(params?: Record<string, unknown>): Paged<DicTemplate> {
  const name = String(params?.name ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = DIC_TEMPLATES.filter((row) => !name || String(row.content ?? '').includes(name))
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增（POST /poc/dic，不带 id）—— 旧 dicAdd */
export function mockDicTemplateAdd(params?: Record<string, unknown>) {
  const form = params as Partial<DicTemplate>
  const nextId = dicTemplateNextId++
  DIC_TEMPLATES.unshift({
    ...blankDic({}),
    ...form,
    id: nextId,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 修改（POST /poc/dic/update，带 id）—— 旧 dicUpdate；与新增是两个端点，不要合并 */
export function mockDicTemplateUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<DicTemplate>
  const row = DIC_TEMPLATES.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的词条' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/* ── 问句改写配置（旧「模板配置 → 问句改写配置」，端点域 /poc/question-dic） ── */

/**
 * 问句改写种子数据。
 * ⚠️ 按旧 QuestionDicList / QuestionDicEditor 的字段形状**构造的示例**（未取到 POC 服务真实行，
 * 直连探测返回 302 需要登录态），联调后用真实响应校正。
 * type 是**字符串** '10'/'11'/'20'（与自动补全的数字 type 不同）。
 */
const blankQuestionDic = (over: Partial<QuestionDic>): QuestionDic => ({
  stepCode: 'pre-replace',
  type: '10',
  receiveRule: '',
  content: '',
  targetContent: '',
  tag: '',
  status: '0',
  delFlag: '0',
  ...over,
})

const QUESTION_DICS: QuestionDic[] = [
  blankQuestionDic({
    id: 12,
    stepCode: 'pre-replace',
    type: '10',
    content: '上个月',
    targetContent: '上月',
    createTime: '2025-04-15 09:52:07',
    updateTime: '2025-04-15 09:52:07',
  }),
  blankQuestionDic({
    id: 11,
    stepCode: 'before-llm',
    type: '11',
    receiveRule: "string.contains(msg,'机构')",
    content: '各个机构',
    targetContent: '各机构',
    status: '1',
    createTime: '2025-01-08 15:21:40',
    updateTime: '2025-04-11 10:50:30',
  }),
  blankQuestionDic({
    id: 10,
    stepCode: 'after-llm',
    type: '20',
    content: '指标名称',
    targetContent: 'jgmc',
    createTime: '2024-12-20 18:03:11',
    updateTime: '2025-03-02 09:14:55',
  }),
]

let questionDicNextId = 100

/** 问句改写分页：旧列表四个筛选项全部在 body —— name（模糊匹配「内容」）+ stepCode + type + status，空串=全部 */
export function mockQuestionDicPaged(params?: Record<string, unknown>): Paged<QuestionDic> {
  const name = String(params?.name ?? '').trim()
  const stepCode = String(params?.stepCode ?? '').trim()
  const type = String(params?.type ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = QUESTION_DICS.filter(
    (row) =>
      (!name || String(row.content ?? '').includes(name)) &&
      (!stepCode || row.stepCode === stepCode) &&
      (!type || String(row.type) === type) &&
      (!status || String(row.status) === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增（POST /poc/question-dic，不带 id）—— 旧 questionDicAdd */
export function mockQuestionDicAdd(params?: Record<string, unknown>) {
  const form = params as Partial<QuestionDic>
  const nextId = questionDicNextId++
  QUESTION_DICS.unshift({
    ...blankQuestionDic({}),
    ...form,
    id: nextId,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 修改（POST /poc/question-dic/update，带 id）—— 旧 questionDicUpdate；与新增是两个端点，不要合并 */
export function mockQuestionDicUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<QuestionDic>
  const row = QUESTION_DICS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的改写规则' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 启停（POST /poc/question-dic/status，参数走 query）—— 旧 questionDicDataStatus */
export function mockQuestionDicChangeStatus(params?: Record<string, unknown>) {
  const row = QUESTION_DICS.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的改写规则' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/** 删除（POST /poc/question-dic/deleteQuestionDic，旧页面发整行）—— 真从内存表移除，不是软删 */
export function mockQuestionDicDelete(params?: Record<string, unknown>) {
  const index = QUESTION_DICS.findIndex((r) => Number(r.id) === Number(params?.id))
  if (index < 0) return { ok: false, message: '未找到要删除的改写规则' }
  QUESTION_DICS.splice(index, 1)
  return { ok: true, message: '删除成功（演示）' }
}

/* ── 数据索引同步（旧「模板配置 → 数据索引同步」，端点域 /poc/data-index-sync） ── */

/**
 * 数据索引同步种子数据。
 * 取自 186 POC 服务的真实行（2026-10-13 抓样，共 46 条：type 0 有 42 条、1 有 3 条、2 有 1 条，
 * 状态全部启用），三种同步类型各留一条便于对照 mock 与联调。
 * ⚠️ 真实响应的 status 回的是**数字** 0（与 TemplateRow 声明的字符串不一致），所以列表与筛选一律按
 * String(row.status) 比；内存表按实体声明存 '0'，新建时也和旧弹窗一样恒为 '0'。
 */
const blankDataIndexSync = (over: Partial<DataIndexSync>): DataIndexSync => ({
  type: 0,
  comment: '',
  tableName: '',
  columnName: '',
  syncSql: '',
  beforeSql: null,
  afterSql: null,
  aliasColumn: null,
  codeColumn: null,
  status: '0',
  lastSync: null,
  delFlag: '0',
  ...over,
})

const DATA_INDEX_SYNCS: DataIndexSync[] = [
  blankDataIndexSync({
    id: 56,
    type: 0,
    tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
    columnName: 'BRANCH_NAME',
    comment: '机构指标数据表-机构名称',
    syncSql: 'select distinct BRANCH_NAME,BRANCH_NO as CODE from ADS_HFBI_ZQFXS_JGZBMX',
    lastSync: '2025-06-13 18:23:56',
    createTime: '2025-04-22 18:56:48',
    updateTime: '2025-04-22 18:56:48',
  }),
  blankDataIndexSync({
    id: 47,
    type: 2,
    tableName: 'YJZB_HY_JX',
    columnName: null,
    comment: '分词同步配置',
    syncSql: "select distinct HYMC as CONTENT, 'PERSON' as TYPE, 'base' as TOKEN from YJZB_HY_JX where HYMC is not null",
    lastSync: '2025-03-12 21:32:17',
    createTime: '2025-03-12 19:32:47',
    updateTime: '2025-03-12 19:32:47',
  }),
  blankDataIndexSync({
    id: 24,
    type: 1,
    tableName: 'dev_chat_table_config',
    columnName: 'data_index',
    comment: '数据索引同步',
    syncSql: '{"type":"indexMsg","params":""}',
    lastSync: null,
    createTime: '2025-01-20 19:45:54',
    updateTime: '2025-02-10 17:43:41',
  }),
]

let dataIndexSyncNextId = 100

/** 数据索引同步分页：旧口径两个筛选项都在 body —— name（模糊匹配「同步名称」comment）+ status，空串=全部 */
export function mockDataIndexSyncPaged(params?: Record<string, unknown>): Paged<DataIndexSync> {
  const name = String(params?.name ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = DATA_INDEX_SYNCS.filter(
    (row) =>
      (!name || String(row.comment ?? '').includes(name)) &&
      (!status || String(row.status ?? '') === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增（POST /poc/data-index-sync，不带 id）—— 旧 dataIndexSyncConfigAdd */
export function mockDataIndexSyncAdd(params?: Record<string, unknown>) {
  const form = params as Partial<DataIndexSync>
  const nextId = dataIndexSyncNextId++
  DATA_INDEX_SYNCS.unshift({
    ...blankDataIndexSync({}),
    ...form,
    id: nextId,
    lastSync: null,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 修改（POST /poc/data-index-sync/update，带 id）—— 旧 dataIndexSyncConfigUpdate；与新增是两个端点，不要合并 */
export function mockDataIndexSyncUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<DataIndexSync>
  const row = DATA_INDEX_SYNCS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的同步配置' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/**
 * 执行同步（POST /poc/data-index-sync/sync）—— 旧 dataIndexSync。
 * ⚠️ 这个端点的 body 是 **id 数组**（`[56]`），不是对象，所以入参在这里拿到的是数组而不是 Record。
 * 真实后端会按行的 beforeSql/syncSql/afterSql 重建索引并回写 lastSync；mock 只回写 lastSync。
 */
export function mockDataIndexSyncRun(params?: Record<string, unknown>) {
  const ids = (Array.isArray(params) ? params : []).map((id) => Number(id))
  if (!ids.length) return { ok: false, message: '没有要同步的配置' }
  let hit = 0
  for (const id of ids) {
    const row = DATA_INDEX_SYNCS.find((r) => Number(r.id) === id)
    if (!row) continue
    row.lastSync = stamp(new Date())
    hit += 1
  }
  if (!hit) return { ok: false, message: '未找到要同步的配置' }
  return { ok: true, data: hit, message: `已同步 ${hit} 条（演示）` }
}

/* ── 数据字典配置（旧「模板配置 → 数据字典配置」，端点域 /poc/data-index-config） ── */

/**
 * 数据字典种子数据。
 * ⚠️ 按旧 DataIndexList / DataIndexConfigEditor 的字段形状**构造的示例**（未取到 POC 服务真实行，
 * 沙箱直连 186 探测不通），联调后用真实响应校正。
 * 一条字典项 = code + type + content（+ 后端侧的 contentCode），alias 是页面上唯一能改的「数据别名」；
 * 表名与「数据索引同步」种子（ADS_HFBI_ZQFXS_JGZBMX 的 BRANCH_NAME / BRANCH_NO）对得上，便于串链路。
 */
const blankDataIndexConfig = (over: Partial<DataIndexConfig>): DataIndexConfig => ({
  code: '',
  type: '',
  content: '',
  alias: '',
  contentCode: null,
  status: '0',
  delFlag: '0',
  ...over,
})

const DATA_INDEX_CONFIGS: DataIndexConfig[] = [
  blankDataIndexConfig({
    id: 41,
    code: 'BRANCH_NAME',
    type: 'ORG',
    content: '城南支行',
    alias: '城南',
    contentCode: '1001',
    createTime: '2025-04-22 18:56:48',
    updateTime: '2025-05-09 10:12:33',
  }),
  blankDataIndexConfig({
    id: 42,
    code: 'BRANCH_NAME',
    type: 'ORG',
    content: '高新区支行',
    alias: '',
    contentCode: '1002',
    createTime: '2025-04-22 18:56:48',
    updateTime: '2025-04-22 18:56:48',
  }),
  blankDataIndexConfig({
    id: 55,
    code: 'INDICATOR_DATE',
    type: 'DATE',
    content: '数据日期',
    alias: '统计口径日期',
    contentCode: null,
    status: '1',
    createTime: '2025-03-12 19:32:47',
    updateTime: '2025-06-13 18:23:56',
  }),
]

let dataIndexConfigNextId = 100

/**
 * 数据字典分页：旧页面四个筛选都在 body —— name（旧搜索框标题「内容」，匹配 content）、
 * code、type、status，空串都当「全部」不加权筛。
 */
export function mockDataIndexConfigPaged(params?: Record<string, unknown>): Paged<DataIndexConfig> {
  const name = String(params?.name ?? '').trim()
  const code = String(params?.code ?? '').trim()
  const type = String(params?.type ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = DATA_INDEX_CONFIGS.filter(
    (row) =>
      (!name || String(row.content ?? '').includes(name)) &&
      (!code || String(row.code ?? '') === code) &&
      (!type || String(row.type ?? '').includes(type)) &&
      (!status || String(row.status ?? '') === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 编码下拉数据源（GET /poc/data-index-config/all-code）—— 返回 {code,type} 裸数组，旧页面一次拉全量 */
export function mockDataIndexConfigAllCode(): DataIndexCodeOption[] {
  const seen = new Set<string>()
  const options: DataIndexCodeOption[] = []
  for (const row of DATA_INDEX_CONFIGS) {
    const key = `${row.code ?? ''}|${row.type ?? ''}`
    if (!row.code || seen.has(key)) continue
    seen.add(key)
    options.push({ code: row.code, type: row.type ?? null })
  }
  return options
}

/** 新增（POST /poc/data-index-config，不带 id）—— 旧 dataIndexConfigAdd */
export function mockDataIndexConfigAdd(params?: Record<string, unknown>) {
  const form = params as Partial<DataIndexConfig>
  const nextId = dataIndexConfigNextId++
  DATA_INDEX_CONFIGS.unshift({
    ...blankDataIndexConfig({}),
    ...form,
    id: nextId,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 修改（POST /poc/data-index-config/update，带 id）—— 旧 dataIndexConfigUpdate；与新增是两个端点，不要合并 */
export function mockDataIndexConfigUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<DataIndexConfig>
  const row = DATA_INDEX_CONFIGS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的字典项' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 启停（POST /poc/data-index-config/status，⚠️ 参数走 body，与 question-dic 的 query 不同）—— 旧 dataIndexConfigStatus */
export function mockDataIndexConfigChangeStatus(params?: Record<string, unknown>) {
  const row = DATA_INDEX_CONFIGS.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的字典项' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/* ── 提示词配置（旧「模板配置 → 提示词配置」，端点域 /poc/chat-flow-step） ── */

/**
 * 提示词配置种子数据。
 * ⚠️ 按旧 ChatFlowStepList / ChatFlowStepEditor 的字段形状**构造的示例**（未取到 POC 服务真实行，
 * 直连 186:9093 探测返回 302 需要登录态），联调后用真实响应校正。
 * 一条 = 对话流程里的一个步骤（步骤编码 / 流程编码 / 提示词模板定义 templateDef / 下一步编码）；
 * retryCount 是**数字**（旧弹窗唯一的 a-input-number），其余字段都是文本。
 * var1 / var2 是旧实体的泛化预留字段（列表不展示、弹窗可改），这里保留一条演示值便于对照。
 */
const blankChatFlowStep = (over: Partial<ChatFlowStep>): ChatFlowStep => ({
  stepCode: '',
  flowCode: '',
  stepName: '',
  dictCodes: '',
  inputParams: '',
  execCond: '',
  stepAction: '',
  systemPrompt: '',
  templateDef: '',
  cleanRule: '',
  checkRule: '',
  outputParams: '',
  retryCount: 0,
  nextStepCode: '',
  var1: '',
  var2: '',
  status: '0',
  ...over,
})

const CHAT_FLOW_STEPS: ChatFlowStep[] = [
  blankChatFlowStep({
    id: 12,
    stepCode: 'intent_recog',
    flowCode: 'chat_main',
    stepName: '意图识别',
    inputParams: 'question,history',
    stepAction: 'llm',
    systemPrompt: '你是银行经营分析助手，判断用户问句的意图。',
    templateDef: '用户问句：{{question}}\n可选意图：指标查询 / 同比环比 / 机构对比',
    checkRule: "json.isValid(result)",
    outputParams: 'intent',
    retryCount: 2,
    nextStepCode: 'sql_generate',
    createTime: '2025-04-15 09:52:07',
    updateTime: '2025-04-15 09:52:07',
  }),
  blankChatFlowStep({
    id: 11,
    stepCode: 'sql_generate',
    flowCode: 'chat_main',
    stepName: 'SQL 生成',
    dictCodes: 'BRANCH_NAME,INDICATOR_DATE',
    inputParams: 'question,intent',
    execCond: "intent == '指标查询'",
    stepAction: 'llm',
    systemPrompt: '根据问句与字典生成可执行 SQL，只输出语句本身。',
    templateDef: '问句：{{question}}\n可用表：KHFA_KHZBJG_JG',
    cleanRule: "string.trim(result)",
    outputParams: 'sql',
    retryCount: 3,
    nextStepCode: 'sql_check',
    status: '1',
    var1: 'KHFA_KHZBJG_JG',
    createTime: '2025-01-08 15:21:40',
    updateTime: '2025-04-11 10:50:30',
  }),
  blankChatFlowStep({
    id: 10,
    stepCode: 'answer_summary',
    flowCode: 'chat_main',
    stepName: '结果总结',
    inputParams: 'sqlResult',
    stepAction: 'llm',
    systemPrompt: '把查询结果组织成一句自然的中文回答。',
    templateDef: '查询结果：{{sqlResult}}',
    outputParams: 'answer',
    createTime: '2024-12-20 18:03:11',
    updateTime: '2025-03-02 09:14:55',
  }),
]

let chatFlowStepNextId = 100

/** 提示词分页：旧页面只有一个「状态」下拉，name 固定空串（实体没有 name 字段，后端忽略）*/
export function mockChatFlowStepPaged(params?: Record<string, unknown>): Paged<ChatFlowStep> {
  const name = String(params?.name ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = CHAT_FLOW_STEPS.filter(
    (row) =>
      (!name || String(row.stepName ?? '').includes(name)) &&
      (!status || String(row.status ?? '') === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 新增（POST /poc/chat-flow-step，不带 id）—— 旧 chatFlowStepAdd */
export function mockChatFlowStepAdd(params?: Record<string, unknown>) {
  const form = params as Partial<ChatFlowStep>
  const nextId = chatFlowStepNextId++
  CHAT_FLOW_STEPS.unshift({
    ...blankChatFlowStep({}),
    ...form,
    id: nextId,
    createTime: stamp(new Date()),
    updateTime: stamp(new Date()),
  })
  return { ok: true, data: nextId, message: '新增成功（演示）' }
}

/** 修改（POST /poc/chat-flow-step/update，带 id）—— 旧 chatFlowStepUpdate；与新增是两个端点，不要合并 */
export function mockChatFlowStepUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<ChatFlowStep>
  const row = CHAT_FLOW_STEPS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的提示词配置' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 启停（POST /poc/chat-flow-step/status，⚠️ 参数走 body，与 question-dic 的 query 不同）—— 旧 chatFlowStepStatus */
export function mockChatFlowStepChangeStatus(params?: Record<string, unknown>) {
  const row = CHAT_FLOW_STEPS.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的提示词配置' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/* ── 分词配置（旧「模板配置 → 分词配置」，端点域 /poc/word-segment-config） ── */

/**
 * 分词配置种子数据。
 * 前三条取自 186 POC 服务的真实行（2026-10-14 抓样，共 434 条，token 基本都是 base，
 * type 是 ORGANIZATION / indicatorname / PERSON 这类字面量）；
 * ⚠️ 最后一条禁用行是**构造的**（真实样本里筛不到禁用项，留着便于对照状态筛选与开关回滚）。
 * 内容能与「数据索引同步」里 type=2 的分词同步配置（YJZB_HY_JX → 'PERSON' as TYPE, 'base' as TOKEN）串起来。
 */
const blankWordSegment = (over: Partial<WordSegmentConfig>): WordSegmentConfig => ({
  type: '',
  content: '',
  token: '',
  status: '0',
  ...over,
})

const WORD_SEGMENTS: WordSegmentConfig[] = [
  blankWordSegment({
    id: 2669,
    type: 'ORGANIZATION',
    content: '新城科技园',
    token: 'base',
    createTime: '2025-03-25 15:27:18',
    updateTime: '2025-03-25 15:27:18',
  }),
  blankWordSegment({
    id: 2668,
    type: 'indicatorname',
    content: '鑫动能',
    token: 'base',
    createTime: '2025-03-25 15:23:36',
    updateTime: '2025-03-25 15:23:36',
  }),
  blankWordSegment({
    id: 2667,
    type: 'PERSON',
    content: '张宪',
    token: 'base',
    createTime: '2025-03-25 15:07:55',
    updateTime: '2025-03-25 15:07:55',
  }),
  blankWordSegment({
    id: 2666,
    type: 'ORGANIZATION',
    content: '白下分行',
    token: 'base',
    status: '1',
    createTime: '2025-03-20 18:28:52',
    updateTime: '2025-03-20 18:28:52',
  }),
]

let wordSegmentNextId = 2670

/**
 * 分页：旧页面四个筛选都在 body —— name（旧搜索框标题「内容」，匹配 content）、type、token、status，
 * 空串都当「全部」不加权筛。
 * ⚠️ type / token 在旧页面是自由文本输入框，后端是精确还是模糊没逐条实测，mock 统一按包含匹配。
 */
export function mockWordSegmentPaged(params?: Record<string, unknown>): Paged<WordSegmentConfig> {
  const name = String(params?.name ?? '').trim()
  const type = String(params?.type ?? '').trim()
  const token = String(params?.token ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = WORD_SEGMENTS.filter(
    (row) =>
      (!name || String(row.content ?? '').includes(name)) &&
      (!type || String(row.type ?? '').includes(type)) &&
      (!token || String(row.token ?? '').includes(token)) &&
      (!status || String(row.status ?? '') === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 修改（POST /poc/word-segment-config/update，带 id）—— 旧 wordSegmentConfigUpdate */
export function mockWordSegmentUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<WordSegmentConfig>
  const row = WORD_SEGMENTS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的分词配置' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 启停（POST /poc/word-segment-config/status，⚠️ 参数走 body，与 question-dic 的 query 不同）—— 旧 wordSegmentConfigStatus */
export function mockWordSegmentChangeStatus(params?: Record<string, unknown>) {
  const row = WORD_SEGMENTS.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的分词配置' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

/**
 * 批量新增（POST /poc/word-segment-config/batch）—— 旧 wordSegmentConfigBatchAdd。
 * ⚠️ body 是 **对象数组**（`[{type,content,token},…]`），不是包装对象；旧列表把文本框按行拆成三段后整批发过去。
 * 状态按旧弹窗的初始口径落 '0'（启用），旧页面不给批量行指定状态。
 */
export function mockWordSegmentBatchAdd(params?: Record<string, unknown> | WordSegmentBatchItem[]) {
  const rows = (Array.isArray(params) ? params : []).filter(
    (item) => item && String(item.content ?? '').trim() && String(item.type ?? '').trim(),
  )
  if (!rows.length) return { ok: false, message: '没有要新增的分词配置' }
  for (const item of rows) {
    WORD_SEGMENTS.unshift(
      blankWordSegment({
        id: wordSegmentNextId++,
        type: String(item.type ?? '').trim(),
        content: String(item.content ?? '').trim(),
        token: String(item.token ?? '').trim(),
        createTime: stamp(new Date()),
        updateTime: stamp(new Date()),
      }),
    )
  }
  return { ok: true, data: rows.length, message: `已新增 ${rows.length} 条（演示）` }
}

/* ── 参数设置（旧 ai-chat-view「系统配置 → 参数设置」，端点域 /poc/system/config，1015 迁入） ── */

/**
 * 参数设置种子数据。⚠️ 是按旧字段形状**构造**的示例（同 chat-flow-step 先例，本轮未取真实行样本），
 * 首次联调核对 configKey / configType 的实际取值口径后再确认。
 * 旧页面实体没有启停概念，status 只是 TemplateRow 公共形状里不展示的残留字段。
 */
const blankSystemConfig = (over: Partial<SystemConfigParam>): SystemConfigParam => ({
  configKey: '',
  configName: '',
  configValue: '',
  configType: 'Y',
  remark: '',
  ...over,
})

const SYSTEM_CONFIGS: SystemConfigParam[] = [
  blankSystemConfig({
    id: 1,
    configKey: 'poc.answer.maxRows',
    configName: '问数单次返回最大行数',
    configValue: '200',
    configType: 'Y',
    remark: '超过该行数的查询结果在回答里截断',
    createTime: '2025-03-20 10:12:00',
    updateTime: '2025-06-11 09:30:00',
  }),
  blankSystemConfig({
    id: 2,
    configKey: 'poc.answer.llmTimeout',
    configName: '大模型调用超时（秒）',
    configValue: '30',
    configType: 'Y',
    createTime: '2025-03-20 10:12:00',
    updateTime: '2025-03-20 10:12:00',
  }),
  blankSystemConfig({
    id: 3,
    configKey: 'poc.answer.welcomeText',
    configName: '问数欢迎语',
    configValue: '你好，可以直接向我提问数据相关问题。',
    configType: 'N',
    remark: '运营可改的非内置参数',
    createTime: '2025-04-02 14:05:00',
    updateTime: '2025-09-18 16:40:00',
  }),
]

/**
 * 分页：configKey / configName 两个模糊筛选（旧 ConfigIndex 搜索框），空串当「全部」。
 * 旧 queryParam 里还有个恒 undefined 的 configType，不上送、这里也不筛。
 */
export function mockSystemConfigPaged(params?: Record<string, unknown>): Paged<SystemConfigParam> {
  const configKey = String(params?.configKey ?? '').trim()
  const configName = String(params?.configName ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = SYSTEM_CONFIGS.filter(
    (row) =>
      (!configKey || String(row.configKey ?? '').includes(configKey)) &&
      (!configName || String(row.configName ?? '').includes(configName)),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 详情（GET /poc/system/config/{configId}，id 走路径段；真实请求 configId 只在 httpEndpoint 里，mock 从 params 取） */
export function mockSystemConfigDetail(params?: Record<string, unknown>): SystemConfigParam | { ok: false; message: string } {
  const row = SYSTEM_CONFIGS.find((r) => Number(r.id) === Number(params?.configId))
  return row ?? { ok: false, message: '未找到对应的参数配置' }
}

/**
 * 修改（POST /poc/system/config，body 带 id）—— 旧 saveConfig。
 * 该端点不带 id 时后端会新增，但旧页面没有新增入口，页面侧只走带 id 的更新。
 */
export function mockSystemConfigSave(params?: Record<string, unknown>) {
  const form = params as Partial<SystemConfigParam>
  const row = SYSTEM_CONFIGS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的参数配置' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/* ── 页面配置（旧 ai-chat-view「系统配置 → 页面配置」，端点域 /poc/system/page-config，1015 迁入） ── */

/**
 * 页面配置种子数据。⚠️ 构造示例（同参数设置，本轮未取真实行样本）。
 * 一条 = 问数前端可配置的一个页面标识（content），旧页面 type 列与搜索框均已注释掉。
 */
const blankPageConfig = (over: Partial<SysPageConfig>): SysPageConfig => ({
  content: '',
  status: '0',
  ...over,
})

const PAGE_CONFIGS: SysPageConfig[] = [
  blankPageConfig({ id: 1, content: '问数首页', createTime: '2025-03-21 10:00:00', updateTime: '2025-03-21 10:00:00' }),
  blankPageConfig({ id: 2, content: '图表详情页', createTime: '2025-03-21 10:00:00', updateTime: '2025-05-06 11:20:00' }),
  blankPageConfig({ id: 3, content: '指标解释弹层', status: '1', createTime: '2025-04-01 09:30:00', updateTime: '2025-04-01 09:30:00' }),
]

let pageConfigNextId = 4

/**
 * 分页：旧 queryParam 固定带 name:''/type:''/status:''（name/type 的输入框被注释掉但参数照发）。
 * mock 按 status 精确筛；name 非空时按旧其它域的口径当 content 模糊筛（后端实际语义联调时核对）。
 */
export function mockPageConfigPaged(params?: Record<string, unknown>): Paged<SysPageConfig> {
  const name = String(params?.name ?? '').trim()
  const status = String(params?.status ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = PAGE_CONFIGS.filter(
    (row) => (!name || String(row.content ?? '').includes(name)) && (!status || String(row.status ?? '') === status),
  )
  return { total: matched.length, list: matched.slice((pageNo - 1) * pageSize, pageNo * pageSize) }
}

/** 批量新增（POST /poc/system/page-config/batch）—— body 是 **{content} 对象数组**；状态照旧弹窗初始口径落 '0' */
export function mockPageConfigBatchAdd(params?: Record<string, unknown> | SysPageConfigBatchItem[]) {
  const rows = (Array.isArray(params) ? params : []).filter((item) => item && String(item.content ?? '').trim())
  if (!rows.length) return { ok: false, message: '没有要新增的页面配置' }
  for (const item of rows) {
    PAGE_CONFIGS.unshift(
      blankPageConfig({
        id: pageConfigNextId++,
        content: String(item.content ?? '').trim(),
        createTime: stamp(new Date()),
        updateTime: stamp(new Date()),
      }),
    )
  }
  return { ok: true, data: rows.length, message: `已新增 ${rows.length} 条（演示）` }
}

/** 修改（POST /poc/system/page-config/update，body 带 id）—— 旧 pageConfigUpdate */
export function mockPageConfigUpdate(params?: Record<string, unknown>) {
  const form = params as Partial<SysPageConfig>
  const row = PAGE_CONFIGS.find((r) => Number(r.id) === Number(form.id))
  if (!row) return { ok: false, message: '未找到要保存的页面配置' }
  for (const [key, value] of Object.entries(form)) {
    if (key === 'id') continue
    ;(row as Record<string, unknown>)[key] = value
  }
  row.updateTime = stamp(new Date())
  return { ok: true, message: '操作成功（演示）' }
}

/** 启停（POST /poc/system/page-config/status，⚠️ 参数走 body，与 question-dic 的 query 不同）—— 旧 pageConfigStatus */
export function mockPageConfigChangeStatus(params?: Record<string, unknown>) {
  const row = PAGE_CONFIGS.find((r) => Number(r.id) === Number(params?.id))
  if (!row) return { ok: false, message: '未找到对应的页面配置' }
  row.status = String(params?.status ?? row.status)
  row.updateTime = stamp(new Date())
  return { ok: true, message: row.status === '0' ? '已启用' : '已停用' }
}

