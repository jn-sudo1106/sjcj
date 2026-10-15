// 模板配置域（旧 ai-chat-view 的 /api/poc/*，2026-10-13 起逐个迁入）。
//
// 字段名、状态口径、分页参数都 1:1 沿用旧平台实体，不在本项目里改名或合并字段
// （旧页面：src/demo/SqlTempConfig.vue + SqlTempEditModal.vue、src/demo/QuestionTempConfig.vue +
//   QuestionTempEditModal.vue，旧接口：src/demoApi/EntityApi.js）。
// 已迁入：sql 模板、表模板、自动补全、问句改写、数据索引同步、数据字典、提示词、分词
// （模板域最后一个子模块），以及基础配置域的表字段管理、向量表数据浏览、选表规则配置、向量表管理、表改写管理；
// 新兄弟模块的类型继续往这个文件里加，接口统一走 api/templateConfig.ts。

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

/**
 * 数据字典配置（旧「模板配置 → 数据字典配置」，src/demo/DataIndexList.vue + modal/DataIndexConfigEditor.vue）。
 *
 * ⚠️ 四处旧口径（EntityApi.js:34-38、104-150）：
 * · 新增 POST /poc/data-index-config、修改 POST /poc/data-index-config/update，**两个端点**（同 dic / question-dic 域）；
 * · 启停 POST /poc/data-index-config/status 参数走 **body**（旧 dataIndexConfigStatus 用的是 data，
 *   与问句改写那个走 query 的 status 不同，别混用）；
 * · 还有一条只读的下拉数据源 GET /poc/data-index-config/all-code，返回 {code,type} 裸数组；
 * · 分页筛选有四个参数：`name`（旧搜索框标题是「内容」）、`code`、`type`、`status`，全部进 body。
 * type 在这个域是**字符串**（旧列表直接展示、编码下拉把它和 code 拼在一起显示），
 * 既不是问句改写的 '10'/'11'/'20'，也不是自动补全的数字 1。
 */
export interface DataIndexConfig extends TemplateRow {
  /** 编码（字典项的键，编辑弹窗里置灰不可改） */
  code?: string | null
  /** 类型（与编码下拉的第二个字段同源，编辑弹窗里置灰不可改） */
  type?: string | null
  /** 数据内容（分页 name 筛选项匹配的就是这个字段，编辑弹窗里置灰不可改） */
  content?: string | null
  /** 数据别名 —— 本域唯一可编辑的字段 */
  alias?: string | null
  /** 数据ID（旧列表列，页面无编辑入口，更新时原样带回） */
  contentCode?: string | null
  delFlag?: string
}

/**
 * 提示词配置（旧「模板配置 → 提示词配置」，src/demo/ChatFlowStepList.vue + modal/ChatFlowStepEditor.vue）。
 *
 * ⚠️ 两处旧口径（src/demoApi/ChatFlowStepApi.js:3-8）：
 * · 菜单标题叫「提示词配置」，但旧路由是 /demo/chat-flow-step-list、端点域是 /poc/chat-flow-step、
 *   字段全是流程步骤口径（stepCode / flowCode / nextStepCode）。这是旧平台自身的命名不一致
 *   （同表模板：菜单叫表模板、端点域是 question-temp），1:1 不改名，目录与路由都用 chat-flow-step。
 * · 新增 POST /poc/chat-flow-step、修改 POST /poc/chat-flow-step/update，**两个端点**（同 dic / question-dic 域）；
 *   启停 POST /poc/chat-flow-step/status 参数走 **body**（旧 chatFlowStepStatus 用的是 axios data）。
 * 旧后端没有 chat-flow-step/copy，也没有删除端点 —— 旧列表只有「编辑」和「启用/禁用」。
 * 分页只有「状态」一个筛选项，但旧 queryParam 里还固定带一个 `name: ''`（实体没有 name 字段，
 * 后端忽略），1:1 保留这个入参形状。
 * retryCount 是旧弹窗里唯一的 a-input-number，其余全是文本框 → 语义是数字。但 186 实测响应里回过
 * 数字字符串（'2'），字段没填时回空串，所以类型收 number | string | null，弹窗负责归成数字或 undefined。
 * delFlag 旧页面从头到尾没碰过（列表不显示、弹窗不提交），这里也不声明，避免臆造后端列。
 */
