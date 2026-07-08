// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mockSitePaged, mockSiteDetail, mockSiteCreate, mockSiteSourcesOf, mockSiteSourceAdd, mockSiteSourceRemove, mockSiteSyncFlow } from './sites'
import { mockSourceDetail, mockSourcePaged } from './sources'
import { mockFlowSave, mockFlowLoad } from './flows'

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

  it('sourcesOfSite：语言演示子源并入通用 SOURCES（按 sourceId 各处可查，不再触发 SOURCES[0] 兜底误加载）', () => {
    const langSources = mockSiteSourcesOf({ siteId: 'site-lang-demo' })
    expect(langSources.length).toBe(24)
    expect(langSources.every((s) => s.siteId === 'site-lang-demo')).toBe(true)
    // 并入 SOURCES 后：sourceDetail 能查到真实记录（不是兜底 SOURCES[0]），sourcePaged 里也能看到
    const one = langSources[0]
    expect(mockSourceDetail({ sourceId: one.sourceId }).sourceId).toBe(one.sourceId)
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
    expect(mockSourceDetail({ sourceId: 'site-test-new-s1' }).siteId).toBe('site-test-new')
  })
})

describe('网站下增删子源', () => {
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
})

describe('网站统一流程同步（A+C：detached 标记 + 多选同步覆盖）', () => {
  it('子源单独保存流程后 detached=true；网站同步覆盖后复位 detached=false', () => {
    expect(mockSourceDetail({ sourceId: '600519' }).detached).toBeFalsy()

    mockFlowSave({ def: { id: '600519', name: '自定义调整', version: 'v1', main: [], branches: [], configs: {}, updatedAt: '' } })
    expect(mockSourceDetail({ sourceId: '600519' }).detached).toBe(true)

    mockFlowSave({ def: { id: 'site:site-notice', name: '网站统一流程', version: 'v1', main: ['start', 'end'], branches: [], configs: {}, updatedAt: '' } })
    // 网站模板本身保存不应误标任何子源脱离
    expect(mockSourceDetail({ sourceId: '000001' }).detached).toBeFalsy()

    const sync = mockSiteSyncFlow({ siteId: 'site-notice', sourceIds: ['600519'] })
    expect(sync.ok).toBe(true)
    expect(mockSourceDetail({ sourceId: '600519' }).detached).toBe(false)
    expect(mockFlowLoad({ id: '600519' })?.name).toBe('网站统一流程')
    // 只覆盖勾选的子源：000001 未被选中，流程与 detached 均不受影响
    expect(mockFlowLoad({ id: '000001' })).toBeNull()
    expect(mockSourceDetail({ sourceId: '000001' }).detached).toBeFalsy()
  })

  it('网站没有统一流程模板时同步报错', () => {
    const res = mockSiteSyncFlow({ siteId: 'site-quote', sourceIds: ['600036'] })
    expect(res.ok).toBe(false)
  })
})
