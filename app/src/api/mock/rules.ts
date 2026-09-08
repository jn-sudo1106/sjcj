import type {
  Paged,
  Rule,
  RuleGroup,
  SharedConfig,
  RuleTestCase,
  EvalResult,
  RuleOrchestration,
  RuleOrchestrationGenerateResult,
  RuleOrchestrationItem,
  RuleOrchestrationSaveMetaResult,
  RuleOrchestrationSaveResult,
  RuleOrchestrationTestResult,
} from '../types'

// ---------------- 规则组 / 规则 / 共享配置 ----------------
const GROUPS: Omit<RuleGroup, 'count'>[] = [
  { id: 'g-clean', name: '数据清洗', stage: '清洗' },
  { id: 'g-validate', name: '有效性校验', stage: '校验' },
  { id: 'g-tag', name: '智能打标', stage: '打标' },
  { id: 'g-filter', name: '过滤拦截', stage: '过滤' },
]

const SHARED: SharedConfig[] = [
  { id: 'sc-stopwords', name: '停用词字典', desc: '通用停用词 / 垃圾词表' },
  { id: 'sc-units', name: '金额单位映射', desc: '万 / 亿 → 数值' },
  { id: 'sc-vip', name: 'VIP 等级表', desc: '用户等级枚举' },
  { id: 'sc-region', name: '地域映射', desc: '省市区域字典' },
  { id: 'sc-keywords', name: '公告关键词库', desc: '公告类型关键词' },
]

let orchestrationSeq = 3

const REAL_ESTATE_SCRIPT = `def main(content):
    tags = []
    if "地产" in content:
        tags.append("房地产")
    return {"tags": tags}`

const ORCHESTRATIONS: RuleOrchestrationItem[] = [
  {
    ruleId: 'orch-real-estate',
    name: '地产公告打标',
    describe: '正文 content 包含地产二字时，在 tags 字段返回房地产标签。',
    script: REAL_ESTATE_SCRIPT,
    scriptPath: '/rules/generated/orch-real-estate.py',
    enabled: true,
    createdAt: '2026-07-07 16:30',
    userCode: 'admin',
  },
  {
    ruleId: 'orch-spam-filter',
    name: '推广内容过滤',
    describe: '正文 content 包含广告、推广等词时，返回 action=drop。',
    script: `def main(content):
    if "广告" in content or "推广" in content:
        return {"action": "drop"}
    return {"action": "keep"}`,
    scriptPath: '/rules/generated/orch-spam-filter.py',
    enabled: true,
    createdAt: '2026-07-07 17:10',
    userCode: 'admin',
  },
]

