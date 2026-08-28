// 采集配置域（P1-3 拆 8 域 · collect 域）
// 包含 Config（采集配置）/ ConfigParamBinding（参数绑定）/ ConfigActionLog（操作日志）/
//       EntryType（实体表）/ EntryField（表字段）
// 跨域被引用：source 域 Site.params: ConfigParamBinding[]
// 跨域引用：无（自包含）
// 无外部 import。

/** 配置 Config(configId) */
export interface Config {
  configId: string
  name: string
  topic?: string // 主题(队列)
  policy?: string // 运行策略
  sourceId?: string
  enabled: boolean
  sourceCount?: number // 绑定源数
  paramRefs?: string[] // 绑定参数
  isDetail?: boolean // 详情类配置
  isLogin?: boolean // 登陆类配置
  owner?: string
  updatedAt?: string
  url?: string
  entryTypeId?: string
  /** 入参表（旧 inEntryType）：节点的输入表绑定，与 entryTypeId（输出表）成对 */
  inEntryTypeId?: string
  domain?: string
  remark?: string
  proxyConf?: string
  coreParam?: string
  runPolicy?: string
  snatchConf?: string
  downConf?: string
  contentRule?: string
  codeRule?: string
  dedupType?: string
  templateCode?: string
  multiMode?: number
  configType?: string
  deleted?: boolean
  params?: ConfigParamBinding[]
}

export interface ConfigParamBinding {
  id: string
  paramId: string
  paramName: string
  valueShow?: string
}

export interface ConfigActionLog {
  actionId: string
  configId: string
  action: string
  target: string
  result: string
  remark?: string
  actionTime?: string
}

/** 实体/表 EntryType */
export interface EntryType {
  tableId: string
  tableName: string // 如 sense_data.TB_ZFB_COMMENT（物理表名）
  name?: string // 表显示名（业务名）
  remark?: string // 备注
  fields: EntryField[]
  rowCount?: number
  sourceId?: string
  owner?: string
  updatedAt?: string
  keyField?: string
  /** 去重方式：'source' 源内去重 / 'table' 表内去重 */
  dedupMode?: 'source' | 'table'
  state?: string
  recFlag?: string | number
  checkFlag?: string | number
  checkRule?: string
  coreParam?: string
}

export interface EntryField {
  prop: string // 属性(api json key)，如 feed_id-K1
  desc: string // 中文描述
  type: 'string' | 'text' | 'longtext' | 'url' | 'number' | 'date' | 'json'
  required: boolean
  width?: number
  preprocess?: string // 预处理清洗函数
  dedup?: boolean // 去重列
  itemId?: string
  columnName?: string
  checkRule?: string
  seq?: number
}
