import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSourceStore } from './source'
import { makePresetFlowTemplates } from '@/utils/flow/flowTemplates'
import type { Source, Site } from '../api'

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 's1', name: '测试源', url: 'http://x', configId: 'c1', mainTable: 'T1', owner: 'a', state: 'C',
    ...overrides,
  } as Source
}

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    siteId: 'site1', name: '测试网站', category: '公告', owner: 'a', sourceCount: 1, errorCount: 0,
    ...overrides,
  } as Site
}

describe('source store 初始状态', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('未加载任何源/网站时 sourceCtx/sourceCfg/siteCtx 均为 null', () => {
    const s = useSourceStore()
    expect(s.sourceCtx).toBeNull()
    expect(s.sourceCfg).toBeNull()
    expect(s.siteCtx).toBeNull()
    expect(s.flowName).toBe('未命名流程')
  })
})

describe('patchSource / patchSourceCtx', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('patchSource 在 sourceCfg 为空时懒创建草稿', () => {
    const s = useSourceStore()
    s.patchSource({ name: '草稿源' })
    expect(s.sourceCfg?.name).toBe('草稿源')
    expect(s.sourceCfg?.sourceId).toBe('')
  })

  it('patchSource 在已有 sourceCfg 时合并 patch，不覆盖未提及字段', () => {
    const s = useSourceStore()
    s.patchSource({ name: 'A', url: 'http://a' })
    s.patchSource({ name: 'B' })
    expect(s.sourceCfg?.name).toBe('B')
    expect(s.sourceCfg?.url).toBe('http://a')
  })

  it('patchSourceCtx 在 sourceCtx 为 null 时 no-op（不会像 patchSource 那样懒创建）', () => {
    const s = useSourceStore()
    s.patchSourceCtx({ name: '不应生效' })
    expect(s.sourceCtx).toBeNull()
  })

  it('patchSourceCtx 在 sourceCtx 存在时合并 patch', () => {
    const s = useSourceStore()
    s.loadFromSource(makeSource(), [])
    s.patchSourceCtx({ name: '改名后' })
    expect(s.sourceCtx?.name).toBe('改名后')
    expect(s.sourceCtx?.sourceId).toBe('s1')
  })
})

describe('resetAllContext / clearSourceCtx / clearSiteCtx', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('resetAllContext 同时清空 sourceCtx、sourceCfg、siteCtx', () => {
    const s = useSourceStore()
    s.loadFromSource(makeSource(), [])
    s.setSiteDisplayCtx(makeSite())
    expect(s.sourceCtx).not.toBeNull()
    expect(s.siteCtx).not.toBeNull()
    s.resetAllContext()
    expect(s.sourceCtx).toBeNull()
    expect(s.sourceCfg).toBeNull()
    expect(s.siteCtx).toBeNull()
  })

  it('clearSourceCtx 只清空 sourceCtx/sourceCfg，保留 siteCtx（与 resetAllContext 的关键区别）', () => {
    const s = useSourceStore()
    s.loadFromSource(makeSource(), [])
    s.setSiteDisplayCtx(makeSite())
    s.clearSourceCtx()
    expect(s.sourceCtx).toBeNull()
    expect(s.sourceCfg).toBeNull()
    expect(s.siteCtx).not.toBeNull()
  })

  it('clearSiteCtx 只清空 siteCtx，保留 sourceCtx/sourceCfg', () => {
    const s = useSourceStore()
    s.loadFromSource(makeSource(), [])
    s.setSiteDisplayCtx(makeSite())
    s.clearSiteCtx()
    expect(s.siteCtx).toBeNull()
    expect(s.sourceCtx).not.toBeNull()
  })
})

describe('setSiteDisplayCtx（0714 会议 Task 3：唯一允许 siteCtx 与 sourceCtx 同时非空的场景）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('设置 siteCtx 时不影响已有的 sourceCtx（与 startSiteFlow 不同，不做互斥重置）', () => {
    const s = useSourceStore()
    s.loadFromSource(makeSource(), [])
    s.setSiteDisplayCtx(makeSite())
    expect(s.sourceCtx?.sourceId).toBe('s1')
    expect(s.siteCtx?.siteId).toBe('site1')
  })

  it('传 null 可清空 siteCtx', () => {
    const s = useSourceStore()
    s.setSiteDisplayCtx(makeSite())
    s.setSiteDisplayCtx(null)
    expect(s.siteCtx).toBeNull()
  })
})

