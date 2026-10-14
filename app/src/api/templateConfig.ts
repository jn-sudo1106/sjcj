// 模板配置域（/api/poc/*）的接口层。
//
// 旧平台这 8 个「模板配置」子模块的接口是同一套写法（见旧 src/demoApi/EntityApi.js）：
//   POST {base}/page      body {pageNo,pageSize,...筛选}  → {code,count,data:[...]}
//   POST {base}           body 整个表单（带 id = 更新，不带 = 新增）
//   POST {base}/status    **query** {id,status}
//   POST {base}/copy      **query** {id}
// 所以这里做成一个 CRUD 工厂，迁一个模块只需声明 base + 端点清单，不再手写四个函数。
//
// 真实路径是站点根相对 /api/poc/…（**不是** /v1 域，也不拼 BASE_URL /api/v1/）：
// POC 服务是独立进程，dev 代理见 vite.config.ts 的 '/api/poc'，生产要由 Nginx 反代同一前缀。
// 逻辑键统一 `poc/` 前缀（与 endpoints.ts 的契约清单一一对应，live/mock 判定按它，见 client.ts usesMockAdapter）。

import { request } from './client'
import { POC_API_PREFIX } from '@/constants/backend'
import type { Ack, Paged } from './types/common'
import type { DataIndexConfig, DataIndexCodeOption, DataIndexSync, DicTemplate, PocTableEntry, QuestionDic, SqlTemplate, TableTemplate, TemplateCrudApi, TemplateCrudPaths, TemplatePageQuery, TemplateRow } from './types/template'

export interface TemplateCrudConfig {
  /** endpoints.ts 里的模块名，逻辑键 = `poc/${module}${后缀}`，如 sql-temp → poc/sql-temp/page */
  module: string
  /** 是否提供启停 / 复制（旧平台个别模块没有 /status、/copy） */
  operations?: Partial<Record<'status' | 'copy', false>>
  /** 端点后缀覆盖，默认按旧平台约定 page / 根 / status / copy */
  paths?: TemplateCrudPaths
}

const DEFAULT_PATHS = { page: '/page', save: '', status: '/status', copy: '/copy' } as const

/** 建一个模板模块的 CRUD 接口（分页 + 新增/编辑 + 启停 + 复制） */
export function createTemplateCrudApi<T extends TemplateRow>(config: TemplateCrudConfig): TemplateCrudApi<T> {
  const paths = { ...DEFAULT_PATHS, ...config.paths }
  const suffixes: Record<'page' | 'save' | 'status' | 'copy', string> = {
    page: paths.page,
    save: paths.save,
    status: paths.status,
    copy: paths.copy,
  }
  const httpUrl = (op: keyof typeof suffixes) => `${POC_API_PREFIX}/${config.module}${suffixes[op]}`
  const logicKey = (op: keyof typeof suffixes) => `poc/${config.module}${suffixes[op]}`

  const api: TemplateCrudApi<T> = {
    // 分页：筛选条件由调用方按旧字段名传（sql 模板是 name），参数走 body
    page: (query: TemplatePageQuery) =>
      request<Paged<T>>(logicKey('page'), { ...query }, { method: 'POST', httpEndpoint: httpUrl('page') }),
    // 新增与修改是同一个端点：form.id 有值即更新（旧 sqlTempSave 直接整个表单 POST）
    save: (form: Partial<T>) =>
      request<Ack>(logicKey('save'), { ...form }, { method: 'POST', httpEndpoint: httpUrl('save') }),
  }
  if (config.operations?.status !== false) {
    api.changeStatus = (id: number, status: string) =>
      request<Ack>(logicKey('status'), { id, status }, { method: 'POST', paramsIn: 'query', httpEndpoint: httpUrl('status') })
  }
  if (config.operations?.copy !== false) {
    api.copy = (id: number) =>
      request<Ack>(logicKey('copy'), { id }, { method: 'POST', paramsIn: 'query', httpEndpoint: httpUrl('copy') })
  }
  return api
}

/** sql 模板配置（旧「模板配置 → sql模板配置」） */
export const sqlTemplateApi = createTemplateCrudApi<SqlTemplate>({ module: 'sql-temp' })

