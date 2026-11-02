import type {
  Config,
  ConfigActionLog,
  ConfigParamBinding,
  DataRow,
  DataTableMeta,
  EntryDetail,
  EntrySubRow,
  EntryDetailItem,
  EntryField,
  EntryType,
  EntryTypeGroup,
  NodeType,
  Paged,
  Param,
  ParamInput,
  ParamKind,
  ParamValue,
  RuleOrchestration,
  RuleOrchestrationGenerateResult,
  RuleOrchestrationItem,
  RuleOrchestrationSaveMetaResult,
  RuleOrchestrationTestRequest,
  RuleOrchestrationTestResult,
  Site,
  SiteSummary,
  Source,
  SourceCategory,
  SourceOption,
  Step,
  SummaryRow,
  TaskInst,
} from './types'
import type { CreateJobsInput, FlowDefinition, FlowRecord, FlowSaveInput, LegacyLoginSubmission, LegacySnatchSaveRequest } from './types/source'
import type { FlowDef, NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { colorFromLegacy, parseIssueTags } from '@/utils/sourceMark'
import { validFlowIdOf } from '@/utils/flow/stepPersist'

type LegacyRecord = Record<string, unknown>

const PARAM_KIND_FROM_LEGACY: Record<string, ParamKind> = {
  list: 'list',
  date: 'date',
  seq: 'sequence',
  dateSeq: 'date_sequence',
  db: 'database',
}

const PARAM_KIND_TO_LEGACY: Record<ParamKind, string> = {
  list: 'list',
  date: 'date',
  sequence: 'seq',
  date_sequence: 'dateSeq',
  database: 'db',
}

export function paramKindToLegacy(kind: ParamKind): string {
  return PARAM_KIND_TO_LEGACY[kind]
}

function asRecord(value: unknown): LegacyRecord {
  return value && typeof value === 'object' ? (value as LegacyRecord) : {}
}

function hasLegacyConfigFields(record: LegacyRecord): boolean {
  return record.configId != null || record.configName != null || record.configUrl != null || record.isMulti != null
}

/**
 * config/configDetail 的真实外壳不统一：有的带 `code`（request 会拆 `data`），
 * 有的只有 `{ success, data }`。后者整包落到适配层后，配置字段在 `data` 里，
 * 顶层读 `configUrl` 会当成没有——旧 ConfigEdit 能看见 URL、画布却是空的。
 */
function unwrapLegacyConfigRecord(input: unknown): LegacyRecord {
  let record = asRecord(input)
  for (let i = 0; i < 2; i++) {
    if (hasLegacyConfigFields(record)) break
    const inner = record.data
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) break
    record = asRecord(inner)
  }
  return record
}

/** 给 configDetailRaw 用：去掉 success/data 外壳，落到旧配置字段。 */
export function legacyConfigRecord(input: unknown): LegacyRecord {
  return unwrapLegacyConfigRecord(input)
}

/**
 * 旧配置 URL。旧 ConfigEdit 读的是 `config/configDetail` 原始记录的 `configUrl`；
 * 适配后的 Config 模型用 `url`。两边都认，空字符串也算有值（显式清空过）。
 */
export function configUrlFromLegacy(input: unknown): string | undefined {
  const record = unwrapLegacyConfigRecord(input)
  const raw = record.configUrl ?? record.url
  return raw == null ? undefined : String(raw)
}

function flowCollectorConfigs(def: FlowDef): NodeConfig[] {
  const ids = [...def.main, ...Object.keys(def.configs)]
  const seen = new Set<string>()
  return ids
    .filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map((id) => def.configs[id])
    .filter((cfg): cfg is NodeConfig => !!cfg?.collectCfg)
}

function isLoginConfig(cfg: NodeConfig): boolean {
  const collect = cfg.collectCfg
  return collect?.collectorKind === 'login' || /\[LOGIN\]|登录/i.test(`${collect?.snatchType ?? ''}${cfg.title}`)
}

function sourceTypeFromSnatchType(snatchType: string | undefined): string | undefined {
  const match = snatchType?.match(/^\[(\d+)\]/)
  return match?.[1]
}

function legacyParamRefs(def: FlowDef, collectCfg: NodeConfig['collectCfg']): { paramId: string }[] {
  const ids = collectCfg?.inputParams?.length
    ? collectCfg.inputParams
    : (def.source?.paramRefs ?? []).map((ref) => ref.paramId)
  return [...new Set(ids.filter(Boolean))].map((paramId) => ({ paramId }))
}

/**
 * 把新画布模型转换为旧平台 SourceBuildForm.commitAll 的请求体。
 * 旧接口是一次性新建源，字段必须保持 sourceUrl/sourceName/reqLogin 等旧名称，不能直接发送 FlowDef。
 */
export function legacySnatchSavePayloadFromFlow(
  def: FlowDef,
  loginSubmission?: LegacyLoginSubmission,
): LegacySnatchSaveRequest {
  const source = def.source
  const collectors = flowCollectorConfigs(def)
  const loginCfg = collectors.find(isLoginConfig)?.collectCfg
  const sourceCfg = collectors.find((cfg) => !isLoginConfig(cfg))?.collectCfg ?? collectors[0]?.collectCfg
  const loginConfigs = loginCfg?.loginConfigs ?? []
  const selectedLogin = loginConfigs.find((item) => item.id === loginSubmission?.configId)
    ?? loginConfigs.find((item) => item.id === loginCfg?.defaultLoginConfigId)
    ?? loginConfigs[0]
  const useProxy = sourceCfg?.useProxy ?? source?.useProxy ?? false
  const keep = sourceCfg?.resume ?? source?.resume ?? false
  const requiresLogin = !!loginCfg || !!(sourceCfg?.needLogin ?? source?.needLogin)
  const authConfig = loginSubmission?.authConfig ?? selectedLogin?.authConfig ?? source?.authConfig
  const newLoginConfig = loginSubmission?.newLoginConfig ?? (authConfig ? '0' : '1')

  return {
    sourceType: source?.sourceType ?? sourceTypeFromSnatchType(sourceCfg?.snatchType) ?? '90',
    sourceUrl: source?.url ?? sourceCfg?.url ?? loginCfg?.url ?? '',
    sourceName: source?.name ?? def.name,
    categoryId: source?.dirId ?? '',
    proxy: source?.proxy ?? (useProxy ? ['1'] : undefined),
    keep: keep ? '1' : '',
    cron: sourceCfg?.cron ?? source?.cron ?? '',
    tags: source?.tags?.join(',') ?? '',
    newConfig: source?.configMode === 'existing' ? '0' : '1',
    configId: source?.configId || undefined,
    // 有迁移带过来的原值就原样回写，保住旧平台的第三态（2=更新父表）；只有新建节点没有原值时
    // 才从 isDetail 布尔推导。此前无条件用布尔推导，只能出 0/1，会把 2 静默压成 1（列表类），
    // 去重语义从"按父ID更新父表"变成"按去重字段去重"。三态定义见 Step.multiMode 注释。
    isMulti: sourceCfg?.multiMode !== undefined ? String(sourceCfg.multiMode) : (sourceCfg?.isDetail ? '0' : '1'),
    loginTemplete: loginCfg ? '1' : '',
    entryTypeId: sourceCfg?.outputTable || source?.mainTable || undefined,
    params: legacyParamRefs(def, sourceCfg),
    reqLogin: requiresLogin ? '1' : '0',
    newLoginConfig: requiresLogin ? newLoginConfig : undefined,
    authConfig: requiresLogin ? authConfig : undefined,
    loginUrl: requiresLogin ? (selectedLogin?.loginUrl || loginCfg?.loginUrl || source?.loginUrl || '') : undefined,
    loginName: requiresLogin ? (selectedLogin?.loginName || source?.account || '') : undefined,
    loginPwd: requiresLogin ? (loginSubmission?.loginPwd ?? selectedLogin?.loginPwd) : undefined,
  }
}

/** 旧平台 Step3 的必填约束。 */
export function assertLegacySnatchSaveLogin(payload: LegacySnatchSaveRequest): void {
  if (payload.reqLogin !== '1') return
  if (payload.newLoginConfig === '0') {
    if (!payload.authConfig) throw new Error('使用已有登录时必须提供旧平台 authConfig')
    return
  }
  if (!payload.loginUrl || !payload.loginName || !payload.loginPwd) {
    throw new Error('新建登录时必须提供旧平台 loginUrl、loginName、loginPwd')
  }
}

// 旧平台用 eval('(' + valueDef + ')') 解析该字段，容许非严格 JSON（裸键名如 {start:1,end:10}）。
// 新平台禁止 eval，改用「先严格 JSON.parse，失败再补引号后重试」的受限解析，不执行任意代码。
function tolerantParseObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    /* 继续尝试容错解析 */
  }
  try {
    const quoted = text
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    return JSON.parse(quoted)
  } catch {
    return undefined
  }
}

function parseSequence(valueDef: unknown): Param['seq'] | undefined {
  if (!valueDef) return undefined
  const value = typeof valueDef === 'string' ? tolerantParseObject(valueDef) : valueDef
  const record = asRecord(value)
  const start = Number(record.start)
  const end = Number(record.end)
  const step = Number(record.step)
  if ([start, end, step].every(Number.isFinite)) return { start, end, step }
  return undefined
}

