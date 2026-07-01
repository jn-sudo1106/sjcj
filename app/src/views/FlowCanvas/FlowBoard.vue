<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useRuntimeStore } from '../../stores/runtime'
import { flowApi } from '../../api'
import CanvasHeader from './CanvasHeader.vue'
import {
  MODAL_TEMPLATES,
  iconFor,
  isDecision,
  isParallel,
  nodeClassFor,
  type NodeConfig,
} from './flowModel'
import NewFlowDialog from './NewFlowDialog.vue'

const flow = useFlowStore()
const runtime = useRuntimeStore()
const router = useRouter()
const flowEl = ref<HTMLElement | null>(null)
const showNewFlow = ref(false)
const flows = ref<{ id: string; name: string; updatedAt: string }[]>([])
async function loadFlows() {
  flows.value = await flowApi.flowList()
}
// 切换 / 新建流程前若当前画布有未保存改动，二次确认，避免静默覆盖
async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!flow.dirty) return true
  try {
    await ElMessageBox.confirm('当前流程有未保存的改动，切换后将丢失，是否继续？', '未保存改动', {
      type: 'warning',
      confirmButtonText: '放弃改动并继续',
      cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}
async function onFlowMenu(cmd: string) {
  if (cmd === '__new__') {
    // 只是打开对话框，尚未覆盖画布，真正的覆盖发生在对话框内「应用到画布 / 从空白开始」，那里再确认
    showNewFlow.value = true
    return
  }
  if (!(await confirmDiscardIfDirty())) return
  const def = await flowApi.flowLoad(cmd)
  if (def) flow.load(def)
}
async function generateWebFlow() {
  try {
    const rec = await flowApi.flowRecommend('', 'web-public')
    flow.load(rec.flow)
  } catch {
    flow.newFlow('blank')
  }
}


const menu = reactive<{ show: boolean; x: number; y: number; nodeId: string | null; afterId: string }>({
  show: false, x: 0, y: 0, nodeId: null, afterId: 'start',
})
const modal = reactive<{ show: boolean; afterId: string; kind: 'node' | 'decision' | 'parallel'; template: string }>({
  show: false, afterId: 'start', kind: 'node', template: 'web',
})

// 连线表关系标注（Phase 4.2）：有输入/输出表绑定时在步骤标签下方显示 tableId 关系
function edgeTableTag(fromId: string): string {
  const e = flow.edges[fromId]
  if (!e) return ''
  const { inputTableId: inp, outputTableId: out } = e
  if (!inp && !out) return ''
  return `${inp || '?'} → ${out || '?'}`
}
function nodeClasses(id: string, cfg: NodeConfig) {
  return [
    nodeClassFor(cfg),
    cfg.disabled ? 'disabled-node' : '',
    flow.activeKind === 'node' && flow.selectedId === id ? 'active' : '',
    runtime.nodeStates[id] ? `run-${runtime.nodeStates[id]}` : '',
  ]
}
function runText(id: string) {
  const s = runtime.nodeStates[id]
  return s === 'L' ? '处理中' : s === 'C' ? '完成' : s === 'E' ? '失败' : ''
}
function footFor(cfg: NodeConfig) {
  // 采集节点是否已配置：URL + 输出表 都填了就视为已配置
  const configured = !!(cfg.collectCfg?.url && cfg.collectCfg?.outputTable)
  const left = cfg.disabled
    ? '已停用'
    : cfg.collect
      ? configured
        ? cfg.status || '可试跑'
        : '待配置'
      : cfg.planned
        ? '规划中'
        : '草稿'
  const right = cfg.disabled ? '不参与运行' : cfg.collect ? '源配置' : '待试跑'
  return { left, right, warn: cfg.disabled || (cfg.collect && !configured) }
}
function footClass(cfg: NodeConfig) {
  const foot = footFor(cfg)
  return { warn: foot.warn, ok: foot.left === '可试跑' }
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
  closeMenu()
  if (action === 'config' && id) flow.select(id)
  else if (action === 'insert-node') openModal(after, 'node')
  else if (action === 'insert-decision') openModal(after, 'decision')
  else if (action === 'insert-parallel') openModal(after, 'parallel')
  else if (action === 'copy' && id) flow.duplicate(id)
  else if (action === 'move-up' && id) flow.move(id, -1)
  else if (action === 'move-down' && id) flow.move(id, 1)
  else if (action === 'toggle' && id) flow.toggleDisabled(id)
  else if (action === 'delete' && id) flow.remove(id)
}

// ---- 新建节点弹窗 ----
function openModal(afterId: string, kind: 'node' | 'decision' | 'parallel') {
  modal.show = true
  modal.afterId = afterId
  modal.kind = kind
  if (kind === 'node') modal.template = modal.template || 'web'
}
function pickTemplate(t: string) {
  modal.kind = 'node'
  modal.template = t
}
function confirmModal() {
  const template = modal.kind === 'decision' ? 'decision' : modal.kind === 'parallel' ? 'parallel' : modal.template
  flow.insertAfter(modal.afterId, template)
  modal.show = false
}

// 点击画布外任意处关闭右键菜单
function onWindowClick() {
  if (menu.show) closeMenu()
}
onMounted(() => {
  window.addEventListener('click', onWindowClick)
  loadFlows()
})
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))
</script>

