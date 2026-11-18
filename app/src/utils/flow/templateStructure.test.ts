import { describe, expect, it } from 'vitest'
import type { FlowDefinition } from '@/api'
import { templateStructureChain } from './templateStructure'

const def = (partial: Partial<FlowDefinition>): FlowDefinition => ({ main: [], branches: [], configs: {}, ...partial }) as FlowDefinition

describe('templateStructureChain', () => {
  it('主链按 main 顺序，去掉开始 / 结束端点', () => {
    const chain = templateStructureChain(def({
      main: ['start', 'node-1', 'node-2', 'end'],
      configs: {
        'node-1': { title: '列表采集', sub: '', configType: '90', collect: true },
        'node-2': { title: '清洗', sub: '', configType: '600' },
      } as never,
    }))
    expect(chain?.nodes.map((n) => [n.label, n.kind])).toEqual([['列表采集', 'capture'], ['清洗', 'rule']])
    expect(chain?.nodes[0].typeLabel).toBe('网页抓取')
    expect(chain?.branchNodes).toEqual([])
  })

  it('不在主链上的节点算分支节点；标题缺失时用类型名', () => {
    const chain = templateStructureChain(def({
      main: ['start', 'node-1', 'end'],
      configs: {
        'node-1': { title: '采集', sub: '', configType: '90', collect: true },
        'node-9': { title: '', sub: '', configType: '' },
      } as never,
    }))
    expect(chain?.branchNodes.map((n) => [n.label, n.typeLabel])).toEqual([['未知类型', '']])
  })

  it('没有节点或没有定义时返回 null，交给调用方退回文字版', () => {
    expect(templateStructureChain(def({ main: ['start', 'end'] }))).toBeNull()
    expect(templateStructureChain(null)).toBeNull()
    expect(templateStructureChain({ main: ['start', 'node-1'] } as never)).toBeNull()
  })
})