function valueItems(record: LegacyRecord): ParamValue[] {
  if (!Array.isArray(record.values)) return []
  return record.values.map((item, index) => {
    const value = asRecord(item)
    return {
      valueId: String(value.valueId ?? index),
      seq: Number(value.seq ?? index + 1),
      value: String(value.paramValue ?? value.value ?? ''),
    }
  })
}

export function paramFromLegacy(input: unknown): Param {
  const record = asRecord(input)
  if ('name' in record && 'kind' in record) return record as unknown as Param

  const kind = PARAM_KIND_FROM_LEGACY[String(record.paramType ?? 'list')] ?? 'list'
  const items = valueItems(record)
  const rawValues = String(record.paramValues ?? '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const values = items.length ? items.map((item) => item.value) : rawValues
  const valueDef = String(record.valueDef ?? '')

  return {
    paramId: String(record.paramId ?? ''),
    name: String(record.paramName ?? ''),
    group: record.batchId == null ? undefined : String(record.batchId),
    kind,
    values: kind === 'list' ? values : undefined,
    defaultValue: record.defaultValue == null ? undefined : String(record.defaultValue),
    dateExpr: kind === 'date' || kind === 'date_sequence' ? String(record.defaultValue ?? '') : undefined,
    seq: kind === 'sequence' || kind === 'date_sequence' ? parseSequence(valueDef) : undefined,
    databaseQuery: kind === 'database' ? valueDef : undefined,
    valueDef: record.valueDef == null ? undefined : String(record.valueDef),
    tableName: record.tableName == null ? undefined : String(record.tableName),
    colName: record.colName == null ? undefined : String(record.colName),
    valueItems: items,
    createdAt: record.createDt == null ? undefined : String(record.createDt),
    updatedAt: record.updateDt == null ? undefined : String(record.updateDt),
  }
}

export function paramPageFromLegacy(input: Paged<unknown>): Paged<Param> {
  return { total: input.total, list: input.list.map(paramFromLegacy) }
}

export function paramToLegacy(input: ParamInput | Param): LegacyRecord {
  const kind = input.kind
  const sequence = input.seq
  return {
    paramId: input.paramId,
    paramName: input.name,
    batchId: input.group,
    paramType: PARAM_KIND_TO_LEGACY[kind],
    paramValues: kind === 'list' ? (input.values ?? []).join('\n') : undefined,
    defaultValue: kind === 'date' || kind === 'date_sequence' ? input.dateExpr : input.defaultValue,
    valueDef:
      kind === 'sequence' || kind === 'date_sequence'
        ? JSON.stringify({ start: sequence?.start, end: sequence?.end, step: sequence?.step })
        : kind === 'database'
          ? input.databaseQuery
          : undefined,
    tableName: input.tableName,
    colName: input.colName,
    valueType: 'string',
    isDelete: 0,
  }
}

export function configFromLegacy(input: unknown): Config {
  const record = unwrapLegacyConfigRecord(input)
  if ('name' in record && 'enabled' in record) return record as unknown as Config
  const params = Array.isArray(record.params) ? record.params.map(configParamFromLegacy) : []
  const enable = Number(record.enable ?? 0)
  const templateCode = record.templetCode == null ? undefined : String(record.templetCode)
  const multiMode = record.isMulti == null ? undefined : Number(record.isMulti)
  return {
    configId: String(record.configId ?? ''),
    name: String(record.configName ?? ''),
    topic: record.topic == null ? undefined : String(record.topic),
    policy: record.runPolicy == null ? undefined : String(record.runPolicy),
    enabled: enable === 0,
    paramRefs: params.map((param) => param.paramId),
    // isDetail = 非列表类。旧三态里 0（详情类）和 2（更新父表）都是"挂在父记录下的子步骤配置"，
    // 只有 1 是列表类。此前写死 multiMode === 0，而 2026-08-27 生产实测真实详情配置走的是 2
    // （源 430016501 的 1400765「python详情解析器_900」isMulti=2），200 条配置分布 1:197 / 2:3、
    // 本环境没有 0——等于这个判断恒为假，详情配置全被标成普通。三态原值另在 multiMode 上，
    // 需要区分 0 和 2 时读它，不要拿这个布尔反推。
    isDetail: multiMode !== undefined && multiMode !== 1,
    isLogin: templateCode === 'login',
    updatedAt: record.updateDt == null ? undefined : String(record.updateDt),
    url: configUrlFromLegacy(record),
    entryTypeId: record.entryTypeId == null ? undefined : String(record.entryTypeId),
    inEntryTypeId: record.inEntryType == null ? undefined : String(record.inEntryType),
    domain: record.domain == null ? undefined : String(record.domain),
    remark: record.remark == null ? undefined : String(record.remark),
    proxyConf: record.proxyConf == null ? undefined : String(record.proxyConf),
    coreParam: record.coreParam == null ? undefined : String(record.coreParam),
    runPolicy: record.runPolicy == null ? undefined : String(record.runPolicy),
    snatchConf: record.snatchConf == null ? undefined : String(record.snatchConf),
    downConf: record.downConf == null ? undefined : String(record.downConf),
    contentRule: record.contentRule == null ? undefined : String(record.contentRule),
    codeRule: record.codeRule == null ? undefined : String(record.codeRule),
    dedupType: record.snatchDrepeat == null ? undefined : String(record.snatchDrepeat),
    templateCode,
    multiMode,
    configType: record.configType == null ? undefined : String(record.configType),
    deleted: Number(record.isDelete ?? 0) !== 0,
    params,
  }
}

export function configPageFromLegacy(input: Paged<unknown>): Paged<Config> {
  return { total: input.total, list: input.list.map(configFromLegacy) }
}

export function configToLegacy(input: Config): LegacyRecord {
  return {
    configId: input.configId,
    configName: input.name,
    configUrl: input.url,
    topic: input.topic,
    entryTypeId: input.entryTypeId,
    inEntryType: input.inEntryTypeId,
    domain: input.domain,
    remark: input.remark,
    proxyConf: input.proxyConf,
    coreParam: input.coreParam,
    runPolicy: input.runPolicy,
    snatchConf: input.snatchConf,
    downConf: input.downConf,
    contentRule: input.contentRule,
    codeRule: input.codeRule,
    snatchDrepeat: input.dedupType,
    templetCode: input.templateCode,
    isMulti: input.multiMode,
    configType: input.configType,
  }
}

export function configParamFromLegacy(input: unknown): ConfigParamBinding {
  const record = asRecord(input)
  return {
    id: String(record.id ?? ''),
    paramId: String(record.paramId ?? ''),
    paramName: String(record.paramName ?? ''),
    valueShow: record.valueShow == null ? undefined : String(record.valueShow),
  }
}

export function configLogFromLegacy(input: unknown): ConfigActionLog {
  const record = asRecord(input)
  return {
    actionId: String(record.actionId ?? ''),
    configId: String(record.configId ?? ''),
    action: String(record.action ?? ''),
    target: String(record.tragetObj ?? record.target ?? ''),
    result: String(record.actionResult ?? record.result ?? ''),
    remark: record.remark == null ? undefined : String(record.remark),
    actionTime: record.actionTime == null ? undefined : String(record.actionTime),
  }
}

// uniqueKey（去重列）是旧前端派生字段，详情接口本身不返回它——旧 EntryTypeEdit.vue 的 loadInfo
// 靠 keyField.split(',') 匹配 columnName 现算。若记录里真带了 uniqueKey（如 mock 已是新形态数据）则优先采用，
// 否则必须按 keyField 派生，不能直接读 record.uniqueKey（真实接口下恒为 undefined，会导致去重勾选全灭、
// 保存时清空真实表的 keyField）。
function entryFieldFromLegacy(input: unknown, index: number, keySet: Set<string>): EntryField {
  const record = asRecord(input)
  const columnName = record.columnName == null ? undefined : String(record.columnName)
  const dedup = 'uniqueKey' in record ? Boolean(record.uniqueKey) : Boolean(columnName && keySet.has(columnName))
  return {
    prop: String(record.itemCode ?? record.prop ?? ''),
    desc: String(record.itemName ?? record.desc ?? ''),
    type: String(record.dataType ?? record.type ?? 'string').toLowerCase() as EntryField['type'],
    required: Boolean(record.required),
    width: record.width == null ? undefined : Number(record.width),
    preprocess: record.clearRule == null ? undefined : String(record.clearRule),
    dedup,
    itemId: record.itemId == null ? undefined : String(record.itemId),
    columnName,
    checkRule: record.checkRule == null ? undefined : String(record.checkRule),
    seq: Number(record.seq ?? index + 1),
  }
}

export function entryTypeFromLegacy(input: unknown): EntryType {
  const record = asRecord(input)
  if ('tableId' in record && 'fields' in record) return record as unknown as EntryType
  const items = Array.isArray(record.items) ? record.items : []
  const keyField = record.keyField == null ? undefined : String(record.keyField)
  const keySet = new Set((keyField ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  return {
    tableId: String(record.entryTypeId ?? ''),
    tableName: String(record.tableName ?? ''),
    // DS_KIND 老记录可能为 NULL：统一归一 MYSQL（与 DB 默认一致），不向 UI 暴露「未知」态
    dsKind: record.dsKind == null ? 'MYSQL' : String(record.dsKind) as EntryType['dsKind'],
    name: record.typeName == null ? undefined : String(record.typeName),
    remark: record.remark == null ? undefined : String(record.remark),
    fields: items.map((item, index) => entryFieldFromLegacy(item, index, keySet)),
    rowCount: record.dataCnt == null ? undefined : Number(record.dataCnt),
    updatedAt: record.updateDt == null ? undefined : String(record.updateDt),
    keyField,
    state: record.state == null ? undefined : String(record.state),
    recFlag: record.recFlag as string | number | undefined,
    checkFlag: record.checkFlag as string | number | undefined,
    checkRule: record.checkRule == null ? undefined : String(record.checkRule),
    coreParam: record.coreParam == null ? undefined : String(record.coreParam),
  }
}

export function entryTypePageFromLegacy(input: Paged<unknown>): Paged<EntryType> {
  return { total: input.total, list: input.list.map(entryTypeFromLegacy) }
}

export function entryTypeToLegacy(input: EntryType): LegacyRecord {
  return {
    entryTypeId: input.tableId || undefined,
    typeName: input.name,
    tableName: input.tableName,
    dsKind: input.dsKind,
    keyField: input.keyField,
    state: input.state,
    remark: input.remark,
    recFlag: input.recFlag,
    checkFlag: input.checkFlag,
    checkRule: input.checkRule,
    coreParam: input.coreParam,
    items: input.fields.map((field, index) => ({
      itemId: field.itemId,
      itemCode: field.prop,
      itemName: field.desc,
      columnName: field.columnName,
      dataType: field.type,
      checkRule: field.checkRule,
      width: field.width,
      clearRule: field.preprocess,
      uniqueKey: field.dedup,
      // 真实联调实测：CfgEntryItem.required 后端按 Integer 反序列化，传布尔值会报
      // MismatchedInputException（同 §数据表页 numericId 那批坑，uniqueKey 这个字段倒是布尔能过）
      required: field.required ? 1 : 0,
      seq: field.seq ?? index + 1,
    })),
  }
}

export function dataTableFromLegacy(input: unknown): DataTableMeta {
  const entry = entryTypeFromLegacy(input)
  return {
    tableId: entry.tableId,
    tableName: entry.tableName,
    name: entry.name,
    rowCount: entry.rowCount,
    state: entry.state,
    keyField: entry.keyField,
    remark: entry.remark,
    updatedAt: entry.updatedAt,
    recFlag: entry.recFlag,
    checkFlag: entry.checkFlag,
    checkRule: entry.checkRule,
    coreParam: entry.coreParam,
    fields: entry.fields.map((field) => ({
      prop: field.prop,
      type: field.type,
      desc: field.desc,
      columnName: field.columnName,
      required: field.required,
      width: field.width,
      itemId: field.itemId,
      seq: field.seq,
      preprocess: field.preprocess,
      dedup: field.dedup,
      checkRule: field.checkRule,
    })),
  }
}

/**
 * 选表分组：{main,list1,list2,list3} → main 是默认选中的 entryTypeId（标量，非列表），
 * list1/list2/list3 才是三个真正的表分组；list3 按旧前端行为反转。
 */
export function entryTypeGroupFromLegacy(input: unknown): EntryTypeGroup {
  const record = asRecord(input)
  const bucket = (key: string) => (Array.isArray(record[key]) ? (record[key] as unknown[]) : [])
  return {
    main: record.main == null ? undefined : String(record.main),
    // 源名是顶层字段（旧 CheckAdd 用它拼默认监控名「<源名>-日增量」），不能混进 list
    sourceName: record.sourceName == null ? undefined : String(record.sourceName),
    list1: bucket('list1').map(entryTypeFromLegacy),
    list2: bucket('list2').map(entryTypeFromLegacy),
    list3: bucket('list3').map(entryTypeFromLegacy).reverse(),
  }
}

export function dataRowFromLegacy(input: unknown): DataRow {
  const record = asRecord(input)
  if ('dataId' in record && 'acceptState' in record) {
    const r = record as unknown as DataRow
    if (!r.updateDt) r.updateDt = (record.UPDATE_DT ?? record.updateDt ?? record.update_dt ?? record.UPDATE_TIME ?? record.updateTime) as string | undefined
    if (!r.createDt) r.createDt = (record.CREATE_DT ?? record.createDt ?? record.create_dt ?? record.CREATE_TIME ?? record.createTime) as string | undefined
    return r
  }
  // 旧 entryDataPaged 行的系统物理列（见「单表数据查看迁移」方案 §1.2）；
  // K0 是原始 JSON ID 也属系统列，K1 起才是动态值列。TASK_ID/RUN_ID 为 mock 遗留，随 T1c 移除。
  const systemKeys = new Set([
    'ENTRY_ID', 'SOURCE_ID', 'CONFIG_ID', 'ENTRY_TYPE_ID', 'DETAIL_ID', 'PARENT_ID', 'CATEGORY_ID',
    'STATE', 'NEXT_FLAG', 'CREATE_DT', 'UPDATE_DT', 'K0', 'SEQ', 'TIMES', 'FILE_ID',
    'SOURCE_NAME', 'ENTRY_TYPE_NAME', 'VER', 'FLAG1',
    'TASK_ID', 'RUN_ID',
    // entryDetail 返回 camelCase 键（旧平台详情顶部字段），同样移出 values
    'entryId', 'sourceId', 'configId', 'detailId', 'parentId', 'categoryId', 'state', 'nextFlag',
    'createDt', 'updateDt', 'k0', 'seq', 'times', 'fileId', 'sourceName', 'entryTypeId', 'entryTypeName', 'ver', 'flag1',
  ])
  const values = Object.fromEntries(Object.entries(record).filter(([key]) => !systemKeys.has(key)))
  const titleValue = record.TITLE ?? record.title ?? record.NAME ?? record.name
    ?? Object.values(values).find((value) => typeof value === 'string' && value.trim())
  const summary = Object.entries(values)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value ?? '')}`)
    .join(' · ')
  const str = (value: unknown) => (value == null ? undefined : String(value))
  const rawUpdateDt = record.UPDATE_DT ?? record.updateDt ?? record.update_dt ?? record.UPDATE_TIME ?? record.updateTime ?? record.UPDATED_AT ?? record.updated_at
  const rawCreateDt = record.CREATE_DT ?? record.createDt ?? record.create_dt ?? record.CREATE_TIME ?? record.createTime ?? record.CREATED_AT ?? record.created_at
  return {
    dataId: String(record.ENTRY_ID ?? record.entryId ?? ''),
    sourceId: String(record.SOURCE_ID ?? record.sourceId ?? ''),
    configId: str(record.CONFIG_ID ?? record.configId),
    detailId: str(record.DETAIL_ID ?? record.detailId),
    parentId: str(record.PARENT_ID ?? record.parentId),
    categoryId: str(record.CATEGORY_ID ?? record.categoryId),
    state: str(record.STATE ?? record.state),
    nextFlag: str(record.NEXT_FLAG ?? record.nextFlag),
    createDt: str(rawCreateDt),
    updateDt: str(rawUpdateDt),
    k0: str(record.K0 ?? record.k0),
    seq: str(record.SEQ ?? record.seq),
    times: str(record.TIMES ?? record.times),
    fileId: str(record.FILE_ID ?? record.fileId),
    // 详情顶部字段（旧平台 ENTRY_DETAIL.base；camelCase 优先，大写兜底，兼容两种契约）
    sourceName: str(record.sourceName ?? record.SOURCE_NAME),
    entryTypeId: str(record.entryTypeId ?? record.ENTRY_TYPE_ID),
    entryTypeName: str(record.entryTypeName ?? record.ENTRY_TYPE_NAME),
    ver: str(record.ver ?? record.VER),
    flag1: str(record.flag1 ?? record.FLAG1),
    values,
    // 以下为 mock 遗留字段，随 DataView UI 重做一并移除（与该重做同批次，避免 UI 编译中断）
    title: String(titleValue ?? record.ENTRY_ID ?? ''),
    summary,
    taskId: str(record.TASK_ID),
    runId: str(record.RUN_ID),
    acceptState: 'accepted',
    fileType: '-',
    parseState: 'none',
  }
}

/**
 * 数据详情：行字段 + showItems（编辑表单反填用）+ subs（下游子行）+ subsCnt（子行总数）。
 *
 * `subs` 里每条是**完整详情对象**，自带 showItems / entryTypeId / entryTypeName
 * （2026-09-04 生产实测：源 430002879 的父行 2790368 带回 2 条子行，各 24 个字段）。
 * 原来这里只 `dataRowFromLegacy(sub)`，把子行的字段整个丢了——详情抽屉里只剩一个 ID，
 * 而旧平台 BaseDetail.vue 是把这些字段全渲染出来的。
 */
export function entryDetailFromLegacy(input: unknown): EntryDetail {
  const record = asRecord(input)
  const { showItems, subs, subsCnt, ...rowFields } = record
  return {
    row: dataRowFromLegacy(rowFields),
    showItems: Array.isArray(showItems) ? showItems.map(showItemFromLegacy) : [],
    subs: Array.isArray(subs) ? subs.map(entrySubRowFromLegacy) : undefined,
    subsCnt: subsCnt == null ? undefined : Number(subsCnt),
  }
}

function entrySubRowFromLegacy(input: unknown): EntrySubRow {
  const record = asRecord(input)
  const { showItems, subs: _nestedSubs, ...rowFields } = record
  return {
    row: dataRowFromLegacy(rowFields),
    showItems: Array.isArray(showItems) ? showItems.map(showItemFromLegacy) : [],
    tableId: record.entryTypeId == null ? undefined : String(record.entryTypeId),
    tableName: record.entryTypeName == null ? undefined : String(record.entryTypeName),
  }
}

function showItemFromLegacy(input: unknown): EntryDetailItem {
  const record = asRecord(input)
  return {
    itemId: record.itemId == null ? undefined : String(record.itemId),
    columnName: String(record.columnName ?? ''),
    itemName: record.itemName == null ? undefined : String(record.itemName),
    value: record.value,
  }
}

/** 统计行：动态分组列原样保留，CNT 规整为 number */
export function summaryRowFromLegacy(input: unknown): SummaryRow {
  const record = asRecord(input)
  return { ...record, CNT: Number(record.CNT ?? 0) }
}

// ---------------- 规则编排（vrule，0801 方案 §4.2/§4.4/§8，字段名 2026-08-01 线上实测核实）----------------
// 注意：vrule 的 tableName 是中文业务名，采集中心 EntryType.tableName 是物理表名，两者含义相反；
// 表/字段/取数本期不走 vrule 端点（改用 entryApi/dataApi，见 utils/flow/ruleOrchestration.ts），
// 此处只处理详情/保存元数据/测试执行/保存脚本这四个仍需要 vrule 的动作。

/** 详情 GET custom-compose/getComposeById 实测响应 → RuleOrchestration；mode 恒为 ref（已存在的编排） */
export function ruleOrchestrationDetailFromLegacy(input: unknown): RuleOrchestration {
  const record = asRecord(input)
  const splitCsv = (v: unknown) => (v == null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean))
  return {
    mode: 'ref',
    ruleId: record.id == null ? undefined : String(record.id),
    name: record.ruleName == null ? undefined : String(record.ruleName),
    describe: String(record.nlDescribe ?? ''),
    systemPrompt: record.systemPrompt == null ? undefined : String(record.systemPrompt),
    // 详情不返回脚本正文，需单独调读脚本端点后由调用方回填 script
    scriptPath: record.codePath == null ? undefined : String(record.codePath),
    enabled: Number(record.state ?? 0) === 1,
    dataSource: record.dataSource == null ? undefined : String(record.dataSource),
    inputTable: record.targetTable == null ? undefined : String(record.targetTable),
    // outputTable：实测详情响应无此字段（拍板 #5），本期不从这里取
    inputFields: splitCsv(record.inputFields),
    outputFields: splitCsv(record.outputFields),
    // 0803 追加，0804 起前端不再消费：仅作服务端归属租户的透传记录（保存元数据已固定用登录账号）
    userCode: record.userCode == null ? undefined : String(record.userCode),
    modelProviderCode: record.providerCode == null ? undefined : String(record.providerCode),
    modelCode: record.modelCode == null ? undefined : String(record.modelCode),
  }
}

/**
 * 编排列表（0803 追加，支持规则名称 combobox 模糊搜索引用）：POST /vrule/ai/dashscope/list/compose，
 * 对照 vanv-rule-center-main 源码核实真实存在（DashScopeController#listRuleCompose，MyBatis-Plus IPage，
 * 序列化为 { records, total, ... }），返回的 id 是数据库自增 Long，与 getComposeById 需要的类型一致。
 * ⚠️ 该接口的 customQuery 参数是对 nlDescribe 的精确 eq，不支持按名称模糊搜——前端不传它，
 * 拉一页（size 由调用方定）后交给 RuleTableFieldBinder 客户端按名称模糊过滤，和「输入表」下拉的现有做法一致。
 */
export function ruleOrchestrationListFromLegacy(input: unknown): Paged<RuleOrchestrationItem> {
  const page = asRecord(input)
  const records = Array.isArray(page.records) ? page.records : []
  const splitCsv = (v: unknown) => (v == null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean))
  const list: RuleOrchestrationItem[] = records.map((raw) => {
    const record = asRecord(raw)
    return {
      ruleId: record.id == null ? '' : String(record.id),
      name: record.ruleName == null ? '' : String(record.ruleName),
      describe: String(record.nlDescribe ?? ''),
      // 列表不返回脚本正文（与详情一致），需单独调读脚本端点
      script: '',
      scriptPath: record.codePath == null ? '' : String(record.codePath),
      enabled: Number(record.state ?? 0) === 1,
      createdAt: record.createTime == null ? '' : String(record.createTime),
      dataSource: record.dataSource == null ? undefined : String(record.dataSource),
      inputTable: record.targetTable == null ? undefined : String(record.targetTable),
      inputFields: splitCsv(record.inputFields),
      outputFields: splitCsv(record.outputFields),
      userCode: record.userCode == null ? undefined : String(record.userCode),
    }
  })
  return { total: Number(page.total ?? list.length), list }
}

/**
 * 保存业务规则元数据（路径 A，POST custom-compose/save）。userCode 不在 RuleOrchestration 模型里，
 * 由调用方显式传入。
 * 0803 对照 vrule 真实后端源码（vanv-rule-center-main）核实：custom-compose/save 对 userCode 零校验
 * （直接 BeanUtils.copyProperties 落库，无白名单/外键），真实租户清单（js1/papa/gf/user1/ht_poc/
 * dev_zhonghe）也不在这个后端里，query-user-info 只是转发到另一个外部网关。旧前端 hydrateExternalContext
 * 读的 sessionStorage.loginUsername 键，预期值是宿主门户注入的真实租户码，不是操作人个人账号——
 * 本项目复用同一个 key 名（readLoginUsername），但写入的是采集配置中心自己的登录账号，语义不同，
 * 只是恰好后端不校验才能跑通。运营侧方案：规则编排相关操作专用 dev_zhonghe 账号登录，
 * 使 readLoginUsername() 天然返回合法租户码，无需在代码里硬编码；查无登录时缺省回退 'admin'
 * （与 FlowCanvas owner 占位一致，纯兜底，非真实租户）。
 * TODO(REVIEW-2026-08-04 P2 #15)：这是个妥协方案，前提是后端一直不校验 userCode。配个 ticket
 * 跟踪"vrule 后端什么时候开始校验 userCode"——一旦对方加了白名单/外键校验，这里全部要重新设计
 * （不能再指望 dev_zhonghe 账号名字恰好是合法租户码这件事）。
 *
 * ruleType（S3-2 §9.2-2）：默认沿用规则节点现值 `'数据处理'`。0805 真机实测过 `targetTable: ''`
 * （模拟采集首节点没有输入表）+ `ruleType: '数据处理'` 直接 POST 成功建行——后端不校验空 targetTable，
 * ruleType 也未被拒绝，采集节点（S3-3）暂不需要另传别的值，参数留着只是为了不排除未来按节点类型
 * 区分的可能性。
 */
export function ruleOrchestrationSaveMetaToLegacy(cfg: RuleOrchestration, userCode: string, ruleType = '数据处理'): LegacyRecord {
  return {
    state: 1,
    ruleType,
    dataSource: cfg.dataSource,
    userCode,
    ruleName: cfg.name,
    targetTable: cfg.inputTable,
    outputTable: cfg.outputTable,
    inputFields: (cfg.inputFields ?? []).join(','),
    outputFields: (cfg.outputFields ?? []).join(','),
  }
}

/** 测试执行请求 → 旧体 { rule_id, params, timeout }；左栏单选（会议 20:51），rows 恒为 1 条，取 rows[0] */
export function ruleOrchestrationTestToLegacy(req: RuleOrchestrationTestRequest): LegacyRecord {
  return {
    rule_id: req.ruleId,
    params: req.rows[0] ?? {},
    timeout: 300,
  }
}

/**
 * 测试执行响应 { success, result, error, execution_time, code_hash } → RuleOrchestrationTestResult。
 * result 实测为数组（一条输入可产出多条输出，见方案 §4.4），此处防御性地兼容非数组返回，
 * 避免旧接口在极端场景吐单对象时前端渲染崩溃。
 */
export function ruleOrchestrationTestFromLegacy(input: unknown): RuleOrchestrationTestResult {
  const record = asRecord(input)
  const result = record.result
  const outputs = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : result ? [result as Record<string, unknown>] : []
  return {
    success: Boolean(record.success),
    outputs,
    error: record.error == null ? undefined : String(record.error),
    executionTime: Number(record.execution_time ?? 0),
    codeHash: record.code_hash == null ? undefined : String(record.code_hash),
  }
}

/**
 * 保存元数据响应 → { ruleId, message }。
 * 兼容：裸 id / { id } / { ruleId } / envelope 已被 client.normalizeHttpPayload 剥掉后的 data。
 * 旧页保存成功后不读响应体、只刷列表——若响应无 id，调用方再走 list/compose 回查。
 */
export function ruleOrchestrationSaveMetaFromLegacy(
  input: unknown,
  fallback?: Pick<RuleOrchestration, 'ruleId'>,
): RuleOrchestrationSaveMetaResult {
  if (typeof input === 'string' || typeof input === 'number') {
    return { ruleId: String(input), message: '业务规则已保存' }
  }
  const record = asRecord(input)
  const ruleId = record.ruleId ?? record.id ?? fallback?.ruleId
  if (ruleId == null || ruleId === '') throw new Error('保存业务规则未返回 ruleId')
  return {
    ruleId: String(ruleId),
    message: record.message == null && record.msg == null ? undefined : String(record.message ?? record.msg),
  }
}

/** 从 list/compose 的 records 里按规则名+输入表匹配最新 id（旧页保存后刷列表的等价逻辑） */
export function pickRuleIdFromComposeList(
  records: unknown,
  cfg: Pick<RuleOrchestration, 'name' | 'inputTable'>,
): string | undefined {
  if (!Array.isArray(records) || !records.length) return undefined
  const name = (cfg.name ?? '').trim()
  const table = (cfg.inputTable ?? '').trim()
  const rows = records.map(asRecord)
  const byNameTable = rows.find(
    (r) => String(r.ruleName ?? '').trim() === name && String(r.targetTable ?? '').trim() === table,
  )
  if (byNameTable?.id != null) return String(byNameTable.id)
  const byName = rows.find((r) => String(r.ruleName ?? '').trim() === name)
  if (byName?.id != null) return String(byName.id)
  // 列表默认按创建时间倒序：取第一条数字 id 兜底（仅在名称匹配失败时）
  return undefined
}

/**
 * 生成脚本 → 旧体 form 字段（vrule 线上实测，rule-orchestration 页 Rt）：
 * POST /vrule/ai/dashscope/stream，Content-Type: application/x-www-form-urlencoded
 * - query = 规则处理描述（本项目 describe）
 * - userPrompt = 旧 UI「用户提示词 / 编辑系统提示词」同一字段（本项目 systemPrompt 映射过去）
 * 实测：缺 userPrompt 时接口直接 400 Bad Request，故必须始终带上（空则用兜底模板）。
 * 表字段不进此请求（已由路径 A saveMeta 落库，后端按 ruleId 取）。
 */
export const DEFAULT_GENERATE_USER_PROMPT =
  '生成 Python 规则脚本：入口函数名为 main，参数为指定入参字段列表，返回包含指定出参字段的 JSON 对象；禁止输出非 Python 内容。'

export function ruleOrchestrationGenerateToLegacy(cfg: RuleOrchestration): LegacyRecord {
  return {
    ruleId: String(cfg.ruleId ?? ''),
    query: cfg.describe ?? '',
    userPrompt: (cfg.systemPrompt ?? '').trim() || DEFAULT_GENERATE_USER_PROMPT,
    providerCode: cfg.modelProviderCode ?? '',
    modelCode: cfg.modelCode ?? '',
  }
}

/** 组装 form-urlencoded 正文（与旧 fetch body: URLSearchParams 一致） */
export function ruleOrchestrationGenerateFormBody(cfg: RuleOrchestration): string {
  const legacy = ruleOrchestrationGenerateToLegacy(cfg)
  const params = new URLSearchParams()
  params.set('ruleId', String(legacy.ruleId ?? ''))
  params.set('query', String(legacy.query ?? ''))
  params.set('userPrompt', String(legacy.userPrompt ?? ''))
  if (legacy.providerCode) params.set('providerCode', String(legacy.providerCode))
  if (legacy.modelCode) params.set('modelCode', String(legacy.modelCode))
  return params.toString()
}

/** mock saveMeta 分配 orch-*；真实 vrule id 为纯数字。非数字 id 打真实 stream 会 400。
 *  `-1` 是旧步骤「规则ID选择」未选占位，不是 vrule compose id，不能拿去生成脚本。 */
export function isVruleNumericRuleId(ruleId?: string): boolean {
  return !!ruleId && /^\d+$/.test(String(ruleId)) && ruleId !== '0'
}

/** 流式正文末行 `# [系统消息] 当前文件已经保存至MinIO：{path}` → scriptPath（旧 extractCodeFile，全角/半角冒号都认） */
const STREAM_SCRIPT_PATH_MARKERS = [
  '# [系统消息] 当前文件已经保存至MinIO：',
  '# [系统消息] 当前文件已经保存至MinIO:',
  // data-process 生成脚本（0831 实测）：末行 `# 当前文件已保存到/code01/202608/xxx.py`
  '# 当前文件已保存到',
]

/**
 * 剥离流式正文末尾的 MinIO 保存标记行，抽成独立函数便于单测（S3-2 §9.2-1）。
 * 标记行不是脚本/配置正文的一部分：对 Python 只是多一行无意义注释，但对 XML（S3-3 抓取配置）
 * 这行会破坏合法性，必须剥掉——按最后一次匹配的行整行连同其后的空行一并去掉。
 * 找不到标记行时原样返回整段文本（scriptPath 为空串）。
 */
export function stripMinioMarkerLine(text: string): { script: string; scriptPath: string } {
  const rawLines = text.split('\n')
  let scriptPath = ''
  let markerIdx = -1
  for (let i = rawLines.length - 1; i >= 0; i--) {
    const line = rawLines[i]
    if (!line) continue
    for (const marker of STREAM_SCRIPT_PATH_MARKERS) {
      if (line.startsWith(marker)) {
        scriptPath = line.slice(marker.length).trim()
        markerIdx = i
        break
      }
    }
    if (scriptPath) break
  }
  const script = markerIdx >= 0 ? rawLines.slice(0, markerIdx).join('\n').trimEnd() : text
  return { script, scriptPath }
}

export function parseRuleOrchestrationStreamText(text: string): RuleOrchestrationGenerateResult {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>
      const script = record.script ?? record.scriptCode
      if (!script) {
        const code = record.code
        const msg = record.msg ?? record.message ?? record.error
        if (code != null && String(code) !== '0' && String(code) !== '200') {
          throw new Error(String(msg || `生成脚本失败 [${code}]`))
        }
        if (typeof msg === 'string' && msg.trim()) throw new Error(msg)
      }
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
    }
  }
  const { script, scriptPath } = stripMinioMarkerLine(text)
  if (!script.trim()) throw new Error('生成脚本未返回内容')
  return { script, scriptPath }
}