const RULES: Rule[] = [
  {
    ruleId: 'r-trim', name: '去除首尾空白', groupId: 'g-clean', stage: '清洗',
    expr: 'IF(LEN(text) > 0, text, "")', refCount: 4, refBy: ['公告规则采集链路_v3 / 规则处理', '舆情清洗链路 / 清洗'],
    version: 'v1.3', state: 'published', owner: 'dev_zhonghe', updatedAt: '2026-06-12 10:20',
    gate: { syntax: 'pass', reference: 'pass', batchTest: 'pass' },
  },
  {
    ruleId: 'r-amount', name: '金额标准化', groupId: 'g-clean', stage: '清洗',
    expr: 'IF(CONTAINS(amount, "万"), "万元", "元")', sharedConfigs: ['sc-units'],
    refCount: 2, refBy: ['基金净值链路 / 清洗'], version: 'v2.0', state: 'published', owner: 'dev_liang',
    updatedAt: '2026-06-13 16:02', gate: { syntax: 'pass', reference: 'warn', batchTest: 'pass' },
  },
  {
    ruleId: 'r-notnull', name: '必填字段校验', groupId: 'g-validate', stage: '校验',
    expr: 'IF(LEN(title) > 0 AND LEN(url) > 0, "valid", "invalid")', refCount: 6,
    refBy: ['公告规则采集链路_v3 / 校验', '股票公告链路 / 校验'], version: 'v1.1', state: 'published',
    owner: 'dev_zhonghe', updatedAt: '2026-06-14 09:41', gate: { syntax: 'pass', reference: 'pass', batchTest: 'pass' },
  },
  {
    ruleId: 'r-score', name: '质量评分门限', groupId: 'g-validate', stage: '校验',
    expr: 'IF(score >= 60, "pass", "block")', refCount: 1, refBy: ['舆情清洗链路 / 校验'],
    version: 'v0.4', state: 'draft', owner: 'data_wang', updatedAt: '2026-06-18 21:10',
    gate: { syntax: 'pass', reference: 'pass', batchTest: 'pending' },
  },
  {
    ruleId: 'r-isannounce', name: '公告类型识别', groupId: 'g-tag', stage: '打标',
    expr: 'IF(CONTAINS(title, "公告"), "announcement", "other")', sharedConfigs: ['sc-keywords'],
    refCount: 3, refBy: ['股票公告链路 / 打标'], version: 'v1.5', state: 'published', owner: 'dev_liang',
    updatedAt: '2026-06-15 11:25', gate: { syntax: 'pass', reference: 'pass', batchTest: 'pass' },
  },
  {
    ruleId: 'r-region', name: '地域打标', groupId: 'g-tag', stage: '打标',
    expr: 'IF(CONTAINS(text, region), region, "unknown")', sharedConfigs: ['sc-region'],
    refCount: 0, version: 'v0.2', state: 'draft', owner: 'data_wang', updatedAt: '2026-06-18 19:30',
    gate: { syntax: 'pass', reference: 'warn', batchTest: 'pending' },
  },
  {
    ruleId: 'r-vip', name: 'VIP 用户识别', groupId: 'g-tag', stage: '打标',
    expr: 'IF(level == "vip", "high", "normal")', sharedConfigs: ['sc-vip'], refCount: 2,
    refBy: ['舆情清洗链路 / 打标'], version: 'v1.0', state: 'published', owner: 'ops_chen',
    updatedAt: '2026-06-10 14:00', gate: { syntax: 'pass', reference: 'pass', batchTest: 'pass' },
  },
  {
    ruleId: 'r-spam', name: '垃圾内容过滤', groupId: 'g-filter', stage: '过滤',
    expr: 'IF(CONTAINS(text, "广告") OR CONTAINS(text, "推广"), "drop", "keep")', sharedConfigs: ['sc-stopwords'],
    refCount: 5, refBy: ['舆情清洗链路 / 过滤', '微博舆情链路 / 过滤'], version: 'v3.2', state: 'published',
    owner: 'dev_zhonghe', updatedAt: '2026-06-16 08:50', gate: { syntax: 'pass', reference: 'pass', batchTest: 'fail' },
  },
  {
    ruleId: 'r-dup', name: '重复内容过滤', groupId: 'g-filter', stage: '过滤',
    expr: 'IF(dup ==, "drop", "keep")', refCount: 1, version: 'v0.1', state: 'draft', owner: 'data_wang',
    updatedAt: '2026-06-19 07:55', gate: { syntax: 'fail', reference: 'pass', batchTest: 'pending' },
  },
  {
    ruleId: 'r-len', name: '最小长度过滤', groupId: 'g-filter', stage: '过滤',
    expr: 'IF(LEN(text) >= 10, "keep", "drop")', refCount: 3, refBy: ['微博舆情链路 / 过滤'],
    version: 'v1.2', state: 'published', owner: 'ops_chen', updatedAt: '2026-06-11 13:14',
    gate: { syntax: 'pass', reference: 'pass', batchTest: 'pass' },
  },
]

const TEST_CASES: Record<string, RuleTestCase[]> = {
  'r-score': [
    { caseId: 'r-score-1', name: '高分样本', context: { score: 75 }, expected: 'pass', lastResult: 'pass', blocking: true },
    { caseId: 'r-score-2', name: '边界样本', context: { score: 60 }, expected: 'pass', lastResult: 'pass', blocking: true },
    { caseId: 'r-score-3', name: '低分样本', context: { score: 40 }, expected: 'block', lastResult: 'pending', blocking: false },
  ],
  'r-isannounce': [
    { caseId: 'r-isan-1', name: '含公告', context: { title: '重大事项公告' }, expected: 'announcement', lastResult: 'pass', blocking: true },
    { caseId: 'r-isan-2', name: '非公告', context: { title: '行情快讯' }, expected: 'other', lastResult: 'pass', blocking: false },
  ],
  'r-spam': [
    { caseId: 'r-spam-1', name: '广告样本', context: { text: '点击领取广告福利' }, expected: 'drop', lastResult: 'fail', blocking: true },
    { caseId: 'r-spam-2', name: '正常样本', context: { text: '公司发布年度报告' }, expected: 'keep', lastResult: 'pass', blocking: false },
  ],
}

