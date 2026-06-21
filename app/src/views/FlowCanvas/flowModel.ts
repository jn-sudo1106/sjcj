// 流程画布数据模型 —— 忠实移植自静态原型 prototypes/collect-config-center.html
// 节点配置、连线（子步骤）配置、节点模板与图标/样式辅助函数均与原型口径一致。

export type NodeKind = 'node' | 'decision' | 'parallel'

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
  inmap: [string, string, string][]
  params: [string, string, string][]
  output: [string, string, string][]
  collectCfg?: CollectConfig
}

/** 采集类节点的可编辑配置（源 / 表 / 登录 / 定时四区，对齐新建源四步与源详情） */
export interface CollectConfig {
  snatchType: string
  url: string
  sourceName: string
  category: string
  dirId: string
  useProxy: boolean
  resume: boolean
  tags: string
  configMode: 'new' | 'existing'
  configId: string
  outputTable: string
  inputParams: string[]
  isDetail: boolean
  isLogin: boolean
  needLogin: boolean
  loginUrl: string
  account: string
  credentialRef: string
  scheduleType: string
  scheduleTime: string
  weekdays: number[]
  cron: string
}

// 节点配置种子（key = 节点 id）。插入新节点时克隆对应模板生成新 key。
export const NODE_CONFIGS: Record<string, NodeConfig> = {
  'web-list': {
    title: '公告列表抓取', sub: '[90] 网页抓取 · 源配置', status: '可试跑', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/announcements?page=${page}'], ['源名称', '交易所公告列表 - A 股'], ['源分类', '公告 / 交易所 / 列表'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['本次使用配置', '配置 81909'], ['源标签', '公告、A股、列表页']],
    inmap: [['page', '序列参数', '1..20'], ['publish_date', '动态日期', '$CUR_DATA,-1']],
    params: [['page', 'sequence', '1..20'], ['publish_date', 'date', '$CUR_DATA,-1,yyyy-MM-dd']],
    output: [['detail_url', 'url', '详情页子步骤入口'], ['title', 'string', '公告标题'], ['publish_time', 'date', '发布时间']],
    collectCfg: {
      snatchType: '[90] - 网页抓取', url: 'https://example.com/announcements?page=${page}', sourceName: '交易所公告列表 - A 股',
      category: '/公告/交易所/列表', dirId: '9009245', useProxy: false, resume: true, tags: '公告, A股, 列表页',
      configMode: 'new', configId: '81909', outputTable: '2101001', inputParams: ['p-date'],
      isDetail: false, isLogin: false, needLogin: false, loginUrl: '', account: '', credentialRef: '',
      scheduleType: '交易日定时', scheduleTime: '08:30', weekdays: [1, 2, 3, 4, 5], cron: '30 8 * * 1-5',
    },
  },
  'web-detail': {
    title: '公告详情抓取', sub: '[90] 网页抓取 · 子步骤产物', status: '可试跑', planned: false, collect: true,
    base: [['本次使用配置', '配置 81908'], ['失败策略', '跳过并记录'], ['启用状态', '启用'], ['原始文件', '保存 HTML/PDF']],
    fields: [['父步骤', '公告列表抓取'], ['去重', '由列表表去重'], ['超时', '30s'], ['重试', '2']],
    inmap: [['detail_url', '← 列表抓取.detail_url', '上一步属性'], ['retry', '常量', '2']],
    params: [['detail_url', 'from parent', '列表页输出'], ['retry', 'number', '2']],
    output: [['content', 'longtext', '正文'], ['attachments', 'json', '附件列表'], ['source_file', 'url', '原始文件']],
    collectCfg: {
      snatchType: '[90] - 网页抓取', url: 'https://example.com/detail/${detail_url}', sourceName: '公告详情抓取',
      category: '/公告/交易所/详情', dirId: '9009245', useProxy: false, resume: true, tags: '公告, 详情页',
      configMode: 'existing', configId: '81908', outputTable: '2101001', inputParams: [],
      isDetail: true, isLogin: true, needLogin: true, loginUrl: 'https://example.com/login', account: 'research_***', credentialRef: 'cred-zfb',
      scheduleType: '每天', scheduleTime: '09:00', weekdays: [1, 2, 3, 4, 5, 6, 7], cron: '0 9 * * *',
    },
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
  },
  check: {
    title: '质量校验', sub: '[300] 校验类 · 质量门禁', status: '异常分流', planned: false,
    base: [['校验对象', 'announcement_event'], ['完整性规则', '主体/时间/事项必填'], ['去重键', 'source_url + publish_time'], ['异常去向', '回详情抓取或人工队列']],
    fields: [['字段完整率', '>= 95%'], ['重复率', '<= 1%'], ['前处理函数', 'trim + normalize_date'], ['阻断策略', '高风险阻断发布']],
    inmap: [['rows', '← AI提取.* / 详情.*', '待校验数据行'], ['risk_level', '← 规则处理.risk_level', '风险等级']],
    params: [['required_fields', 'list', 'company,event_type,publish_time'], ['dedupe_key', 'expr', 'source_url + publish_time']],
    output: [['quality_score', 'number', '质量分'], ['error_rows', 'json', '异常明细'], ['pass', 'boolean', '是否通过']],
  },
  output: {
    title: '落表输出', sub: '输出类 · 数据中心落表', status: 'P1 · 以数据中心为事实源', planned: false,
    base: [['输出表', 'announcement_event'], ['字段 schema', '按表配置读取'], ['主键 / 去重键', 'source_url + publish_time'], ['写入策略', '数据中心 API 落表']],
    fields: [['失败策略', '阻断 + 运行记录'], ['外部引用', 'entry_type_id 2102157'], ['指标引用', '高风险公告数'], ['能力状态', '新前端扩展节点']],
    inmap: [['unique_rows', '← 去重处理.unique_rows', '待写入数据'], ['quality_score', '← 校验.quality_score', '质量分']],
    params: [['entry_type_id', 'number', '2102157'], ['write_mode', 'enum', 'upsert']],
    output: [['data_id', 'string', '数据中心数据 ID'], ['entry_type_id', 'number', '输出表 ID'], ['write_status', 'enum', 'C/E']],
  },
  metric: {
    title: '指标引用', sub: '输出类 · 指标中心引用', status: 'P1 · 跳转指标中心', planned: false,
    base: [['指标数据集', 'announcement_event_dataset'], ['指标', '高风险公告数'], ['编辑入口', '指标中心轻编辑器'], ['引用方式', '只引用，不在画布编辑口径']],
    fields: [['结果回溯', 'dataset -> table -> source -> task'], ['负责人', '数据运营'], ['状态', '已发布'], ['能力状态', '新前端扩展节点']],
    inmap: [['entry_type_id', '← 落表输出.entry_type_id', '来源表'], ['data_id', '← 落表输出.data_id', '结果明细']],
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
}

// 连线 = 子步骤编排（item/next），字段对齐数据中心步骤详情（手册 image43）。
export interface EdgeConfig {
  title: string
  sub: string
  status: string
  rows: [string, string][]
  context: string[]
  outcols: string
  enabled: boolean
}

/** 旁路分支种子（决定旁路节点纵向锚点与连线两端） */
export interface BranchSeed {
  id: string
  side: 'left' | 'right'
  rowAnchor: string
  edgeFrom: string
  edgeTo: string
}

/** 流程定义（可序列化，用于保存 / 加载 / 多流程切换） */
export interface FlowDef {
  id: string
  name: string
  version: string
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  edges: Record<string, EdgeConfig>
  updatedAt: string
}

export const EDGE_CONFIGS: Record<string, EdgeConfig> = {
  'web-list': {
    title: '列表 → 详情 · 步骤编排', sub: '子步骤 81909-详情 (39368)', status: '已启用',
    rows: [
      ['适用源', '-1（该配置的所有源）'],
      ['步骤输入表', '[2102157] zfb_comment_filters'],
      ['步骤名称', '81909-详情'],
      ['本步骤使用配置', '[81908] 支付宝-基金评论信息_copy'],
      ['步骤输出表', '[2100157] zfb_comment'],
      ['任务 URL 来源字段', '[K1] 标题 - string（上一步属性）'],
      ['任务 URL 规则', '$VAL$（默认从字段取，支持动态函数）'],
      ['步骤执行条件', 'STATE = "C"'],
      ['失败动作', '跳过并记录'],
    ],
    context: ['K1 标题 → title', 'K2 正文 → content'],
    outcols: '（请选择列）',
    enabled: true,
  },
}

export function defaultEdgeConfig(): EdgeConfig {
  return {
    title: '步骤编排', sub: '子步骤 · 待配置', status: '待配置',
    rows: [
      ['适用源', '-1（该配置的所有源）'],
      ['步骤输入表', '上一步输出表'],
      ['步骤名称', '新步骤'],
      ['本步骤使用配置', '待选择 configId'],
      ['步骤输出表', '待选择'],
      ['任务 URL 来源字段', '上一步属性'],
      ['任务 URL 规则', '$VAL$'],
      ['步骤执行条件', "STATE = 'C'"],
      ['失败动作', '跳过并记录'],
    ],
    context: [],
    outcols: '（请选择列）',
    enabled: true,
  }
}

// 模板 → 节点配置 key
export const TEMPLATE_TO_NODE: Record<string, string> = {
  web: 'web-list', file: 'web-detail', python: 'web-list', parse: 'file-parse', ocr: 'ocr',
  ai: 'ai-extract', map: 'field-map', clean: 'clean', dedupe: 'dedupe', check: 'check',
  rule: 'rule', 'rule-trace': 'rule', output: 'output', metric: 'metric', mail: 'mail',
  alert: 'alert', decision: 'decision', parallel: 'parallel', custom: 'custom',
}

// 抓取类型选项（统一来源；NodeInspector 与种子配置共用）
export const SNATCH_TYPES = ['[90] - 网页抓取', '[95] - 文件下载', '[150] - OCR 识别', '[155] - AI 提取', '[170] - Python 抓取']

// 模板 → 默认抓取类型（新插入采集节点用）
export const TEMPLATE_TO_SNATCH: Record<string, string> = {
  web: '[90] - 网页抓取',
  file: '[95] - 文件下载',
  python: '[170] - Python 抓取',
  ocr: '[150] - OCR 识别',
  ai: '[155] - AI 提取',
}

// 左侧节点库分组
export type Pill = 'p1' | 'p2' | 'plan'
export interface LibItem { template: string; code: string; name: string; desc: string; pill: Pill; planned?: boolean }
export interface LibGroup { title: string; items: LibItem[] }

export const LIB_GROUPS: LibGroup[] = [
  { title: '采集类', items: [
    { template: 'web', code: '90', name: '网页抓取', desc: '源 URL、配置、子步骤', pill: 'p1' },
    { template: 'file', code: '95', name: '文件下载', desc: '附件、原始文件、入库', pill: 'p1' },
    { template: 'python', code: '170', name: 'Python 抓取', desc: '青龙脚本、待确认权限', pill: 'p2' },
  ] },
  { title: '解析结构化类', items: [
    { template: 'parse', code: 'PARSE', name: '文件解析', desc: 'PDF/Word/Excel/图片解析', pill: 'p1' },
    { template: 'ocr', code: '150', name: 'OCR 识别', desc: '待执行器确认', pill: 'plan', planned: true },
    { template: 'ai', code: '155', name: 'AI 提取', desc: '待执行器确认', pill: 'plan', planned: true },
    { template: 'map', code: 'MAP', name: '字段抽取 / 结构化映射', desc: '文本字段到目标 schema', pill: 'p1' },
  ] },
  { title: '清洗类', items: [
    { template: 'clean', code: 'CLEAN', name: '字段清洗 / 格式转换', desc: '函数工具、空值、单位、日期', pill: 'p1' },
    { template: 'dedupe', code: 'DEDUP', name: '去重处理', desc: '去重字段、重复策略', pill: 'p1' },
  ] },
  { title: '校验类', items: [
    { template: 'check', code: '300', name: '完整性 / 阈值校验', desc: '质量门禁、异常流转', pill: 'p1' },
  ] },
  { title: '规则类', items: [
    { template: 'rule', code: 'RULE', name: '规则处理', desc: '规则组、表达式、配置', pill: 'p1' },
    { template: 'rule-trace', code: 'TRACE', name: '规则 Trace', desc: '命中、过滤、失败原因', pill: 'p1' },
  ] },
  { title: '输出类', items: [
    { template: 'output', code: 'TABLE', name: '落表输出', desc: '输出表、schema、去重键', pill: 'p1' },
    { template: 'metric', code: 'M', name: '指标引用', desc: '跳转指标中心，不编辑口径', pill: 'p1' },
  ] },
  { title: '通知类', items: [
    { template: 'mail', code: '400', name: '提取数据发邮件', desc: '待执行器确认', pill: 'plan', planned: true },
    { template: 'alert', code: 'ALERT', name: '异常告警', desc: '失败、阻断、恢复通知', pill: 'p2', planned: true },
  ] },
]

// 新建节点弹窗里的模板选项
export const MODAL_TEMPLATES: { template: string; name: string }[] = [
  { template: 'web', name: '网页抓取' }, { template: 'file', name: '文件下载' }, { template: 'parse', name: '文件解析' },
  { template: 'clean', name: '字段清洗' }, { template: 'dedupe', name: '去重处理' }, { template: 'check', name: '质量校验' },
  { template: 'rule', name: '规则处理' }, { template: 'output', name: '落表输出' }, { template: 'metric', name: '指标引用' },
  { template: 'ocr', name: 'OCR 识别' }, { template: 'ai', name: 'AI 提取' }, { template: 'python', name: 'Python 抓取' },
  { template: 'mail', name: '提取数据发邮件' }, { template: 'alert', name: '异常告警' }, { template: 'custom', name: '自定义节点' },
]

// 模板 → 节点类型名（新插入节点的默认节点名称 / 源名称）
export const TEMPLATE_TO_NAME: Record<string, string> = {
  ...Object.fromEntries(LIB_GROUPS.flatMap((g) => g.items.map((it) => [it.template, it.name]))),
  ...Object.fromEntries(MODAL_TEMPLATES.map((t) => [t.template, t.name])),
}

// ---------- 辅助函数（移植自原型） ----------
export function compactSub(sub: string): string {
  return String(sub || '').replace(/^\[[^\]]+\]\s*/, '')
}

export function isDecision(cfg: NodeConfig): boolean {
  return cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)
}

export function isParallel(cfg: NodeConfig): boolean {
  return cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)
}

export function iconFor(cfg: NodeConfig): string {
  const sub = cfg.sub || ''
  if (sub.indexOf('[90]') >= 0) return '90'
  if (sub.indexOf('[95]') >= 0) return '95'
  if (sub.indexOf('[150]') >= 0) return '150'
  if (sub.indexOf('[155]') >= 0) return '155'
  if (sub.indexOf('[300]') >= 0) return '300'
  if (sub.indexOf('[400]') >= 0) return '400'
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

export function cloneConfig(cfg: NodeConfig): NodeConfig {
  return JSON.parse(JSON.stringify(cfg))
}
