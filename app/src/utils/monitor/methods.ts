// 24 个通用监控方法（1110 §4.1）的静态元数据。
//
// 三条硬约束：
//   1. 只给思路与描述模板，**不凭名称补造阈值**（阈值是业务配置，不是方法自带的默认值）；
//   2. 持久化值用稳定的 `code`，展示用 `label`；旧记录里的中文方法名通过 legacyAliases 映射回来，
//      映射不到的旧值原样展示、不丢弃（R08）；
//   3. 这里只是前端元数据，后端方法名的最终口径以 C01/C02 返回为准。

export interface MonitorMethod {
  /** 稳定标识，存进 checkConf.methods */
  code: string
  label: string
  /** 旧平台/旧记录里可能出现的中文名 */
  legacyAliases?: string[]
  /** 描述模板里的检查要点（不含阈值） */
  hint: string
}

export interface MonitorMethodGroup {
  key: string
  label: string
  methods: MonitorMethod[]
}

export const METHOD_GROUPS: MonitorMethodGroup[] = [
  {
    key: 'freshness',
    label: '更新时效',
    methods: [
      { code: 'today_landed', label: '当日正常入库', hint: '当日应入库的数据是否已经出现' },
      { code: 'ingest_delay', label: '入库延迟', hint: '从数据产生到入库的时间是否超出约定' },
      { code: 'ingest_time_distribution', label: '入库时间分布', hint: '入库时间点是否集中在约定区间' },
      { code: 'latest_data_time', label: '最新数据时间', hint: '表内最新一条数据的时间是否足够新' },
      { code: 'no_data_days', label: '连续无数据天数', hint: '连续多少天没有新增数据' },
    ],
  },
  {
    key: 'volume',
    label: '数量与趋势',
    methods: [
      { code: 'daily_count', label: '每日数据量', hint: '每日新增条数是否在合理范围' },
      { code: 'trend', label: '历史趋势', hint: '近一段时间数量走势是否异常' },
      { code: 'mom', label: '环比', hint: '与上一周期相比的增减幅度' },
      { code: 'yoy', label: '同比', hint: '与去年同期相比的增减幅度' },
      { code: 'today_vs_yesterday', label: '今日昨日差异', hint: '今日与昨日同一时点的数量差异' },
    ],
  },
  {
    key: 'completeness',
    label: '字段完整性',
    methods: [
      { code: 'required_null', label: '必填字段非空', legacyAliases: ['字段完整性'], hint: '关键字段是否存在空值' },
      { code: 'title_pattern', label: '标题三模式', legacyAliases: ['标题模式'], hint: '标题是否符合约定的三种句式（全匹配）' },
    ],
  },
  {
    key: 'validity',
    label: '字段合法性',
    methods: [
      { code: 'enum_valid', label: '枚举值合法性', legacyAliases: ['字段格式合法性'], hint: '字段取值是否都在允许集合内' },
      { code: 'date_format', label: '日期格式合法性', legacyAliases: ['字符串值监控'], hint: '日期字段能否按约定格式解析' },
    ],
  },
  {
    key: 'numeric',
    label: '数值合法性',
    methods: [
      { code: 'value_range', label: '通用数值范围', hint: '数值是否落在业务允许区间' },
      { code: 'price_anomaly', label: '价格异常波动', legacyAliases: ['价格异常波动'], hint: '相邻两次价格变动是否异常' },
      { code: 'change_rate_threshold', label: '涨跌幅阈值', hint: '涨跌幅是否超过约定阈值' },
    ],
  },
  {
    key: 'change',
    label: '数值变化',
    methods: [
      { code: 'sudden_change', label: '突变检测', hint: '数值是否出现突变（与基线比较）' },
      { code: 'consecutive_change', label: '连续变化', hint: '是否连续多个周期同向变化' },
    ],
  },
  {
    key: 'coverage',
    label: '分类覆盖',
    methods: [
      { code: 'category_coverage', label: '分品类覆盖', hint: '各品类是否都有数据' },
      { code: 'series_coverage', label: '系列覆盖', hint: '各系列是否都有数据' },
      { code: 'product_trend', label: '品名量趋势', hint: '重点品名的数量走势' },
      { code: 'coverage_rate', label: '覆盖率', hint: '实际覆盖对象占应覆盖对象的比例' },
    ],
  },
  {
    key: 'consistency',
    label: '跨表一致性',
    methods: [
      { code: 'master_child_consistency', label: '主子表字段一致性', hint: '主表与子表按真实关联键比对，不按标题 JOIN' },
    ],
  },
]