const countUnder = (groupId: string) => RULES.filter((r) => r.groupId === groupId).length

function matches(r: Rule, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const groupId = String(p.groupId ?? '')
  if (groupId && r.groupId !== groupId) return false
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![r.name, r.ruleId, r.expr].some((f) => f.toLowerCase().includes(kw))) return false
  const state = String(p.state ?? '')
  if (state && state !== 'all' && r.state !== state) return false
  return true
}

export function mockRuleGroups(): RuleGroup[] {
  return GROUPS.map((g) => ({ ...g, count: countUnder(g.id) }))
}

export function mockRulePaged(params?: Record<string, unknown>): Paged<Rule> {
  const filtered = RULES.filter((r) => matches(r, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

export function mockRuleStats(): { groups: number; exprs: number; sharedConfigs: number; passRate: string } {
  const rated = RULES.filter((r) => r.gate.batchTest !== 'pending')
  const passed = rated.filter((r) => r.gate.batchTest === 'pass').length
  const pct = rated.length ? Math.round((passed / rated.length) * 100) : 0
  return { groups: GROUPS.length, exprs: RULES.length, sharedConfigs: SHARED.length, passRate: `${pct}%` }
}

export function mockRuleGateSummary(): {
  syntaxFail: number; referenceWarn: number; batchTestPassRate: number; pendingCount: number
} {
  const rated = RULES.filter((r) => r.gate.batchTest !== 'pending')
  const passed = rated.filter((r) => r.gate.batchTest === 'pass').length
  return {
    syntaxFail: RULES.filter((r) => r.gate.syntax === 'fail').length,
    referenceWarn: RULES.filter((r) => r.gate.reference === 'warn').length,
    batchTestPassRate: rated.length ? Math.round((passed / rated.length) * 100) : 0,
    pendingCount: RULES.filter((r) => r.gate.batchTest === 'pending').length,
  }
}

export function mockSharedConfigs(): SharedConfig[] {
  return SHARED
}

export function mockRuleTestCases(params?: Record<string, unknown>): RuleTestCase[] {
  return TEST_CASES[String(params?.ruleId ?? '')] ?? []
}

// ---------------- 轻量表达式求值器（演示用） ----------------
// 支持 IF / AND / OR / NOT / 比较(>= <= == != > <) / CONTAINS / LEN / 变量 / 字面量。
// 解析不了的语法直接抛错 → evaluate 返回不支持态（呼应「evaluate 待接口」边界）。
function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}
function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0, q = '', cur = ''
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}
function splitTopOp(s: string, op: string): string[] {
  const out: string[] = []
  let depth = 0, q = '', last = 0, i = 0
  while (i < s.length) {
    const ch = s[i]
    if (q) { if (ch === q) q = ''; i++; continue }
    if (ch === '"' || ch === "'") { q = ch; i++; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && s.slice(i, i + op.length).toUpperCase() === op) {
      out.push(s.slice(last, i)); i += op.length; last = i; continue
    }
    i++
  }
  out.push(s.slice(last))
  return out.map((x) => x.trim()).filter(Boolean)
}
const truthy = (v: unknown) => !(v === false || v === 0 || v === '' || v == null)

function atom(tok: string, ctx: Record<string, unknown>): unknown {
  const t = tok.trim()
  if (/^"[^"]*"$/.test(t) || /^'[^']*'$/.test(t)) return t.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true') return true
  if (t === 'false') return false
  const key = t.startsWith('$') ? t.slice(1) : t
  if (Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key]
  throw new Error(`未知标识符或变量未在 context 提供：${t}`)
}

function evalExpr(raw: string, ctx: Record<string, unknown>, trace: string[]): unknown {
  let s = raw.trim()
  while (s.startsWith('(') && matchParen(s, 0) === s.length - 1) s = s.slice(1, -1).trim()

  const fn = /^([A-Za-z_]+)\s*\(/.exec(s)
  if (fn && matchParen(s, s.indexOf('(')) === s.length - 1) {
    const name = fn[1].toUpperCase()
    const args = splitArgs(s.slice(s.indexOf('(') + 1, s.length - 1))
    if (name === 'IF') {
      if (args.length !== 3) throw new Error('IF 需要 3 个参数：IF(条件, 真值, 假值)')
      const cond = truthy(evalExpr(args[0], ctx, trace))
      trace.push(`IF 条件「${args[0].trim()}」=> ${cond}`)
      trace.push(`命中分支：${cond ? 'THEN' : 'ELSE'}`)
      return evalExpr(cond ? args[1] : args[2], ctx, trace)
    }
    if (name === 'CONTAINS') {
      const a = String(evalExpr(args[0], ctx, trace))
      const b = String(evalExpr(args[1], ctx, trace))
      const r = a.includes(b)
      trace.push(`CONTAINS("${a}","${b}") => ${r}`)
      return r
    }
    if (name === 'LEN') return String(evalExpr(args[0], ctx, trace)).length
    if (name === 'NOT') return !truthy(evalExpr(args[0], ctx, trace))
    throw new Error(`暂不支持的函数：${name}（演示求值器支持 IF / CONTAINS / LEN / NOT）`)
  }

  const or = splitTopOp(s, ' OR ')
  if (or.length > 1) { const r = or.some((p) => truthy(evalExpr(p, ctx, trace))); trace.push(`OR => ${r}`); return r }
  const and = splitTopOp(s, ' AND ')
  if (and.length > 1) { const r = and.every((p) => truthy(evalExpr(p, ctx, trace))); trace.push(`AND => ${r}`); return r }

  const cmp = /^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(s)
  if (cmp) {
    const l = evalExpr(cmp[1], ctx, trace) as never
    const r = evalExpr(cmp[3], ctx, trace) as never
    let res: boolean
    switch (cmp[2]) {
      case '>=': res = l >= r; break
      case '<=': res = l <= r; break
      case '>': res = l > r; break
      case '<': res = l < r; break
      case '==': res = l === r; break
      default: res = l !== r
    }
    trace.push(`比较 ${JSON.stringify(l)} ${cmp[2]} ${JSON.stringify(r)} => ${res}`)
    return res
  }
  return atom(s, ctx)
}

export function mockEvaluate(params?: Record<string, unknown>): EvalResult {
  const expr = String(params?.expr ?? '').trim()
  if (!expr) return { ok: false, error: '表达式为空' }
  let ctx: Record<string, unknown> = {}
  const raw = params?.context
  if (raw) {
    try {
      ctx = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : (raw as Record<string, unknown>)
    } catch {
      return { ok: false, error: 'context 不是合法 JSON' }
    }
  }
  const trace: string[] = []
  try {
    const v = evalExpr(expr, ctx, trace)
    const branchLine = trace.find((t) => t.startsWith('命中分支'))
    return {
      ok: true,
      value: typeof v === 'string' ? v : JSON.stringify(v),
      branch: branchLine?.replace('命中分支：', ''),
      trace,
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message, trace }
  }
}

function matchesOrchestration(item: RuleOrchestrationItem, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (!kw) return true
  return [item.ruleId, item.name, item.describe].some((f) => f.toLowerCase().includes(kw))
}

function makeRuleScript(describe: string): string {
  if (/地产|房地产/.test(describe)) return REAL_ESTATE_SCRIPT
  return `def main(content):
    return {"tags": [], "matched": bool(content)}`
}

// 按当前表字段绑定生成骨架：入参做形参，出参做返回 dict 的 key（同名入参直接透传，其余占位 None）。
// 没有 outputFields 时回退旧「地产」单 content 演示脚本，保证已有测试与旧流程不受影响。
function makeGenericRuleScript(inputFields: string[], outputFields: string[]): string {
  const args = inputFields.length ? inputFields.join(', ') : 'content'
  const body = outputFields.map((f) => `"${f}": ${inputFields.includes(f) ? f : 'None'}`).join(', ')
  return `def main(${args}):\n    return {${body}}`
}

function parseFieldCodes(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(':').pop() ?? item)
    .map((item) => item.trim())
    .filter(Boolean)
}

// S3-2 补充：采集节点抓取配置（XML 产物）的生成骨架，供 mock 模式下验证「XML 产物能存进 MinIO
// 并读回，读回内容是合法 XML」这条验收——真机实测（§9.2-1）因后端 500 未能确认标记行是否附在
// XML 末尾，故 mock 版本不模拟标记行（parseRuleOrchestrationStreamText/stripMinioMarkerLine
// 已经能在标记行存在或缺席两种情况下都正确处理，见 legacyAdapters.test.ts）。
function makeCaptureConfigXml(describe: string): string {
  const title = describe.trim() || '抓取配置'
  return `<Config>\n  <Action id="1" type="open" title="${title}"/>\n</Config>`
}

export function mockRuleOrchestrationPaged(params?: Record<string, unknown>): Paged<RuleOrchestrationItem> {
  const filtered = ORCHESTRATIONS.filter((item) => matchesOrchestration(item, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

// 路径 A：保存业务规则元数据换取 ruleId（0801 方案 §5.2）。有 ruleId 时按 ruleId 更新
// （对应「修改表字段」回改后重新保存），否则新分配一个，与 mockRuleOrchestrationSave 共用同一 id 序列。
export function mockRuleOrchestrationSaveMeta(params?: Record<string, unknown>): RuleOrchestrationSaveMetaResult {
  const cfg = ((params?.cfg ?? params) || {}) as RuleOrchestration
  const ruleId = cfg.ruleId || `orch-${orchestrationSeq++}`
  return { ruleId, message: '业务规则已保存' }
}

/** 路径 B 回灌：按 ruleId 取详情（对齐 getComposeById） */
export function mockRuleOrchestrationDetail(params?: Record<string, unknown>): RuleOrchestration {
  const ruleId = String(params?.ruleId ?? '')
  const existing = ORCHESTRATIONS.find((item) => item.ruleId === ruleId)
  if (existing) {
    return {
      mode: 'ref',
      ruleId: existing.ruleId,
      name: existing.name,
      describe: existing.describe,
      script: existing.script,
      scriptPath: existing.scriptPath,
      enabled: existing.enabled,
    }
  }
  return { mode: 'ref', ruleId, describe: '', scriptPath: '', script: '' }
}

/** 按 codePath 读脚本正文（对齐 GET dashscope/code） */
export function mockRuleOrchestrationLoadScript(params?: Record<string, unknown>): string {
  const path = String(params?.scriptPath ?? params?.file_name ?? '')
  const existing = ORCHESTRATIONS.find((item) => item.scriptPath === path || item.ruleId === path)
  return existing?.script ?? `# mock script for ${path}\ndef main():\n    return {}`
}

/** 按 fileId 读脚本正文（对齐 GET /api/file/download，响应就是纯文本本身）。
 *  与 orchestrationLoadScript 同源：编排里登记过 scriptPath 的直接回它的 script，
 *  没登记过的回合成脚本——和真实文件服务的「有文件回文件、没文件 404」语义对齐到可演示的程度。 */
export function mockFileDownloadScript(params?: Record<string, unknown>): string {
  const path = String(params?.fileId ?? '')
  const existing = ORCHESTRATIONS.find((item) => item.scriptPath === path)
  return existing?.script ?? `# mock script for ${path}\ndef main():\n    return {}`
}

/** 按文件路径执行脚本（对齐 POST /vrule/fastapi/execute/code，ResultView 脚本测试用）。
 *  mock 不真的执行 Python：回显入参行 + code_path/demo 字段，让「脚本测试」弹窗有可读输出；
 *  success 语义与 orchestrationTest 一致（拿 params 行回填，认不出的标 demo- 前缀）。 */
export function mockExecuteCode(params?: Record<string, unknown>): Record<string, unknown> {
  const codePath = String(params?.code_path ?? '')
  const row = (Array.isArray(params?.params) ? {} : params?.params ?? {}) as Record<string, unknown>
  return {
    code_path: codePath,
    ...row,
    demo: `mock-executed ${codePath}`,
  }
}

export function mockRuleOrchestrationGenerate(params?: Record<string, unknown>): RuleOrchestrationGenerateResult {
  const cfg = ((params?.ruleCfg ?? params) || {}) as RuleOrchestration
  const describe = String(cfg.describe ?? '').trim()
  const id = `orch-draft-${Date.now()}`
  if (cfg.format === 'xml') {
    return { script: makeCaptureConfigXml(describe), scriptPath: `/rules/generated/${id}.xml` }
  }
  return {
    script: cfg.outputFields?.length ? makeGenericRuleScript(cfg.inputFields ?? [], cfg.outputFields) : makeRuleScript(describe),
    scriptPath: `/rules/generated/${id}.py`,
  }
}

export function mockDataProcessGenerate(params?: Record<string, unknown>): RuleOrchestrationGenerateResult {
  const description = String(params?.description ?? '').trim()
  const inputFields = parseFieldCodes(String(params?.inputFields ?? ''))
  const outputFields = parseFieldCodes(String(params?.outputFields ?? ''))
  const script = outputFields.length
    ? makeGenericRuleScript(inputFields.length ? inputFields : ['content'], outputFields)
    : makeRuleScript(description)
  return {
    script,
    scriptPath: `/rules/generated/data-process-${Date.now()}.py`,
  }
}

export function mockRuleOrchestrationTest(params?: Record<string, unknown>): RuleOrchestrationTestResult {
  const script = String(params?.script ?? '').trim()
  if (!script) return { success: false, error: '脚本为空', outputs: [], executionTime: 0 }
  // req.rows 恒为 1 条（左栏单选，会议 20:51）；outputs 建模为数组是因为一条输入可产出多条输出
  // （实测规则 173：zb_value 与 zb_tb 同时有值时返回 2 条），演示规则仍是单条输出，数组长度为 1。
  const rows = Array.isArray(params?.rows) ? (params.rows as Array<Record<string, unknown>>) : []
  const row = rows[0] ?? {}
  const outputFields = Array.isArray(params?.outputFields) ? (params.outputFields as string[]) : []
  // 走 RuleTableFieldBinder 选定字段的规则：出参按 outputFields 回填，能从入参原样透传的就透传，
  // 否则标个 demo- 前缀占位，让人一眼看出这是演示值，不是真实规则逻辑推导出来的。
  if (outputFields.length) {
    const outputs = Object.fromEntries(outputFields.map((f) => [f, row[f] ?? `demo-${f}`]))
    return { success: true, outputs: [outputs], executionTime: 0.02 }
  }
  // 兼容旧「地产」单 content 字段演示脚本（0707 Phase 9 遗留，rules.test.ts 仍在测）
  const content = String(row.content ?? '')
  const tags = /地产/.test(content) ? ['房地产'] : []
  return {
    success: true,
    outputs: [{ tags }],
    executionTime: 0.018,
  }
}

export function mockRuleOrchestrationSave(params?: Record<string, unknown>): RuleOrchestrationSaveResult {
  const cfg = ((params?.ruleCfg ?? params) || {}) as RuleOrchestration
  const existing = cfg.ruleId ? ORCHESTRATIONS.find((item) => item.ruleId === cfg.ruleId) : undefined
  const ruleId = existing?.ruleId ?? `orch-${orchestrationSeq++}`
  const scriptPath = cfg.scriptPath || `/rules/generated/${ruleId}.${cfg.format === 'xml' ? 'xml' : 'py'}`
  const item: RuleOrchestrationItem = {
    ruleId,
    name: cfg.name || `规则编排 ${ruleId}`,
    describe: cfg.describe || '',
    script: cfg.script || '',
    scriptPath,
    enabled: cfg.enabled ?? true,
    createdAt: existing?.createdAt ?? '2026-07-08 13:30',
  }
  if (existing) Object.assign(existing, item)
  else ORCHESTRATIONS.unshift(item)
  return { ruleId, scriptPath, message: '规则脚本已保存（演示）' }
}
