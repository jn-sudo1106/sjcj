// 流程画布数据模型 —— 忠实移植自静态原型 prototypes/collect-config-center.html
// 节点配置、连线（子步骤）配置、节点模板与图标/样式辅助函数均与原型口径一致。

import type { RuleOrchestration, Site, Source, Step } from '../../api'
import { extractUrlParamIds } from './urlParams'

export type NodeKind = 'node' | 'decision' | 'parallel'
export type TripleField = 'inmap' | 'params' | 'output'
type LegacyTriple = [string, string, string]

export interface InputMapping {
  name: string
  from: string
  desc: string
}

export interface FieldDef {
  name: string
  type: string
  desc: string
}

export interface FieldOption {
  prop: string
  desc: string
}

type FieldOptionTable = {
  tableId: string
  fields: FieldOption[]
}

export function fieldOptionsFromTableOrOutput(tableId: string, tables: FieldOptionTable[], fallbackOutput: FieldDef[] = []): FieldOption[] {
  const table = tables.find((t) => t.tableId === tableId)
  if (table) return table.fields.map((f) => ({ prop: f.prop, desc: f.desc }))
  return fallbackOutput.map((f) => ({ prop: f.name, desc: f.desc || f.type }))
}

export interface NodeConfig {
  title: string
  sub: string
  status: string
  planned: boolean
  collect?: boolean
  kind?: NodeKind
  disabled?: boolean
  base: [string, string][]
  fields: [string, string][]
  inmap: InputMapping[]
  params: FieldDef[]
  output: FieldDef[]
  collectCfg?: CollectConfig
  /** 非采集类节点的产物落表绑定（采集类沿用 collectCfg.outputTable，二者不重复） */
  outputTable?: string
  /** 产物高级配置（原「落表输出」节点能力，降维为全节点通用；0701 问题四） */
  outputAdvanced?: OutputAdvanced
  /** 非采集类节点的输入表（采集类沿用 collectCfg.inputTable）；空 = 自动继承上游节点输出表，显式设置即覆盖（0701 问题五） */
  inputTable?: string
  /** 节点进入条件：语义为本节点只处理满足条件的输入表行 */
  entryCondition?: ConditionGroup
  /** 任务级配置（队列/URL规则/拼接逻辑/触发条件），采集与非采集节点共用同一处（0706 调整4·任务配置独立化） */
  taskCfg?: TaskConfig
  /** 规则处理节点编排配置（0707 Phase 9：规则引擎 rule-orchestration） */
  ruleCfg?: RuleOrchestration
}

type InputMappingLike = InputMapping | LegacyTriple
type FieldDefLike = FieldDef | LegacyTriple
type NodeConfigSeed = Omit<NodeConfig, 'inmap' | 'params' | 'output'> & {
  inmap: InputMappingLike[]
  params: FieldDefLike[]
  output: FieldDefLike[]
}

/** 条件操作符（0701 问题十·方案B「节点进入条件」） */
export type ConditionOp = 'contains' | 'eq' | 'ne' | 'gt' | 'lt' | 'notEmpty'

/** 结构化进入条件：语义"本节点只处理满足条件的行"，1:1 对应 Step.condition（函数表达式）契约 */
export interface EntryCondition {
  field: string
  op: ConditionOp
  value: string
}

/** 条件组：多字段组合逻辑（0706 优化·主题二「条件表达式统一规范」），叶子沿用 EntryCondition。
 *  0707 优化·补：结构化字段选择表达不了跨字段比较/函数调用等复杂逻辑，加表达式模式兜底（1:1 对应 Step.condition 契约）；
 *  mode 缺省 = 'fields'（旧数据无此字段，兼容读取，0701 问题五同款 1:1+fallback 口径）；两种模式二选一，不混用。 */
export interface ConditionGroup {
  mode?: 'fields' | 'expr'
  logic: 'AND' | 'OR'
  items: EntryCondition[]
  /** mode === 'expr' 时的原始表达式字符串；不做语法校验，透传存储 */
  expr?: string
}

export interface OutputAdvanced {
  writeMode: 'upsert' | 'append'
  dedupeKey: string
  /** 失败策略（0707 恢复）：原挂在连线「失败动作」上，连线概念撤掉后归并到此——单一归属，不再两处维护 */
  failPolicy: string
}

/** 任务级配置（0706 优化·调整4；0710 瘦身：拼接逻辑/任务参数无后端 Step 契约字段且与 URL 规则重叠，已删）：
 * 队列归属、任务 URL 来源字段/规则，独立于节点处理逻辑 */
export interface TaskConfig {
  queue: string
  /** 任务 URL 来源字段：从输入表 schema 中选择，供 urlRule 拼接引用（0707 补齐，原属于连线配置的"任务 URL 来源字段"） */
  urlSourceField?: string
  urlRule: string
}

export type WebKind = 'list' | 'detail' | 'attachment'

/** 采集节点类型（0711 R7/R8：新增"浏览器抓取"/"公众号抓取"两个独立固定产物类型节点）。
 *  旧节点没有这个字段，用 inferCollectorKind() 从 snatchType/webKind 推导，不强制迁移数据。 */
export type CollectorKind = 'web' | 'browser_html' | 'wechat_official_html' | 'app' | 'file_download' | 'python'

/** 采集节点能力描述：固定产物类型节点的表/队列不可编辑，UI 与 store 双重防线都据此判断（0711 T5） */
export interface CollectorCapability {
  kind: CollectorKind
  label: string
  artifactType: 'structured' | 'html' | 'file'
  outputMode: 'selectable' | 'fixed'
  /** outputMode === 'fixed' 时的固定输出表（mock 环境直接给定值；真实环境应由后端按能力键解析，此处简化不做二次抽象） */
  fixedOutputTable?: string
  queueMode: 'editable' | 'fixed'
  /** queueMode === 'fixed' 时的固定队列名 */
  fixedQueue?: string
  supportsProxy: boolean
  supportsResume: boolean
  supportsLogin: boolean
  supportsUrlParams: boolean
}

export const COLLECTOR_CAPABILITIES: Record<CollectorKind, CollectorCapability> = {
  web: { kind: 'web', label: '网页抓取', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: true, supportsResume: true, supportsLogin: true, supportsUrlParams: true },
  browser_html: {
    kind: 'browser_html', label: '浏览器抓取', artifactType: 'html', outputMode: 'fixed', fixedOutputTable: 'raw_html_browser',
    queueMode: 'fixed', fixedQueue: 'browser_html_collect', supportsProxy: true, supportsResume: true, supportsLogin: true, supportsUrlParams: true,
  },
  wechat_official_html: {
    kind: 'wechat_official_html', label: '公众号抓取', artifactType: 'html', outputMode: 'fixed', fixedOutputTable: 'raw_html_wechat_official',
    queueMode: 'fixed', fixedQueue: 'wechat_official_html_collect', supportsProxy: true, supportsResume: true, supportsLogin: true, supportsUrlParams: true,
  },
  app: { kind: 'app', label: 'APP 抓取', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: false, supportsResume: false, supportsLogin: true, supportsUrlParams: false },
  file_download: { kind: 'file_download', label: '文件下载', artifactType: 'file', outputMode: 'selectable', queueMode: 'editable', supportsProxy: false, supportsResume: true, supportsLogin: false, supportsUrlParams: false },
  python: { kind: 'python', label: 'Python 抓取', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: false, supportsResume: false, supportsLogin: false, supportsUrlParams: false },
}

/** 从旧字段推导采集类型（1:1+fallback，0701 问题五同款口径）：显式 collectorKind 优先，否则按 snatchType 特征推断 */
export function inferCollectorKind(cc?: CollectConfig): CollectorKind {
  if (cc?.collectorKind) return cc.collectorKind
  const st = cc?.snatchType || ''
  if (/BROWSER/.test(st)) return 'browser_html'
  if (/WECHAT/.test(st)) return 'wechat_official_html'
  if (/\[170\]/.test(st)) return 'python'
  if (/\[95\]/.test(st)) return cc?.webKind === 'attachment' ? 'file_download' : 'app'
  return 'web'
}

/** 节点的采集能力描述；非采集节点（无 collectCfg）返回 undefined */
export function collectorCapabilityOf(cfg: NodeConfig): CollectorCapability | undefined {
  if (!cfg.collectCfg) return undefined
  return COLLECTOR_CAPABILITIES[inferCollectorKind(cfg.collectCfg)]
}

