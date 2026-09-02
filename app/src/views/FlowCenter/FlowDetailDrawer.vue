<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { flowCenterApi, sourceApi, type FlowDefinition, type FlowRecord } from '@/api'
import { useFlowStore } from '@/stores/flow'
import FlowBoard from '@/views/FlowCanvas/canvas/FlowBoard.vue'
import NodeInspector from '@/views/FlowCanvas/inspector/NodeInspector.vue'

const props = defineProps<{ flow: FlowRecord | null }>()
const emit = defineEmits<{
  close: []
  saved: [flow: FlowRecord]
  apply: [flow: FlowRecord]
}>()

const canvas = useFlowStore()
const name = ref('')
const saving = ref(false)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function definitionFromCanvas(): FlowDefinition {
  return {
    main: [...canvas.main],
    branches: clone(canvas.branches),
    configs: clone(canvas.configs),
    branchGroups: clone(canvas.branchGroups),
  }
}

function loadIntoWorkspace(flow: FlowRecord) {
  name.value = flow.name
  canvas.clearSourceCtx()
  canvas.clearSiteCtx()
  canvas.load({
    id: flow.id,
    name: flow.name,
    // FlowDef.version 只是画布上的展示串；cs_flow 没有版本列，没有就用流程 ID 兜底，
    // 不要拼出 `flow-vundefined`（见 FlowRecord.version 注释）。
    version: flow.version == null ? `flow-${flow.id}` : `flow-v${flow.version}`,
    main: flow.definition.main,
    branches: flow.definition.branches,
    configs: flow.definition.configs,
    branchGroups: flow.definition.branchGroups,
    updatedAt: flow.updatedAt,
  })
  const firstNode = flow.definition.main.find((id) => id !== 'start' && id !== 'end' && flow.definition.configs[id])
  canvas.select(firstNode ?? '')
  canvas.markSaved()
}

/**
 * flowConf 为空时，按该流程**关联源的实际步骤**把画布还原出来。
 *
 * 背景：生产上 735 条流程是后端从 cs_config 整批灌进来的，flowConf 全是 null——但它们不是
 * 空流程，真实结构在 cs_item_config 里（节点 = 主配置 1 个 + 子步骤 N 个）。直接显示空画布
 * 等于告诉用户"这流程没内容"，而且一旦有人点保存，就把空定义写进去了。
 *
 * 后端目前没有按 flow/config 查步骤的接口（nextConfigPaged 只认 sourceId），所以走两跳：
 * flowId → sourcePaged 取任一关联源 → 该源的 nextConfigPaged。
 *
 * 🕗 待后端上线 `nextConfigPaged?flowId=`（2026-09-02 口头确认会加，字段沿用现有这套）后，
 *    这里可以收成一跳。改的时候注意两点，见 endpoints.ts 同名端点的注释：
 *    ① 一个流程挂 N 个源时是否会把步骤按源重复返回（要按 itemConfig 去重）；
 *    ② 还得有个 Source 才能喂 canvas.loadFromSource——真换成一跳的话，得先确认
 *       从步骤本身能不能拼出画布，或者仍然保留取一个源作为画布种子。
 *
 * **刻意在 loadFromSource 之后清掉源上下文**：画布一旦挂上 sourceCtx，节点编辑会走步骤自动
 * 保存（item/next/*），那是在改那一个源的步骤，不是在改流程。这里只借它的结构，不接它的写路径。
 */
const derivedFromSource = ref<{ sourceId: string; name: string } | null>(null)
async function deriveFromSourceSteps(flow: FlowRecord): Promise<boolean> {
  if (!flow.sourceCnt) return false
  const page = await sourceApi.sourcePaged({ flowId: flow.id, page: 1, size: 1 })
  const source = page.list[0]
  if (!source) return false
  const steps = await sourceApi.sourceSteps(source.sourceId)
  canvas.loadFromSource(source, steps)
  canvas.clearSourceCtx()
  canvas.clearSiteCtx()
  canvas.setFlowName(flow.name)
  name.value = flow.name
  canvas.markSaved()
  derivedFromSource.value = { sourceId: source.sourceId, name: source.name || source.sourceId }
  return true
}

/**
 * 打开工作区必须**单独取一次详情**：列表走的是 flowPaged，它不返回 flowConf 这个大字段，
 * 行上的 definition 恒为空流程。直接拿列表行喂画布的话，任何已有流程点开都是一张空画布
 * ——保存下去还会把真实的 flowConf 覆盖成空。2026-09-02 联调实测撞到过。
 * loadSeq 防竞态：连着点两条流程时，先返回的那条不能盖住后点的。
 */
let loadSeq = 0
const loadingDetail = ref(false)
async function openFlowInWorkspace(flow: FlowRecord) {
  const reqId = ++loadSeq
  // 先用列表行把名字/头部铺上，画布等详情回来再填，避免闪一下旧流程的节点
  name.value = flow.name
  loadingDetail.value = true
  derivedFromSource.value = null
  try {
    const full = await flowCenterApi.detail(flow.id)
    if (reqId !== loadSeq) return
    const record = full ?? flow
    if (record.definition.main.length) {
      loadIntoWorkspace(record)
      return
    }
    // 存量流程走这条：flowConf 空，但源上有真实步骤
    const derived = await deriveFromSourceSteps(record).catch(() => false)
    if (reqId !== loadSeq) return
    if (!derived) loadIntoWorkspace(record) // 确实没有关联源，那就是一张真空白画布
  } catch (error) {
    if (reqId !== loadSeq) return
    // 取不到详情就不要拿空画布糊弄——那会让人以为流程是空的，一保存就真空了
    ElMessage.error(`流程详情加载失败：${(error as Error)?.message ?? String(error)}，请重新打开`)
    emit('close')
  } finally {
    if (reqId === loadSeq) loadingDetail.value = false
  }
}

