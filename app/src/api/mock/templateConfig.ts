// 模板配置域（/api/poc/*）mock —— 内存表，写操作真落库，刷新分页能看到变更
// （与 mock/queueCheck.ts、mock/monitor.ts 同一套路）。
//
// 口径照旧平台，不要"顺手改"：
//   · 分页入参 pageNo/pageSize，返回 {list,total}（真实信封是 {code,count,data}，由 client.ts 归一）；
//   · status 是字符串 '0'=启用 / '1'=禁用；
//   · 新增与修改是同一个端点：form 带 id 即更新，不带即新增（后端自增 id）；
//   · 复制按 id 出一条副本，名称加「-副本」（旧后端行为未在页面暴露，这里按可读的方式模拟）。
import type { Paged } from '../types/common'
import type { SqlTemplate } from '../types/template'

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

/** sql 模板分页：只按模板名称模糊筛（旧 SqlTempConfig 的唯一筛选项） */
export function mockSqlTemplatePaged(params?: Record<string, unknown>): Paged<SqlTemplate> {
  const name = String(params?.name ?? '').trim()
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 20) || 20)
  const matched = SQL_TEMPLATES.filter((row) => !name || String(row.name ?? '').includes(name))
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