<template>
  <main class="rc-canvas" @contextmenu="onPaneMenu" @click="closeMenu">
    <CanvasHeader v-if="flow.sourceCtx" />
    <div v-else class="rc-canvas-head">
      <div>
        <div class="rc-canvas-title">{{ flow.flowName }} · draft-0.3</div>
        <div class="rc-canvas-sub">网页抓取（数据中心四步）→ 文件解析/清洗 → 规则处理 → 落表 → 指标引用</div>
      </div>
      <span class="rc-status warn">落表由数据中心完成</span>
      <div class="rc-canvas-actions">
        <el-dropdown trigger="click" @command="onFlowMenu" @visible-change="(v: boolean) => v && loadFlows()">
          <button class="rc-btn primary" type="button">切换 / 新建 ▾</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="__new__">＋ 智能生成新流程</el-dropdown-item>
              <el-dropdown-item v-for="(f, i) in flows" :key="f.id" :command="f.id" :divided="i === 0">{{ f.name }} · {{ f.updatedAt }}</el-dropdown-item>
              <el-dropdown-item v-if="!flows.length" disabled divided>暂无已保存流程</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="rc-btn" type="button" @click="router.push('/runs')">运行记录</button>
      </div>
    </div>

    <div class="rc-canvas-scroll" @dragover="onDragOver" @drop="onDrop">
      <div ref="flowEl" class="rc-flow" :style="{ height: flow.layout.totalHeight + 'px' }">
        <svg :width="640" :height="flow.layout.totalHeight" :viewBox="`0 0 640 ${flow.layout.totalHeight}`" aria-hidden="true">
          <path v-for="(e, i) in flow.layout.mainEdges" :key="'m' + i" class="rc-edge" :class="{ rule: e.rule }" :d="e.d" />
          <path v-for="(e, i) in flow.layout.branchEdges" :key="'b' + i" class="rc-edge" :d="e.d" />
        </svg>

        <!-- 空白画布引导卡（无业务节点时） -->
        <div v-if="!flow.layout.nodes.length" class="rc-empty-cta">
          <div class="rc-empty-cta-title">空白流程画布</div>
          <div class="rc-empty-cta-sub">一键生成网页抓取初始流程：列表抓取 → 详情抓取 → 清洗落表，进入后逐节点完善配置。</div>
          <button class="rc-btn primary" type="button" @click="generateWebFlow">生成网页抓取流程</button>
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
          @click.stop="openModal(s.afterId, 'node')"
          @dragover="onDragOver"
          @drop="onSlotDrop($event, s.afterId)"
        >＋</button>

        <!-- 连线步骤标签 -->
        <template v-for="(e, i) in flow.layout.mainEdges" :key="'l' + i">
        <button
          v-if="e.hasStep"
          class="rc-edge-label"
          :class="{ active: flow.activeKind === 'edge' && flow.selectedEdgeFrom === e.fromId }"
          :style="{ left: e.lx + 'px', top: e.ly + 'px' }"
          type="button"
          @click.stop="flow.selectEdge(e.fromId)"
        >{{ e.label }}</button>
        <div
          v-if="edgeTableTag(e.fromId)"
          class="rc-edge-table-tag"
          :style="{ left: e.lx + 'px', top: (e.ly + 15) + 'px' }"
        >{{ edgeTableTag(e.fromId) }}</div>
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
          <span v-else-if="n.cfg.disabled" class="rc-node-plan">已停用</span>
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
        <button type="button" @click="menuAction('insert-node')">加入节点</button>
        <button type="button" @click="menuAction('insert-decision')">加入决策</button>
        <button type="button" @click="menuAction('insert-parallel')">分头处理</button>
        <div class="sep" />
        <button type="button" @click="menuAction('copy')">复制节点</button>
        <button type="button" @click="menuAction('move-up')">上移</button>
        <button type="button" @click="menuAction('move-down')">下移</button>
        <button type="button" @click="menuAction('toggle')">启用 / 停用</button>
        <div class="sep" />
        <button class="danger" type="button" @click="menuAction('delete')">删除节点</button>
      </template>
      <template v-else>
        <button type="button" @click="menuAction('insert-node')">加入节点</button>
        <button type="button" @click="menuAction('insert-decision')">加入决策</button>
        <button type="button" @click="menuAction('insert-parallel')">分头处理</button>
      </template>
    </div>

    <!-- 新建节点弹窗 -->
    <div v-if="modal.show" class="rc-node-modal-backdrop show" @click.self="modal.show = false">
      <div class="rc-node-modal" role="dialog" aria-modal="true">
        <div class="rc-node-modal-head">
          <div class="rc-node-modal-title">新建节点</div>
          <button class="rc-node-modal-close" type="button" aria-label="关闭" @click="modal.show = false">×</button>
        </div>
        <div class="rc-node-modal-body">
          <div class="rc-node-modal-label">选择节点类型</div>
          <div class="rc-node-kind-grid">
            <button class="rc-node-kind" :class="{ active: modal.kind === 'node' }" type="button" @click="modal.kind = 'node'">
              <span class="ico">N</span><b>加入节点</b><span>一个需要执行或配置的采集节点</span>
            </button>
            <button class="rc-node-kind" :class="{ active: modal.kind === 'decision' }" type="button" @click="modal.kind = 'decision'">
              <span class="ico">IF</span><b>加入决策</b><span>按条件选择其中一条路径</span>
            </button>
            <button class="rc-node-kind" :class="{ active: modal.kind === 'parallel' }" type="button" @click="modal.kind = 'parallel'">
              <span class="ico">↱</span><b>分头处理</b><span>多条路径处理后汇合</span>
            </button>
          </div>
          <div class="rc-node-modal-label">
            节点模板
            <span v-if="modal.kind === 'decision'" class="rc-modal-hint">（决策节点使用默认结构）</span>
            <span v-else-if="modal.kind === 'parallel'" class="rc-modal-hint">（分头处理使用默认结构）</span>
          </div>
          <div class="rc-node-template-grid" :class="{ dim: modal.kind !== 'node' }">
            <button
              v-for="t in MODAL_TEMPLATES"
              :key="t.template"
              class="rc-node-choice"
              :class="{ active: modal.kind === 'node' && modal.template === t.template }"
              type="button"
              @click="pickTemplate(t.template)"
            >{{ t.name }}</button>
          </div>
        </div>
        <div class="rc-node-modal-foot">
          <button class="rc-btn" type="button" @click="modal.show = false">取消</button>
          <button class="rc-btn primary" type="button" @click="confirmModal">确认</button>
        </div>
      </div>
    </div>
    <!-- 新建流程 · 对话式挑选器 -->
    <NewFlowDialog v-model:open="showNewFlow" />
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