/**
 * 表模板配置（旧「模板配置 → 表模板配置」）。
 * module 是 question-temp：旧菜单叫「表模板」但端点与字段都是 question-* 口径，1:1 不改名
 * （见 types/template.ts 的 TableTemplate 注释）。
 * operations.copy=false —— 旧 EntityApi.js 里只有 sql 模板有 /poc/sql-temp/copy，表模板没有复制端点
 * （旧列表那个「复制」链接指向一个不存在的方法，点即报错）。
 */
export const tableTemplateApi = createTemplateCrudApi<TableTemplate>({
  module: 'question-temp',
  operations: { copy: false },
})

/**
 * 自动补全配置（旧「模板配置 → 自动补全配置」，src/demo/DicConfig.vue + DicEditor.vue）。
 *
 * 没有走 createTemplateCrudApi 工厂：工厂的 save 是「新增与修改同一个根端点、带 id 即更新」，
 * 而旧 dic 域是两个端点 —— 新增 POST /poc/dic（dicAdd）、修改 POST /poc/dic/update（dicUpdate），
 * paths 覆盖表达不了「按有无 id 换路径」。旧后端也没有 dic/status、dic/copy，
 * 所以不提供 changeStatus / copy（旧列表的启停按钮本身就是注释掉的）。
 */
export const dicTemplateApi: TemplateCrudApi<DicTemplate> = {
  // 分页：筛选参数按旧口径叫 name（模糊匹配的是「内容」content，见 types/template.ts 的 DicTemplate）
  page: (query: TemplatePageQuery) =>
    request<Paged<DicTemplate>>('poc/dic/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/dic/page` }),
  save: (form: Partial<DicTemplate>) =>
    form.id == null
      ? request<Ack>('poc/dic', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/dic` })
      : request<Ack>('poc/dic/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/dic/update` }),
}

/** 问句改写的接口面：通用 CRUD 面 + 删除（旧平台独有，其他模板模块没有删除端点） */
export interface QuestionDicApi extends TemplateCrudApi<QuestionDic> {
  /** 删除整条改写规则；旧页面把**整行**发过去（见 types/template.ts 的 QuestionDic 注释） */
  remove(row: Partial<QuestionDic>): Promise<Ack>
}

/**
 * 问句改写配置（旧「模板配置 → 问句改写配置」，src/demo/QuestionDicList.vue + modal/QuestionDicEditor.vue）。
 *
 * 同样没走 createTemplateCrudApi 工厂：新增/修改是两个端点（/poc/question-dic 与 /poc/question-dic/update），
 * 且比工厂的四件套多一个 deleteQuestionDic（旧平台唯一的删除端点）。
 * 启停保留：/poc/question-dic/status，参数走 query（旧 questionDicDataStatus 用 axios params）。
 */