/** 采集类节点的可编辑配置（0706 优化·源/节点配置分层后瘦身：源级字段迁至 Source，见 api/types.ts） */
export interface CollectConfig {
  snatchType: string
  webKind: WebKind
  url: string
  outputTable: string
  /** 输入表：空 = 自动继承上游节点输出表，显式设置即覆盖（0701 问题五） */
  inputTable: string
  /** 节点进入条件：语义为本采集步骤只处理满足条件的输入表行 */
  entryCondition?: ConditionGroup
  inputParams: string[]
  isDetail: boolean
  /** 采集节点类型（0711 R7/R8）：缺省时用 inferCollectorKind() 推导，不强制迁移旧数据 */
  collectorKind?: CollectorKind
  /** URL 参数绑定的参数 id 列表（0711 R9：源 URL 支持 $PARAM$_id 占位符）；与旧的 inputParams 是两个不同概念，互不覆盖。
   *  实际引用的参数 id 已经写死在 URL 的 $PARAM$_id token 里，这个列表是从 url 解析出的缓存/展示用途，不是"选择绑定哪个参数"。 */
  urlParamRefs?: string[]
  /** 每个参数 id 对应的选定取值（0711-B 拍板⑧：子源级可覆盖）——本字段随 collectCfg 一起活在"这个子源自己的 FlowDef"里，
   *  天然就是子源级：模板同步下发时所有子源起初相同，之后各子源独立编辑互不影响，和 url 字段完全同一套落点逻辑。
   *  缺省 = 用参数候选值列表的第一个值作为预览/试跑取值。 */
  urlParamValues?: Record<string, string>
  /** 运行设置（0711 R5：代理/断点续爬/登录从 Source 级迁到节点级，各节点可独立配置）。
   *  缺省 undefined 时由 NodeInspector 读一次 Source 同名旧字段做展示兜底（1:1+fallback），
   *  用户在本节点显式改过后才写入这里；Source 上的旧字段保留只读、不再新写入。 */
  useProxy?: boolean
  resume?: boolean
  needLogin?: boolean
  loginUrl?: string
  account?: string
  credentialRef?: string
  /** 定时策略只作用于首个采集节点；历史 Source/TaskConfig 同名字段在 load 时迁入。 */
  scheduleType?: string
  scheduleTime?: string
  weekdays?: number[]
  cron?: string
}

export type CollectorSchedule = Pick<CollectConfig, 'scheduleType' | 'scheduleTime' | 'weekdays' | 'cron'>

export const DEFAULT_RULE_SYSTEM_PROMPT = '生成 Python 规则脚本：入口为 def main(content)，返回 JSON 对象；只做文本判断，不访问外部网络或文件。'

export function makeDefaultRuleOrchestration(): RuleOrchestration {
  return {
    mode: 'new',
    describe: 'content 中包含地产二字时，tags 返回房地产',
    systemPrompt: DEFAULT_RULE_SYSTEM_PROMPT,
    script: '',
    scriptPath: '',
    enabled: true,
  }
}

