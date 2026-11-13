import { request } from './client'

// 旧 sync-ui 的 syncApi/* 使用独立的 sync-platform 服务。路径、方法和字段保持原契约；
// 由 Vite/Nginx 将同源 /api/sync-platform 转发到同步服务，不与 /api/v1 混用。
const ROOT = '/api/sync-platform'
type Id = number | string
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

function call<T>(path: string, method: Method, params?: Record<string, unknown> | object, query?: Record<string, unknown>) {
  return request<T>(`${ROOT}${path}`, params as Record<string, unknown> | undefined, {
    mode: 'http', method, query,
    // 后端用 @RequestParam 收 ids 的删除/启停接口，参数只能进 query，不能带 JSON body
    paramsIn: (method === 'PUT' || method === 'DELETE') && query && !params ? 'query' : undefined,
  })
}

// 同步服务的非分页列表也带 count:null，公共请求层会把数组包成 { list, total }，这里拆回数组。
function callList<T>(path: string, params?: Record<string, unknown>) {
  return call<T[] | SyncPage<T>>(path, 'GET', params).then((res) => (Array.isArray(res) ? res : res?.list ?? []))
}

export interface SyncPage<T> { list: T[]; total: number }
export interface SyncCustomer {
  id: Id; customerName: string; secretKey?: string | null
  createTime?: string; updateTime?: string
}
/** 客户密钥的新增/重置出参：secretKey 只在这一次响应里明文出现，列表与详情一律打码 */
export interface SyncCustomerSecret { id: Id; customerName: string; secretKey?: string | null }
export interface SyncClient {
  id: Id; customerId: Id; clientName: string; timingSync: string; fileSync: string
  extendConfig?: string; createTime?: string; updateTime?: string
}
export interface SyncDatabase {
  id: Id; customerId?: Id; name: string; sourceCode: string; targetSourceCode?: string
  dbSchema: string; databaseType: number; type: number; appId?: Id; remark?: string
  createTime?: string; updateTime?: string
}
/** 客户新增入参：id 由现场分配（sync_customer.id 非自增），必填；secretKey 留空＝不改动现值 */
export interface SyncCustomerForm { id: Id | ''; customerName: string; secretKey?: string }
/**
 * 客户端新增/编辑入参；密钥由服务端生成，编辑不回填、只在响应里出现一次。
 * 页面上的「数据同步」开关仍是后端的 timingSync（列名沿用 timing_sync，只改了文案）；
 * 实时同步开关与消息主题已去掉，两侧都没有消费方。
 */
export interface SyncClientForm {
  id?: Id | null; customerId: Id; clientName: string
  timingSync: 'on' | 'off'; fileSync: 'on' | 'off'; extendConfig?: string
}
/** 客户数据源入参；appId 的语义是归属客户端id，不是应用id */
export interface SyncDatabaseForm {
  id?: Id | null; customerId: Id; appId: Id; name: string; sourceCode: string
  databaseType: number; dbSchema?: string; type: 0 | 1; remark?: string
}
/** 新增/重置密钥的返回：secretKey 仅这两次有值 */
export interface SyncClientSecret { id: Id; clientName: string; secretKey?: string | null }
export interface SyncTable { entryTypeId: Id; tableName: string; typeName: string }
export interface SyncTableColumn {
  itemId: Id; columnName: string; itemCode: string; itemName: string; dataType: string
  width?: number; code?: string
}
export interface SyncColumnMap {
  key: Id; no: number; sourceColumn: string; targetColumn: string; targetColumnType: string
  typeLength?: number | string; remark?: string; defaultValue?: string; dataRule?: string
  distinct?: boolean; distinctFlag?: number; fileColumn?: string
}
export interface SyncTask {
  id: Id; taskName: string; sourceTable: string; targetTableName: string; syncType: number
  status: number; cron?: string; lastSyncTime?: string; createTime?: string; updateTime?: string
  remark?: string; clientId: Id; customerId?: Id; sendTopic?: string
}
export interface SyncTaskConfig extends Record<string, unknown> {
  id?: Id; taskName: string; syncType: string; cron: string; startSql: string; fromSql: string
  conditionSql: string; insertSql: string; updateSql: string
  /** 前后置 SQL 与源/目标数据源编码：/task-config/detail 一直返回、EditTaskDetailReq 一直收，此前只是页面没渲染 */
  beforeSql: string; afterSql: string; sourceCode: string; targetSourceCode: string
}
export interface SyncLog {
  id: Id; taskId: Id; taskName: string; type?: string; status?: number; totalNumber?: number
  currentNo?: number; insertNum?: number; updateNum?: number; beginTime?: string; endTime?: string
  remark?: string; createTime?: string; updateTime?: string
}
export interface SyncStatistic {
  id: Id; taskId: Id; taskName: string; sourceNum?: number; targetNum?: number
  sourceSql?: string; targetSql?: string; createTime?: string; updateTime?: string
}

