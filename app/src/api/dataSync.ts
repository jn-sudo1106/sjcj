import { request } from './client'

// 旧 sync-ui 的 syncApi/* 使用独立的 sync-platform 服务。路径、方法和字段保持原契约；
// 由 Vite/Nginx 将同源 /api/sync-platform 转发到同步服务，不与 /api/v1 混用。
const ROOT = '/api/sync-platform'
type Id = number | string
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

function call<T>(path: string, method: Method, params?: Record<string, unknown>, query?: Record<string, unknown>) {
  return request<T>(`${ROOT}${path}`, params, {
    mode: 'http', method, query,
    paramsIn: method === 'PUT' && query && !params ? 'query' : undefined,
  })
}

// 同步服务的非分页列表也带 count:null，公共请求层会把数组包成 { list, total }，这里拆回数组。
function callList<T>(path: string, params?: Record<string, unknown>) {
  return call<T[] | SyncPage<T>>(path, 'GET', params).then((res) => (Array.isArray(res) ? res : res?.list ?? []))
}

export interface SyncPage<T> { list: T[]; total: number }
export interface SyncCustomer { id: Id; customerName: string }
export interface SyncClient {
  id: Id; customerId: Id; clientName: string; timingSync: string; fileSync: string
  realtimeSync: string; topics?: string; extendConfig?: string; createTime?: string; updateTime?: string
}
export interface SyncDatabase {
  id: Id; customerId?: Id; name: string; sourceCode: string; targetSourceCode?: string
  dbSchema: string; databaseType: number; type: number; appId?: Id; createTime?: string; updateTime?: string
}
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

export const syncApi = {
  customers: () => callList<SyncCustomer>('/customer/all'),
  clients: (params: Record<string, unknown>) => call<SyncPage<SyncClient>>('/customer/client/page', 'POST', params),
  databases: (params: Record<string, unknown>) => call<SyncPage<SyncDatabase>>('/customer/database/page', 'POST', params),
  customerDatabases: (customerId: Id, type: 0 | 1) =>
    callList<SyncDatabase>('/customer/database/list', { customerId, type }),
  setClientSwitch: (id: Id, column: 'timingSync' | 'fileSync' | 'realtimeSync', enabled: boolean) =>
    call<unknown>('/customer/client/switch', 'PUT', { id, column, switchValue: enabled ? 'on' : 'off' }),
  tables: (groupId: Id, name = '') => callList<SyncTable>('/database/entry-list', { groupId, name }),
  tableColumns: (tableId: Id) => callList<SyncTableColumn>('/database/table-info', { tableId }),
  tasks: (params: Record<string, unknown>) => call<SyncPage<SyncTask>>('/task-overview/page', 'POST', params),
  saveTask: (params: Record<string, unknown>) => call<unknown>('/task-overview/info', 'POST', params),
  taskDetail: (id: Id) => call<SyncTaskConfig>('/task-config/detail', 'GET', { id }),
  saveTaskDetail: (params: SyncTaskConfig) => call<unknown>('/task-config/detail', 'POST', params),
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
