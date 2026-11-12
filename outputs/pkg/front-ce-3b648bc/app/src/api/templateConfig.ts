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
import type { ChatFlowStep, DataIndexConfig, DataIndexCodeOption, DataIndexSync, DicTemplate, EntityConfigField, EntityConfigPayload, EntityRewriteConfig, MatchTableConfig, PocTableEntry, QuestionDic, ReplaceTableConfig, SqlTemplate, SysPageConfig, SysPageConfigBatchItem, SystemConfigParam, TableTemplate, TemplateCrudApi, TemplateCrudPaths, TemplatePageQuery, TemplateRow, VectorConfigPayload, VectorDataQuery, VectorMappingItem, VectorTableConfig, VectorTableOption, WordSegmentBatchItem, WordSegmentConfig } from './types/template'

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

/** sql 模板的接口面：通用 CRUD 面 + 删除 */
export interface SqlTemplateApi extends TemplateCrudApi<SqlTemplate> {
  /** 删除（POST /api/poc/sql-temp/delete，id 走 **query**，与选表规则 / 实体改写同形态） */
  remove(id: number): Promise<Ack>
}

/**
 * sql 模板配置（旧「模板配置 → sql模板配置」）。
 * remove 不在工厂里（见 TemplateCrudApi 的注释）：/api/poc/sql-temp/delete 是 1029 在 SqlTempController
 * 补的软删端点（DEL_FLAG=1 + 重刷 Constant.SQL_TEMP_CONFIG 内存缓存），旧平台没有这个端点。
 * 本域其余模板模块后端没有删除端点（replace-table-config / dic / data-index-sync 都没有），不要跟着加。
 */
export const sqlTemplateApi: SqlTemplateApi = {
  ...createTemplateCrudApi<SqlTemplate>({ module: 'sql-temp' }),
  remove: (id: number) =>
    request<Ack>('poc/sql-temp/delete', { id }, { method: 'POST', paramsIn: 'query', httpEndpoint: `${POC_API_PREFIX}/sql-temp/delete` }),
}

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
 * 真实后端（124.223.180.186:9093 实测）这两个 /poc/database GET 端点的信封固定带 `count: null`，
 * 而 client.ts 的分页判定是按 key 存在与否（`'count' in envelope`，client.ts:421），不看值，
 * 所以裸数组会被包成 {list,total}。旧页面读的是 res.data，没有这一层，这里统一还原成数组。
 */
function toRowArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  const list = (payload as { list?: unknown } | null)?.list
  return Array.isArray(list) ? (list as T[]) : []
}

/**
 * 「使用表范围」下拉的数据表选项（旧 tableList → GET /poc/database/entry-list?name=）。
 * ⚠️ 见 toRowArray：真实响应带 count:null，client.ts 会误判成分页结果，这里还原回数组再返回。
 */
export async function pocTableEntryList(name = ''): Promise<PocTableEntry[]> {
  const payload = await request<PocTableEntry[] | Paged<PocTableEntry>>('poc/database/entry-list', { name }, { method: 'GET', httpEndpoint: `${POC_API_PREFIX}/database/entry-list` })
  return toRowArray<PocTableEntry>(payload)
}

/**
 * 表字段管理的字段列表（旧 tableDesc → GET /poc/database/table-info?tableId=，1015 迁入「基础配置 → 表字段管理」）。
 * tableId 是 entry-list 行的 entryTypeId；同样要过 toRowArray 还原 count:null 信封带来的 {list,total} 包装。
 */
export async function pocTableFieldList(tableId: number | string): Promise<EntityConfigField[]> {
  const payload = await request<EntityConfigField[] | Paged<EntityConfigField>>('poc/database/table-info', { tableId: String(tableId) }, { method: 'GET', httpEndpoint: `${POC_API_PREFIX}/database/table-info` })
  return toRowArray<EntityConfigField>(payload)
}

/**
 * 表字段配置保存（旧 saveConfig → POST /poc/database/config）—— body {entityType, entityItems}，**整表覆盖**。
 * 旧页面按 res.code===0 判成功；client.ts 的 normalizeHttpPayload 对 code!==0 直接抛错并带出后端 msg，
 * 所以这里返回即成功，失败在调用方 catch（见 views/TemplateConfig/BaseConfig/EntityConfig）。
 */
