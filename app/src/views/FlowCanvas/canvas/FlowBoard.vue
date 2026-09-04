<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useDuplicateNode } from './useDuplicateNode'
import { useStepWrite } from './useStepWrite'
import { useRuntimeStore } from '@/stores/runtime'
import { useUiStore } from '@/stores/ui'
import { entryApi, flowApi, flowCenterApi, type FlowRecord } from '@/api'
import CanvasHeader from '../shared/CanvasHeader.vue'
import AddNodePopover from './AddNodePopover.vue'
import FlowXmlDialog from './FlowXmlDialog.vue'
import { flowToXml } from '@/utils/flow/flowXml'
import {
  effectiveOutputTable,
  iconFor,
  isDataNode,
  isRuleNode,
  isDecision,
  isParallel,
  nodeClassFor,
  nodeOutputTable,
  collectorCapabilityOf,
  type NodeConfig,
} from './flowModel'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const flow = useFlowStore()
// 复制节点 = 新增一套配置（0828 D02）：副本必须绑一份新配置，不能沿用原 configId
const duplicateNode = useDuplicateNode()
const { deleteCanvasNode } = useStepWrite()
const runtime = useRuntimeStore()
const ui = useUiStore()
const flowEl = ref<HTMLElement | null>(null)
const canvasScrollEl = ref<HTMLElement | null>(null)
let canvasResizeObserver: ResizeObserver | null = null
const xmlOpen = ref(false)
const xml = computed(() => (xmlOpen.value ? flowToXml(flow.serialize()) : ''))
const canExportXml = computed(() => !flow.dirty && flow.validateFlow().length === 0)
const recommending = ref(false)

// 编排对象切换器已升级为页面级源侧栏（0710 会议 B1），组件与接线整体迁至 index.vue

function loadTemplateDefaults(template: FlowRecord) {
  flow.load({
    id: flow.flowId,
    name: flow.flowName,
    version: `template-v${template.version}`,
    main: template.definition.main,
    branches: template.definition.branches,
    configs: template.definition.configs,
    branchGroups: template.definition.branchGroups,
    updatedAt: template.updatedAt,
  })
}

async function recommendTemplateFlow() {
  if (recommending.value) return
  recommending.value = true
  try {
    const prompt = [flow.sourceCtx?.name, flow.sourceCfg?.url, flow.sourceCtx?.url].filter(Boolean).join(' ')
    const [recommendation, templates] = await Promise.all([flowApi.flowRecommend(prompt), flowCenterApi.list()])
    const template = (recommendation.templateId ? templates.find((item) => item.id === recommendation.templateId) : undefined)
      ?? templates.find((item) => item.id === 'preset-web-public')
    if (!template) {
      ElMessage.info('暂未匹配到可复用流程，请用「＋」手工添加节点，或从右上角选择流程。')
      return
    }
    if (flow.sourceCtx || flow.sourceCfg) flow.applyTemplate(template)
    else loadTemplateDefaults(template)
    ElMessage.success(recommendation.templateId
      ? `已推荐并应用「${template.name}」v${template.version}`
      : `未识别具体场景，已应用默认流程「${template.name}」v${template.version}`)
  } catch {
    ElMessage.error('流程推荐异常')
  } finally {
    recommending.value = false
  }
}


const menu = reactive<{ show: boolean; x: number; y: number; nodeId: string | null; afterId: string }>({
  show: false, x: 0, y: 0, nodeId: null, afterId: 'start',
})
// 0707 优化·Phase6·补：addPop 扩展 branch 模式（ownerId/branchId），供 fan-out 分支列「+」复用同一浮层，
// hideLogicGroup 防止分支内嵌套开新的决策/分头（chain 不支持嵌套分支）。
const addPop = reactive<{ show: boolean; x: number; y: number; afterId: string; branch: { ownerId: string; branchId: string } | null }>({
  show: false, x: 0, y: 0, afterId: 'start', branch: null,
})
const nodePalette = reactive({ show: false, x: 0, y: 0 })

// 表 tableId → 可读 label 的缓存（0901）：这条标注之前直接把 tableId 拼进字符串显示
// （比如「6200026 → ?」），用户看不出是哪张表。按 id 查一次 entryDetail 换成业务名
// （没有业务名退物理表名），查询期间先显示 id 兜底，缓存后同一个 id 不重复查。
// 标注本身是画布上的小字浮层，不叠 RuleTableFieldBinder 下拉里"业务名 · 物理表名"那种全称格式。
const edgeTableLabelCache = reactive<Record<string, string>>({})
const edgeTableLabelPending = new Set<string>()
function edgeTableLabel(tableId: string): string {
  if (!edgeTableLabelCache[tableId] && !edgeTableLabelPending.has(tableId)) {
    edgeTableLabelPending.add(tableId)
    entryApi.entryDetail(tableId)
      .then((detail) => { edgeTableLabelCache[tableId] = detail ? (detail.name || detail.tableName) : tableId })
      .catch(() => { edgeTableLabelCache[tableId] = tableId })
  }
  return edgeTableLabelCache[tableId] || tableId
}

