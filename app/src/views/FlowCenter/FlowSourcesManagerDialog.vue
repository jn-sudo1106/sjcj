<script setup lang="ts">
// 「关联到源」：一条流程的关联源都在这里管（2026-10-21，方案 设计稿/设计方案/1021-流程中心_使用源数排序与关联源管理_设计方案_2026-10-21.md）。
// 「已关联」= FlowSourcesDialog（解绑 / 更换 / 全部解绑更换），「添加关联」= FlowSourcePickerDialog；两者都以 embedded 嵌进来。
// 删除流程不再处理源：有源时只提示，跳到这里的「已关联」页签。
import { ref, watch } from 'vue'
import type { FlowRecord } from '@/api'
import FlowSourcesDialog from './FlowSourcesDialog.vue'
import FlowSourcePickerDialog from './FlowSourcePickerDialog.vue'

export type ManageTab = 'bound' | 'add'

const props = defineProps<{
  flow: FlowRecord | null
  tab: ManageTab
  /** 「添加关联」里已选的源（v-model:picked） */
  picked: string[]
  submitting?: boolean
  progress?: string
  refreshTick?: number
}>()
const emit = defineEmits<{
  'update:tab': [ManageTab]
  'update:picked': [string[]]
  confirm: []
  changed: []
  delete: []
  close: []
}>()

// 页签上的「已关联（N）」：先用列表里的 sourceCnt 顶着，「已关联」页签加载完换成实时数
const boundCount = ref<number | null>(null)
watch(() => props.flow?.id, () => { boundCount.value = props.flow?.sourceCnt ?? null }, { immediate: true })
</script>

<template>
  <el-dialog
    :model-value="!!flow"
    :title="flow ? `关联到源 · ${flow.name}` : '关联到源'"
    width="980px"
    top="6vh"
    style="max-width: calc(100vw - 32px)"
    destroy-on-close
    data-testid="flow-sources-manager"
    @close="emit('close')"
  >
    <div class="fsm-tabs" role="tablist" aria-label="关联源">
      <button type="button" role="tab" :aria-selected="tab === 'bound'" :class="{ on: tab === 'bound' }" data-testid="fsm-tab-bound" @click="emit('update:tab', 'bound')">
        已关联<span v-if="boundCount != null" class="fsm-count">（{{ boundCount }}）</span>
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'add'" :class="{ on: tab === 'add' }" data-testid="fsm-tab-add" @click="emit('update:tab', 'add')">添加关联</button>
    </div>
    <FlowSourcesDialog
      v-if="tab === 'bound'"
      embedded
      :flow="flow"
      :refresh-tick="refreshTick"
      @count="boundCount = $event"
      @changed="emit('changed')"
      @delete="emit('delete')"
      @close="emit('close')"
    />
    <FlowSourcePickerDialog
      v-else
      embedded
      :flow="flow"
      :model-value="picked"
      :submitting="submitting"
      :progress="progress"
      @update:model-value="emit('update:picked', $event)"
      @confirm="emit('confirm')"
      @close="emit('close')"
    />
  </el-dialog>
</template>

<style scoped>
.fsm-tabs { display: inline-flex; gap: 4px; padding: 3px; margin-bottom: 12px; background: #eef2f7; border-radius: 8px; }
.fsm-tabs button { border: 0; background: transparent; padding: 5px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; }
.fsm-tabs button.on { background: #fff; color: var(--rc-text); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
.fsm-count { font-weight: 400; color: var(--rc-faint); }
</style>
