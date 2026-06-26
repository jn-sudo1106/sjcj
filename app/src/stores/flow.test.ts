import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFlowStore } from './flow'
import { mockFlowRecommend } from '../api/mock/flows'

describe('flow store 编辑动作', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard') // 载入标准链路（= 公告规则采集 Demo）作为编辑基线
  })

  it('insertAfter 在主链插入节点', () => {
    const before = f.main.length
    f.insertAfter('web-list', 'web')
    expect(f.main.length).toBe(before + 1)
  })

  it('moveTo 重排且保持首尾终端', () => {
    f.moveTo('web-list', 'ai-extract')
    const m = f.main
    expect(m.indexOf('web-list')).toBeGreaterThan(m.indexOf('ai-extract'))
    expect(m[0]).toBe('start')
    expect(m[m.length - 1]).toBe('end')
  })

  it('moveTo 不移动终端节点', () => {
    f.moveTo('start', 'rule')
    expect(f.main[0]).toBe('start')
  })

  it('patchCollect 写入采集配置', () => {
    f.patchCollect('web-list', { url: 'http://new.example' })
    expect(f.configs['web-list'].collectCfg?.url).toBe('http://new.example')
  })

  it('网页抓取节点细分为列表页、详情页、文件附件页', () => {
    expect(f.configs['web-list'].collectCfg?.webKind).toBe('list')
    expect(f.configs['web-detail'].collectCfg?.webKind).toBe('detail')

    f.insertAfter('web-detail', 'web')
    const inserted = f.selectedId
    expect(f.configs[inserted].collectCfg?.webKind).toBe('list')

    f.patchCollect(inserted, { webKind: 'detail' })
    expect(f.configs[inserted].collectCfg?.isDetail).toBe(true)

    f.patchCollect(inserted, { webKind: 'attachment' })
    expect(f.configs[inserted].collectCfg?.isDetail).toBe(false)
  })

  it('附件页取消详情类标记时仍保留附件类型', () => {
    f.patchCollect('web-detail', { webKind: 'attachment' })
    f.patchCollect('web-detail', { isDetail: false })

    expect(f.configs['web-detail'].collectCfg?.webKind).toBe('attachment')
    expect(f.configs['web-detail'].collectCfg?.isDetail).toBe(false)
  })

  it('setEdgeRow 改子步骤字段', () => {
    f.setEdgeRow('web-list', 0, '新适用源')
    expect(f.edges['web-list'].rows[0][1]).toBe('新适用源')
  })

  it('addEdgeContext / removeEdgeContext', () => {
    const n = f.edges['web-list'].context.length
    f.addEdgeContext('web-list', 'K9 → x')
    expect(f.edges['web-list'].context.length).toBe(n + 1)
    f.removeEdgeContext('web-list', f.edges['web-list'].context.length - 1)
    expect(f.edges['web-list'].context.length).toBe(n)
  })
})

describe('flow store 新建 / 校验（M5.5）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
  })

  it('默认空白画布：仅 开始 / 完成，无业务节点', () => {
    expect(f.main).toEqual(['start', 'end'])
    expect(Object.keys(f.configs).length).toBe(0)
  })

  it("newFlow('standard') 载入标准链路，newFlow('blank') 重置为空白", () => {
    f.newFlow('standard')
    expect(f.main).toContain('web-list')
    expect(f.main).toContain('rule')
    f.newFlow('blank')
    expect(f.main).toEqual(['start', 'end'])
    expect(f.branches.length).toBe(0)
  })

  it('validateFlow：空链路报错', () => {
    expect(f.validateFlow().length).toBeGreaterThan(0)
  })

  it('validateFlow：采集节点缺 URL / 输出表 报错', () => {
    f.newFlow('blank')
    f.insertAfter('start', 'web') // 新插入采集节点的 url / outputTable 默认清空
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('源 URL'))).toBe(true)
    expect(errs.some((e) => e.includes('输出表'))).toBe(true)
  })

  it('serialize → load 往返一致', () => {
    f.newFlow('standard')
    const snap = f.serialize()
    f.newFlow('blank')
    f.load(snap)
    expect(f.main).toEqual(snap.main)
    expect(Object.keys(f.configs).sort()).toEqual(Object.keys(snap.configs).sort())
  })
})

describe('flow/recommend 意图匹配（M5.5）', () => {
  it('命中「公共网页抓取」关键词', () => {
    const r = mockFlowRecommend({ prompt: '我想做个公共网页数据抓取' })
    expect(r.flow.name).toContain('公共网页')
    expect(r.flow.main.filter((id) => id !== 'start' && id !== 'end').length).toBeGreaterThan(0)
    expect(r.alternatives.length).toBeGreaterThan(0)
  })

  it('按 intent 直选「文件下载解析」', () => {
    const r = mockFlowRecommend({ intent: 'file-parse' })
    expect(r.flow.name).toContain('文件下载解析')
    const fileNodeId = r.flow.main.find((id) => id.includes('web-detail'))
    expect(fileNodeId).toBeTruthy()
    expect(r.flow.configs[fileNodeId!].collectCfg?.webKind).toBe('attachment')
  })

  it('未命中 → 空白流程兜底', () => {
    const r = mockFlowRecommend({ prompt: 'zzz qqq xxx' })
    expect(r.flow.main).toEqual(['start', 'end'])
  })
})
