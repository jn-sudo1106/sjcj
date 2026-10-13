// 模板配置域（旧 ai-chat-view 的 /api/poc/*，2026-10-13 起逐个迁入）。
//
// 字段名、状态口径、分页参数都 1:1 沿用旧平台实体，不在本项目里改名或合并字段
// （旧页面：src/demo/SqlTempConfig.vue + SqlTempEditModal.vue，旧接口：src/demoApi/EntityApi.js）。
// 后续要迁的兄弟模块（表模板 / 自动补全 / 问句改写 / 数据索引同步 / 数据字典 / 提示词 / 分词）
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