export interface ChatFlowStep extends TemplateRow {
  /** 步骤编码（流程内唯一，nextStepCode 按它跳转） */
  stepCode?: string | null
  /** 流程编码 */
  flowCode?: string | null
  stepName?: string | null
  /** 引用字典编码 */
  dictCodes?: string | null
  /** 入参定义 */
  inputParams?: string | null
  /** 执行条件 */
  execCond?: string | null
  /** 步骤动作 */
  stepAction?: string | null
  /** 系统 prompt */
  systemPrompt?: string | null
  /** 模板定义（旧弹窗里唯一的文本域，提示词正文） */
  templateDef?: string | null
  /** 结果清洗规则 */
  cleanRule?: string | null
  /** 结果校验规则 */
  checkRule?: string | null
  /** 输出字段 */
  outputParams?: string | null
  /** 重试次数：旧弹窗唯一的 a-input-number，数字口径；真实响应里回过数字字符串（'2'）和空串，空串按未填处理 */
  retryCount?: number | string | null
  /** 下一步编码 */
  nextStepCode?: string | null
  /** 变量1（旧页面就这两个泛化预留字段，编辑弹窗原样可改） */
  var1?: string | null
  var2?: string | null
}

/**
 * 分词配置（旧「模板配置 → 分词配置」，src/demo/WordSegmentConfigList.vue + modal/WordSegmentConfigEditor.vue）。
 *
 * 一条 = 分词词典里的一个词条：type（词条归属类型）+ content（词条本体）+ token（分词类型），
 * 数据索引同步里 type=2「分词同步」的 syncSql 正是 `select ... as CONTENT, 'PERSON' as TYPE, 'base' as TOKEN`，
 * 三个列别名与本实体一一对应，同步就是把这张表灌进分词词典。
 *
 * ⚠️ 四处旧口径（src/demoApi/EntityApi.js:40-44、64-100）：
 * · 新增走**批量端点** POST /poc/word-segment-config/batch，body 是 `{type,content,token}` **对象数组**；
 *   旧单条新增端点（POST /poc/word-segment-config）只在旧弹窗的「新增」分支里用到，而旧列表根本没有
 *   触发入口（showAdd 没绑到任何按钮，是死代码），所以本模块不迁单条新增；
 * · 修改 POST /poc/word-segment-config/update（body 带 id）；
 * · 启停 POST /poc/word-segment-config/status，参数走 **body**（旧 wordSegmentConfigStatus 用的是 axios data，
 *   与 question-dic 的 query 不同，别混用）；
 * · 分页四个筛选都在 body —— `name`（旧搜索框标题是「内容」，匹配 content）、`type`、`token`、`status`。
 * type / token 是**字符串字面量**（186 实测真实行：ORGANIZATION / indicatorname / PERSON，token 为 base），
 * 既不是问句改写的 '10'/'11'/'20'，也不是数据索引同步的数字 0/1/2 —— 旧页面三个字段都是自由文本输入框。
 * 分页契约在 186 POC 服务实测（2026-10-14）：信封 {code,msg,count,data}，共 434 条，
 * status 回的是**数字** 0（与 TemplateRow 声明的字符串不一致），比较一律走 String(row.status)。
 * delFlag 后端没回（旧页面也没碰过），这里不声明，避免臆造字段。
 */
export interface WordSegmentConfig extends TemplateRow {
  /** 类型（词条归属：PERSON / ORGANIZATION / indicatorname 这类字面量） */
  type?: string | null
  /** 内容（词条本体，分页 name 筛选项匹配的就是这个字段） */
  content?: string | null
  /** 分词类型（旧列标题就叫「分词类型」，实测值 base） */
  token?: string | null
}

/** 批量新增的单行入参（POST /poc/word-segment-config/batch 的数组元素，旧页面只给这三段） */
export interface WordSegmentBatchItem {
  type: string
  content: string
  token: string
}

