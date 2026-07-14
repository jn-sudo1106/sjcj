import type { Paged, RawFile, RawFileQuery, RawFileStats } from '../types'
import { SOURCES, mockSourceSteps } from './sources'

// 原始文件 mock（0711 R11）：文件视图仅子源态展示，按 sourceId 聚合该源每个节点产出的原始文件。
// 首期占位：按源的 dataCount 确定性派生文件条数与状态，不追求跟真实抓取内容对应。
const CONTENT_TYPES = ['html', 'pdf', 'json'] as const

type MockRawFile = RawFile & { state: 'C' | 'E' }

function dataUrl(mime: string, content: string): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`
}

function imagePreview(title: string, subtitle: string, color: string): string {
  return dataUrl('image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#f8fafc"/><rect width="960" height="10" fill="${color}"/>
  <rect x="64" y="72" width="832" height="396" rx="20" fill="#ffffff" stroke="#dbe3ee"/>
  <text x="112" y="190" fill="${color}" font-size="28" font-family="Arial, PingFang SC, Microsoft YaHei">采集文件预览</text>
  <text x="112" y="270" fill="#172033" font-size="42" font-weight="700" font-family="Arial, PingFang SC, Microsoft YaHei">${title}</text>
  <text x="112" y="330" fill="#64748b" font-size="24" font-family="Arial, PingFang SC, Microsoft YaHei">${subtitle}</text>
  <text x="112" y="420" fill="#94a3b8" font-size="20" font-family="Arial, PingFang SC, Microsoft YaHei">青龙智能采集中心 · 演示抓取产物</text>
</svg>`)
}

function demoFilesOfSource(sourceId: string, siteId: string, steps: ReturnType<typeof mockSourceSteps>): MockRawFile[] {
  const listNode = steps[0]?.stepId
  const detailNode = steps[1]?.stepId || listNode
  if (!listNode) return []

  if (sourceId === 'NEWS5521') {
    const preview = imagePreview('新浪财经 · 要闻快讯', '2026-06-19 08:06 抓取快照', '#2563eb')
    return [
      { fileId: 'NEWS5521-demo-cover', siteId, sourceId, nodeId: listNode, fileName: '新浪财经要闻快讯_抓取封面.svg', contentType: 'image/svg+xml', size: 12840, md5: 'demo-news-cover', attributes: { source: '新浪财经', batch: '20260619-0806', preview: '首条可站内预览' }, createdAt: '2026-06-19 08:06:20', viewUrl: preview, downloadUrl: preview, state: 'C' },
      { fileId: 'NEWS5521-demo-page', siteId, sourceId, nodeId: listNode, fileName: '新浪财经要闻快讯_列表页.html', contentType: 'html', size: 36820, md5: 'demo-news-page', attributes: { page: 1, records: 12 }, createdAt: '2026-06-19 08:06:18', viewUrl: dataUrl('text/html', '<main style="font-family:Arial;padding:32px"><h1>新浪财经 · 要闻快讯</h1><p>演示抓取页面，共 12 条快讯。</p><ul><li>市场早盘震荡上行</li><li>行业数据更新</li><li>公司公告发布</li></ul></main>'), downloadUrl: dataUrl('text/html', '<h1>新浪财经要闻快讯演示页面</h1>'), state: 'C' },
      { fileId: 'NEWS5521-demo-detail', siteId, sourceId, nodeId: detailNode, fileName: '新浪财经要闻快讯_解析结果.json', contentType: 'json', size: 9250, md5: 'demo-news-json', attributes: { parser: '详情解析', records: 12 }, createdAt: '2026-06-19 08:06:20', viewUrl: dataUrl('application/json', JSON.stringify({ source: '新浪财经', records: 12, status: 'success' }, null, 2)), downloadUrl: dataUrl('application/json', JSON.stringify({ source: '新浪财经', records: 12, status: 'success' }, null, 2)), state: 'C' },
    ]
  }

  if (sourceId === '600519') {
    const preview = imagePreview('贵州茅台 · 公司公告', '2026-06-19 公告附件抓取快照', '#0f766e')
    return [
      { fileId: '600519-demo-cover', siteId, sourceId, nodeId: listNode, fileName: '贵州茅台公司公告_抓取封面.svg', contentType: 'image/svg+xml', size: 13120, md5: 'demo-notice-cover', attributes: { stockCode: '600519', batch: '20260619-0701', preview: '首条可站内预览' }, createdAt: '2026-06-19 07:01:05', viewUrl: preview, downloadUrl: preview, state: 'C' },
      { fileId: '600519-demo-page', siteId, sourceId, nodeId: listNode, fileName: '贵州茅台_公司公告列表.html', contentType: 'html', size: 27400, md5: 'demo-notice-page', attributes: { page: 1, notices: 12 }, createdAt: '2026-06-19 07:01:02', viewUrl: dataUrl('text/html', '<main style="font-family:Arial;padding:32px"><h1>贵州茅台 · 公司公告</h1><p>演示公告列表，已抓取 12 条公告。</p><ol><li>年度报告摘要</li><li>临时股东大会决议</li><li>经营数据公告</li></ol></main>'), downloadUrl: dataUrl('text/html', '<h1>贵州茅台公司公告演示页面</h1>'), state: 'C' },
      { fileId: '600519-demo-detail', siteId, sourceId, nodeId: detailNode, fileName: '贵州茅台公司公告_解析结果.json', contentType: 'json', size: 7860, md5: 'demo-notice-json', attributes: { parser: '公告详情解析', notices: 12 }, createdAt: '2026-06-19 07:01:05', viewUrl: dataUrl('application/json', JSON.stringify({ source: '贵州茅台公司公告', notices: 12, status: 'success' }, null, 2)), downloadUrl: dataUrl('application/json', JSON.stringify({ source: '贵州茅台公司公告', notices: 12, status: 'success' }, null, 2)), state: 'C' },
    ]
  }

  return []
}