// 连线表关系标注（Phase 4.2；0701 问题五升级；0707 连线配置撤掉后纯读节点级数据；0901 加有效输出表兜底）：
// 输出表 → 输入表（全节点落库 + 输入表自动继承后，链路血缘天然可标注）。
// 输出表用 effectiveOutputTable 而非 nodeOutputTable：节点自己没显式落表时，「输出表」编辑框
// 本就承诺「默认 = 输入表」（见 RuleTableFieldBinder.vue），这里要跟那份承诺对上。
function edgeTableTag(fromId: string, toId: string): string {
  const fromCfg = flow.configs[fromId]
  const toCfg = flow.configs[toId]
  const out = fromCfg ? effectiveOutputTable(fromCfg) : ''
  const inp = toCfg ? flow.effectiveInputTableFor(toId) : ''
  if (!out && !inp) return ''
  return `${out ? edgeTableLabel(out) : '?'} → ${inp ? edgeTableLabel(inp) : '?'}`
}
// 0707 优化·Phase6：节点级「进入条件」已退役（统一收进决策节点的 FlowBranchGroup 分支条件）；连线条件标签退役，仅保留表血缘标签。
// 原 edgeConditionTag() 函数删除；分支条件摘要标签将在 6.4 阶段重做为分支连线标签。
function nodeClasses(id: string, cfg: NodeConfig) {
  return [
    nodeClassFor(cfg),
    cfg.disabled ? 'disabled-node' : '',
    flow.selectedId === id ? 'active' : '',
    runtime.nodeStates[id] ? `run-${runtime.nodeStates[id]}` : '',
  ]
}
function runText(id: string) {
  const s = runtime.nodeStates[id]
  return s === 'L' ? '处理中' : s === 'C' ? '完成' : s === 'E' ? '失败' : ''
}
function hasLoginConfig(cfg: NodeConfig): boolean {
  const collect = cfg.collectCfg
  if (!collect || collectorCapabilityOf(cfg)?.kind !== 'login') return true
  const configs = collect.loginConfigs?.length
    ? collect.loginConfigs
    : collect.account || collect.loginUrl
      ? [{
        id: 'legacy-default', loginUrl: collect.loginUrl || collect.url || '', loginName: collect.account || '', loginPwd: '',
        newLoginConfig: '1' as const, authConfig: '', enabled: true,
      }]
      : []
  return configs.some((config) => config.enabled && (config.newLoginConfig === '0' ? config.authConfig.trim() : config.loginUrl.trim() && config.loginName.trim() && config.loginPwd.trim()))
}
// 节点运行状态语义（0703 问题九）：待配置 → 运行 ↔ 停止；"运行"即业务口中"配置完成、点启动进入运行"的状态，
// "停止"即"数据在此节点不处理"——均为纯文案层，disabled 字段名/序列化结构不变。
// 与 runtime.isRunnable 同源判定：登录和规则节点按各自能力判断，不能只看输出表。
/**
 * 节点卡片上的表标签（2026-09-04 修）。
 *
 * 原来无条件用 `effectiveOutputTable`（= 输出表 || 输入表）并把结果标成「输出表 X」。
 * 那条回退只对**非采集节点**成立——它们的输出表编辑框自己写着「默认继承上游节点」。
 * **采集节点的编辑框写的是「请选择输出表」，输出表是必填的**，所以对采集节点做同样的回退
 * 等于拿输入表冒充输出表：卡片显示「⊞ TEST_ADB」，底部却是「待配置」，看上去自相矛盾
 * （用户原话：这里已经配置了，但是画布上的状态还是待配置）。实为配置 1400990 的
 * `outEntry` 是 null、`entryTypeId`=6200026(TEST_ADB)，即只有输入表、没有输出表。
 *
 * 现在采集节点缺输出表时照实说：标成输入表、加 `→ ?`，跟「待配置」对得上。
 */
function tableChip(cfg: NodeConfig): { label: string; title: string; unset: boolean } | null {
  const explicit = nodeOutputTable(cfg)
  if (explicit) return { label: edgeTableLabel(explicit), title: `输出表 ${edgeTableLabel(explicit)}`, unset: false }
  const fallback = effectiveOutputTable(cfg)
  if (!fallback) return null
  const label = edgeTableLabel(fallback)
  // 非采集节点的回退是编辑框承诺过的，照旧当输出表显示
  if (!cfg.collectCfg) return { label, title: `输出表 ${label}（未显式设置，默认继承上游）`, unset: false }
  return { label, title: `输入表 ${label} · 尚未设置输出表`, unset: true }
}

