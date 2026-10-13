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
import type { DicTemplate, PocTableEntry, SqlTemplate, TableTemplate } from '../types/template'

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
 * 数据表选项（旧 tableList → GET /poc/database/entry-list?name=），表模板「使用表范围」下拉的数据源。
 * 返回**裸数组**（真实信封 {code,data:[...]} 没有 count，client.ts 直接透传 data），按表名模糊筛。
 * ⚠️ 同样是为演示构造的示例表，名称与上面 sql 模板种子里的表名对得上，便于串起完整链路。
 */
const POC_TABLE_ENTRIES: PocTableEntry[] = [
  { tableName: 'KHFA_KHZBJG_JG', typeName: '客户指标结果' },
  { tableName: 'KHFA_ZB_DEF', typeName: '指标定义' },
  { tableName: 'KHFA_JG_DEF', typeName: '机构定义' },
  { tableName: 'KHFA_KHJBXX', typeName: '客户基本信息' },
  { tableName: 'DIM_DATE', typeName: '日期维表' },
]

export function mockPocDatabaseEntryList(params?: Record<string, unknown>): PocTableEntry[] {
  const name = String(params?.name ?? '').trim().toUpperCase()
  if (!name) return POC_TABLE_ENTRIES.map((entry) => ({ ...entry }))
  return POC_TABLE_ENTRIES.filter((entry) => entry.tableName.toUpperCase().includes(name)).map((entry) => ({ ...entry }))
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