export const ALL_METHODS: MonitorMethod[] = METHOD_GROUPS.flatMap((g) => g.methods)

const LEGACY_INDEX = new Map<string, string>()
for (const method of ALL_METHODS) {
  LEGACY_INDEX.set(method.label, method.code)
  for (const alias of method.legacyAliases ?? []) LEGACY_INDEX.set(alias, method.code)
}

/** 旧中文名 / 旧 code → 稳定 code；映射不到返回原值（不丢、不替换成别的值）。 */
export function normalizeMethod(value: string): string {
  return LEGACY_INDEX.get(value) ?? value
}

/** code / 旧名 → 展示名；映射不到时原样展示，页面另标「未映射的旧方法」而不是静默替换。 */
export function methodLabel(value: string): string {
  const code = normalizeMethod(value)
  return ALL_METHODS.find((m) => m.code === code)?.label ?? value
}

/** 是否是已知方法（用来给旧值加「未映射」提示）。 */
export function isKnownMethod(value: string): boolean {
  const code = normalizeMethod(value)
  return ALL_METHODS.some((m) => m.code === code)
}

/**
 * 默认系统提示词。生成脚本时 systemPrompt 是必填（data-engine 侧 `TextSegment.from("")`
 * 会直接抛 `text cannot be null or empty`，文案与字段名无关，用户根本看不懂），
 * 所以新建表单预填一份，生成时再兜底一次：用户清空了也不至于发一个必然失败的请求。
 */
export function defaultSystemPrompt(): string {
  // 输出契约必须写死：实测模型（deepseek-v4-flash）在只给「写个脚本」时会回 markdown 说明+表格，
  // 而不是可执行代码；明确要求「唯一一个 python 代码块 + def main」后才稳定出脚本。
  return [
    '你是采集平台的数据质量检查脚本生成助手。',
    '按业务描述和给定表结构生成只读脚本：只做查询与统计，不做任何写操作。',
    '输出检查总数 checkedCount、异常数 abnormalCount、异常原因和有限样例。',
    '时间范围按业务时区 Asia/Shanghai 计算，空值与无数据分别按给定政策判定。',
    '输出格式要求（必须遵守）：只输出一个 python 代码块（以 ```python 开头、以 ``` 结尾），'
      + '代码内必须有 def main(): 函数，并在文件末尾用 if __name__ == "__main__": 调用；'
      + 'main() 里把结果以 JSON 打印到标准输出。',
    '不要在代码块之外写任何解释、标题、表格或步骤说明。',
  ].join('')
}

/**
 * 默认业务描述（1110 §4.2）。只填空表单：调用方必须先判断「用户没改过描述」再写入，
 * 否则会出现换了模型/勾了方法就把用户写好的描述覆盖掉（R09 / T01 同族问题）。
 */
export function defaultDescription(input: {
  sourceName?: string
  tableName?: string
  methods?: string[]
  window?: string
  nullPolicy?: string
  noDataPolicy?: string
}): string {
  const labels = (input.methods ?? []).map(methodLabel).filter(Boolean)
  const scope = [input.sourceName, input.tableName].filter(Boolean).join(' / ') || '当前数据表'
  const methodText = labels.length ? labels.join('、') : '数据质量'
  // 只写定性口径，不按方法名编造阈值；也不留【】占位符——
  // 模型看到未填的占位符会改写成「说明 + 片段」而不是完整脚本（实测生成失败原因）。
  const nullText =
    input.nullPolicy === 'allow'
      ? '字段值为空按允许处理、不计为异常'
      : input.nullPolicy === 'skip'
        ? '字段值为空的记录跳过、不计入检查数'
        : '字段值为空计为异常'
  const noDataText =
    input.noDataPolicy === 'alarm'
      ? '本次没有待检记录时判为异常并告警'
      : input.noDataPolicy === 'unknown'
        ? '本次没有待检记录时结论记为未知、不判为正常'
        : '本次没有待检记录时按无数据处理、不报警'
  return [
    `检查源 ${scope}，范围是 ${input.window || '当日 00:00 至当前（Asia/Shanghai 业务时区）'}。`,
    `检查内容：${methodText}。`,
    '正常标准：所选检查方法的通用含义下，数据存在且时效、分布符合平时规律即为正常；异常标准：缺少数据、超出时效或分布明显偏离即为异常。',
    `${nullText}；${noDataText}。`,
    '返回检查总数 checkedCount、异常数 abnormalCount、异常原因和有限样例；只读查询，不修改源数据。',
  ].join('\n')
}