// 节点配置种子（key = 节点 id）。插入新节点时克隆对应模板生成新 key。
const NODE_CONFIG_SEEDS = {
  'web-list': {
    title: '公告列表抓取', sub: '[90] 网页抓取 · 源配置', status: '运行', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/announcements?page=${page}'], ['源名称', '交易所公告列表 - A 股'], ['源分类', '公告 / 交易所 / 列表'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['本次使用配置', '配置 81909'], ['源标签', '公告、A股、列表页']],
    inmap: [['page', '序列参数', '1..20'], ['publish_date', '动态日期', '$CUR_DATA,-1']],
    params: [['page', 'sequence', '1..20'], ['publish_date', 'date', '$CUR_DATA,-1,yyyy-MM-dd']],
    output: [['detail_url', 'url', '详情页子步骤入口'], ['title', 'string', '公告标题'], ['publish_time', 'date', '发布时间']],
    collectCfg: {
      snatchType: '[90] - 网页抓取', url: 'https://example.com/announcements?page=${page}',
      webKind: 'list',
      outputTable: '2101001', inputTable: '', inputParams: ['p-date'],
      isDetail: false,
    },
    taskCfg: { queue: 'announcement.list', urlRule: '' },
  },
  'web-detail': {
    title: '公告详情抓取', sub: '[90] 网页抓取 · 子步骤产物', status: '运行', planned: false, collect: true,
    base: [['本次使用配置', '配置 81908'], ['失败策略', '跳过并记录'], ['启用状态', '启用'], ['原始文件', '保存 HTML/PDF']],
    fields: [['父步骤', '公告列表抓取'], ['去重', '由列表表去重'], ['超时', '30s'], ['重试', '2']],
    inmap: [['detail_url', '← 列表抓取.detail_url', '上一步属性'], ['retry', '常量', '2']],
    params: [['detail_url', 'from parent', '列表页输出'], ['retry', 'number', '2']],
    output: [['content', 'longtext', '正文'], ['attachments', 'json', '附件列表'], ['source_file', 'url', '原始文件']],
    collectCfg: {
      snatchType: '[90] - 网页抓取', url: 'https://example.com/detail/${detail_url}',
      webKind: 'detail',
      outputTable: '2101001', inputTable: '2101001', inputParams: [],
      isDetail: true,
    },
    taskCfg: { queue: '', urlSourceField: 'file_url-K4', urlRule: '$VAL$' },
  },
  'app-collect': {
    title: 'APP 抓取', sub: '[95] APP 抓取 · 移动端接口', status: '待配置', planned: false, collect: true,
    base: [['包名', 'com.example.app'], ['接口地址', 'https://m.example.com/api/list?page=${page}'], ['采集方式', 'APP 接口抓取'], ['鉴权方式', '接口 token / 设备参数']],
    fields: [['本次使用配置', '配置 APP-001'], ['登录态', '按接口鉴权'], ['设备参数', '二期接入'], ['源标签', 'APP、接口']],
    inmap: [['page', '序列参数', '1..20'], ['token', '常量 / 登录态', '按接口鉴权']],
    params: [['page', 'sequence', '1..20'], ['token', 'credential', '接口鉴权参数']],
    output: [['payload', 'json', '接口返回'], ['content', 'longtext', '正文'], ['source_url', 'url', '来源链接']],
    collectCfg: {
      snatchType: '[95] - APP 抓取', url: 'https://m.example.com/api/list?page=${page}',
      webKind: 'list',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'app.collect', urlRule: '' },
  },
  // 0711 R7：浏览器抓取——渲染并保存 HTML 文件，输出表/队列固定（先做成与网页抓取同构，仅能力键+固定值不同）
  'browser-html-collect': {
    title: '浏览器抓取', sub: '[BROWSER] 浏览器抓取 · 源配置', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://example.com'], ['源名称', '浏览器抓取源'], ['产物', 'HTML 文件（固定输出表）'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['本次使用配置', '待选择'], ['源标签', '']],
    inmap: [],
    params: [],
    output: [['html_file', 'file', '渲染后的 HTML 文件']],
    collectCfg: {
      snatchType: '[BROWSER] - 浏览器抓取', url: 'https://example.com',
      webKind: 'list',
      outputTable: COLLECTOR_CAPABILITIES.browser_html.fixedOutputTable ?? '', inputTable: '', inputParams: [],
      isDetail: false,
      collectorKind: 'browser_html',
    },
    taskCfg: { queue: COLLECTOR_CAPABILITIES.browser_html.fixedQueue ?? '', urlRule: '' },
  },
  // 0711 R8：公众号抓取——同构于浏览器抓取，仅固定表/队列取另一组能力键
  'wechat-html-collect': {
    title: '公众号抓取', sub: '[WECHAT] 公众号抓取 · 源配置', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://mp.weixin.qq.com/s/xxx'], ['源名称', '公众号抓取源'], ['产物', 'HTML 文件（固定输出表）'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['本次使用配置', '待选择'], ['源标签', '']],
    inmap: [],
    params: [],
    output: [['html_file', 'file', '公众号页面 HTML 文件']],
    collectCfg: {
      snatchType: '[WECHAT] - 公众号抓取', url: 'https://mp.weixin.qq.com/s/xxx',
      webKind: 'list',
      outputTable: COLLECTOR_CAPABILITIES.wechat_official_html.fixedOutputTable ?? '', inputTable: '', inputParams: [],
      isDetail: false,
      collectorKind: 'wechat_official_html',
    },
    taskCfg: { queue: COLLECTOR_CAPABILITIES.wechat_official_html.fixedQueue ?? '', urlRule: '' },
  },
  'file-parse': {
    title: '文件解析', sub: '文件解析类 · PDF/Word/Excel/图片', status: '建议补充 · P1', planned: false,
    base: [['文件来源', '← 文件下载.source_file / 原始文件归档'], ['文件类型', 'PDF / Word / Excel / 图片'], ['解析方式', '按页解析 + 表格抽取'], ['输出策略', '文本 + 结构化表']],
    fields: [['页码 / Sheet', '全部'], ['字段范围', '标题、正文、表格、附件'], ['失败策略', '保留原始文件并告警'], ['能力状态', '建议补充']],
    inmap: [['source_file', '← 文件下载.source_file', '原始文件'], ['file_type', '← 文件下载.file_type', '文件类型']],
    params: [['parse_mode', 'enum', '全文/表格/图片'], ['page_range', 'string', '1-*'], ['sheet_name', 'string', '全部']],
    output: [['parsed_text', 'longtext', '解析文本'], ['parsed_tables', 'json', '表格结构'], ['parse_trace', 'json', '解析日志']],
  },
  ocr: {
    title: 'OCR 识别', sub: '[150] OCR 识别 · 执行器待确认', status: '规划中（待执行器）', planned: true,
    base: [['OCR 引擎', '待数据中心确认'], ['文件来源', '← 文件解析 / 原始图片'], ['输出表', 'ocr_text_result'], ['置信度阈值', '0.82']],
    fields: [['低置信度处理', '进入人工复核'], ['语言', '中文 + 英文'], ['版面保留', '开启'], ['能力状态', '页面可见，执行器待确认']],
    inmap: [['image_file', '← 文件下载.source_file', '图片或扫描件'], ['page_image', '← 文件解析.page_image', '页面图片']],
    params: [['min_confidence', 'number', '0.82'], ['language', 'enum', 'zh,en']],
    output: [['ocr_text', 'longtext', '识别文本'], ['confidence', 'number', '置信度'], ['bbox', 'json', '位置']],
  },
  'ai-extract': {
    title: '公告要素 AI 提取', sub: '[155] AI 提取 · schema', status: '规划中（待执行器）', planned: true,
    base: [['模型策略', '公告要素抽取 v3'], ['输出实体表', 'announcement_event'], ['最低置信度', '0.80'], ['低置信度处理', '进入人工队列']],
    fields: [['schema 校验', '开启'], ['敏感字段', '金额、主体、事项'], ['版本', 'draft-ai-0.3'], ['执行器', '待确认']],
    inmap: [['content', '← 详情抓取.content', '正文'], ['attachments_text', '← 详情抓取.attachments', '附件解析文本']],
    params: [['event_type', 'enum', '增持/减持/诉讼/回购'], ['amount', 'number', '万元'], ['company_name', 'string', '主体公司']],
    output: [['event_type', 'string', '事项类型'], ['summary', 'text', '摘要'], ['confidence', 'number', '置信度']],
  },
  'field-map': {
    title: '字段抽取 / 结构化映射', sub: '文本结构化类 · schema 映射', status: '建议补充 · P1', planned: false,
    base: [['输入字段', 'parsed_text / content'], ['目标 schema', 'announcement_event'], ['缺失字段策略', '空值标记 + 异常输出'], ['置信度', '字段级记录']],
    fields: [['映射方式', '规则 + 函数工具'], ['日期标准化', 'normalize_date'], ['金额单位', '万元'], ['能力状态', '新前端扩展']],
    inmap: [['parsed_text', '← 文件解析.parsed_text', '解析文本'], ['content', '← 详情抓取.content', '正文']],
    params: [['schema', 'json', '字段定义'], ['missing_policy', 'enum', '空值/阻断/告警']],
    output: [['mapped_rows', 'table', '结构化行'], ['missing_fields', 'json', '缺失字段'], ['mapping_trace', 'json', '映射日志']],
  },
  clean: {
    title: '字段清洗 / 格式转换', sub: '清洗类 · 函数工具', status: '建议补充 · P1', planned: false,
    base: [['清洗函数', 'trim + normalize_date + unit_convert'], ['空值处理', '保留并标记'], ['日期转换', 'yyyy-MM-dd'], ['单位换算', '元 → 万元']],
    fields: [['函数来源', '数据中心函数工具 + 新前端扩展'], ['异常输出', 'error_rows'], ['处理范围', '标题、日期、金额、主体'], ['能力状态', '建议补充']],
    inmap: [['mapped_rows', '← 结构化映射.mapped_rows', '待清洗行']],
    params: [['date_format', 'string', 'yyyy-MM-dd'], ['amount_unit', 'enum', '万元'], ['null_policy', 'enum', '标记']],
    output: [['clean_rows', 'table', '清洗后数据'], ['clean_errors', 'json', '清洗异常'], ['clean_trace', 'json', '处理日志']],
  },
  dedupe: {
    title: '去重处理', sub: '清洗类 · 去重字段', status: '建议补充 · P1', planned: false,
    base: [['去重字段', 'source_url + publish_time'], ['重复策略', '保留最新'], ['异常输出', 'duplicate_rows'], ['保留规则', '优先完整字段']],
    fields: [['表去重键', 'entry_type.dedupe_fields'], ['重复率阈值', '<= 1%'], ['处理方式', '写入前检查'], ['能力状态', '建议补充']],
    inmap: [['clean_rows', '← 字段清洗.clean_rows', '待去重数据']],
    params: [['dedupe_key', 'expr', 'source_url + publish_time'], ['keep_policy', 'enum', 'latest']],
    output: [['unique_rows', 'table', '去重后数据'], ['duplicate_rows', 'json', '重复明细'], ['dedupe_rate', 'number', '重复率']],
  },
  rule: {
    title: '规则引擎处理', sub: '规则处理 · group/page', status: '可批测', planned: false,
    base: [['规则组', 'NEWS_SENTIMENT'], ['执行阶段', 'BASIC'], ['逻辑', 'AND · 命中即追踪'], ['规则版本', 'rulepkg-0616-draft']],
    fields: [['表达式', 'RULE_STOCK_PRICE_COUNT'], ['共享配置', 'stockPriceKeywords'], ['Trace', '记录命中与过滤原因'], ['鉴权', '经采集配置中心网关代理']],
    inmap: [['content', '← 详情抓取.content', '输入正文'], ['stockPriceKeywords', '← 共享配置', '关键词列表']],
    params: [['minContentLength', 'number', '50'], ['stockPriceThreshold', 'number', '5'], ['stockPriceKeywords', 'list', '股价,涨停,跌停']],
    output: [['rule_hit', 'boolean', '是否命中'], ['rule_reason', 'text', '命中原因'], ['risk_level', 'enum', 'low/mid/high']],
    ruleCfg: makeDefaultRuleOrchestration(),
  },
  check: {
    title: '质量校验', sub: '[300] 校验类 · 质量门禁', status: '异常分流', planned: false,
    base: [['校验对象', 'announcement_event'], ['完整性规则', '主体/时间/事项必填'], ['去重键', 'source_url + publish_time'], ['异常去向', '回详情抓取或人工队列']],
    fields: [['字段完整率', '>= 95%'], ['重复率', '<= 1%'], ['前处理函数', 'trim + normalize_date'], ['阻断策略', '高风险阻断发布']],
    inmap: [['rows', '← AI提取.* / 详情.*', '待校验数据行'], ['risk_level', '← 规则处理.risk_level', '风险等级']],
    params: [['required_fields', 'list', 'company,event_type,publish_time'], ['dedupe_key', 'expr', 'source_url + publish_time']],
    output: [['quality_score', 'number', '质量分'], ['error_rows', 'json', '异常明细'], ['pass', 'boolean', '是否通过']],
  },
  // 「落表输出」节点已移除（优化 0701 问题四）：落表是每个节点的固有配置能力（产物 Tab），不再作为独立节点类型。
  metric: {
    title: '指标引用', sub: '输出类 · 指标中心引用', status: 'P1 · 跳转指标中心', planned: false,
    base: [['指标数据集', 'announcement_event_dataset'], ['指标', '高风险公告数'], ['编辑入口', '指标中心轻编辑器'], ['引用方式', '只引用，不在画布编辑口径']],
    fields: [['结果回溯', 'dataset -> table -> source -> task'], ['负责人', '数据运营'], ['状态', '已发布'], ['能力状态', '新前端扩展节点']],
    inmap: [['entry_type_id', '← 上游节点.entry_type_id', '来源表'], ['data_id', '← 上游节点.data_id', '结果明细']],
    params: [['dataset_id', 'string', 'ds_announcement_event'], ['measure_id', 'string', 'm_risk_notice']],
    output: [['measure_result', 'url', '指标结果链接'], ['lineage', 'json', '回溯链路']],
  },
  mail: {
    title: '提取数据发邮件', sub: '[400] 通知 · 模板与审计', status: '规划中（待执行器）', planned: true,
    base: [['邮件模板', '投研公告日报'], ['收件组', '行业研究组 / 公司研究组'], ['触发条件', 'risk_level = high 或 人工确认'], ['发送窗口', '交易日 09:00-17:00']],
    fields: [['附件', '规则命中明细.xlsx'], ['抄送', '合规留痕邮箱'], ['发送前确认', '开启'], ['执行器', '待确认']],
    inmap: [['payload', '← 校验.pass + 规则.* ', '发送数据'], ['recipients', '← 收件组', '收件人']],
    params: [['subject', 'template', '${date} 公告规则日报'], ['recipients', 'list', 'research-team']],
    output: [['mail_id', 'string', '邮件 ID'], ['sent_at', 'datetime', '发送时间'], ['audit_link', 'url', '审计链接']],
  },
  alert: {
    title: '异常告警', sub: '通知类 · 失败/阻断/恢复', status: 'P2 · 建议补充', planned: true,
    base: [['告警条件', '校验失败 / 规则阻断 / 任务 E'], ['告警级别', 'warn / high'], ['接收人', '数据运营组'], ['恢复条件', '重跑成功或人工关闭']],
    fields: [['渠道', '站内 + 邮件'], ['去重窗口', '30 分钟'], ['升级策略', '连续失败 3 次升级'], ['能力状态', '建议补充']],
    inmap: [['error_rows', '← 校验.error_rows', '异常数据'], ['task_status', '← 运行记录.status', '任务状态']],
    params: [['severity', 'enum', 'warn/high'], ['dedupe_window', 'number', '30m']],
    output: [['alert_id', 'string', '告警 ID'], ['status', 'enum', 'open/closed'], ['audit_link', 'url', '审计链接']],
  },
  decision: {
    title: '决策分支', sub: '逻辑控制 · 条件路径', status: '静态保留 · 待执行器', planned: false, kind: 'decision',
    base: [['分支名称', '按条件分流'], ['条件 1', '抓取成功且字段完整'], ['条件 2', '失败或待复核'], ['默认路径', '人工复核']],
    fields: [['节点来源', '研究工作台保留能力'], ['适配状态', '采集链路静态可配置'], ['上线依赖', '编排执行器支持条件路由'], ['失败策略', '保留运行记录']],
    inmap: [['status', '← 上游节点.status', '运行状态'], ['quality_score', '← 校验.quality_score', '质量分']],
    params: [['if', 'expr', 'status = "C" AND quality_score >= 0.95'], ['else', 'expr', '进入复核或告警']],
    output: [['true_path', 'path', '继续落表或指标'], ['false_path', 'path', '回补 / 告警 / 人工复核'], ['decision_trace', 'json', '判断依据']],
  },
  parallel: {
    title: '分头处理', sub: '逻辑控制 · 多路径并行', status: '静态保留 · 待编排', planned: false, kind: 'parallel',
    base: [['并行名称', '抓取后分头处理'], ['路径 A', '结构化清洗'], ['路径 B', '规则命中'], ['汇合点', '质量校验']],
    fields: [['节点来源', '研究工作台保留能力'], ['适配状态', '采集链路静态可配置'], ['上线依赖', '编排执行器支持 fan-out/fan-in'], ['并发上限', '待后端确认']],
    inmap: [['rows', '← 上游节点.output', '待处理数据'], ['run_id', '← 当前运行', '运行标识']],
    params: [['branches', 'list', 'clean,rule,notify'], ['join_policy', 'enum', '全部成功 / 任一失败告警']],
    output: [['branch_results', 'json', '各路径结果'], ['join_status', 'enum', 'C/E/L'], ['parallel_trace', 'json', '分头处理日志']],
  },
  custom: {
    title: '自定义节点', sub: '自定义 · 待配置', status: '待配置', planned: false,
    base: [['节点说明', '请在此描述节点用途'], ['执行器', '待选择'], ['失败策略', '记录并阻断'], ['能力状态', '自定义草稿']],
    fields: [['负责人', '数据运营'], ['输入来源', '上游节点'], ['输出去向', '下游节点'], ['配置状态', '待补充']],
    inmap: [['input', '← 上游节点.output', '输入数据']],
    params: [['config', 'json', '自定义参数']],
    output: [['result', 'json', '节点输出'], ['trace', 'json', '执行日志']],
  },
} satisfies Record<string, NodeConfigSeed>

