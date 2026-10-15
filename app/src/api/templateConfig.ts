// 模板配置域（/api/poc/*）的接口层。
//
// 旧平台这 8 个「模板配置」子模块的接口是同一套写法（见旧 src/demoApi/EntityApi.js）：
//   POST {base}/page      body {pageNo,pageSize,...筛选}  → {code,count,data:[...]}
//   POST {base}           body 整个表单（带 id = 更新，不带 = 新增）
//   POST {base}/status    **query** {id,status}
//   POST {base}/copy      **query** {id}
// （提示词配置是这套约定的"半例外"：status 走 body 而不是 query，见下面的 chatFlowStepApi）
// 所以这里做成一个 CRUD 工厂，迁一个模块只需声明 base + 端点清单，不再手写四个函数。
//
// 真实路径是站点根相对 /api/poc/…（**不是** /v1 域，也不拼 BASE_URL /api/v1/）：
// POC 服务是独立进程，dev 代理见 vite.config.ts 的 '/api/poc'，生产要由 Nginx 反代同一前缀。
// 逻辑键统一 `poc/` 前缀（与 endpoints.ts 的契约清单一一对应，live/mock 判定按它，见 client.ts usesMockAdapter）。

import { request } from './client'
import { POC_API_PREFIX } from '@/constants/backend'
import type { Ack, Paged } from './types/common'
import type { ChatFlowStep, DataIndexConfig, DataIndexCodeOption, DataIndexSync, DicTemplate, PocTableEntry, QuestionDic, SqlTemplate, SysPageConfig, SysPageConfigBatchItem, SystemConfigParam, TableTemplate, TemplateCrudApi, TemplateCrudPaths, TemplatePageQuery, TemplateRow, WordSegmentBatchItem, WordSegmentConfig } from './types/template'

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
 * 提示词配置（旧「模板配置 → 提示词配置」，src/demo/ChatFlowStepList.vue + modal/ChatFlowStepEditor.vue）。
 *
 * ⚠️ 菜单标题叫「提示词」，端点域是 chat-flow-step（旧路由 /demo/chat-flow-step-list），
 * 字段全是对话流程步骤口径 —— 与表模板（菜单表模板 / 端点 question-temp）同款命名不一致，1:1 不改名。
 *
 * 同样没走 createTemplateCrudApi 工厂：新增/修改是两个端点（/poc/chat-flow-step 与 /poc/chat-flow-step/update）。
 * 启停保留 /poc/chat-flow-step/status，⚠️ 参数走 **body**（旧 chatFlowStepStatus 用的是 axios 的 data，
 * 与问句改写那个走 query 的 status 不同）；旧后端没有 copy，也没有删除端点。
 */
export const chatFlowStepApi: TemplateCrudApi<ChatFlowStep> = {
  // 分页：旧页面只有「状态」一个下拉，queryParam 里固定还带一个 name: ''（实体没有该字段，照旧发过去）
  page: (query: TemplatePageQuery) =>
    request<Paged<ChatFlowStep>>('poc/chat-flow-step/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/chat-flow-step/page` }),
  save: (form: Partial<ChatFlowStep>) =>
    form.id == null
      ? request<Ack>('poc/chat-flow-step', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/chat-flow-step` })
      : request<Ack>('poc/chat-flow-step/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/chat-flow-step/update` }),
  changeStatus: (id: number, status: string) =>
    request<Ack>('poc/chat-flow-step/status', { id, status }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/chat-flow-step/status` }),
}

/** 分词配置的接口面：分页 + 修改 + 启停 + 批量新增（本域没有单条新增与复制） */
export interface WordSegmentApi {
  page(query: TemplatePageQuery): Promise<Paged<WordSegmentConfig>>
  /** 修改（POST /poc/word-segment-config/update，body 带 id）—— 旧 wordSegmentConfigUpdate */
  update(form: Partial<WordSegmentConfig>): Promise<Ack>
  /** 启停（POST /poc/word-segment-config/status，⚠️ 参数走 body）—— 旧 wordSegmentConfigStatus */
  changeStatus(id: number, status: string): Promise<Ack>
  /** 批量新增（POST /poc/word-segment-config/batch）；body 是 **对象数组**，不是包装对象 */
  batchAdd(rows: WordSegmentBatchItem[]): Promise<Ack>
}

/**
 * 分词配置（旧「模板配置 → 分词配置」，src/demo/WordSegmentConfigList.vue + modal/WordSegmentConfigEditor.vue）。
 *
 * 同样没走 createTemplateCrudApi 工厂：本域**没有单条新增端点**（旧弹窗的 add 分支挂在 showAdd 上，
 * 而旧列表没有任何按钮绑它，是死代码），新增能力由批量端点 /poc/word-segment-config/batch 承担；
 * 旧后端也没有 word-segment-config/copy，所以不提供 copy（见 types/template.ts 的 WordSegmentConfig 注释）。
 */
export const wordSegmentApi: WordSegmentApi = {
  // 分页：四个筛选都在 body —— name（旧搜索框标题「内容」，匹配 content）/ type / token / status
  page: (query: TemplatePageQuery) =>
    request<Paged<WordSegmentConfig>>('poc/word-segment-config/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/word-segment-config/page` }),
  update: (form: Partial<WordSegmentConfig>) =>
    request<Ack>('poc/word-segment-config/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/word-segment-config/update` }),
  changeStatus: (id: number, status: string) =>
    request<Ack>('poc/word-segment-config/status', { id, status }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/word-segment-config/status` }),
  batchAdd: (rows: WordSegmentBatchItem[]) =>
    request<Ack>('poc/word-segment-config/batch', rows as unknown as Record<string, unknown>, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/word-segment-config/batch` }),
}

