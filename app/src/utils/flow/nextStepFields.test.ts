import { describe, expect, it } from 'vitest'
import { nextStepColumns } from './nextStepFields'
import type { FlowBranchGroup, NodeConfig, TaskConfig } from '@/views/FlowCanvas/canvas/flowModel'

function node(partial: Partial<NodeConfig> = {}): NodeConfig {
  return { title: 'n', sub: '', status: '', planned: false, ...partial } as NodeConfig
}
function task(partial: Partial<TaskConfig>): TaskConfig {
  return { queue: '', urlRule: '', ...partial }
}

// 表列：prop 是业务标识（itemCode），columnName 是物理列（K1/K2...）
const columns = [
  { prop: 'title', columnName: 'K1' },
  { prop: 'url', columnName: 'K2' },
  { prop: 'body', columnName: 'K3' },
  { prop: 'author', columnName: 'K4' },
]

describe('nextStepColumns', () => {
  it('末节点没有后继时返回空数组（调用方据此退回全部列）', () => {
    const configs = { a: node(), b: node() }
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'b' })).toEqual([])
  })

  it('后继的 contextMap 存物理列名，要能换算回 prop', () => {
    const configs = {
      a: node(),
      b: node({ taskCfg: task({ contextMap: ['K2', 'K1'] }) }),
    }
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'a' })).toEqual(['title', 'url'])
  })

  it('后继的进入条件字段与当前节点出参列一并并进来', () => {
    const configs = {
      a: node({ taskCfg: task({ outColumns: ['author'] }) }),
      b: node({
        taskCfg: task({ contextMap: ['K2'] }),
        entryCondition: { logic: 'AND', items: [{ field: 'body', op: 'notEmpty', value: '' }] },
      }),
    }
    // 返回值按表列原序，不按配置里的书写顺序
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'a' })).toEqual(['url', 'body', 'author'])
  })

  it('进入条件里存的是物理列名（旧数据）时同样认得', () => {
    const configs = {
      a: node(),
      b: node({ entryCondition: { logic: 'AND', items: [{ field: 'K3', op: 'notEmpty', value: '' }] } }),
    }
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'a' })).toEqual(['body'])
  })

  it('表达式模式的进入条件退回正则扫 K 列', () => {
    const configs = {
      a: node(),
      b: node({ entryCondition: { mode: 'expr', logic: 'AND', items: [], expr: "K1 LIKE '%金融%' AND K4 IS NOT NULL" } }),
    }
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'a' })).toEqual(['title', 'author'])
  })

  it('分叉点下游取各分支首个真实节点的并集', () => {
    const configs = {
      a: node(),
      fork: node(),
      b1: node({ taskCfg: task({ contextMap: ['K1'] }) }),
      b2: node({ taskCfg: task({ contextMap: ['K4'] }) }),
    }
    const branchGroups: FlowBranchGroup[] = [
      { ownerId: 'fork', branches: [{ label: '左', chain: ['b1'] }, { label: '右', chain: ['b2'] }] } as FlowBranchGroup,
    ]
    expect(nextStepColumns({ columns, main: ['a', 'fork'], configs, branchGroups, nodeId: 'fork' }))
      .toEqual(['title', 'author'])
  })

  it('后继存在但三处配置都空时返回空数组，不返回一张空表', () => {
    const configs = { a: node(), b: node() }
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'a' })).toEqual([])
  })

  it('配置引用了当前表没有的字段时把它丢掉，不塞进预设', () => {
    const configs = {
      a: node(),
      b: node({ taskCfg: task({ contextMap: ['K1', 'K99', 'ghost'] }) }),
    }
    expect(nextStepColumns({ columns, main: ['a', 'b'], configs, nodeId: 'a' })).toEqual(['title'])
  })

  it('停用的后继要跳过，看穿它找下一个真实节点', () => {
    const configs = {
      a: node(),
      b: node({ disabled: true, taskCfg: task({ contextMap: ['K1'] }) }),
      c: node({ taskCfg: task({ contextMap: ['K4'] }) }),
    }
    expect(nextStepColumns({ columns, main: ['a', 'b', 'c'], configs, nodeId: 'a' })).toEqual(['author'])
  })
})