export const NODE_CONFIGS: Record<string, NodeConfig> = normalizeNodeConfigs(NODE_CONFIG_SEEDS)

/** 旁路分支种子（决定旁路节点纵向锚点与连线两端） */
export interface BranchSeed {
  id: string
  side: 'left' | 'right'
  rowAnchor: string
  edgeFrom: string
  edgeTo: string
}

/** 决策/分头节点的分支段（0707 优化·Phase6）：
 *  - 决策：数据行按 IF→ELIF→…→ELSE 顺序匹配，命中哪条走哪条子链（单路，A3）；
 *  - 分头：全部分支无条件并行走（多路）；
 *  - 汇合：分支段统一在主链 owner 的下一个节点收拢；不需要汇合的流程把决策放主链末端即可（汇合点 = 完成端），模型不用分叉出第二种形态（Q1）；
 *  - chain 内不允许再开新的 FlowBranchGroup（不支持嵌套分支），AddNodePopover 在「分支内添加」场景隐藏「逻辑」分组防误入。
 */
export interface FlowBranch {
  id: string
  /** 分支名（用户可编辑；如 "IF 命中"、"ELIF-n"、"ELSE 兜底"、"路径A"） */
  label: string
  /** 决策：按序匹配首个命中即走；undefined = ELSE 默认分支（必为最后一条）。分头节点忽略。 */
  condition?: ConditionGroup
  /** 分支内节点 id 序列；可为空（=直接到汇合点）。chain 内节点仍归 configs 所有，不重复存配置。 */
  chain: string[]
}

export interface FlowBranchGroup {
  /** 决策/分头节点 id；同一 FlowDef 内唯一 */
  ownerId: string
  /** 决策 ≥2（含 ELSE，ELSE.condition 为 undefined）；分头 ≥2（condition 忽略） */
  branches: FlowBranch[]
}

/** 流程定义（可序列化，用于保存 / 加载 / 多流程切换） */
export interface FlowDef {
  id: string
  name: string
  version: string
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  updatedAt: string
  /** 源级配置（0706 优化·源/节点配置分层）：未绑定源的草稿流程（空白/预置意图）为 undefined */
  source?: Source
  /** 决策/分头节点的分支段（散开→汇合，0707 优化·Phase6）；未配置 = 未声明分支 */
  branchGroups?: FlowBranchGroup[]
}

// 0707 澄清：连线（子步骤）不再是独立配置对象——原来挂在连线上的字段本来就该是下游节点自己的配置，
// 已按各自归属并回节点：步骤输入/输出表、步骤名称→节点自身字段；任务 URL 规则/来源字段、步骤执行条件→任务配置 Tab
// （urlRule/urlSourceField/trigger）；失败动作→表配置高级配置（failPolicy）；上下文来源→节点配置 Tab 的「输入映射」
// （inmap，采集/非采集节点统一显示）；出参列去除——下游「输入映射」的来源下拉本就能看到上游全部产物字段，无需再单独选一次。
// 连线在画布上纯粹是节点间的视觉连接，点击不再弹出独立检查器。

// 模板 → 节点配置 key
export const TEMPLATE_TO_NODE: Record<string, string> = {
  web: 'web-list', app: 'app-collect', file: 'web-detail', python: 'web-list', parse: 'file-parse', ocr: 'ocr',
  ai: 'ai-extract', map: 'field-map', clean: 'clean', dedupe: 'dedupe', check: 'check',
  rule: 'rule', 'rule-trace': 'rule', metric: 'metric', mail: 'mail',
  alert: 'alert', decision: 'decision', parallel: 'parallel', custom: 'custom',
  // 0711 R7/R8：两个独立的固定产物类型采集节点
  'browser-html': 'browser-html-collect', 'wechat-html': 'wechat-html-collect',
}

// 抓取类型选项（统一来源；NodeInspector 与种子配置共用）
export const SNATCH_TYPES = ['[90] - 网页抓取', '[95] - APP 抓取', '[95] - 文件下载', '[150] - OCR 识别', '[155] - AI 提取', '[170] - Python 抓取']

export const WEB_KIND_OPTIONS: { value: WebKind; label: string; desc: string }[] = [
  { value: 'list', label: '列表页', desc: '分页、搜索结果、列表入口' },
  { value: 'detail', label: '详情页', desc: '正文、详情字段、附件入口' },
  { value: 'attachment', label: '文件附件页', desc: '文件下载、附件直链入口' },
]

