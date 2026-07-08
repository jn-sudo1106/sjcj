import { describe, expect, it } from 'vitest'
import sourceTab from './CollectAssets/SourceTab.vue?raw'
import flowCanvas from './FlowCanvas/index.vue?raw'
import nodeInspector from './FlowCanvas/NodeInspector.vue?raw'
import resultView from './FlowCanvas/ResultView.vue?raw'
import tableDialog from './FlowCanvas/TableEditDialog.vue?raw'

describe('最新方案 UI 入口收口', () => {
  it('字段级预处理/去重只在数据表编辑弹窗维护', () => {
    expect(nodeInspector).not.toContain('<th>预处理</th>')
    expect(nodeInspector).not.toContain('<th>去重</th>')
    expect(nodeInspector).not.toContain('编辑预处理 / 去重')
    expect(nodeInspector).not.toContain('去重键（写入本表时的去重依据）')
    expect(tableDialog).toContain('>预处理<')
    expect(tableDialog).toContain('>去重<')
    expect(tableDialog).toContain('v-model="f.preprocess"')
    expect(tableDialog).toContain('v-model="f.dedup"')
  })

  it('表配置不再内嵌输出表详情和字段预览', () => {
    expect(nodeInspector).toContain('查看/编辑表')
    expect(nodeInspector).toContain('新建表')
    expect(nodeInspector).not.toContain('class="rc-table-detail"')
    expect(nodeInspector).not.toContain('<th>属性</th><th>中文</th><th>类型</th><th>列宽</th>')
    expect(nodeInspector).not.toContain('selectedTable.fields.length')
  })

  it('表配置不展示自定义落表高级配置', () => {
    expect(nodeInspector).not.toContain('高级配置（写入策略 / 失败策略）')
    expect(nodeInspector).not.toContain('写入策略')
    expect(nodeInspector).not.toContain('失败策略</label>')
    expect(nodeInspector).not.toContain('patchOutputAdvanced')
  })

  it('节点配置不展示详情类数据字段，详情状态由网页类型推导', () => {
    expect(nodeInspector).toContain('WEB_KIND_OPTIONS')
    expect(nodeInspector).toContain('flow.patchCollect(id.value, { webKind:')
    expect(nodeInspector).not.toContain('详情类数据')
    expect(nodeInspector).not.toContain('toggleDetail')
    expect(nodeInspector).not.toContain(':checked="cc.isDetail"')
  })

  it('任务配置承载任务输入输出，表配置保留表管理操作', () => {
    const taskStart = nodeInspector.indexOf("<template v-else-if=\"tab === 'task'\">")
    const tableStart = nodeInspector.indexOf("<template v-else-if=\"tab === 'table'\">")
    const configStart = nodeInspector.indexOf('<!-- 节点配置：单屏纵向分组')
    expect(taskStart).toBeGreaterThan(-1)
    expect(tableStart).toBeGreaterThan(taskStart)
    expect(configStart).toBeGreaterThan(tableStart)

    const taskSection = nodeInspector.slice(taskStart, tableStart)
    const tableSection = nodeInspector.slice(tableStart, configStart)
    const configHeaderSection = nodeInspector.slice(configStart, nodeInspector.indexOf('<!-- 输入映射', configStart))

    expect(taskSection).toContain('<div class="rc-field"><label>输入表</label>')
    expect(taskSection).toContain('<ConditionRow v-if="!isFirstDataNode"')
    expect(taskSection).toContain('<div class="rc-field"><label>输出表</label>')
    expect(taskSection).toContain('@change="onOutputTableChange"')
    expect(taskSection).not.toContain('openEditTable')
    expect(taskSection).not.toContain('openNewTable')

    expect(tableSection).toContain('查看/编辑表')
    expect(tableSection).toContain('新建表')
    expect(tableSection).toContain('openEditTable')
    expect(tableSection).toContain('openNewTable')

    expect(configHeaderSection).not.toContain('<div class="rc-field"><label>输入表</label>')
    expect(configHeaderSection).not.toContain('<ConditionRow')
  })

  it('任务实例弹窗不再提供详情操作', () => {
    expect(sourceTab).not.toContain('<el-button link type="primary" size="small">详情</el-button>')
  })

  it('采集资产页顶部使用紧凑统计工具条', () => {
    expect(sourceTab).not.toContain('class="ca-kpis"')
    expect(sourceTab).toContain('class="ca-stats"')
    expect(sourceTab).toContain('网站 <b>{{ total }}</b>')
    expect(sourceTab).toContain('源 <b>{{ stats.total }}</b>')
  })

  it('采集资产网站行数据量可进入网站数据视图', () => {
    expect(sourceTab).toContain('function openSiteData(site: Site)')
    expect(sourceTab).toContain("router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })")
    expect(sourceTab).toContain('<button class="ca-count-link" type="button" title="查看该网站全部子源数据" @click="openSiteData(site)">')
    expect(sourceTab).toContain('{{ (site.dataCount ?? 0).toLocaleString() }} 条')
  })

  it('网站数据视图无模板时用子源步骤生成可查看节点', () => {
    expect(resultView).toContain('buildSourceSeed')
    expect(resultView).toContain('sourceApi.sourceSteps(first.sourceId)')
    expect(resultView).toContain('templateLayout.value = buildHorizontalLayout(seed.main, seed.branches, seed.configs)')
  })

  it('新建采集分类使用下拉并有默认分类', () => {
    expect(flowCanvas).toContain('GATE_CATEGORY_OPTIONS')
    expect(flowCanvas).toContain("category: GATE_CATEGORY_OPTIONS[0].value")
    expect(flowCanvas).toContain('<select class="rc-select" v-model="gateSite.category"')
    expect(flowCanvas).not.toContain('<div class="rc-field"><label>分类</label><input class="rc-input" v-model="gateSite.category"')
  })

  it('采集节点配置不再展示输入映射和输入参数', () => {
    expect(nodeInspector).toContain('v-if="!cc"')
    expect(nodeInspector).not.toContain('<template v-if="cc">\n          <div class="rc-field"><label>输入参数[多选]</label>')
    expect(nodeInspector).not.toContain('采集/非采集节点统一显示')
  })

  it('节点配置支持 APP 入口字段与任务多参数', () => {
    expect(nodeInspector).toContain('APP 包名')
    expect(nodeInspector).toContain('collectUrlLabel')
    expect(nodeInspector).toContain('任务参数')
    expect(nodeInspector).toContain('添加任务参数')
  })

  it('规则节点使用规则编排面板', () => {
    expect(nodeInspector).toContain('规则编排')
    expect(nodeInspector).toContain('引用已有规则')
    expect(nodeInspector).toContain('新建编排')
    expect(nodeInspector).toContain('规则需求描述')
    expect(nodeInspector).toContain('系统提示词')
    expect(nodeInspector).toContain('生成脚本')
    expect(nodeInspector).toContain('测试脚本')
    expect(nodeInspector).toContain('保存脚本')
  })
})