watch(() => props.flow?.id, () => {
  if (props.flow) void openFlowInWorkspace(props.flow)
}, { immediate: true })

async function persistFlow(showMessage = true): Promise<FlowRecord | null> {
  if (!props.flow || saving.value) return null
  const trimmed = name.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入流程名称')
    return null
  }
  saving.value = true
  try {
    const saved = await flowCenterApi.save({
      id: props.flow.id,
      name: trimmed,
      definition: definitionFromCanvas(),
    })
    name.value = saved.name
    canvas.markSaved()
    emit('saved', saved)
    if (showMessage) {
      ElMessage.success(saved.version == null ? '流程已保存' : `流程已保存为 v${saved.version}`)
    }
    return saved
  } catch (error) {
    ElMessage.error(`流程保存失败：${(error as Error)?.message ?? String(error)}`)
    return null
  } finally {
    saving.value = false
  }
}

async function applyToSource() {
  const saved = canvas.dirty || name.value.trim() !== props.flow?.name
    ? await persistFlow(false)
    : props.flow
  if (saved) emit('apply', saved)
}
</script>

<template>
  <aside v-if="flow" class="fd-drawer" aria-label="流程工作区">
    <header class="fd-head">
      <div class="fd-title">
        <span class="fd-kicker">流程工作区</span>
        <input v-model="name" class="fd-name" aria-label="流程名称" @input="canvas.setFlowName(name)" />
        <p>{{ flow.version == null ? flow.id : `${flow.id} · v${flow.version}` }} · 更新于 {{ flow.updatedAt || '—' }}</p>
      </div>
      <button class="fd-close" type="button" title="关闭" @click="emit('close')">✕</button>
    </header>

    <div v-if="loadingDetail" class="fd-loading" data-testid="flow-workspace-loading">正在加载流程定义…</div>
    <!-- 还原态必须说明白：画布上这些节点还没写进流程本身，是照关联源的步骤画的。
         不写这行的话，用户会以为流程里已经存着这份定义。 -->
    <div v-if="!loadingDetail && derivedFromSource" class="fd-derived" data-testid="flow-derived-note">
      该流程尚未保存画布定义，以下节点按关联源「{{ derivedFromSource.name }}」（{{ derivedFromSource.sourceId }}）的实际步骤还原，点「保存流程」后才会写入流程。
    </div>
    <div v-if="!loadingDetail" class="fd-workspace">
      <section class="fd-canvas" aria-label="流程节点">
        <FlowBoard embedded />
      </section>
      <section class="fd-inspector" aria-label="节点设置">
        <NodeInspector hide-ai />
      </section>
    </div>

    <footer class="fd-foot">
      <span class="fd-foot-note">节点配置在右侧直接修改；关联到源只登记归属关系，不改动源现有的配置与步骤。</span>
      <button class="fd-secondary" type="button" :disabled="saving" data-testid="flow-apply-to-source" @click="applyToSource">关联到源</button>
      <button class="fd-primary" type="button" :disabled="saving" data-testid="flow-save" @click="persistFlow()">{{ saving ? '保存中…' : '保存流程' }}</button>
    </footer>
  </aside>
</template>

<style scoped>
.fd-drawer { position: fixed; top: 56px; right: 0; bottom: 0; width: min(980px, calc(100vw - 256px)); max-width: 100vw; z-index: 40; display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--rc-border); box-shadow: -12px 0 32px -24px rgba(15, 23, 42, 0.48); }
.fd-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.fd-title { min-width: 0; }
.fd-kicker { display: block; color: var(--rc-muted); font-size: 11px; }
.fd-name { display: block; width: min(520px, 70vw); margin: 2px 0 3px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--rc-text); font-size: 15px; font-weight: 700; }
.fd-name:focus { box-shadow: inset 0 -1px 0 var(--rc-primary); }
.fd-title p { margin: 0; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fd-close { margin-left: auto; border: 0; background: transparent; color: var(--rc-faint); font-size: 14px; cursor: pointer; }
.fd-close:hover { color: var(--rc-text); }
.fd-derived { padding: 8px 16px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; line-height: 1.5; }
.fd-loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; background: #f4f7fb; }
.fd-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(340px, 42%) minmax(420px, 1fr); gap: 10px; padding: 10px; background: #f4f7fb; }
.fd-canvas, .fd-inspector { min-width: 0; min-height: 0; }
.fd-foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.fd-foot-note { flex: 1; color: var(--rc-faint); font-size: 11px; }
.fd-primary, .fd-secondary { height: 32px; padding: 0 14px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; }
.fd-primary { border: 1px solid var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fd-secondary { border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary-ink); }
.fd-primary:disabled, .fd-secondary:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 980px) {
  .fd-drawer { width: 100vw; }
  .fd-workspace { grid-template-columns: minmax(320px, 44%) minmax(360px, 1fr); overflow-x: auto; }
}
</style>
