<script setup lang="ts">
// 保存配置前的影响范围确认（0824-00 §2.2）。
// 维度是**源**不是节点（2026-08-28 拍板）：同一个源的流程里可能几个节点共用一份配置，
// 按节点计会把影响说得比实际大；用户要判断的是"会动到哪些源"。
//
// 数据来自 source/sourcePaged 的 configId 过滤——2026-08-28 实测确认它是**穿透流程**的：
// 既匹配以该配置为首节点配置的源，也匹配把它当子步骤引用的源
// （配置 1400774 → 337 个源；子步骤配置 1400765 → 8378 个源，源 430016501 两边都在）。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '@/api'

const props = defineProps<{ open: boolean; configId: string; configName?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; confirm: []; saveAsNew: [] }>()

const PREVIEW_SIZE = 5
const loading = ref(false)
const total = ref(0)
const preview = ref<Source[]>([])
const failed = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  try {
    const res = await sourceApi.sourcePaged({ configId: props.configId, page: 1, size: PREVIEW_SIZE })
    total.value = res.total
    preview.value = res.list
  } catch (e) {
    // 查不到影响范围不代表可以当作"没有影响"，这里如实标记失败，由模板改说法
    failed.value = true
    ElMessage.error(`查询使用该配置的源失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    loading.value = false
  }
}
watch(() => props.open, (v) => { if (v) void load() })

function close() {
  emit('update:open', false)
}
function onConfirm() {
  emit('confirm')
  close()
}
function onSaveAsNew() {
  emit('saveAsNew')
  close()
}
</script>

<template>
  <el-dialog :model-value="open" title="保存配置" width="620px" :close-on-click-modal="false" @update:model-value="close">
    <div v-loading="loading">
      <div class="ssc-head" :class="{ warn: total > 1 }">
        <template v-if="failed">⚠️ 影响范围查询失败，无法确认这份配置被哪些源使用</template>
        <template v-else-if="total > 1">⚠️ 该配置正在被 {{ total }} 个源使用</template>
        <template v-else-if="total === 1">该配置目前只有当前源在用</template>
        <template v-else>未查到使用该配置的源</template>
      </div>
      <div class="ssc-sub">
        配置 #{{ configId }}<template v-if="configName">「{{ configName }}」</template>。
        <template v-if="total > 1">继续保存会更新所有使用该配置的源，请确认影响范围。</template>
      </div>

      <table v-if="preview.length" class="ssc-table">
        <thead><tr><th>源 ID</th><th>源名称</th><th>引用方式</th></tr></thead>
        <tbody>
          <tr v-for="s in preview" :key="s.sourceId">
            <td class="ssc-id">{{ s.sourceId }}</td>
            <td>{{ s.name }}</td>
            <td>{{ String(s.configId ?? '') === configId ? '首节点配置' : '子步骤引用' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="total > preview.length" class="ssc-more">另有 {{ total - preview.length }} 个源</div>
    </div>

    <template #footer>
      <div class="ssc-actions">
        <button class="ssc-act danger" type="button" @click="onConfirm">
          <span class="ssc-act-title">{{ total > 1 ? `保存并影响 ${total} 个源` : '保存配置' }}</span>
          <span class="ssc-act-desc">更新当前配置，所有使用它的源立即生效</span>
        </button>
        <button class="ssc-act" type="button" @click="onSaveAsNew">
          <span class="ssc-act-title">另存为新配置</span>
          <span class="ssc-act-desc">为当前节点创建独立配置，不影响其他源</span>
        </button>
      </div>
      <div class="ssc-cancel"><button class="rc-btn" type="button" @click="close">取消</button></div>
    </template>
  </el-dialog>
</template>

<style scoped>
.ssc-head { font-size: 13px; font-weight: 700; color: var(--rc-text); margin-bottom: 4px; }
.ssc-head.warn { color: var(--rc-warn); }
.ssc-sub { font-size: 11px; color: var(--rc-text-2); line-height: 1.6; margin-bottom: 10px; }
.ssc-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.ssc-table th { text-align: left; color: var(--rc-muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--rc-border-soft); }
.ssc-table td { padding: 6px 8px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text); }
.ssc-id { font-variant-numeric: tabular-nums; color: var(--rc-text-2); }
.ssc-more { font-size: 11px; color: var(--rc-primary-ink); margin-top: 8px; }
.ssc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ssc-act { display: flex; flex-direction: column; gap: 3px; text-align: left; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; padding: 10px 12px; cursor: pointer; }
.ssc-act:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.ssc-act.danger { border-color: #fecaca; background: #fef2f2; }
.ssc-act.danger:hover { border-color: var(--rc-danger, #ef4444); }
.ssc-act-title { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.ssc-act-desc { font-size: 10px; color: var(--rc-text-2); line-height: 1.5; }
.ssc-cancel { display: flex; justify-content: center; margin-top: 10px; }
</style>