/**
 * 参数设置（旧 ai-chat-view「系统配置 → 参数设置」，src/system/config/ConfigIndex.vue + modules/ConfigEditForm.vue，
 * 端点域 /poc/system/config，1015 迁入问数配置组「问数系统配置」页内 tab）。
 *
 * ⚠️ 三处旧口径（src/api/system/config.js）：
 * · 分页 POST /poc/system/config/page，body {pageNo,pageSize,configKey,configName,configType}，
 *   旧 queryParam 里 configType 恒为 undefined（页面没有该筛选项，JSON 序列化后不上送）；
 * · 详情 GET /poc/system/config/{configId} —— id 走**路径段**，旧弹窗点「修改」先查详情再回填；
 * · 新增与修改是同一个端点 POST /poc/system/config（带 id 即更新），但旧列表没有新增/删除/导出/刷新缓存入口
 *   （对应按钮全部被注释掉），所以本模块只迁 分页 + 详情 + 修改 三个操作。
 * configType 是「是否内置参数」'Y' / 'N'（旧弹窗默认 'Y'）；旧页面把字典数组传成了空数组，
 * 单选框实际渲染不出选项，迁移时按旧语义补 是(Y)/否(N) 两个选项（见页面偏差说明）。
 */
export interface SystemConfigParam extends TemplateRow {
  /** 参数编码 */
  configKey?: string | null
  /** 参数名称 */
  configName?: string | null
  /** 参数值 */
  configValue?: string | null
  /** 是否内置参数：'Y' / 'N' */
  configType?: string | null
  /** 备注 */
  remark?: string | null
}

/**
 * 页面配置（旧 ai-chat-view「系统配置 → 页面配置」，src/system/config/SysPageConfigList.vue + modules/SysPageConfigEditor.vue，
 * 端点域 /poc/system/page-config，1015 迁入「问数系统配置」页内 tab）。
 *
 * ⚠️ 四处旧口径（src/api/system/pageConfig.js，全部 POST + JSON body）：
 * · 分页 /page 的旧 queryParam 固定带 name:''/type:''/status:''（类型/内容两个搜索框在旧页面被注释掉，
 *   参数仍然照发，后端忽略空串），1:1 保留入参形状；
 * · 新增只有**批量端点** /batch，body 是 `[{content}]` 对象数组（旧弹窗的单条 add 分支已注释、无入口，不迁）；
 * · 修改 /update（body 带 id，旧页面把整行原样发回去，迁移后只发表单字段，见页面偏差说明）；
 * · 启停 /status，参数走 **body**（同 word-segment-config，与 question-dic 的 query 不同）。
 * 列表列只有 id/内容/状态/创建时间/修改时间，type 实体里有字段但页面从不展示、也从不编辑。
 */
export interface SysPageConfig extends TemplateRow {
  /** 类型：旧页面（列与搜索框）全部注释掉，仅实体残留 */
  type?: string | null
  /** 内容 */
  content?: string | null
}

/** 页面配置批量新增的单行入参（POST /poc/system/page-config/batch 的数组元素，旧页面只取每行逗号前的 content） */
export interface SysPageConfigBatchItem {
  content: string
}

/** 数据字典「编码」下拉的选项（GET /poc/data-index-config/all-code 返回的裸数组元素） */
export interface DataIndexCodeOption {
  code?: string | null
  type?: string | null
  [key: string]: unknown
}

/**
 * 表字段管理的表头配置（旧「基础配置 → 表字段管理」src/demo/EntityConfig.vue 的 entityType，
 * 1015 迁入问数配置组「基础配置」页内 tab）。
 *
 * ⚠️ 三处旧口径（src/demoApi/EntityApi.js:4-6）：
 * · 表下拉 GET /poc/database/entry-list?name=（与表模板「使用表范围」同一端点，选中项按 entryTypeId 取值）；
 * · 字段列表 GET /poc/database/table-info?tableId=，回 {code,data:[...]} 裸数组；
 * · 保存 POST /poc/database/config，body {entityType, entityItems} **整表覆盖**，成功信封 code===0。
 * 下拉行里带回 aiComment/aiRule/aiDesc/aliasName/useAlias（useAlias 是数字 0/1），选中后回填表头表单。
 */