function filesOfSource(sourceId: string): MockRawFile[] {
  const src = SOURCES.find((s) => s.sourceId === sourceId)
  if (!src) return []
  const steps = mockSourceSteps({ sourceId })
  if (!steps.length) return []
  const base = src.dataCount ?? 20
  const capturedAt = src.lastSuccessAt || src.lastTaskAt || '2026-06-19 08:00:00'
  const files = demoFilesOfSource(sourceId, src.siteId ?? '', steps)
  steps.forEach((step, si) => {
    // 每个节点的文件数按 dataCount 确定性派生，避免几万条无意义占位膨胀
    const count = Math.min(30, Math.max(3, Math.round(base / (steps.length * 8))))
    for (let i = 0; i < count; i++) {
      const idx = i + 1
      const contentType = CONTENT_TYPES[(si + idx) % CONTENT_TYPES.length]
      const isErr = idx % 11 === 0
      files.push({
        fileId: `${step.stepId}-f${String(idx).padStart(3, '0')}`,
        siteId: src.siteId ?? '',
        sourceId,
        nodeId: step.stepId,
        fileName: `${step.name}_${idx}.${contentType}`,
        contentType,
        size: 4096 + idx * 733 + si * 1000,
        md5: `md5-${step.stepId}-${idx}`,
        attributes: { collector: step.name, sequence: idx },
        state: isErr ? 'E' : 'C',
        createdAt: capturedAt,
        viewUrl: isErr ? undefined : dataUrl('text/html', `<main style="font-family:Arial;padding:32px"><h1>${step.name}</h1><p>演示抓取产物 #${idx}</p></main>`),
        downloadUrl: isErr ? undefined : dataUrl('text/plain', `${step.name} 演示抓取产物 #${idx}`),
      })
    }
  })
  return files
}

function matches(f: MockRawFile, q: RawFileQuery): boolean {
  if (q.nodeId && f.nodeId !== q.nodeId) return false
  if (q.contentType && f.contentType !== q.contentType) return false
  if (q.dateFrom && f.createdAt < q.dateFrom) return false
  if (q.dateTo && f.createdAt > q.dateTo) return false
  return true
}

export function mockFilePaged(params?: Record<string, unknown>): Paged<RawFile> {
  const q = params as unknown as RawFileQuery
  const sourceIds = SOURCES
    .filter((source) => source.siteId === q.siteId && (!q.sourceId || source.sourceId === q.sourceId))
    .map((source) => source.sourceId)
  const filtered = sourceIds
    .flatMap(filesOfSource)
    .filter((file) => file.state === 'C' && matches(file, q))
  const page = Math.max(1, Number(q?.page ?? 1))
  const size = Math.max(1, Number(q?.size ?? 20))
  const start = (page - 1) * size
  return {
    total: filtered.length,
    list: filtered.slice(start, start + size).map(({ state: _state, ...file }) => file),
  }
}

export function mockFileStats(params?: Record<string, unknown>): RawFileStats {
  const q = params as unknown as RawFileQuery
  const sourceIds = SOURCES
    .filter((source) => source.siteId === q.siteId && (!q.sourceId || source.sourceId === q.sourceId))
    .map((source) => source.sourceId)
  const all = sourceIds.flatMap(filesOfSource).filter((file) => file.state === 'C' && matches(file, q))
  return {
    total: all.length,
    totalSize: all.reduce((n, f) => n + f.size, 0),
    latestCreatedAt: all.map((f) => f.createdAt).sort().at(-1),
  }
}
