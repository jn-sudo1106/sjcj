// 文章打标签的结果解析（2026-09-18）：提示词要求模型输出一段 JSON（见 cfg_llm_node_prompt 的
// 「文章打标签」那一行），结构大致：
//
// ```json
// { "summary": "一句话概括",
//   "labels": { "topic": ["社会"], "sentiment": "负面", "emotion_intensity": "强",
//               "emotion_type": ["愤怒"], "intent": ["投诉"], "risk": ["涉稳"],
//               "risk_level": "中危", "spread": ["原创"], "subject": ["网民"],
//               "region": ["国内"], "time_feature": ["突发事件"], "language": ["口语"] },
//   "confidence": 0.9,
//   "evidence": { "sentiment": "...", "risk": "...", "topic": "..." },
//   "uncertain": false, "notes": "可选" }
// ```
//
// 模型不一定规规矩矩只吐 JSON（常见：包在 ```json 代码块里、前后带一句说明），所以解析要**容错**：
// 能解析出来就结构化展示，解析不出就退回原文展示（由界面决定），**不要把原文丢掉**。

export interface ArticleTagDimension {
  key: string
  label: string
  /** 多选维度是数组，单选维度（情感/强度/等级）是字符串 */
  multiple: boolean
}

/** 维度顺序与中文名，按提示词里的标签体系来 */
export const ARTICLE_TAG_DIMENSIONS: ArticleTagDimension[] = [
  { key: 'topic', label: '主题', multiple: true },
  { key: 'sentiment', label: '情感', multiple: false },
  { key: 'emotion_intensity', label: '情绪强度', multiple: false },
  { key: 'emotion_type', label: '情绪类型', multiple: true },
  { key: 'intent', label: '意图', multiple: true },
  { key: 'risk', label: '风险', multiple: true },
  { key: 'risk_level', label: '风险等级', multiple: false },
  { key: 'spread', label: '传播特征', multiple: true },
  { key: 'subject', label: '主体', multiple: true },
  { key: 'region', label: '地域', multiple: true },
  { key: 'time_feature', label: '时间特征', multiple: true },
  { key: 'language', label: '语言特征', multiple: true },
]

export interface ArticleTagGroup {
  key: string
  label: string
  multiple: boolean
  values: string[]
}

export interface ArticleTagResult {
  summary: string
  groups: ArticleTagGroup[]
  /** 0~1，解析不出为 null */
  confidence: number | null
  /** 依据：维度 → 原文里的短句 */
  evidence: { label: string; text: string }[]
  uncertain: boolean
  notes: string
  /** 原始 JSON 文本（界面里给"看原文"用） */
  raw: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toText(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/** 从模型输出里抠出第一个完整的 JSON 对象：剥掉 ```json 围栏和前后说明文字。 */
export function extractJsonObject(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  // 代码围栏：```json … ```（也容忍 ```JSON）
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf('{')
  if (start < 0) return ''
  // 花括号配平扫描，忽略字符串里的花括号（模型偶尔会在字符串里写 { 或 }）
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return body.slice(start, i + 1)
    }
  }
  return ''
}

function valuesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean)
  const single = toText(value)
  return single ? [single] : []
}

/**
 * 解析打标签结果。返回 `null` 表示模型没按 JSON 输出（界面据此退回展示原文）。
 */
export function parseArticleTags(raw: string): ArticleTagResult | null {
  const json = extractJsonObject(raw)
  if (!json) return null
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  const record = asRecord(payload)
  const labels = asRecord(record.labels)
  const groups: ArticleTagGroup[] = ARTICLE_TAG_DIMENSIONS
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      multiple: dimension.multiple,
      values: valuesOf(labels[dimension.key]),
    }))
    .filter((group) => group.values.length > 0)

  // 有些模型会把 labels 平铺在顶层（没有 labels 字段），这时按顶层同名键兜底
  if (!groups.length) {
    ARTICLE_TAG_DIMENSIONS.forEach((dimension) => {
      const values = valuesOf(record[dimension.key])
      if (values.length) groups.push({ key: dimension.key, label: dimension.label, multiple: dimension.multiple, values })
    })
  }

  const confidenceValue = Number(record.confidence)
  const evidenceRecord = asRecord(record.evidence)
  const evidence = ARTICLE_TAG_DIMENSIONS
    .map((dimension) => ({
      label: dimension.label,
      text: toText(evidenceRecord[dimension.key]),
    }))
    .filter((item) => item.text)

  return {
    summary: toText(record.summary),
    groups,
    confidence: Number.isFinite(confidenceValue) && confidenceValue > 0 ? confidenceValue : null,
    evidence,
    uncertain: record.uncertain === true || toText(record.uncertain).toLowerCase() === 'true',
    notes: toText(record.notes),
    raw: json,
  }
}

/** 风险等级 → 展示用的强调色（高危红 / 中危橙 / 低危蓝 / 无风险灰） */
export function riskLevelTone(level: string): 'high' | 'mid' | 'low' | 'none' {
  if (/高危/.test(level)) return 'high'
  if (/中危/.test(level)) return 'mid'
  if (/低危/.test(level)) return 'low'
  return 'none'
}