/**
 * data-process 生成脚本的流式正文解析（0831 实测契约）：
 * 响应为 text/plain 分块流，整体形如
 * ```python
 * def process(...):
 *     ...
 * ```
 * # 当前文件已保存到/code01/202608/xxx.py
 * 先剥末尾保存标记行拿 scriptPath，再剥 markdown 代码围栏拿纯 Python 正文。
 * 围栏可能不存在（后端提示词变化时），此时按纯文本处理。
 */
export function parseDataProcessStreamText(text: string): RuleOrchestrationGenerateResult {
  const { script: fenced, scriptPath } = stripMinioMarkerLine(text)
  const fence = fenced.match(/^```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n?```[ \t]*$/)
  const script = fence ? fence[1] : fenced
  if (!script.trim()) throw new Error('生成脚本未返回内容')
  return { script, scriptPath }
}

/** 生成脚本响应 → { script, scriptPath }；兼容 code/codePath 别名（非流式兜底） */
export function ruleOrchestrationGenerateFromLegacy(input: unknown): RuleOrchestrationGenerateResult {
  if (typeof input === 'string') return parseRuleOrchestrationStreamText(input)
  const record = asRecord(input)
  const script = String(record.script ?? record.code ?? record.scriptCode ?? '')
  const scriptPath = String(record.scriptPath ?? record.codePath ?? record.codeFileName ?? '')
  if (!script) throw new Error('生成脚本未返回 script')
  return { script, scriptPath }
}

