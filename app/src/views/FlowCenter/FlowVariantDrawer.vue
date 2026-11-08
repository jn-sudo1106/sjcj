<script setup lang="ts">
// 流程中心「分析变体 / 推荐归类」抽屉（1105 会议：流程按「流程模板 → 变体」两级归类）。
//
// 后端还没有流程指纹，这里打开时现拉：先分页取本组全部流程，再逐个读步骤（带配置详情，
// 节点类型和队列在配置里），算法见 utils/flow/flowVariants.ts。
//   · 模板分组：按结构分成变体 A/B/C…，B 之后的变体标出相对 A 多了 / 少了哪些节点；
//     勾两个流程可以逐步骤对比配置差异。
//   · 未归类：拿每个流程的节点类型序列和各模板比，给出最像的模板，勾选后按推荐批量归类。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, type FlowRecord, type FlowTemplateGroup, type Step } from '@/api'
import { drainQueue } from '@/utils/concurrency'
import {
  alignByCode, compareFlows, flowShape, groupVariants, recommendTemplate, shapeLabels, templateCodes, typeLabel,
  type FlowShape, type TemplateRecommendation, type TemplateShape,
} from '@/utils/flow/flowVariants'

const props = defineProps<{ modelValue: boolean; group: FlowTemplateGroup | undefined; templateGroups: FlowTemplateGroup[] }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; openFlow: [flow: FlowRecord]; assigned: [] }>()

/** 一次分析最多读这么多流程：每个流程要读步骤和配置，再多等待时间就不可接受了 */
const MAX_FLOWS = 300
const PAGE_SIZE = 100
const CONCURRENCY = 4

interface Analyzed { flow: FlowRecord; steps: Step[]; shape: FlowShape; recommendation?: TemplateRecommendation }

const isUnassigned = computed(() => props.group?.id === 'unassigned')
const title = computed(() => (isUnassigned.value ? '推荐归类 · 未归类流程' : `分析变体 · ${props.group?.name ?? ''}`))
const loading = ref(false)
const progress = ref({ done: 0, total: 0 })
const error = ref('')
const truncated = ref(false)
const failed = ref<FlowRecord[]>([])
const analyzed = ref<Analyzed[]>([])
let runSeq = 0

const variants = computed(() => groupVariants(analyzed.value, (item) => item.shape))
const baseVariant = computed(() => variants.value[0])
const expanded = ref<string[]>([])

/** 变体链上每个节点相对变体 A 的状态 */
function variantChain(codes: string[], parents: number[]) {
  const labels = shapeLabels({ codes, parents })
  const base = baseVariant.value
  if (!base || base.key === `${codes.join('>')}#${parents.join(',')}`) return labels.map((label) => ({ label, op: 'same' as const }))
  const ops = alignByCode(base.codes.map((code, i) => ({ code, i })), codes.map((code, i) => ({ code, i })), (x) => x.code, (x) => x.code)
  return ops.map((op) => op.op === 'missing'
    ? { label: typeLabel(op.a.code), op: op.op }
    : { label: labels[op.b.i]!, op: op.op })
}

// ---- 两个流程对比 ----
const compareIds = ref<string[]>([])
function toggleCompare(id: string, checked: boolean) {
  compareIds.value = checked ? [...compareIds.value.filter((x) => x !== id), id].slice(-2) : compareIds.value.filter((x) => x !== id)
}
const compared = computed(() => {
  const [a, b] = compareIds.value.map((id) => analyzed.value.find((item) => item.flow.id === id))
  return a && b ? { a, b, rows: compareFlows(a.steps, b.steps) } : undefined
})
const compareDiffCount = computed(() => compared.value?.rows.filter((row) => row.op !== 'same' || row.diffs.length).length ?? 0)

// ---- 未归类推荐 ----
const picked = ref<string[]>([])
const assigning = ref(false)
const recommendable = computed(() => analyzed.value.filter((item) => item.recommendation))

async function loadTemplateShapes(): Promise<TemplateShape[]> {
  const groups = props.templateGroups.filter((group) => group.id !== 'unassigned' && !group.disabled)
  const shapes: TemplateShape[] = []
  await drainQueue([...groups], CONCURRENCY, async (group) => {
    const detail = await flowCenterApi.detail(group.id).catch(() => null)
    if (!detail) return
    const codes = detail.definition.structureOnly
      ? templateCodes(detail.definition)
      : flowShape(await flowCenterApi.steps(group.id).catch(() => [])).codes
    if (codes.length) shapes.push({ id: group.id, name: group.name, codes })
  })
  return shapes
}

