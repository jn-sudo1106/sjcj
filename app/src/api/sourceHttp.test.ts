// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

describe('旧平台新建源 HTTP 契约', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('POST /v1/snatch/snatchSave，保持旧平台字段名且解析源ID', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '源ID:12345' }))
    const { sourceApi } = await import('./index')
    const payload = {
      sourceType: 90, sourceUrl: 'https://example.com', sourceName: '公告源', categoryId: 'cat-1', proxy: '', keep: '', cron: '', tags: '',
      newConfig: '1' as const, isMulti: '1', loginTemplete: '1', entryTypeId: 'tb-1', params: [{ paramId: 'p-1' }],
      reqLogin: '1' as const, newLoginConfig: '1' as const, loginUrl: 'https://example.com/login', loginName: 'alice', loginPwd: 'secret',
    }

    const result = await sourceApi.snatchSaveAll(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/snatch/snatchSave')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(payload)
    expect(result).toMatchObject({ ok: true, message: '源ID:12345', sourceId: '12345' })
  })

  it('POST /v1/source/sourcePaged：把新分页/筛选字段转换为旧 payload，并映射列表字段', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      count: 1,
      data: [{
        sourceId: 391003979,
        sourceName: '中银证券研究',
        sourceUrl: 'https://example.com',
        configId: 81516,
        entryTypeId: 2101991,
        author: 'muyan',
        dataCnt: 30,
        lastInsert: '2026-08-12 10:00:00',
        lastSuccess: '2026-08-12 09:00:00',
        jobCnt: 1,
        stepCnt: 2,
        isDelete: 0,
        notifyFlag: 1,
        keepLast: 1,
        tags: '重点,研报',
        categoryId: 7,
        categoryName: '资讯/研报',
      }],
      exts: [{ freq: 'DAY', allCount: 1 }],
    }))
    const { sourceApi } = await import('./index')

    const result = await sourceApi.sourcePaged({
      page: 2,
      size: 40,
      sourceIds: '391003979',
      name: '中银',
      configId: '81516',
      category: '资讯',
      enable: '0',
      siteId: '11',
      field: 'dataCnt',
      sorted: 1,
      state: 'all',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/source/sourcePaged')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      pageNo: 2,
      pageSize: 40,
      page: 2,
      limit: 40,
      ids: '391003979',
      name: '中银',
      configId: '81516',
      categorys: '资讯',
      enable: '0',
      siteId: '11',
      notify: '',
      field: 'dataCnt',
      sorted: 1,
      tags: [],
    })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('state')
    expect(result).toEqual({
      total: 1,
      list: [expect.objectContaining({
        sourceId: '391003979',
        name: '中银证券研究',
        url: 'https://example.com',
        configId: '81516',
        mainTable: '2101991',
        dataCount: 30,
        lastInsertAt: '2026-08-12 10:00:00',
        jobCount: 1,
        stepCount: 2,
        alarm: true,
        resume: true,
        tags: ['重点', '研报'],
        dirId: '7',
      })],
    })
  })

  it('GET /v1/source/sourceDetail：读取 res.data 并保留详情字段映射', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      data: {
        sourceId: 391003979,
        sourceName: '中银证券研究',
        sourceUrl: 'https://example.com',
        configId: 81516,
        entryTypeId: 2101991,
        sourceParam: 'page=1',
        lastUrl: 'https://example.com/p/1',
        createDt: '2025-01-01',
        updateDt: '2026-08-12',
      },
    }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.sourceDetail('391003979')).resolves.toEqual(expect.objectContaining({
      sourceId: '391003979',
      name: '中银证券研究',
      mainTable: '2101991',
      coreParam: 'page=1',
      lastUrl: 'https://example.com/p/1',
      createdAt: '2025-01-01',
      updatedAt: '2026-08-12',
    }))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/source/sourceDetail?sourceId=391003979')
  })

  it('GET /v1/source/sourceSame：把旧的 sourceName 选项映射为当前选源模型', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: 0,
      data: [
        { sourceId: 391003979, sourceName: '中银证券研究' },
        { sourceId: 391003978, sourceName: '政之的IPO研究笔记' },
      ],
    }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.sourceSame('391003979')).resolves.toEqual([
      { sourceId: '391003979', name: '中银证券研究' },
      { sourceId: '391003978', name: '政之的IPO研究笔记' },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/source/sourceSame?sourceId=391003979')
  })

  it('GET /v1/category/categoryPaged：首屏和子级读取都按旧 parentId 契约请求', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: '0',
      data: [
        { categoryId: 1, categoryName: '资讯', parentId: 0, count: 3 },
        { categoryId: 2, categoryName: '研报', parentId: 1, count: 2 },
      ],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: '0',
      data: [{ categoryId: 3, categoryName: '宏观', parentId: 1 }],
    }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.sourceCategories()).resolves.toEqual([
      { id: '1', name: '资讯', count: 3, children: [{ id: '2', name: '研报', count: 2 }] },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/category/categoryPaged?page=1&limit=10000&allSub=false')

    await expect(sourceApi.sourceCategories('1')).resolves.toEqual([
      { id: '3', name: '宏观' },
    ])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/category/categoryPaged?page=1&limit=10000&allSub=false&parentId=1')
  })

  it('GET /v1/item/next/nextConfigPaged：按旧步骤字段映射流程节点', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      data: [
        { itemConfig: 701, sourceId: 430002164, name: '列表抓取', configId: 81516, entryTypeId: 900, outEntry: 901, lastStep: '', cond: '', isDelete: 0 },
        { itemConfig: 702, sourceId: 430002164, name: '详情解析', nodeType: 'detail', configId: 81516, entryTypeId: 901, outEntry: 902, lastStep: '701', cond: 'status=C', isDelete: 1 },
      ],
    }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.sourceSteps('430002164')).resolves.toEqual([
      expect.objectContaining({
        stepId: '701', sourceId: '430002164', name: '列表抓取', inputTable: '900', outputTable: '901', enabled: true,
      }),
      expect.objectContaining({
        stepId: '702', sourceId: '430002164', name: '详情解析', nodeType: 'detail', inputTable: '901', outputTable: '902', dependsOn: ['701'], condition: 'status=C', enabled: false,
      }),
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/item/next/nextConfigPaged?sourceId=430002164&page=1&limit=10000&svg=true')
  })

  it('sourceSteps 按各步骤 configId 查 configDetail 补回真实 topic（取自 2026-08-26 生产实测源 430016821）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [
        { itemConfig: 0, sourceId: 430016821, name: '上市公司-配置', configId: 1400935, outEntry: 900, lastStep: null, isDelete: 0 },
        { itemConfig: 40597, sourceId: -1, name: '1400935-详情', configId: 1400974, entryTypeId: 900, outEntry: 900, lastStep: '0', cond: 'K17==nil', isDelete: 0 },
        { itemConfig: 40598, sourceId: -1, name: '1400935-详情', configId: 1400975, entryTypeId: 900, outEntry: 900, lastStep: '40597', context: 'K2,K17', isDelete: 0 },
      ],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400935, topic: 'news_snt' }, msg: null, success: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400974, topic: 'dev_web_snatch_html_download' }, msg: null, success: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400975, topic: 'news_cont' }, msg: null, success: true }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430016821')

    expect(steps.map((s) => s.topic)).toEqual(['news_snt', 'dev_web_snatch_html_download', 'news_cont'])
    expect(fetchMock.mock.calls).toHaveLength(4)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/config/configDetail?configId=1400935')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/config/configDetail?configId=1400974')
    expect(fetchMock.mock.calls[3][0]).toBe('/api/v1/config/configDetail?configId=1400975')
  })

  it('sourceSteps 按 configDetail.params 回填 paramBindings（取自 2026-08-26 生产实测：配置 1400774 绑了 baidu-密码=aaaa）', async () => {
    // 旧平台「使用参数」弹窗绑的参数，此前新平台两个接口都没读，画布参数配置恒显示「暂无参数配置」。
    // 注意 paramCnt 恒为 0，不能用它判空，只能看 params 数组本身。
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [{ itemConfig: 0, sourceId: 430016501, name: 'stockstar-证券之星-港股-公司报道', configId: 1400774, outEntry: 900, lastStep: null, isDelete: 0 }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: null, msg: null, success: true,
      data: { configId: 1400774, paramCnt: 0, params: [{ id: 56, paramId: 730008, paramName: 'baidu-密码', valueShow: 'aaaa' }] },
    }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430016501')

    expect(steps[0].paramBindings).toEqual([{ paramId: '730008', value: 'aaaa' }])
  })

  it('配置没绑参数时不产生 paramBindings 字段', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [{ itemConfig: 0, sourceId: 430016501, name: '列表', configId: 1400765, outEntry: 900, lastStep: null, isDelete: 0 }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, msg: null, success: true, data: { configId: 1400765, params: [] } }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430016501')

    expect(steps[0].paramBindings).toBeUndefined()
  })

  it('sourceSteps 按 configDetail.isMulti 回填 multiMode 三态原值（只迁不展示；2026-08-26 生产实测 200 条配置分布 1:197 / 2:3）', async () => {
    // 旧 isMulti 是三态：1=列表类 / 0=详情类 / 2=更新父表。新平台的 isDetail 只是布尔，
    // 压不下 2，所以原值单独迁移一份，写回时以它为准。
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [
        { itemConfig: 0, sourceId: 430016502, name: '列表', configId: 1400774, outEntry: 900, lastStep: null, isDelete: 0 },
        { itemConfig: 40251, sourceId: -1, name: '1400774-详情', configId: 1400765, entryTypeId: 900, outEntry: 900, lastStep: '0', isDelete: 0 },
      ],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400774, isMulti: 1 }, msg: null, success: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400765, isMulti: 2 }, msg: null, success: true }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430016502')

    expect(steps.map((s) => s.multiMode)).toEqual([1, 2])
  })

  it('sourceSteps 按 configDetail.templetCode 回填 isLoginConfig（取自 2026-08-26 生产实测配置 1400968「baidu-登陆」）', async () => {
    // 步骤名字本身不含"登录"二字（用的是"登陆"），此前只靠名字正则会漏判成普通采集节点。
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [{ itemConfig: 0, sourceId: 430020000, name: 'baidu-登陆', configId: 1400968, isDelete: 0 }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: null, msg: null, success: true,
      data: { configId: 1400968, configName: 'baidu-登陆', templetCode: 'login', topic: 'dev_web_snatch_资讯用户' },
    }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430020000')

    expect(steps[0].isLoginConfig).toBe(true)
    expect(steps[0].topic).toBe('dev_web_snatch_资讯用户')
  })

  it('sourceSteps：单条 configDetail 查询失败不阻断整体加载，该步骤 topic 留空回退模板默认值', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [{ itemConfig: 0, sourceId: 430099999, name: '列表抓取', configId: 999999, isDelete: 0 }],
    }))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' } as Response)
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430099999')

    expect(steps).toHaveLength(1)
    expect(steps[0].topic).toBeUndefined()
  })

  it('GET /v1/source/bindSite：按单源关系写入契约提交 sourceId 和 siteId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '关联成功' }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.bindSite('430002164', '1')).resolves.toMatchObject({ ok: true, message: '关联成功' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/source/bindSite?sourceId=430002164&siteId=1')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  it('itemApi.stepModify：POST + JSON body（旧平台真实调用是 axios({method:"post", data}）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '修改步骤成功' }))
    const { itemApi } = await import('./index')
    const step = { stepId: '40600', sourceId: '-1', name: '1400917-详情', configId: '1400917', enabled: false } as never

    await itemApi.stepModify(step)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/item/next/stepModify')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body.itemConfig).toBe(40600)
    expect(body.isDelete).toBe(1)
  })

  it('itemApi.saveItemConfig：POST 但走 query string，不是 JSON body（旧平台真实调用是 axios({method:"post", params}）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '增加步骤成功' }))
    const { itemApi } = await import('./index')
    const step = { stepId: '', sourceId: '430016398', name: '新步骤', configId: '1400917', enabled: true } as never

    await itemApi.saveItemConfig(step)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/item/next/saveItemConfig?')
    expect(url).toContain('name=')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

})
