// 函数工具的示例清单 —— 逐条搬自旧 data-view `src/page/install/FunctionBuild.vue` 的
// b1 / b2 / b3 / b4 / b5 五个数组（名字、示例值、表达式、说明一个字都没改）。
//
// 五个分组对应旧页面左侧 a-tabs 的五个 pane：
//   核心结构(b1) / 自定义函数(b2) / 字符串操作(b3) / 数学函数(b4) / 系统常量(b5)
// 判据别搞混：旧模板按 key="1".."5" 顺序渲染，而 data 里的定义顺序是 b1/b4/b3/b2/b5 ——
// 渲染顺序以 TABS 为准，这里已经把顺序按页面真实呈现排好了。

export interface FnPreset {
  /** 按钮标题 */
  name: string
  /** 点下去填进「当前值[value]」的示例值（注意个别是数字：b4 里有 demo: -123 / 121） */
  demo: string | number
  /** 点下去填进「表达式」的内容 */
  exp: string
  /** 填进「函数说明」的文案 */
  desc: string
  /** 可选：点下去覆盖「上下文[Map]」的 JSON 串；缺省时页面自动填 {"value": demo} */
  env?: string
}

export interface FnGroup {
  key: string
  label: string
  items: FnPreset[]
}

/** 核心结构 */
const CORE: FnPreset[] = [
  {
    demo: 'vvv',
    env: "{'a': 1, 'b': 2, 'value': 'vvv'}",
    name: '上下文环境使用[重要]',
    exp: "a + b + '字符串' + value",
    desc: '表示：上下文中 a加b 再加上 固定字符串 + value的值(vvv)',
  },
  {
    demo: '600001',
    name: 'if-else 结构',
    exp: "if(string.startsWith(value, '600')) { return value + '.sh';} else {  return value + '.sz'; }",
    desc: 'IF-ELSE 结构的脚本',
  },
  {
    demo: 'abcdef',
    name: '支持多函数多层嵌套操作',
    exp: "string.length(subIndex(subIndex(value, 'c', 1, -1), 'f', 1, 1 ))",
    desc: 'IF-ELSE 结构的脚本',
  },
  {
    demo: 'ab',
    name: '支持 and(&&) or(||) not(!)',
    exp: "!string.startsWith(value, 'a') && string.endsWith(value, 'b')",
    desc: 'and(&&) or(||) not(!)',
  },
]

/** 自定义函数 */
const CUSTOM: FnPreset[] = [
  {
    demo: 'abcdefg',
    name: 'replace(v1;;v2) -- 批量清除',
    exp: "replace('a,,c,,f')",
    desc: '[自定义]清除多个指字字符，同时清理a和c字符,多个串以 ,, 分隔',
  },
  {
    demo: 'https://detail.tmall.com/item.htm?id=588173717372&skuId=4611686606601105276',
    name: 'param(v1) -- 删除参数',
    exp: "param('id')",
    desc: '[自定义]清除url后的某个参数',
  },
  {
    demo: 'aaaaaaabbbc',
    name: 'empty() -- 清空',
    exp: 'empty()',
    desc: '[自定义]返回空串',
  },
  {
    demo: '',
    name: 'date(v1) -- 时间格式化',
    exp: "date('yyyy-MM-dd')",
    desc: '[自定义]不依赖入参，固生当前时间并按要求格式化',
  },
  {
    demo: '0.21亿',
    name: 'wan(v1) -- 亿万转换',
    exp: "wan('1.1亿')",
    desc: '[自定义]将有`亿`有`万`的数据统一处理成以`万`为单位的值',
  },
  {
    demo: 'aaaaa',
    name: 'substr(v1, v2) -- 子串',
    exp: 'substr(0, 2)',
    desc: '[自定义]简易版本的截取子串操作',
  },
  {
    demo: 'abcdefg',
    name: 'subIndex(v1, v2, v3, v4) -- 获取子串',
    exp: "subIndex(value, 'c', 1, -1)",
    desc: '[自定义]模拟mysql substring_index函数',
  },
  {
    demo: '1582992000000',
    name: 'timestamp(v1, v2) -- 时间戳转换',
    exp: "timestamp('1582992000000', 'yyyy-MM-dd')",
    desc: '[自定义]将long型的时间戳转成时间后以指定的格式输出',
  },
]