export interface EntityConfigType {
  entryTypeId?: number | string
  tableName?: string | null
  /** 表别名 */
  aiComment?: string | null
  /** 表描述 */
  aiDesc?: string | null
  /** 校验规则 */
  aiRule?: string | null
  /** 生产表名称 */
  aliasName?: string | null
  /** 使用生产名称：后端存 0/1，页面开关用 boolean */
  useAlias?: number | boolean
  [key: string]: unknown
}

/** 「使用表范围」/「选择表」下拉选项（旧 tableList → GET /poc/database/entry-list），行内即表头配置形状 */
export interface PocTableEntry extends EntityConfigType {
  tableName: string
  /** 数据表所属类型名；旧下拉把选项渲染成 `表名【类型名】` */
  typeName?: string | null
}

/** 表字段管理的字段行（旧 entityItems，GET /poc/database/table-info 返回、保存时整表回传） */
export interface EntityConfigField {
  itemId?: number | string
  /** 字段英文名 */
  itemCode?: string | null
  /** 字段中文名 */
  itemName?: string | null
  /** 生产字段 */
  aliasName?: string | null
  /** 数据类型（只读列） */
  dataType?: string | null
  /** 字段描述 */
  aiComment?: string | null
  /** 校验规则 */
  aiRule?: string | null
  /** 排序 */
  aiSeq?: number | null
  /** 指标类型：w 维度 / z 指标 / date 日期 / other 其他 */
  aiIndexType?: string | null
  /** 业务类型：int / float / date / text / url / geo */
  aiBusinessType?: string | null
  /** 业务类型格式：时点 total / 流量 increment / yyyyMMdd / yyyy-MM-dd… */
  aiBusinessFormat?: string | null
  /** 抽取规则类型：1 实体识别 / 2 正则 */
  chooseType?: number | string | null
  /** 规则内容 */
  chooseRule?: string | null
  /** 映射类型：1 编号 / 2 别名 */
  mappingType?: number | string | null
  /** 映射字段 */
  mappingColumn?: string | null
  /** 下钻sql配置 */
  subSql?: string | null
  /** 是否训练：'1' 是 / '0' 否 */
  trainingData?: string | number | null
  /** 数据索引：后端存 0/1，页面 checkbox 用 boolean（dataIndexFlag） */
  dataIndex?: number | null
  /** 向量索引：页面已无该列，保存时仍按旧口径原样回传 */
  vector?: number | null
  /** 行主键（旧 scopedSlots 行定位用，值=itemId），随旧版整行回传 */
  key?: number | string
  /** 序号列（页面派生，旧版也随整行回传） */
  no?: number
  /** 数据索引开关（页面 checkbox 绑定，保存前回写成 dataIndex 0/1） */
  dataIndexFlag?: boolean
  /** 向量索引开关（页面派生，保存前回写成 vector 0/1） */
  vectorFlag?: boolean
  [key: string]: unknown
}

/** 保存表字段配置的 body（POST /poc/database/config） */
export interface EntityConfigPayload {
  entityType: EntityConfigType
  entityItems: EntityConfigField[]
}

/**
 * 向量表配置行（旧「基础配置 → 向量表数据浏览」的下拉数据源，GET /poc/vector/config/all?name=）。
 * 旧页面只用到 name（下拉值、查询入参 type）与 comment（拼进选项文案 `名称[备注]`）；
 * 其余字段是旧「向量表管理」列表（VectorTableList.vue 的 columns）的口径，浏览页不读，按旧字段名留着。
 */
export interface VectorTableOption {
  id?: number | string
  /** 向量表名称 —— 选中后作为查询入参 type 发给后端 */
  name: string
  /** 向量表备注 */
  comment?: string | null
  /** 源表名 */
  sourceTable?: string | null
  /** 匹配度 */
  matchDegree?: number | string | null
  /** 字典表类型 */
  dataIndexCode?: string | null
  /** 最近同步时间 */
  lastSync?: string | null
  updateTime?: string | null
  [key: string]: unknown
}

