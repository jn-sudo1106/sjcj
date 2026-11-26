<script setup lang="ts">
/**
 * 指定流程运行一次弹窗（1008-04，§3.5 ⑥「指定流程运行一次」）。
 *
 * 勾选几个源后，从这些源**当前生效**的流程里选一个，立即用这个流程跑一次；
 * 不影响定时，也不改默认流程（底层是 `sendSnatchWithParam` 多带一个 `flowId`）。
 *
 * 流程：
 * 1. 逐个源调 `sourceFlowIds([源])` 取它当前生效的流程（并集接口分不出哪个源有哪条，
 *    只能逐个查；并发 8 个）；
 * 2. 与流程列表（排除停用）求交集，作为可选项，只有部分源关联的标「N/M 个源」；
 * 3. 选定后只对**关联了这条流程的源** `sendSnatchWithParam({ ids, flowId, ... })` 分批提交，
 *    没关联的跳过并在结果里列出（不能拿别的源的流程去跑它）；
 * 4. 失败的源逐条展示（哪个源为什么没发出去）。
 *
 * 5. 2026-11-26 也是源列表「发任务 ▾ → 选择流程发任务」的弹窗（孙总要求发任务时能选流程）。对齐旧平台
 *    SourceList「手工发送」：选完流程先 loadParams，有参数就弹参数框，参数框发送时同样带这个 flowId。
 *
 * ⚠️ ⑥ 的 flowId 参数 217 是否生效只能真跑一次确认（接口文档没写这个参数）：
 * 开发时在站 105 测试源上验证；不生效就先不上这个菜单。代码层由契约测试锁住调用形状。
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, sourceGroupApi, type FlowRecord } from '@/api'
import { sendInBatches } from '@/views/FlowCanvas/result/useSourceLaunch'
import SourceParamModal from '@/views/FlowCanvas/source/SourceParamModal.vue'
import { snatchFailReasonText } from '@/utils/snatchResult'
import { hasLoadParams, normalizeLoadParams } from '@/views/FlowCanvas/source/paramNormalize'

const props = defineProps<{
  sourceIds: string[]
  /** 流程候选（排除停用） */
  flows: FlowRecord[]
  /** 弹窗标题：源列表「发任务」入口传「选择流程发任务」 */
  title?: string
  /** 源 ID → 名称，参数框里显示用；不给就显示 ID */
  sourceNames?: Record<string, string>
}>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(false)
const loadError = ref('')
const flowId = ref('')
const running = ref(false)
const result = ref<{ sent: number; failed: { ids: string[]; error: string }[]; skipped: string[] } | null>(null)

/** 勾选源当前生效流程（逐源）与候选流程的交集 */
const availableFlows = ref<FlowRecord[]>([])
/** 流程 → 关联了它的勾选源 */
const sourcesByFlow = ref(new Map<string, string[]>())
const flowLabel = (id: string) => {
  const flow = availableFlows.value.find((f) => f.id === id) ?? props.flows.find((f) => f.id === id)
  return flow ? `${flow.name} · ${id}` : `流程 ${id}`
}
function optionLabel(flow: FlowRecord): string {
  const n = sourcesByFlow.value.get(flow.id)?.length ?? 0
  return n < props.sourceIds.length ? `${flow.name} · ${flow.id}（${n}/${props.sourceIds.length} 个源）` : `${flow.name} · ${flow.id}`
}
const LOOKUP_CONCURRENCY = 8

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const byFlow = new Map<string, string[]>()
    const queue = [...props.sourceIds]
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        for (const flow of await sourceGroupApi.sourceFlowIds([id])) byFlow.set(flow, [...(byFlow.get(flow) ?? []), id])
      }
    }))
    sourcesByFlow.value = byFlow
    availableFlows.value = props.flows.filter((f) => byFlow.has(f.id))
    if (!availableFlows.value.length) loadError.value = '这些源当前没有生效的流程（未关联或全部停用），无法指定流程运行'
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function run() {
  if (!flowId.value) {
    ElMessage.warning('请选择要运行的流程')
    return
  }
  running.value = true
  result.value = null
  const targets = sourcesByFlow.value.get(flowId.value) ?? []
  const skipped = props.sourceIds.filter((id) => !targets.includes(id))
  // 有参数的源先弹参数框（旧平台「手工发送」同口径），发送在参数框确认后、同样带这条流程
  try {
    const raw = await sourceApi.loadParams(targets)
    if (hasLoadParams(normalizeLoadParams(raw))) {
      paramSkipped = skipped
      paramFlowId = flowId.value
      paramModalRef.value?.showParam(raw, targets.map((id) => ({ sourceId: id, name: props.sourceNames?.[id] })), false)
      running.value = false
      return
    }
  } catch (error) {
    ElMessage.error(`读取参数失败：${error instanceof Error ? error.message : String(error)}`)
    running.value = false
    return
  }
  try {
    const batch = await sendInBatches(targets, (ids) =>
      sourceApi.sendSnatchWithParam({ ids, param: {}, all: 0, include: [], skip: 0, flowId: flowId.value }))
    result.value = { sent: batch.sent, failed: batch.failed, skipped }
    const text = `已对 ${batch.sent} 个源用「${flowLabel(flowId.value)}」下发任务`
    if (batch.failed.length || skipped.length) ElMessage.warning(`${text}，其余未发出，见下方明细`)
    else ElMessage.success(text)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    running.value = false
  }
}

