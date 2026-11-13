// 输入字段统一读取（2026-11-04 F2 收口）：普通节点的真值是 taskCfg.contextMap（物理列名），
// inputFields 只兼容尚未迁移的本地草稿；规则式节点仍读 ruleCfg/execCfg.inputFields（itemCode）。
// 这里锁住三件容易走回旧路的事：① 列名 ↔ 字段 prop 双向换算；② 未指定与明确清空可区分；
// ③ 未知 token 不丢（只提示，不静默删）。
import { describe, expect, it } from 'vitest'
import { NODE_CONFIGS, cloneConfig, type FieldOption } from '@/views/FlowCanvas/canvas/flowModel'
import { inputFieldsSpecified, inputFieldSelection, inputFieldTokens } from './inputFieldSelection'

const FIELDS: FieldOption[] = [
  { prop: 'title', desc: '标题', columnName: 'K1' },
  { prop: 'url', desc: '详情链接', columnName: 'K2' },
]

function node() {
  return cloneConfig(NODE_CONFIGS['web-detail'])
}

describe('inputFieldSelection · 普通节点', () => {
  it('contextMap 存物理列名，换算回字段 prop', () => {
    const cfg = node()
    cfg.taskCfg = { queue: '', urlRule: '', contextMap: ['K2', 'K1'] }
    const selection = inputFieldSelection(cfg, FIELDS)
    expect(selection.selected).toEqual(['url', 'title'])
    expect(selection.unknown).toEqual([])
    expect(selection.specified).toBe(true)
  })

  it('未指定（没有 contextMap）与明确清空（contextMap 为空数组）可区分', () => {
    const unspecified = node()
    unspecified.taskCfg = { queue: '', urlRule: '' }
    expect(inputFieldsSpecified(unspecified)).toBe(false)
    expect(inputFieldSelection(unspecified, FIELDS).specified).toBe(false)

    const cleared = node()
    cleared.taskCfg = { queue: '', urlRule: '', contextMap: [] }
    expect(inputFieldsSpecified(cleared)).toBe(true)
    expect(inputFieldSelection(cleared, FIELDS).specified).toBe(true)
    // 两种状态的选择内容都是空——差别只在提示语与保存语义（沿用旧 context / 落 null）
    expect(inputFieldSelection(unspecified, FIELDS).selected).toEqual([])
    expect(inputFieldSelection(cleared, FIELDS).selected).toEqual([])
  })

  it('未知列保留在 unknown 里，不被静默丢弃', () => {
    const cfg = node()
    cfg.taskCfg = { queue: '', urlRule: '', contextMap: ['K1', 'K99'] }
    const selection = inputFieldSelection(cfg, FIELDS)
    expect(selection.selected).toEqual(['title'])
    expect(selection.unknown).toEqual(['K99'])
    expect(inputFieldTokens(cfg)).toEqual(['K1', 'K99'])
  })

  it('旧草稿的 inputFields 仍可回显（contextMap 未迁移时）', () => {
    const cfg = node()
    cfg.taskCfg = { queue: '', urlRule: '' }
    cfg.inputFields = ['title']
    expect(inputFieldsSpecified(cfg)).toBe(true)
    expect(inputFieldTokens(cfg)).toEqual(['title'])
  })
})

describe('inputFieldSelection · 规则式节点', () => {
  it('规则节点读 ruleCfg.inputFields，不受 taskCfg.contextMap 影响', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.ruleCfg = { ...cfg.ruleCfg, mode: 'ref', describe: '写标题', inputTableId: '900', inputFields: ['title'], outputFields: [] }
    cfg.taskCfg = { queue: '', urlRule: '', contextMap: ['K2'] }
    expect(inputFieldTokens(cfg)).toEqual(['title'])
    expect(inputFieldSelection(cfg, FIELDS).selected).toEqual(['title'])
    expect(inputFieldsSpecified(cfg)).toBe(true)
  })

  it('PDF 节点读 execCfg.inputFields，采集节点身份不变', () => {
    const cfg = cloneConfig(NODE_CONFIGS['pdf-collect'])
    cfg.execCfg = { ...cfg.execCfg, mode: 'new', describe: 'PDF 解析', inputTableId: '900', inputFields: ['url'] }
    expect(inputFieldTokens(cfg)).toEqual(['url'])
    expect(inputFieldSelection(cfg, FIELDS).selected).toEqual(['url'])
  })

  it('没有 select 的规则节点算未指定', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.ruleCfg = { ...cfg.ruleCfg, mode: 'ref', describe: '未选字段', inputTableId: '900', outputFields: [] }
    if (cfg.ruleCfg) delete cfg.ruleCfg.inputFields
    expect(inputFieldsSpecified(cfg)).toBe(false)
  })
})