// 新建配置：运行策略下拉选项
export const CONFIG_STRATEGY_OPTIONS = ['增量', '全量', '按需触发']

// 模板 → 默认抓取类型（新插入采集节点用）
export const TEMPLATE_TO_SNATCH: Record<string, string> = {
  web: '[90] - 网页抓取',
  app: '[95] - APP 抓取',
  file: '[95] - 文件下载',
  python: '[170] - Python 抓取',
  ocr: '[150] - OCR 识别',
  ai: '[155] - AI 提取',
  'browser-html': '[BROWSER] - 浏览器抓取',
  'wechat-html': '[WECHAT] - 公众号抓取',
}

// 左侧节点库分组
export type Pill = 'p1' | 'p2' | 'plan'
export interface LibItem { template: string; code: string; badge?: string; name: string; desc: string; pill: Pill; planned?: boolean }
export interface LibGroup { title: string; items: LibItem[] }

export const LIB_GROUPS: LibGroup[] = [
  {
    title: '采集类', items: [
      { template: 'web', code: '90', name: '网页抓取', desc: '源 URL、配置、子步骤', pill: 'p1' },
      { template: 'app', code: '95', name: 'APP 抓取', desc: '包名、接口地址、移动端参数', pill: 'p1' },
      { template: 'file', code: '95', name: '文件下载', desc: '附件、原始文件、入库', pill: 'p1' },
      { template: 'python', code: '170', name: 'Python 抓取', desc: '青龙脚本、待确认权限', pill: 'p2' },
      // 0711 R7/R8：抓 HTML 文件，输出表/队列固定，不可编辑
      { template: 'browser-html', code: 'BROWSER', badge: '180', name: '浏览器抓取', desc: '渲染并保存 HTML，固定表/队列', pill: 'p1' },
      { template: 'wechat-html', code: 'WECHAT', badge: '185', name: '公众号抓取', desc: '公众号页面采集，固定表/队列', pill: 'p1' },
    ]
  },
  {
    title: '解析结构化', items: [
      { template: 'parse', code: 'PARSE', badge: '200', name: '文件解析', desc: 'PDF/Word/Excel/图片解析', pill: 'p1' },
      { template: 'ocr', code: '150', name: 'OCR 识别', desc: '待执行器确认', pill: 'plan', planned: true },
      { template: 'ai', code: '155', name: 'AI 提取', desc: '待执行器确认', pill: 'plan', planned: true },
      { template: 'map', code: 'MAP', badge: '205', name: '字段抽取 / 结构化映射', desc: '文本字段到目标 schema', pill: 'p1' },
    ]
  },
  {
    title: '数据清洗', items: [
      { template: 'clean', code: 'CLEAN', badge: '210', name: '字段清洗 / 格式转换', desc: '函数工具、空值、单位、日期', pill: 'p1' },
      { template: 'dedupe', code: 'DEDUP', badge: '215', name: '去重处理', desc: '去重字段、重复策略', pill: 'p1' },
    ]
  },
  {
    title: '数据校验', items: [
      { template: 'check', code: '300', name: '完整性 / 阈值校验', desc: '质量门禁、异常流转', pill: 'p1' },
    ]
  },
  {
    // 0707 优化·Phase1：决策/分头处理从右键菜单单独入口收进添加节点浮层的「逻辑」分组（参照 Dify）
    title: '逻辑', items: [
      { template: 'decision', code: 'IF', badge: '310', name: '决策分支', desc: '按条件路由到下一个节点，命中一条走一条', pill: 'p1' },
      { template: 'parallel', code: 'PAR', badge: '315', name: '分头处理', desc: '多条路径无条件并行执行', pill: 'p1' },
    ]
  },
  {
    title: '规则类', items: [
      { template: 'rule', code: 'RULE', badge: '320', name: '规则处理', desc: '规则组、表达式、配置', pill: 'p1' },
      { template: 'rule-trace', code: 'TRACE', badge: '325', name: '规则 Trace', desc: '命中、过滤、失败原因', pill: 'p1' },
    ]
  },
  {
    // 「落表输出」已并入每个节点的产物 Tab（0701 问题四），分组由"输出类"更名"引用类"
    title: '引用类', items: [
      { template: 'metric', code: 'M', badge: '350', name: '指标引用', desc: '跳转指标中心，不编辑口径', pill: 'p1' },
    ]
  },
  {
    title: '通知类', items: [
      { template: 'mail', code: '400', name: '提取数据发邮件', desc: '待执行器确认', pill: 'plan', planned: true },
      { template: 'alert', code: 'ALERT', badge: '405', name: '异常告警', desc: '失败、阻断、恢复通知', pill: 'p2', planned: true },
    ]
  },
  {
    // 移除节点库侧栏后（0706 优化·Phase3），画布内「+ 添加步骤」选单复用本清单；自定义节点原仅在弹窗 MODAL_TEMPLATES 出现，一并收进来保持能力不丢
    title: '其他', items: [
      { template: 'custom', code: '—', name: '自定义节点', desc: '自定义草稿，待补充配置', pill: 'p2' },
    ]
  },
]

// 模板 → 节点类型名（新插入节点的默认节点名称 / 源名称）
export const TEMPLATE_TO_NAME: Record<string, string> = Object.fromEntries(
  LIB_GROUPS.flatMap((g) => g.items.map((it) => [it.template, it.name])),
)

// ---------- 辅助函数（移植自原型） ----------
export function compactSub(sub: string): string {
  return String(sub || '').replace(/^\[[^\]]+\]\s*/, '')
}

export function isDecision(cfg: NodeConfig): boolean {
  return cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)
}

/** 节点输出表统一读取口径（优化 0701 问题二）：采集类取 collectCfg.outputTable，其余取 outputTable */
export function nodeOutputTable(cfg: NodeConfig): string {
  return cfg.collectCfg?.outputTable || cfg.outputTable || ''
}

/** 节点输入表统一读取口径（0701 问题五）：仅返回显式设置值；空 = 未覆盖，由 effectiveInputTable 继续向上游解析 */
export function nodeInputTable(cfg: NodeConfig): string {
  return cfg.collectCfg?.inputTable || cfg.inputTable || ''
}

/** 节点任务队列统一读取口径（0706 调整4：队列归属统一收在 taskCfg，采集/非采集节点不再区分） */
export function nodeTaskQueue(cfg: NodeConfig): string {
  return cfg.taskCfg?.queue || ''
}

/** 节点进入条件统一读取口径：采集类取 collectCfg.entryCondition，非采集类取 cfg.entryCondition */
export function nodeEntryCondition(cfg: NodeConfig): ConditionGroup | undefined {
  return cfg.collectCfg?.entryCondition ?? cfg.entryCondition
}

/** 条件操作符文案（0701 问题十·方案B；0707 优化·Phase6 起仅给分支条件用） */
export const CONDITION_OP_OPTIONS: { value: ConditionOp; label: string }[] = [
  { value: 'contains', label: '包含' },
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'notEmpty', label: '非空' },
]

/** 单条件展示文案（0707 优化·Phase6 重构为内部 helper）：「标题 包含 "证券"」；fieldDesc 传字段中文名，缺省退回字段 prop。
 *  仅 conditionGroupLabel 内部使用；外部请走 conditionGroupLabel。 */
function entryConditionLabel(cond: EntryCondition | undefined, fieldDesc?: string): string {
  if (!cond || !cond.field) return ''
  const fieldLabel = fieldDesc || cond.field
  const opLabel = CONDITION_OP_OPTIONS.find((o) => o.value === cond.op)?.label ?? cond.op
  return cond.op === 'notEmpty' ? `${fieldLabel} 非空` : `${fieldLabel} ${opLabel} "${cond.value}"`
}

/** 条件组展示文案（0706 优化·主题二）：多条件按 AND/OR 拼接，如「标题 包含 "证券" 且 金额 大于 "100"」。 */
export function conditionGroupLabel(group: ConditionGroup | undefined, fieldDescOf?: (field: string) => string | undefined): string {
  if (!group) return ''
  if (group.mode === 'expr') return group.expr?.trim() ?? ''
  if (!group.items.length) return ''
  const sep = group.logic === 'OR' ? ' 或 ' : ' 且 '
  return group.items
    .map((c) => entryConditionLabel(c, fieldDescOf?.(c.field)))
    .filter(Boolean)
    .join(sep)
}

/** 条件组是否已配置（供校验/UI 判空共用）：表达式模式看 expr 非空，字段模式看 items 非空 */
export function conditionGroupIsSet(group: ConditionGroup | undefined): boolean {
  if (!group) return false
  return group.mode === 'expr' ? !!group.expr?.trim() : group.items.length > 0
}

