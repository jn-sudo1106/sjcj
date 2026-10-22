<script setup lang="ts">
/**
 * 入组确认（1021-03，方案 §2.3）：勾选的源里有自己流程的，列出来，默认全勾 = 解除这些流程并加入；
 * 取消勾选 = 这个源不加入（流程不动）。不提供「保留流程又入组」。组还没配流程时黄色提示，但不拦。
 * 这里只负责选，执行在调用方（groupJoin.joinGroup）。
 */
import { computed, ref, watch } from 'vue'
import { flowCenterApi, sourceGroupApi } from '@/api'
import type { OwnFlowRow } from './groupJoin'

const props = defineProps<{
  groupId: string
  groupName: string
  /** 有自有流程的源 */
  rows: OwnFlowRow[]
  /** 没有自有流程、直接加入的源数 */
  directCount: number
  busy?: boolean
}>()
const emit = defineEmits<{
  /** excludeIds：取消勾选、不加入的源 */
  confirm: [excludeIds: string[]]
  back: []
  close: []
}>()

const picked = ref(new Set(props.rows.map((r) => r.sourceId)))
watch(() => props.rows, (rows) => { picked.value = new Set(rows.map((r) => r.sourceId)) })
function toggle(id: string, on: boolean) {
  const next = new Set(picked.value)
  on ? next.add(id) : next.delete(id)
  picked.value = next
}
const joinCount = computed(() => picked.value.size + props.directCount)

// 组流程与流程名：只为展示，拉不到就显示「流程 #ID」
const groupFlowIds = ref<string[] | null>(null)
const groupDefault = ref('')
const names = ref(new Map<string, string>())
async function loadMeta() {
  try {
    const group = await sourceGroupApi.detail(props.groupId)
    groupFlowIds.value = group?.flowIds ?? []
    groupDefault.value = group?.defaultFlowId ?? ''
  } catch {
    groupFlowIds.value = null
  }
  const ids = [...new Set([...(groupFlowIds.value ?? []), ...props.rows.flatMap((r) => r.ownFlowIds)])]
  const found = new Map<string, string>()
  await Promise.all(ids.map(async (id) => {
    const flow = await flowCenterApi.detail(id).catch(() => null)
    if (flow?.name) found.set(id, flow.name)
  }))
  names.value = found
}
void loadMeta()
const flowLabel = (id: string) => `${names.value.get(id) ?? '流程'} · ${id}`
</script>

<template>
  <el-dialog :model-value="true" :title="`加入来源组「${groupName}」`" width="620px" style="max-width: calc(100vw - 32px)" append-to-body @close="emit('close')">
    <p class="gjc-lead">
      以下 <strong>{{ rows.length }}</strong> 个源已经关联了自己的流程。来源组内的源统一使用组的流程，加入后这些流程关联会被解除。取消勾选的源不加入来源组，流程不变。
    </p>
    <el-alert
      v-if="groupFlowIds && !groupFlowIds.length"
      title="该来源组还没有配置流程，加入后这些源将没有可运行的流程"
      type="warning"
      :closable="false"
      show-icon
      data-testid="gjc-group-no-flow"
    />
    <div class="gjc-list" data-testid="gjc-list">
      <label v-for="row in rows" :key="row.sourceId" class="gjc-row" data-testid="gjc-row">
        <input type="checkbox" :checked="picked.has(row.sourceId)" :aria-label="`加入 ${row.name || row.sourceId}`" data-testid="gjc-pick" @change="toggle(row.sourceId, ($event.target as HTMLInputElement).checked)">
        <span class="gjc-src"><b>{{ row.name || row.sourceId }}</b><small>{{ row.sourceId }}</small></span>
        <span class="gjc-flows">自有流程：{{ row.ownFlowIds.map((id) => flowLabel(id) + (id === row.ownDefaultFlowId ? '（默认）' : '')).join('、') }}</span>
      </label>
    </div>
    <p v-if="groupFlowIds?.length" class="gjc-note">组流程：{{ groupFlowIds.map((id) => flowLabel(id) + (id === groupDefault ? '（默认）' : '')).join('、') }}</p>
    <p v-if="directCount" class="gjc-note" data-testid="gjc-direct">其余 {{ directCount }} 个源没有自有流程，将直接加入。</p>
    <template #footer>
      <el-button @click="emit('back')">上一步</el-button>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="busy" :disabled="!joinCount" data-testid="gjc-confirm" @click="emit('confirm', rows.filter((r) => !picked.has(r.sourceId)).map((r) => r.sourceId))">
        {{ picked.size ? '解除并加入' : '加入' }}（{{ joinCount }} 个源）
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.gjc-lead { margin: 0 0 10px; font-size: 13px; color: var(--rc-text); line-height: 1.6; }
.gjc-list { display: flex; flex-direction: column; max-height: min(320px, 45vh); margin: 10px 0; overflow-y: auto; border: 1px solid var(--rc-border-soft); border-radius: 6px; }
.gjc-row { display: grid; grid-template-columns: 20px minmax(140px, 200px) 1fr; gap: 8px; align-items: start; padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); cursor: pointer; }
.gjc-row:last-child { border-bottom: 0; }
.gjc-src { display: flex; flex-direction: column; min-width: 0; }
.gjc-src b { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.gjc-src small { color: var(--rc-faint); font-size: 11px; }
.gjc-flows { color: var(--rc-text-2); font-size: 12px; line-height: 1.5; word-break: break-all; }
.gjc-note { margin: 4px 0 0; color: var(--rc-text-2); font-size: 12px; }
</style>
