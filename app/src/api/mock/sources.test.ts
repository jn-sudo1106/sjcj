// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mockSourcePaged, mockSourceDetail, mockSourceCreate, mockSourceUpdate, mockSourceNodeRuns, mockSourceSteps, mockSourceTaskPaged, mockChangeSourceEnable, mockChangeToSuccess, mockBatchImport, SOURCES } from './sources'

describe('source mock 筛选', () => {
  it('支持外部变更待确认筛选', () => {
    const result = mockSourcePaged({ state: 'external', size: 999 })

    expect(result.total).toBeGreaterThan(0)
    expect(result.list.every((source) => source.externalChanged)).toBe(true)
  })
})

describe('新建 / 编辑源（0706 Phase3/4）', () => {
  it('createSource：源 ID 查重，重复创建被拦截', () => {
    const dup = mockSourceCreate({ source: { sourceId: '391007768', name: 'x', url: 'u', configId: '', mainTable: '', owner: '', state: 'C' } })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('已存在')
  })

  it('createSource：参数源字段（kind/baseUrl/urlTemplate/paramRefs）1:1 序列化带出（0721 会议·参数源）', () => {
    const paramRefs = [{ paramId: '913', group: null }, { paramId: '912', group: 'A' as string | null }]
    const res = mockSourceCreate({
      source: {
        sourceId: 'src-param-test-1',
        name: '参数源测试',
        url: '',
        configId: '',
        mainTable: '',
        owner: 'tester',
        state: 'C',
        kind: 'param',
        baseUrl: 'http://FundComment-2017052400023003000000000013026',
        urlTemplate: 'http://FundComment-2017052400023003000000000013026-$PARAM$_913-$PARAM$_912',
        paramRefs,
      },
    })
    expect(res.ok).toBe(true)
    const detail = mockSourceDetail({ sourceId: 'src-param-test-1' })
    expect(detail?.kind).toBe('param')
    expect(detail?.baseUrl).toBe('http://FundComment-2017052400023003000000000013026')
    expect(detail?.urlTemplate).toBe('http://FundComment-2017052400023003000000000013026-$PARAM$_913-$PARAM$_912')
    expect(detail?.paramRefs).toEqual(paramRefs)
  })

  it('updateSource：真写回 SOURCES，sourceDetail 可见变更；未知源报错', () => {
    const before = mockSourceDetail({ sourceId: '391007768' })
    const res = mockSourceUpdate({ source: { ...before!, tags: ['A', 'B'] } })
    expect(res.ok).toBe(true)
    expect(mockSourceDetail({ sourceId: '391007768' })!.tags).toEqual(['A', 'B'])
    expect(mockSourceUpdate({ source: { sourceId: 'ghost-404', name: '', url: '', configId: '', mainTable: '', owner: '', state: 'C' } }).ok).toBe(false)
  })
})

