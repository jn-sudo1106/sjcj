import { afterEach, describe, expect, it, vi } from 'vitest'
import { extFromFieldHint, extFromName, fetchOssFile, mimeTypeOf, ossFileUrl, ossPathWithExt, ossPublicUrl, previewKindOf, stripContentExt } from './ossFile'

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
    expect(previewKindOf('html')).toBe('html')
    expect(previewKindOf('.HTM')).toBe('html')
    expect(previewKindOf('txt')).toBe('text')
  })

  it('未知类型与空值一律不预览，只给下载', () => {
    expect(previewKindOf('zip')).toBe('none')
    expect(previewKindOf('')).toBe('none')
    expect(previewKindOf(null)).toBe('none')
  })
})

describe('previewKindOf · 音视频（2026-09-23）', () => {
  it('常见音频 / 视频格式分派到 audio / video', () => {
    for (const e of ['mp3', 'WAV', 'm4a', 'aac', 'ogg', 'flac', 'opus']) expect(previewKindOf(e)).toBe('audio')
    for (const e of ['mp4', 'webm', 'ogv', 'mov', '.M4V']) expect(previewKindOf(e)).toBe('video')
  })
  it('音视频 blob 的 MIME：OSS 统一回 octet-stream，不带对的类型播放器不认', () => {
    expect(mimeTypeOf('mp3')).toBe('audio/mpeg')
    expect(mimeTypeOf('m4a')).toBe('audio/mp4')
    expect(mimeTypeOf('mp4')).toBe('video/mp4')
    expect(mimeTypeOf('webm')).toBe('video/webm')
  })
})