// 字段名对照旧 column.config.js TASK_LIST.base：actionName→typeName、nodeCode→node、
// taskTopic→topic、updateDt→updatedAt（方案 §1.6-5 TaskInst）。
// mock / 已适配记录可能已经是新字段名，legacy 键缺失时回退 typeName / node / topic / updatedAt。
export function taskInstFromLegacy(input: unknown): TaskInst {
  const record = asRecord(input)
  return {
    taskId: String(record.taskId ?? ''),
    state: String(record.state ?? '') as TaskInst['state'],
    typeName: String(record.actionName ?? record.typeName ?? ''),
    taskName: record.taskName == null ? '' : String(record.taskName),
    sourceId: String(record.sourceId ?? ''),
    configId: record.configId == null ? undefined : String(record.configId),
    node: record.nodeCode != null ? String(record.nodeCode) : (record.node == null ? undefined : String(record.node)),
    topic: record.taskTopic != null ? String(record.taskTopic) : (record.topic == null ? undefined : String(record.topic)),
    parentId: record.parentId == null ? undefined : String(record.parentId),
    updatedAt: String(record.updateDt ?? record.updatedAt ?? ''),
    taskSpecId: record.taskSpecId == null ? undefined : String(record.taskSpecId),
    bizId: record.bizId != null ? String(record.bizId) : (record.entryId != null ? String(record.entryId) : undefined),
    taskUrl: record.taskUrl != null ? String(record.taskUrl) : (record.url != null ? String(record.url) : undefined),
    fileId: record.fileId == null ? undefined : String(record.fileId),
    flowId: record.flowId == null ? undefined : String(record.flowId),
    params: record.params != null ? String(record.params) : (record.taskParams != null ? String(record.taskParams) : undefined),
    taskResult: record.taskResult != null ? String(record.taskResult) : (record.result != null ? String(record.result) : undefined),
    vars: record.vars == null ? undefined : String(record.vars),
    createdAt: record.createDt != null ? String(record.createDt) : (record.createdAt != null ? String(record.createdAt) : undefined),
    startedAt: record.startDt != null ? String(record.startDt) : (record.startedAt != null ? String(record.startedAt) : undefined),
    endedAt: record.endDt != null ? String(record.endDt) : (record.endedAt != null ? String(record.endedAt) : undefined),
  }
}

