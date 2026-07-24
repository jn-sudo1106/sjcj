import { describe, expect, it } from 'vitest'
import { flowToXml, xmlEscape } from './flowXml'
import type { FlowDef } from '@/views/FlowCanvas/flowModel'

function flowFixture(): FlowDef {
  return {
    id: 'flow-1',
    name: 'A & B',
    version: '1.0',
    updatedAt: '2026-07-13T12:00:00Z',
    main: ['start', 'web-list', 'end'],
    branches: [],
    configs: {
      'web-list': {
        title: '列表 <采集>',
        sub: '网页',
        status: '运行',
        planned: false,
        collect: true,
        kind: 'node',
        base: [],
        fields: [],
        inmap: [{ name: 'url', from: '输入 & 来源', desc: '链接' }],
        params: [{ name: 'page', type: 'sequence', desc: '页码' }],
        output: [{ name: 'title', type: 'string', desc: '标题' }],
        collectCfg: {
          snatchType: '[90] 网页抓取',
          webKind: 'list',
          url: 'https://example.com/?a=1&b=2',
          outputTable: 'table-1',
          inputTable: '',
          inputParams: ['page'],
          isDetail: false,
        },
        outputTable: 'table-1',
        taskCfg: {
          queue: 'queue-a', urlSourceField: 'url', urlRule: 'https://x/$id',
          paramValues: [{ paramId: 'p-date', fieldId: 'publish_date', valueExpr: 'format($VAL$)' }],
          contextMap: ['title'], outColumns: ['content'],
        },
      },
    },
    branchGroups: [{
      ownerId: 'web-list',
      branches: [{ id: 'branch-1', label: '条件分支 1', condition: { logic: 'AND', items: [{ field: 'title', op: 'contains', value: 'A&B' }] }, chain: [] }],
    }],
  }
}

describe('flowXml', () => {
  it('序列化节点、采集配置、表、参数、任务和条件分支，并转义 XML 特殊字符', () => {
    const xml = flowToXml(flowFixture())

    expect(xml).toContain('<flow id="flow-1" name="A &amp; B"')
    expect(xml).toContain('<node id="web-list" title="列表 &lt;采集&gt;" kind="node" enabled="true">')
    expect(xml).toContain('<collect snatchType="[90] 网页抓取" webKind="list" url="https://example.com/?a=1&amp;b=2"')
    expect(xml).toContain('<table outputTable="table-1"')
    expect(xml).toContain('<param name="page" type="sequence" desc="页码" />')
    expect(xml).toContain('<task queue="queue-a" urlSourceField="url" urlRule="https://x/$id">')
    expect(xml).toContain('<paramValue paramId="p-date" fieldId="publish_date" valueExpr="format($VAL$)" />')
    expect(xml).toContain('<context fieldId="title" />')
    expect(xml).toContain('<outColumn fieldId="content" />')
    expect(xml).toContain('<branch id="branch-1" label="条件分支 1">')
    expect(xml).toContain('<condition logic="AND">')
    expect(xml).toContain('<rule field="title" op="contains" value="A&amp;B" />')
  })

  it('转义 XML 文本和属性中的特殊字符', () => {
    expect(xmlEscape(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;')
  })
})
