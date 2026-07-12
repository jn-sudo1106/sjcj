import type { Paged, RawFile, RawFileQuery, RawFileStats } from '../types'
import { SOURCES, mockSourceSteps } from './sources'

// 原始文件 mock（0711 R11）：文件视图仅子源态展示，按 sourceId 聚合该源每个节点产出的原始文件。
// 首期占位：按源的 dataCount 确定性派生文件条数与状态，不追求跟真实抓取内容对应。
const CONTENT_TYPES = ['html', 'pdf', 'json'] as const

function filesOfSource(sourceId: string): RawFile[] {
  const src = SOURCES.find((s) => s.sourceId === sourceId)
  if (!src) return []
  const steps = mockSourceSteps({ sourceId })
  if (!steps.length) return []
  const base = src.dataCount ?? 20
  const files: RawFile[] = []
  steps.forEach((step, si) => {
    // 每个节点的文件数按 dataCount 确定性派生，避免几万条无意义占位膨胀
    const count = Math.min(30, Math.max(3, Math.round(base / (steps.length * 8))))
    for (let i = 0; i < count; i++) {
      const idx = i + 1
      const contentType = CONTENT_TYPES[(si + idx) % CONTENT_TYPES.length]
      const isErr = idx % 11 === 0
      files.push({
        fileId: `${step.stepId}-f${String(idx).padStart(3, '0')}`,
        sourceId,
        nodeId: step.stepId,
        fileName: `${step.name}_${idx}.${contentType}`,
        contentType,
        size: 4096 + idx * 733 + si * 1000,
        state: isErr ? 'E' : 'C',
        createdAt: `2026-07-${String(1 + (idx % 10)).padStart(2, '0')} ${String(8 + (idx % 12)).padStart(2, '0')}:00:00`,
        viewUrl: isErr ? undefined : `https://files.example.com/view/${step.stepId}/${idx}`,
        downloadUrl: isErr ? undefined : `https://files.example.com/download/${step.stepId}/${idx}`,
      })
    }
  })
  return files
}

function matches(f: RawFile, q: RawFileQuery): boolean {
  if (q.nodeId && f.nodeId !== q.nodeId) return false
  if (q.contentType && f.contentType !== q.contentType) return false
  if (q.state && f.state !== q.state) return false
  if (q.dateFrom && f.createdAt < q.dateFrom) return false
  if (q.dateTo && f.createdAt > q.dateTo) return false
  return true
}

export function mockFilePaged(params?: Record<string, unknown>): Paged<RawFile> {
  const q = params as unknown as RawFileQuery
  const all = filesOfSource(String(q?.sourceId ?? ''))
  const filtered = all.filter((f) => matches(f, q))
  const page = Math.max(1, Number(q?.page ?? 1))
  const size = Math.max(1, Number(q?.size ?? 20))
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

export function mockFileStats(params?: Record<string, unknown>): RawFileStats {
  const sourceId = String(params?.sourceId ?? '')
  const all = filesOfSource(sourceId)
  return {
    total: all.length,
    totalSize: all.reduce((n, f) => n + f.size, 0),
    failed: all.filter((f) => f.state === 'E').length,
    latestCreatedAt: all.map((f) => f.createdAt).sort().at(-1),
  }
}