/** data-view 网站管理（cfg_site）到本平台网站卡片模型的只读映射。 */
export function siteFromLegacy(input: unknown): Site {
  const record = asRecord(input)
  if ('name' in record && 'sourceCount' in record) return record as unknown as Site

  const sourceCount = Number(record.sourceCnt ?? record.sourceCount ?? 0)
  const categoryPath = record.categoryName == null ? '' : String(record.categoryName)
  const category = categoryPath.split('/').filter(Boolean)[0] ?? ''
  const errorCount = record.errorCnt == null
    ? (record.siteHealth === 'ERROR' ? sourceCount : 0)
    : Number(record.errorCnt)

  return {
    siteId: String(record.siteId ?? ''),
    name: String(record.siteName ?? ''),
    category,
    categoryPath: categoryPath || undefined,
    dirId: record.categoryId == null ? undefined : String(record.categoryId),
    owner: '',
    // 0915-14：后端 2026-09-16 给 cfg_site 加了 tags 列（此前这里一直硬编码空数组，
    // 卡片上那块标签区因此从没显示过东西）。入库形态是**分号分隔、不带 `#`**（如 `测试;服务`），
    // 与源标签（`#a,#b`）不是一套；parseIssueTags 认 [，,;；] 所以读可以共用。
    tags: parseIssueTags(record.tags),
    sourceCount,
    errorCount,
    notifyCount: legacyNumber(record.notifyCnt),
    updatedAt: record.updateDt == null ? undefined : String(record.updateDt),
    dataCount: record.dataTotal == null ? undefined : Number(record.dataTotal),
    lastTaskAt: record.lastInsert == null ? undefined : String(record.lastInsert),
  }
}