describe('mimeTypeOf', () => {
  // 2026-08-24 生产实测：不带 type 的 blob URL 被浏览器按 text/plain 处理，
  // PDF 在 <iframe> 里整页显示 `%PDF-1.7 …` 二进制原文而不是渲染成文档。
  it('给 blob 用的 MIME，PDF 与图片都要有', () => {
    expect(mimeTypeOf('pdf')).toBe('application/pdf')
    expect(mimeTypeOf('html')).toBe('text/html;charset=utf-8')
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

describe('fetchOssFile · 下载进度', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('给了 onProgress 就边读边报，拼回完整字节', async () => {
    const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
    const body = new ReadableStream<Uint8Array>({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close() } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 201, headers: { 'content-length': '5' } })))
    const seen: [number, number][] = []
    const buf = await fetchOssFile('/a.mp3', (r, t) => seen.push([r, t]))
    expect([...new Uint8Array(buf)]).toEqual([1, 2, 3, 4, 5])
    expect(seen).toEqual([[3, 5], [5, 5]])
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

describe('ossPublicUrl（2026-09-09：html 走新窗口打开的独立 origin，与旧平台一致）', () => {
  it('把业务后端端口换成 OSS 的 9102，产出绝对地址——不是同源的 /oss 前缀', () => {
    const url = ossPublicUrl('/qinlong/dds/20260908/x.html')
    expect(url).toMatch(/^https?:\/\//)
    expect(url).toContain(':9102/api/oss/download?fileId=/qinlong/dds/20260908/x.html')
    expect(url.startsWith('/oss')).toBe(false)
  })

  it('与同源取数地址是两条路：fetch 仍走 /oss（跨源读字节会被 CORS 拒），新窗口才走绝对地址', () => {
    const path = '/qinlong/a.html'
    expect(ossFileUrl(path)).toBe('/oss/api/oss/download?fileId=/qinlong/a.html')
    expect(ossPublicUrl(path)).not.toBe(ossFileUrl(path))
  })
})

// 2026-09-18：公众号正文路径没有 .txt 后缀，只靠文件名推断必然落空。
describe('extFromFieldHint · 路径没有后缀时按字段语义判类型', () => {
  const GZH_PATH = '/gzh/gzh_msg/MzU2Njc5NjY0OQ==/2020-01-29/d0bc4a044f965c2058475987760f1c6f'

  it('公众号「正文路径」(K9/URLMD5) 判成 txt —— 这是本次要修的那条', () => {
    expect(extFromName(GZH_PATH.split('/').pop())).toBe('')   // 先确认文件名这条路确实取不到
    expect(extFromFieldHint({ prop: 'urlmd5', columnName: 'K9', desc: '正文路径' })).toBe('txt')
    expect(previewKindOf(extFromFieldHint({ prop: 'urlmd5', columnName: 'K9', desc: '正文路径' }))).toBe('text')
  })

  it('新闻类正文路径 (K6 / content_path) 仍判 txt', () => {
    expect(extFromFieldHint({ columnName: 'K6', prop: 'content_path', desc: '正文' })).toBe('txt')
    expect(extFromFieldHint({ prop: 'content_path' })).toBe('txt')
  })

  it('网页快照 (K17 / html / snapshot) 判 html，且优先于正文判定', () => {
    expect(extFromFieldHint({ columnName: 'K17', desc: '网页路径' })).toBe('html')
    expect(extFromFieldHint({ prop: 'html', desc: '正文' })).toBe('html')
    expect(extFromFieldHint({ prop: 'content_html_path', columnName: 'K17', desc: '正文html路径' })).toBe('html')
    expect(extFromFieldHint({ prop: 'snapshot', desc: '快照' })).toBe('html')
  })

  it('正文文本类识别：text_path / K9 / 文本路径 / 纯文本等均正确判 txt', () => {
    expect(extFromFieldHint({ prop: 'text_path', desc: '文本路径' })).toBe('txt')
    expect(extFromFieldHint({ columnName: 'K9', desc: 'URLMD5' })).toBe('txt')
    expect(extFromFieldHint({ prop: 'body', desc: '文章内容' })).toBe('txt')
    expect(extFromFieldHint({ prop: 'txt', desc: '正文' })).toBe('txt')
  })

  it('认不出来就返回空串，交给调用方回退到文件名——不瞎猜成 txt', () => {
    expect(extFromFieldHint({ prop: 'pic_path', desc: '图片地址' })).toBe('')
    expect(extFromFieldHint({})).toBe('')
    expect(extFromFieldHint(undefined)).toBe('')
  })
})

describe('stripContentExt · 剥离正文与网页后缀', () => {
  it('正确剥离 .html / .htm / .txt 后缀（大小写不敏感）', () => {
    expect(stripContentExt('/qinlong/dds/sample.html')).toBe('/qinlong/dds/sample')
    expect(stripContentExt('/qinlong/dds/sample.HTM')).toBe('/qinlong/dds/sample')
    expect(stripContentExt('/qinlong/dds/sample.txt')).toBe('/qinlong/dds/sample')
    expect(stripContentExt('/qinlong/dds/sample.TXT')).toBe('/qinlong/dds/sample')
  })

  it('保留非文本/网页的其它后缀（如 pdf / xlsx / mp3）', () => {
    expect(stripContentExt('/data/file.pdf')).toBe('/data/file.pdf')
    expect(stripContentExt('/data/file.xlsx')).toBe('/data/file.xlsx')
    expect(stripContentExt('/data/file.mp3')).toBe('/data/file.mp3')
  })

  it('无后缀路径或空值安全返回', () => {
    expect(stripContentExt('/gzh/msg/3e19f177')).toBe('/gzh/msg/3e19f177')
    expect(stripContentExt('')).toBe('')
    expect(stripContentExt(null)).toBe('')
    expect(stripContentExt(undefined)).toBe('')
  })
})

// 2026-09-18 生产实测：库里存的公众号正文路径少了后缀，原样去取 OSS 直接 404。
describe('ossPathWithExt · 补齐落库时丢掉的后缀', () => {
  const GZH = '/gzh/gzh_msg/MzU2Njc5NjY0OQ==/2020-01-29/d0bc4a044f965c2058475987760f1c6f'

  it('无后缀 + 猜出 txt → 补成 .txt（实测这条才取得到，2892 字节与 K13 正文大小一致）', () => {
    expect(ossPathWithExt(GZH, 'txt')).toBe(`${GZH}.txt`)
    expect(ossFileUrl(ossPathWithExt(GZH, 'txt'))).toContain(`${GZH}.txt`)
  })

  it('路径自带后缀时一概不动——它是实打实的对象名，猜测不该覆盖事实', () => {
    expect(ossPathWithExt('/qinlong/a/b.html', 'txt')).toBe('/qinlong/a/b.html')
    expect(ossPathWithExt('/qinlong/a/b.xlsx', 'txt')).toBe('/qinlong/a/b.xlsx')
  })

  it('猜不出类型就原样返回，不瞎补', () => {
    expect(ossPathWithExt(GZH, '')).toBe(GZH)
    expect(ossPathWithExt(GZH, null)).toBe(GZH)
    expect(ossPathWithExt(GZH, extFromFieldHint({ prop: 'pic_path', desc: '图片地址' }))).toBe(GZH)
  })

  it('带点的 ext 也认（.txt / txt 等价）', () => {
    expect(ossPathWithExt(GZH, '.txt')).toBe(`${GZH}.txt`)
  })

  it('空路径不产生 ".txt" 这种垃圾值', () => {
    expect(ossPathWithExt('', 'txt')).toBe('')
  })
})