/** 向量表数据浏览的查询入参（POST /poc/vector/data，旧 queryParam 原样：input/type/pageSize/pageNo） */
export interface VectorDataQuery {
  /** 文本搜索框内容 */
  input: string
  /** 选中的向量表名称（VectorTableOption.name） */
  type: string
  pageSize: number
  pageNo: number
}

/**
 * 向量表配置行（旧「基础配置 → 向量表管理」，1015 迁入，端点域 /poc/vector/config）。
 * 列形状取自旧 VectorTableList.vue 的 columns 与旧弹窗 VectorMapping.vue 的 config 表单。
 * ⚠️ 旧删除端点 POST /poc/vector/delete 的 body 是 `{type: 向量表名称}` —— **按 name 删，不按 id**（旧平台独有口径，1:1 保留）。
 * 弹窗没有编辑入口的列（sourceTableId / preRule / dataClearRule / lastSync）在旧版编辑保存时随整行回传
 * （旧 `this.form.config = record` 是引用整个列表行），这里同样整行带回，见 VectorConfigEditDialog 的 passthrough。
 */
export interface VectorTableConfig extends TemplateRow {
  /** 向量表名称（旧新建时自动填 `源表名_VECTOR`，可改） */
  name: string
  /** 向量表备注（旧选源表时按 typeName 自动填充） */
  comment?: string | null
  /** 源表名（选源表时自动填充，旧口径剥掉 'sense_data.' 前缀） */
  sourceTable?: string | null
  /** 源表 id = database/entry-list 行的 entryTypeId（旧表单字段 config.sourceTableId，编辑时靠它拉源表字段） */
  sourceTableId?: number | string | null
  /** 匹配度（旧弹窗数字框 0~1、精度 2，新建默认 '0.60'） */
  matchDegree?: number | string | null
  /** 字典表类型（必填，旧弹窗是 textarea） */
  dataIndexCode?: string | null
  /** 召回数（最小 1，新建默认 1） */
  returnNum?: number | string | null
  /** 预处理规则（选填） */
  preRule?: string | null
  /** 数据清洗规则（选填） */
  dataClearRule?: string | null
  /** 最近同步时间（同步端点回写，列表只读列） */
  lastSync?: string | null
}

/**
 * 向量表列映射行（旧弹窗 form.items：GET /poc/vector/mapping/info?configId= 回显、保存整份随 body 回传）。
 * 旧弹窗固定三行 —— type '1' 编码 / '2' 内容 / '3' 别名（新建即预置三行空映射，可以删）。
 */
export interface VectorMappingItem {
  id?: number | string
  configId?: number | string
  /** 列类型：'1' 编码 / '2' 内容 / '3' 别名 */
  type?: string
  /** 源列名（下拉源为源表字段列表，值=itemCode） */
  sourceColumn?: string | null
  /** 改写后列名 */
  targetColumn?: string | null
  /** 取值列 */
  valueColumn?: string | null
  /** 改写规则 */
  rule?: string | null
  [key: string]: unknown
}

/** 向量表配置保存的 body（POST /poc/vector/config，config.id 有值即更新） */
export interface VectorConfigPayload {
  config: VectorTableConfig
  items: VectorMappingItem[]
}