async function listFlows(seq: number): Promise<FlowRecord[]> {
  const group = props.group!
  const all: FlowRecord[] = []
  for (let page = 1; all.length < MAX_FLOWS; page++) {
    const result = await flowCenterApi.paged({
      page, size: PAGE_SIZE, onlyTemplate: false,
      templateId: group.id === 'unassigned' ? undefined : group.id,
      unassignedTemplate: group.id === 'unassigned',
    })
    if (seq !== runSeq) return []
    all.push(...result.list)
    if (all.length >= result.total || !result.list.length) {
      truncated.value = false
      return all
    }
  }
  truncated.value = true
  return all.slice(0, MAX_FLOWS)
}

async function analyze() {
  if (!props.group) return
  const seq = ++runSeq
  loading.value = true
  error.value = ''
  failed.value = []
  analyzed.value = []
  compareIds.value = []
  picked.value = []
  expanded.value = []
  progress.value = { done: 0, total: 0 }
  try {
    const [flows, templates] = await Promise.all([listFlows(seq), isUnassigned.value ? loadTemplateShapes() : Promise.resolve([])])
    if (seq !== runSeq) return
    progress.value = { done: 0, total: flows.length }
    const results: Analyzed[] = []
    await drainQueue([...flows], CONCURRENCY, async (flow) => {
      try {
        const steps = await flowCenterApi.steps(flow.id)
        if (seq !== runSeq) return
        const shape = flowShape(steps)
        results.push({ flow, steps, shape, recommendation: isUnassigned.value ? recommendTemplate(shape.codes, templates) : undefined })
      } catch {
        if (seq === runSeq) failed.value.push(flow)
      } finally {
        if (seq === runSeq) progress.value = { ...progress.value, done: progress.value.done + 1 }
      }
    })
    if (seq !== runSeq) return
    const order = new Map(flows.map((flow, i) => [flow.id, i]))
    analyzed.value = results.sort((a, b) => order.get(a.flow.id)! - order.get(b.flow.id)!)
    picked.value = analyzed.value.filter((item) => item.recommendation).map((item) => item.flow.id)
    if (variants.value[0]) expanded.value = [variants.value[0].key]
  } catch (e) {
    if (seq === runSeq) error.value = `分析失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    if (seq === runSeq) loading.value = false
  }
}

async function assignPicked() {
  const byTemplate = new Map<string, { name: string; ids: string[] }>()
  for (const item of analyzed.value) {
    const rec = item.recommendation
    if (!rec || !picked.value.includes(item.flow.id)) continue
    const entry = byTemplate.get(rec.id) ?? { name: rec.name, ids: [] }
    entry.ids.push(item.flow.id)
    byTemplate.set(rec.id, entry)
  }
  if (!byTemplate.size) return
  const summary = [...byTemplate.values()].map((entry) => `「${entry.name}」${entry.ids.length} 个`).join('、')
  const confirmed = await ElMessageBox.confirm(`将按推荐归类：${summary}。归类后可在列表里改到别的模板。`, '按推荐归类', { type: 'warning', confirmButtonText: '归类', cancelButtonText: '取消' })
    .then(() => true, () => false)
  if (!confirmed) return
  assigning.value = true
  const done: string[] = []
  try {
    for (const [templateId, entry] of byTemplate) {
      const ack = await flowCenterApi.assignTemplate(entry.ids, templateId)
      if (!ack.ok) throw new Error(`「${entry.name}」：${ack.message || '归类失败'}`)
      done.push(...entry.ids)
    }
    ElMessage.success(`已归类 ${done.length} 个流程`)
  } catch (e) {
    ElMessage.error(`${done.length ? `已归类 ${done.length} 个，其余失败` : '归类失败'}：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    assigning.value = false
    if (done.length) {
      analyzed.value = analyzed.value.filter((item) => !done.includes(item.flow.id))
      picked.value = picked.value.filter((id) => !done.includes(id))
      emit('assigned')
    }
  }
}

function percent(score: number) {
  return `${Math.round(score * 100)}%`
}

