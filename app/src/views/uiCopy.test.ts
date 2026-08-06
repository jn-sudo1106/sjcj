import { describe, expect, it } from 'vitest'
import sourceTab from './CollectAssets/SourceTab.vue?raw'
import batchBar from './CollectAssets/components/BatchBar.vue?raw'
import tableView from './CollectAssets/components/TableView.vue?raw'
import filterToolbar from './CollectAssets/components/FilterToolbar.vue?raw'
import collectAssetsIndex from './CollectAssets/index.vue?raw'
import flowCanvas from './FlowCanvas/index.vue?raw'
import nodeInspector from './FlowCanvas/inspector/NodeInspector.vue?raw'
import taskTab from './FlowCanvas/inspector/tabs/TaskTab.vue?raw'
import tableTab from './FlowCanvas/inspector/tabs/TableTab.vue?raw'
import paramsTab from './FlowCanvas/inspector/tabs/ParamsTab.vue?raw'
import configTab from './FlowCanvas/inspector/tabs/ConfigTab.vue?raw'
import ruleOrchestrationTab from './FlowCanvas/inspector/tabs/RuleOrchestrationTab.vue?raw'
import ruleTableFieldBinder from './FlowCanvas/inspector/RuleTableFieldBinder.vue?raw'
import canvasHeader from './FlowCanvas/shared/CanvasHeader.vue?raw'
import flowBoard from './FlowCanvas/canvas/FlowBoard.vue?raw'
import sourceBasicForm from './FlowCanvas/SourceBasicForm.vue?raw'
import collectorSettings from './FlowCanvas/inspector/CollectorSettings.vue?raw'
import resultView from './FlowCanvas/result/ResultView.vue?raw'
import siteSourceSwitcher from './FlowCanvas/source/SiteSourceSwitcher.vue?raw'
import tableDialog from './FlowCanvas/inspector/TableEditDialog.vue?raw'
import siteCardGrid from './CollectAssets/SiteCardGrid.vue?raw'
import appModuleHead from '../layouts/AppModuleHead.vue?raw'
import runtimeStore from '../stores/runtime.ts?raw'
import ruleAssetsIndex from './RuleAssets/index.vue?raw'