// ---- SQL 执行 / 建表任务（1008-10，接口文档《SQL执行与建表任务管理接口文档》第二版）----
/** 数据同步状态枚举：0 待执行 / 1 可执行 / 2 执行中 / 3 执行完成 / 5 执行异常 */
export type SyncSqlStatus = 0 | 1 | 2 | 3 | 5
/** 执行结果：'success' 或错误文本；null = 客户端还没回写 */
export interface SyncSqlTask {
  id: Id; clientId: Id; sourceCode: string; content: string
  result: string | null; status: SyncSqlStatus
  createTime?: string; updateTime?: string; remark?: string
}
export interface SyncTableTask extends SyncSqlTask {
  taskId?: Id | null
}
export interface SyncSqlPageQuery {
  pageNo: number; pageSize: number
  customerId?: Id; clientId?: Id; sourceCode?: string; status?: SyncSqlStatus
}
export interface SyncTablePageQuery extends SyncSqlPageQuery {
  taskId?: Id
}
export interface SyncSqlAddInput {
  clientId: Id; sourceCode: string; content: string
}
export interface SyncTableAddInput extends SyncSqlAddInput {
  taskId?: Id
}

export const syncApi = {
  customers: () => callList<SyncCustomer>('/customer/all'),
  customerPage: (params: Record<string, unknown>) => call<SyncPage<SyncCustomer>>('/customer/page', 'POST', params),
  saveCustomer: (form: SyncCustomerForm) => call<unknown>('/customer/info', 'POST', form),
  removeCustomers: (ids: Id[]) => call<unknown>('/customer/delete', 'DELETE', undefined, { ids: ids.join(',') }),
  // 客户密钥：列表只下发掩码，明文按行取（一次一个，服务端留审计日志）；重置换一份新的，明文只在本次响应出现
  customerSecret: (id: Id) => call<SyncCustomerSecret>('/customer/secret', 'GET', { id }),
  resetCustomerSecret: (id: Id) => call<SyncCustomerSecret>('/customer/secret/reset', 'PUT', undefined, { id }),
  clients: (params: Record<string, unknown>) => call<SyncPage<SyncClient>>('/customer/client/page', 'POST', params),
  saveClient: (form: SyncClientForm) => call<SyncClientSecret>('/customer/client/info', 'POST', form),
  resetClientSecret: (id: Id) => call<SyncClientSecret>('/customer/client/secret/reset', 'PUT', undefined, { id }),
  removeClients: (ids: Id[]) => call<unknown>('/customer/client/delete', 'DELETE', undefined, { ids: ids.join(',') }),
  databases: (params: Record<string, unknown>) => call<SyncPage<SyncDatabase>>('/customer/database/page', 'POST', params),
  saveDatabase: (form: SyncDatabaseForm) => call<unknown>('/customer/database/info', 'POST', form),
  removeDatabases: (ids: Id[]) => call<unknown>('/customer/database/delete', 'DELETE', undefined, { ids: ids.join(',') }),
  customerDatabases: (customerId: Id, type: 0 | 1) =>
    callList<SyncDatabase>('/customer/database/list', { customerId, type }),
  setClientSwitch: (id: Id, column: 'timingSync' | 'fileSync', enabled: boolean) =>
    call<unknown>('/customer/client/switch', 'PUT', { id, column, switchValue: enabled ? 'on' : 'off' }),
  tables: (groupId: Id, name = '') => callList<SyncTable>('/database/entry-list', { groupId, name }),
  tableColumns: (tableId: Id) => callList<SyncTableColumn>('/database/table-info', { tableId }),
  // 源表物理列全集：同步实体要用它，/table-info 只给 cfg_entry_item 配置过的业务字段
  physicalColumns: (table: string) => callList<SyncColumnMap>('/database/physical-columns', { table }),
  tasks: (params: Record<string, unknown>) => call<SyncPage<SyncTask>>('/task-overview/page', 'POST', params),
  saveTask: (params: Record<string, unknown>) => call<unknown>('/task-overview/info', 'POST', params),
  taskDetail: (id: Id) => call<SyncTaskConfig>('/task-config/detail', 'GET', { id }),
  saveTaskDetail: (params: SyncTaskConfig) => call<unknown>('/task-config/detail', 'POST', params),
  sinkDetail: (taskId: Id) => call<SyncSinkDetail>('/task-config/sink-detail', 'GET', { taskId }),
  run: (taskSchemeDTOList: Array<{ taskId: Id; clientId: Id }>, params: Record<string, unknown> = {}) =>
    call<unknown>('/task-config/run', 'POST', { taskSchemeDTOList, ...params }),
  start: (ids: Id[]) => call<unknown>('/task-config/start', 'PUT', undefined, { ids: ids.join(',') }),
  stop: (ids: Id[]) => call<unknown>('/task-config/stop', 'PUT', undefined, { ids: ids.join(',') }),
  copy: (taskIdList: Id[], dataSourceIdList: Id[], copyTableFlag: boolean) =>
    call<unknown>('/task-overview/copy', 'POST', { taskIdList, dataSourceIdList, copyTableFlag }),
  remove: (taskId: Id, clientId: Id, tableName: string, tableOperation?: string) =>
    call<unknown>('/task-overview', 'DELETE', { taskId, clientId, tableName, tableOperation }),
  logs: (params: Record<string, unknown>) => call<SyncPage<SyncLog>>('/task-log/log-page', 'POST', params),
  statistics: (params: Record<string, unknown>) => call<SyncPage<SyncStatistic>>('/task-log/statistic-page', 'POST', params),
  taskChoices: (params: Record<string, unknown>) => callList<SyncTask>('/task-overview/list', params),
  // ---- SQL 执行 / 建表任务（1008-10）----
  // add 类响应标量 data 是新增记录 id：normalizeHttpPayload 会把它放在返回的 data 字段（见 client.ts）
  sqlPage: (params: SyncSqlPageQuery) => call<SyncPage<SyncSqlTask>>('/sql-execute/page', 'POST', params),
  sqlAdd: (params: SyncSqlAddInput) => call<{ ok: true; message: string; data: Id }>('/sql-execute/add', 'POST', params),
  tablePage: (params: SyncTablePageQuery) => call<SyncPage<SyncTableTask>>('/table-definition/page', 'POST', params),
  tableAdd: (params: SyncTableAddInput) => call<{ ok: true; message: string; data: Id }>('/table-definition/add', 'POST', params),
}