/** 数据类节点 = "每个节点都落库"口径的适用范围；逻辑控制（决策/分头）与通知类（邮件/告警）、指标引用不产数据行，不要求输出表 */
export function isDataNode(cfg: NodeConfig): boolean {
  if (isDecision(cfg) || isParallel(cfg)) return false
  return !/邮件|告警|指标/.test(cfg.title + cfg.sub)
}

/**
 * 流程最终结果落表节点 = 主链末端、最后一个有输出表的非旁路节点。
 * 供 ResultView 与分屏对比共用（0701 问题二），两侧不再分叉。
 */
export function pickFinalMainNodeId(
  nodes: { id: string; cfg: NodeConfig; branch?: boolean }[],
): string {
  return [...nodes].reverse().find((n) => !n.branch && nodeOutputTable(n.cfg))?.id ?? ''
}

export function isParallel(cfg: NodeConfig): boolean {
  return cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)
}

/** 决策/分头节点判定（0707 优化·Phase6）：复用 isDecision/isParallel 口径，给 NodeInspector 顶层 Tab 分流
 *  与 BranchEditor 渲染入口共用，避免两处各写文案正则导致口径漂移（此前 NodeInspector 把「分头」当决策识别，且漏「多路径并行」）。 */
export function decisionOrParallelKind(cfg: NodeConfig): 'decision' | 'parallel' | undefined {
  if (isDecision(cfg)) return 'decision'
  if (isParallel(cfg)) return 'parallel'
  return undefined
}

export function iconFor(cfg: NodeConfig): string {
  const sub = cfg.sub || ''
  if (sub.indexOf('[90]') >= 0) return '90'
  if (sub.indexOf('[95]') >= 0) return '95'
  if (sub.indexOf('[150]') >= 0) return '150'
  if (sub.indexOf('[155]') >= 0) return '155'
  if (sub.indexOf('[300]') >= 0) return '300'
  if (sub.indexOf('[400]') >= 0) return '400'
  if (sub.indexOf('[BROWSER]') >= 0) return 'BROWSER'
  if (sub.indexOf('[WECHAT]') >= 0) return 'WECHAT'
  if (isDecision(cfg)) return 'IF'
  if (isParallel(cfg)) return 'PAR'
  if (/规则/.test(cfg.title)) return 'R'
  if (/指标/.test(cfg.title)) return 'M'
  if (/解析/.test(cfg.title)) return 'PARSE'
  if (/清洗/.test(cfg.title)) return 'CLEAN'
  if (/去重/.test(cfg.title)) return 'DEDUP'
  return 'NODE'
}

export function nodeClassFor(cfg: NodeConfig): string {
  if (cfg.planned && /邮件|告警/.test(cfg.title)) return 'mail-node planned'
  if (cfg.planned) return 'planned'
  if (isDecision(cfg)) return 'logic-node'
  if (isParallel(cfg)) return 'parallel-node'
  if (/规则/.test(cfg.title)) return 'rule-node'
  if (/校验/.test(cfg.title)) return 'check-node'
  if (/邮件|告警/.test(cfg.title)) return 'mail-node'
  return ''
}

function normalizeInputMapping(row: InputMappingLike): InputMapping {
  if (Array.isArray(row)) return { name: row[0] ?? '', from: row[1] ?? '', desc: row[2] ?? '' }
  return { name: row.name ?? '', from: row.from ?? '', desc: row.desc ?? '' }
}

function normalizeFieldDef(row: FieldDefLike): FieldDef {
  if (Array.isArray(row)) return { name: row[0] ?? '', type: row[1] ?? '', desc: row[2] ?? '' }
  return { name: row.name ?? '', type: row.type ?? '', desc: row.desc ?? '' }
}

export function emptyTripleRow(field: TripleField): InputMapping | FieldDef {
  return field === 'inmap' ? { name: '', from: '', desc: '' } : { name: '', type: '', desc: '' }
}

export function setTripleValue(field: TripleField, row: InputMapping | FieldDef, col: 0 | 1 | 2, value: string) {
  if (field === 'inmap') {
    const target = row as InputMapping
    if (col === 0) target.name = value
    else if (col === 1) target.from = value
    else target.desc = value
    return
  }
  const target = row as FieldDef
  if (col === 0) target.name = value
  else if (col === 1) target.type = value
  else target.desc = value
}

export function normalizeNodeConfig(cfg: NodeConfig | NodeConfigSeed): NodeConfig {
  const next = JSON.parse(JSON.stringify(cfg)) as NodeConfigSeed
  if (next.collectCfg && !next.collectCfg.urlParamRefs?.length) {
    // 旧流程只有 URL token；加载时迁移为显式节点绑定，保存后不再依赖隐式推导。
    next.collectCfg.urlParamRefs = extractUrlParamIds(next.collectCfg.url)
  }
  return {
    ...next,
    inmap: (next.inmap ?? []).map(normalizeInputMapping),
    params: (next.params ?? []).map(normalizeFieldDef),
    output: (next.output ?? []).map(normalizeFieldDef),
  }
}

export function normalizeNodeConfigs(configs: Record<string, NodeConfig | NodeConfigSeed>): Record<string, NodeConfig> {
  return Object.fromEntries(Object.entries(configs).map(([id, cfg]) => [id, normalizeNodeConfig(cfg)]))
}

export function cloneConfig(cfg: NodeConfig): NodeConfig {
  return normalizeNodeConfig(cfg)
}

// ---------- 结果视图横向布局 / 源 → 链路构造（纯函数，供 flow store 与分屏对比 Phase 5 共用）----------

export const TERMINALS: Record<string, string> = { start: '开始', end: '完成 / 发布候选' }

export interface HPlacedPos { left: number; top: number; width: number; height: number }
export interface HPlacedNode { id: string; cfg: NodeConfig; pos: HPlacedPos; branch: boolean }
export interface HPlacedTerm { id: string; label: string; pos: HPlacedPos }
export interface HEdge { d: string; rule: boolean }
export interface HorizontalLayout {
  nodes: HPlacedNode[]
  terminals: HPlacedTerm[]
  mainEdges: HEdge[]
  branchEdges: HEdge[]
  totalWidth: number
  totalHeight: number
  axisY: number
}

/** 结果视图顶部节点条布局（纯函数版，从 flow store 的 horizontalLayout 计算逻辑提取，二者算法一致）
 *  0707 优化·Phase6：扩展支持 FlowBranchGroup 决策/分头节点的分支列（chain 节点平铺在 owner 节点下方一行） */