export function sitePageFromLegacy(input: Paged<unknown>): Paged<Site> {
  return { total: input.total, list: input.list.map(siteFromLegacy) }
}

function legacyNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/** data-view 源分页/详情到当前 Source 模型的只读映射。 */
export function sourceFromLegacy(input: unknown): Source {
  const record = asRecord(input)
  if ('name' in record && 'url' in record && 'mainTable' in record) return record as unknown as Source

  const categoryPath = record.categoryName == null ? undefined : String(record.categoryName)
  const category = record.classify ?? record.templetCode
  const isDeleted = legacyNumber(record.isDelete)
  const notifyFlag = legacyNumber(record.notifyFlag)
  const alarmCount = legacyNumber(record.alarmCnt)
  const rawSiteId = record.siteId
  const siteId = rawSiteId == null || rawSiteId === 0 || rawSiteId === '0' ? undefined : String(rawSiteId)

  // 1008-01：217 起 sourceDetail / sourcePaged / site/sources 不再返回 flowId，改成 defaultFlowId（当前生效的
  // 默认流程，组内源取来源组的）和 sourceGroupId，后端也不再读旧 FLOW_ID 列。响应里有 defaultFlowId 这个键
  // （哪怕是 null = 没有可用默认流程）就以它为准，不退回旧 flowId 的陈旧值；没有这个键才是老后端，照旧读 flowId。
  const defaultFlowId = record.defaultFlowId == null ? undefined : String(record.defaultFlowId)
  const effectiveFlowId = 'defaultFlowId' in record ? defaultFlowId : (record.flowId == null ? undefined : String(record.flowId))

  return {
    sourceId: String(record.sourceId ?? ''),
    name: String(record.sourceName ?? ''),
    url: record.sourceUrl == null ? '' : String(record.sourceUrl),
    configId: record.configId == null ? '' : String(record.configId),
    flowId: effectiveFlowId,
    defaultFlowId,
    sourceGroupId: record.sourceGroupId == null ? undefined : String(record.sourceGroupId),
    // 0927 G2：ROOT 权威方案的只读反查字段（源所属流程 ROOT 步骤/首任务配置）。后端源列表与
    // 详情已返回（bee-info SourceNextController / SourceController）；前端当前只透传不做展示决策，
    // 做「所属流程 / ROOT 配置」列时直接读这两个字段。
    rootId: record.rootId == null ? undefined : String(record.rootId),
    rootConfigId: record.rootConfigId == null ? undefined : String(record.rootConfigId),
    sourceType: record.sourceType == null ? undefined : String(record.sourceType),
    mainTable: record.entryTypeId == null ? '' : String(record.entryTypeId),
    owner: record.author == null ? '' : String(record.author),
    category: category == null ? undefined : String(category),
    subCategory: record.classifySub == null ? undefined : String(record.classifySub),
    categoryPath,
    dirId: record.categoryId == null ? undefined : String(record.categoryId),
    tags: parseIssueTags(record.tags),
    color: colorFromLegacy(record),
    priority: legacyNumber(record.priority),
    disabled: isDeleted == null ? undefined : isDeleted !== 0,
    state: String(record.state ?? ''),
    lastTaskAt: record.lastRun == null ? undefined : String(record.lastRun),
    lastSuccessAt: record.lastSuccess == null ? undefined : String(record.lastSuccess),
    dataCount: legacyNumber(record.dataCnt),
    lastInsertAt: record.lastInsert == null ? undefined : String(record.lastInsert),
    jobCount: legacyNumber(record.jobCnt),
    stepCount: legacyNumber(record.stepCnt),
    remark: record.remark == null ? undefined : String(record.remark),
    cycle: record.schedule == null ? undefined : String(record.schedule),
    alarm: notifyFlag === 1 || (alarmCount != null && alarmCount > 0),
    lastUrl: record.lastUrl == null ? undefined : String(record.lastUrl),
    coreParam: record.sourceParam == null ? undefined : String(record.sourceParam),
    authConfig: record.authConfig == null ? undefined : String(record.authConfig),
    resume: legacyNumber(record.keepLast) === 1,
    domain: record.domain == null ? undefined : String(record.domain),
    createdAt: record.createDt == null ? undefined : String(record.createDt),
    updatedAt: record.updateDt == null ? undefined : String(record.updateDt),
    siteId,
    siteName: record.siteName == null ? undefined : String(record.siteName),
  }
}

/** 前端 Source → 旧平台 updateSource 请求体的字段逆向映射。
 *  与 sourceFromLegacy 对称:旧平台契约统一使用 sourceName/sourceUrl/entryTypeId/author/classify/categoryId 等字段,
 *  保存时再映射回去。 */
export function sourceToLegacyParams(source: Source): Record<string, unknown> {
  return {
    sourceId: source.sourceId,
    sourceName: source.name,
    sourceUrl: source.url,
    configId: source.configId,
    sourceType: source.sourceType,
    entryTypeId: source.mainTable,
    author: source.owner,
    classify: source.category,
    classifySub: source.subCategory,
    categoryName: source.categoryPath,
    categoryId: source.dirId,
    tags: Array.isArray(source.tags) ? source.tags.join(',') : source.tags,
    priority: source.priority,
    isDelete: source.disabled === true ? 1 : source.disabled === false ? 0 : undefined,
    state: source.state,
    remark: source.remark,
    schedule: source.cycle,
    notifyFlag: source.alarm ? 1 : 0,
    keepLast: source.resume ? 1 : 0,
    domain: source.domain,
    sourceParam: source.coreParam,
    authConfig: source.authConfig,
  }
}

/**
 * 批量配定时 → 旧 `POST /v1/source/createJobs` 的 query 参数（旧 SourceCron.vue + api/source-job.js saveSourceCron）。
 * - `configId` 必须在场、可为空串（旧 api 层强制 `''`）；请求时要配合 `keepEmptyParams: ['configId']`。
 * - `flowId` 0 = 跟随各来源默认流程；正数时后端校验每个源都关联了该流程，否则整批不建。
 * - `indexKey` 旧批量入口不传，这里也不带。
 */
export function createJobsToLegacy(input: CreateJobsInput): LegacyRecord {
  return {
    ids: input.sourceIds.filter(Boolean).join(','),
    cron: input.cron.trim(),
    enable: input.enable,
    monitorEnable: input.monitorEnable,
    monitorAfter: input.monitorAfter ?? 30,
    flowId: input.flowId ? Number(input.flowId) : 0,
    configId: '',
  }
}

/** 快捷编辑只映射名称 / URL / 核心参数，避免整条源回写时覆盖其它属性。 */
export function sourceCoreToLegacyParams(sourceId: string, patch: { name?: string; url?: string; coreParam: string }): Record<string, unknown> {
  return { sourceId, sourceName: patch.name, sourceUrl: patch.url, sourceParam: patch.coreParam }
}

/** 旧平台 sourcePaged 的分页结构适配。 */
export function sourcePageFromLegacy(input: unknown): Paged<Source> {
  const record = asRecord(input)
  const list = Array.isArray(input)
    ? input
    : (Array.isArray(record.list) ? record.list : [])
  const total = legacyNumber(record.total ?? record.count ?? record.totalCount) ?? list.length
  return { total, list: list.map(sourceFromLegacy) }
}

