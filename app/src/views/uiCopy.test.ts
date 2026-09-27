import { describe, expect, it } from 'vitest'
import sourceTab from './CollectAssets/SourceTab.vue?raw'
import batchBar from './CollectAssets/components/BatchBar.vue?raw'
import tableView from './CollectAssets/components/TableView.vue?raw'
import filterToolbar from './CollectAssets/components/FilterToolbar.vue?raw'
import collectAssetsIndex from './CollectAssets/index.vue?raw'
import flowCanvas from './FlowCanvas/index.vue?raw'
import newSiteWizard from './FlowCanvas/create/NewSiteWizard.vue?raw'
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
import editNodeSourceDialog from './FlowCanvas/inspector/EditNodeSourceDialog.vue?raw'
import editSourceDialog from './FlowCanvas/source/EditSourceDialog.vue?raw'
import siteCardGrid from './CollectAssets/SiteCardGrid.vue?raw'
import appModuleHead from '../layouts/AppModuleHead.vue?raw'
import runtimeStore from '../stores/runtime.ts?raw'
import ruleAssetsIndex from './RuleAssets/index.vue?raw'
import entryEditorDrawer from './DataView/EntryEditorDrawer.vue?raw'

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

  // 2026-08-28 订正：原用例断言「面板上不该出现『网页类型』」，是基于 0824-00 §6.2「节点类型替代网页类型」
  // 那个理解写的——**理解错了**。节点类型（= 抓取类型 = configType，实测 90/140/170…）不分列表/详情，
  // 列表/详情这条轴一直在 isMulti 上，那一项就是旧平台的「网页类型」，并没有被删掉。
  // 真正要挡住的是旧的 webKind 那一套（列表页/详情页/附件页 三选一 + 详情类勾选），它才是被节点类型取代的。
  it('节点类型只读、不提供旧 webKind 字段；「网页类型」= isMulti 保留（0824-00 §6.2 订正）', () => {
    expect(configTab).toContain('<label>节点类型</label>')
    // 旧的 webKind 三选一不再出现
    expect(configTab).not.toContain('WEB_KIND_OPTIONS')
    expect(configTab).not.toContain('{ webKind:')
    expect(allInspectorSource).not.toContain('详情类数据')
    expect(allInspectorSource).not.toContain('toggleDetail')
    expect(allInspectorSource).not.toContain(':checked="cc.isDetail"')
    // 「网页类型」= isMulti，仍在节点配置里；被节点类型取代的是旧 webKind 那个独立字段
    expect(configTab).toContain('<label>网页类型</label>')
  })

  it('节点配置 Tab 不展示配置名称（已在上方当前配置条展示）', () => {
    expect(configTab).not.toContain('<label>配置名称</label>')
    expect(configTab).not.toContain('flow.setConfigName(')
    expect(nodeInspector).toContain('当前配置')
    expect(nodeInspector).toContain('cfg.configName')
  })

  it('节点配置 Tab 展示配置 URL（旧平台配置编辑的 URL），不是源 URL', () => {
    expect(configTab).toContain('<label>URL</label>')
    expect(configTab).toContain('flow.setConfigUrl(')
    expect(configTab).toContain('configApi.configDetailRaw')
    expect(configTab).toContain('flow.hydrateConfigUrl(')
    expect(configTab).not.toContain('collectUrlLabel')
    expect(configTab).not.toContain('复制链接（演示）')
    expect(configTab).not.toContain('<label>源 URL</label>')
    // 源 URL 在画布头只读；改源名称/源 URL 走左侧「源详情」
    expect(canvasHeader).toContain('s.url')
    expect(configTab).not.toContain(':show-url')
    expect(editNodeSourceDialog).toContain('编辑节点名称')
    expect(editNodeSourceDialog).not.toContain('<label>源 URL</label>')
  })

  it('非配置字段（节点名称）在采集节点上只读，编辑收进弹窗', () => {
    // 0824-11 §1.2b：一个面板三种归属，底部「保存配置」只管配置那一层。
    // 面板上不摆分组标题也不内嵌保存按钮，改用参数源同款的「只读 + 编辑弹窗」。
    expect(configTab).toContain('EditNodeSourceDialog')
    expect(configTab).toContain('data-testid="edit-node-source"')
    expect(configTab).not.toContain('ni-section-hint')
    expect(configTab).not.toContain("setCC('url'")
    expect(configTab).not.toContain('flow.patchSource({ url:')
  })

  it('弹窗里的 .rc-field 必须重置全局样式', () => {
    // tokens.css 的 .rc-field 是工具栏用的横向 pill（inline-flex + 边框 + 白底 + 34px 定高），
    // 面板/弹窗里直接用会在输入框外面再套一层框。全仓 12 个用到它的组件都要在自己的 style 里重置。
    expect(editNodeSourceDialog).toMatch(/\.rc-field \{[^}]*border: 0/)
    expect(editNodeSourceDialog).toMatch(/\.rc-field \{[^}]*background: transparent/)
  })

  it('节点名称弹窗只改节点名；源 URL 在左侧源详情落库（0824-11 §1.1b）', () => {
    expect(editNodeSourceDialog).toContain('persistNodeName')
    expect(editNodeSourceDialog).not.toContain('待步骤接口接入后落库')
    expect(editNodeSourceDialog).not.toContain('sourceApi.sourceUpdate')
    expect(editNodeSourceDialog).not.toContain('flow.patchSource({ url:')
    expect(editSourceDialog).toContain('sourceApi.sourceUpdate')
    expect(editSourceDialog).toContain('<label>源 URL</label>')
    expect(siteSourceSwitcher).toContain('EditSourceDialog')
    expect(flowCanvas).toContain('autosave.bind')
    expect(flowCanvas).not.toContain('persistFlowSteps')
    expect(flowCanvas).not.toContain('源信息与步骤已保存')
    expect(flowCanvas).not.toContain('待步骤接口接入后落库')
  })

  // 展示叫「网页类型」（沿用新平台原有说法），落库仍是旧 isMulti 三态，一一对应，
  // 对应关系由 canvas/legacyEnums.test.ts 锁死（含旧平台原文逐字校验）。
  it('「网页类型」三态放在节点配置的节点类型下，不进表配置', () => {
    // 旧平台 isMulti 在配置上编辑，步骤表单里没有这一项（旧前端 column.config.js:640）
    expect(configTab).toContain('<label>网页类型</label>')
    expect(configTab).toContain('WEB_TYPE_OPTIONS')
    const nodeType = configTab.indexOf('<label>节点类型</label>')
    const multi = configTab.indexOf('<label>网页类型</label>')
    expect(nodeType).toBeGreaterThan(-1)
    expect(multi).toBeGreaterThan(nodeType)
  })

  it('表编辑弹窗不再提供去重方式入口（0824-00 §6.3：查看/编辑表只操作表资产）', () => {
    expect(tableDialog).not.toContain('table-dedup-mode')
    expect(tableDialog).not.toContain('<label>去重方式</label>')
    // 去重方式仍留在表配置
    expect(tableTab).toContain('去重方式')
  })

  it('定时策略紧挨在运行设置上方（采集节点）', () => {
    const schedule = configTab.lastIndexOf('<summary>定时策略</summary>')
    const runtime = configTab.indexOf('<CollectorSettings')
    expect(schedule).toBeGreaterThan(-1)
    expect(runtime).toBeGreaterThan(schedule)
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
    expect(tableView).toContain('<button class="ca-count-link" type="button" title="查看该网站全部源数据" @click="openSiteData(site)">')
    expect(tableView).toContain('{{ formatDataCount(site) }}')
  })

  // 2026-09-18：点源落**数据视图**（原先是流程视图）——进来先看抓到了什么。
  it('采集资产卡片的源直达数据视图，卡片底部不再提供任务入口', () => {
    expect(siteCardGrid).toContain("query: { ...(s.siteId ? { siteId: s.siteId } : {}), sourceId: s.sourceId, view: 'data' }")
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

  it('数据视图只使用当前源流程，节点图不展示开始/结束', () => {
    expect(resultView).toContain('ProcessNodeRail')
    expect(resultView).toContain('includeTerminals: false')
    expect(resultView).not.toContain('buildSourceSeed')
    expect(resultView).not.toContain('templateLayout')
  })

  it('新建采集分类使用可搜索的目录树', () => {
    expect(newSiteWizard).toContain('CategoryTreePicker')
    expect(newSiteWizard).toContain('<CategoryTreePicker v-model="gateCategory" />')
    expect(newSiteWizard).not.toContain('GATE_CATEGORY_OPTIONS')
    expect(newSiteWizard).not.toContain('<select class="rc-select" v-model="gateSite.category"')
    expect(flowCanvas).not.toContain('GATE_CATEGORY_OPTIONS')
  })

  it('新建采集删除标签字段和源默认设置整块', () => {
    expect(newSiteWizard).not.toContain('gateSourceDefaults')
    expect(newSiteWizard).not.toContain('gateTagsInput')
    expect(flowCanvas).not.toContain('gateSourceDefaults')
    expect(flowCanvas).not.toContain('gateTagsInput')
    expect(flowCanvas).not.toContain('<SourceBasicForm')
    expect(newSiteWizard).not.toContain('<div class="rc-field"><label>标签</label>')
  })

  it('新建采集首个源名称跟随网站名称，手动改过后停止跟随', () => {
    expect(newSiteWizard).toContain('firstSourceNameTouched')
    expect(newSiteWizard).toContain('if (!firstSourceNameTouched.value && gateRows.value[0]) gateRows.value[0].name = name')
    expect(newSiteWizard).toContain('@input="i === 0 && (firstSourceNameTouched = true)"')
    expect(newSiteWizard).toContain('siteApi.siteCreate(siteForCreate, sources)')
    expect(newSiteWizard).not.toContain('WIZARD_STEPS')
    expect(newSiteWizard).not.toContain('创建网站并启用')
  })

  it('节点配置不再展示输入映射和输入参数（0804 拍板：整块删除，非只对采集节点隐藏）', () => {
    expect(configTab).not.toContain('输入映射')
    expect(configTab).not.toContain("onTripleCell('inmap'")
    expect(allInspectorSource).not.toContain('<template v-if="cc">\n          <div class="rc-field"><label>输入参数[多选]</label>')
    expect(allInspectorSource).not.toContain('采集/非采集节点统一显示')
  })

  it('节点配置支持 APP 入口字段；任务参数由当前节点参数配置决定', () => {
    expect(configTab).toContain('APP 包名')
    expect(taskTab).toContain('任务参数取值')
    expect(taskTab).toContain('availableTaskParamRefs')
    expect(taskTab).toContain('paramValues')
    expect(allInspectorSource).not.toContain('任务拼接逻辑')
  })

  it('源信息不在画布顶部重复编辑，定时策略收在节点配置', () => {
    // 定时策略已从采集运行设置中拆出，作为节点级配置保留，避免首节点位置分支影响其他节点。
    expect(nodeInspector).not.toContain('源信息（各节点共享）')
    expect(canvasHeader).not.toContain('@click="openEdit"')
    expect(canvasHeader).not.toContain('同步到源')
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
    expect(configTab).not.toContain('<RuntimePolicySummary')
  })

  it('切换源保留当前视图，视图按钮等待路由完成后再允许下一次切换', () => {
    // 切源仍带着当前视图走（2026-09-09 起多一条例外：从「按条件查源」的命中态点进来时
    // 强制 data 并带上条件，见 onSwitchTarget 里的注释）
    expect(flowCanvas).toContain("view: cond ? 'data' : normalizeSourceView(route.query.view)")
    expect(flowCanvas).toContain('sourceId: target.sourceId,')
    expect(flowCanvas).toContain("void router.replace({")
    expect(canvasHeader).toContain("void router.replace({ path: '/canvas', query })")
    expect(canvasHeader).not.toContain('switchingView')
  })

  it('画布路由顶栏无动作；步骤自动保存，不再放「保存流程」按钮（0828 W9-2/W9-3）', () => {
    expect(appModuleHead).toContain('canvas: [],')
    expect(appModuleHead).not.toContain("canvas: ['保存'")
    expect(canvasHeader).not.toContain(`@click="ui.fireAction('保存')"`)
    expect(canvasHeader).not.toContain('保存流程')
    expect(canvasHeader).toContain('保存中…')
    expect(canvasHeader).toContain('已保存')
    expect(canvasHeader).toContain('保存失败，点击重试')
    expect(runtimeStore).toContain('发起抓取落表')
    expect(runtimeStore).not.toContain('试跑落表')
  })

  it('任一采集资产二级页都能从顶栏进入新建采集闸门', () => {
    expect(appModuleHead).toContain('function firePageAction(action: string)')
    expect(appModuleHead).toContain("router.push({ path: '/canvas', query: { mode: 'new' } })")
    expect(appModuleHead).toContain('@click="firePageAction(action)"')
  })


  it('采集资产页顶部批量导入/批量操作入口收口，批量导入迁进网站详情源侧栏（0711 R12）', () => {
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

    // 批量导入迁进网站详情源侧栏，siteId 已定，不再需要目标网站下拉
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

  it('不再展示流程模板入口，旧链接统一转到流程中心', () => {
    expect(collectAssetsIndex).not.toContain("{ key: 'template', label: '流程模板列表' }")
    expect(collectAssetsIndex).not.toContain("import FlowTemplate from '../FlowTemplate/index.vue'")
    expect(collectAssetsIndex).toContain("router.replace('/flows')")
    expect(ruleAssetsIndex).not.toContain("{ key: 'template', label: '流程模板' }")
    expect(ruleAssetsIndex).not.toContain("import FlowTemplate from '../FlowTemplate/index.vue'")
    expect(ruleAssetsIndex).toContain("router.replace('/flows')")
    // 0917-09：这条跳转加了回程上下文（from/sourceId/siteId/view/fromName），
    // 不再是光秃秃的 push('/flows')——落点仍是流程中心，行为由 CanvasHeader.test.ts 验
    expect(canvasHeader).toContain("void router.push({ path: '/flows', query: flowCenterQuery() })")
  })

  it('空白画布的智能入口推荐并应用可复用流程，不暴露模板概念', () => {
    expect(flowBoard).toContain('智能推荐流程')
    expect(flowBoard).not.toContain('智能推荐模板')
    // 0927：智能推荐的应用候选从「全部流程」收口到流程模板（flowCenterApi.templates）——
    // 全量流程里混着与当前源结构完全不符的流程，推荐出来点应用必失败；templates 是
    // 刻意维护的可复用清单。断言随代码同步，不锁死在旧的 list()。
    expect(flowBoard).toContain('flowCenterApi.templates()')
    expect(flowBoard).toContain('flow.applyTemplate(template)')
    expect(flowBoard).not.toContain('generateWebFlow')
  })

  it('任务参数取值只面向当前节点参数', () => {
    expect(taskTab).toContain('cc.value?.urlParamRefs')
    expect(allInspectorSource).not.toContain('Object.values(flow.configs)')
    expect(taskTab).toContain('请先在当前节点的参数配置中绑定参数。')
    expect(taskTab).toContain('hasEffectiveInput')
    expect(taskTab).toContain('effectiveInputTableId')
    expect(taskTab).not.toContain('isFirstDataNode')
  })

  // 上下文来源 2026-08-28 对齐旧平台（W4-2）：多选下拉取代"每行一个 select + 添加/删除"，
  // 行为细节（候选不过滤 / 文案 / 存 columnName）由 tabs/TaskTab.test.ts 实测锁定，这里只守 UI 形态。
  it('上下文来源是多选下拉，不再有逐行添加/删除', () => {
    expect(taskTab).toContain('data-testid="context-map-select"')
    expect(taskTab).toContain('multiple')
    expect(taskTab).not.toContain('addTaskField')
    expect(taskTab).not.toContain('removeTaskField')
    expect(taskTab).not.toContain('+ 添加字段')
  })

  // 出参列 2026-08-27 搬去参数配置 Tab，任务配置里不该再有它的控件（注释提到不算）
  it('出参列的控件在参数配置 Tab，不在任务配置', () => {
    expect(taskTab).not.toContain('<label>出参列</label>')
    expect(paramsTab).toContain('<label>出参列</label>')
  })

  it('流程编辑不消费配置列表，源表单不再提供选用配置', () => {
    expect(nodeInspector).not.toContain('configApi.configPaged')
    expect(sourceBasicForm).not.toContain('选用配置')
    expect(sourceBasicForm).not.toContain('使用已有配置')
  })

  // 流程切换器从 el-dropdown 按钮改成了可搜索输入框（ch-flow-picker），已应用流程改为
  // 输入框的 placeholder 呈现，原来的 `{{ appliedTemplateLabel }} ▾` 按钮不再存在。
  // 这条锁的是「头上要显示当前已应用的流程」这个意图，不锁具体控件形态。
  it('源流程头展示已应用流程，且不展示负责人', () => {
    expect(canvasHeader).toContain('appliedTemplateLabel')
    expect(canvasHeader).toContain(':placeholder="appliedTemplateLabel"')
    expect(canvasHeader).not.toContain('负责人 ${s.owner}')
  })

  it('规则节点使用独立的编排配置 Tab，节点配置 Tab 不再内嵌规则编排面板（0801 方案）', () => {
    // 0804 S2-2：表/字段绑定搬去表配置 Tab。
    // 2026-09-02：表配置 Tab 的「保存并配置编排」按钮已移除，换数字 ruleId 改在编排配置第一次
    // 生成脚本时自动 orchestrationSaveMeta，表配置只负责绑表/字段。
    expect(tableTab).toContain('RuleTableFieldBinder')
    expect(tableTab).not.toContain('保存并配置编排')
    expect(ruleOrchestrationTab).toContain('设置业务规则')
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

// W3（0828 D13/D14/D15/D17）：两套表编辑界面改法必须一致，别只改一个。
describe('表编辑：导入字段 / 单一加属性 / 无高级 / 列宽末列', () => {
  const drawer = entryEditorDrawer
  const dialog = tableDialog

  it('「批量加」改名「导入字段」，且支持选文件', () => {
    ;[drawer, dialog].forEach((src) => {
      expect(src).toContain('导入字段')
      expect(src).not.toContain('>批量加<')
      expect(src).toContain('data-testid="import-fields-file"')
      expect(src).toContain('accept=".csv,.txt"')
    })
  })

  // 注意断言的是**真实 UI 标记**（>按钮文案<、<label>…</label>），不是源码里任意出现的字符串——
  // 否则注释和 ElMessage 文案也会被算进去。
  it('每个界面只剩一个加字段按钮，文案统一为「新增字段」', () => {
    ;[drawer, dialog].forEach((src) => {
      expect(src.match(/>＋ 新增字段</g)?.length).toBe(1)
      expect(src).not.toContain('新增属性')
      expect(src).not.toContain('>＋ 加属性<')
    })
  })

  // 字段类型照抄旧平台（旧 EntryTypeEdit.vue 的 dataType 下拉只有三项）。
  // 之前画布侧还编了 url/number/date/json，与业务类型/抓取类型是同一类自造枚举问题。
  it('字段类型只有 string / text / longtext', () => {
    expect(dialog).toContain("const FIELD_TYPES = ['string', 'text', 'longtext'] as const")
    ;[drawer, dialog].forEach((src) => {
      expect(src).not.toContain("'json'")
      expect(src).not.toContain('>number<')
    })
  })

  it('两个界面都在编码失焦时补展示名（旧 handleBlurCode）', () => {
    expect(drawer).toContain('@blur="onItemCodeBlur(field)"')
    expect(dialog).toContain('@blur="onCodeBlur(f)"')
  })

  // 0828 D15 原本把「高级」和字段级「校验」整块暂缓，2026-08-28 拍板校验要做，两边一并恢复。
  // 记变化跟校验/校验脚本本来就是旧平台同一行，只放两项反而更难理解，所以整块恢复。
  it('「高级」与字段级「校验」两边都在，且校验候选照抄旧平台', () => {
    ;[drawer, dialog].forEach((src) => {
      expect(src).toContain('ENTRY_CHECK_RULE_PRESETS')
      expect(src).toContain('entryCheckRuleLabel')
      expect(src).toContain('allow-create') // 旧平台可搜索补自定义值的等价实现
      expect(src).toContain('校验(失败进err库)')
      expect(src).toContain('校验脚本')
    })
  })

  // 记变化本期只隐藏控件，**数据仍要原样带回**，否则保存一次就把后端已有值抹掉了。
  it('「记变化」控件隐藏，但 recFlag 仍回填与提交', () => {
    ;[drawer, dialog].forEach((src) => {
      expect(src).not.toContain('记变化(进rec库)')
    })
    expect(drawer).toContain('recFlag:')     // reset 回填
    expect(dialog).toContain('form.recordChange = t.recFlag')
    expect(dialog).toContain('recFlag: form.recordChange || undefined') // 提交带回
  })

  it('已落库字段的删除按钮是禁用态，不是藏起来（否则看不出为什么不能删）', () => {
    expect(dialog).toContain(':disabled="isPersisted(f)"')
    expect(dialog).not.toContain('ted-locked')
    expect(drawer).toContain(':disabled="Number(field.itemId ?? 0) > 0"')
  })

  it('列宽是字段表的最后一列（操作列之前，D17）', () => {
    const drawerHead = drawer.slice(drawer.indexOf('<thead>'), drawer.indexOf('</thead>'))
    expect(drawerHead.indexOf('列宽')).toBeGreaterThan(drawerHead.indexOf('去重'))
    const dialogHead = dialog.slice(dialog.indexOf('<thead>'), dialog.indexOf('</thead>'))
    expect(dialogHead.indexOf('列宽')).toBeGreaterThan(dialogHead.indexOf('去重'))
  })
})

// 字段展示名跟旧平台一一映射，不自造（2026-08-28 拍板）。这里锁住已经踩过/差点踩的几个：
// codeRule 旧平台就叫「结构化配置」，0824-00 §6.3 计划改成「入库配置」的方向是反的，已撤销。
describe('字段展示名与旧平台一致', () => {
  it('codeRule 展示为「结构化配置」，不是「入库配置」', () => {
    expect(tableTab).toContain('<span>结构化配置</span>')
    expect(tableTab).not.toContain('<span>结构化配置（入库配置）</span>')
    expect(tableTab).not.toContain('<label>入库配置</label>')
  })
})

// 「更换网站」弹窗的确认按钮（0828 W5-2）。会上：「那确认移动啥就自己要改一下，觉得很失败」
// → 就叫「确认」。标题「更换网站」+ 正文已经说清在做什么，按钮不必再复述一遍动作。
describe('更换网站弹窗', () => {
  it('确认按钮就叫「确认」，不叫「确认移动」', () => {
    expect(siteSourceSwitcher).toContain("'确认'")
    expect(siteSourceSwitcher).not.toContain('确认移动')
    expect(siteSourceSwitcher).not.toContain('移动中…')
  })
})

/**
 * 全站只许有**一个**复制实现（2026-09-22）。
 *
 * 用户在生产报「源 ID 复制不了」，根因是 SiteSourceSwitcher 自己写了一套
 * `navigator.clipboard.writeText` + catch：部署站是 http、非安全上下文，
 * 浏览器压根不暴露那个 API，于是每次直接落 catch——**根本没尝试复制**。
 * 同样的自造实现当时一共有 4 处（另外三处在 EntryTab 和 RuleOrchestrationTab）。
 *
 * `utils/clipboard.ts` 那条路才是全的：异步 API → execCommand 兜底 →
 * 输入框打开即全选的手动复制弹窗。这条断言守住"以后别再各写一份"。
 */
describe('复制只走 utils/clipboard（2026-09-22）', () => {
  const vueFiles = import.meta.glob('./**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  it('没有任何组件自己调 navigator.clipboard', () => {
    const offenders = Object.entries(vueFiles)
      .filter(([, src]) => /await\s+navigator\.clipboard|navigator\.clipboard\.writeText\(/.test(src))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('扫到的文件数是合理的（glob 没有静默匹配为空）', () => {
    expect(Object.keys(vueFiles).length).toBeGreaterThan(30)
  })
})

