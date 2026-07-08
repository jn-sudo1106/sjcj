<script setup lang="ts">
// 网站统一流程同步对话框（0707 优化·Phase4·A+C 混合）：子源多选（默认全选，已脱离的默认不勾并标注），
// 确认后整条流程覆盖所选子源（不做节点级 diff 合并，首期口径），走危险端点二次确认。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { siteApi, type Source } from '../../api'

const props = defineProps<{ siteId: string }>()
const emit = defineEmits<{ close: [] }>()

const children = ref<Source[]>([])
const checked = reactive<Record<string, boolean>>({})
const loading = ref(true)
onMounted(async () => {
  children.value = await siteApi.siteSources(props.siteId)
  children.value.forEach((c) => {
    checked[c.sourceId] = !c.detached
  })
  loading.value = false
})
const checkedCount = computed(() => Object.values(checked).filter(Boolean).length)

async function confirmSync() {
  const ids = children.value.filter((c) => checked[c.sourceId]).map((c) => c.sourceId)
  if (!ids.length) {
    ElMessage.warning('请至少勾选一个子源')
    return
  }
  try {
    await ElMessageBox.confirm(`将用网站统一流程覆盖所选 ${ids.length} 个子源的整条流程，是否继续？`, '同步到子源（高危）', {
      type: 'warning', confirmButtonText: '确认覆盖', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const res = await siteApi.siteSyncFlow(props.siteId, ids)
  ElMessage.success(res?.message || `已同步到 ${ids.length} 个子源（演示）`)
  emit('close')
}
function skip() {
  emit('close')
}
</script>

<template>
  <div class="ssd-backdrop" @click.self="skip">
    <div class="ssd-card">
      <div class="ssd-title">同步到子源</div>
      <div class="ssd-hint">网站统一流程已保存。勾选要用这份流程整体覆盖的子源——已单独调整过的子源默认不勾选。</div>
      <div v-if="loading" class="ssd-empty">加载中…</div>
      <div v-else class="ssd-list">
        <label v-for="c in children" :key="c.sourceId" class="ssd-row">
          <input v-model="checked[c.sourceId]" type="checkbox" />
          <span class="ssd-name">{{ c.name }}</span>
          <span v-if="c.detached" class="ssd-detached">已单独调整</span>
        </label>
        <div v-if="!children.length" class="ssd-empty">该网站暂无子源</div>
      </div>
      <div class="ssd-actions">
        <button class="rc-btn" type="button" @click="skip">跳过（仅保存模板）</button>
        <button class="rc-btn primary" type="button" @click="confirmSync">同步到已选（{{ checkedCount }}）</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ssd-backdrop { position: fixed; inset: 0; z-index: 92; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); padding: 24px; }
.ssd-card { width: min(440px, calc(100vw - 48px)); max-height: 80vh; display: flex; flex-direction: column; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); padding: 18px 20px; }
.ssd-title { font-size: 14px; font-weight: 800; color: var(--rc-text); margin-bottom: 6px; }
.ssd-hint { font-size: 11px; color: var(--rc-muted); line-height: 1.6; margin-bottom: 12px; }
.ssd-list { flex: 1; overflow-y: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; padding: 4px; }
.ssd-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--rc-text-2); }
.ssd-row:hover { background: #f8fafc; }
.ssd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssd-detached { flex: none; font-size: 10px; color: var(--rc-warn); background: var(--rc-warn-bg); border-radius: 5px; padding: 1px 6px; }
.ssd-empty { padding: 16px; text-align: center; font-size: 12px; color: var(--rc-faint); }
.ssd-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--rc-border-soft); }
</style>