.rc-edge-label { position: absolute; transform: translate(-50%, -50%); padding: 3px 8px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); border-radius: 999px; font-size: 10px; white-space: nowrap; cursor: pointer; z-index: 21; }
.rc-edge-label:hover { border-color: #60a5fa; background: #dbeafe; }
.rc-edge-label.active { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe; }
.rc-edge-table-tag { position: absolute; transform: translate(-50%, 0); font-size: 9px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; pointer-events: none; z-index: 21; }

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

.rc-node-modal-backdrop { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); padding: 24px; }
.rc-node-modal { width: min(640px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); overflow: hidden; }
.rc-node-modal-head { height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--rc-border-soft); }
.rc-node-modal-title { font-size: 14px; font-weight: 800; color: var(--rc-text); }
.rc-node-modal-close { width: 30px; height: 30px; border: 0; background: transparent; color: var(--rc-faint); font-size: 22px; font-weight: 700; cursor: pointer; border-radius: 7px; }
.rc-node-modal-close:hover { background: #f8fafc; color: var(--rc-text-2); }
.rc-node-modal-body { padding: 16px; }
.rc-node-modal-label { font-size: 11px; font-weight: 700; color: var(--rc-muted); margin-bottom: 8px; }
.rc-modal-hint { font-weight: 500; color: var(--rc-faint); margin-left: 4px; }
.rc-node-kind-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.rc-node-kind { min-height: 76px; border: 1px solid var(--rc-border); background: #fff; border-radius: 8px; padding: 10px; text-align: center; cursor: pointer; color: var(--rc-text-2); }
.rc-node-kind b { display: block; color: var(--rc-text); font-size: 13px; margin-top: 5px; }
.rc-node-kind span { display: block; font-size: 10px; color: var(--rc-faint); margin-top: 4px; }
.rc-node-kind.active { border-color: #60a5fa; background: var(--rc-primary-bg); box-shadow: 0 0 0 1px #bfdbfe inset; }
.rc-node-kind .ico { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: #f1f5f9; color: var(--rc-primary); font-size: 11px; font-weight: 900; }
.rc-node-template-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.rc-node-template-grid.dim { opacity: 0.38; pointer-events: none; }
.rc-node-choice { height: 30px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--rc-border); background: #fff; border-radius: 7px; padding: 0 10px; color: #334155; font-size: 12px; cursor: pointer; }
.rc-node-choice:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-node-choice.active { border-color: #60a5fa; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-node-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--rc-border-soft); background: #fbfdff; }
</style>
