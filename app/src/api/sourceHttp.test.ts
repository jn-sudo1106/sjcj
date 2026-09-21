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
      sourceType: 90, sourceUrl: 'https://example.com', sourceName: '公告源', categoryId: 'cat-1',
      // 未填的三个：旧平台 form 里是 undefined、根本不进 body；发 '' 会被后端逐个抛回来
      // （proxy → ArrayList 强转失败，cron → Cron expression must consist of 6 fields，2026-09-03 生产实测）
      proxy: undefined, keep: '', cron: '', tags: '',
      newConfig: '1' as const, isMulti: '1', loginTemplete: '1', entryTypeId: 'tb-1', params: [{ paramId: 'p-1' }],
      reqLogin: '1' as const, newLoginConfig: '1' as const, loginUrl: 'https://example.com/login', loginName: 'alice', loginPwd: 'secret',
    }

    const result = await sourceApi.snatchSaveAll(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/snatch/snatchSave')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    // 空值被剥掉，其余字段名原样保持旧平台
    expect(body).toEqual({
      sourceType: 90, sourceUrl: 'https://example.com', sourceName: '公告源', categoryId: 'cat-1',
      newConfig: '1', isMulti: '1', loginTemplete: '1', entryTypeId: 'tb-1', params: [{ paramId: 'p-1' }],
      reqLogin: '1', newLoginConfig: '1', loginUrl: 'https://example.com/login', loginName: 'alice', loginPwd: 'secret',
    })
    expect(Object.keys(body)).not.toContain('proxy')
    expect(Object.keys(body)).not.toContain('cron')
    expect(Object.keys(body)).not.toContain('keep')
    expect(Object.keys(body)).not.toContain('tags')
    // 空数组不算空值：params 是旧平台确实会发的字段
    expect(body.params).toEqual([{ paramId: 'p-1' }])
    expect(result).toMatchObject({ ok: true, message: '源ID:12345', sourceId: '12345' })
  })

  it('snatchSave 空数组字段照发：params 无参数时仍是 []，不被当空值剥掉', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '源ID:12346' }))
    const { sourceApi } = await import('./index')

    await sourceApi.snatchSaveAll({
      sourceUrl: '', sourceName: '无参源', newConfig: '1', isMulti: '1', loginTemplete: '',
      params: [], reqLogin: '0',
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body).toEqual({ sourceName: '无参源', newConfig: '1', isMulti: '1', params: [], reqLogin: '0' })
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
      siteIds: '-1',
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
      siteIds: '-1',
      notify: '',
      field: 'dataCnt',
      sorted: 1,
      tags: [],
    })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('state')
    // 单数 siteId 后端不读（source-api.md §1.1），不透传
    expect(JSON.parse(String(init.body))).not.toHaveProperty('siteId')
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

  it('GET /v1/source/check/paged：监控视图首屏只带 page/limit，默认 limit=10', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      count: 1,
      data: [{
        id: 7,
        sourceId: 391007770,
        name: '编码监控',
        state: 'C',
        isDelete: 0,
        tableName: 'sense_data.TB_TEST_ADB',
      }],
    }))
    const { sourceCheckApi } = await import('./index')

    const result = await sourceCheckApi.paged({ page: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestUrl = new URL(url, 'http://local.test')
    expect(init.method).toBe('GET')
    expect(requestUrl.pathname).toBe('/api/v1/source/check/paged')
    expect(requestUrl.searchParams.toString()).toBe('page=1&limit=10')
    expect(requestUrl.searchParams.has('sourceId')).toBe(false)
    expect(requestUrl.searchParams.has('size')).toBe(false)
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({ name: '编码监控' })
  })

  it('GET /v1/source/check/paged：选择具体源后透传 sourceId 与筛选条件', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      count: 1,
      data: [{
        id: 7,
        sourceId: 391007770,
        name: '编码监控',
        state: 'E',
        isDelete: 0,
        tableName: 'sense_data.TB_TEST_ADB',
      }],
    }))
    const { sourceCheckApi } = await import('./index')

    const result = await sourceCheckApi.paged({ sourceId: '391007770', page: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestUrl = new URL(url, 'http://local.test')
    expect(init.method).toBe('GET')
    expect(requestUrl.pathname).toBe('/api/v1/source/check/paged')
    expect(requestUrl.searchParams.get('sourceId')).toBe('391007770')
    expect(requestUrl.searchParams.get('page')).toBe('1')
    expect(requestUrl.searchParams.get('limit')).toBe('10')
    expect(requestUrl.searchParams.has('size')).toBe(false)
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({ name: '编码监控' })
  })

  it('GET /v1/source/check/paged-logs：日志按 sourceId + page/limit 查询，默认 limit=10', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      count: 1,
      data: [{
        logId: 8,
        sourceId: 391007770,
        createDt: '2026-09-15 10:00:00',
        logMsg: '校验正常',
        name: '编码监控',
        state: 'C',
        logType: '正常',
        tableName: 'sense_data.TB_TEST_ADB',
      }],
    }))
    const { sourceCheckApi } = await import('./index')

    const result = await sourceCheckApi.pagedLogs({ sourceId: '391007770', jobId: '8', page: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestUrl = new URL(url, 'http://local.test')
    expect(init.method).toBe('GET')
    expect(requestUrl.pathname).toBe('/api/v1/source/check/paged-logs')
    expect(requestUrl.searchParams.get('sourceId')).toBe('391007770')
    expect(requestUrl.searchParams.get('jobId')).toBe('8')
    expect(requestUrl.searchParams.get('page')).toBe('1')
    expect(requestUrl.searchParams.get('limit')).toBe('10')
    expect(requestUrl.searchParams.has('size')).toBe(false)
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({ name: '编码监控', logMsg: '校验正常' })
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

    // 子级带上 parentId（2026-09-21 随分类管理加的字段，SourceCategory.parentId）：
    // 分类管理抽屉要靠它定位父级。顶层的 parentId=0 仍然不映射，保持"根节点没有父"的语义。
    await expect(sourceApi.sourceCategories()).resolves.toEqual([
      { id: '1', name: '资讯', count: 3, children: [{ id: '2', name: '研报', count: 2, parentId: '1' }] },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/category/categoryPaged?page=1&limit=10000&allSub=false')

    await expect(sourceApi.sourceCategories('1')).resolves.toEqual([
      { id: '3', name: '宏观', parentId: '1' },
    ])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/category/categoryPaged?page=1&limit=10000&allSub=false&parentId=1')
  })

  // site/sitePaged 的 categoryIds 只精确匹配本级、不含子级，categoryPaged 的 allSub 参数又是死的
  // （2026-09-16 实测 true/false 都只返回根节点），所以「选父分类连子分类一起筛」靠前端 BFS 展开。
  describe('expandCategoryIds：把选中分类展开成自身 + 全部后代', () => {
    const categoryPage = (rows: { id: number; parentId: number }[]) =>
      jsonResponse({ code: '0', data: rows.map((r) => ({ categoryId: r.id, categoryName: `分类${r.id}`, parentId: r.parentId })) })

    it('逐层拉子树，返回自身 + 各级后代', async () => {
      fetchMock
        .mockResolvedValueOnce(categoryPage([{ id: 20, parentId: 10 }, { id: 21, parentId: 10 }])) // 10 的子级
        .mockResolvedValueOnce(categoryPage([{ id: 30, parentId: 20 }]))                          // 20 的子级
        .mockResolvedValueOnce(categoryPage([]))                                                  // 21 无子级
        .mockResolvedValueOnce(categoryPage([]))                                                  // 30 无子级
      const { expandCategoryIds } = await import('./index')

      await expect(expandCategoryIds(['10'])).resolves.toEqual(['10', '20', '21', '30'])
    })

    it('没选分类时不发请求', async () => {
      const { expandCategoryIds } = await import('./index')

      await expect(expandCategoryIds([])).resolves.toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('单个分类拉子级失败只少那一支，不让整个筛选炸掉', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('boom'))                        // 10 的子级拉失败
        .mockResolvedValueOnce(categoryPage([{ id: 40, parentId: 11 }])) // 11 正常
        .mockResolvedValueOnce(categoryPage([]))
      const { expandCategoryIds } = await import('./index')

      await expect(expandCategoryIds(['10', '11'])).resolves.toEqual(['10', '11', '40'])
    })

    it('父子关系成环时不死循环', async () => {
      // 10 的子级是 20，20 的子级又回指 10
      fetchMock
        .mockResolvedValueOnce(categoryPage([{ id: 20, parentId: 10 }]))
        .mockResolvedValueOnce(categoryPage([{ id: 10, parentId: 20 }]))
      const { expandCategoryIds } = await import('./index')

      await expect(expandCategoryIds(['10'])).resolves.toEqual(['10', '20'])
    })
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400935, configUrl: 'http://www.baidu.com', topic: 'news_snt', runPolicy: '{snatch:{retryCnt:3}}' }, msg: null, success: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400974, topic: 'dev_web_snatch_html_download' }, msg: null, success: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: null, data: { configId: 1400975, topic: 'news_cont' }, msg: null, success: true }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430016821')

    expect(steps.map((s) => s.topic)).toEqual(['news_snt', 'dev_web_snatch_html_download', 'news_cont'])
    expect(steps[0].configUrl).toBe('http://www.baidu.com')
    expect(steps[0].runPolicy).toBe('{snatch:{retryCnt:3}}')
    expect(fetchMock.mock.calls).toHaveLength(4)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/config/configDetail?configId=1400935')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/config/configDetail?configId=1400974')
    expect(fetchMock.mock.calls[3][0]).toBe('/api/v1/config/configDetail?configId=1400975')
  })

  it('sourceSteps：configDetail 只有 success/data、没有 code 时仍回填 configUrl', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: [{ itemConfig: 0, sourceId: 430002329, name: 'guancha-观察者网-金融科技', configId: 1400766, outEntry: 900, lastStep: null, isDelete: 0 }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { configId: 1400766, configName: 'guancha-观察者网-金融科技', configUrl: 'https://www.guancha.cn/jinrongkeji', isMulti: 1 },
    }))
    const { sourceApi } = await import('./index')

    const steps = await sourceApi.sourceSteps('430002329')

    expect(steps[0].configUrl).toBe('https://www.guancha.cn/jinrongkeji')
    expect(steps[0].configName).toBe('guancha-观察者网-金融科技')
    expect(steps[0].multiMode).toBe(1)
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

  it('GET /v1/source/changeEnable：ids 逗号分隔，enable 极性反着（0 启用 / 1 停用）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '操作成功' }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.changeSourceEnableBatch(['430016398', '430016399'], true)).resolves.toMatchObject({ ok: true })
    const enableOff = new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test')
    expect(enableOff.pathname).toBe('/api/v1/source/changeEnable')
    expect(enableOff.searchParams.get('ids')).toBe('430016398,430016399')
    expect(enableOff.searchParams.get('enable')).toBe('1')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')

    fetchMock.mockClear()
    await sourceApi.changeSourceEnable('430016398', false)
    const enableOn = new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test')
    expect(enableOn.searchParams.get('ids')).toBe('430016398')
    expect(enableOn.searchParams.get('enable')).toBe('0')
  })

  it('GET /v1/source/changeSite：一批源 ID + 目标网站', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '关联成功' }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.changeSite(['430016398', '430016399'], '4')).resolves.toMatchObject({ ok: true, message: '关联成功' })
    const parsed = new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/source/changeSite')
    expect(parsed.searchParams.get('ids')).toBe('430016398,430016399')
    expect(parsed.searchParams.get('siteId')).toBe('4')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  it('GET /v1/source/changeSite：超过分片阈值时串行拆成多次请求，汇总成一个 Ack', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '关联成功' }))
    const { sourceApi } = await import('./index')

    const ids = Array.from({ length: 700 }, (_, i) => String(430000000 + i))
    await expect(sourceApi.changeSite(ids, '4')).resolves.toMatchObject({ ok: true })
    // 700 / 300 → 3 片：300 + 300 + 100
    expect(fetchMock.mock.calls).toHaveLength(3)
    const counts = fetchMock.mock.calls.map(
      ([url]) => new URL(String(url), 'http://local.test').searchParams.get('ids')!.split(',').length,
    )
    expect(counts).toEqual([300, 300, 100])
  })

  it('GET /v1/source/changeSite：某一片被网关拒（431）时不整批失败，回执汇总成功/失败条数', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: '0' }))
      .mockResolvedValueOnce({ ok: false, status: 431, text: async () => 'Request Header Fields Too Large' } as Response)
      .mockResolvedValue(jsonResponse({ code: '0' }))
    const { sourceApi } = await import('./index')

    const ids = Array.from({ length: 700 }, (_, i) => String(430000000 + i))
    const res = await sourceApi.changeSite(ids, '4')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('成功 400 个')
    expect(res.message).toContain('失败 300 个')
  })

  // 2026-09-16 部署站（wan 网关）实测：1073 个源分 4 批全部收不到回执，界面报「成功 0 个、
  // 失败 1073 个」，而后端一个不少地写进去了。判定改成回查实际归属，不再凭异常定成败。
  const timeoutError = () => new DOMException('The operation was aborted.', 'AbortError')
  const siteSourcesResponse = (ids: string[]) =>
    jsonResponse({ code: '0', count: ids.length, data: ids.map((id) => ({ sourceId: Number(id), sourceName: `源${id}` })) })

  it('GET /v1/source/changeSite：分片全部超时但后端已写入时，回查实际归属判成功（不误报失败）', async () => {
    const ids = Array.from({ length: 700 }, (_, i) => String(430000000 + i))
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(siteSourcesResponse(ids))
    const { sourceApi } = await import('./index')

    const res = await sourceApi.changeSite(ids, '4')
    expect(res.ok).toBe(true)
    expect(res.message).toContain('已导入 700 个源')
    // 3 片提交 + 1 次回查；回查只发一次，不逐片查
    expect(fetchMock.mock.calls).toHaveLength(4)
    const probe = new URL(String(fetchMock.mock.calls[3][0]), 'http://local.test')
    expect(probe.pathname).toBe('/api/v1/site/sources')
    expect(probe.searchParams.get('siteId')).toBe('4')
  })

  it('GET /v1/source/changeSite：超时后回查只落地一部分，按实际条数汇总', async () => {
    const ids = Array.from({ length: 700 }, (_, i) => String(430000000 + i))
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(siteSourcesResponse(ids.slice(0, 400)))
    const { sourceApi } = await import('./index')

    const res = await sourceApi.changeSite(ids, '4')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('成功 400 个')
    expect(res.message).toContain('失败 300 个')
  })

  it('GET /v1/source/changeSite：4xx 是网关当场拒绝，请求没到后端，不浪费一次回查', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 431, text: async () => 'Request Header Fields Too Large' } as Response)
    const { sourceApi } = await import('./index')

    const ids = Array.from({ length: 700 }, (_, i) => String(430000000 + i))
    const res = await sourceApi.changeSite(ids, '4')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('失败 700 个')
    // 只有 3 次分片请求，没有第 4 次 site/sources 回查
    expect(fetchMock.mock.calls).toHaveLength(3)
  })

  it('GET /v1/source/changeSite：不分片的小批量超时后同样回查，全部落地则判成功', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => String(430000000 + i))
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(siteSourcesResponse(ids))
    const { sourceApi } = await import('./index')

    const res = await sourceApi.changeSite(ids, '4')
    expect(res.ok).toBe(true)
    expect(res.message).toContain('已导入 200 个源')
  })

  it('GET /v1/source/changeSite：不分片且一个都没落地时抛回原异常，保留 431 等错误原文', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => String(430000000 + i))
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(siteSourcesResponse([]))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.changeSite(ids, '4')).rejects.toThrow('The operation was aborted.')
  })

  it('GET /v1/source/copySource：sourceId + name + url + flag', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: null }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.copySource({
      sourceId: '430016398',
      name: '复制源',
      url: 'https://copied.example.com',
      flag: 1,
    })).resolves.toMatchObject({ ok: true })
    const parsed = new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/source/copySource')
    expect(parsed.searchParams.get('sourceId')).toBe('430016398')
    expect(parsed.searchParams.get('name')).toBe('复制源')
    expect(parsed.searchParams.get('url')).toBe('https://copied.example.com')
    expect(parsed.searchParams.get('flag')).toBe('1')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  it('copySourceAndLocate 按 ID 差集定位新源，不靠猜名字', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: '0', count: 1,
        data: [{ sourceId: 430016398, sourceName: '复制源', sourceUrl: 'https://old.example.com', configId: 1400917, entryTypeId: 1, author: 'a', isDelete: 0 }],
      }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', msg: null, data: null }))
      .mockResolvedValueOnce(jsonResponse({
        code: '0', count: 2,
        data: [
          { sourceId: 430016398, sourceName: '复制源', sourceUrl: 'https://old.example.com', configId: 1400917, entryTypeId: 1, author: 'a', isDelete: 0 },
          { sourceId: 430099999, sourceName: '复制源', sourceUrl: 'https://copied.example.com', configId: 1400999, entryTypeId: 1, author: 'a', isDelete: 0 },
        ],
      }))
    const { sourceApi } = await import('./index')

    const res = await sourceApi.copySourceAndLocate({
      sourceId: '430016398',
      name: '复制源',
      url: 'https://copied.example.com',
      flag: 1,
    })
    expect(String(fetchMock.mock.calls[1][0])).toContain('source/copySource')
    expect(res).toMatchObject({ ok: true, sourceId: '430099999' })
  })

  it('copySourceAndLocate：msg 里带源 ID 时不再二次分页', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: '0', count: 0, data: [] }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', msg: '源ID:430099999', data: null }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.copySourceAndLocate({
      sourceId: '430016398',
      name: '新源',
      url: 'https://copied.example.com',
      flag: 0,
    })).resolves.toMatchObject({ ok: true, sourceId: '430099999' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('copySourceAndLocate 定位不到唯一新源时不返回 ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: '0', count: 0, data: [] }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', msg: '操作成功', data: null }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', count: 0, data: [] }))
    const { sourceApi } = await import('./index')

    const res = await sourceApi.copySourceAndLocate({
      sourceId: '430016398',
      name: '新源',
      url: 'https://copied.example.com',
      flag: 1,
    })
    expect(res.ok).toBe(false)
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

  it('itemApi.enable / deleteStep：GET id + state（0 启用 / 1 停用）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: 'ok' }))
    const { itemApi } = await import('./index')
    await itemApi.enable('40600', '0')
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/item/next/enable?id=40600&state=0')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
    await itemApi.deleteStep('40600')
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/v1/item/next/delete?id=40600')
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('GET')
  })

  it('POST /v1/source/markBatch：勾选源 ID + #标签，flag/freq/notify 传 null（真实路径，2026-09-01 实测报错才发现 source/tagSource 是臆造的端点名）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '标记成功' }))
    const { sourceApi } = await import('./index')
    const result = await sourceApi.tagSource(['src-1', 'src-2'], ['正文缺失'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/source/markBatch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      ids: ['src-1', 'src-2'],
      flag: null,
      freq: null,
      notify: null,
      tags: '#正文缺失',
    })
    expect(result).toMatchObject({ ok: true, message: '标记成功' })
  })

  it('清标签不走 tagSource action=clear，改为 POST updateSource 空 tags', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '修改成功' }))
    const { sourceApi } = await import('./index')
    await sourceApi.tagSource(['src-1', 'src-2'], [], 'clear')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map((call) => {
      const [url, init] = call as [string, RequestInit]
      expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/source/updateSource')
      expect(init.method).toBe('POST')
      return JSON.parse(String(init.body))
    })
    expect(bodies).toEqual([
      { sourceId: 'src-1', tags: '' },
      { sourceId: 'src-2', tags: '' },
    ])
  })

  // 上面那条「清标签 = 发空 tags」正是本条要防的事故：批量备注拿不到某条源的当前标签时，
  // 若退化成空数组就等于顺手替用户点了一次「清空标签」。缺省时必须整个不带 tags 键。
  it('updateSourceMark：tags 缺省时 body 不出现 tags 键，传了才写', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '修改成功' }))
    const { sourceApi } = await import('./index')

    await sourceApi.updateSourceMark('src-1', { remark: '只改备注' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/source/updateSource')
    const body = JSON.parse(String(init.body))
    expect('tags' in body).toBe(false)
    expect(body).toEqual({ sourceId: 'src-1', remark: '只改备注' })

    await sourceApi.updateSourceMark('src-2', { tags: ['正文缺失'], remark: '改备注保标签' })
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)))
      .toEqual({ sourceId: 'src-2', tags: '#正文缺失', remark: '改备注保标签' })
  })

  it('GET /v1/source/setColor：设颜色带 isClear=0；清除写 flag=0，不带 isClear', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '标记成功' }))
    const { sourceApi } = await import('./index')
    await sourceApi.setColor(['src-1'], 2)
    expect(new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test').searchParams.get('flag')).toBe('2')
    expect(new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test').searchParams.get('isClear')).toBe('0')
    await sourceApi.setColor(['src-1'], undefined, true)
    const cleared = new URL(String(fetchMock.mock.calls[1][0]), 'http://local.test')
    expect(cleared.pathname).toBe('/api/v1/source/setColor')
    expect(cleared.searchParams.get('flag')).toBe('0')
    expect(cleared.searchParams.get('isClear')).toBeNull()
  })

  it('setColor flag=0 失败时回退 updateSource usedFlag=0', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('请求失败 500'))
      .mockResolvedValue(jsonResponse({ code: '0', msg: '修改成功' }))
    const { sourceApi } = await import('./index')
    await sourceApi.setColor(['src-1'], undefined, true)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/source/setColor')
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/source/updateSource')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ sourceId: 'src-1', usedFlag: 0 })
  })

  it('日常 mock 模式且已标 live 时，setColor / markBatch 仍打真实接口，不被 mock 吃掉', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '标记成功' }))
    const { sourceApi } = await import('./index')

    await sourceApi.setColor(['src-1'], 2)
    await sourceApi.tagSource(['src-1'], ['正文缺失'])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/source/setColor')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/source/markBatch')
  })

  it('sourceTaskPaged 与源列表任务实例同一条 GET /v1/task/topTaskPaged，page/limit + sourceId/state/configId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      msg: null,
      data: {
        total: 1,
        list: [{
          taskId: '8348509120',
          state: 'C',
          actionName: '浏览器抓取',
          taskName: '任务A',
          sourceId: '161725',
          configId: '70598',
          updateDt: '2026-07-31 08:00',
          nodeCode: 'node1',
          taskTopic: 'topic1',
        }],
      },
    }))
    const { sourceApi } = await import('./index')

    const result = await sourceApi.sourceTaskPaged({
      siteId: '11',
      sourceId: '161725',
      configId: '70598',
      state: 'C',
      page: 2,
      size: 30,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/task/topTaskPaged')
    expect(url).not.toContain('siteId=')
    expect(url).not.toContain('nodeId=')
    expect(url).toContain('page=2')
    expect(url).toContain('limit=30')
    expect(url).toContain('sourceId=161725')
    expect(url).toContain('configId=70598')
    expect(url).toContain('state=C')
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({
      taskId: '8348509120',
      typeName: '浏览器抓取',
      node: 'node1',
      topic: 'topic1',
      updatedAt: '2026-07-31 08:00',
    })
  })

  // 网站态「全部源」走后端的 siteId（2026-09-16 加、09-17 修好 SQL）。它取自 siteScopeId
  // 而不是 q.siteId：后者是「当前在看哪个网站」的上下文、源态也一直带着，直接透传会给源态
  // 查询多加一层站点过滤。上面那条用例的 `not.toContain('siteId=')` 守的正是这一侧。
  it('sourceTaskPaged 只把 siteScopeId 作为 siteId 发出去，上下文里的 siteId 不透传', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: { total: 0, list: [] } }))
    const { sourceApi } = await import('./index')

    await sourceApi.sourceTaskPaged({
      siteId: '13',
      siteScopeId: '13',
      page: 1,
      size: 20,
    })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const query = new URL(String(url), 'http://local.test').searchParams
    expect(query.get('siteId')).toBe('13')
    // 没收窄到单源时不该带空的 sourceId
    expect(query.has('sourceId')).toBe(false)
  })

  it('sourceTaskPaged 收窄到单源时不发 siteId：源态只按 sourceId 查，不叠站点过滤', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: { total: 0, list: [] } }))
    const { sourceApi } = await import('./index')

    // 源态：上下文 siteId 有值，但调用方不会设 siteScopeId
    await sourceApi.sourceTaskPaged({ siteId: '13', sourceId: '430016944', page: 1, size: 20 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const query = new URL(String(url), 'http://local.test').searchParams
    expect(query.get('sourceId')).toBe('430016944')
    expect(query.has('siteId')).toBe(false)
  })

})
