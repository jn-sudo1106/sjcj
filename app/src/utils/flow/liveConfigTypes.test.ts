import { afterEach, describe, expect, it } from 'vitest'
import { hasLiveConfigTypes, resolveLiveConfigCode, setLiveConfigTypes } from './liveConfigTypes'
import { configTypeFrom } from './nodeConfigPayload'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'

// 186（2026-11-19 实测）：cfg_source_type 的 1105 迁移后「规则处理」是 910、没有 600 行。
// 快照里写死 600 会让保存把 cs_config.CONFIG_TYPE 写回 600，任务落到没人消费的
// dev_web_snatch_admin。这里锁住「按实时字典纠偏、老环境不变」的三条分支。
function ruleNode() {
  const cfg = cloneConfig(NODE_CONFIGS.rule)
  cfg.template = 'rule'
  return cfg
}

afterEach(() => {
  setLiveConfigTypes(null)
})

describe('liveConfigTypes 实时字典纠偏', () => {
  it('没有注册实时字典时用快照编号', () => {
    expect(hasLiveConfigTypes()).toBe(false)
    expect(resolveLiveConfigCode('600', 'rule')).toBe('600')
    expect(resolveLiveConfigCode('90')).toBe('90')
  })

  it('快照编号仍在字典里时原样返回（老环境 600 仍可用）', () => {
    setLiveConfigTypes([
      { code: '600', name: '规则处理' },
      { code: '90', name: '网页抓取' },
    ])
    expect(resolveLiveConfigCode('600', 'rule')).toBe('600')
  })

  it('快照编号不在字典、但有同名类型时用同名编号（186 的 910）', () => {
    setLiveConfigTypes([
      { code: '90', name: '网页抓取' },
      { code: '910', name: '规则处理' },
    ])
    expect(resolveLiveConfigCode('600', 'rule')).toBe('910')
    // 名字对不上就回退快照，不猜
    expect(resolveLiveConfigCode('600', 'monitor')).toBe('600')
    expect(resolveLiveConfigCode('610')).toBe('610')
  })

  it('configTypeFrom 按实时字典写规则节点类型', () => {
    const cfg = ruleNode()
    expect(configTypeFrom(cfg)).toBe(600)

    setLiveConfigTypes([
      { code: '910', name: '规则处理' },
      { code: '90', name: '网页抓取' },
    ])
    expect(configTypeFrom(cfg)).toBe(910)

    // 设置页把 600 行加回来（或 217/133 本来就有）时回到快照值
    setLiveConfigTypes([
      { code: '600', name: '规则处理' },
      { code: '910', name: '规则处理' },
    ])
    expect(configTypeFrom(cfg)).toBe(600)
  })
})