/** 旧平台 item/next 步骤列表到当前流程节点模型的只读映射。 */
export function stepFromLegacy(input: unknown, sourceId: string): Step {
  const record = asRecord(input)
  const rawStepId = record.itemConfig ?? record.stepId ?? record.id
  const rawSourceId = record.sourceId ?? sourceId
  const rawEnabled = record.enabled
  const isDelete = legacyNumber(record.isDelete)
  // lastStep 是依赖的前置步骤 ID（拓扑排序用），不是上下文字段列表；
  // 上下文来源/出参列的真实字段是 context / outContext（2026-08-26 生产实测，源 430016821）。
  const splitFieldList = (value: unknown) => typeof value === 'string' && value.trim()
    ? value.split(/[，,]/).map((item) => item.trim()).filter(Boolean)
    : undefined
  const dependsOn = record.lastStep == null ? undefined : splitFieldList(String(record.lastStep))
  const contextMap = splitFieldList(record.context)
  const outColumns = splitFieldList(record.outContext)

  return {
    stepId: String(rawStepId ?? ''),
    applySource: record.applySource == null ? undefined : String(record.applySource),
    sourceId: String(rawSourceId ?? sourceId),
    name: String(record.name ?? record.flowName ?? ''),
    nodeType: record.nodeType == null && record.nodeKind == null && record.type == null && record.template == null
      ? undefined
      : String(record.nodeType ?? record.nodeKind ?? record.type ?? record.template),
    configType: record.configType == null
      ? (legacyNumber(record.stepType) === undefined ? undefined : String(legacyNumber(record.stepType)))
      : String(record.configType),
    // 步骤级类型副本（cs_item_config.step_type 的 JSON 键，未存时为 null）。前端不展示它，
    // 只回读有效数字；实际步骤修改时随报文补写，首次补齐不单独触发脏判断。
    stepType: legacyNumber(record.stepType),
    inputTable: record.inputTable == null && record.entryTypeId == null
      ? undefined
      : String(record.inputTable ?? record.entryTypeId),
    outputTable: record.outputTable == null && record.outEntry == null
      ? undefined
      : String(record.outputTable ?? record.outEntry),
    configId: record.configId == null ? undefined : String(record.configId),
    mainConfig: record.mainConfig == null ? undefined : String(record.mainConfig),
    // 0925：步骤归属整体切 flowId（bee-top FLOW_ID 列）；老后端不回时 undefined，双轨兼容。
    flowId: record.flowId == null ? undefined : String(record.flowId),
    flowCode: record.flowCode == null ? undefined : String(record.flowCode),
    itemId: record.itemId == null ? undefined : String(record.itemId),
    extName: record.extName == null ? undefined : String(record.extName),
    isRoot: record.isRoot == null ? undefined : Number(record.isRoot) === 1,
    urlSourceField: record.urlSourceField == null ? undefined : String(record.urlSourceField),
    urlRule: record.urlRule == null ? undefined : String(record.urlRule),
    url: record.url == null ? undefined : String(record.url),
    condition: record.condition == null && record.cond == null ? undefined : String(record.condition ?? record.cond),
    failAction: record.failAction == null ? undefined : String(record.failAction),
    dependsOn,
    contextMap,
    outColumns,
    enabled: rawEnabled == null ? isDelete !== 1 : Boolean(rawEnabled),
  }
}

/** 旧平台 item/next 分页/流程图响应到当前步骤数组。 */
export function sourceStepsFromLegacy(input: unknown, sourceId: string): Step[] {
  const record = asRecord(input)
  const rows = Array.isArray(input)
    ? input
    : (Array.isArray(record.list) ? record.list : [])
  return rows
    .map((item) => stepFromLegacy(item, sourceId))
    .filter((step) => step.stepId)
}

// 步骤写入 payload（saveItemConfig 新建、stepModify 修改共用字段）。字段名和取值逐一对照
// 2026-08-26 生产实测：源 430016398、itemConfig 40600，POST /v1/item/next/stepModify 的真实
// 请求体（未改动任何字段值原样提交，提交前后 nextConfigPaged 回读比对完全一致）：
//   {lastStep,sourceId,mainConfig,entryTypeId,name,url,extName,configId,cond,outEntry,
//    outContext,itemId,type,flowCode,context,bizType,enabled,allField,nextStep,itemConfig,
//    isDelete,authConfig,sid,checked,show}
// 0925 契约变更：新增 flowId（bee-top FLOW_ID 列，步骤归属整体切 flowId；空时后端
// fillFlowIdIfEmpty 回填 mainConfig）。bizType/authConfig/sid/allField/checked/show 六项在
// 目前见过的所有样本里恒为固定值（null/null/null/[]/true/true），语义未确认，这里按实测值
// 原样透传，不体现进 Step 类型——一旦哪天见到非固定值的样本，说明这几项真的可变，需要另建
// Step 字段承接。
function stepWritePayloadBase(step: Step): Record<string, unknown> {
  return {
    lastStep: step.dependsOn?.length ? step.dependsOn.join(',') : null,
    sourceId: step.sourceId === '' || step.sourceId == null ? null : Number(step.sourceId),
    mainConfig: step.mainConfig == null ? undefined : Number(step.mainConfig),
    // 0925 步骤归属切 flowId：显式携带（数字）；没有时不出现该键，交给后端回填 mainConfig。
    // 0927 P2-5：只有**有效流程 ID**（数字且非 '0'）才携带——'0' 是 truthy，Number('0') 会
    // 把哨兵当成真流程 ID 写进 payload，绕过后端 fillFlowIdIfEmpty 的回填；非数字同理会变 NaN。
    ...(validFlowIdOf(step.flowId) ? { flowId: Number(step.flowId) } : {}),
    entryTypeId: step.inputTable == null ? null : Number(step.inputTable),
    name: step.name,
    url: step.url ?? null,
    extName: step.extName ?? null,
    configId: step.configId == null ? undefined : Number(step.configId),
    cond: step.condition ?? null,
    outEntry: step.outputTable == null ? null : Number(step.outputTable),
    outContext: step.outColumns?.length ? step.outColumns.join(',') : null,
    itemId: step.itemId == null ? null : Number(step.itemId),
    // file 已废弃，仅回读保留；任何新建/修改请求都归一为 entry，rule 等其它身份原样发送。
    type: step.nodeType === 'file' ? 'entry' : step.nodeType ?? 'entry',
    flowCode: step.flowCode ?? 'WEB_SNATCH',
    // 2026-10-25：步骤级类型副本随保存补写（文件下载=95）。无值不占键（选择性更新，null=不修改）。
    ...(Number.isFinite(step.stepType) ? { stepType: step.stepType } : {}),
    context: step.contextMap?.length ? step.contextMap.join(',') : null,
    bizType: null,
    enabled: step.enabled,
    allField: [] as string[],
    nextStep: null,
    authConfig: null,
    sid: null,
    checked: true,
    show: true,
  }
}

/** 新建步骤（POST item/next/saveItemConfig）。旧平台真实调用是
 *  `axios({method:'post', params: parameter})`——注意是 POST 但走 query string，不是 JSON
 *  body，调用方需要用 `paramsIn: 'query'`。新建步骤没有 itemConfig（后端分配 ID），也不传
 *  isDelete。 */
export function stepToSaveItemConfigPayload(step: Step): Record<string, unknown> {
  return stepWritePayloadBase(step)
}

/** 修改步骤（POST item/next/stepModify）。旧平台真实调用是 `axios({method:'post', data})`，
 *  JSON body（默认 paramsIn: 'body' 即可）。itemConfig 取 step.stepId；isDelete 和 enabled
 *  互为反数，2026-08-26 实测确认两个字段同时提交，不是只传其中一个。 */
export function stepToStepModifyPayload(step: Step): Record<string, unknown> {
  return {
    ...stepWritePayloadBase(step),
    itemConfig: step.stepId === '' ? undefined : Number(step.stepId),
    isDelete: step.enabled ? 0 : 1,
  }
}

/** 旧平台 sourceSame 的轻量源选项适配。 */
export function sourceOptionFromLegacy(input: unknown): SourceOption {
  const record = asRecord(input)
  return {
    sourceId: String(record.sourceId ?? ''),
    name: String(record.name ?? record.sourceName ?? ''),
  }
}

/** 旧平台分类分页结果适配为当前树结构；接口未返回子级时不虚构 children。 */
export function sourceCategoriesFromLegacy(input: unknown): SourceCategory[] {
  const record = asRecord(input)
  const rows = Array.isArray(input)
    ? input
    : (Array.isArray(record.list) ? record.list : [])
  const nodes = rows.map((item) => {
    const row = asRecord(item)
    const count = legacyNumber(row.count ?? row.sourceCnt ?? row.sourceCount)
    const seq = row.seq != null ? Number(row.seq) : undefined
    // 后端返回 null 的 remark 不要落成 ''，否则「填了空值」与「本来没备注」分不开
    const remark = row.remark == null ? undefined : String(row.remark)
    return {
      id: String(row.categoryId ?? row.id ?? ''),
      name: String(row.categoryName ?? row.name ?? ''),
      parentId: row.parentId == null || row.parentId === 0 ? '' : String(row.parentId),
      count,
      seq,
      remark,
    }
  }).filter((node) => node.id && node.name)
  const byId = new Map<string, SourceCategory>()
  nodes.forEach((node) => byId.set(node.id, {
    id: node.id,
    name: node.name,
    ...(node.count == null ? {} : { count: node.count }),
    ...(node.seq == null ? {} : { seq: node.seq }),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    // 2026-10-16 补：remark 以前没被映射，导致树节点拿不到备注——
    // `CategoryManager.openEdit()` 读 `node.remark` 回填编辑表单，于是「备注」永远显示为空。
    ...(node.remark == null ? {} : { remark: node.remark }),
  }))
  const roots: SourceCategory[] = []
  nodes.forEach((node) => {
    const target = byId.get(node.id)!
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) {
      parent.children = [...(parent.children ?? []), target]
    } else {
      roots.push(target)
    }
  })
  return roots
}

