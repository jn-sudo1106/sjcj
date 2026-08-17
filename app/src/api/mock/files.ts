import type { Paged, RawFile, RawFileQuery, RawFileStats } from '../types'
import { SOURCES, mockSourceSteps } from './sources'

// 原始文件 mock（0711 R11 落地；0812 计划 M3-1 字段对齐旧平台后同步改写）：文件视图仅源态
// 展示，按 sourceId 聚合该源每个节点产出的原始文件。首期占位：按源的 dataCount 确定性派生
// 文件条数，不追求跟真实抓取内容对应；抓取失败的节点直接不产出文件行，不再靠 state 过滤
// （旧平台 state 是"初始/被消重"的消重口径，跟"抓没抓成功"是两回事，不能借用来表示失败）。
const CONTENT_TYPES = ['html', 'pdf', 'json'] as const

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

function demoFilesOfSource(sourceId: string, siteId: string, steps: ReturnType<typeof mockSourceSteps>): RawFile[] {
  const listNode = steps[0]?.stepId
  const detailNode = steps[1]?.stepId || listNode
  if (!listNode) return []

  if (sourceId === 'NEWS5521') {
    const preview = imagePreview('新浪财经 · 要闻快讯', '2026-06-19 08:06 抓取快照', '#2563eb')
    return [
      { attachId: 'NEWS5521-demo-cover', fileId: listNode, state: 'C', siteId, sourceId, nodeId: listNode, realName: '新浪财经要闻快讯_抓取封面.svg', storePath: preview, contentType: 'image/svg+xml', fileSize: 12840, ip: '10.20.30.41', encode: 'UTF-8', downUrl: preview, md5: 'demo-news-cover', attributes: { source: '新浪财经', batch: '20260619-0806', preview: '首条可站内预览' }, createDt: '2026-06-19 08:06:20', viewUrl: preview, downloadUrl: preview },
      { attachId: 'NEWS5521-demo-page', fileId: listNode, state: 'C', siteId, sourceId, nodeId: listNode, realName: '新浪财经要闻快讯_列表页.html', storePath: dataUrl('text/html', '<main style="font-family:Arial;padding:32px"><h1>新浪财经 · 要闻快讯</h1><p>演示抓取页面，共 12 条快讯。</p><ul><li>市场早盘震荡上行</li><li>行业数据更新</li><li>公司公告发布</li></ul></main>'), contentType: 'html', fileSize: 36820, ip: '10.20.30.41', encode: 'UTF-8', downUrl: dataUrl('text/html', '<h1>新浪财经要闻快讯演示页面</h1>'), md5: 'demo-news-page', attributes: { page: 1, records: 12 }, createDt: '2026-06-19 08:06:18', viewUrl: dataUrl('text/html', '<main style="font-family:Arial;padding:32px"><h1>新浪财经 · 要闻快讯</h1><p>演示抓取页面，共 12 条快讯。</p><ul><li>市场早盘震荡上行</li><li>行业数据更新</li><li>公司公告发布</li></ul></main>'), downloadUrl: dataUrl('text/html', '<h1>新浪财经要闻快讯演示页面</h1>') },
      { attachId: 'NEWS5521-demo-detail', fileId: detailNode, state: 'C', siteId, sourceId, nodeId: detailNode, realName: '新浪财经要闻快讯_解析结果.json', storePath: dataUrl('application/json', JSON.stringify({ source: '新浪财经', records: 12, status: 'success' }, null, 2)), contentType: 'json', fileSize: 9250, ip: '10.20.30.42', encode: 'UTF-8', downUrl: dataUrl('application/json', JSON.stringify({ source: '新浪财经', records: 12, status: 'success' }, null, 2)), md5: 'demo-news-json', attributes: { parser: '详情解析', records: 12 }, createDt: '2026-06-19 08:06:20', viewUrl: dataUrl('application/json', JSON.stringify({ source: '新浪财经', records: 12, status: 'success' }, null, 2)), downloadUrl: dataUrl('application/json', JSON.stringify({ source: '新浪财经', records: 12, status: 'success' }, null, 2)) },
    ]
  }

  if (sourceId === '600519') {
    const preview = imagePreview('贵州茅台 · 公司公告', '2026-06-19 公告附件抓取快照', '#0f766e')
    return [
      { attachId: '600519-demo-cover', fileId: listNode, state: 'C', siteId, sourceId, nodeId: listNode, realName: '贵州茅台公司公告_抓取封面.svg', storePath: preview, contentType: 'image/svg+xml', fileSize: 13120, ip: '10.20.31.11', encode: 'UTF-8', downUrl: preview, md5: 'demo-notice-cover', attributes: { stockCode: '600519', batch: '20260619-0701', preview: '首条可站内预览' }, createDt: '2026-06-19 07:01:05', viewUrl: preview, downloadUrl: preview },
      { attachId: '600519-demo-page', fileId: listNode, state: 'C', siteId, sourceId, nodeId: listNode, realName: '贵州茅台_公司公告列表.html', storePath: dataUrl('text/html', '<main style="font-family:Arial;padding:32px"><h1>贵州茅台 · 公司公告</h1><p>演示公告列表，已抓取 12 条公告。</p><ol><li>年度报告摘要</li><li>临时股东大会决议</li><li>经营数据公告</li></ol></main>'), contentType: 'html', fileSize: 27400, ip: '10.20.31.11', encode: 'UTF-8', downUrl: dataUrl('text/html', '<h1>贵州茅台公司公告演示页面</h1>'), md5: 'demo-notice-page', attributes: { page: 1, notices: 12 }, createDt: '2026-06-19 07:01:02', viewUrl: dataUrl('text/html', '<main style="font-family:Arial;padding:32px"><h1>贵州茅台 · 公司公告</h1><p>演示公告列表，已抓取 12 条公告。</p><ol><li>年度报告摘要</li><li>临时股东大会决议</li><li>经营数据公告</li></ol></main>'), downloadUrl: dataUrl('text/html', '<h1>贵州茅台公司公告演示页面</h1>') },
      { attachId: '600519-demo-detail', fileId: detailNode, state: 'C', siteId, sourceId, nodeId: detailNode, realName: '贵州茅台公司公告_解析结果.json', storePath: dataUrl('application/json', JSON.stringify({ source: '贵州茅台公司公告', notices: 12, status: 'success' }, null, 2)), contentType: 'json', fileSize: 7860, ip: '10.20.31.12', encode: 'UTF-8', downUrl: dataUrl('application/json', JSON.stringify({ source: '贵州茅台公司公告', notices: 12, status: 'success' }, null, 2)), md5: 'demo-notice-json', attributes: { parser: '公告详情解析', notices: 12 }, createDt: '2026-06-19 07:01:05', viewUrl: dataUrl('application/json', JSON.stringify({ source: '贵州茅台公司公告', notices: 12, status: 'success' }, null, 2)), downloadUrl: dataUrl('application/json', JSON.stringify({ source: '贵州茅台公司公告', notices: 12, status: 'success' }, null, 2)) },
    ]
  }

  return []
}