export function mapSyncColumns(columns: SyncTableColumn[]): SyncColumnMap[] {
  return columns.map((item, index) => ({
    no: index + 1,
    key: item.itemId,
    sourceColumn: item.columnName,
    targetColumn: item.itemCode,
    targetColumnType: item.dataType === 'string' ? 'varchar' : item.dataType,
    remark: item.itemName,
    typeLength: item.width,
    defaultValue: '',
    dataRule: '',
    distinct: item.itemCode === 'id',
    fileColumn: item.itemCode === 'id' ? 'source_id' : item.code === 'UPDATE_DT' ? 'origin_update_time' : '',
  }))
}

export function submitSyncColumns(columns: SyncColumnMap[]): SyncColumnMap[] {
  return columns.map((item, index) => ({
    ...item,
    no: index + 1,
    distinctFlag: item.distinct ? 1 : 0,
    targetColumnType: item.typeLength && Number(item.typeLength) > 0
      ? `${item.targetColumnType}(${item.typeLength})`
      : item.targetColumnType,
  }))
}

/** 增量水位列：客户端按它取每次同步的起点，与后端 SinkParamConstraint.ORIGIN_UPDATE_TIME 同口径 */
export const WATERMARK_COLUMN = 'origin_update_time'
/** 源表里能给水位列供值的列，与后端 WATERMARK_SOURCE_COLUMNS 同口径 */
const WATERMARK_SOURCES = ['update_dt', WATERMARK_COLUMN]