/**
 * 「使用表范围」下拉的数据表选项（旧 tableList → GET /poc/database/entry-list?name=）。
 * 返回的是裸数组：真实信封 {code,data:[...]} 里没有 count，client.ts 的 normalizeHttpPayload
 * 会把 data 数组直接透传出来（见 client.ts:393 的分页判定）。
 */
export function pocTableEntryList(name = ''): Promise<PocTableEntry[]> {
  return request<PocTableEntry[]>('poc/database/entry-list', { name }, { method: 'GET', httpEndpoint: `${POC_API_PREFIX}/database/entry-list` })
}

/** 参数设置的接口面：分页 + 详情 + 修改（旧页面没有新增/删除/导出/刷新缓存入口，对应端点不迁，见 types 注释） */
export interface SystemConfigApi {
  page(query: TemplatePageQuery): Promise<Paged<SystemConfigParam>>
  /** 详情（GET /poc/system/config/{configId}）—— id 走路径段；旧弹窗点「修改」先查详情再回填表单 */
  detail(configId: number): Promise<SystemConfigParam>
  /** 修改（POST /poc/system/config，body 带 id）—— 旧 saveConfig；该端点同时可用于新增，但旧页面没有新增入口 */
  save(form: Partial<SystemConfigParam>): Promise<Ack>
}

/**
 * 参数设置（1015 迁入「问数系统配置」，旧「系统配置 → 参数设置」src/system/config/ConfigIndex.vue + modules/ConfigEditForm.vue）。
 *
 * 没走 createTemplateCrudApi 工厂：本域分页筛选是 configKey/configName（不是 name），
 * 详情端点 id 走**路径段**（GET /poc/system/config/{configId}，工厂表达不了），也没有 status/copy。
 * 详情的 httpEndpoint 带动态 id、不在契约清单里，live/mock 判定按逻辑键 `poc/system/config/detail`
 * （httpEndpoint 以 / 开头时 client.ts 回退用逻辑键，见 client.ts usesMockAdapter）；
 * configId 只喂 mock handler，真实请求靠路径段，httpParams 置空避免多拼 ?configId=。
 */
export const systemConfigApi: SystemConfigApi = {
  // 分页：configKey / configName 两个模糊筛选进 body（旧 queryParam 里的 configType 恒 undefined，不上送）
  page: (query: TemplatePageQuery) =>
    request<Paged<SystemConfigParam>>('poc/system/config/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/system/config/page` }),
  detail: (configId: number) =>
    request<SystemConfigParam>('poc/system/config/detail', { configId }, { method: 'GET', httpParams: {}, httpEndpoint: `${POC_API_PREFIX}/system/config/${configId}` }),
  save: (form: Partial<SystemConfigParam>) =>
    request<Ack>('poc/system/config', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/system/config` }),
}

/** 页面配置的接口面：分页 + 批量新增 + 修改 + 启停（本域没有单条新增与复制） */
export interface PageConfigApi {
  page(query: TemplatePageQuery): Promise<Paged<SysPageConfig>>
  /** 批量新增（POST /poc/system/page-config/batch）；body 是 **对象数组** [{content}] */
  batchAdd(rows: SysPageConfigBatchItem[]): Promise<Ack>
  /** 修改（POST /poc/system/page-config/update，body 带 id）—— 旧 pageConfigUpdate */
  update(form: Partial<SysPageConfig>): Promise<Ack>
  /** 启停（POST /poc/system/page-config/status，⚠️ 参数走 body）—— 旧 pageConfigStatus */
  changeStatus(id: number, status: string): Promise<Ack>
}

/**
 * 页面配置（1015 迁入「问数系统配置」，旧「系统配置 → 页面配置」src/system/config/SysPageConfigList.vue + modules/SysPageConfigEditor.vue）。
 *
 * 同样没走 createTemplateCrudApi 工厂：本域**没有单条新增端点**（旧弹窗 add 分支已注释、旧列表无入口，
 * 与分词配置同口径），新增能力由批量端点 /poc/system/page-config/batch 承担；
 * 修改是独立端点 /update；启停 /status 参数走 **body**（同 word-segment-config / data-index-config）。
 * 分页旧 queryParam 固定带 name:''/type:''/status:'' 三个键（类型/内容搜索框被注释掉但参数照发），1:1 保留。
 */
export const pageConfigApi: PageConfigApi = {
  page: (query: TemplatePageQuery) =>
    request<Paged<SysPageConfig>>('poc/system/page-config/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/system/page-config/page` }),
  batchAdd: (rows: SysPageConfigBatchItem[]) =>
    request<Ack>('poc/system/page-config/batch', rows as unknown as Record<string, unknown>, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/system/page-config/batch` }),
  update: (form: Partial<SysPageConfig>) =>
    request<Ack>('poc/system/page-config/update', { ...form }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/system/page-config/update` }),
  changeStatus: (id: number, status: string) =>
    request<Ack>('poc/system/page-config/status', { id, status }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/system/page-config/status` }),
}