export function pocEntityConfigSave(payload: EntityConfigPayload): Promise<Ack> {
  return request<Ack>('poc/database/config', { ...payload }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/database/config` })
}

/**
 * 向量表选项（旧「基础配置 → 向量表数据浏览」的 vectorConfigList → GET /poc/vector/config/all?name=）。
 * 与 entry-list 同一个信封（带 count:null），同样要过 toRowArray 还原成裸数组。
 * ⚠️ ?name= 必须拼在路径上：后端把它声明成必填，参数缺失直接回 code:400
 * （"Required request parameter 'name' for method parameter type String is not present"，2026-10-15 在 186 实测），
 * 而 client.ts 的 appendQuery 与 httpParams 都会跳过空串 —— 旧 axios 空关键词时也是发 ?name= 的，这里按旧口径显式拼。
 */
export async function pocVectorConfigList(name = ''): Promise<VectorTableOption[]> {
  const payload = await request<VectorTableOption[] | Paged<VectorTableOption>>(
    'poc/vector/config/all',
    { name },
    { method: 'GET', httpParams: {}, httpEndpoint: `${POC_API_PREFIX}/vector/config/all?name=${encodeURIComponent(name)}` },
  )
  return toRowArray<VectorTableOption>(payload)
}

/**
 * 向量表数据查询（旧 vectorDataQuery → POST /poc/vector/data，body 是旧 queryParam：input/type/pageSize/pageNo）。
 * 返回的是后端 data 里的原始载荷，旧页面整份 JSON.stringify 展示，所以这里不做字段加工。
 * ⚠️ 只有 POC 信封带 count:null 时被 client.ts 误判成分页结果（见上方 toRowArray 注释）、包成了 {list,total}，
 * 才还原回数组 —— 否则展示出来的 JSON 比旧平台多一层包装。
 */
export async function pocVectorDataQuery(query: VectorDataQuery): Promise<unknown> {
  const payload = await request<unknown>('poc/vector/data', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/vector/data` })
  if (Array.isArray(payload)) return payload
  const { list, total } = (payload ?? {}) as { list?: unknown; total?: unknown }
  return Array.isArray(list) && typeof total === 'number' ? list : payload
}

/** 向量表管理的接口面：分页 + 保存（{config, items}）+ 列映射明细 + 同步 + 按名称删除 */
export interface VectorConfigApi {
  page(query: TemplatePageQuery): Promise<Paged<VectorTableConfig>>
  /** 新增与修改同一个端点（config.id 有值即更新），但 body 是 {config, items} 包装，不是平铺表单 */
  save(payload: VectorConfigPayload): Promise<Ack>
  /** 列映射明细（旧 vectorMappingInfo → GET /poc/vector/mapping/info?configId=） */
  mappingInfo(configId: number): Promise<VectorMappingItem[]>
  /** 触发同步；body 是 **id 数组**（旧列表单行「同步」也发 `[row.id]`），同 data-index-sync/sync 口径 */
  sync(ids: number[]): Promise<Ack>
  /** 删除（旧 deleteVector → POST /poc/vector/delete）；⚠️ body 是 `{type: 向量表名称}`，按 name 删不按 id */
  remove(type: string): Promise<Ack>
}

/**
 * 向量表管理（1015 迁入「基础配置」，旧「基础配置 → 向量表管理」src/demo/VectorTableList.vue +
 * modal/VectorMapping.vue，旧接口 src/demoApi/VectorApi.js）。
 *
 * 没走 createTemplateCrudApi 工厂：本域 save 的 body 是 `{config, items}` 包装（配置行 + 列映射整份），
 * 与工厂「平铺表单、带 id 即更新」的形状不符；也没有 status/copy，多出 mapping/info、sync、delete 三个动作端点。
 * 与已迁的 poc/vector/config/all、poc/vector/data（向量表数据浏览）同一后端域。
 * ⚠️ 5 个端点都还没在 186 实测（POC 写链路要登录会话），未标 live，联调核对后逐条补（同 question-temp 先例）。
 */
