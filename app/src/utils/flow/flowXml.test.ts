import { describe, expect, it } from 'vitest'
import { flowToXml, xmlEscape } from './flowXml'
import type { FlowDef } from '@/views/FlowCanvas/canvas/flowModel'

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
        configId: 'cfg-9',
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
    // configId 导入导出要用（节点引用的配置 ID），必须进 XML，不能只在页面上显示
    expect(xml).toContain('<node id="web-list" title="列表 &lt;采集&gt;" sub="网页" status="运行" kind="node" enabled="true" configId="cfg-9">')
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

  // 0902：有什么配置信息展示什么——之前完全没导出的字段这里逐个锁一遍，
  // 尤其 ruleCfg/execCfg.script 才是真正决定节点怎么跑的核心内容。
  it('导出 configName/configUrl、规则脚本正文、定时策略、监控方法、旧字段，且不泄露代理密码', () => {
    const def: FlowDef = {
      id: 'flow-2', name: '规则流程', version: '1.0', updatedAt: '2026-09-02 10:00',
      main: ['start', 'rule-1', 'end'], branches: [],
      configs: {
        'rule-1': {
          title: '规则处理', sub: '', status: '', planned: false, kind: 'node',
          configId: 'cfg-1', configName: '已有配置名', configUrl: 'https://example.com/config',
          itemId: 'item-1', stepSourceId: '-1', runPolicy: '每日 08:00',
          base: [], fields: [], inmap: [], params: [], output: [],
          outputTable: 'table-2', dedupMode: 'table',
          outFields: ['title', 'content'], inputFields: ['url'],
          structuredConfig: '规则：a=1', contentRules: 'content=trim',
          schedule: { scheduleType: 'daily', scheduleTime: '08:00', weekdays: [1, 3, 5], cron: '' },
          monitorMethods: ['row_count', 'null_rate'],
          ruleCfg: {
            mode: 'ref', ruleId: 'rule-9', name: '规则处理', describe: '清洗标题',
            script: 'print("hello & <world>")', enabled: true, format: 'python',
          },
        },
        'collect-1': {
          title: '采集节点', sub: '', status: '', planned: false, kind: 'node',
          base: [], fields: [], inmap: [], params: [], output: [],
          collectCfg: {
            snatchType: '[90] 网页抓取', webKind: 'list', url: 'https://x.com', outputTable: 't1', inputTable: '', inputParams: [], isDetail: false,
            proxyDetail: { ip: '1.2.3.4', port: 8080, account: 'proxy-user', password: 'proxy-secret' },
          },
          execCfg: { mode: 'new', describe: '', script: '<config><url>x</url></config>', format: 'xml' },
        },
      },
      branchGroups: [],
    }

    const xml = flowToXml(def)

    expect(xml).toContain('configName="已有配置名"')
    expect(xml).toContain('configUrl="https://example.com/config"')
    expect(xml).toContain('<legacy itemId="item-1" stepSourceId="-1" runPolicy="每日 08:00" />')
    expect(xml).toContain('dedupMode="table"')
    expect(xml).toContain('<outField id="title" />')
    expect(xml).toContain('<inField id="url" />')
    expect(xml).toContain('<structuredConfig>规则：a=1</structuredConfig>')
    expect(xml).toContain('<contentRules>content=trim</contentRules>')
    expect(xml).toContain('<schedule scheduleType="daily" scheduleTime="08:00" cron="" weekdays="1,3,5" />')
    expect(xml).toContain('<monitorMethod id="row_count" />')
    expect(xml).toContain('<monitorMethod id="null_rate" />')
    expect(xml).toContain('<rule mode="ref" name="规则处理" format="python" enabled="true">')
    expect(xml).not.toContain('ruleId=')
    expect(xml).toContain('<describe>清洗标题</describe>')
    expect(xml).toContain('<script>print(&quot;hello &amp; &lt;world&gt;&quot;)</script>')
    // 代理密码绝不能出现在导出文件里——只带 ip/port/account
    expect(xml).toContain('<proxy ip="1.2.3.4" port="8080" account="proxy-user" />')
    expect(xml).not.toContain('proxy-secret')
    expect(xml).toContain('<exec mode="new" format="xml">')
    expect(xml).toContain('<script>&lt;config&gt;&lt;url&gt;x&lt;/url&gt;&lt;/config&gt;</script>')
  })
})
