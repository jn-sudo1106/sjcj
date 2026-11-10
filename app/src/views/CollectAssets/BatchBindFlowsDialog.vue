<script setup lang="ts">
import { computed, ref } from 'vue'
import { workflowBindingApi, type FlowRecord } from '@/api'
import { useAuthStore } from '@/stores/auth'
import FlowPickerDialog from './FlowPickerDialog.vue'

const props = defineProps<{ sourceIds: string[] }>()
const emit = defineEmits<{ close: []; saved: [sourceIds: string[]] }>()
const auth = useAuthStore()
// 固定本次勾选范围，列表刷新或翻页不改变提交对象。
const targets = [...new Set(props.sourceIds)]
const flows = ref<FlowRecord[]>([])
const defaultFlowId = ref('preserve')
const pickerOpen = ref(false)
const saving = ref(false)
const finished = ref(false)
const succeeded = ref<string[]>([])
const unchanged = ref<string[]>([])
const failed = ref<{ sourceId: string; error: string }[]>([])
const canSubmit = computed(() => auth.role === 'admin' && targets.length > 0 && flows.value.length > 0 && !saving.value && !finished.value)

function onPicked(selected: FlowRecord[]) {
  flows.value = selected
  if (!selected.some((flow) => flow.id === defaultFlowId.value)) defaultFlowId.value = 'preserve'
  pickerOpen.value = false
}

async function save() {
  if (!canSubmit.value) return
  saving.value = true
  const flowIds = flows.value.map((flow) => flow.id)
  const preferredDefault = defaultFlowId.value === 'preserve' ? '' : defaultFlowId.value
  const queue = [...targets]
  try {
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let sourceId = queue.shift(); sourceId !== undefined; sourceId = queue.shift()) {
        try {
          let alreadyBound = false
          // 复用单源契约：读取最新绑定、合并，再带并发快照提交，避免覆盖其他流程。
          await workflowBindingApi.save(sourceId, (view) => {
            if (view.sourceGroupId) throw new Error(`属于来源组 #${view.sourceGroupId}，请到来源组配置流程`)
            const previousDefault = view.ownDefaultFlowId && view.ownFlowIds.includes(view.ownDefaultFlowId) ? view.ownDefaultFlowId : ''
            const nextDefault = preferredDefault || previousDefault || flowIds[0]!
            if (flowIds.every((id) => view.ownFlowIds.includes(id)) && nextDefault === view.ownDefaultFlowId) {
              alreadyBound = true
              return null
            }
            return {
              flowIds: [...new Set([...view.ownFlowIds, ...flowIds])],
              defaultFlowId: nextDefault,
            }
          })
          succeeded.value.push(sourceId)
          if (alreadyBound) unchanged.value.push(sourceId)
        } catch (error) {
          failed.value.push({ sourceId, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }))
    finished.value = true
    emit('saved', [...succeeded.value])
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="true"
    title="批量绑定流程"
    width="560px"
    style="max-width: calc(100vw - 32px)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="emit('close')"
  >
    <div class="bbf-body">
      <p>将为勾选的 <strong>{{ targets.length }}</strong> 个源添加所选流程，保留已有绑定，已绑定的流程不重复添加。流程由这些源共用，修改流程会影响使用它的源。</p>
      <p class="bbf-hint">来源组内的源统一使用组流程，本次跳过并列出原因。</p>
      <div class="bbf-flows" data-testid="batch-bind-selected-flows">
        <el-tag v-for="flow in flows" :key="flow.id">{{ flow.name || '流程' }} · {{ flow.id }}</el-tag>
        <span v-if="!flows.length" class="bbf-hint">尚未选择流程</span>
      </div>
      <el-button :disabled="saving || finished" data-testid="batch-bind-pick" @click="pickerOpen = true">选择流程</el-button>
      <label class="bbf-default">
        默认流程
        <el-select v-model="defaultFlowId" :disabled="saving || finished || !flows.length" data-testid="batch-bind-default">
          <el-option value="preserve" label="保留各源默认流程" />
          <el-option v-for="flow in flows" :key="flow.id" :value="flow.id" :label="`统一设为：${flow.name || flow.id}`" />
        </el-select>
      </label>
      <p class="bbf-hint">保留默认时，原来没有可用默认流程的源将使用第一条所选流程。</p>
      <p v-if="saving" role="status">正在处理 {{ succeeded.length + failed.length }} / {{ targets.length }} 个源…</p>
      <div v-if="finished" role="status" data-testid="batch-bind-result">
        <p>绑定成功 {{ succeeded.length }} 个源，未绑定 {{ failed.length }} 个源。</p>
        <p v-if="unchanged.length">其中 {{ unchanged.length }} 个源已绑定所选流程且默认流程无需调整，已跳过写入。</p>
        <ul v-if="failed.length" class="bbf-errors">
          <li v-for="item in failed" :key="item.sourceId">{{ item.sourceId }}：{{ item.error }}</li>
        </ul>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="emit('close')">{{ finished ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!finished" type="primary" :disabled="!canSubmit" :loading="saving" data-testid="batch-bind-submit" @click="save">确认绑定</el-button>
    </template>
    <FlowPickerDialog v-if="pickerOpen" :selected="flows.map((flow) => flow.id)" :site-flow-counts="{}" hide-site-usage @close="pickerOpen = false" @confirm="onPicked" />
  </el-dialog>
</template>

<style scoped>
.bbf-body { max-height: calc(100vh - 240px); overflow-y: auto; font-size: 13px; color: var(--rc-text); }
.bbf-body p { margin: 0 0 12px; }
.bbf-hint { color: var(--rc-text-2); font-size: 12px; }
.bbf-flows { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.bbf-default { display: flex; flex-direction: column; gap: 6px; margin: 16px 0 8px; }
.bbf-errors { color: var(--el-color-danger); padding-left: 20px; overflow-wrap: anywhere; }
</style>
