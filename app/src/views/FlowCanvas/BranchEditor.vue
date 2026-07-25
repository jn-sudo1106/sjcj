<script setup lang="ts">
// 决策/分头节点分支编辑器（0707 优化·Phase6）：
// - 决策：IF/ELIF/ELSE 三类分支，条件按序匹配首个命中即走（A3 口径）；
// - 分头：N 路无条件并行；
// - 汇合：分支段统一在主链上 owner 的下一个节点收拢（Q1 默认口径；不需要汇合的流程把决策放主链末端即可）；
// - 条件字段下拉取 owner 节点的 effectiveInputTable（决策/分头的"上游输出表"）schema；
// - 链内节点在此提供上下移/摘除；节点新增走画布 fan-out 分支列的「+」（FlowBoard.vue），复用 AddNodePopover 并隐藏「逻辑」分组防嵌套。
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { conditionGroupLabel, decisionOrParallelKind, type ConditionGroup, type FlowBranch, type FlowBranchGroup } from '@/views/FlowCanvas/canvas/flowModel'
import ConditionRow from './ConditionRow.vue'
import { entryApi, type EntryType } from '../../api'

const props = defineProps<{ ownerId: string }>()
const flow = useFlowStore()

const tables = ref<EntryType[]>([])
onMounted(async () => {
  tables.value = (await entryApi.entryPaged({ size: 100 })).list
})

const group = computed<FlowBranchGroup | undefined>(() =>
  flow.branchGroups.find((bg) => bg.ownerId === props.ownerId),
)
const ownerCfg = computed(() => flow.configs[props.ownerId])
// 0707 优化·Phase6·补：kind 判定收敛到 flowModel.decisionOrParallelKind（与 NodeInspector 顶层 Tab 分流同口径，
// 复用 isDecision/isParallel 文案正则，避免两处各写导致漂移）
const kind = computed<'decision' | 'parallel' | 'unknown'>(() => {
  const c = ownerCfg.value
  if (!c) return 'unknown'
  return decisionOrParallelKind(c) ?? 'unknown'
})

/** 条件字段下拉：取 owner 节点的 effectiveInputTable schema（决策/分头的"上游输出表"） */
const branchFields = computed<{ prop: string; desc: string }[]>(() => {
  const tid = flow.effectiveInputTableFor(props.ownerId)
  if (!tid) return []
  return tables.value.find((t) => t.tableId === tid)?.fields.map((f) => ({ prop: f.prop, desc: f.desc })) ?? []
})

function onLabelChange(b: FlowBranch, e: Event) {
  flow.setBranchLabel(props.ownerId, b.id, (e.target as HTMLInputElement).value)
}
function onConditionChange(b: FlowBranch, cond: ConditionGroup | undefined) {
  if (!flow.setBranchCondition(props.ownerId, b.id, cond)) {
    ElMessage.warning('该分支不可设条件')
  }
}
function onMove(dir: 'up' | 'down', b: FlowBranch) {
  flow.moveBranch(props.ownerId, b.id, dir)
}
function onRemove(b: FlowBranch) {
  const res = flow.removeBranch(props.ownerId, b.id)
  if (!res.ok) ElMessage.warning(res.reason ?? '删除失败')
}
function onAddElif() {
  flow.addBranch(props.ownerId)
}
function onInit() {
  if (kind.value === 'unknown') {
    ElMessage.warning('该节点不是决策/分头节点，无法初始化分支段')
    return
  }
  flow.ensureBranchGroup(props.ownerId, kind.value)
}

/** 链内节点上下移 */
function onMoveChain(b: FlowBranch, idx: number, dir: 'up' | 'down') {
  flow.moveInBranch(props.ownerId, b.id, idx, dir)
}
/** 从分支内删除节点（同时从 configs 移除，0707 Phase6 统一策略） */
function onRemoveChainNode(nodeId: string) {
  flow.remove(nodeId)
}

/** 分支子链摘要 */
function chainSummary(b: FlowBranch) {
  if (!b.chain.length) return '空·直达汇合点'
  return b.chain.map((id) => flow.configs[id]?.title || id).join(' → ')
}
function chainSummaryLabel(b: FlowBranch) {
  return conditionGroupLabel(b.condition)
}