export const vectorConfigApi: VectorConfigApi = {
  // 分页：两个模糊筛选都在 body —— name（向量表名称）/ sourceTable（源表名称），旧 queryParam 原样
  page: (query: TemplatePageQuery) =>
    request<Paged<VectorTableConfig>>('poc/vector/config/page', { ...query }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/vector/config/page` }),
  save: (payload: VectorConfigPayload) =>
    request<Ack>('poc/vector/config', { ...payload }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/vector/config` }),
  // 与 database 域同信封风险（可能带 count:null 被包成 {list,total}），统一过 toRowArray 还原裸数组
  mappingInfo: (configId: number) =>
    request<VectorMappingItem[] | Paged<VectorMappingItem>>(
      'poc/vector/mapping/info',
      { configId: String(configId) },
      { method: 'GET', httpEndpoint: `${POC_API_PREFIX}/vector/mapping/info` },
    ).then((payload) => toRowArray<VectorMappingItem>(payload)),
  sync: (ids: number[]) =>
    request<Ack>('poc/vector/sync', ids as unknown as Record<string, unknown>, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/vector/sync` }),
  remove: (type: string) =>
    request<Ack>('poc/vector/delete', { type }, { method: 'POST', httpEndpoint: `${POC_API_PREFIX}/vector/delete` }),
}

/** 选表规则的接口面：通用 CRUD 面 + 删除（本域没有复制） */
export interface MatchTableConfigApi extends TemplateCrudApi<MatchTableConfig> {
  /** 删除（POST /poc/match-table-config/delete，⚠️ id 走 **query**，旧 deleteConfig 用的是 axios params） */
  remove(id: number): Promise<Ack>
}

/**
 * 选表规则配置（1015 迁入「基础配置」，旧「基础配置 → 选表规则配置」src/demo/MatchTableConfigList.vue +
 * modal/MatchTableConfigEditor.vue，旧接口 src/demoApi/MatchTableConfigApi.js:3-8）。
 *
 * 走 createTemplateCrudApi 工厂：本域正是工厂默认的四种形态 ——
 * 新增与修改是**同一个根端点**（POST /poc/match-table-config，body 带 id 即更新，旧 editor 函数一个端点两用）、
 * 启停 POST /poc/match-table-config/status 且参数走 **query**（旧 changeConfigStatus 用的是 axios params，
 * 与 chat-flow-step / data-index-config 那几个 body 传参的域不同）。
 * operations.copy=false —— 旧域没有 /copy。工厂唯一表达不了的是 /delete（旧平台少见的删除端点，
 * question-dic 也有删除但那里是发整行、这里是按 query 发 id），所以按 questionDicApi 的先例扩一个 remove。
 * 分页的两个筛选都在 body：name（旧搜索框标签「表名称」，见 types/template.ts 的 MatchTableConfig 注释）/ status。
 */
export const matchTableConfigApi: MatchTableConfigApi = {
  ...createTemplateCrudApi<MatchTableConfig>({ module: 'match-table-config', operations: { copy: false } }),
  remove: (id: number) =>
    request<Ack>('poc/match-table-config/delete', { id }, { method: 'POST', paramsIn: 'query', httpEndpoint: `${POC_API_PREFIX}/match-table-config/delete` }),
}

/**
 * 表改写管理（1015 迁入「基础配置」，旧「基础配置 → 表改写管理」src/demo/ReplaceTableConfigList.vue +
 * modal/ReplaceTableConfigEditor.vue，旧接口 src/demoApi/ReplaceTableConfigApi.js:4-6）。
 *
 * 走 createTemplateCrudApi 工厂，且是本域最干净的一个模块 —— 旧接口文件只有三个函数
 * （page / editor / changeConfigStatus），正是工厂去掉 copy 后的形状：
 * 新增与修改同一个根端点（POST /poc/replace-table-config，body 带 id 即更新）、
 * 启停 POST /poc/replace-table-config/status 且参数走 **query**（旧 changeConfigStatus 用的是 axios params，
 * 同选表规则配置，与 chat-flow-step / data-index-config 那几个 body 传参的域不同）。
 * operations.copy=false —— 旧域没有 /copy；也**没有删除端点**（旧列表操作列只有「编辑」和「启用/禁用」），
 * 所以不像 matchTableConfigApi 那样扩 remove。
 * 分页的两个筛选都在 body：name（旧搜索框标签「表名称」，实测按 tableName 模糊筛、大小写敏感）/ status
 * （⚠️ 与选表规则配置不同，本域后端**认**这个条件，2026-10-15 在 186 实测）。
 */
export const replaceTableConfigApi: TemplateCrudApi<ReplaceTableConfig> = createTemplateCrudApi<ReplaceTableConfig>({
  module: 'replace-table-config',
  operations: { copy: false },
})

/** 实体改写配置的接口面：通用 CRUD 面 + 删除（本域没有复制） */
export interface EntityRewriteConfigApi extends TemplateCrudApi<EntityRewriteConfig> {
  /** 删除（POST /poc/entity-rewrite-config/delete，⚠️ id 走 **query**，旧 deleteConfig 用的是 axios params） */
  remove(id: number): Promise<Ack>
}

/**
 * 实体改写管理（1015 迁入「基础配置」，旧「基础配置 → 实体改写管理」src/demo/EntityRewriteConfigList.vue +
 * modal/EntityRewriteConfigEditor.vue，旧接口 src/demoApi/EntityRewriteConfigApi.js:4-7）。
 *
 * 走 createTemplateCrudApi 工厂，形状与选表规则配置一字不差：
 * 新增与修改是**同一个根端点**（POST /poc/entity-rewrite-config，body 带 id 即更新，旧 editor 函数一个端点两用）、
 * 启停 POST /poc/entity-rewrite-config/status 且参数走 **query**（旧 changeConfigStatus 用的是 axios params，
 * 与 chat-flow-step / data-index-config 那几个 body 传参的域不同）。
 * operations.copy=false —— 旧域没有 /copy；删除按 question-dic / 选表规则配置的先例扩一个 remove（旧 deleteConfig 只发 id）。
 * 分页的两个筛选都在 body：entityName（旧搜索框上送的就是这个参数名，**不像另两个基础配置域改名成 name**）/ status。
 * ⚠️ 四条端点都还没在 186 实测（这一页在 186 后端上回 500，见 endpoints.ts 的 poc/entity-rewrite-config），
 * 未标 live，后端打通后逐条复核（同 vector-config 先例）。
 */
export const entityRewriteConfigApi: EntityRewriteConfigApi = {
  ...createTemplateCrudApi<EntityRewriteConfig>({ module: 'entity-rewrite-config', operations: { copy: false } }),
  remove: (id: number) =>
    request<Ack>('poc/entity-rewrite-config/delete', { id }, { method: 'POST', paramsIn: 'query', httpEndpoint: `${POC_API_PREFIX}/entity-rewrite-config/delete` }),
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