/**
 * 选表规则配置（旧「基础配置 → 选表规则配置」，1015 迁入，端点域 /poc/match-table-config）。
 * 一条 = 一张表的选表规则：问句选表（text_selection）按 rule 里的正则匹配问句，向量选表（vector_selection）走向量检索。
 *
 * 字段形状取自 186 POC 服务真实行（2026-10-15 抓样，共 2 条：YJZB_HY_GHKJ / YJZB_HY_JX，都是 text_selection + 禁用）。
 *
 * ⚠️ status 真实回的是**数字** 1（与 TemplateRow 声明的字符串不一致），比较一律走 String(row.status)；
 * 启停端点本身收的是字符串 '0'/'1'（旧列表 changeStatus(row.id, '1') 原样），两端口径不同照旧。
 * ⚠️ 「表名称」搜索框上送的参数名是 **name**，而实体列是 tableName（旧 MatchTableConfigList.vue:11、88-98）
 * —— 旧平台自身就是这两个名字不一致，1:1 保留；实测按 name=表名片段查询确实只回那一条。
 * ⚠️ 分页的 status 筛选**后端不生效**：status 传 '0' / '1' / 数字 / 不传，四种请求都回全量 2 条（2026-10-15 实测）。
 * 旧平台同样是这个行为，所以 1:1 照迁、不做前端兜底过滤 —— 界面上的「状态」下拉目前只是个占位条件。
 * ⚠️ 旧列表把 selectionType 渲染成「text_selection → 问句选表，**其余一律向量选表**」，
 * 即后端回未知码值时会被静默标成向量选表；这里按本域 options.ts 的口径改成匹配不上留空。
 */
export interface MatchTableConfig extends TemplateRow {
  /** 表名称（列展示与保存都用这个字段名） */
  tableName?: string
  /** 表 ID（旧页面不展示、弹窗也不能改，编辑时整行原样回传，见 MatchTableConfigEditDialog 的 passthrough） */
  tableId?: number
  /** 选表类型：'text_selection' 问句选表 / 'vector_selection' 向量选表 */
  selectionType?: string
  /** 旧平台遗留的粗分类（真实行恒为 '0'），列表与弹窗都没有入口，保存时整行带回 */
  type?: string
  /** 匹配规则（旧弹窗是文本域，列表整列展示；真实行是一串正则） */
  rule?: string
  /** 逻辑删除位（真实行恒为 '0'），保存时整行带回 */
  delFlag?: string
}

/**
 * 表改写配置（旧「基础配置 → 表改写管理」，1015 迁入，端点域 /poc/replace-table-config）。
 * 一条 = 一张表在出 SQL 时整体换成另一张表；替换类型目前只有 unionall 一个码值（旧弹窗下拉的唯一选项）。
 *
 * 字段形状取自 186 POC 服务真实行（2026-10-15 只读抓样，全库 2 条：YJZB_HY_JX → YJZB_HY_GHKJ、
 * YJZB_HY_GHKJ → YJZB_HY_JX，两张表互相对换，都是 unionall + 禁用）。
 *
 * ⚠️ status 真实回的是**数字** 1（与 TemplateRow 声明的字符串不一致），比较一律走 String(row.status)；
 * 启停端点收的是字符串 '0'/'1'（旧列表 changeStatus(row.id, '1') 原样），两端口径不同照旧。
 * ⚠️ 与选表规则配置**不同**：本域分页的 status 筛选后端**是生效的**（2026-10-15 实测 '0' 回 0 条、'1' 回全量 2 条，
 * 数字与字符串都认），所以状态条件在这里不是占位控件。
 * ⚠️ 「表名称」搜索框上送的参数名是 **name**，实体列是 tableName（旧 ReplaceTableConfigList.vue:11、90-98）
 * —— 与选表规则配置同款命名不一致，1:1 保留；实测按 tableName 模糊筛，但**大小写敏感**（name=JX 回 1 条、name=jx 回 0 条）。
 * ⚠️ 旧页面没有「替换表」的查询入口，实测把 replaceTableName / tableName 当筛选参数上送后端一律忽略（回全量）。
 * ⚠️ delFlag（真实行恒为 '0'）列表与弹窗都没有入口，编辑保存时整行带回，见 ReplaceTableConfigEditDialog 的 passthrough。
 */
export interface ReplaceTableConfig extends TemplateRow {
  /** 表名称（被改写的表，列展示与保存都用这个字段名） */
  tableName?: string
  /** 替换类型：旧平台只有 'unionall' 一个码值 */
  replaceType?: string
  /** 替换表（改写成哪张表，旧弹窗输入框标签是「替换表名称」） */
  replaceTableName?: string
  /** 逻辑删除位（真实行恒为 '0'），保存时整行带回 */
  delFlag?: string
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