/** 「待配置」到底缺什么——只写状态不写原因，用户没法自查。 */
function missingFor(cfg: NodeConfig): string[] {
  const miss: string[] = []
  const collect = cfg.collectCfg
  if (collect) {
    if (!collectUrlOf(cfg)) miss.push('URL')
    if (!hasLoginConfig(cfg)) miss.push('登录配置')
    if (collectorCapabilityOf(cfg)?.kind !== 'login' && !collect.outputTable) miss.push('输出表')
    return miss
  }
  if (isRuleNode(cfg)) {
    if (!cfg.ruleCfg?.ruleId) miss.push('规则')
    if (!cfg.ruleCfg?.script?.trim()) miss.push('脚本')
    return miss
  }
  if (isDataNode(cfg) && !nodeOutputTable(cfg)) miss.push('输出表')
  return miss
}

/**
 * 采集节点的 URL 统一读取口径（2026-09-04 修）。
 *
 * `collectCfg.url` 是**源 URL**，只有源视图的 `buildSourceSeed` 会填它。
 * 而节点配置 Tab 里用户看到、编辑、保存的那个「URL」是 **`cfg.configUrl`**
 * （旧平台「配置编辑」的 configUrl，见 ConfigTab.vue:440 的注释）——两者本就不是一份。
 *
 * 只认 `collectCfg.url` 的后果：**流程视图里的采集节点永远是「待配置」**，因为那里没有源，
 * 这个字段填不上。用户实例：流程 1400984 的「网页抓取测试01」右侧明明写着
 * 「已有配置 #1400990」、URL = www.baidu.com，卡片却一直是待配置
 * （实测该节点 configUrl='www.baidu.com'、collectCfg.url=''）。
 *
 * 判"配没配"要跟用户看到的那个字段对齐，所以两者取其一即可。
 */
function collectUrlOf(cfg: NodeConfig): string {
  return cfg.collectCfg?.url || cfg.configUrl || ''
}

function footFor(cfg: NodeConfig) {
  const configured = cfg.collectCfg
    ? !!(collectUrlOf(cfg) && hasLoginConfig(cfg) && (collectorCapabilityOf(cfg)?.kind === 'login' || cfg.collectCfg.outputTable))
    : isRuleNode(cfg)
      ? !!(cfg.ruleCfg?.ruleId && cfg.ruleCfg.script?.trim())
    : isDataNode(cfg) && !!nodeOutputTable(cfg)
  const left = cfg.disabled
    ? '已停止'
    : cfg.planned
      ? '规划中'
      : cfg.collect || isDataNode(cfg)
        ? configured
          ? cfg.status || '运行'
          : '待配置'
        : '待配置'
  const right = cfg.disabled
    ? '数据在此节点不处理'
    : cfg.collect
      ? '源配置'
      : isDataNode(cfg)
        ? '待发起抓取'
        : '待配置'
  const missing = left === '待配置' ? missingFor(cfg) : []
  return {
    left,
    right,
    hint: missing.length ? `还缺：${missing.join('、')}` : '',
    warn: cfg.disabled || ((cfg.collect || isDataNode(cfg)) && !configured),
  }
}
function footClass(cfg: NodeConfig) {
  const foot = footFor(cfg)
  return { warn: foot.warn, ok: foot.left === '运行' }
}

// ---- 拖放 ----
function onDragOver(ev: DragEvent) {
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}
function nearestAfterId(clientY: number): string {
  const rect = flowEl.value?.getBoundingClientRect()
  if (!rect) return flow.layout.slots[0]?.afterId ?? 'start'
  const y = clientY - rect.top
  let best = flow.layout.slots[0]
  let bestD = Number.POSITIVE_INFINITY
  flow.layout.slots.forEach((s) => {
    const d = Math.abs(s.top - y)
    if (d < bestD) { bestD = d; best = s }
  })
  return best?.afterId ?? 'start'
}
function onDrop(ev: DragEvent) {
  ev.preventDefault()
  const afterId = nearestAfterId(ev.clientY)
  const nodeId = ev.dataTransfer?.getData('node-id')
  if (nodeId) {
    flow.moveTo(nodeId, afterId)
    return
  }
  const template = ev.dataTransfer?.getData('text/plain')
  if (!template) return
  flow.insertAfter(afterId, template)
}
function onSlotDrop(ev: DragEvent, afterId: string) {
  ev.preventDefault()
  ev.stopPropagation()
  const nodeId = ev.dataTransfer?.getData('node-id')
  if (nodeId) {
    flow.moveTo(nodeId, afterId)
    return
  }
  const template = ev.dataTransfer?.getData('text/plain') || 'web'
  flow.insertAfter(afterId, template)
}
// 拖拽画布节点本身 → 重排
function onNodeDragStart(ev: DragEvent, id: string) {
  if (!ev.dataTransfer) return
  ev.dataTransfer.setData('node-id', id)
  ev.dataTransfer.effectAllowed = 'move'
}