async function onRemoveGroup() {
  try {
    await ElMessageBox.confirm(
      `删除决策/分头节点将一并删除整组分支（含分支内节点），是否继续？`,
      '删除决策/分头',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    flow.remove(props.ownerId)
  } catch {/* canceled */}
}
</script>

<template>
  <div v-if="group" class="be-root">
    <div class="be-header">
      <span class="be-title">{{ kind === 'decision' ? '条件分支' : '分头处理（多路无条件并行）' }}</span>
      <span class="be-hint">汇合点 = 主链上下一个节点（不汇合时把决策放主链末端即可）</span>
    </div>
    <div v-for="(b, idx) in group.branches" :key="b.id" class="be-branch">
      <div class="be-branch-head">
        <input
          class="rc-input be-label"
          :value="b.label"
          placeholder="分支名"
          @change="onLabelChange(b, $event)"
        />
        <div class="be-tools">
          <button v-if="idx > 0" class="rc-row-move" type="button" title="上移" @click="onMove('up', b)">↑</button>
          <button v-if="idx < group.branches.length - 1" class="rc-row-move" type="button" title="下移" @click="onMove('down', b)">↓</button>
          <button
            v-if="group.branches.length > 1"
            class="rc-row-del"
            type="button"
            title="删除该分支"
            @click="onRemove(b)"
          >✕</button>
        </div>
      </div>
      <!-- 条件（决策场景每条均独立配置） -->
      <ConditionRow
        v-if="kind === 'decision'"
        integrated
        :condition="b.condition"
        :fields="branchFields"
        @change="(c) => onConditionChange(b, c)"
      />
      <!-- 分支子链摘要 + 节点列表 -->
      <div class="be-chain">
        <div class="be-chain-summary">
          <b>子链</b>：{{ chainSummary(b) }}
          <span v-if="chainSummaryLabel(b)" class="be-chain-cond"> · 条件摘要：{{ chainSummaryLabel(b) }}</span>
        </div>
        <ol v-if="b.chain.length" class="be-chain-list">
          <li v-for="(nid, i) in b.chain" :key="nid" class="be-chain-item">
            <span class="be-chain-idx">{{ i + 1 }}</span>
            <span class="be-chain-name">{{ flow.configs[nid]?.title || nid }}</span>
            <button class="rc-row-move" type="button" title="上移" :disabled="i === 0" @click="onMoveChain(b, i, 'up')">↑</button>
            <button class="rc-row-move" type="button" title="下移" :disabled="i === b.chain.length - 1" @click="onMoveChain(b, i, 'down')">↓</button>
            <button class="rc-row-del" type="button" title="从分支摘除（同时删除节点）" @click="onRemoveChainNode(nid)">✕</button>
          </li>
        </ol>
        <div class="be-chain-empty-hint" v-else>空·直达汇合点</div>
      </div>
    </div>
    <div class="be-footer">
      <button v-if="kind === 'decision'" class="rc-btn" type="button" @click="onAddElif">＋ 添加分支</button>
      <span v-else class="be-hint">分头节点追加分支未实现（0707 Phase 6 简化口径：拖出新分头节点更直观）</span>
    </div>
    <div class="be-danger-zone">
      <button class="rc-btn-danger" type="button" @click="onRemoveGroup">删除决策/分头节点（连带整组分支）</button>
    </div>
  </div>
  <div v-else class="be-empty">
    <div class="be-empty-hint">该节点尚未配置分支段</div>
    <button v-if="kind !== 'unknown'" class="rc-btn" type="button" @click="onInit">
      初始化为{{ kind === 'decision' ? '条件分支 1' : '2 条并行分支' }}
    </button>
    <div v-else class="be-empty-hint">该节点不是决策/分头节点，无法初始化分支段</div>
  </div>
</template>

<style scoped>
.be-root { padding: 4px 0; }
.be-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; padding: 4px 0; border-bottom: 1px dashed var(--rc-border); }
.be-title { font-size: 12px; font-weight: 700; color: var(--rc-text); }
.be-hint { font-size: 10px; color: var(--rc-faint); }
.be-branch { padding: 10px; border: 1px solid var(--rc-border); border-radius: 8px; background: var(--rc-primary-bg); margin-bottom: 10px; }
.be-branch.be-else { background: #f1f5f9; border-color: #cbd5e1; }
.be-branch-head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.be-label { flex: 1; }
.be-tools { display: flex; gap: 4px; }
.rc-row-move, .rc-row-del { width: 22px; height: 22px; border: 0; background: transparent; color: var(--rc-faint); border-radius: 4px; cursor: pointer; font-size: 12px; }
.rc-row-move:hover:not(:disabled) { background: #fff; color: var(--rc-text); }
.rc-row-move:disabled { opacity: 0.3; cursor: not-allowed; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.be-else-hint { font-size: 11px; color: var(--rc-faint); padding: 4px 0; }
.be-chain { padding-top: 6px; border-top: 1px dashed #dbe3ee; }
.be-chain-summary { font-size: 11px; color: var(--rc-text-2); margin-bottom: 6px; }
.be-chain-cond { color: var(--rc-faint); }
.be-chain-list { list-style: none; padding: 0; margin: 0 0 6px 0; }
.be-chain-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: #fff; border: 1px solid #dbe3ee; border-radius: 6px; margin-bottom: 4px; font-size: 11px; }
.be-chain-idx { color: var(--rc-faint); min-width: 18px; text-align: center; }
.be-chain-name { flex: 1; }
.be-chain-empty-hint { font-size: 10px; color: var(--rc-faint); padding: 4px 0; }
.be-footer { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
.be-danger-zone { margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--rc-error-bg); }
.be-empty { padding: 16px; text-align: center; color: var(--rc-faint); }
.be-empty-hint { margin-bottom: 8px; font-size: 11px; }
.rc-btn, .rc-btn-danger, .rc-input { font-family: inherit; font-size: 12px; }
.rc-btn { padding: 6px 12px; border: 1px solid var(--rc-border); background: #fff; color: var(--rc-text); border-radius: 6px; cursor: pointer; }
.rc-btn:hover { border-color: var(--rc-primary); color: var(--rc-primary); }
.rc-btn-danger { padding: 6px 12px; border: 1px solid var(--rc-error-bg); background: #fff; color: #b91c1c; border-radius: 6px; cursor: pointer; font-size: 11px; }
.rc-btn-danger:hover { background: var(--rc-error-bg); }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: var(--rc-text); padding: 6px 9px; outline: none; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input:disabled { background: #f1f5f9; color: var(--rc-faint); }
</style>