watch(() => [props.modelValue, props.group?.id] as const, ([open]) => {
  if (open) void analyze()
  else runSeq++
}, { immediate: true })
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="title"
    size="min(820px, 94vw)"
    append-to-body
    data-testid="flow-variant-drawer"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="fv-body">
      <p class="fv-note">
        {{ isUnassigned
          ? '按节点类型序列和各模板比对，相似度 60% 以上才推荐。只比结构，不看具体配置。'
          : '结构（节点类型和上下游）完全相同的流程算同一个变体。勾选两个流程可以逐步骤对比配置。' }}
        后端还没有流程指纹，每次打开现拉现算。
      </p>
      <div v-if="loading" class="fv-state" data-testid="flow-variant-progress">
        正在读取流程步骤 {{ progress.done }} / {{ progress.total || '…' }}
      </div>
      <div v-else-if="error" class="fv-state fv-error">{{ error }}<button class="fv-link" type="button" @click="analyze">重试</button></div>
      <template v-else>
        <p v-if="truncated" class="fv-warn">本组流程超过 {{ MAX_FLOWS }} 个，只分析了前 {{ MAX_FLOWS }} 个。</p>
        <p v-if="failed.length" class="fv-warn">{{ failed.length }} 个流程的步骤读取失败，未参与分析：{{ failed.map((f) => f.name || f.id).join('、') }}</p>
        <div v-if="!analyzed.length" class="fv-state">没有可分析的流程</div>

        <!-- 模板分组：变体列表 -->
        <template v-else-if="!isUnassigned">
          <div class="fv-summary" data-testid="flow-variant-summary">共 {{ analyzed.length }} 个流程，{{ variants.length }} 个变体</div>
          <section v-for="variant in variants" :key="variant.key" class="fv-variant" data-testid="flow-variant">
            <button
              type="button"
              class="fv-variant-head"
              :aria-expanded="expanded.includes(variant.key)"
              @click="expanded = expanded.includes(variant.key) ? expanded.filter((k) => k !== variant.key) : [...expanded, variant.key]"
            >
              <b>变体 {{ variant.letter }}</b>
              <span>{{ variant.items.length }} 个流程</span>
              <span v-if="variant === baseVariant" class="fv-tag">主变体</span>
            </button>
            <div class="fv-chain" data-testid="flow-variant-chain">
              <template v-for="(node, i) in variantChain(variant.codes, variant.parents)" :key="i">
                <span v-if="i" class="fv-arrow">→</span>
                <span class="fv-node" :class="node.op" :title="node.op === 'added' ? '比主变体多出的节点' : node.op === 'missing' ? '比主变体少的节点' : ''">
                  {{ node.op === 'added' ? '+ ' : '' }}{{ node.label }}
                </span>
              </template>
            </div>
            <ul v-if="expanded.includes(variant.key)" class="fv-flows">
              <li v-for="item in variant.items" :key="item.flow.id">
                <label>
                  <input
                    type="checkbox"
                    :checked="compareIds.includes(item.flow.id)"
                    :aria-label="`对比流程 ${item.flow.name}`"
                    data-testid="flow-variant-compare-pick"
                    @change="toggleCompare(item.flow.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="fv-flow-name">{{ item.flow.name || item.flow.id }}</span>
                </label>
                <small>{{ item.flow.id }} · {{ item.flow.sourceCnt ?? 0 }} 个源</small>
                <button class="fv-link" type="button" @click="emit('openFlow', item.flow)">打开</button>
              </li>
            </ul>
          </section>

          <section class="fv-compare" data-testid="flow-variant-compare">
            <div class="fv-compare-head">
              <b>配置对比</b>
              <span v-if="!compared">在变体里勾选两个流程</span>
              <span v-else>「{{ compared.a.flow.name }}」 vs 「{{ compared.b.flow.name }}」 · {{ compareDiffCount ? `${compareDiffCount} 处步骤有差异` : '配置完全一致' }}</span>
            </div>
            <table v-if="compared" class="fv-compare-table">
              <thead><tr><th style="width: 140px">步骤</th><th>差异</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in compared.rows" :key="i" :class="row.op">
                  <td>
                    <b>{{ row.typeLabel }}</b>
                    <small>{{ row.a?.name || row.b?.name }}</small>
                  </td>
                  <td>
                    <span v-if="row.op === 'missing'" class="fv-only">只有「{{ compared.a.flow.name }}」有这个步骤</span>
                    <span v-else-if="row.op === 'added'" class="fv-only">只有「{{ compared.b.flow.name }}」有这个步骤</span>
                    <span v-else-if="!row.diffs.length" class="fv-same">一致</span>
                    <dl v-else class="fv-diffs">
                      <template v-for="diff in row.diffs" :key="diff.label">
                        <dt>{{ diff.label }}</dt>
                        <dd><span class="fv-a">{{ diff.a }}</span><span class="fv-b">{{ diff.b }}</span></dd>
                      </template>
                    </dl>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>

        <!-- 未归类：推荐模板 -->
        <template v-else>
          <div class="fv-summary">
            <span data-testid="flow-variant-summary">共 {{ analyzed.length }} 个未归类流程，{{ recommendable.length }} 个有推荐模板</span>
            <button
              class="rc-btn primary"
              type="button"
              data-testid="flow-variant-assign"
              :disabled="!picked.length || assigning"
              @click="assignPicked"
            >{{ assigning ? '归类中…' : `按推荐归类（${picked.length}）` }}</button>
          </div>
          <table class="fv-compare-table">
            <thead><tr><th style="width: 32px" /><th>流程</th><th>节点结构</th><th style="width: 170px">推荐模板</th></tr></thead>
            <tbody>
              <tr v-for="item in analyzed" :key="item.flow.id" data-testid="flow-variant-recommend-row">
                <td>
                  <input
                    v-if="item.recommendation"
                    type="checkbox"
                    :checked="picked.includes(item.flow.id)"
                    :aria-label="`按推荐归类 ${item.flow.name}`"
                    @change="picked = ($event.target as HTMLInputElement).checked ? [...picked, item.flow.id] : picked.filter((id) => id !== item.flow.id)"
                  />
                </td>
                <td>
                  <button class="fv-link" type="button" @click="emit('openFlow', item.flow)">{{ item.flow.name || item.flow.id }}</button>
                  <small>{{ item.flow.id }} · {{ item.flow.sourceCnt ?? 0 }} 个源</small>
                </td>
                <td class="fv-muted">{{ shapeLabels(item.shape).join(' → ') || '—' }}</td>
                <td>
                  <template v-if="item.recommendation">{{ item.recommendation.name }} <span class="fv-score">{{ percent(item.recommendation.score) }}</span></template>
                  <span v-else class="fv-muted">无相近模板</span>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.fv-body { display: flex; flex-direction: column; gap: 10px; color: var(--rc-text); font-size: 12px; }