export function buildHorizontalLayout(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[] = [],
): HorizontalLayout {
  const HNODE_W = 132
  const HNODE_H = 60
  const HTERM_W = 92
  const HTERM_H = 30
  const HGAP = 22
  const HBRANCH_DY = 86 // 旁路相对主链上下偏移
  const PAD_X = 16
  const PAD_Y = 10
  const isTerm = (id: string) => id === 'start' || id === 'end'
  // 主链顶对齐：仅当有"上方旁路"时才在主链上方留空，否则贴顶；下方旁路向下扩展高度
  const hasAbove = branches.some((b) => b.side === 'left')
  const hasBelow = branches.some((b) => b.side === 'right')
  const axisY = (hasAbove ? HBRANCH_DY : PAD_Y) + HNODE_H / 2

  const mainPos: Record<string, HPlacedPos> = {}
  let x = PAD_X
  main.forEach((id) => {
    const isT = isTerm(id)
    const w = isT ? HTERM_W : HNODE_W
    const h = isT ? HTERM_H : HNODE_H
    mainPos[id] = { left: x, top: axisY - h / 2, width: w, height: h }
    x += w + HGAP
  })
  const totalWidth = Math.max(640, x + PAD_X - HGAP)
  const totalHeight = (hasBelow ? axisY + HBRANCH_DY + HNODE_H / 2 : axisY + HNODE_H / 2) + PAD_Y

  const branchPos: Record<string, HPlacedPos> = {}
  branches.forEach((b) => {
    const anchor = mainPos[b.rowAnchor]
    if (!anchor || !configs[b.id]) return
    branchPos[b.id] = {
      left: anchor.left,
      top: b.side === 'left' ? axisY - HBRANCH_DY - HNODE_H / 2 : axisY + HBRANCH_DY - HNODE_H / 2,
      width: HNODE_W,
      height: HNODE_H,
    }
  })

  const nodes: HPlacedNode[] = []
  const terminals: HPlacedTerm[] = []
  main.forEach((id) => {
    if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
    else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false })
  })
  branches.forEach((b) => {
    if (branchPos[b.id] && configs[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true })
  })

  // 主链横向连线
  const mainEdges: HEdge[] = []
  for (let i = 0; i < main.length - 1; i++) {
    const a = mainPos[main[i]]
    const b = mainPos[main[i + 1]]
    if (!a || !b) continue
    mainEdges.push({
      d: `M${a.left + a.width} ${axisY} L${b.left} ${axisY}`,
      rule: Boolean(configs[main[i + 1]] && /规则/.test(configs[main[i + 1]].title)),
    })
  }

  // 旁路 bezier
  const branchEdges: HEdge[] = []
  branches.forEach((b) => {
    const bp = branchPos[b.id]
    const mainEnd = b.edgeFrom === b.id ? b.edgeTo : b.edgeFrom
    const mp = mainPos[mainEnd]
    if (!bp || !mp) return
    const bx = bp.left + bp.width / 2
    const by = b.side === 'left' ? bp.top + bp.height : bp.top
    const mx = mp.left + mp.width / 2
    const my = axisY
    branchEdges.push({ d: `M${mx} ${my} C${mx} ${(my + by) / 2} ${bx} ${(my + by) / 2} ${bx} ${by}`, rule: false })
  })

  // 0707 优化·Phase6：决策/分头节点的 chain 内节点平铺在 owner 节点下方一行（简化版分支列支持，
  // 跟 BranchSeed 旁路挂靠共用同一行 y=axisY+HBRANCH_DY，横向间距固定；ResultView 节点条 / CompareResultPane 随动）
  // 多个 owner 的 chain 节点共用 y 行，横向从 owner.left 顺次排列；空 chain 跳过
  const hbranchGroupByOwner: Record<string, FlowBranchGroup> = {}
  for (const g of branchGroups) hbranchGroupByOwner[g.ownerId] = g
  let chainDx = 0
  let chainHasAny = false
  // 先确定是否有 chain 节点，决定是否需要往下扩展 totalHeight
  for (const id of main) {
    const g = hbranchGroupByOwner[id]
    if (!g) continue
    for (const b of g.branches) {
      if (b.chain.length) { chainHasAny = true; break }
    }
    if (chainHasAny) break
  }
  const chainYTop = axisY + HBRANCH_DY - HNODE_H / 2
  for (const id of main) {
    const g = hbranchGroupByOwner[id]
    if (!g) continue
    let cx = mainPos[id] ? mainPos[id].left : 0
    for (const b of g.branches) {
      for (const nid of b.chain) {
        if (!configs[nid]) continue
        const existing = nodes.find((n) => n.id === nid)
        if (existing) continue
        nodes.push({ id: nid, cfg: configs[nid], pos: { left: cx, top: chainYTop, width: HNODE_W, height: HNODE_H }, branch: true })
        cx += HNODE_W + HGAP
        chainDx = Math.max(chainDx, cx)
      }
    }
  }

  return {
    nodes,
    terminals,
    mainEdges,
    branchEdges,
    totalWidth: Math.max(totalWidth, chainDx + PAD_X),
    totalHeight: chainHasAny ? chainYTop + HNODE_H + PAD_Y : totalHeight,
    axisY,
  }
}

export interface SourceSeed { main: string[]; branches: BranchSeed[]; configs: Record<string, NodeConfig> }

/** 主链上从 beforeIdx 起向前找最近一个有输出表的节点（不含 beforeIdx 自身），供输入表自动继承（0701 问题五） */
function upstreamOutputTableOf(main: string[], configs: Record<string, NodeConfig>, beforeIdx: number): string {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const c = configs[main[i]]
    if (c) {
      const t = nodeOutputTable(c)
      if (t) return t
    }
  }
  return ''
}

/**
 * 节点有效输入表（0701 问题五）：显式设置优先；否则主链节点继承上一个有输出表的节点，
 * 旁路节点继承锚点节点；均无则空（即"无上游可继承"，通常只发生在主链首节点）。
 * 0707 优化·Phase6 补：决策/分头分支 chain 内节点继承同分支内前一个有输出表的节点；
 * chain 内均无则继承 owner 节点"流入"的表——owner 是决策/分头逻辑节点，本身不产表，
 * 递归取 owner 的 effectiveInputTable（= 流入 owner 的上游数据），而非 owner 自己的输出表（恒为空）。
 */
export function effectiveInputTable(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): string {
  const c = configs[id]
  if (!c) return ''
  const own = nodeInputTable(c)
  if (own) return own
  const idx = main.indexOf(id)
  if (idx >= 0) return upstreamOutputTableOf(main, configs, idx)
  const branch = branches.find((b) => b.id === id)
  if (branch) {
    const anchor = configs[branch.rowAnchor]
    return anchor ? nodeOutputTable(anchor) : ''
  }
  for (const bg of branchGroups) {
    for (const b of bg.branches) {
      const ci = b.chain.indexOf(id)
      if (ci < 0) continue
      for (let i = ci - 1; i >= 0; i--) {
        const t = configs[b.chain[i]] ? nodeOutputTable(configs[b.chain[i]]) : ''
        if (t) return t
      }
      return effectiveInputTable(main, branches, configs, bg.ownerId, branchGroups)
    }
  }
  return ''
}

/** 是否主链首个数据节点（无上游节点；0701 问题五："从第二个步骤开始有输入表"，首节点无输入表） */
export function isFirstMainNode(main: string[], configs: Record<string, NodeConfig>, id: string): boolean {
  const idx = main.indexOf(id)
  if (idx < 0) return false
  for (let i = 0; i < idx; i++) {
    if (configs[main[i]]) return false
  }
  return true
}

/**
 * 源 → 链路种子（纯函数，从 flow store 的 loadFromSource 提取）：把源的子步骤编译为画布节点。
 * 分屏对比（Phase 5）用它独立构造第二栏的链路，不依赖/不污染全局 flow store。
 */
export function buildSourceSeed(source: Source, steps: Step[]): SourceSeed {
  const configs: Record<string, NodeConfig> = {}
  const main: string[] = ['start']
  steps.forEach((step, i) => {
    const templateKey = i === 0 ? 'web-list' : 'web-detail'
    const cfg = cloneConfig(NODE_CONFIGS[templateKey])
    cfg.title = step.name || (i === 0 ? '列表抓取' : '详情解析')
    if (cfg.collectCfg) {
      // 源级字段（源名称/分类/标签/登录/选用配置等）不再复制到节点：随 loadFromSource 整体挂到 flow.sourceCfg（0706 优化·源/节点配置分层）
      cfg.collectCfg.url = source.url
      cfg.collectCfg.outputTable = step.outputTable || source.mainTable || ''
      // 接口 1:1（Step.inputTable，'-' 表示无）：首步无输入表，次步起 = 上一步输出表（0701 问题五）
      cfg.collectCfg.inputTable = step.inputTable && step.inputTable !== '-' ? step.inputTable : ''
    }
    cfg.disabled = !step.enabled
    configs[step.stepId] = cfg
    main.push(step.stepId)
  })
  main.push('end')
  // 名字含「规则」的源在主链插入「规则处理」节点（列表抓取 → 规则处理 → 详情解析），输出表取上游（首步）的表。
  if (/规则/.test(source.name) && steps.length > 0) {
    const firstStep = steps[0]
    const ruleId = `${source.sourceId}-rule-demo`
    const ruleCfg = cloneConfig(NODE_CONFIGS.rule)
    ruleCfg.title = '规则处理'
    delete ruleCfg.collectCfg
    ruleCfg.outputTable = firstStep.outputTable || source.mainTable || ''
    configs[ruleId] = ruleCfg
    main.splice(main.indexOf(firstStep.stepId) + 1, 0, ruleId)
  }
  return { main, branches: [], configs }
}

/**
 * 网站统一流程的空白模板（0710 回退 0707 优化·补的"默认两节点骨架"）：新建/从未编排过的网站
 * 进画布应落在空白引导卡模式（§5.7 文案 + 「智能生成流程」按需生成），而不是预置「列表抓取→详情解析」——
 * 预置骨架让用户误以为流程"已经获取到了"。id 固定 `site:${siteId}`，保证引导卡生成/保存都落对存档位。
 */
export function makeSiteBlankTemplate(site: Site): FlowDef {
  return {
    id: `site:${site.siteId}`,
    name: site.name,
    version: 'site-v1',
    main: ['start', 'end'],
    branches: [],
    configs: {},
    updatedAt: '',
  }
}

/**
 * 种子演示网站的默认模板骨架（0710）：存量演示网站模拟"后端已有统一流程模板"，
 * mockFlowLoad 对种子网站查无存档时用它兜底（虚拟态，保存后才真正落盘）；
 * 用户新建的网站不走这里，进画布是空白引导卡模式（见 makeSiteBlankTemplate）。
 */
