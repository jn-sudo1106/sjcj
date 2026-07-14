// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mockSitePaged, mockSiteDetail, mockSiteCreate, mockSiteUpdate, mockSiteSourcesOf, mockSiteSourceAdd, mockSiteImportSources, mockSiteSourceRemove, mockSiteSyncFlow, mockSiteCloneSource } from './sites'
import { mockSourceDetail, mockSourcePaged } from './sources'
import { mockFlowSave, mockFlowLoad } from './flows'
import { mockEntryDetail } from './entries'

describe('网站—子源模型（0707 优化·Phase2）· 汇总统计', () => {
  it('sitePaged：sourceCount / errorCount 按站内子源实时聚合', () => {
    const list = mockSitePaged({ size: 999 }).list
    const zfb = list.find((s) => s.siteId === 'site-zfb')!
    expect(zfb.sourceCount).toBe(3)
    expect(zfb.errorCount).toBe(2) // 301287174 / 301287169 均 state=E

    const langDemo = list.find((s) => s.siteId === 'site-lang-demo')!
    expect(langDemo.sourceCount).toBe(24) // 「子源可能很多」演示站
    expect(langDemo.errorCount).toBeGreaterThan(0)
  })

  it('sitePaged：dataCount 按站内全部子源实时求和', () => {
    const langDemo = mockSitePaged({ size: 999 }).list.find((s) => s.siteId === 'site-lang-demo')!
    const children = mockSiteSourcesOf({ siteId: 'site-lang-demo' })
    expect(langDemo.dataCount).toBe(children.reduce((n, s) => n + (s.dataCount ?? 0), 0))
    expect(langDemo.dataCount).toBe(30300)
  })

  it('siteDetail：未知网站返回 null', () => {
    expect(mockSiteDetail({ siteId: 'ghost-site' })).toBeNull()
  })

  it('siteUpdate：只更新网站基本信息，不改其子源', () => {
    const original = mockSiteDetail({ siteId: 'site-news' })!
    const before = mockSiteSourcesOf({ siteId: 'site-news' }).map((source) => source.sourceId)
    const result = mockSiteUpdate({ site: { siteId: 'site-news', name: '财经资讯采集（演示）', category: '舆情类', categoryPath: '/舆情类/新闻', owner: 'demo_owner' } })
    expect(result.ok).toBe(true)
    expect(mockSiteDetail({ siteId: 'site-news' })).toMatchObject({ name: '财经资讯采集（演示）', owner: 'demo_owner', tags: original.tags })
    expect(mockSiteSourcesOf({ siteId: 'site-news' }).map((source) => source.sourceId)).toEqual(before)
    mockSiteUpdate({ site: original })
  })

  it('sitePaged：sort 在分页前生效（0710 修复跨页排序），缺省按最近修改倒序', () => {
    const all = mockSitePaged({ size: 999, sort: 'name' }).list.map((s) => s.name)
    expect([...all].sort((a, b) => a.localeCompare(b, 'zh'))).toEqual(all)
    // 跨页口径：第 2 页首项应是全量名称序的第 size+1 位，而不是"取该页再排序"
    const size = 3
    const page2 = mockSitePaged({ size, page: 2, sort: 'name' }).list.map((s) => s.name)
    expect(page2[0]).toBe(all[size])

    const byUpdated = mockSitePaged({ size: 999 }).list.map((s) => s.updatedAt || '')
    expect([...byUpdated].sort((a, b) => b.localeCompare(a))).toEqual(byUpdated)
  })

  it('sitePaged：可按网站名、子源名或责任人搜索', () => {
    expect(mockSitePaged({ keyword: '多语种公告监控', size: 999 }).list.some((site) => site.siteId === 'site-lang-demo')).toBe(true)
    expect(mockSitePaged({ keyword: '多语种公告监控 - 法文', size: 999 }).list.map((site) => site.siteId)).toContain('site-lang-demo')
    expect(mockSitePaged({ keyword: 'dev_zhonghe', size: 999 }).list.length).toBeGreaterThan(0)
  })

  it('sourcesOfSite：语言演示子源并入通用 SOURCES（按 sourceId 各处可查，不再触发 SOURCES[0] 兜底误加载）', () => {
    const langSources = mockSiteSourcesOf({ siteId: 'site-lang-demo' })
    expect(langSources.length).toBe(24)
    expect(langSources.every((s) => s.siteId === 'site-lang-demo')).toBe(true)
    // 并入 SOURCES 后：sourceDetail 能查到真实记录（不是兜底 SOURCES[0]），sourcePaged 里也能看到
    const one = langSources[0]
    expect(mockSourceDetail({ sourceId: one.sourceId })!.sourceId).toBe(one.sourceId)
    expect(mockSourcePaged({ keyword: one.sourceId, size: 10 }).list.some((s) => s.sourceId === one.sourceId)).toBe(true)
  })
})