/** 字符串操作 */
const STRING: FnPreset[] = [
  {
    demo: 'cc',
    env: "{'v1':'abcd', 'v2': 'ab', 'value': 'cc'}",
    name: 'string.contains(s1,s2) 字符串包含',
    exp: 'string.contains(v1, v2)',
    desc: '判断 s1 是否包含 s2,返回 Boolean',
  },
  { demo: 'abcd', env: '', name: 'string.length(s1) 字符串长度', exp: 'string.length(value)', desc: '求字符串长度,返回 Long' },
  {
    demo: 'abcd',
    env: '',
    // 「长度」是旧文案里的手误（本条其实是 startsWith），照抄不改，免得对不上旧页面的截图
    name: 'string.startsWith(s1,s2) 长度',
    exp: "string.startsWith(value, 'a')",
    desc: '以某字符串开始, 返回 Boolean',
  },
  {
    demo: 'abcd',
    env: '',
    name: 'string.endsWith(s1,s2) 长度',
    exp: "string.endsWith(value, 'd')",
    desc: '以某字符串结束, 返回 Boolean',
  },
  {
    demo: 'abcd',
    env: '',
    name: 'string.substring(s,begin[,end]) 字符串截取',
    exp: 'string.substring(value, 1, 3)',
    desc: '截取字符串 s,从 begin 到 end',
  },
  {
    demo: 'abcd',
    env: '',
    name: 'string.indexOf(s1,s2) 查询位置',
    exp: "string.indexOf(value, 'c')",
    desc: '求 s2 在 s1 中 的起始索引位置,如果不存在为-1',
  },
  {
    demo: 'abcd',
    env: '',
    name: 'string.replace_all(s,regex,replacement) 替换',
    exp: "string.replace_all(value, 'c', 'KKK')",
    desc: '字符串替换操作',
  },
  {
    demo: 'aabcd',
    env: '',
    name: 'string.replace_first(s,regex,replacement) 替换首个',
    exp: "string.replace_first(value, 'a', 'KKK')",
    desc: '仅替换首次匹配的数据',
  },
]

/** 数学函数 */
const MATH: FnPreset[] = [
  { demo: '-123', name: 'long(v)  转成long', exp: 'long(value)', desc: '将值转为 long 类型' },
  { demo: '-123', name: 'double(v)  转成double', exp: 'double(value)', desc: '将值转为 double 类型' },
  { demo: '-123', name: 'bigint(v)  转成bigint', exp: 'bigint(value)', desc: '将值转为 bigint 类型' },
  { demo: -123, name: 'math.abs  绝对值', exp: 'math.abs(bigint(value))', desc: '绝对值' },
  { demo: 121, name: 'math.sqrt  平方根', exp: 'math.sqrt(bigint(value))', desc: '平方根' },
]

/** 系统常量 */
const SYSTEM: FnPreset[] = [
  { demo: '', name: '源名称-SOURCE_NAME', exp: 'SOURCE_NAME', desc: '引用源名称, 仅在预处理时可用' },
  { demo: '', name: '源URL-SOURCE_URL', exp: 'SOURCE_URL', desc: '引用源URL, 仅在预处理时可用' },
  { demo: '', name: '源对应域-SOURCE_DOMAIN', exp: 'SOURCE_DOMAIN', desc: '引用源DOMAIN, 仅在预处理时可用' },
]

export const FN_GROUPS: FnGroup[] = [
  { key: 'core', label: '核心结构', items: CORE },
  { key: 'custom', label: '自定义函数', items: CUSTOM },
  { key: 'string', label: '字符串操作', items: STRING },
  { key: 'math', label: '数学函数', items: MATH },
  { key: 'system', label: '系统常量', items: SYSTEM },
]

export const FN_NOTICE =
  '表达式中可以使用上下文map中的变量 ' +
  ' 1.[当前值] 会覆盖上下文map中的 value 变量   ' +
  '   2. 上下文[map]中的值，可以使用其key作为表达式中的变量'