// ---- 选择 / 右键 ----
function onNodeClick(id: string) {
  flow.select(id)
  closeMenu()
}
function onNodeMenu(ev: MouseEvent, id: string) {
  ev.preventDefault()
  ev.stopPropagation()
  flow.select(id)
  openMenu(ev.clientX, ev.clientY, id)
}
function onPaneMenu(ev: MouseEvent) {
  ev.preventDefault()
  openMenu(ev.clientX, ev.clientY, null, nearestAfterId(ev.clientY))
}
function openMenu(x: number, y: number, nodeId: string | null, afterId?: string) {
  menu.show = true
  menu.x = Math.min(x, window.innerWidth - 190)
  menu.y = Math.min(y, window.innerHeight - 320)
  menu.nodeId = nodeId
  menu.afterId = afterId ?? (nodeId ?? 'start')
}
function closeMenu() {
  menu.show = false
}
function menuAction(action: string) {
  const id = menu.nodeId
  const after = id ?? menu.afterId
  const x = menu.x
  const y = menu.y
  closeMenu()
  if (action === 'config' && id) flow.select(id)
  else if (action === 'insert-node') openAddPopover(x, y, after)
  else if (action === 'copy' && id) void duplicateNode(id)
  else if (action === 'move-up' && id) flow.move(id, -1)
  else if (action === 'move-down' && id) flow.move(id, 1)
  else if (action === 'toggle' && id) flow.toggleDisabled(id)
  else if (action === 'run-node' && id) runNode(id)
  else if (action === 'delete' && id) void deleteCanvasNode(id)
}

// 单节点运行（右键菜单入口，S7-1 改判 0806）：与 NodeInspector 头部按钮同一套 runtime.runSingleNode，
// 只是不用先选中/打开节点面板——右键即可发起，跟"上移/下移/运行 停止"这些既有的免选中操作放一起更顺手。
function runNode(id: string) {
  if (flow.dirty) {
    ElMessage.warning('画布有未保存的改动，请稍候自动保存完成后再运行节点')
    return
  }
  const { runId, reason } = runtime.runSingleNode(flow.serialize({ includeLoginPasswords: true }), id)
  if (!runId) {
    ElMessage.warning(reason || '当前节点不可运行')
    return
  }
  ElMessage.success(`已发起「${flow.configs[id]?.title ?? id}」单节点运行 ${runId}`)
}

// ---- 添加节点浮层（0707 优化·Phase1，参照 Dify：锚定弹层 + 搜索 + 分组，点选即插） ----
function openAddPopover(x: number, y: number, afterId: string) {
  addPop.show = true
  addPop.x = x
  addPop.y = y
  addPop.afterId = afterId
  addPop.branch = null
}
// 0707 优化·Phase6·补：fan-out 分支列「+」——挂进分支 chain 末尾，而非主链
function openBranchAddPopover(x: number, y: number, ownerId: string, branchId: string) {
  addPop.show = true
  addPop.x = x
  addPop.y = y
  addPop.branch = { ownerId, branchId }
}
function closeAddPopover() {
  addPop.show = false
}
function onPickNode(template: string) {
  if (addPop.branch) flow.addNodeToBranch(addPop.branch.ownerId, addPop.branch.branchId, template)
  else flow.insertAfter(addPop.afterId, template)
  closeAddPopover()
}

// 画布左侧节点库：沿用新增节点浮层与画布既有拖放契约。
function openNodePalette() {
  const rect = canvasScrollEl.value?.getBoundingClientRect()
  nodePalette.x = rect ? rect.left + 28 : 8
  nodePalette.y = rect ? rect.top + 54 : 20
  nodePalette.show = true
  addPop.show = false
  menu.show = false
}
function pickNodeFromPalette(template: string) {
  flow.insertAfter(flow.selectedId || 'end', template)
}
function onPaletteDragStart(event: DragEvent, template: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', template)
  event.dataTransfer.effectAllowed = 'copy'
}
function closeNodePalette() {
  nodePalette.show = false
}