describe('源状态 / 导入落库（0707 Review #1/#2/#3 修复）', () => {
  it('changeToSuccess：真改 state=C 并清告警；未知源报错', () => {
    const errSrc = SOURCES.find((s) => s.state === 'E' && !s.disabled) ?? SOURCES[0]
    const before = { state: errSrc.state, alarm: errSrc.alarm }
    const res = mockChangeToSuccess({ sourceId: errSrc.sourceId })
    expect(res.ok).toBe(true)
    expect(errSrc.state).toBe('C')
    expect(errSrc.alarm).toBe(false)
    // 未知源
    expect(mockChangeToSuccess({ sourceId: 'ghost-404' }).ok).toBe(false)
    // 不还原：保留为 C（与其他写测试同口径）
    void before
  })

  it('changeSourceEnable：真改 disabled；未知源报错', () => {
    const src = SOURCES.find((s) => !s.disabled) ?? SOURCES[0]
    const res = mockChangeSourceEnable({ sourceId: src.sourceId, disabled: true })
    expect(res.ok).toBe(true)
    expect(src.disabled).toBe(true)
    expect(mockChangeSourceEnable({ sourceId: 'ghost-404', disabled: false }).ok).toBe(false)
  })

  it('batchImport：按模板源 + lines（名称;url）派生新源并落库；deep/dir 生效；空模板 / 未知模板 / 空行被拦截', () => {
    const tpl = SOURCES[0]
    const before = SOURCES.length
    const res = mockBatchImport({ template: tpl.sourceId, lines: '基金A;url-a\n基金B;url-b', deep: true, dir: '/基金类/雪球' })
    expect(res.ok).toBe(true)
    expect(SOURCES.length).toBe(before + 2)
    const imported = SOURCES.slice(-2)
    expect(imported[0].name).toBe('基金A')
    expect(imported[0].url).toBe('url-a')
    expect(imported[0].categoryPath).toBe('/基金类/雪球')
    expect(imported[0].configId).not.toBe(tpl.configId) // deep 生成了独立 configId
    expect(imported[1].name).toBe('基金B')
    // 拦截
    expect(mockBatchImport({ template: '', lines: 'x;y' }).ok).toBe(false)
    expect(mockBatchImport({ template: tpl.sourceId, lines: '' }).ok).toBe(false)
    expect(mockBatchImport({ template: 'ghost-tpl', lines: 'x;y' }).ok).toBe(false)
  })
})

describe('节点粒度运行统计（0706 Phase4·任务视图=运行视图）', () => {
  it('nodeRunStats：与 sourceSteps 的步骤 id 同口径，含队列/总数/已处理/状态', () => {
    const stats = mockSourceNodeRuns({ sourceId: '391007768' })
    const stepIds = mockSourceSteps({ sourceId: '391007768' }).map((s) => s.stepId)
    expect(stats.length).toBe(2)
    stats.forEach((s) => {
      expect(stepIds).toContain(s.nodeId)
      expect(s.totalTasks).toBeGreaterThanOrEqual(s.processedTasks)
    })
  })

  it('nodeRunStats：未知源返回空数组', () => {
    expect(mockSourceNodeRuns({ sourceId: 'ghost-404' })).toEqual([])
  })
})

describe('子源任务分页（0713）', () => {
  it('只返回指定子源节点生成的任务，并支持节点、状态和分页筛选', () => {
    const sourceId = '391007768'
    const siteId = 'site-zfb'
    const all = mockSourceTaskPaged({ siteId, sourceId, size: 20 })
    const stepIds = mockSourceSteps({ sourceId }).map((step) => step.stepId)

    expect(all.total).toBeGreaterThan(0)
    expect(all.list.every((task) => task.sourceId === sourceId)).toBe(true)
    expect(all.list.every((task) => stepIds.includes(task.node ?? ''))).toBe(true)

    const oneNode = mockSourceTaskPaged({ siteId, sourceId, nodeId: stepIds[0], size: 20 })
    expect(oneNode.total).toBeGreaterThan(0)
    expect(oneNode.list.every((task) => task.node === stepIds[0])).toBe(true)

    const completed = mockSourceTaskPaged({ siteId, sourceId, state: 'C', page: 1, size: 1 })
    expect(completed.total).toBeGreaterThan(1)
    expect(completed.list).toHaveLength(1)
    expect(completed.list[0].state).toBe('C')
  })

  it('不传子源时汇总同一网站全部子源的任务', () => {
    const all = mockSourceTaskPaged({ siteId: 'site-news', size: 99 })

    expect(all.total).toBeGreaterThan(0)
    expect(new Set(all.list.map((task) => task.sourceId))).toEqual(new Set(['NEWS5521', 'NEWS5522']))
  })

  it('未知子源没有任务', () => {
    expect(mockSourceTaskPaged({ siteId: 'site-zfb', sourceId: 'ghost-404' })).toEqual({ total: 0, list: [] })
  })

  it('网站与子源不匹配时不返回任务', () => {
    expect(mockSourceTaskPaged({ siteId: 'site-news', sourceId: '391007768' })).toEqual({ total: 0, list: [] })
  })
})
