// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

describe('网站读取 HTTP 契约', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', 'production')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sitePaged 用 POST 映射筛选条件，并兼容 sourceCnt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{
        siteId: 11, siteName: '财经网站', categoryId: 7, categoryName: '/新闻/财经',
        sourceCnt: 3, errorCnt: 1, dataTotal: 20, lastInsert: '2026-08-12 10:00:00', updateDt: '2026-08-12 10:10:00',
      }],
    }))
    const { siteApi } = await import('./index')

    const result = await siteApi.sitePaged({ page: 2, size: 30, keyword: '财经', state: 'error' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/site/sitePaged')
    expect(init.method).toBe('POST')
    // POST 但参数在 query：真实后端不读 JSON body（2026-09-16 生产实测，见 index.ts 注释）
    expect(init.body).toBeUndefined()
    expect(Object.fromEntries(new URL(String(url), 'http://local.test').searchParams))
      .toEqual({ page: '2', limit: '30', name: '财经', state: 'ERROR' })
    expect(result).toEqual({ total: 1, list: [expect.objectContaining({
      siteId: '11', name: '财经网站', category: '新闻', categoryPath: '/新闻/财经', sourceCount: 3, errorCount: 1,
    })] })
  })

  it('sitePaged 只透传网站名，不带 sourceName（真实后端忽略它并原样返回整页）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 0, data: [] }))
    const { siteApi } = await import('./index')

    await siteApi.sitePaged({ page: 1, size: 1000, name: '新浪', sourceName: '明阳科技' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const query = new URL(String(url), 'http://local.test').searchParams
    expect(Object.fromEntries(query)).toEqual({ page: '1', limit: '1000', name: '新浪' })
    expect(query.has('sourceName')).toBe(false)
  })

  it('sitePaged 把分类筛选映射为旧契约的 categoryIds；未选分类不携带该字段', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 0, data: [] }))
    const { siteApi } = await import('./index')

    await siteApi.sitePaged({ page: 1, size: 20, category: '1400935' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(Object.fromEntries(new URL(String(url), 'http://local.test').searchParams))
      .toEqual({ page: '1', limit: '20', categoryIds: '1400935' })

    await siteApi.sitePaged({ page: 1, size: 20 })
    const [noCategoryUrl] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(String(noCategoryUrl), 'http://local.test').searchParams.has('categoryIds')).toBe(false)
  })

  // 分类筛选在真实后端下长期静默失效的根因：参数发在了 JSON body 里，而后端只读 query。
  // 2026-09-16 生产实测：body 传 name/limit/categoryIds 一律无效，恒返回全量第一页。
  it('sitePaged 多选分类用逗号拼进同一个 categoryIds（后端 OR 语义）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 0, data: [] }))
    const { siteApi } = await import('./index')

    await siteApi.sitePaged({ page: 1, size: 20, category: '9009005,9009336' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(String(url), 'http://local.test').searchParams.get('categoryIds')).toBe('9009005,9009336')
  })

  it('siteSummary 用 GET 获取真实顶部统计，并映射 errorCnt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', data: { total: 3, sourceTotal: 12536, notifyCount: 2, errorCnt: 2731 },
    }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteSummary()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/site/summary')
    expect(init.method).toBe('GET')
    expect(result).toEqual({ total: 3, sourceTotal: 12536, notifyCount: 2, errorCount: 2731 })
  })

  it('siteDetail 用 GET，并兼容详情的 sourceCount 与站级错误兜底', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', data: { siteId: 11, siteName: '财经网站', sourceCount: 4, siteHealth: 'ERROR', dataTotal: 42 },
    }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteDetail('11')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/site/detail?siteId=11')
    expect(init.method).toBe('GET')
    expect(result).toMatchObject({ siteId: '11', name: '财经网站', sourceCount: 4, errorCount: 4, dataCount: 42 })
  })

  it('siteCreate 在 API 层按 site/add → snatchSave → bindSite 顺序落库', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '新增成功', data: { siteId: 11825 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '源ID:9001' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '关联成功' }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteCreate({
      siteId: 'site-draft', name: '演示网站', category: '新闻', dirId: '7', owner: 'admin', sourceCount: 1, errorCount: 0,
    }, [{ sourceId: 'source-draft', name: '演示源', url: 'https://example.com', configId: '', mainTable: '', owner: 'admin', state: 'C' }])

    const [siteUrl, siteInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [sourceUrl, sourceInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const [bindUrl, bindInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(siteUrl).toContain('/api/v1/site/add')
    expect(siteInit.method).toBe('POST')
    expect(JSON.parse(String(siteInit.body))).toEqual({ siteName: '演示网站', stdSiteName: '演示网站', categoryId: 7 })
    expect(sourceUrl).toContain('/api/v1/snatch/snatchSave')
    expect(sourceInit.method).toBe('POST')
    expect(JSON.parse(String(sourceInit.body))).toMatchObject({
      sourceName: '演示源', sourceUrl: 'https://example.com', categoryId: '7', newConfig: '1',
    })
    expect(bindUrl).toContain('/api/v1/source/bindSite?sourceId=9001&siteId=11825')
    expect(bindInit.method).toBe('GET')
    expect(result).toEqual({ ok: true, demo: false, message: '网站、源已按顺序保存并完成关联', siteId: '11825', sourceId: '9001', sourceIds: ['9001'] })
  })

  it('siteImportSources 对真实网站逐行 snatchSave → bindSite，不再查 mock 夹具', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: '0', data: { siteId: 126, siteName: '土地政策', categoryId: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '源ID:9001' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '关联成功' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '源ID:9002' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '关联成功' }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteImportSources('126', '国务院政策库;https://a.gov.cn/x?q=&t=1;2\n\n自然资源部')

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toContain('/api/v1/site/detail?siteId=126')
    expect(urls[1]).toContain('/api/v1/snatch/snatchSave')
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)))
      .toMatchObject({ sourceName: '国务院政策库', sourceUrl: 'https://a.gov.cn/x?q=&t=1;2', categoryId: '7', newConfig: '1' })
    expect(urls[2]).toContain('/api/v1/source/bindSite?sourceId=9001&siteId=126')
    // 没写 URL 的行补占位（后端 sourceUrl 必填）
    expect(JSON.parse(String((fetchMock.mock.calls[3] as [string, RequestInit])[1].body)).sourceUrl).toMatch(/^http:\/\/placeholder\.invalid\//)
    expect(urls[4]).toContain('/api/v1/source/bindSite?sourceId=9002&siteId=126')
    expect(result).toMatchObject({ ok: true, added: 2, skipped: 0 })
  })

  it('sourceAdd 对真实网站走 snatchSave → bindSite，返回后端源 ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: '0', data: { siteId: 126, siteName: '土地政策', categoryId: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '源ID:9003' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '关联成功' }))
    const { siteApi } = await import('./index')

    const result = await siteApi.sourceAdd('126', {
      sourceId: '126-draft', name: '单个源', url: 'https://b.gov.cn', configId: '', mainTable: '', owner: 'admin', state: 'C',
    })

    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)))
      .toMatchObject({ sourceName: '单个源', sourceUrl: 'https://b.gov.cn', newConfig: '1' })
    expect(String(fetchMock.mock.calls[2][0])).toContain('/api/v1/source/bindSite?sourceId=9003&siteId=126')
    expect(result).toEqual({ ok: true, sourceId: '9003' })
  })

  it('sourceAdd 参数源在真实后端直接拒绝，不发请求', async () => {
    const { siteApi } = await import('./index')
    const result = await siteApi.sourceAdd('126', {
      sourceId: 'x', name: '参数源', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C', kind: 'param',
    })
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('全局 mock 且未开生产新建时，siteCreate 走夹具不发 fetch', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://127.0.0.1:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', '')
    const { siteApi } = await import('./index')

    const result = await siteApi.siteCreate({
      siteId: 'site-hybrid-fixture-1', name: '夹具网站', category: '', owner: 'admin', sourceCount: 0, errorCount: 0,
    }, [])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  // 2026-09-03：连着生产后端却没开新建闸时，退回 mock 会造出只有本地看得见的假 ID，
  // 而读取端点都已 live，画布必然卡在「正在加载源…」。必须当场拒绝而不是假装成功。
  it('已连生产后端但未开新建闸时，siteCreate 拒绝而不退回夹具', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', '')
    const { siteApi } = await import('./index')

    const result = await siteApi.siteCreate({
      siteId: 'site-guard-1', name: '不该落 mock 的网站', category: '', owner: 'admin', sourceCount: 0, errorCount: 0,
    }, [])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('VITE_SITE_CREATE_TARGET=production')
    expect(result.siteId).toBeUndefined()
    expect(result.sourceId).toBeUndefined()
  })

  it('全局 mock 时生产新建仍强制走 site/add，不依赖 VITE_API_MODE=http', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '新增成功', data: { siteId: 11825 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '源ID:9001' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '关联成功' }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteCreate({
      siteId: 'site-draft', name: '混用新建站', category: '新闻', dirId: '7', owner: 'admin', sourceCount: 1, errorCount: 0,
    }, [{ sourceId: 'source-draft', name: '混用新建源', url: 'https://example.com', configId: '', mainTable: '', owner: 'admin', state: 'C' }])

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('/api/v1/site/add'),
      expect.stringContaining('/api/v1/snatch/snatchSave'),
      expect.stringContaining('/api/v1/source/bindSite'),
    ])
    expect(result).toMatchObject({ ok: true, siteId: '11825', sourceId: '9001' })
  })

  it('非生产建站目标拒绝发送 site/add', async () => {
    vi.stubEnv('VITE_SITE_CREATE_TARGET', 'test')
    const { siteApi } = await import('./index')

    await expect(siteApi.siteCreate({ siteId: 'draft', name: '不应创建', category: '', owner: 'admin', sourceCount: 0, errorCount: 0 }, [])).resolves.toEqual({
      ok: false, message: '新建网站仅允许生产环境，请设置 VITE_SITE_CREATE_TARGET=production',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('源保存请求异常时停止后续步骤，并保留已创建的网站 ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', data: { siteId: 11825 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, code: '-1', msg: '源配置校验失败' }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteCreate({
      siteId: 'site-draft', name: '失败恢复网站', category: '新闻', dirId: '7', owner: 'admin', sourceCount: 1, errorCount: 0,
    }, [{ sourceId: 'source-draft', name: '失败源', url: 'https://example.com', configId: '', mainTable: '', owner: 'admin', state: 'C' }])

    expect(result).toMatchObject({ ok: false, siteId: '11825' })
    expect(result.message).toContain('网站「失败恢复网站」已创建')
    expect(result.message).toContain('失败源')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('关联请求异常时不继续保存后续源，并保留已创建的源 ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', data: { siteId: 11825 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '源ID:9001' }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, code: '-1', msg: '无关联权限' }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteCreate({
      siteId: 'site-draft', name: '关联失败网站', category: '新闻', dirId: '7', owner: 'admin', sourceCount: 1, errorCount: 0,
    }, [{ sourceId: 'source-draft', name: '关联失败源', url: 'https://example.com', configId: '', mainTable: '', owner: 'admin', state: 'C' }])

    expect(result).toMatchObject({ ok: false, siteId: '11825', sourceId: '9001' })
    expect(result.message).toContain('关联失败源')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('siteSources 用 GET 拉取单站源，并按旧字段映射', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{
        sourceId: 101, sourceName: '财经源', sourceUrl: 'https://example.com', categoryName: '/新闻/财经',
        state: 'C', notifyFlag: 1, dataCnt: 12, lastInsert: '2026-08-12 10:00:00', lastSuccess: '2026-08-12 10:01:00',
        isDelete: 0, siteId: 11, domain: 'example.com',
      }],
    }))
    const { siteApi } = await import('./index')

    const result = await siteApi.siteSources('11')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/site/sources?siteId=11&page=1&limit=10000')
    expect(init.method).toBe('GET')
    expect(result).toEqual([expect.objectContaining({
      sourceId: '101', name: '财经源', url: 'https://example.com', siteId: '11', dataCount: 12, alarm: true, disabled: false,
    })])
  })

  it('siteSourcePreview 只请求卡片首屏需要的小分页', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{ sourceId: 101, sourceName: '财经源', sourceUrl: '', state: 'C' }],
    }))
    const { siteApi } = await import('./index')

    await siteApi.siteSourcePreview('11', 4)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/site/sources?siteId=11&page=1&limit=4')
  })

  it('后端业务失败保留响应文案', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '-1', msg: '无网站读取权限' }))
    const { siteApi } = await import('./index')

    await expect(siteApi.sitePaged()).rejects.toThrow('无网站读取权限')
  })

  // 0918-01：清空标签必须绕开 site/update——它把空串当"未提供"跳过，回执还报"更新成功"。
  describe('网站标签的写入（0918-01）', () => {
    it('非空标签一次 site/update 存完，不额外发 batchChangeTags', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '更新成功' }))
      const { siteApi } = await import('./index')

      const ack = await siteApi.siteUpdate({ siteId: '10', name: '站十', dirId: '', tags: ['甲', '乙'] })

      expect(ack.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/v1/site/update')
      // site/update 没指定 paramsIn，按默认 POST→body 走（与 sitePaged 的 query 不同）
      expect(JSON.parse(String(init.body)))
        .toMatchObject({ siteId: 10, siteName: '站十', tags: '甲;乙' })
    })

    it('空数组改走 batchChangeTags，且 site/update 不再带 tags 参数', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '操作成功，影响 1 个网站' }))
      const { siteApi } = await import('./index')

      const ack = await siteApi.siteUpdate({ siteId: '10', name: '站十', dirId: '', tags: [] })

      expect(ack.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      // 第一发仍是 site/update（名称/分类照存），但**不带 tags**——带了也是白带，后端会跳过
      const [updateUrl, updateInit] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(updateUrl).toContain('/api/v1/site/update')
      expect(JSON.parse(String(updateInit.body))).not.toHaveProperty('tags')
      // 第二发才是真正清标签的那一次
      const [tagUrl, tagInit] = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(tagUrl).toContain('/api/v1/site/batchChangeTags')
      expect(tagInit.method).toBe('POST')
      // 与旧平台 site.js 的 `data: {ids, tags}` 一致：参数在 body，不是 query
      expect(JSON.parse(String(tagInit.body))).toEqual({ ids: [10], tags: '' })
    })

    it('site/update 失败时不补发清空请求，免得在失败的保存上留半个副作用', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: '-1', msg: '网站不存在' }))
      const { siteApi } = await import('./index')

      await expect(siteApi.siteUpdate({ siteId: '10', name: '站十', dirId: '', tags: [] }))
        .rejects.toThrow('网站不存在')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('tags 为 undefined 表示本次不动标签：既不带参数也不补发', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '更新成功' }))
      const { siteApi } = await import('./index')

      await siteApi.siteUpdate({ siteId: '10', name: '站十', dirId: '', tags: undefined })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(String(init.body))).not.toHaveProperty('tags')
    })
  })

  // B30 用户收藏（favorite-api.md）。userId 走会话，前端不传；itemType 必须大写、itemId 正整数
  describe('favoriteApi', () => {
    it('listIds：GET favorite/list，limit=500，不足一页就停', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: 0, count: 2, data: [{ itemType: 'SITE', itemId: 123 }, { itemType: 'SITE', itemId: 118 }] }))
      const { favoriteApi } = await import('./index')

      expect(await favoriteApi.listIds('SITE')).toEqual(['123', '118'])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('GET')
      expect(url).toContain('/api/v1/favorite/list')
      expect(url).toContain('itemType=SITE')
      expect(url).toContain('limit=500')
      expect(url).not.toContain('userId')
    })

    it('listIds：满 500 条继续翻页，直到够总数', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => ({ itemType: 'SITE', itemId: i + 1 }))
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 0, count: 501, data: page1 }))
        .mockResolvedValueOnce(jsonResponse({ code: 0, count: 501, data: [{ itemType: 'SITE', itemId: 999 }] }))
      const { favoriteApi } = await import('./index')

      const ids = await favoriteApi.listIds('SITE')
      expect(ids).toHaveLength(501)
      expect(ids.at(-1)).toBe('999')
      expect(String(fetchMock.mock.calls[1][0])).toContain('page=2')
    })

    it('add / remove：POST JSON body，itemId 转成数字', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '操作成功', data: null }))
      const { favoriteApi } = await import('./index')

      await favoriteApi.add('SITE', '123')
      await favoriteApi.remove('SITE', '123')

      const [addUrl, addInit] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(addUrl).toContain('/api/v1/favorite/add')
      expect(addInit.method).toBe('POST')
      expect(JSON.parse(String(addInit.body))).toEqual({ itemType: 'SITE', itemId: 123 })
      expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/favorite/remove')
    })

    it('后端失败（如未登录）抛出带原因的错误，交给调用方回滚', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '未登录', data: null }))
      const { favoriteApi } = await import('./index')
      await expect(favoriteApi.add('SITE', '123')).rejects.toThrow('未登录')
    })
  })
})