/**
 * 「同步实体」的列全集：源表物理列一同名映射过去，末尾保证一根 origin_update_time。
 * 水位列取源表的 UPDATE_DT；源表已带 origin_update_time 同名列（历史上平台补过）就沿用它，不重复追加。
 * 两者都没有时返回的列里不含水位列，由调用方拦下——服务端建表前同口径再挡一次。
 *
 * @param physical 源表物理列（/database/physical-columns）
 * @param baseline 配置字段那份列映射：去重列、文件列是实体配置决定的语义，
 *                 物理列同名行要把它带过来，否则同步实体会把文件同步的列绑定弄丢
 */
export function mapEntityCopyColumns(physical: SyncColumnMap[], baseline: SyncColumnMap[] = []): SyncColumnMap[] {
  const configured = new Map(baseline.map((item) => [String(item.sourceColumn).toLowerCase(), item]))
  const rows: SyncColumnMap[] = physical.map((item, index) => {
    const name = item.targetColumn
    const ref = configured.get(name.toLowerCase())
    return {
      key: `phys-${index}`,
      no: index + 1,
      sourceColumn: name,
      targetColumn: name,
      targetColumnType: item.targetColumnType,
      typeLength: '',
      remark: item.remark ?? '',
      defaultValue: '',
      dataRule: '',
      distinct: ref ? ref.distinct === true : name.toLowerCase() === 'id',
      fileColumn: ref?.fileColumn
        || (name.toLowerCase() === WATERMARK_COLUMN && WATERMARK_COLUMN)
        || '',
    }
  })
  if (rows.some((item) => item.targetColumn.toLowerCase() === WATERMARK_COLUMN)) return rows
  const source = rows.find((item) => WATERMARK_SOURCES.includes(item.sourceColumn.toLowerCase()))
  if (!source) return rows
  rows.push({
    key: `phys-${WATERMARK_COLUMN}`, no: rows.length + 1, sourceColumn: source.sourceColumn,
    targetColumn: WATERMARK_COLUMN, targetColumnType: 'varchar', typeLength: 50,
    remark: '远程更新时间', defaultValue: '', dataRule: '', distinct: false, fileColumn: WATERMARK_COLUMN,
  })
  return rows
}

// 对齐旧 Step3.generateSql：后端的 $params 由执行器注入，不在浏览器拼接过滤条件。
export function generateSyncSql(sourceTable: string, columns: SyncColumnMap[], files = false): string {
  const expressions: string[] = []
  for (const item of columns) {
    if (files && !item.fileColumn) continue
    const target = files ? item.fileColumn : item.targetColumn
    if (!target) continue
    if (item.sourceColumn.toLowerCase() === 'entry_id' || item.targetColumn.toLowerCase() === 'id') {
      expressions.push(`${item.sourceColumn} as startId`)
    } else if (target === 'origin_update_time') {
      expressions.push(`DATE_FORMAT(${item.sourceColumn}, '%Y-%m-%d %H:%i:%s') as ${target}`)
    } else if (item.sourceColumn) {
      expressions.push(`${item.sourceColumn} as \`${target}\``)
    } else {
      expressions.push(`'${String(item.defaultValue ?? '').replaceAll("'", "''")}' as \`${target}\``)
    }
  }
  if (files) expressions.push(`'${sourceTable.replaceAll("'", "''")}' as source_table`)
  return `select ${expressions.join(', ')}\n from ${sourceTable}\n where $params\n`
}

// ---- CK / ES 目标端参数（sync-platform 的 SinkParamConstraint / GenerateSqlUtils 的前端镜像）----
// 这里的取值域与默认口径必须和服务端一致：面板预览的是「服务端会渲染成什么」，
// 两端各猜一次就会出现「页面显示一个样、建出来的表另一个样」。

export const DATABASE_TYPE_LABELS: Record<number, string> = {
  1: 'MySQL', 2: 'PostgreSQL', 3: 'Oracle', 4: 'ClickHouse', 5: 'Elasticsearch',
}

