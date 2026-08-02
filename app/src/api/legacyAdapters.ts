import type {
  Config,
  ConfigActionLog,
  ConfigParamBinding,
  DataRow,
  DataTableMeta,
  EntryDetail,
  EntryDetailItem,
  EntryField,
  EntryType,
  EntryTypeGroup,
  Paged,
  Param,
  ParamInput,
  ParamKind,
  ParamValue,
  RuleOrchestration,
  RuleOrchestrationGenerateResult,
  RuleOrchestrationSaveMetaResult,
  RuleOrchestrationSaveResult,
  RuleOrchestrationTestRequest,
  RuleOrchestrationTestResult,
  SummaryRow,
  TaskInst,
} from './types'

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

function asRecord(value: unknown): LegacyRecord {
  return value && typeof value === 'object' ? (value as LegacyRecord) : {}
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
  const record = asRecord(input)
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
    isDetail: multiMode === 0,
    isLogin: templateCode === 'login',
    updatedAt: record.updateDt == null ? undefined : String(record.updateDt),
    url: record.configUrl == null ? undefined : String(record.configUrl),
    entryTypeId: record.entryTypeId == null ? undefined : String(record.entryTypeId),
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
    rowCount: entry.rowCount ?? 0,
    state: entry.state,
    keyField: entry.keyField,
    fields: entry.fields.map((field) => ({
      prop: field.prop,
      type: field.type,
      desc: field.desc,
      columnName: field.columnName,
      required: field.required,
      width: field.width,
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
    list1: bucket('list1').map(entryTypeFromLegacy),
    list2: bucket('list2').map(entryTypeFromLegacy),
    list3: bucket('list3').map(entryTypeFromLegacy).reverse(),
  }
}

export function dataRowFromLegacy(input: unknown): DataRow {
  const record = asRecord(input)
  if ('dataId' in record && 'acceptState' in record) return record as unknown as DataRow
  // 旧 entryDataPaged 行的系统物理列（见「单表数据查看迁移」方案 §1.2）；
  // K0 是原始 JSON ID 也属系统列，K1 起才是动态值列。TASK_ID/RUN_ID 为 mock 遗留，随 T1c 移除。
  const systemKeys = new Set([
    'ENTRY_ID', 'SOURCE_ID', 'CONFIG_ID', 'ENTRY_TYPE_ID', 'DETAIL_ID', 'PARENT_ID', 'CATEGORY_ID',
    'STATE', 'NEXT_FLAG', 'CREATE_DT', 'UPDATE_DT', 'K0', 'SEQ', 'TIMES', 'FILE_ID',
    'TASK_ID', 'RUN_ID',
  ])
  const values = Object.fromEntries(Object.entries(record).filter(([key]) => !systemKeys.has(key)))
  const titleValue = record.TITLE ?? record.title ?? record.NAME ?? record.name
    ?? Object.values(values).find((value) => typeof value === 'string' && value.trim())
  const summary = Object.entries(values)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value ?? '')}`)
    .join(' · ')
  const str = (value: unknown) => (value == null ? undefined : String(value))
  return {
    dataId: String(record.ENTRY_ID ?? record.entryId ?? ''),
    sourceId: String(record.SOURCE_ID ?? record.sourceId ?? ''),
    configId: str(record.CONFIG_ID),
    detailId: str(record.DETAIL_ID),
    parentId: str(record.PARENT_ID),
    categoryId: str(record.CATEGORY_ID),
    state: str(record.STATE),
    nextFlag: str(record.NEXT_FLAG),
    createDt: str(record.CREATE_DT),
    updateDt: str(record.UPDATE_DT),
    k0: str(record.K0),
    seq: str(record.SEQ),
    times: str(record.TIMES),
    fileId: str(record.FILE_ID),
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

/** 数据详情：entryDetail 返回行字段 + showItems（编辑表单反填用）+ subs（子列表） */
export function entryDetailFromLegacy(input: unknown): EntryDetail {
  const record = asRecord(input)
  const { showItems, subs, ...rowFields } = record
  return {
    row: dataRowFromLegacy(rowFields),
    showItems: Array.isArray(showItems) ? showItems.map(showItemFromLegacy) : [],
    subs: Array.isArray(subs) ? subs.map(dataRowFromLegacy) : undefined,
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
  }
}

/**
 * 保存业务规则元数据（路径 A，POST custom-compose/save）。userCode 不在 RuleOrchestration 模型里，
 * 由调用方显式传入——本项目里"当前登录账号"从不接入业务字段，一律沿用现有系统的硬编码 'admin' 占位
 * （如 FlowCanvas/index.vue、stores/runtime.ts 的 owner 字段，拍板已确认跟现有系统保持一致）。
 * 注意：真实 vrule 后端的 userCode 语义是租户码（js1/papa/gf/user1/ht_poc/dev_zhonghe），
 * 'admin' 不是其中之一——Sprint 4 真实联调时需要后端确认这个占位值能否直接收，还是需要换真实租户码。
 */
export function ruleOrchestrationSaveMetaToLegacy(cfg: RuleOrchestration, userCode: string): LegacyRecord {
  return {
    state: 1,
    ruleType: '数据处理',
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

/** 保存脚本（路径 B，POST dashscope/script/edit）：codeFileName/scriptCode 是旧接口固定字段名 */
export function ruleOrchestrationSaveScriptToLegacy(cfg: Pick<RuleOrchestration, 'ruleId' | 'scriptPath' | 'script'>): LegacyRecord {
  return {
    ruleId: cfg.ruleId,
    codeFileName: cfg.scriptPath,
    scriptCode: cfg.script,
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

/** 保存脚本响应 → { ruleId, scriptPath, message }；缺省回退请求侧已有值 */
export function ruleOrchestrationSaveScriptFromLegacy(
  input: unknown,
  cfg: Pick<RuleOrchestration, 'ruleId' | 'scriptPath'>,
): RuleOrchestrationSaveResult {
  if (input == null || (typeof input === 'object' && !Object.keys(asRecord(input)).length)) {
    return {
      ruleId: String(cfg.ruleId ?? ''),
      scriptPath: String(cfg.scriptPath ?? ''),
      message: '规则脚本已保存',
    }
  }
  const record = asRecord(input)
  return {
    ruleId: String(record.ruleId ?? record.id ?? cfg.ruleId ?? ''),
    scriptPath: String(record.scriptPath ?? record.codePath ?? record.codeFileName ?? cfg.scriptPath ?? ''),
    message: record.message == null && record.msg == null ? undefined : String(record.message ?? record.msg),
  }
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
  }
}

/** 组装 form-urlencoded 正文（与旧 fetch body: URLSearchParams 一致） */
export function ruleOrchestrationGenerateFormBody(cfg: RuleOrchestration): string {
  const legacy = ruleOrchestrationGenerateToLegacy(cfg)
  const params = new URLSearchParams()
  params.set('ruleId', String(legacy.ruleId ?? ''))
  params.set('query', String(legacy.query ?? ''))
  params.set('userPrompt', String(legacy.userPrompt ?? ''))
  return params.toString()
}

/** mock saveMeta 分配 orch-*；真实 vrule id 为纯数字。非数字 id 打真实 stream 会 400。 */
export function isVruleNumericRuleId(ruleId?: string): boolean {
  return !!ruleId && /^\d+$/.test(String(ruleId))
}

/** 流式正文末行 `# [系统消息] 当前文件已经保存至MinIO：{path}` → scriptPath（旧 _t()） */
const STREAM_SCRIPT_PATH_MARKERS = [
  '# [系统消息] 当前文件已经保存至MinIO：',
]

export function parseRuleOrchestrationStreamText(text: string): RuleOrchestrationGenerateResult {
  const script = text
  let scriptPath = ''
  const lines = text.split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const marker of STREAM_SCRIPT_PATH_MARKERS) {
      if (lines[i].startsWith(marker)) {
        scriptPath = lines[i].slice(marker.length).trim()
        break
      }
    }
    if (scriptPath) break
  }
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
export function taskInstFromLegacy(input: unknown): TaskInst {
  const record = asRecord(input)
  return {
    taskId: String(record.taskId ?? ''),
    state: String(record.state ?? '') as TaskInst['state'],
    typeName: record.actionName == null ? '' : String(record.actionName),
    taskName: record.taskName == null ? '' : String(record.taskName),
    sourceId: String(record.sourceId ?? ''),
    configId: record.configId == null ? undefined : String(record.configId),
    node: record.nodeCode == null ? undefined : String(record.nodeCode),
    topic: record.taskTopic == null ? undefined : String(record.taskTopic),
    parentId: record.parentId == null ? undefined : String(record.parentId),
    updatedAt: record.updateDt == null ? '' : String(record.updateDt),
    taskSpecId: record.taskSpecId == null ? undefined : String(record.taskSpecId),
  }
}