// NodeInspector 拆 tab 子组件后（P1-1 Step 4），各 tab 的文案分布在子文件里；
// 这个常量把主壳 + 各 tab 拼起来，用于「整块 inspector 不该出现某字符串」的负向断言。
// 0801 方案：规则编排面板从 ConfigTab 移入独立的 RuleOrchestrationTab（+ RuleTableFieldBinder）。
const allInspectorSource = nodeInspector + taskTab + tableTab + paramsTab + configTab + ruleOrchestrationTab + ruleTableFieldBinder

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
    expect(tableTab).toContain('查看/编辑表')
    expect(tableTab).toContain('新建表')
    expect(allInspectorSource).not.toContain('class="rc-table-detail"')
    expect(allInspectorSource).not.toContain('<th>属性</th><th>中文</th><th>类型</th><th>列宽</th>')
    expect(allInspectorSource).not.toContain('selectedTable.fields.length')
  })

  it('表配置不展示自定义落表高级配置', () => {
    expect(nodeInspector).not.toContain('高级配置（写入策略 / 失败策略）')
    expect(nodeInspector).not.toContain('写入策略')
    expect(nodeInspector).not.toContain('失败策略</label>')
    expect(nodeInspector).not.toContain('patchOutputAdvanced')
  })

  it('节点配置不展示详情类数据字段，详情状态由网页类型推导', () => {
    expect(configTab).toContain('WEB_KIND_OPTIONS')
    expect(configTab).toContain('flow.patchCollect(id.value, { webKind:')
    expect(allInspectorSource).not.toContain('详情类数据')
    expect(allInspectorSource).not.toContain('toggleDetail')
    expect(allInspectorSource).not.toContain(':checked="cc.isDetail"')
  })

  it('任务配置承载任务输入和队列，输出表仅在表配置维护', () => {
    // 拆 tab 后（P1-1 Step 4）：任务/表/节点配置分别在 TaskTab/TableTab/ConfigTab，
    // 不再共用 NodeInspector 模板里的 <template v-else-if="tab === ..."> 切片，直接按文件断言。
    expect(taskTab).toContain('有效输入表')
    expect(taskTab).not.toContain('@change="onInputTableChange"')
    expect(taskTab).not.toContain('<div class="rc-field"><label>输出表')
    expect(taskTab).not.toContain('@change="onOutputTableChange"')
    expect(taskTab).not.toContain('openEditTable')
    expect(taskTab).not.toContain('openNewTable')
    expect(taskTab).toContain('<ConditionRow v-if="hasEffectiveInput"')
    expect(taskTab).not.toContain('isFirstDataNode')
    expect(taskTab).toContain('@change="onEntryConditionChange"')

    expect(tableTab).toContain('查看/编辑表')
    expect(tableTab).toContain('新建表')
    expect(tableTab).toContain('openEditTable')
    expect(tableTab).toContain('openNewTable')

    expect(configTab).not.toContain('<div class="rc-field"><label>输入表</label>')
    expect(configTab).not.toContain('<ConditionRow')
  })

  it('任务实例弹窗不再提供详情操作', () => {
    expect(sourceTab).not.toContain('<el-button link type="primary" size="small">详情</el-button>')
  })

  it('采集资产页顶部使用紧凑统计工具条', () => {
    // P2-2 拆分后统计工具条移到 FilterToolbar.vue 子组件
    expect(filterToolbar).not.toContain('class="ca-kpis"')
    expect(filterToolbar).toContain('class="ca-stats"')
    expect(filterToolbar).toContain('网站 <b>{{ total }}</b>')
    expect(filterToolbar).toContain('源 <b>{{ stats.total }}</b>')
  })

  it('采集资产网站行数据量可进入网站数据视图', () => {
    // P2-2 拆分后表格视图移到 TableView.vue 子组件
    expect(tableView).toContain('function openSiteData(site: Site)')
    expect(tableView).toContain("router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })")
    expect(tableView).toContain('<button class="ca-count-link" type="button" title="查看该网站全部子源数据" @click="openSiteData(site)">')
    expect(tableView).toContain('{{ (site.dataCount ?? 0).toLocaleString() }} 条')
  })

  it('采集资产卡片的子源直达流程画布，卡片底部不再提供任务入口', () => {
    expect(siteCardGrid).toContain("query: { sourceId: s.sourceId, view: 'flow' }")
    expect(siteCardGrid).not.toContain('scg-foot-task')
    expect(siteCardGrid).not.toContain('openSiteTask')
  })

  it('采集资产表格展开收起入口收进表头右侧', () => {
    // P2-2 拆分后表格视图移到 TableView.vue 子组件
    expect(tableView).not.toContain('class="ca-table-ops"')
    expect(tableView).not.toContain('共 {{ total }} 个网站')
    expect(tableView).toContain('class="ca-expand-menu"')
    expect(tableView).toContain('title="展开/收起"')
    expect(tableView).toContain('<el-icon :size="14"><Operation /></el-icon>')
    expect(tableView).not.toContain('>展开/收起⌄</button>')
  })

  it('数据视图只使用当前子源流程，节点图不展示开始/结束', () => {
    expect(resultView).toContain('ProcessNodeRail')
    expect(resultView).toContain('includeTerminals: false')
    expect(resultView).not.toContain('buildSourceSeed')
    expect(resultView).not.toContain('templateLayout')
  })

  it('新建采集分类使用可搜索的目录树', () => {
    expect(flowCanvas).toContain('CategoryTreePicker')
    expect(flowCanvas).toContain('<CategoryTreePicker v-model="gateCategory" />')
    expect(flowCanvas).not.toContain('GATE_CATEGORY_OPTIONS')
    expect(flowCanvas).not.toContain('<select class="rc-select" v-model="gateSite.category"')
  })

  it('新建采集删除标签字段和子源默认设置整块', () => {
    expect(flowCanvas).not.toContain('gateSourceDefaults')
    expect(flowCanvas).not.toContain('gateTagsInput')
    expect(flowCanvas).not.toContain('<SourceBasicForm')
    expect(flowCanvas).not.toContain('<div class="rc-field"><label>标签</label>')
  })

  it('新建采集首个子源名称跟随网站名称，手动改过后停止跟随', () => {
    expect(flowCanvas).toContain('firstSourceNameTouched')
    expect(flowCanvas).toContain("if (!firstSourceNameTouched.value && gateRows.value[0]) gateRows.value[0].name = name")
    expect(flowCanvas).toContain('@input="i === 0 && (firstSourceNameTouched = true)"')
  })

  it('节点配置不再展示输入映射和输入参数（0804 拍板：整块删除，非只对采集节点隐藏）', () => {
    expect(configTab).not.toContain('输入映射')
    expect(configTab).not.toContain("onTripleCell('inmap'")
    expect(allInspectorSource).not.toContain('<template v-if="cc">\n          <div class="rc-field"><label>输入参数[多选]</label>')
    expect(allInspectorSource).not.toContain('采集/非采集节点统一显示')
  })

  it('节点配置支持 APP 入口字段；任务参数由当前节点参数配置决定', () => {
    expect(configTab).toContain('APP 包名')
    expect(configTab).toContain('collectUrlLabel')
    expect(taskTab).toContain('任务参数取值')
    expect(taskTab).toContain('availableTaskParamRefs')
    expect(taskTab).toContain('paramValues')
    expect(allInspectorSource).not.toContain('任务拼接逻辑')
  })

  it('子源信息不在画布顶部重复编辑，定时策略收在节点配置', () => {
    // 定时策略已从采集运行设置中拆出，作为节点级配置保留，避免首节点位置分支影响其他节点。
    expect(nodeInspector).not.toContain('子源信息（各节点共享）')
    expect(canvasHeader).not.toContain('@click="openEdit"')
    expect(canvasHeader).toContain('class="ch-canvas-actions"')
    expect(canvasHeader).toContain('v-if="view === \'flow\'" class="ch-actions"')
    expect(canvasHeader).toContain('v-if="view === \'flow\'" class="ch-canvas-actions"')
    expect(canvasHeader).not.toContain('<Teleport')
    expect(flowBoard).toContain("import FlowXmlDialog from './FlowXmlDialog.vue'")
    expect(flowBoard).toContain('rc-flow-xml')
    expect(sourceBasicForm).not.toContain('定时策略（仅作用于首节点）')
    expect(sourceBasicForm).not.toContain('选用配置 / 定时')
    expect(configTab).toContain('<TaskScheduleSettings')
    expect(collectorSettings).not.toContain('<TaskScheduleSettings')
  })

  it('切换子源保留当前视图，视图按钮等待路由完成后再允许下一次切换', () => {
    expect(flowCanvas).toContain('const view = normalizeSourceView(route.query.view)')
    expect(flowCanvas).toContain("void router.replace({ path: '/canvas', query: { sourceId: target.sourceId, view } })")
    expect(canvasHeader).toContain("void router.replace({ path: '/canvas', query })")
    expect(canvasHeader).not.toContain('switchingView')
  })

  it('画布路由顶栏无动作，保存迁入画布 Header；运行记录使用发起抓取文案', () => {
    expect(appModuleHead).toContain('canvas: [],')
    expect(appModuleHead).not.toContain("canvas: ['保存'")
    expect(canvasHeader).toContain(`@click="ui.fireAction('保存')"`)
    expect(runtimeStore).toContain('发起抓取落表')
    expect(runtimeStore).not.toContain('试跑落表')
  })

  it('任一采集资产二级页都能从顶栏进入新建采集闸门', () => {
    expect(appModuleHead).toContain('function firePageAction(action: string)')
    expect(appModuleHead).toContain("router.push({ path: '/canvas', query: { mode: 'new' } })")
    expect(appModuleHead).toContain('@click="firePageAction(action)"')
  })


  it('采集资产页顶部批量导入/批量操作入口收口，批量导入迁进网站详情子源侧栏（0711 R12）', () => {
    // 顶部动作注册只留「新建采集」
    expect(sourceTab).not.toContain("ui.registerAction('批量导入'")
    expect(sourceTab).not.toContain("ui.registerAction('批量操作'")
    expect(sourceTab).toContain("ui.registerAction('新建采集'")
    expect(sourceTab).not.toContain('<el-dialog v-model="importDlg.visible"')
    expect(sourceTab).not.toContain('importDlg')
    expect(sourceTab).not.toContain('批量导入</button>')

    // 表格勾选后的上下文批量工具条继续保留（发抓取/操作类/监控类/批量删除）
    // P2-2 拆分后批量工具条移到 BatchBar.vue 子组件
    expect(batchBar).toContain('class="ca-batchbar"')
    expect(batchBar).toContain('@click="emit(\'batchSnatch\')"')
    expect(batchBar).toContain('@click="emit(\'batchDelete\')"')

    // 批量导入迁进网站详情子源侧栏，siteId 已定，不再需要目标网站下拉
    expect(siteSourceSwitcher).toContain('siteApi.siteImportSources(props.siteId, importDlg.lines)')
    expect(siteSourceSwitcher).toContain('批量导入')

    // 参数模块迁到规则资产（0721 会议 §六-1，覆盖 0711-B「ParamTab 留在采集资产」的旧口径）：
    // 采集资产不再有 param tab，规则资产新增"参数" tab 承接
    expect(collectAssetsIndex).not.toContain("import ParamTab from './ParamTab.vue'")
    expect(collectAssetsIndex).not.toContain("{ key: 'param', label: '参数列表' }")
    expect(ruleAssetsIndex).toContain("import ParamTab from './ParamTab.vue'")
    expect(ruleAssetsIndex).toContain("{ key: 'param', label: '参数' }")
  })

  it('采集资产页不重复渲染网站工作区页签', () => {
    expect(collectAssetsIndex).not.toContain("import SourceTabsBar from '../FlowCanvas/SourceTabsBar.vue'")
    expect(collectAssetsIndex).not.toContain('<SourceTabsBar')
  })

  it('流程模板列表并入采集资产的二级页签，而不是左侧独立菜单', () => {
    expect(collectAssetsIndex).toContain("{ key: 'template', label: '流程模板列表' }")
    expect(collectAssetsIndex).toContain('FlowTemplate')
    expect(collectAssetsIndex).toContain("const query = tab === 'source' ? {} : { tab }")
  })

  it('空白画布的智能入口推荐并应用流程模板，不再直接生成孤立流程', () => {
    expect(flowBoard).toContain('智能推荐模板')
    expect(flowBoard).toContain('flowTemplateApi.list()')
    expect(flowBoard).toContain('flow.applyTemplate(template)')
    expect(flowBoard).not.toContain('generateWebFlow')
  })

  it('任务参数取值只面向当前节点参数，并支持上下文与出参字段', () => {
    expect(taskTab).toContain('cc.value?.urlParamRefs')
    expect(allInspectorSource).not.toContain('Object.values(flow.configs)')
    expect(taskTab).toContain('请先在当前节点的参数配置中绑定参数。')
    expect(taskTab).toContain('上下文来源')
    expect(taskTab).toContain('出参列')
    expect(taskTab).toContain('addTaskField')
    expect(taskTab).toContain('removeTaskField')
    expect(taskTab).toContain('+ 添加字段')
    expect(taskTab).toContain('hasEffectiveInput')
    expect(taskTab).toContain('effectiveInputTableId')
    expect(taskTab).not.toContain('isFirstDataNode')
  })

  it('流程编辑不消费配置列表，源表单不再提供选用配置', () => {
    expect(nodeInspector).not.toContain('configApi.configPaged')
    expect(sourceBasicForm).not.toContain('选用配置')
    expect(sourceBasicForm).not.toContain('使用已有配置')
  })

  it('子源流程头展示已应用模板，且不展示负责人', () => {
    expect(canvasHeader).toContain('appliedTemplateLabel')
    expect(canvasHeader).toContain('{{ appliedTemplateLabel }} ▾')
    expect(canvasHeader).not.toContain('负责人 ${s.owner}')
  })

  it('规则节点使用独立的编排配置 Tab，节点配置 Tab 不再内嵌规则编排面板（0801 方案）', () => {
    // 0804 S2-2：表/字段绑定 + 保存业务规则搬去表配置 Tab，规则/采集节点共用同一个 TableTab
    expect(tableTab).toContain('RuleTableFieldBinder')
    expect(tableTab).toContain('保存并配置编排')
    expect(ruleOrchestrationTab).toContain('查看业务编排')
    expect(ruleOrchestrationTab).not.toContain('保存业务规则')
    expect(ruleOrchestrationTab).not.toContain('修改表字段')
    expect(ruleTableFieldBinder).toContain('输入表')
    expect(ruleTableFieldBinder).toContain('入参字段')
    expect(ruleTableFieldBinder).toContain('出参字段')
    // 0804 拍板：数据源固定为采集库、规则名称 = 节点名称，两个字段都不再单独渲染，
    // RuleTableFieldBinder/RuleOrchestrationTab 这两处不再混入"引用已有"的 select-existing/onSelectExisting——
    // 0805 恢复了等价能力，但按会议原话"新建是新建、选是选"分开做，挪到了 ConfigTab.vue 的
    // 「选择已有规则」按钮 + SelectExistingRuleDialog.vue（跟这两处彻底不是一回事，断言仍然成立）
    expect(ruleTableFieldBinder).not.toContain('数据源')
    expect(ruleTableFieldBinder).not.toContain('规则名称')
    expect(ruleTableFieldBinder).not.toContain('select-existing')
    expect(ruleOrchestrationTab).not.toContain('onSelectExisting')
    // 「指定用户」不渲染，「表名关键词」并入输入表下拉（会议 11:57/13:50），这两条仍然成立
    expect(allInspectorSource).not.toContain('指定用户')
    expect(allInspectorSource).not.toContain('表名关键词')
    // 规则编排从 ConfigTab 移出（只留一句迁移注释指向新 Tab，不再渲染面板本体）；
    // 任务配置保留独立 Tab（最新拍板调整），ConfigTab 不再内嵌 TaskTab
    expect(configTab).not.toContain('class="ni-section-title">规则编排')
    expect(configTab).not.toContain('<TaskTab')
  })
})