/** 有目标端扩展参数的类型：4 ClickHouse、5 Elasticsearch */
export const SINK_TARGET_TYPES = [4, 5]
export const CK_ENGINES = ['ReplacingMergeTree', 'MergeTree', 'SummingMergeTree']
export const CK_DEFAULT_VERSION_COLUMN = 'update_time'
export const ES_DYNAMICS = ['strict', 'true', 'false']
export const ES_PARTITIONS = ['none', 'day', 'month', 'year']
export const ES_FIELD_TYPES = ['keyword', 'text', 'date', 'boolean', 'long', 'integer',
  'float', 'double', 'scaled_float']
export const ES_FILE_MAX_BYTES_DEFAULT = 10 * 1024 * 1024
export const ES_BULK_MAX_BYTES_DEFAULT = 20 * 1024 * 1024
export const ES_FILE_BYTES_LIMIT = 100 * 1024 * 1024

export interface SyncCkSinkOptions {
  engine: string
  versionColumn?: string
  orderByColumns: string[]
}
export interface SyncEsFieldOverride {
  column: string
  type: string
  keyword: boolean
  format?: string
}
export interface SyncEsFileContentField {
  /** 存放平台文件 key 的目标列，值形如 /bucket/object */
  pathColumn: string
  /** 写入 Base64 字符串的目标列，mapping 固定为 keyword + index:false */
  contentColumn: string
}
export interface SyncEsFileContent {
  fields: SyncEsFileContentField[]
  /** 单文件下载上限（字节），超过直接失败 */
  maxFileBytes: number
  /** 单次 _bulk 请求体上限（字节），超过按文档切分 */
  maxBulkBytes: number
}
export interface SyncEsSinkOptions {
  index?: string
  shards: number
  replicas: number
  dynamic: string
  indexPartition: string
  timeField?: string
  idColumns: string[]
  fieldOverrides: SyncEsFieldOverride[]
  fileContent?: SyncEsFileContent
}
export interface SyncSinkOptions {
  ck?: SyncCkSinkOptions | null
  es?: SyncEsSinkOptions | null
}
/** 面板回显：目标端类型 + 可引用的列 + 已落库参数，服务端一次取齐 */
export interface SyncSinkDetail {
  taskId?: Id; targetDatabaseType?: number; targetSchema?: string; targetTable?: string
  columnMapList?: SyncColumnMap[]; sinkOptions?: SyncSinkOptions | null
}

/** 框架建表时追加的固定列：可以在参数里引用，但不在用户提交的列映射里 */
const FRAMEWORK_COLUMNS: Array<[string, string]> = [
  ['create_time', '创建时间'], ['update_time', '更新时间'], ['delete_flag', '删除标记'],
]

export function isSinkTarget(databaseType: unknown): boolean {
  return SINK_TARGET_TYPES.includes(Number(databaseType))
}

/** 面板上能选到的列 = 本次映射的目标列 + 框架固定列 */
export function sinkColumnChoices(columns: SyncColumnMap[]): Array<{ name: string; remark: string }> {
  const seen = new Map<string, string>()
  for (const item of columns) {
    const name = String(item.targetColumn ?? '').trim()
    if (name) seen.set(name.toLowerCase(), `${name}${item.remark ? ` ${item.remark}` : ''}`)
  }
  const choices = [...seen.entries()].map(([name, label]) => ({ name, remark: label }))
  for (const [name, remark] of FRAMEWORK_COLUMNS) if (!seen.has(name)) choices.push({ name, remark })
  return choices
}

/** 勾选的去重列，服务端渲染排序键 / _id 列时的默认来源 */
export function dedupColumns(columns: SyncColumnMap[]): string[] {
  return columns
    .filter((item) => item.distinct === true || item.distinctFlag === 1)
    .map((item) => String(item.targetColumn ?? '').trim())
    .filter(Boolean)
}

function defaultTimeField(columns: SyncColumnMap[]): string {
  const hit = columns.find((item) => String(item.targetColumn).toLowerCase() === 'origin_update_time')
  return hit?.targetColumn || 'origin_update_time'
}

/** ES 索引名清洗：与后端 esIndexName 同一套规则（小写、非法字符转下划线、合并连续下划线、去前导 -_、截 200） */
export function cleanEsIndexName(raw: string): string {
  const cleaned = String(raw ?? '').toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^[-_]+/, '')
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned
}

export function autoEsIndexName(schema: string, table: string): string {
  return cleanEsIndexName(`${String(schema ?? '').toLowerCase()}_${String(table ?? '').toLowerCase()}`)
}