.fv-note { margin: 0; color: var(--rc-muted); line-height: 1.6; }
.fv-state { padding: 32px 12px; color: var(--rc-faint); text-align: center; }
.fv-error { color: var(--rc-error); }
.fv-warn { margin: 0; color: var(--rc-warn); }
.fv-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--rc-text-2); font-weight: 600; }
.fv-summary .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.fv-variant { padding: 10px 12px; border: 1px solid var(--rc-border-soft); border-radius: var(--rc-radius-sm); }
.fv-variant-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 0; border: 0; background: none; color: var(--rc-text); font-size: 13px; cursor: pointer; text-align: left; }
.fv-variant-head span { color: var(--rc-muted); font-size: 12px; }
.fv-tag { padding: 0 6px; border-radius: 4px; background: var(--rc-primary-bg); color: var(--rc-primary) !important; }
.fv-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }
.fv-arrow { color: var(--rc-faint); }
.fv-node { padding: 2px 8px; border: 1px solid var(--rc-border); border-radius: 4px; background: #f8fafc; }
.fv-node.added { border-color: #86efac; background: var(--rc-ok-bg); color: var(--rc-ok); }
.fv-node.missing { border-color: #fecaca; background: var(--rc-error-bg); color: var(--rc-error); text-decoration: line-through; }
.fv-flows { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px dashed var(--rc-border-soft); list-style: none; }
.fv-flows li { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.fv-flows label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1; cursor: pointer; }
.fv-flow-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fv-flows small, .fv-compare-table small { display: block; color: var(--rc-faint); font-size: 11px; }
.fv-flows small { display: inline; }
.fv-link { padding: 0; border: 0; background: none; color: var(--rc-primary); font-size: 12px; cursor: pointer; text-align: left; }
.fv-link:hover { text-decoration: underline; }
.fv-compare { padding-top: 6px; border-top: 1px solid var(--rc-border-soft); }
.fv-compare-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.fv-compare-head span { color: var(--rc-muted); }
.fv-compare-table { width: 100%; border-collapse: collapse; }
.fv-compare-table th, .fv-compare-table td { padding: 6px 8px; border-bottom: 1px solid var(--rc-border-soft); text-align: left; vertical-align: top; }
.fv-compare-table th { color: var(--rc-muted); font-weight: 600; background: #f8fafc; }
.fv-compare-table tr.missing td:first-child, .fv-compare-table tr.added td:first-child { border-left: 3px solid var(--rc-warn); }
.fv-only { color: var(--rc-warn); }
.fv-same { color: var(--rc-faint); }
.fv-diffs { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 4px 8px; margin: 0; }
.fv-diffs dt { color: var(--rc-muted); }
.fv-diffs dd { display: flex; flex-direction: column; gap: 2px; margin: 0; overflow-wrap: anywhere; }
.fv-a::before { content: 'A：'; color: var(--rc-faint); }
.fv-b::before { content: 'B：'; color: var(--rc-faint); }
.fv-muted { color: var(--rc-muted); }
.fv-score { color: var(--rc-ok); font-weight: 600; }
</style>
