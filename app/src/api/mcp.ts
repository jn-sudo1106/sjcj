// MCP 服务管理 API 封装（系统设置 → MCP 服务；1118 需求原型）
// 后端契约：待 bee-config 新增 McpServerController，路径前缀 /api/v1/mcp/server。
// 字段口径参考 wan 项目 mcp-store：transport / timeoutSeconds / toolCount / usedByCount /
// lastReachable / lastProbeAt / lastError；敏感字段（env / headers）后端落库加密、读出脱敏。
// 2026-11-18 用户明确要求「不用 mock 数据」：端点直接标 live 走真实后端，
// 后端未就绪时调用方把真实接口错误原样展示，不做空数据伪装。
import { request } from './client'
import type { Ack } from './types/common'

/** 传输方式：stdio 本地子进程 / streamableHttp / sse */
export type McpTransport = 'stdio' | 'streamableHttp' | 'sse'

export interface McpServerItem {
  id: number
  name: string
  description: string
  transport: McpTransport
  /** 0 启用 / 1 停用（与 isDelete 同向；后端若给布尔值由 normalize 兼容） */
  enabled: boolean
  timeoutSeconds: number
  /** 已同步进注册表的工具数 */
  toolCount: number
  /** 被智能体/配置引用的次数（停用前的二次确认依据） */
  usedByCount: number
  /** 最近一次连通测试结果；null = 从未测试 */
  lastReachable: boolean | null
  lastProbeAt: string | null
  lastError: string | null
  createTime?: string
  updateTime?: string
}

export interface McpToolItem {
  name: string
  description?: string
  /** inputSchema JSON 原文（可能较长，前端折叠展示） */
  inputSchema?: string
  /** 服务已删除/重连后不再提供 → 工具标 stale 保留审计 */
  stale?: boolean
}

export interface McpProbeLog {
  id: number
  success: boolean
  toolCount?: number
  error?: string
  probeAt: string
}

export interface McpServerDetail extends McpServerItem {
  // stdio
  command?: string
  args?: string[]
  /** 脱敏后的环境变量（值只回掩码；编辑时留空表示不改动） */
  env?: Record<string, string>
  // streamableHttp / sse
  url?: string
  /** 脱敏后的请求头（同上） */
  headers?: Record<string, string>
  tools?: McpToolItem[]
  probeLogs?: McpProbeLog[]
}

export interface McpServerForm {
  id?: number
  name: string
  description?: string
  transport: McpTransport
  timeoutSeconds?: number
  enabled?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

const EP = {
  list: 'mcp/server/list',
  detail: 'mcp/server/detail',
  save: 'mcp/server/save',
  delete: 'mcp/server/delete',
  status: 'mcp/server/status',
  probe: 'mcp/server/probe',
  probeAll: 'mcp/server/probe-all',
} as const

/** 后端可能给 enabled: 0/1 或布尔，或 lastReachable: 0/1/null，这里统一归一成布尔 */
function normalize(item: McpServerItem): McpServerItem {
  return {
    ...item,
    enabled: toBool(item.enabled),
    lastReachable:
      item.lastReachable === null || item.lastReachable === undefined
        ? null
        : toBool(item.lastReachable),
  }
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return Boolean(v)
}

/**
 * MCP 服务列表（不分页：接入数量级小，筛选在前端做）。
 * 不吞异常：空数组与「接口没通」是两回事，错误交给页面原样展示。
 */
export async function fetchMcpServerList(params?: { keyword?: string }): Promise<McpServerItem[]> {
  const res = await request<McpServerItem[]>(EP.list, params ?? {}, { method: 'GET' })
  return (Array.isArray(res) ? res : []).map(normalize)
}

export async function fetchMcpServerDetail(id: number): Promise<McpServerDetail | null> {
  const res = await request<McpServerDetail | null>(EP.detail, { id }, { method: 'GET' })
  return res ? { ...res, ...normalize(res) } : null
}

/**
 * 接入 / 更新 MCP 服务（带 id 即更新）。
 * 保存后后端执行 initialize → tools/list，成功即同步工具注册表（口径同 wan mcp-store）。
 */
export async function saveMcpServer(form: McpServerForm): Promise<Ack> {
  return request<Ack>(EP.save, { ...form })
}

/** 删除（逻辑删除；已同步工具标 stale 保留审计，引用方保留历史记录） */
export async function deleteMcpServer(id: number): Promise<Ack> {
  return request<Ack>(EP.delete, { id }, { method: 'POST', paramsIn: 'query' })
}

/**
 * 启用 / 停用。停用仍被引用的服务时后端拒绝并提示需 confirmed=true，
 * 前端在确认弹窗后带 confirmed 重试（口径同 wan enable_change_blocked）。
 */
export async function changeMcpServerStatus(
  id: number,
  enabled: boolean,
  confirmed = false,
): Promise<Ack> {
  return request<Ack>(
    EP.status,
    { id, enabled: enabled ? 1 : 0, ...(confirmed ? { confirmed: true } : {}) },
    { method: 'POST', paramsIn: 'query' },
  )
}

/** 连通测试单个服务（成功自动 tools/list 同步工具清单）；probe 是重 IO，放宽超时到 60s */
export async function probeMcpServer(id: number): Promise<Ack & { toolCount?: number }> {
  return request<Ack & { toolCount?: number }>(
    EP.probe,
    { id },
    { method: 'POST', paramsIn: 'query', timeoutMs: 60000 },
  )
}

/** 批量连通测试全部服务 */
export async function probeAllMcpServers(): Promise<Ack> {
  return request<Ack>(EP.probeAll, {}, { method: 'POST', timeoutMs: 120000 })
}