/** 自填索引名是否已合法：判定口径同样是「清洗后不变」 */
export function isEsIndexNameValid(name: string): boolean {
  const trimmed = String(name ?? '').trim()
  return !!trimmed && trimmed === cleanEsIndexName(trimmed)
}

function defaultFileContent(): SyncEsFileContent {
  return { fields: [], maxFileBytes: ES_FILE_MAX_BYTES_DEFAULT, maxBulkBytes: ES_BULK_MAX_BYTES_DEFAULT }
}

export function renderSinkDefaults(databaseType: unknown, columns: SyncColumnMap[]): SyncSinkOptions | null {
  if (!isSinkTarget(databaseType)) return null
  if (Number(databaseType) === 4) {
    return { ck: { engine: 'ReplacingMergeTree', versionColumn: '', orderByColumns: [] }, es: null }
  }
  return {
    ck: null,
    es: {
      index: '', shards: 1, replicas: 1, dynamic: 'strict', indexPartition: 'none',
      timeField: defaultTimeField(columns), idColumns: [], fieldOverrides: [],
      fileContent: defaultFileContent(),
    },
  }
}

/** 详情/复制场景回显：老任务 extend_config 为 NULL 时按当前列映射补出默认值，供面板直接编辑 */
export function parseSinkOptions(raw: unknown, databaseType: unknown, columns: SyncColumnMap[]): SyncSinkOptions | null {
  const defaults = renderSinkDefaults(databaseType, columns)
  if (!defaults) return null
  let saved: SyncSinkOptions | null = null
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try { saved = JSON.parse(raw) as SyncSinkOptions } catch { saved = null }
  } else if (raw && typeof raw === 'object') {
    saved = raw as SyncSinkOptions
  }
  if (defaults.ck) {
    const ck = saved?.ck
    return { ck: { engine: ck?.engine || defaults.ck.engine, versionColumn: ck?.versionColumn || '', orderByColumns: ck?.orderByColumns ?? [] }, es: null }
  }
  const es = saved?.es
  const savedFile = es?.fileContent
  return {
    ck: null,
    es: {
      index: es?.index || '', shards: es?.shards ?? 1, replicas: es?.replicas ?? 1,
      dynamic: es?.dynamic || defaults.es!.dynamic, indexPartition: es?.indexPartition || 'none',
      timeField: es?.timeField || defaults.es!.timeField,
      idColumns: es?.idColumns ?? [], fieldOverrides: es?.fieldOverrides ?? [],
      fileContent: {
        fields: (savedFile?.fields ?? []).map((i) => ({
          pathColumn: String(i.pathColumn ?? ''), contentColumn: String(i.contentColumn ?? ''),
        })),
        maxFileBytes: positiveOr(savedFile?.maxFileBytes, ES_FILE_MAX_BYTES_DEFAULT),
        maxBulkBytes: positiveOr(savedFile?.maxBulkBytes, ES_BULK_MAX_BYTES_DEFAULT),
      },
    },
  }
}

function positiveOr(value: unknown, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : fallback
}

/** 提交前整理：空白输入按「未配置」处理，未填列名的覆盖行直接丢掉 */
export function sanitizeSinkOptions(options: SyncSinkOptions | null, databaseType: unknown): SyncSinkOptions | null {
  if (!options || !isSinkTarget(databaseType)) return null
  if (options.ck) {
    return {
      ck: {
        engine: options.ck.engine,
        versionColumn: String(options.ck.versionColumn ?? '').trim(),
        orderByColumns: (options.ck.orderByColumns ?? []).map((i) => String(i).trim()).filter(Boolean),
      },
      es: null,
    }
  }
  const es = options.es
  if (!es) return null
  const fileFields = (es.fileContent?.fields ?? [])
    .map((i) => ({ pathColumn: String(i.pathColumn ?? '').trim(), contentColumn: String(i.contentColumn ?? '').trim() }))
    .filter((i) => i.pathColumn || i.contentColumn)
  const normalized: SyncEsSinkOptions = {
    ...es,
    index: String(es.index ?? '').trim(),
    timeField: String(es.timeField ?? '').trim(),
    idColumns: (es.idColumns ?? []).map((i) => String(i).trim()).filter(Boolean),
    fieldOverrides: (es.fieldOverrides ?? [])
      .filter((i) => String(i.column ?? '').trim())
      .map((i) => ({ ...i, column: i.column.trim(), type: i.type, format: String(i.format ?? '').trim() })),
  }
  // 一项都没填就按未配置处理，老任务的提交体不会平白多出一个空节点
  normalized.fileContent = fileFields.length ? {
    fields: fileFields,
    maxFileBytes: positiveOr(es.fileContent?.maxFileBytes, ES_FILE_MAX_BYTES_DEFAULT),
    maxBulkBytes: positiveOr(es.fileContent?.maxBulkBytes, ES_BULK_MAX_BYTES_DEFAULT),
  } : undefined
  return { ck: null, es: normalized }
}

