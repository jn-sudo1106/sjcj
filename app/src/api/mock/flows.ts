import type { FlowDef } from '../../views/FlowCanvas/flowModel'
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