const paramModalRef = ref<InstanceType<typeof SourceParamModal>>()
let paramSkipped: string[] = []
let paramFlowId = ''
/** 参数框确认后的发送：带选中的流程；结果同样记进下方明细 */
async function sendWithParams(ids: string[], param: Record<string, string>, _all: number, include: string[], skip: number, queue: string) {
  // all 压成 0：那是参数全排列，不是「所有源」，与源列表发任务同口径
  const res = await sourceApi.sendSnatchWithParam({ ids, param, all: 0, include, skip, queue, flowId: paramFlowId })
  const failedIds = new Set((res.failed ?? []).map((f) => String(f.sourceId)))
  result.value = {
    sent: ids.filter((id) => !failedIds.has(id)).length,
    failed: (res.failed ?? []).map((f) => ({ ids: [String(f.sourceId)], error: snatchFailReasonText(f.reason) })),
    skipped: paramSkipped,
  }
  return res
}

watch(() => props.sourceIds, () => {
  flowId.value = ''
  result.value = null
  void load()
}, { immediate: true })
</script>

<template>
  <el-dialog :model-value="true" :title="title || '指定流程运行一次'" width="520px" style="max-width: calc(100vw - 32px)" append-to-body @close="emit('close')">
    <p class="ro-summary">已勾选 <strong>{{ sourceIds.length }}</strong> 个来源。从这些源当前生效的流程里选一个，立即用这个流程跑一次；不影响定时，也不改默认流程。</p>
    <p v-if="loadError" class="ro-error">{{ loadError }}</p>
    <div v-else-if="!loading && availableFlows.length" class="ro-body">
      <label class="ro-label">要运行的流程</label>
      <el-select v-model="flowId" placeholder="选择流程" style="width: 100%" data-testid="ro-flow">
        <el-option v-for="f in availableFlows" :key="f.id" :value="f.id" :label="optionLabel(f)" />
      </el-select>
    </div>
    <div v-else-if="loading" class="ro-loading">正在取这些源的生效流程…</div>

    <div v-if="result" class="ro-result" data-testid="ro-result">
      <p>已成功下发 <strong>{{ result.sent }}</strong> 个源。</p>
      <p v-if="result.skipped.length" class="ro-skipped" data-testid="ro-skipped">
        跳过 {{ result.skipped.length }} 个没有关联这条流程的源：{{ result.skipped.join('、') }}
      </p>
      <div v-if="result.failed.length" class="ro-failed">
        <p><strong>{{ result.failed.length }} 个源未发出：</strong></p>
        <ul>
          <li v-for="(f, i) in result.failed" :key="i">{{ f.ids.join('、') }} — {{ f.error }}</li>
        </ul>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('close')">关闭</el-button>
      <el-button v-if="availableFlows.length" type="primary" :disabled="!flowId || running" :loading="running" data-testid="ro-submit" @click="run">{{ title ? '发送' : '立即运行' }}</el-button>
    </template>
  </el-dialog>
  <SourceParamModal ref="paramModalRef" :callback="sendWithParams" />
</template>

<style scoped>
.ro-summary { font-size: 13px; color: var(--rc-text); margin: 0 0 8px; }
.ro-error { color: #dc2626; font-size: 12px; }
.ro-body { margin-bottom: 8px; }
.ro-label { display: block; font-size: 12px; color: var(--rc-text-2); margin-bottom: 4px; }
.ro-loading { color: var(--rc-muted); font-size: 12px; }
.ro-result { margin-top: 12px; font-size: 12px; }
.ro-failed { color: #dc2626; }
.ro-skipped { color: var(--rc-muted); }
.ro-failed ul { margin: 4px 0 0; padding-left: 18px; }
</style>
