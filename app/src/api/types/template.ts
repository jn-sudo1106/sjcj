// 模板配置域（旧 ai-chat-view 的 /api/poc/*，2026-10-13 起逐个迁入）。
//
// 字段名、状态口径、分页参数都 1:1 沿用旧平台实体，不在本项目里改名或合并字段
// （旧页面：src/demo/SqlTempConfig.vue + SqlTempEditModal.vue、src/demo/QuestionTempConfig.vue +
//   QuestionTempEditModal.vue，旧接口：src/demoApi/EntityApi.js）。
// 已迁入：sql 模板、表模板；后续要迁的兄弟模块（自动补全 / 问句改写 / 数据索引同步 / 数据字典 / 提示词 / 分词）
// 的类型继续往这个文件里加，接口统一走 api/templateConfig.ts 的 CRUD 工厂。

import type { Ack, Paged } from './common'

/** /poc 域的分页入参：旧平台一律 pageNo/pageSize（不是 /v1 域的 page/limit） */
export interface TemplatePageQuery {
  pageNo: number
  pageSize: number
  [key: string]: unknown
}

/**
 * /poc 域各模板实体的公共形状。
 * status 是**字符串** '0'（启用）/ '1'（禁用）——旧平台前后端都按字符串比，不要改成布尔。
 */
export interface TemplateRow {
  id?: number
  status?: string
  createTime?: string
  updateTime?: string
  [key: string]: unknown
}

/** sql 模板配置（旧 sql-temp） */
export interface SqlTemplate extends TemplateRow {
  name?: string | null
  content?: string | null
  /** 通过条件 */
  receiveRule?: string | null
  /** 拒绝条件 */
  rejectRule?: string | null
  selectRule?: string | null
  fromTableRule?: string | null
  whereRule?: string | null
  groupByRule?: string | null
  /** havingRule / afterRule 旧页面已注释掉不展示，但字段仍在实体里，保存时原样带回 */
  havingRule?: string | null
  afterRule?: string | null
  delFlag?: string
}

/**
 * 表模板配置（旧「模板配置 → 表模板配置」，src/demo/QuestionTempConfig.vue + QuestionTempEditModal.vue）。
 *
 * ⚠️ 菜单标题叫「表模板」，但旧平台的接口域与字段名全是 question-* 口径（/poc/question-temp、
 * 列表列叫「问句样例」）。这是旧平台自身的命名不一致，1:1 迁移不改名，端点模块名沿用 question-temp。
 */
export interface TableTemplate extends TemplateRow {
  /** 问句样例（旧列表列标题就是「问句样例」，字段名仍是 name） */
  name?: string | null
  /** 匹配规则 */
  rule?: string | null
  /** 使用表范围：表名数组的 JSON **字符串**（库里存字符串，旧编辑弹窗 JSON.parse / JSON.stringify 来回转） */
  tableArr?: string | null
  /** 关联 sql 模板 id 数组的 JSON 字符串，口径同上 */
  sqlTempConfigIds?: string | null
  delFlag?: string
}

/** 「使用表范围」下拉选项（旧 tableList → GET /poc/database/entry-list） */
export interface PocTableEntry {
  tableName: string
  /** 数据表所属类型名；旧下拉把选项渲染成 `表名【类型名】` */
  typeName?: string | null
  [key: string]: unknown
}

/** CRUD 工厂的四个端点后缀（旧平台约定：分页 /page、新增与修改同一个根路径、启停 /status、复制 /copy） */
export interface TemplateCrudPaths {
  page?: string
  save?: string
  status?: string
  copy?: string
}

/** 一个模板模块的接口面；changeStatus / copy 在不提供该操作的模块里可以缺省 */
export interface TemplateCrudApi<T extends TemplateRow> {
  page(query: TemplatePageQuery): Promise<Paged<T>>
  save(form: Partial<T>): Promise<Ack>
  changeStatus?(id: number, status: string): Promise<Ack>
  copy?(id: number): Promise<Ack>
}
