<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, type Source } from '@/api'
import StatusTag from '@/components/StatusTag.vue'

// 源间流程同步弹窗（0716）：把源头已保存的流程批量覆盖到同网站勾选的源。
// 勾选 + 危险确认按钮合一（沿用 0710 C3"把选择题降为确认题"的精神，但保留勾选能力）；
// 已单独调整过流程（detached）的源默认不勾，需手动勾选才会被覆盖。
const props = defineProps<{
  open: boolean
  siteId: string
  fromSource: Source
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const siblings = ref<Source[]>([])
const checked = ref<Set<string>>(new Set())
const loading = ref(false)
const loadError = ref(false)
const syncing = ref(false)

watch(
  () => [props.open, props.siteId, props.fromSource.sourceId] as const,
  async ([open, siteId, fromSourceId], _previous, onCleanup) => {
    if (!open) return
    let active = true
    onCleanup(() => { active = false })
    siblings.value = []
    checked.value = new Set()
    loadError.value = false
    loading.value = true
    try {
      const list = await siteApi.siteSources(siteId)
      if (!active) return
      siblings.value = list.filter((s) => s.sourceId !== fromSourceId)
      checked.value = new Set(siblings.value.filter((s) => !s.detached).map((s) => s.sourceId))
    } catch (error) {
      if (!active) return
      loadError.value = true
      ElMessage.error(`加载源列表失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (active) loading.value = false
    }
  },
  { immediate: true },
)

const allChecked = computed(() => siblings.value.length > 0 && checked.value.size === siblings.value.length)

function toggleAll() {
  checked.value = allChecked.value ? new Set() : new Set(siblings.value.map((s) => s.sourceId))
}

function toggle(sourceId: string) {
  const next = new Set(checked.value)
  if (next.has(sourceId)) next.delete(sourceId)
  else next.add(sourceId)
  checked.value = next
}

function close(value: boolean) {
  emit('update:open', value)
}

async function confirmSync() {
  if (!checked.value.size || syncing.value) return
  syncing.value = true
  try {
    const res = await siteApi.siteSyncFlow(props.siteId, props.fromSource.sourceId, [...checked.value])
    if (!res.ok) {
      ElMessage.error(res.message || '同步失败')
      return
    }
    ElMessage.success(res.message || `已同步到 ${checked.value.size} 个源`)
    close(false)
  } catch (error) {
    ElMessage.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="同步流程到其他源"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <p class="ssd-tip">将「{{ fromSource.name }}」已保存的流程<strong>整条覆盖</strong>到勾选的源，被覆盖源的原有流程不可恢复。</p>
    <div v-if="loading" class="ssd-empty">加载源列表…</div>
    <div v-else-if="loadError" class="ssd-empty">源列表加载失败，请关闭后重试。</div>
    <div v-else-if="!siblings.length" class="ssd-empty">该网站下没有其他源。</div>
    <template v-else>
      <label class="ssd-row ssd-head">
        <input data-testid="sync-toggle-all" type="checkbox" :checked="allChecked" @change="toggleAll">
        <span>全选（共 {{ siblings.length }} 个）</span>
      </label>
      <div class="ssd-list">
        <label v-for="s in siblings" :key="s.sourceId" class="ssd-row" data-testid="sync-row">
          <input type="checkbox" :checked="checked.has(s.sourceId)" @change="toggle(s.sourceId)">
          <div class="ssd-text">
            <div class="ssd-name-line">
              <span class="ssd-name">{{ s.name }}</span>
              <StatusTag v-if="s.detached" text="已单独调整" tone="warn" :show-icon="false" />
            </div>
            <div class="ssd-id">{{ s.sourceId }}</div>
          </div>
          <span class="ssd-url">{{ s.url }}</span>
        </label>
      </div>
    </template>
    <template #footer>
      <button class="rc-btn" type="button" @click="close(false)">取消</button>
      <button
        data-testid="sync-confirm"
        class="rc-btn danger"
        type="button"
        :disabled="!checked.size || syncing"
        @click="confirmSync"
      >
        覆盖 {{ checked.size }} 个源的流程
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ssd-tip { margin: 0 0 10px; color: #b45309; font-size: 12px; }
.ssd-empty { padding: 24px 0; color: var(--rc-faint); font-size: 12px; text-align: center; }
.ssd-list { max-height: 320px; overflow-y: auto; border: 1px solid var(--rc-border); border-radius: 8px; }
.ssd-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; color: var(--rc-text); cursor: pointer; }
.ssd-list .ssd-row + .ssd-row { border-top: 1px solid var(--rc-border-soft); }
.ssd-head { padding: 4px 10px 8px; color: var(--rc-text-2); }
.ssd-text { display: flex; flex-direction: column; min-width: 0; }
.ssd-name-line { display: flex; align-items: center; gap: 6px; }
.ssd-name { font-weight: 600; }
.ssd-id { font-size: 10px; color: var(--rc-faint); font-family: monospace; margin-top: 1px; }
.ssd-url { margin-left: auto; color: var(--rc-faint); font-size: 11px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-btn { height: 30px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.rc-btn.danger { margin-left: 8px; border-color: #f87171; background: #dc2626; color: #fff; }
.rc-btn.danger:hover:not(:disabled) { background: #b91c1c; }
.rc-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