export const questionDicApi: QuestionDicApi = {
  // 分页：除 name（模糊匹配「内容」）外，旧列表还按 stepCode / type / status 筛，全部进 body
  page: (query: TemplatePageQuery) =>
    request<Paged<QuestionDic>>('poc/question-dic/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/question-dic/page` }),
  save: (form: Partial<QuestionDic>) =>
    form.id == null
      ? request<Ack>('poc/question-dic', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/question-dic` })
      : request<Ack>('poc/question-dic/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/question-dic/update` }),
  changeStatus: (id: number, status: string) =>
    request<Ack>('poc/question-dic/status', { id, status }, { method: 'POST', paramsIn: 'query', httpEndpoint: `${POC_API_PREFIX}/question-dic/status` }),
  remove: (row: Partial<QuestionDic>) =>
    request<Ack>('poc/question-dic/deleteQuestionDic', { ...row }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/question-dic/deleteQuestionDic` }),
}

/** 数据索引同步的接口面：分页 + 新增/编辑 + 同步动作（本域没有启停与复制） */
export interface DataIndexSyncApi extends TemplateCrudApi<DataIndexSync> {
  /** 触发同步；body 是 **id 数组**（旧列表单行「同步」也发 `[row.id]`），不是 {ids:[...]} */
  sync(ids: number[]): Promise<Ack>
}

/**
 * 数据索引同步配置（旧「模板配置 → 数据索引同步」，src/demo/DataIndexSyncList.vue + modal/DataIndexSyncConfigEditor.vue）。
 *
 * 同样没走 createTemplateCrudApi 工厂：新增/修改是两个端点（/poc/data-index-sync 与 /poc/data-index-sync/update），
 * 工厂的「带 id 即更新、同一个根端点」表达不了；旧后端也没有 data-index-sync/status、/copy，
 * 旧列表与旧弹窗本身就没有启停与复制入口（见 types/template.ts 的 DataIndexSync 注释）。
 */
export const dataIndexSyncApi: DataIndexSyncApi = {
  // 分页：name 模糊匹配「同步名称」comment，status 空串=全部，两者都进 body
  page: (query: TemplatePageQuery) =>
    request<Paged<DataIndexSync>>('poc/data-index-sync/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-sync/page` }),
  save: (form: Partial<DataIndexSync>) =>
    form.id == null
      ? request<Ack>('poc/data-index-sync', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-sync` })
      : request<Ack>('poc/data-index-sync/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-sync/update` }),
  sync: (ids: number[]) =>
    request<Ack>('poc/data-index-sync/sync', ids as unknown as Record<string, unknown>, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-sync/sync` }),
}

/** 数据字典的接口面：分页 + 新增/编辑 + 启停 + 编码下拉（本域没有复制） */
export interface DataIndexConfigApi {
  page(query: TemplatePageQuery): Promise<Paged<DataIndexConfig>>
  /** 新增（不带 id）与修改（带 id）分两个端点，按 form.id 路由 */
  save(form: Partial<DataIndexConfig>): Promise<Ack>
  changeStatus(id: number, status: string): Promise<Ack>
  /** 「编码」筛选项的数据源：{code,type} 裸数组，旧页面挂载时一次拉全量 */
  allCode(): Promise<DataIndexCodeOption[]>
}

/**
 * 数据字典配置（旧「模板配置 → 数据字典配置」，src/demo/DataIndexList.vue + modal/DataIndexConfigEditor.vue）。
 *
 * 同样没走 createTemplateCrudApi 工厂：新增/修改是两个端点（/poc/data-index-config 与 /poc/data-index-config/update）；
 * 旧后端也没有 data-index-config/copy。启停保留 /poc/data-index-config/status，
 * ⚠️ 参数走 **body**（旧 dataIndexConfigStatus 用的是 axios 的 data，与问句改写那个走 query 的 status 不同）。
 * 另有一条只读下拉数据源 GET /poc/data-index-config/all-code。
 */
export const dataIndexConfigApi: DataIndexConfigApi = {
  // 分页：四个筛选都在 body —— name（旧搜索框「内容」）/ code / type / status
  page: (query: TemplatePageQuery) =>
    request<Paged<DataIndexConfig>>('poc/data-index-config/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-config/page` }),
  save: (form: Partial<DataIndexConfig>) =>
    form.id == null
      ? request<Ack>('poc/data-index-config', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-config` })
      : request<Ack>('poc/data-index-config/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-config/update` }),
  changeStatus: (id: number, status: string) =>
    request<Ack>('poc/data-index-config/status', { id, status }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/data-index-config/status` }),
  // 裸数组：真实信封 {code,data:[...]} 没有 count，client.ts 的 normalizeHttpPayload 直接透传 data
  allCode: () =>
    request<DataIndexCodeOption[]>('poc/data-index-config/all-code', {}, { method: 'GET', httpEndpoint: `${POC_API_PREFIX}/data-index-config/all-code` }),
}

/**
 * 「使用表范围」下拉的数据表选项（旧 tableList → GET /poc/database/entry-list?name=）。
 * 返回的是裸数组：真实信封 {code,data:[...]} 里没有 count，client.ts 的 normalizeHttpPayload
 * 会把 data 数组直接透传出来（见 client.ts:393 的分页判定）。
 */
export function pocTableEntryList(name = ''): Promise<PocTableEntry[]> {
  return request<PocTableEntry[]>('poc/database/entry-list', { name }, { method: 'GET', httpEndpoint: `${POC_API_PREFIX}/database/entry-list` })
}
