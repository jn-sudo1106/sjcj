<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useRuntimeStore } from '../../stores/runtime'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore, MAX_SOURCE_TABS } from '../../stores/workspace'
import { flowApi, sourceApi, siteApi, type Source } from '../../api'
import CanvasHeader from './CanvasHeader.vue'
import AddNodePopover from './AddNodePopover.vue'
import SiteSourceSwitcher from './SiteSourceSwitcher.vue'
import {
  iconFor,
  isDataNode,
  isDecision,
  isParallel,
  nodeClassFor,
  nodeOutputTable,
  nodeEntryCondition,
  conditionGroupLabel,
  type NodeConfig,
} from './flowModel'

const flow = useFlowStore()
const runtime = useRuntimeStore()
const ui = useUiStore()
const router = useRouter()
const ws = useWorkspaceStore()
const flowEl = ref<HTMLElement | null>(null)
const canvasScrollEl = ref<HTMLElement | null>(null)

// 编排对象切换器（0707 优化·Phase4）：只在当前源/网站归属某网站时出现；网站态用 'site' 作为激活态标识
const switcherSiteId = computed(() => flow.siteCtx?.siteId || flow.sourceCtx?.siteId || '')
const switcherActiveKey = computed(() => (flow.siteCtx ? 'site' : (flow.sourceCtx?.sourceId ?? '')))
async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!flow.dirty) return true
  try {
    await ElMessageBox.confirm('当前画布有未保存的改动，切换将丢弃，是否继续？', '切换编排对象', {
      type: 'warning', confirmButtonText: '切换', cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}
async function onSwitchTarget(target: 'site' | Source) {
  if (!(await confirmDiscardIfDirty())) return
  if (target === 'site') {
    const siteId = switcherSiteId.value
    if (!siteId) return
    const [site, def] = await Promise.all([siteApi.siteDetail(siteId), flowApi.flowLoad(`site:${siteId}`)])
    if (!site) return
    flow.startSiteFlow(site, def)
    ws.open(`site:${siteId}`, site.name)
    router.replace({ path: '/canvas', query: { siteId } })
  } else {
    const [source, steps, persistedDef] = await Promise.all([
      sourceApi.sourceDetail(target.sourceId),
      sourceApi.sourceSteps(target.sourceId),
      flowApi.flowLoad(target.sourceId),
    ])
    if (!source) return
    flow.loadFromSource(source, steps ?? [], persistedDef)
    if (!ws.open(source.sourceId, source.name)) {
      ElMessage.warning(`最多同时打开 ${MAX_SOURCE_TABS} 个源页签，请先关闭部分页签`)
    }
    router.replace({ path: '/canvas', query: { sourceId: source.sourceId } })
  }
}
function onSwitchAdded(s: Source) {
  onSwitchTarget(s)
}

async function generateWebFlow() {
  const source = flow.sourceCfg ? JSON.parse(JSON.stringify(flow.sourceCfg)) : undefined
  try {
    const rec = await flowApi.flowRecommend('', 'web-public')
    flow.load({
      ...rec.flow,
      id: source?.sourceId ?? rec.flow.id,
      name: source?.name ?? rec.flow.name,
      source,
    })
  } catch {
    if (source) flow.startDraftSource(source)
    else flow.newFlow('blank')
  }
}


const menu = reactive<{ show: boolean; x: number; y: number; nodeId: string | null; afterId: string }>({
  show: false, x: 0, y: 0, nodeId: null, afterId: 'start',
})
const addPop = reactive<{ show: boolean; x: number; y: number; afterId: string }>({
  show: false, x: 0, y: 0, afterId: 'start',
})

// 连线表关系标注（Phase 4.2；0701 问题五升级；0707 连线配置撤掉后纯读节点级数据）：
// 输出表 → 输入表（全节点落库 + 输入表自动继承后，链路血缘天然可标注）
function edgeTableTag(fromId: string, toId: string): string {
  const fromCfg = flow.configs[fromId]
  const toCfg = flow.configs[toId]
  const out = fromCfg ? nodeOutputTable(fromCfg) : ''
  const inp = toCfg ? flow.effectiveInputTableFor(toId) : ''
  if (!out && !inp) return ''
  return `${out || '?'} → ${inp || '?'}`
}
// 连线自动挂条件标签（0701 问题十·方案B）：显示下游节点的进入条件——"只满足条件的行才进入下游"
function edgeConditionTag(toId: string): string {
  const toCfg = flow.configs[toId]
  return toCfg ? conditionGroupLabel(nodeEntryCondition(toCfg)) : ''
}
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
// 节点运行状态语义（0703 问题九）：待配置 → 运行 ↔ 停止；"运行"即业务口中"配置完成、点启动进入运行"的状态，
// "停止"即"数据在此节点不处理"——均为纯文案层，disabled 字段名/序列化结构不变。
// 与 runtime.isRunnable 同源判定：数据类节点（采集或非采集）只要输出表位都视为「待配置」。
function footFor(cfg: NodeConfig) {
  const configured = cfg.collectCfg
    ? !!(cfg.collectCfg.url && cfg.collectCfg.outputTable)
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
        ? '待试跑'
        : '待配置'
  return {
    left,
    right,
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
  else if (action === 'copy' && id) flow.duplicate(id)
  else if (action === 'move-up' && id) flow.move(id, -1)
  else if (action === 'move-down' && id) flow.move(id, 1)
  else if (action === 'toggle' && id) flow.toggleDisabled(id)
  else if (action === 'delete' && id) flow.remove(id)
}

// ---- 添加节点浮层（0707 优化·Phase1，参照 Dify：锚定弹层 + 搜索 + 分组，点选即插） ----
function openAddPopover(x: number, y: number, afterId: string) {
  addPop.show = true
  addPop.x = x
  addPop.y = y
  addPop.afterId = afterId
}
function closeAddPopover() {
  addPop.show = false
}
function onPickNode(template: string) {
  flow.insertAfter(addPop.afterId, template)
  closeAddPopover()
}

// 点击画布外任意处关闭右键菜单 / 添加节点浮层
function onWindowClick() {
  if (menu.show) closeMenu()
  if (addPop.show) closeAddPopover()
}
onMounted(() => {
  window.addEventListener('click', onWindowClick)
})
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))

// 展开配置区后画布变窄，固定宽度的 .rc-flow 可能超出可视区域（0703 反馈）：
// 展开宽度维持原样，改为把画布滚动条居中，保证默认就能看到节点，而不是贴左露一半
watch(
  () => ui.inspectorExpanded,
  async (expanded) => {
    if (!expanded) return
    await nextTick()
    const el = canvasScrollEl.value
    if (!el) return
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  },
)
</script>

<template>
  <main class="rc-canvas" @contextmenu="onPaneMenu" @click="closeMenu">
    <CanvasHeader v-if="flow.sourceCtx || flow.siteCtx" />
    <SiteSourceSwitcher
      v-if="switcherSiteId"
      :site-id="switcherSiteId"
      :active-key="switcherActiveKey"
      @pick="onSwitchTarget"
      @added="onSwitchAdded"
    />

    <div ref="canvasScrollEl" class="rc-canvas-scroll" @dragover="onDragOver" @drop="onDrop">
      <div ref="flowEl" class="rc-flow" :style="{ height: flow.layout.totalHeight + 'px' }">
        <svg :width="640" :height="flow.layout.totalHeight" :viewBox="`0 0 640 ${flow.layout.totalHeight}`" aria-hidden="true">
          <path v-for="(e, i) in flow.layout.mainEdges" :key="'m' + i" class="rc-edge" :class="{ rule: e.rule }" :d="e.d" />
          <path v-for="(e, i) in flow.layout.branchEdges" :key="'b' + i" class="rc-edge" :d="e.d" />
        </svg>

        <!-- 空白画布引导卡（无业务节点时） -->
        <div v-if="!flow.layout.nodes.length" class="rc-empty-cta">
          <div class="rc-empty-cta-title">空白编排画布</div>
          <div class="rc-empty-cta-sub">可以用「＋」手工添加步骤，也可以先智能生成网页抓取初始流程，再逐节点调整配置。</div>
          <button class="rc-btn primary" type="button" @click="generateWebFlow">智能生成流程</button>
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

        <!-- 连线血缘标注（0707 撤掉连线独立配置后，连线纯视觉连接，仅保留只读的表/条件标注） -->
        <template v-for="(e, i) in flow.layout.mainEdges" :key="'l' + i">
        <div
          v-if="edgeTableTag(e.fromId, e.toId)"
          class="rc-edge-table-tag"
          :style="{ left: e.lx + 'px', top: e.ly + 'px' }"
        >{{ edgeTableTag(e.fromId, e.toId) }}</div>
        <div
          v-if="edgeConditionTag(e.toId)"
          class="rc-edge-cond-tag"
          :style="{ left: e.lx + 'px', top: (e.ly + 14) + 'px' }"
        >{{ edgeConditionTag(e.toId) }}</div>
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
            <div v-if="nodeOutputTable(n.cfg)" class="rc-node-table" :title="`输出表 ${nodeOutputTable(n.cfg)}`">⊞ {{ nodeOutputTable(n.cfg) }}</div>
            <div class="rc-node-foot">
              <span class="rc-chip" :class="footClass(n.cfg)">{{ footFor(n.cfg).left }}</span>
              <span>{{ footFor(n.cfg).right }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>

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
        <div class="sep" />
        <button class="danger" type="button" @click="menuAction('delete')">删除节点</button>
      </template>
      <template v-else>
        <button type="button" @click="menuAction('insert-node')">添加节点</button>
      </template>
    </div>

    <!-- 添加节点浮层（0707 优化·Phase1，参照 Dify：锚定弹层 + 搜索 + 分组，点选即插，含「逻辑」分组承接决策/分头） -->
    <AddNodePopover v-if="addPop.show" :x="addPop.x" :y="addPop.y" @pick="onPickNode" @close="closeAddPopover" />
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

.rc-flow { position: relative; width: 640px; margin: 28px auto; }
.rc-flow svg { position: absolute; inset: 0; pointer-events: none; }
.rc-edge { fill: none; stroke: #cbd5e1; stroke-width: 1.6; }
.rc-edge.rule { stroke: #60a5fa; stroke-dasharray: 5 4; }

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