/**
 * 提交前的客户端预检：只报「服务端一定会拒」的几类，取值合法性仍以服务端校验器为准。
 * 目的是让用户在第 2 步就知道，而不是填完第 3 步点提交才吃一个 400。
 */
export function sinkOptionsProblem(options: SyncSinkOptions | null, columns: SyncColumnMap[]): string {
  if (!options) return ''
  const names = sinkColumnChoices(columns).map((item) => item.name.toLowerCase())
  const known = (name?: string) => !name || names.includes(name.toLowerCase())
  if (options.ck) {
    if (!CK_ENGINES.includes(options.ck.engine)) return `ClickHouse 引擎只支持 ${CK_ENGINES.join(' / ')}`
    if (!options.ck.orderByColumns?.length && !dedupColumns(columns).length) {
      return 'ClickHouse 排序键默认取勾选的去重列，请至少勾一列去重或直接指定排序键'
    }
    if (!known(options.ck.versionColumn)) return `ClickHouse 版本列 ${options.ck.versionColumn} 不在目标列里`
    const unknownKey = (options.ck.orderByColumns ?? []).find((i) => !known(i))
    if (unknownKey) return `ClickHouse 排序键 ${unknownKey} 不在目标列里`
    return ''
  }
  const es = options.es
  if (!es) return ''
  if (es.index && !isEsIndexNameValid(es.index)) return 'ES 索引名不合法：需小写且不含空格与 * " < > | , / \\ ?'
  if ((es.shards ?? 1) < 1) return 'ES 主分片数至少为 1，且索引建成后不可改'
  if ((es.replicas ?? 0) < 0) return 'ES 副本数不能为负'
  if (es.dynamic && !ES_DYNAMICS.includes(es.dynamic)) return `ES 的 dynamic 只支持 ${ES_DYNAMICS.join(' / ')}`
  if (es.indexPartition && !ES_PARTITIONS.includes(es.indexPartition)) {
    return `ES 分区粒度只支持 ${ES_PARTITIONS.join(' / ')}`
  }
  if (!known(es.timeField)) return `ES 水位列 ${es.timeField} 不在目标列里`
  const unknownId = (es.idColumns ?? []).find((i) => !known(i))
  if (unknownId) return `ES 的 _id 组成列 ${unknownId} 不在目标列里`
  const badOverride = (es.fieldOverrides ?? []).find((i) => !known(i.column) || !ES_FIELD_TYPES.includes(i.type))
  if (badOverride) return `ES 列覆盖 ${badOverride.column || '（未选列）'} 的列名或 mapping 类型不在可选范围内`
  return fileContentProblem(es, columns)
}

