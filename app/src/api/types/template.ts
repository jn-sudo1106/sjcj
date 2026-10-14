// 模板配置域（旧 ai-chat-view 的 /api/poc/*，2026-10-13 起逐个迁入）。
//
// 字段名、状态口径、分页参数都 1:1 沿用旧平台实体，不在本项目里改名或合并字段
// （旧页面：src/demo/SqlTempConfig.vue + SqlTempEditModal.vue、src/demo/QuestionTempConfig.vue +
//   QuestionTempEditModal.vue，旧接口：src/demoApi/EntityApi.js）。
// 已迁入：sql 模板、表模板、自动补全、问句改写、数据索引同步；后续要迁的兄弟模块（数据字典 / 提示词 / 分词）
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

/**
 * 自动补全配置（旧「模板配置 → 自动补全配置」，src/demo/DicConfig.vue + DicEditor.vue）。
 *
 * ⚠️ 与其他模块不同的两处旧口径（EntityApi.js:20-22）：
 * · 新增与修改**不是**同一个端点：新增 POST /poc/dic、修改 POST /poc/dic/update；
 * · 分页筛选参数叫 name，但模糊匹配的是「内容」content（旧 DicConfig 搜索框标题就是「内容」）。
 * 旧后端没有 dic/status、dic/copy —— 列表不提供启停与复制（旧页启停按钮本身也是注释掉的）。
 */
export interface DicTemplate extends TemplateRow {
  /** 内容（补全词条全文） */
  content?: string | null
  /** 简称 */
  keyWords?: string | null
  /** 类型：旧编辑弹窗固定提交数字 1（页面上类型选择是注释掉的），1:1 保留 */
  type?: number | string
  delFlag?: string
}

/**
 * 问句改写配置（旧「模板配置 → 问句改写配置」，src/demo/QuestionDicList.vue + modal/QuestionDicEditor.vue）。
 *
 * ⚠️ 三处旧口径（EntityApi.js:176-206、408-415）：
 * · 新增 POST /poc/question-dic、修改 POST /poc/question-dic/update，**两个端点**（同 dic 域）；
 * · 启停 POST /poc/question-dic/status 参数走 **query**；
 * · 删除 POST /poc/question-dic/deleteQuestionDic，旧页面把**整行**当 body 发过去（不是只发 id）。
 * type 在这个域是**字符串** '10'/'11'/'20'（与自动补全的 type=1 数字不同，别混用）。
 */
export interface QuestionDic extends TemplateRow {
  /** 阶段：pre-replace 前置替换 / after-replace 后置替换 / before-llm 大模型调用前替换 / after-llm 大模型调用后替换 */
  stepCode?: string | null
  /** 类型：'10' 简单替换 / '11' 正则替换 / '20' 字段替换 */
  type?: string | null
  /** 接收条件（旧列表列标题就是「接收条件」） */
  receiveRule?: string | null
  /** 内容（被改写的原文，分页筛选参数名是 name，匹配的就是这个字段） */
  content?: string | null
  /** 目标内容（改写结果） */
  targetContent?: string | null
  /** 标签：旧编辑弹窗固定提交空串，列表列已注释掉不展示 */
  tag?: string | null
  delFlag?: string
}

/**
 * 数据索引同步配置（旧「模板配置 → 数据索引同步」，src/demo/DataIndexSyncList.vue + modal/DataIndexSyncConfigEditor.vue）。
 *
 * ⚠️ 四处旧口径（EntityApi.js:29-32、152-175）：
 * · 新增 POST /poc/data-index-sync、修改 POST /poc/data-index-sync/update，**两个端点**（同 dic / question-dic 域）；
 * · 分页筛选参数叫 `name`，模糊匹配的却是「同步名称」comment（旧列表那一列的 dataIndex 就是 comment，
 *   186 POC 服务实测：name=机构 命中 20/46 条，命中的全是 comment）；
 * · 除 CRUD 外还有一条同步动作 POST /poc/data-index-sync/sync，body 是 **id 数组**（旧页面单行同步也发 [id]）；
 * · 旧列表与旧弹窗都没有启停/删除/复制入口（弹窗 status 恒为 '0'），所以本模块不提供 changeStatus / copy。
 * type 在这个域是**数字** 0 sql同步 / 1 消息同步 / 2 分词同步（旧新增弹窗默认 2），与问句改写的字符串 type 无关。
 * status：TemplateRow 声明的是字符串，但 186 实测真实响应回的是**数字** 0，比较一律走 String(row.status)。
 */
export interface DataIndexSync extends TemplateRow {
  /** 同步名称（列表「同步名称」列、分页 name 筛选项匹配的都是这个字段） */
  comment?: string | null
  /** 表/主题：sql同步放表名，消息同步放主题名 */
  tableName?: string | null
  /** 同步类型：0 sql同步 / 1 消息同步 / 2 分词同步 */
  type?: number | string
  columnName?: string | null
  /** 同步内容：sql同步/分词同步是一段 select，消息同步是 {"type":...,"params":...} 串 */
  syncSql?: string | null
  beforeSql?: string | null
  afterSql?: string | null
  /** 别名列 / 编码列：旧后端实体里有这两列，旧页面没有入口；编辑保存时原样带回，避免被写成 null */
  aliasColumn?: string | null
  codeColumn?: string | null
  /** 最近同步时间（后端在 sync 成功后回写，前端只读） */
  lastSync?: string | null
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
