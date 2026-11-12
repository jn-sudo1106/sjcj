/**
 * 来源组列表（后端 `source-group/list`）的本机缓存（1105）。
 *
 * 为什么需要：这个接口在后端要跑「组主查询 + 全组流程绑定 JOIN」，186 上正常 1.4s 起步，
 * 库被流程/源列表的重聚合压住时 10s+；而它只是「我的分组」左栏的一个目录列表。
 * 缓存只用来让首屏立刻有内容，**每次打开仍然会后台刷新**（stale-while-revalidate），
 * 不改变任何权限/数据口径：缓存里的组名、成员数都与服务端一致，只是可能晚一次刷新。
 *
 * 边界：
 * - 只缓存列表展示需要的字段（整条 SourceGroup 一起存，结构简单）；
 * - key 带账号 + 环境（origin + VITE_BACKEND_ENV），换账号/换后端不会串数据；
 * - 读到的数据校验失败就当作没缓存，绝不把脏数据渲染出去；
 * - 没有账号时不读不写（登录态未就绪时无从判断归属）。
 */
import type { SourceGroup } from '@/api'

const PREFIX = 'ce:source-groups:v1'
/** 缓存最多留 24h：超过就当没有，避免翻出很久以前的组列表（刷新仍会覆盖） */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface CachedGroups { version: 1; savedAt: number; groups: SourceGroup[] }

export function sourceGroupCacheKey(account: string, backend: string): string {
  return `${PREFIX}:${encodeURIComponent(backend)}:${encodeURIComponent(account)}`
}

/** 缓存环境标识：同一浏览器可能连不同后端（186 / 133 / 217），不能互相复用 */
export function sourceGroupCacheBackend(): string {
  const env = (import.meta.env.VITE_BACKEND_ENV as string | undefined) ?? ''
  return `${window.location.origin}|${env}`
}

function isGroup(value: unknown): value is SourceGroup {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.sourceGroupId === 'string' && !!row.sourceGroupId
    && typeof row.sourceGroupName === 'string'
    && typeof row.sourceGroupCode === 'string'
    && Array.isArray(row.flowIds)
    && typeof row.revision === 'number'
}

/** 解析一段缓存文本；格式/字段不对返回 null（调用方当作无缓存） */
export function parseSourceGroupCache(raw: string | null, now = Date.now()): SourceGroup[] | null {
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const cache = value as Partial<CachedGroups>
  if (cache.version !== 1 || typeof cache.savedAt !== 'number' || !Array.isArray(cache.groups)) return null
  if (!Number.isFinite(cache.savedAt) || now - cache.savedAt > MAX_AGE_MS || cache.savedAt > now + 60_000) return null
  if (!cache.groups.length || !cache.groups.every(isGroup)) return null
  return cache.groups
}

export function readSourceGroupCache(key: string, now = Date.now()): SourceGroup[] | null {
  try { return parseSourceGroupCache(localStorage.getItem(key), now) } catch { return null }
}

export function writeSourceGroupCache(key: string, groups: SourceGroup[], now = Date.now()): void {
  // 空列表不写：可能是权限过滤后的空结果，也可能只是这一次请求异常，没必要覆盖旧的可用缓存
  if (!groups.length) return
  try {
    const payload: CachedGroups = { version: 1, savedAt: now, groups }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // 隐私模式 / 配额满：缓存只是加速手段，失败不影响主流程
  }
}

/** 测试与「清本机数据」用 */
export function clearSourceGroupCache(key?: string): void {
  try {
    if (key) { localStorage.removeItem(key); return }
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const k of keys) if (k && k.startsWith(`${PREFIX}:`)) localStorage.removeItem(k)
  } catch { /* ignore */ }
}