export function makeSiteSeedTemplate(siteId: string, name: string): FlowDef {
  const list = cloneConfig(NODE_CONFIGS['web-list'])
  list.title = '列表抓取'
  if (list.collectCfg) { list.collectCfg.url = ''; list.collectCfg.outputTable = '' }
  const detail = cloneConfig(NODE_CONFIGS['web-detail'])
  detail.title = '详情解析'
  if (detail.collectCfg) { detail.collectCfg.url = ''; detail.collectCfg.outputTable = ''; detail.collectCfg.inputTable = '' }
  return {
    id: `site:${siteId}`,
    name,
    version: 'site-v1',
    main: ['start', 'web-list', 'web-detail', 'end'],
    branches: [],
    configs: { 'web-list': list, 'web-detail': detail },
    updatedAt: '',
  }
}

// ---------- 新建流程 / 初始化画布（M5.5） ----------

const nowStamp = (): string => new Date().toISOString().slice(0, 16).replace('T', ' ')

/** 链路构造后回填（0701 问题二 Q1/Q2 口径）：非采集数据类节点的输出表默认取上游节点的表；旁路节点取锚点节点的表 */
function backfillOutputTables(def: FlowDef): FlowDef {
  let upstream = ''
  def.main.forEach((id) => {
    const c = def.configs[id]
    if (!c) return
    const t = nodeOutputTable(c)
    if (t) {
      upstream = t
      return
    }
    if (!c.collectCfg && isDataNode(c) && upstream) c.outputTable = upstream
  })
  def.branches.forEach((b) => {
    const c = def.configs[b.id]
    if (!c || c.collectCfg || !isDataNode(c) || nodeOutputTable(c)) return
    const anchor = def.configs[b.rowAnchor]
    const t = anchor ? nodeOutputTable(anchor) : ''
    if (t) c.outputTable = t
  })
  return def
}

/** 空白流程：仅 开始 → 完成，供从零编排 */
export function makeBlankFlow(): FlowDef {
  return {
    id: `flow-${Date.now()}`,
    name: '未命名流程',
    version: 'draft-0.1',
    main: ['start', 'end'],
    branches: [],
    configs: {},
    updatedAt: nowStamp(),
  }
}

/** 标准链路模板的源级配置（0706 优化·源/节点配置分层）：原种子 Demo 的源信息，独立于节点配置存在 */
function demoStandardSource(): Source {
  return {
    sourceId: 'flow-default', name: '交易所公告列表 - A 股', url: 'https://example.com/announcements?page=${page}',
    configId: '81909', mainTable: '2101001', owner: 'admin', state: 'C',
    category: '公告', categoryPath: '/公告/交易所/列表', tags: ['公告', 'A股', '列表页'], dirId: '9009245',
    useProxy: false, resume: true,
    configMode: 'new', configName: '交易所公告列表配置', configTopic: 'announcement.list', configStrategy: '增量',
    needLogin: true, loginUrl: 'https://example.com/login', account: 'research_***', credentialRef: 'cred-zfb',
    scheduleType: '交易日定时', scheduleTime: '08:30', weekdays: [1, 2, 3, 4, 5], cron: '30 8 * * 1-5',
  }
}

/** 标准链路模板（= 原种子 Demo：公告规则采集，固定节点 id 供子步骤 / 测试引用） */
export function makeStandardFlow(): FlowDef {
  const configs: Record<string, NodeConfig> = {}
    ;['web-list', 'web-detail', 'ai-extract', 'rule', 'check', 'mail'].forEach((k) => {
      configs[k] = cloneConfig(NODE_CONFIGS[k])
    })
  return backfillOutputTables({
    id: 'flow-default',
    name: '公告规则采集链路_v3',
    version: 'draft-0.3',
    main: ['start', 'web-list', 'web-detail', 'ai-extract', 'rule', 'end'],
    branches: [
      { id: 'check', side: 'left', rowAnchor: 'ai-extract', edgeFrom: 'check', edgeTo: 'rule' },
      { id: 'mail', side: 'right', rowAnchor: 'ai-extract', edgeFrom: 'web-detail', edgeTo: 'mail' },
    ],
    configs,
    updatedAt: nowStamp(),
    source: demoStandardSource(),
  })
}

// 预置意图链路构造器：按模板序列克隆节点、清空采集占位（与 store.insertAfter 同口径）
let presetSeq = 1
interface StepSpec {
  template: string
  name?: string
  patch?: Partial<CollectConfig>
}
/** sourcePatch：预置意图若需要预设源级字段（如登录态），整条链路共用一份草稿源（0706 优化·源/节点配置分层） */
function buildFlow(name: string, steps: StepSpec[], sourcePatch?: Partial<Source>): FlowDef {
  const main: string[] = ['start']
  const configs: Record<string, NodeConfig> = {}
  steps.forEach((s) => {
    const srcKey = TEMPLATE_TO_NODE[s.template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    if (s.template === 'decision') cfg.kind = 'decision'
    if (s.template === 'parallel') cfg.kind = 'parallel'
    cfg.title = s.name || TEMPLATE_TO_NAME[s.template] || cfg.title
    if (cfg.collectCfg) {
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[s.template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      cfg.collectCfg.outputTable = ''
      cfg.collectCfg.inputParams = []
      if (s.patch) Object.assign(cfg.collectCfg, s.patch)
    }
    const id = `${srcKey}-p${presetSeq++}`
    configs[id] = cfg
    main.push(id)
  })
  main.push('end')
  const source: Source | undefined = sourcePatch
    ? { sourceId: `src-${Date.now()}`, name, url: '', configId: '', mainTable: '', owner: '', state: 'C', ...sourcePatch }
    : undefined
  return backfillOutputTables({
    id: `flow-${Date.now()}-${presetSeq}`,
    name,
    version: 'draft-0.1',
    main,
    branches: [],
    configs,
    updatedAt: nowStamp(),
    source,
  })
}

export interface PresetIntent {
  key: string
  label: string
  keywords: string[]
  rationale: string
  build: () => FlowDef
}

/** 预置意图 → 链路（首期种子，可扩展）。智能体首期按关键词匹配，二期换真 LLM。 */
export const PRESET_INTENTS: PresetIntent[] = [
  // 预置链路不再带「落表输出」步骤（0701 问题四）：落表是每个节点的产物配置，最终结果 = 末端节点的输出表。
  {
    key: 'web-public',
    label: '公共网页抓取',
    keywords: ['公共', '网页', '网站', '抓取', '爬', 'web', '页面', '列表'],
    rationale: '识别为「公共网页数据抓取」：先抓列表页拿到详情链接，再抓详情正文；每个节点的结果自动落表。',
    build: () =>
      buildFlow('公共网页抓取链路', [
        { template: 'web', name: '网页抓取（列表）', patch: { webKind: 'list', isDetail: false } },
        { template: 'web', name: '网页抓取（详情）', patch: { webKind: 'detail', isDetail: true } },
      ]),
  },
  {
    key: 'web-login',
    label: '登录站点抓取',
    keywords: ['登录', '登陆', '账号', '凭据', 'cookie', '会员'],
    rationale: '识别为「登录态站点抓取」：列表页需登录，再抓详情正文；登录凭据在节点登录配置里只存引用。',
    build: () =>
      buildFlow('登录站点抓取链路', [
        { template: 'web', name: '网页抓取（列表·需登录）', patch: { webKind: 'list', isDetail: false } },
        { template: 'web', name: '网页抓取（详情）', patch: { webKind: 'detail', isDetail: true } },
      ], { needLogin: true }),
  },
  {
    key: 'file-parse',
    label: '文件下载解析',
    keywords: ['文件', '下载', 'pdf', 'word', 'excel', '附件', '解析', '报告'],
    rationale: '识别为「文件下载解析」：下载文件 → 解析 → 字段抽取；每个节点的结果自动落表。',
    build: () =>
      buildFlow('文件下载解析链路', [
        { template: 'file', name: '文件下载', patch: { webKind: 'attachment', isDetail: false, snatchType: '[95] - 文件下载' } },
        { template: 'parse', name: '文件解析' },
        { template: 'map', name: '字段抽取' },
      ]),
  },
  {
    key: 'announcement',
    label: '公告规则采集',
    keywords: ['公告', '规则', '交易所', '投研', '标准'],
    rationale: '识别为「公告规则采集」：套用标准链路（列表→详情→AI 提取→规则处理），含质量校验 / 告警旁路。',
    build: () => makeStandardFlow(),
  },
]

export interface FlowRecommendation {
  flow: FlowDef
  rationale: string
  alternatives: { intent: string; name: string }[]
}