// 点击画布外任意处关闭右键菜单 / 添加节点浮层
function onWindowClick() {
  if (menu.show) closeMenu()
  if (addPop.show) closeAddPopover()
  if (nodePalette.show) closeNodePalette()
}
async function centerCanvas() {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const el = canvasScrollEl.value
  if (!el) return
  el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
}
onMounted(() => {
  window.addEventListener('click', onWindowClick)
  void centerCanvas()
  canvasResizeObserver = new ResizeObserver(() => void centerCanvas())
  if (canvasScrollEl.value) canvasResizeObserver.observe(canvasScrollEl.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
  canvasResizeObserver?.disconnect()
})

// 展开配置区后画布变窄，固定宽度的 .rc-flow 可能超出可视区域（0703 反馈）：
// 展开宽度维持原样，改为把画布滚动条居中，保证默认就能看到节点，而不是贴左露一半
watch(
  () => ui.inspectorExpanded,
  () => void centerCanvas(),
)
</script>

<template>
  <main class="rc-canvas" :class="{ 'is-embedded': props.embedded }" @contextmenu="onPaneMenu" @click="closeMenu">
    <CanvasHeader v-if="!props.embedded" />

    <button
      class="rc-node-library-toggle"
      type="button"
      :title="nodePalette.show ? '收起节点库' : '打开节点库'"
      :aria-label="nodePalette.show ? '收起节点库' : '打开节点库'"
      data-testid="node-library-toggle"
      :class="{ active: nodePalette.show }"
      @click.stop="nodePalette.show ? closeNodePalette() : openNodePalette()"
    >＋</button>

    <div ref="canvasScrollEl" class="rc-canvas-scroll" @dragover="onDragOver" @drop="onDrop">
      <div ref="flowEl" class="rc-flow" :style="{ height: flow.layout.totalHeight + 'px' }">
        <svg :width="640" :height="flow.layout.totalHeight" :viewBox="`0 0 640 ${flow.layout.totalHeight}`" aria-hidden="true">
          <path v-for="(e, i) in flow.layout.mainEdges" :key="'m' + i" class="rc-edge" :class="{ rule: e.rule }" :d="e.d" />
          <path v-for="(e, i) in flow.layout.branchEdges" :key="'b' + i" class="rc-edge" :d="e.d" />
          <!-- 0707 优化·Phase6：决策/分头节点的 fan-out 分支连线 -->
          <path v-for="(e, i) in flow.layout.fanOutEdges" :key="'f' + i" class="rc-edge fan-out" :d="e.d" />
        </svg>

        <!-- 空白源画布引导卡 -->
        <div v-if="!flow.layout.nodes.length" class="rc-empty-cta">
          <div class="rc-empty-cta-title">空白编排画布</div>
          <div class="rc-empty-cta-sub">可以用「＋」手工添加步骤，也可以按当前对象推荐可复用流程，应用后再逐节点调整。</div>
          <button class="rc-btn primary" type="button" :disabled="recommending" @click="recommendTemplateFlow">{{ recommending ? '推荐中…' : '智能推荐流程' }}</button>
        </div>

        <!-- 终端 -->
        <div
          v-for="t in flow.layout.terminals"
          :key="t.id"
          class="rc-term"
          :style="{ left: t.pos.left + 'px', top: t.pos.top + 'px' }"
        >{{ t.label }}</div>

        <!-- 插入点 -->
        <button
          v-for="(s, i) in flow.layout.slots"
          :key="'s' + i"
          class="rc-drop-slot"
          type="button"
          :style="{ top: s.top + 'px' }"
          aria-label="插入节点"
          @click.stop="openAddPopover($event.clientX, $event.clientY, s.afterId)"
          @dragover="onDragOver"
          @drop="onSlotDrop($event, s.afterId)"
        >＋</button>

        <!-- 连线血缘标注（0707 撤掉连线独立配置后，连线纯视觉连接，仅保留只读的表血缘标注；条件标签退役，见上方注释） -->
        <template v-for="(e, i) in flow.layout.mainEdges" :key="'l' + i">
        <div
          v-if="edgeTableTag(e.fromId, e.toId)"
          class="rc-edge-table-tag"
          :style="{ left: e.lx + 'px', top: e.ly + 'px' }"
        >{{ edgeTableTag(e.fromId, e.toId) }}</div>
        </template>

        <!-- 0707 优化·Phase6：决策/分头节点的 fan-out 分支列标签（分支名 + 条件摘要） -->
        <template v-for="(col, ownerId) in flow.layout.fanOutColMeta" :key="'col-' + ownerId">
          <template v-for="br in col.branches" :key="'coltag-' + br.id">
            <div
              class="rc-fanout-col-tag"
              :style="{ left: (br.colX - 60) + 'px', top: (br.top - 16) + 'px' }"
            >
              <b>{{ br.label }}</b>
              <span v-if="br.condLabel" class="rc-fanout-col-cond">{{ br.condLabel }}</span>
            </div>
            <!-- 0707 优化·Phase6·补：分支内添加节点入口——挂到 chain 末尾（不支持中间插入，与 moveInBranch 按钮化范围一致） -->
            <button
              class="rc-branch-add-slot"
              type="button"
              :style="{ left: (br.colX - 12) + 'px', top: (br.top + br.height + 6) + 'px' }"
              :title="`在「${br.label}」分支内添加节点`"
              @click.stop="openBranchAddPopover($event.clientX, $event.clientY, String(ownerId), br.id)"
            >＋</button>
          </template>
        </template>

        <!-- 节点 -->
        <div
          v-for="n in flow.layout.nodes"
          :key="n.id"
          class="rc-flow-node"
          :class="nodeClasses(n.id, n.cfg)"
          :style="{ left: n.pos.left + 'px', top: n.pos.top + 'px' }"
          draggable="true"
          @dragstart.stop="onNodeDragStart($event, n.id)"
          @click.stop="onNodeClick(n.id)"
          @contextmenu="onNodeMenu($event, n.id)"
        >
          <!-- 删除按钮（0828 D05）：会上明确「那个节点上面要搞个叉」——删节点不该非得回右侧面板或右键菜单。
               hover 才显形，避免每个节点常驻一个叉；右键菜单里的「删除节点」保留，同一个 store 动作。 -->
          <button
            class="rc-node-del"
            type="button"
            title="删除节点"
            data-testid="node-delete"
            @click.stop="void deleteCanvasNode(n.id)"
          >✕</button>
          <span v-if="runtime.nodeStates[n.id]" class="rc-run-badge" :class="runtime.nodeStates[n.id]">{{ runText(n.id) }}</span>
          <span v-else-if="n.cfg.disabled" class="rc-node-plan">已停止</span>
          <span v-else-if="n.cfg.planned" class="rc-node-plan">规划中</span>

          <div class="rc-node-top">
            <div class="rc-node-icon">{{ iconFor(n.cfg) }}</div>
            <div>
              <div class="rc-node-title">{{ n.cfg.title }}</div>
            </div>
          </div>

          <template v-if="isDecision(n.cfg)">
            <div class="rc-node-brief">条件：<b>{{ n.cfg.base[1]?.[1] || '抓取成功且字段完整' }}</b></div>
            <div class="rc-node-paths"><span class="rc-node-path">通过路径</span><span class="rc-node-path">失败/复核路径</span></div>
            <div class="rc-node-foot"><span class="rc-chip warn">静态保留</span><span>待执行器</span></div>
          </template>
          <template v-else-if="isParallel(n.cfg)">
            <div class="rc-node-brief"><b>{{ n.cfg.base[1]?.[1] || '路径 A' }}</b> / <b>{{ n.cfg.base[2]?.[1] || '路径 B' }}</b></div>
            <div class="rc-node-paths"><span class="rc-node-path">路径 A</span><span class="rc-node-path">路径 B</span><span class="rc-node-path">汇合</span></div>
            <div class="rc-node-foot"><span class="rc-chip">静态保留</span><span>{{ n.cfg.base[3]?.[1] || '待编排' }}</span></div>
          </template>
          <template v-else>
            <div v-if="tableChip(n.cfg)" class="rc-node-table" :class="{ unset: tableChip(n.cfg)!.unset }" :title="tableChip(n.cfg)!.title">⊞ {{ tableChip(n.cfg)!.label }}{{ tableChip(n.cfg)!.unset ? ' → ?' : '' }}</div>
            <div class="rc-node-foot">
              <span class="rc-chip" :class="footClass(n.cfg)" :title="footFor(n.cfg).hint">{{ footFor(n.cfg).left }}</span>
              <span>{{ footFor(n.cfg).right }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <button class="rc-btn rc-flow-xml" type="button" @click.stop="xmlOpen = true">XML</button>
    <FlowXmlDialog v-model:open="xmlOpen" :xml="xml" :flow-id="flow.flowId" :can-export="canExportXml" />

    <!-- 右键菜单 -->
    <div v-if="menu.show" class="rc-node-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <template v-if="menu.nodeId">
        <button type="button" @click="menuAction('config')">配置节点</button>
        <button type="button" @click="menuAction('insert-node')">添加节点</button>
        <div class="sep" />
        <button type="button" @click="menuAction('copy')">复制节点</button>
        <button type="button" @click="menuAction('move-up')">上移</button>
        <button type="button" @click="menuAction('move-down')">下移</button>
        <button type="button" @click="menuAction('toggle')">运行 / 停止</button>
        <button type="button" :disabled="runtime.running" @click="menuAction('run-node')">运行此节点</button>
        <div class="sep" />
        <button class="danger" type="button" @click="menuAction('delete')">删除节点</button>
      </template>
      <template v-else>
        <button type="button" @click="menuAction('insert-node')">添加节点</button>
      </template>
    </div>

    <!-- 添加节点浮层（0707 优化·Phase1，参照 Dify：锚定弹层 + 搜索 + 分组，点选即插，含「逻辑」分组承接决策/分头） -->
    <AddNodePopover
      v-if="addPop.show"
      :x="addPop.x"
      :y="addPop.y"
      :hide-logic-group="!!addPop.branch"
      @pick="onPickNode"
      @close="closeAddPopover"
    />
    <AddNodePopover
      v-if="nodePalette.show"
      :x="nodePalette.x"
      :y="nodePalette.y"
      compact
      @pick="pickNodeFromPalette"
      @dragstart="onPaletteDragStart"
      @close="closeNodePalette"
    />
  </main>
</template>

<style scoped>
.rc-canvas { position: relative; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.rc-canvas-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.rc-canvas-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-canvas-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.rc-canvas-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.rc-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }

.rc-canvas-scroll { flex: 1; overflow: auto; background-color: #f7f9fc; background-image: radial-gradient(#dfe7f2 0.8px, transparent 0.8px); background-size: 22px 22px; }
.rc-flow-xml { position: absolute; z-index: 30; right: 32px; bottom: 32px; height: 28px; padding: 0 10px; border-color: var(--rc-border); background: rgba(255, 255, 255, .9); color: var(--rc-text-2); font-size: 11px; }
.rc-flow-xml:hover { border-color: #bfdbfe; background: #fff; color: var(--rc-primary-ink); }
.rc-node-library-toggle { position: absolute; z-index: 31; top: 108px; left: 12px; width: 30px; height: 30px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; color: var(--rc-primary); font-size: 21px; font-weight: 400; line-height: 1; cursor: pointer; transition: border-color .12s, background .12s, color .12s; }
.rc-canvas.is-embedded .rc-node-library-toggle { top: 12px; }
.rc-node-library-toggle:hover, .rc-node-library-toggle.active { border-color: #93c5fd; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.rc-flow { position: relative; width: 640px; margin: 56px auto 28px; }
.rc-flow svg { position: absolute; inset: 0; pointer-events: none; }
.rc-edge { fill: none; stroke: #cbd5e1; stroke-width: 1.6; }
.rc-edge.rule { stroke: #60a5fa; stroke-dasharray: 5 4; }
.rc-edge.fan-out { stroke: #f59e0b; stroke-width: 1.6; stroke-dasharray: 4 3; }
.rc-fanout-col-tag { position: absolute; width: 120px; text-align: center; font-size: 10px; color: var(--rc-text-2); background: #fff7ed; border: 1px solid #fde68a; border-radius: 5px; padding: 2px 6px; pointer-events: none; z-index: 22; line-height: 1.3; }
.rc-fanout-col-cond { display: block; font-size: 9px; color: #92400e; font-weight: 400; margin-top: 2px; }
.rc-branch-add-slot { position: absolute; z-index: 20; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 1px dashed #fbbf24; background: #fffbeb; color: #b45309; border-radius: 999px; font-size: 15px; line-height: 1; opacity: 0.75; cursor: pointer; transition: opacity 0.12s, transform 0.12s; }
.rc-branch-add-slot:hover { opacity: 1; transform: scale(1.08); background: #fef3c7; }

.rc-term { position: absolute; width: 150px; height: 34px; border: 1px solid var(--rc-border); border-radius: 18px; background: #fff; color: var(--rc-text-2); display: flex; align-items: center; justify-content: center; font-weight: 600; box-shadow: 0 2px 8px -5px rgba(15, 23, 42, 0.2); }

.rc-empty-cta { position: absolute; left: 50%; top: 168px; transform: translateX(-50%); width: 340px; padding: 20px; text-align: center; border: 1px dashed #bfdbfe; border-radius: 12px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 30px -18px rgba(37, 99, 235, 0.5); }
.rc-empty-cta-title { font-size: 14px; font-weight: 800; color: var(--rc-text); }
.rc-empty-cta-sub { margin: 7px 0 14px; font-size: 11px; line-height: 1.6; color: var(--rc-muted); }
.rc-empty-cta .rc-btn { height: 34px; padding: 0 14px; font-size: 13px; }

.rc-drop-slot { position: absolute; left: 300px; z-index: 20; width: 40px; height: 22px; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary); border-radius: 999px; font-size: 17px; line-height: 1; opacity: 0.62; cursor: pointer; box-shadow: 0 4px 12px -9px rgba(37, 99, 235, 0.8); transition: opacity 0.12s, transform 0.12s, border-color 0.12s, background 0.12s; }
.rc-drop-slot::before, .rc-drop-slot::after { content: ''; position: absolute; top: 50%; width: 86px; height: 1px; background: #bfdbfe; pointer-events: none; }
.rc-drop-slot::before { right: 42px; }
.rc-drop-slot::after { left: 42px; }
.rc-drop-slot:hover { opacity: 1; border-color: var(--rc-primary); background: var(--rc-primary-bg); transform: translateY(-50%) scale(1.08); }

.rc-edge-table-tag { position: absolute; transform: translate(-50%, 0); font-size: 9px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; pointer-events: none; z-index: 21; }
.rc-edge-cond-tag { position: absolute; transform: translate(-50%, 0); font-size: 9px; color: #b45309; white-space: nowrap; pointer-events: none; z-index: 21; }

.rc-flow-node { position: absolute; width: 210px; min-height: 74px; padding: 10px 12px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; box-shadow: 0 3px 12px -8px rgba(15, 23, 42, 0.28); cursor: pointer; transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s; }
.rc-node-del { position: absolute; top: 4px; right: 4px; z-index: 3; width: 18px; height: 18px; line-height: 1; border: 0; border-radius: 4px; background: transparent; color: var(--rc-faint); font-size: 11px; cursor: pointer; opacity: 0; transition: opacity .12s; }
.rc-flow-node:hover .rc-node-del { opacity: 1; }
.rc-node-del:hover { background: var(--rc-error-bg, #fef2f2); color: #b91c1c; }
.rc-flow-node:hover { transform: translateY(-1px); border-color: #bfdbfe; }
.rc-flow-node.active { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe, 0 10px 22px -12px rgba(37, 99, 235, 0.5); }
.rc-flow-node.rule-node { border-color: #bfdbfe; background: #fbfdff; }
.rc-flow-node.check-node { border-color: #fed7aa; background: #fffaf0; }
.rc-flow-node.mail-node { border-color: #d9f99d; background: #fcfff7; }
.rc-flow-node.logic-node { border-color: #fde68a; background: #fffbeb; }
.rc-flow-node.parallel-node { border-color: #cbd5e1; background: #f8fafc; }
.rc-flow-node.planned { border-style: dashed; opacity: 0.72; }
.rc-flow-node.disabled-node { opacity: 0.48; filter: saturate(0.72); }

.rc-node-top { display: flex; align-items: center; gap: 8px; }
.rc-node-icon { width: 30px; height: 30px; border-radius: 7px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; flex: none; }
.rc-node-title { font-size: 13px; font-weight: 700; color: var(--rc-text); }
.rc-node-plan { position: absolute; top: 8px; right: 8px; font-size: 9px; color: var(--rc-faint); border: 1px solid var(--rc-border); background: #f8fafc; border-radius: 5px; padding: 1px 5px; }
.rc-run-badge { position: absolute; top: 8px; right: 8px; font-size: 9px; font-weight: 700; border-radius: 5px; padding: 1px 6px; }
.rc-run-badge.L { background: var(--rc-primary-bg); color: var(--rc-primary); }
.rc-run-badge.C { background: var(--rc-ok-bg); color: var(--rc-ok); }
.rc-run-badge.E { background: var(--rc-error-bg); color: var(--rc-error); }
.rc-flow-node.run-L { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe; }
.rc-flow-node.run-C { border-color: #86efac; }
.rc-flow-node.run-E { border-color: #fca5a5; }
.rc-node-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; color: var(--rc-muted); font-size: 10px; }
.rc-node-table.unset { color: var(--rc-warn, #d98b25); }
.rc-node-table { margin-top: 6px; font-size: 10px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-node-brief { margin-top: 8px; color: var(--rc-muted); font-size: 10px; line-height: 1.45; }
.rc-node-brief b { color: #334155; font-weight: 700; }
.rc-node-paths { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.rc-node-path { flex: 1; min-width: 74px; padding: 3px 5px; border-radius: 5px; border: 1px solid var(--rc-border); background: #fff; color: var(--rc-muted); font-size: 9px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.logic-node .rc-node-icon { background: #fef3c7; color: #b45309; }
.logic-node .rc-node-path { border-color: #fde68a; background: #fff7ed; color: #92400e; }
.parallel-node .rc-node-icon { background: #e2e8f0; color: #334155; }
.parallel-node .rc-node-path { border-color: #cbd5e1; background: #fff; color: var(--rc-text-2); }
.rc-chip { padding: 1px 6px; border-radius: 5px; background: #f1f5f9; color: var(--rc-muted); }
.rc-chip.ok { background: var(--rc-ok-bg); color: var(--rc-ok); }
.rc-chip.warn { background: var(--rc-warn-bg); color: var(--rc-warn); }

.rc-node-menu { position: fixed; z-index: 80; min-width: 174px; background: #fff; border: 1px solid var(--rc-border); border-radius: 8px; box-shadow: 0 16px 34px -16px rgba(15, 23, 42, 0.36); padding: 4px; }
.rc-node-menu button { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent; color: #334155; padding: 7px 10px; border-radius: 5px; font-size: 12px; cursor: pointer; text-align: left; }
.rc-node-menu button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-node-menu button.danger:hover { background: var(--rc-error-bg); color: #b91c1c; }
.rc-node-menu .sep { height: 1px; background: var(--rc-border-soft); margin: 4px 0; }
</style>