/** 文件内容内联的预检：列名、内容列身份冲突、重复配置与上限，判定口径与后端校验器一致 */
function fileContentProblem(es: SyncEsSinkOptions, columns: SyncColumnMap[]): string {
  const fileContent = es.fileContent
  if (!fileContent) return ''
  if (!(Number(fileContent.maxFileBytes) > 0)) return '单文件下载上限必须大于 0'
  if (!(Number(fileContent.maxBulkBytes) > 0)) return '单批请求上限必须大于 0'
  if (fileContent.maxFileBytes > ES_FILE_BYTES_LIMIT) return '单文件下载上限不能超过 100MB'
  if (fileContent.maxBulkBytes > ES_FILE_BYTES_LIMIT) return '单批请求上限不能超过 100MB'
  const fields = fileContent.fields ?? []
  if (!fields.length) return ''
  const names = sinkColumnChoices(columns).map((item) => item.name.toLowerCase())
  const known = (name: string) => names.includes(name.toLowerCase())
  const effectiveTime = String(es.timeField || defaultTimeField(columns)).toLowerCase()
  const effectiveIds = (es.idColumns?.length ? es.idColumns : dedupColumns(columns)).map((i) => i.toLowerCase())
  const overrideColumns = (es.fieldOverrides ?? [])
    .map((i) => String(i.column ?? '').trim().toLowerCase()).filter(Boolean)
  const contentColumns: string[] = []
  for (const field of fields) {
    const pathColumn = String(field.pathColumn ?? '').trim()
    const contentColumn = String(field.contentColumn ?? '').trim()
    if (!pathColumn || !contentColumn) return '文件内容内联的文件路径列与内容列都必须选择'
    if (!known(pathColumn)) return `文件路径列 ${pathColumn} 不在目标列里`
    if (!known(contentColumn)) return `文件内容列 ${contentColumn} 不在目标列里`
    const contentKey = contentColumn.toLowerCase()
    if (contentKey === effectiveTime) return `文件内容列 ${contentColumn} 不能与水位列相同`
    if (effectiveIds.includes(contentKey)) return `文件内容列 ${contentColumn} 不能是文档 _id 组成列`
    if (overrideColumns.includes(contentKey)) {
      return `文件内容列 ${contentColumn} 的 mapping 固定为 keyword(index:false)，不能再配置列覆盖`
    }
    if (contentColumns.includes(contentKey)) return `文件内容列 ${contentColumn} 重复配置`
    contentColumns.push(contentKey)
  }
  const overlap = fields.find((field) => {
    const pathKey = String(field.pathColumn ?? '').trim().toLowerCase()
    return contentColumns.includes(pathKey) && pathKey !== String(field.contentColumn ?? '').trim().toLowerCase()
  })
  if (overlap) return `文件路径列 ${overlap.pathColumn} 同时是另一个文件字段的内容列，取值会被覆盖`
  return ''
}

/** 面板预览：把「服务端会渲染出的关键片段」摊开给用户看，避免建完表才发现不对 */
export function sinkPreviewLines(options: SyncSinkOptions | null, databaseType: unknown,
  schema: string, table: string, columns: SyncColumnMap[]): string[] {
  if (!isSinkTarget(databaseType)) return []
  const keys = options?.ck?.orderByColumns?.length ? options.ck.orderByColumns : dedupColumns(columns)
  if (Number(databaseType) === 4) {
    const engine = options?.ck?.engine || 'ReplacingMergeTree'
    const version = engine === 'ReplacingMergeTree'
      ? (options?.ck?.versionColumn || CK_DEFAULT_VERSION_COLUMN) : ''
    const lines = [
      `ENGINE = ${version ? `${engine}(${version})` : `${engine}()`}`,
      `ORDER BY (${keys.map((i) => `\`${i}\``).join(', ') || '—'})`,
    ]
    if (!keys.length) lines.push('排序键为空且没勾去重列：服务端会拒绝保存')
    if (engine !== 'ReplacingMergeTree') lines.push(`${engine} 不去重：同一排序键重复写入会留下多条`)
    return lines
  }
  const es = options?.es
  const index = es?.index?.trim() || autoEsIndexName(schema, table)
  const partition = es?.indexPartition || 'none'
  const lines = [
    `索引 ${index}${partition !== 'none' ? `（按 ${partition} 分区，数据写入 ${index}-日期后缀）` : '（单索引，不分区）'}`,
    `分片 ${es?.shards ?? 1} / 副本 ${es?.replicas ?? 1}，dynamic=${es?.dynamic ?? 'strict'}`,
    `水位列 ${es?.timeField || defaultTimeField(columns)}，_id 取 ${(es?.idColumns?.length ? es.idColumns : dedupColumns(columns)).join(' + ') || '—'}`,
  ]
  const fileContent = es?.fileContent
  const fileFields = fileContent?.fields ?? []
  if (fileContent && fileFields.length) {
    const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 100) / 100}MB`
    lines.push(`文件内容 ${fileFields.map((i) => `${i.pathColumn} → ${i.contentColumn}`).join('、')}`
      + `（Base64 字符串，keyword 不建索引；单文件上限 ${mb(fileContent.maxFileBytes)}，单批上限 ${mb(fileContent.maxBulkBytes)}）`)
  }
  return lines
}
