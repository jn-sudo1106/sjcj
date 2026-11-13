import { describe, expect, it } from 'vitest'
import { planSkipCondSend } from './skipCondPlan'

describe('planSkipCondSend（1109-R01 按节点忽略进入条件）', () => {
  it('没勾选：一次普通请求，不带 skipCond', () => {
    const plan = planSkipCondSend(['B', 'C'], [])
    expect(plan).toEqual({ skipIds: [], normalIds: ['B', 'C'], split: false, skipCond: false })
  })

  it('全选：一次请求 + skipCond=1（等价旧平台整批跳过）', () => {
    const plan = planSkipCondSend(['B', 'C'], ['B', 'C'])
    expect(plan).toEqual({ skipIds: ['B', 'C'], normalIds: [], split: false, skipCond: true })
  })

  it('只勾一部分：拆两次，先跳过组再正常组', () => {
    const plan = planSkipCondSend(['B', 'C'], ['B'])
    expect(plan).toEqual({ skipIds: ['B'], normalIds: ['C'], split: true, skipCond: false })
  })

  it('勾了但不在本次发送范围（例如又标了「本次不发」）：退回普通请求，不能悄悄带 skipCond', () => {
    const plan = planSkipCondSend(['B', 'C'], ['D'])
    expect(plan).toEqual({ skipIds: [], normalIds: ['B', 'C'], split: false, skipCond: false })
  })

  it('空发送范围：不产生任何分组，避免发出空 itemConfig', () => {
    expect(planSkipCondSend([], ['B'])).toEqual({ skipIds: [], normalIds: [], split: false, skipCond: false })
  })
})