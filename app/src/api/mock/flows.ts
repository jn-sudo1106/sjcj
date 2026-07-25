import {
  PRESET_INTENTS,
  makeBlankFlow,
  makeSiteSeedTemplate,
  type FlowDef,
  type FlowRecommendation,
  type PresetIntent,
} from '@/views/FlowCanvas/canvas/flowModel'
import type { Ack } from '../types'
import { setSourceDetached } from './sources'
import { SITE_SEEDS } from './sites'

// 流程定义持久化 mock —— 存浏览器 localStorage（真接入时换 flow/* 后端端点，界面零改动）。
const INDEX_KEY = 'sjcj.flows.index'
const PREFIX = 'sjcj.flow.'

interface FlowMeta {
  id: string
  name: string
  updatedAt: string
}

function readIndex(): FlowMeta[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') as FlowMeta[]
  } catch {
    return []
  }
}

export function mockFlowSave(params?: Record<string, unknown>): Ack {
  const def = params?.def as FlowDef | undefined
  if (!def?.id) return { ok: false, message: '缺少流程定义' }
  localStorage.setItem(PREFIX + def.id, JSON.stringify(def))
  const idx = readIndex().filter((f) => f.id !== def.id)
  idx.unshift({ id: def.id, name: def.name, updatedAt: def.updatedAt })
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx))
  // 网站统一流程模板（id = site:xxx）不算"某个子源保存了自己的流程"，其余 id 若命中某个站内子源则标记脱离（0707 优化·Phase2）
  if (!def.id.startsWith('site:')) setSourceDetached(def.id, true)
  return { ok: true, message: '流程已保存（本地）' }
}

export function mockFlowLoad(params?: Record<string, unknown>): FlowDef | null {
  const id = String(params?.id ?? '')
  const raw = localStorage.getItem(PREFIX + id)
  if (raw) return JSON.parse(raw) as FlowDef
  // 种子演示网站模拟"后端已有统一流程模板"（0710）：查无存档时兜底默认两节点骨架；
  // 用户新建的网站（不在 SITE_SEEDS 里）返回 null → 画布走空白引导卡模式。
  if (id.startsWith('site:')) {
    const seed = SITE_SEEDS.find((s) => `site:${s.siteId}` === id)
    if (seed) return makeSiteSeedTemplate(seed.siteId, seed.name)
  }
  return null
}

export function mockFlowList(): FlowMeta[] {
  return readIndex()
}

// 流程模板推荐（M5.5）：首期按关键词 / 意图匹配预置模板；二期换真 LLM BFF，签名不变、界面零改动。
function altsExcept(hit: PresetIntent | null): { intent: string; name: string }[] {
  return PRESET_INTENTS.filter((p) => p.key !== hit?.key).map((p) => ({ intent: p.key, name: p.label }))
}

export function mockFlowRecommend(params?: Record<string, unknown>): FlowRecommendation {
  const prompt = String(params?.prompt ?? '').toLowerCase()
  const intent = params?.intent ? String(params.intent) : ''

  let hit: PresetIntent | null = intent ? (PRESET_INTENTS.find((p) => p.key === intent) ?? null) : null
  if (!hit && prompt) {
    let best: { p: PresetIntent; score: number } | null = null
    for (const p of PRESET_INTENTS) {
      const score = p.keywords.reduce((n, k) => n + (prompt.includes(k.toLowerCase()) ? 1 : 0), 0)
      if (score > 0 && (!best || score > best.score)) best = { p, score }
    }
    hit = best?.p ?? null
  }

  if (!hit) {
    return {
      flow: makeBlankFlow(),
      templateId: undefined,
      rationale: '没有匹配到专用模板，将应用公共网页抓取模板；之后可继续调整节点配置或切换模板。',
      alternatives: altsExcept(null),
    }
  }
  return { flow: hit.build(), templateId: `preset-${hit.key}`, rationale: hit.rationale, alternatives: altsExcept(hit) }
}

// 节点级 AI 对话（0701 问题八）：mock 关键词匹配给出解释/建议型回复；二期换真 LLM BFF，签名不变、界面零改动。
export function mockNodeAiChat(params?: Record<string, unknown>): { reply: string } {
  const question = String(params?.question ?? '').toLowerCase()
  const nodeTitle = String(params?.nodeTitle ?? '当前节点')
  const outputTable = String(params?.outputTable ?? '')
  const disabled = Boolean(params?.disabled)

  if (disabled) {
    return { reply: `「${nodeTitle}」当前已停止，流经它的数据不会被处理。右上角状态切回"运行"后再试。` }
  }
  if (/失败|报错|error|异常/.test(question)) {
    return {
      reply: `「${nodeTitle}」常见的发起抓取失败原因：① 采集节点缺源 URL 或输出表；② 上游节点没有产出数据；③ 依赖的规则组/表达式未启用。可先在"表配置" Tab 确认输入/输出表是否都已就绪。`,
    }
  }
  if (/队列|queue/.test(question)) {
    return { reply: '任务队列标明本步骤的任务从哪个队列拉取；留空时默认沿用所选配置的 topic，可在"表配置" Tab 手动覆盖。' }
  }
  if (/配置|字段|参数/.test(question)) {
    return {
      reply: outputTable
        ? `「${nodeTitle}」当前落表 ${outputTable}，配置项集中在"节点配置"（这个节点怎么跑）与"表配置"（数据从哪来到哪去）两个 Tab，具体想了解哪个字段？`
        : `「${nodeTitle}」还没有绑定输出表，建议先在"表配置" Tab 选择或新建一张表。`,
    }
  }
  return {
    reply: `我是「${nodeTitle}」的节点助手（演示）：可以问我"为什么发起抓取失败""这个节点的配置是什么""任务队列怎么填"。真实 LLM 接入后会给出更具体的建议。`,
  }
}
