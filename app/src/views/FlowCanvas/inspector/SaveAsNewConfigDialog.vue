<script setup lang="ts">
// 另存为新配置（0824-00 §2.2 的「另存为新配置并仅当前节点使用」）。
//
// 为什么必须先要一个**唯一**的名字：`config/modify/updateConfig` 不带 configId 就是新增，
// 但它的响应不回传新 configId（config_api.md §二），只能按配置名回查。
// 2026-08-28 实测踩过坑——拿原名（重名）去建，后端自动加了 `_copy` 后缀建成 `test2_copy`，
// 而回查按原名只找得到旧那条，于是把节点绑回了**原配置**，用户以为在改副本、其实在改原件。
//
// 旧平台的「复制配置」（config/copyAll）是 confirm → 复制 → 提示"请刷新后查询最新ID"，
// 它自己也拿不到新 ID；我们必须拿到才能绑节点，所以走"唯一名 + 精确回查"这条。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi } from '@/api'

const props = defineProps<{ open: boolean; sourceName?: string; sourceConfigId?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; confirm: [string] }>()

const name = ref('')
const checking = ref(false)
const taken = ref(false)

watch(() => props.open, (v) => {
  if (!v) return
  // 预填「原名_copy」：跟后端遇到重名时的行为一致，用户多半直接沿用
  name.value = props.sourceName ? `${props.sourceName}_copy` : ''
  taken.value = false
})

const trimmed = computed(() => name.value.trim())
const invalid = computed(() => !trimmed.value || taken.value)

async function checkName() {
  if (!trimmed.value) {
    taken.value = false
    return
  }
  checking.value = true
  try {
    taken.value = await configApi.configNameExists(trimmed.value, props.sourceConfigId)
  } catch {
    // 查不动就不拦，交给创建后的回查兜底（回查不到会告警且不绑定）
    taken.value = false
  } finally {
    checking.value = false
  }
}
watch(trimmed, () => { void checkName() })

function close() {
  emit('update:open', false)
}

async function onConfirm() {
  if (!trimmed.value) {
    ElMessage.warning('请填写新配置名称')
    return
  }
  await checkName()
  if (taken.value) {
    ElMessage.warning('配置名称已被占用，请换一个')
    return
  }
  emit('confirm', trimmed.value)
  close()
}
</script>

<template>
  <el-dialog :model-value="open" title="另存为新配置" width="520px" :close-on-click-modal="false" @update:model-value="close">
    <div class="sanc-field">
      <label>新配置名称</label>
      <input v-model="name" class="sanc-input" :class="{ bad: taken }" placeholder="给新配置起个名字" aria-label="新配置名称" />
      <div v-if="taken" class="sanc-err">已有同名配置，请换一个——重名会让新建出来的配置认不回来。</div>
      <div v-else class="sanc-help">
        用当前表单值另建一份配置，只绑到本节点，<strong>不改动原配置 #{{ sourceConfigId || '—' }}</strong>。
        新建后流程会进入未保存状态，记得再点「保存流程」。
      </div>
    </div>
    <template #footer>
      <button class="rc-btn" type="button" @click="close">取消</button>
      <button class="rc-btn primary" type="button" :disabled="invalid || checking" @click="onConfirm">
        {{ checking ? '检查中…' : '创建并绑定' }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 全局 .rc-field 是工具栏用的横向 pill（tokens.css:143），这里不复用它，直接自带类名 */
.sanc-field { display: block; }
.sanc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.sanc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.sanc-input.bad { border-color: var(--rc-warn); }
.sanc-err { color: var(--rc-warn); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.sanc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.6; margin-top: 6px; }
</style>