describe('loadFromSource', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('深拷贝传入的 source，事后修改原对象不影响 store（0706 Phase4 修复）', () => {
    const s = useSourceStore()
    const source = makeSource()
    s.loadFromSource(source, [])
    source.name = '被外部改坏了'
    expect(s.sourceCtx?.name).toBe('测试源')
  })

  it('needLogin 未显式设置时按 credentialRef 是否存在回填', () => {
    const s = useSourceStore()
    const result = s.loadFromSource(makeSource({ needLogin: undefined, credentialRef: 'cred-1' }), [])
    expect(result.def.source?.needLogin).toBe(true)
  })

  it('needLogin 显式为 false 时不被 credentialRef 覆盖', () => {
    const s = useSourceStore()
    const result = s.loadFromSource(makeSource({ needLogin: false, credentialRef: 'cred-1' }), [])
    expect(result.def.source?.needLogin).toBe(false)
  })

  it('无 persistedDef 时按 steps 现场构造流程；有 persistedDef 时优先使用已保存的流程', () => {
    const s = useSourceStore()
    const built = s.loadFromSource(makeSource(), [{ stepId: 'st1', sourceId: 's1', name: '列表抓取', outputTable: 'T1', enabled: true } as never])
    expect(built.def.main.length).toBeGreaterThan(0)

    const persisted = { id: 'old', name: '已存的流程', version: 'v1', main: ['start', 'end'], branches: [], configs: {}, updatedAt: '', source: makeSource() }
    const withPersisted = s.loadFromSource(makeSource(), [], persisted as never)
    expect(withPersisted.def.main).toEqual(['start', 'end'])
  })

  it('调用会先重置旧上下文（resetAllContext），不会残留上一次的 siteCtx', () => {
    const s = useSourceStore()
    s.setSiteDisplayCtx(makeSite())
    s.loadFromSource(makeSource(), [])
    expect(s.siteCtx).toBeNull()
  })
})

describe('startSiteFlow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('设置 siteCtx 并重置 sourceCtx（与 sourceCtx 互斥，不同于 setSiteDisplayCtx）', () => {
    const s = useSourceStore()
    s.loadFromSource(makeSource(), [])
    s.startSiteFlow(makeSite())
    expect(s.siteCtx?.siteId).toBe('site1')
    expect(s.sourceCtx).toBeNull()
  })

  it('传入 def 时原样返回；不传时返回网站空白模板', () => {
    const s = useSourceStore()
    const saved = { id: 'site:site1', name: '已存模板', version: 'v1', main: ['start', 'end'], branches: [], configs: {}, updatedAt: '' }
    expect(s.startSiteFlow(makeSite(), saved as never)).toBe(saved)
    const blank = s.startSiteFlow(makeSite())
    expect(blank.main.length).toBeGreaterThan(0)
  })
})

describe('startDraftSource', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('设置 sourceCtx、清空 siteCtx，返回空白 start-end 流程（不自动塞首节点）', () => {
    const s = useSourceStore()
    s.setSiteDisplayCtx(makeSite())
    const draft = s.startDraftSource(makeSource({ name: '' }))
    expect(s.sourceCtx?.sourceId).toBe('s1')
    expect(s.siteCtx).toBeNull()
    expect(draft.main).toEqual(['start', 'end'])
    expect(draft.name).toBe('未命名采集源') // 源名为空时兜底
  })
})

describe('applyTemplate', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('没有 sourceCfg/sourceCtx 时返回 null（无源可绑）', () => {
    const s = useSourceStore()
    const template = makePresetFlowTemplates()[0]
    expect(s.applyTemplate(template, {})).toBeNull()
  })

  it('有 sourceCtx 时把 templateId/templateVersion 写入 sourceCtx', () => {
    const s = useSourceStore()
    // loadFromSource 只灌 sourceCtx；sourceCfg 由 flow.load() 事后从 FlowDef.source 灌入，不在本 action 职责内
    s.loadFromSource(makeSource(), [])
    const template = makePresetFlowTemplates()[0]
    const result = s.applyTemplate(template, {})
    expect(result).not.toBeNull()
    expect(s.sourceCtx?.templateId).toBe(template.id)
    expect(s.sourceCtx?.templateVersion).toBe(template.version)
  })

  it('有 sourceCfg 时把 templateId/templateVersion 写入 sourceCfg', () => {
    const s = useSourceStore()
    s.patchSource({ sourceId: 's1', name: '草稿源' })
    const template = makePresetFlowTemplates()[0]
    s.applyTemplate(template, {})
    expect(s.sourceCfg?.templateId).toBe(template.id)
  })
})

describe('setFlowName', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('设置流程名', () => {
    const s = useSourceStore()
    s.setFlowName('我的流程')
    expect(s.flowName).toBe('我的流程')
  })

  it('传空字符串时回退默认名，不会把 flowName 置空', () => {
    const s = useSourceStore()
    s.setFlowName('先设个名')
    s.setFlowName('')
    expect(s.flowName).toBe('未命名流程')
  })
})