function filesOfSource(sourceId: string): RawFile[] {
  const src = SOURCES.find((s) => s.sourceId === sourceId)
  if (!src) return []
  const steps = mockSourceSteps({ sourceId })
  if (!steps.length) return []
  const base = src.dataCount ?? 20
  const capturedAt = src.lastSuccessAt || src.lastTaskAt || '2026-06-19 08:00:00'
  const files = demoFilesOfSource(sourceId, src.siteId ?? '', steps)
  steps.forEach((step, si) => {
    // 每个节点的文件数按 dataCount 确定性派生，避免几万条无意义占位膨胀；
    // fileId（批次ID）按"这个节点的这一轮抓取"分组，同一节点的文件共享一个批次。
    const count = Math.min(30, Math.max(3, Math.round(base / (steps.length * 8))))
    for (let i = 0; i < count; i++) {
      const idx = i + 1
      // 每 11 条模拟一次抓取失败：失败的节点轮次不产出文件行，不是"文件存在但状态是失败"。
      if (idx % 11 === 0) continue
      const contentType = CONTENT_TYPES[(si + idx) % CONTENT_TYPES.length]
      const preview = dataUrl('text/html', `<main style="font-family:Arial;padding:32px"><h1>${step.name}</h1><p>演示抓取产物 #${idx}</p></main>`)
      files.push({
        attachId: `${step.stepId}-f${String(idx).padStart(3, '0')}`,
        fileId: step.stepId,
        state: 'C',
        siteId: src.siteId ?? '',
        sourceId,
        nodeId: step.stepId,
        realName: `${step.name}_${idx}.${contentType}`,
        storePath: preview,
        contentType,
        fileSize: 4096 + idx * 733 + si * 1000,
        ip: `10.20.${32 + si}.${10 + idx}`,
        encode: 'UTF-8',
        downUrl: dataUrl('text/plain', `${step.name} 演示抓取产物 #${idx}`),
        md5: `md5-${step.stepId}-${idx}`,
        attributes: { collector: step.name, sequence: idx },
        createDt: capturedAt,
        viewUrl: preview,
        downloadUrl: dataUrl('text/plain', `${step.name} 演示抓取产物 #${idx}`),
      })
    }
  })
  return files
}

function matches(f: RawFile, q: RawFileQuery): boolean {
  if (q.nodeId && f.nodeId !== q.nodeId) return false
  if (q.state && f.state !== q.state) return false
  if (q.attachId && f.attachId !== q.attachId) return false
  if (q.fileId && f.fileId !== q.fileId) return false
  // 旧平台 ext 是逗号分隔的类型列表（如 "xls, doc"），OR 匹配；mock 没有单独的扩展名字段，
  // 借用 contentType 做近似匹配。
  if (q.ext && !q.ext.split(',').map((s) => s.trim()).filter(Boolean).some((ext) => f.contentType.includes(ext))) return false
  return true
}

export function mockFilePaged(params?: Record<string, unknown>): Paged<RawFile> {
  const q = params as unknown as RawFileQuery
  const sourceIds = SOURCES
    .filter((source) => source.siteId === q.siteId && (!q.sourceId || source.sourceId === q.sourceId))
    .map((source) => source.sourceId)
  const filtered = sourceIds.flatMap(filesOfSource).filter((file) => matches(file, q))
  const page = Math.max(1, Number(q?.page ?? 1))
  const size = Math.max(1, Number(q?.size ?? 20))
  const start = (page - 1) * size
  return {
    total: filtered.length,
    list: filtered.slice(start, start + size),
  }
}

export function mockFileStats(params?: Record<string, unknown>): RawFileStats {
  const q = params as unknown as RawFileQuery
  const sourceIds = SOURCES
    .filter((source) => source.siteId === q.siteId && (!q.sourceId || source.sourceId === q.sourceId))
    .map((source) => source.sourceId)
  const all = sourceIds.flatMap(filesOfSource).filter((file) => matches(file, q))
  return {
    total: all.length,
    totalSize: all.reduce((n, f) => n + f.fileSize, 0),
    latestCreatedAt: all.map((f) => f.createDt).sort().at(-1),
  }
}
