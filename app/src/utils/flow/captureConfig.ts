// 抓取配置 XML 轻解析（0804 S3-4，方案 §3.1 修正 B · 附录 §十）。
// 只解析三样：动作链摘要 / 字段绑定（ColumnCfg）/ 入口 URL，够展示只读摘要 + 校验用，不做全量建模——
// 属性编码在同一份文件里有三种写法（见附录 §10.3），做可视化编辑器成本不划算，本期不做。
// 存储/传输：整份 XML 原样存、原样下传，前端不重排、不改属性顺序（老引擎容错程度未知，见附录 §10.8）。

export interface ParsedCaptureConfig {
  /** 按 NextActionId 走出来的执行顺序（文档顺序 ≠ 执行顺序，见附录 §10.2） */
  actions: { actionId: string; type: string; title: string }[]
  /** 全部 Column 的 BizId → BizName + 列序号，已排除 Col{n} 占位列，用于跟输出表已选字段比对 */
  columns: { bizId: string; bizName: string; colIndex: string }[]
  /** 入口 URL（OpenUrlAction/Config/Url），用于摘要展示 */
  entryUrl?: string
  /** 解析过程中的降级/异常提示（non-well-formed、断链、环、多链头等），正常解析时为空数组 */
  warnings: string[]
}

const EMPTY: Omit<ParsedCaptureConfig, 'warnings'> = { actions: [], columns: [] }

/** Col5/Col6/Col7 这种 BizId===BizName 且形如 Col{n} 的是未映射占位列，见附录 §10.5 */
function isPlaceholderColumn(bizId: string, bizName: string): boolean {
  return bizId === bizName && /^Col\d+$/.test(bizId)
}

function firstChildByTag(el: Element, tag: string): Element | undefined {
  return Array.from(el.children).find((c) => c.tagName === tag)
}
function childrenByTag(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag)
}

interface RawAction {
  el: Element
  actionId: string
  type: string
  title: string
  nextId: string
  lastId: string
}

/**
 * 走 NextActionId 双向链表排序（附录 §10.2）：链头 = LastActionId 为空。
 * 防御环 / 断链 / 多链头 / 无链头：任一异常都降级为文档顺序，并在 warnings 里给出可读提示，不抛异常。
 */
function orderActions(raw: RawAction[], warnings: string[]): RawAction[] {
  const byId = new Map(raw.map((a) => [a.actionId, a]))
  const heads = raw.filter((a) => !a.lastId)

  if (heads.length === 0) {
    warnings.push('未找到动作链头（没有 LastActionId 为空的动作），已按文档顺序展示')
    return raw
  }
  if (heads.length > 1) {
    warnings.push(`检测到 ${heads.length} 个动作链头，已按文档顺序展示`)
    return raw
  }

  const chain: RawAction[] = []
  const visited = new Set<string>()
  let cur: RawAction | undefined = heads[0]
  while (cur) {
    if (visited.has(cur.actionId)) {
      warnings.push('检测到动作链成环，已按文档顺序展示')
      return raw
    }
    visited.add(cur.actionId)
    chain.push(cur)
    if (!cur.nextId) break
    const next = byId.get(cur.nextId)
    if (!next) {
      warnings.push(`动作链在「${cur.title}」处断链（NextActionId 指向不存在的动作），已按文档顺序展示`)
      return raw
    }
    cur = next
  }
  if (chain.length !== raw.length) {
    warnings.push('动作链未覆盖全部动作节点，已按文档顺序展示')
    return raw
  }
  return chain
}

export function parseCaptureConfig(xml: string): ParsedCaptureConfig {
  const warnings: string[] = []
  const text = xml.trim()
  if (!text) {
    warnings.push('配置内容为空')
    return { ...EMPTY, warnings }
  }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml')
  } catch {
    warnings.push('XML 解析失败：内容不是合法 XML')
    return { ...EMPTY, warnings }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    warnings.push('XML 解析失败：内容不是合法 XML')
    return { ...EMPTY, warnings }
  }

  const root = doc.documentElement
  const actionEls = root ? Array.from(root.children) : []
  if (!actionEls.length) {
    warnings.push('未找到任何动作节点')
    return { ...EMPTY, warnings }
  }

  const raw: RawAction[] = actionEls.map((el) => ({
    el,
    actionId: el.getAttribute('ActionId') ?? '',
    type: el.tagName,
    title: el.getAttribute('DisplayTitle') || el.tagName,
    nextId: el.getAttribute('NextActionId') ?? '',
    lastId: el.getAttribute('LastActionId') ?? '',
  }))

  const ordered = orderActions(raw, warnings)
  const actions = ordered.map((a) => ({ actionId: a.actionId, type: a.type, title: a.title }))

  const columns: ParsedCaptureConfig['columns'] = []
  for (const a of raw) {
    const configEl = firstChildByTag(a.el, 'Config')
    const columnCfgEl = configEl && firstChildByTag(configEl, 'ColumnCfg')
    if (!columnCfgEl) continue
    for (const col of childrenByTag(columnCfgEl, 'Column')) {
      const bizId = col.getAttribute('BizId') ?? ''
      const bizName = col.getAttribute('BizName') ?? ''
      if (isPlaceholderColumn(bizId, bizName)) continue
      columns.push({ bizId, bizName, colIndex: (col.textContent ?? '').trim() })
    }
  }

  const openUrlAction = raw.find((a) => a.type === 'OpenUrlAction')
  const urlEl = openUrlAction && (() => {
    const configEl = firstChildByTag(openUrlAction.el, 'Config')
    return configEl && firstChildByTag(configEl, 'Url')
  })()
  const entryUrl = urlEl?.textContent?.trim() || undefined

  return { actions, columns, entryUrl, warnings }
}

/**
 * 字段一致性校验（附录 §10.5）：BizId ⊆ 已选字段，单向——表格允许部分列不映射（Col5/6/7 占位），
 * 不要求已选字段反向全覆盖。返回不在已选字段里的 BizId 提示文案，全部满足时返回空数组。
 */
export function validateColumns(parsed: ParsedCaptureConfig, selectedFields: string[]): string[] {
  const selected = new Set(selectedFields)
  const unmatched = parsed.columns.filter((c) => !selected.has(c.bizId))
  if (!unmatched.length) return []
  return unmatched.map((c) => `字段「${c.bizName}」（${c.bizId}）未在已选字段中，抓取到的数据无法入库`)
}
