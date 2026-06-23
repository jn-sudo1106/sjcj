import {
  PRESET_INTENTS,
  makeBlankFlow,
  type FlowDef,
  type FlowRecommendation,
  type PresetIntent,
} from '../../views/FlowCanvas/flowModel'
import type { Ack } from '../types'

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
  return { ok: true, message: '流程已保存（本地）' }
}

export function mockFlowLoad(params?: Record<string, unknown>): FlowDef | null {
  const raw = localStorage.getItem(PREFIX + String(params?.id ?? ''))
  return raw ? (JSON.parse(raw) as FlowDef) : null
}

export function mockFlowList(): FlowMeta[] {
  return readIndex()
}

// 流程推荐（M5.5）：首期按关键词 / 意图匹配预置链路；二期换真 LLM BFF，签名不变、界面零改动。
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
      rationale: '没有匹配到预置场景，已为你创建一张空白流程。可换一个意图，或从节点库拖入节点自行编排。',
      alternatives: altsExcept(null),
    }
  }
  return { flow: hit.build(), rationale: hit.rationale, alternatives: altsExcept(hit) }
}