/** data-view 网站统计摘要到当前顶部统计模型的只读映射。 */
export function siteSummaryFromLegacy(input: unknown): SiteSummary {
  const record = asRecord(input)
  return {
    total: Number(record.total ?? 0),
    sourceTotal: Number(record.sourceTotal ?? 0),
    notifyCount: Number(record.notifyCount ?? 0),
    errorCount: Number(record.errorCnt ?? record.errorCount ?? 0),
  }
}

/** data-view 网站下源列表到本平台 Source 的只读映射。 */
/** 节点类型（sourceType/list、detail）→ NodeType。后端 seq 可能为 null，数字字段统一转 number|null */
export function nodeTypeFromLegacy(input: unknown): NodeType {
  const r = (input ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (v == null ? '' : String(v))
  const seq = r.seq == null || r.seq === '' ? null : Number(r.seq)
  return {
    sourceType: str(r.sourceType),
    typeName: str(r.typeName),
    typeGroup: str(r.typeGroup),
    downType: str(r.downType),
    topic: str(r.topic),
    seq: Number.isFinite(seq) ? seq : null,
    notes: str(r.notes),
    procType: str(r.procType),
    params: str(r.params),
  }
}

export function siteSourceFromLegacy(input: unknown): Source {
  return sourceFromLegacy(input)
}

/**
 * `source/nextStep` / `source/nextStep2` 回执解析（0812 计划 M3-0J）。
 * 真实响应形如 `"本次发送:3 条, 结果:,reject_39025: [3条]"`——"本次发送"是提交条数，
 * 不是进入条数；按目标节点分组的 `ok_<itemConfig>` / `reject_<itemConfig>` 才是真实结果，
 * `reject_` 表示被该节点的进入条件拒绝（2026-08-18 测试环境实测确认，见方案 §12.1B）。
 * 无法解析出任何分组时（如全部 ID 无效："本次发送:0 条, 结果:"）entries 为空数组，
 * 调用方按 submitted 兜底展示。
 */
export interface NextStepReceiptEntry {
  status: 'ok' | 'reject'
  nodeId: string
  count: number
}

export interface NextStepReceipt {
  submitted: number
  entries: NextStepReceiptEntry[]
  okCount: number
  rejectCount: number
  raw: string
}

export function parseNextStepReceipt(message: string): NextStepReceipt {
  const submittedMatch = message.match(/本次发送[:：]\s*(\d+)\s*条/)
  const submitted = submittedMatch ? Number(submittedMatch[1]) : 0
  const entries: NextStepReceiptEntry[] = []
  const entryPattern = /(ok|reject)_([^:\s]+)\s*:\s*\[(\d+)\s*条\]/g
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(message))) {
    entries.push({ status: match[1] as 'ok' | 'reject', nodeId: match[2], count: Number(match[3]) })
  }
  const sum = (status: 'ok' | 'reject') => entries.filter((e) => e.status === status).reduce((s, e) => s + e.count, 0)
  return { submitted, entries, okCount: sum('ok'), rejectCount: sum('reject'), raw: message }
}

/* ────────────── flow 流程（cs_flow，2026-09-02 接真实后端） ────────────── */

/**
 * `flowConf` 是后端眼里的**不透明大字段**——2026-09-02 通读旧平台确认：全仓库除了流程管理页
 * 自己那个 JSON textarea，没有任何地方解析或渲染它，后端也只当字符串存取。所以结构由我们定，
 * 唯一硬约束是「必须是合法 JSON」（旧平台保存前会 JSON.parse 校验）。
 *
 * 但读回来的东西不一定是我们写的：旧平台流程管理页的「重置模板」按钮会把它写成
 * `{"states":{},"paths":{}}`（那是更早的画布格式，DEFAULT_CONF_JSON），人手改坏也有可能。
 * 所以这里认不出形状就回退成空流程，**绝不让整页崩**——流程列表打不开比某条流程画布是空的严重得多。
 */
export function flowDefinitionFromConf(conf: unknown): FlowDefinition {
  const blank: FlowDefinition = { main: [], branches: [], configs: {}, branchGroups: [] }
  if (typeof conf !== 'string' || !conf.trim()) return blank
  let parsed: unknown
  try {
    parsed = JSON.parse(conf)
  } catch {
    return blank
  }
  const record = asRecord(parsed)
  // 我们的结构以 main 数组为准；states/paths 那套（或任何别的形状）一律当空流程。
  if (!Array.isArray(record.main)) return blank
  return {
    ...(record.structureOnly === true ? { structureOnly: true } : {}),
    main: record.main.map(String),
    branches: Array.isArray(record.branches) ? record.branches as FlowDefinition['branches'] : [],
    configs: record.configs && typeof record.configs === 'object'
      ? record.configs as FlowDefinition['configs']
      : {},
    branchGroups: Array.isArray(record.branchGroups)
      ? record.branchGroups as FlowDefinition['branchGroups']
      : [],
  }
}

/** cs_flow 记录 → 前端 FlowRecord。列表接口不返回 flowConf，此时 definition 为空流程。 */
export function flowFromLegacy(input: unknown): FlowRecord {
  const record = asRecord(input)
  return {
    id: String(record.flowId ?? ''),
    name: String(record.flowName ?? ''),
    seq: legacyNumber(record.seq),
    definition: flowDefinitionFromConf(record.flowConf),
    updatedAt: record.updateDt == null ? '' : String(record.updateDt),
    sourceCnt: legacyNumber(record.sourceCnt),
    isTemplate: record.templateFlag == null ? undefined : Number(record.templateFlag) === 1,
    fromTemplateId: record.refFlowId == null ? undefined : String(record.refFlowId),
    // 0929 F6：cs_flow.IS_DELETE（0 正常 / 1 禁用 / -1 已删）与 STATE（C 草稿 / D 已删）。
    // paged 已过滤 state=D；detail 可能回显，F8 保存链路用 state 识别"已被别端删除"。
    disabled: record.isDelete == null ? undefined : Number(record.isDelete) === 1,
    state: record.state == null ? undefined : String(record.state),
    categoryId: record.categoryId == null ? undefined : String(record.categoryId),
    bizType: record.bizType == null ? undefined : String(record.bizType),
    flowTags: record.flowTags == null ? undefined : String(record.flowTags),
    description: record.flowDesc == null ? undefined : String(record.flowDesc),
    remark: record.remark == null ? undefined : String(record.remark),
    createdAt: record.createDt == null ? undefined : String(record.createDt),
    // version 刻意不填：cs_flow 没有这一列，见 FlowRecord 的注释。
  }
}

export function flowPageFromLegacy(input: unknown): { total: number; list: FlowRecord[] } {
  const record = asRecord(input)
  const list = Array.isArray(input) ? input : (Array.isArray(record.list) ? record.list : [])
  const total = Array.isArray(input) ? input.length : Number(record.total ?? list.length)
  return { total, list: list.map(flowFromLegacy) }
}

/**
 * 前端保存输入 → saveFlow 请求体。字段与提交口径照抄旧平台流程管理页
 * （FlowList.vue submitEdit）：只提交可编辑字段，**不回传** state / isDelete / createDt /
 * sourceCnt 这些系统字段，避免把后端维护的值覆盖掉。新增时不带 flowId。
 */
export function flowToLegacy(input: FlowSaveInput): LegacyRecord {
  const payload: LegacyRecord = {
    flowName: input.name.trim(),
    flowConf: JSON.stringify(input.definition),
  }
  if (input.id) payload.flowId = input.id
  // 模板标记只在显式传了才提交。saveFlow 是**全量保存**，不传这个字段时后端保持原值；
  // 传 undefined 会被 JSON 丢掉，等价于不传——所以这里用 in 判断而不是真值判断。
  if (input.isTemplate !== undefined) payload.templateFlag = input.isTemplate ? 1 : 0
  if (input.fromTemplateId !== undefined) payload.refFlowId = input.fromTemplateId
  if (input.seq !== undefined) payload.seq = input.seq
  // 同 templateFlag：只有显式传了才进 payload。saveFlow 是全量保存，
  // 不传 = 保持后端原值，传空串 = 清空——两者不能混。
  // F5（0929）：**清空不能再传 null**——后端 update 分支用 MyBatis-Plus updateById，
  // null 字段被跳过，「清空分类」永远静默不生效。改用 0 作清空哨兵：后端 saveFlow
  // 见 categoryId<=0 显式把 CATEGORY_ID 置 null（目录 ID 都是正数，0 不可能撞合法值）。
  // 其余调用方（FlowDetailDrawer 新建/保存、toggleTemplate 等）都不传 categoryId，
  // 只有画布/工作区把 metaForm.categoryId 显式提交（'' → 0 清空 / 合法 id 原样）。
  if (input.categoryId !== undefined) payload.categoryId = input.categoryId ? Number(input.categoryId) : 0
  if (input.flowTags !== undefined) payload.flowTags = input.flowTags
  if (input.description !== undefined) payload.flowDesc = input.description
  if (input.remark !== undefined) payload.remark = input.remark
  return payload
}