describe('「新建采集」建网站 + 首批子源', () => {
  it('siteCreate：网站 ID 查重被拦截；成功后子源可查、归属正确', () => {
    const dup = mockSiteCreate({ site: { siteId: 'site-zfb', name: 'x', category: '', owner: '' }, sources: [] })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('已存在')

    const ok = mockSiteCreate({
      site: { siteId: 'site-test-new', name: '测试网站', category: '测试类', owner: 'tester' },
      sources: [
        { sourceId: 'site-test-new-s1', name: '子源一', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C' },
        { sourceId: 'site-test-new-s2', name: '子源二', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C' },
      ],
    })
    expect(ok.ok).toBe(true)
    expect(mockSiteDetail({ siteId: 'site-test-new' })?.sourceCount).toBe(2)
    expect(mockSourceDetail({ sourceId: 'site-test-new-s1' })!.siteId).toBe('site-test-new')
  })
})

describe('网站下增删子源', () => {
  it('cloneSource：复制子源的流程和表结构，但不复制表数据或运行实例', () => {
    const result = mockSiteCloneSource({
      templateSourceId: '600519',
      targetSiteId: 'site-lang-demo',
      target: { name: '复制后的公告源', url: 'https://example.com/copy' },
    })

    expect(result.source.sourceId).not.toBe('600519')
    expect(result.source.siteId).toBe('site-lang-demo')
    expect(result.flowId).toBe(result.source.sourceId)
    expect(Object.keys(result.tableIdMap)).toContain('2101001')
    expect(Object.values(result.tableIdMap)).not.toContain('2101001')
    expect(Object.values(result.tableIdMap).every((tableId) => mockEntryDetail({ tableId }).rowCount === 0)).toBe(true)
    expect(mockFlowLoad({ id: result.flowId })?.main).toEqual(expect.arrayContaining([`${result.source.sourceId}-s1`, `${result.source.sourceId}-s2`]))
  })

  it('sourceAdd：新子源归属正确；sourceRemove：移除后不再可见', () => {
    const res = mockSiteSourceAdd({ siteId: 'site-notice', source: { sourceId: 'site-notice-extra', name: '新增子源', url: '', configId: '', mainTable: '', owner: 'tester', state: 'C' } })
    expect(res.ok).toBe(true)
    expect(mockSiteSourcesOf({ siteId: 'site-notice' }).some((s) => s.sourceId === 'site-notice-extra')).toBe(true)

    const removed = mockSiteSourceRemove({ siteId: 'site-notice', sourceId: 'site-notice-extra' })
    expect(removed.ok).toBe(true)
    expect(mockSiteSourcesOf({ siteId: 'site-notice' }).some((s) => s.sourceId === 'site-notice-extra')).toBe(false)
  })

  it('sourceRemove：子源不属于该网站时报错', () => {
    expect(mockSiteSourceRemove({ siteId: 'site-notice', sourceId: '600036' }).ok).toBe(false)
  })

  it('sourceAdd 默认空白流程；inherit=true 仅兼容旧数据迁移', () => {
    const inherited = mockSiteSourceAdd({
      siteId: 'site-quote',
      inherit: true,
      source: { sourceId: 'sq-inherit', name: '继承子源', url: '', configId: '', mainTable: '', owner: 't', state: 'C' },
    })
    expect(inherited.ok).toBe(true)
    expect(mockFlowLoad({ id: 'sq-inherit' })).not.toBeNull()

    const blankRes = mockSiteSourceAdd({
      siteId: 'site-quote',
      source: { sourceId: 'sq-blank', name: '空白子源', url: '', configId: '', mainTable: '', owner: 't', state: 'C' },
    })
    expect(blankRes.ok).toBe(true)
    expect(mockFlowLoad({ id: 'sq-blank' })).toBeNull() // 不继承：无流程存档，空白画布起步
    expect(mockSourceDetail({ sourceId: 'sq-blank' })!.detached).toBeFalsy() // 从未跟随模板 ≠ 已单独调整
  })
})

describe('按网站批量导入子源（0710 会议 A5）', () => {
  it('importSources：解析「名称;URL」多行，空行/缺名称行跳过，导入后站内可查', () => {
    const before = mockSiteSourcesOf({ siteId: 'site-quote' }).length
    const res = mockSiteImportSources({
      siteId: 'site-quote',
      lines: '导入子源甲;https://example.com/a\n\n导入子源乙\n;https://example.com/no-name\n',
    })
    expect(res.ok).toBe(true)
    expect(res.added).toBe(2) // 甲（带 URL）+ 乙（无 URL 也允许）
    expect(res.skipped).toBe(1) // 只有 URL 没名称的行跳过；纯空行不计
    const after = mockSiteSourcesOf({ siteId: 'site-quote' })
    expect(after.length).toBe(before + 2)
    expect(after.some((s) => s.name === '导入子源甲' && s.url === 'https://example.com/a')).toBe(true)
    expect(after.filter((s) => s.name.startsWith('导入子源')).every((s) => s.siteId === 'site-quote')).toBe(true)
    expect(mockFlowLoad({ id: after.find((s) => s.name === '导入子源甲')!.sourceId })).toBeNull()
  })

  it('importSources：网站不存在或无有效行时报错', () => {
    expect(mockSiteImportSources({ siteId: 'ghost-site', lines: 'x;y' }).ok).toBe(false)
    expect(mockSiteImportSources({ siteId: 'site-quote', lines: '\n;\n' }).ok).toBe(false)
  })
})

describe('网站统一流程同步（A+C：detached 标记 + 多选同步覆盖）', () => {
  it('子源单独保存流程后 detached=true；网站同步覆盖后复位 detached=false', () => {
    expect(mockSourceDetail({ sourceId: '600519' })!.detached).toBeFalsy()

    mockFlowSave({ def: { id: '600519', name: '自定义调整', version: 'v1', main: [], branches: [], configs: {}, updatedAt: '' } })
    expect(mockSourceDetail({ sourceId: '600519' })!.detached).toBe(true)

    mockFlowSave({ def: { id: 'site:site-notice', name: '网站统一流程', version: 'v1', main: ['start', 'end'], branches: [], configs: {}, updatedAt: '' } })
    // 网站模板本身保存不应误标任何子源脱离
    expect(mockSourceDetail({ sourceId: '000001' })!.detached).toBeFalsy()

    const sync = mockSiteSyncFlow({ siteId: 'site-notice', sourceIds: ['600519'] })
    expect(sync.ok).toBe(true)
    expect(mockSourceDetail({ sourceId: '600519' })!.detached).toBe(false)
    expect(mockFlowLoad({ id: '600519' })?.name).toBe('网站统一流程')
    // 只覆盖勾选的子源：000001 未被选中，流程与 detached 均不受影响
    expect(mockFlowLoad({ id: '000001' })).toBeNull()
    expect(mockSourceDetail({ sourceId: '000001' })!.detached).toBeFalsy()
  })

  it('网站没有统一流程模板时同步报错（种子网站有虚拟默认模板，须用非种子网站验证，0710）', () => {
    const res = mockSiteSyncFlow({ siteId: 'site-user-created', sourceIds: ['600036'] })
    expect(res.ok).toBe(false)
  })

  it('种子演示网站查无存档时 flowLoad 兜底默认骨架；非种子网站返回 null（0710）', () => {
    const seedDef = mockFlowLoad({ id: 'site:site-quote' })
    expect(seedDef?.main).toEqual(['start', 'web-list', 'web-detail', 'end'])
    expect(seedDef?.name).toBe('行情快照采集')
    expect(mockFlowLoad({ id: 'site:site-user-created' })).toBeNull()
  })
})
