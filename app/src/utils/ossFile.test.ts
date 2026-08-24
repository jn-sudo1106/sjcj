import { afterEach, describe, expect, it, vi } from 'vitest'
import { extFromName, fetchOssFile, mimeTypeOf, ossFileUrl, previewKindOf } from './ossFile'

describe('ossFileUrl', () => {
  it('路径原样拼接，不做 encodeURIComponent（旧平台亦然，两种写法后端都认）', () => {
    expect(ossFileUrl('/qinlong/eia.gov/a.xlsx')).toBe('/oss/api/oss/download?fileId=/qinlong/eia.gov/a.xlsx')
  })
})

describe('previewKindOf', () => {
  it('按真实类型分布分派：Excel 是主要类型，其次 PDF', () => {
    expect(previewKindOf('xlsx')).toBe('excel')
    expect(previewKindOf('XLS')).toBe('excel')
    expect(previewKindOf('.csv')).toBe('excel')
    expect(previewKindOf('pdf')).toBe('pdf')
    expect(previewKindOf('png')).toBe('image')
    expect(previewKindOf('txt')).toBe('text')
  })

  it('未知类型与空值一律不预览，只给下载', () => {
    expect(previewKindOf('zip')).toBe('none')
    expect(previewKindOf('')).toBe('none')
    expect(previewKindOf(null)).toBe('none')
  })
})

describe('mimeTypeOf', () => {
  // 2026-08-24 生产实测：不带 type 的 blob URL 被浏览器按 text/plain 处理，
  // PDF 在 <iframe> 里整页显示 `%PDF-1.7 …` 二进制原文而不是渲染成文档。
  it('给 blob 用的 MIME，PDF 与图片都要有', () => {
    expect(mimeTypeOf('pdf')).toBe('application/pdf')
    expect(mimeTypeOf('.PDF')).toBe('application/pdf')
    expect(mimeTypeOf('jpg')).toBe('image/jpeg')
    expect(mimeTypeOf('jpeg')).toBe('image/jpeg')
    expect(mimeTypeOf('png')).toBe('image/png')
  })

  it('认不出的类型返回空串——交给浏览器嗅探，不瞎标一个类型', () => {
    expect(mimeTypeOf('xlsx')).toBe('')
    expect(mimeTypeOf('')).toBe('')
    expect(mimeTypeOf(null)).toBe('')
  })
})

describe('extFromName', () => {
  it('K7 缺失时从文件名兜底推断', () => {
    expect(extFromName('a/b/c.XLSX')).toBe('xlsx')
    expect(extFromName('content.txt')).toBe('txt')
    expect(extFromName('无扩展名')).toBe('')
  })
})

describe('fetchOssFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('不带凭据请求——OSS 无鉴权，带上 sjcj 的会话 Cookie 反而返回 500（生产实测）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
    vi.stubGlobal('fetch', fetchMock)

    const buf = await fetchOssFile('/qinlong/a.xlsx')

    expect(buf.byteLength).toBe(8)
    expect(fetchMock).toHaveBeenCalledWith('/oss/api/oss/download?fileId=/qinlong/a.xlsx', { credentials: 'omit' })
  })

  it('失败时带上状态码抛出，不静默返回空内容', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }))
    await expect(fetchOssFile('/qinlong/a.xlsx')).rejects.toThrow('HTTP 500')
  })
})
