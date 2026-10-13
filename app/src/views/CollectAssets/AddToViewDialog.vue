<script setup lang="ts">
// 源列表勾选源后「加入视图」（2026-10-12「我的视图」）：把选中的源加进某个手选视图，或新建一个手选视图再加入。
// 条件视图（系统目录「另存为视图」存的）没有手选清单，不在候选里。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { SOURCE_VIEW_NAME_MAX, sourceViewApi, type SourceView } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { emptyManualViewState } from '@/views/FlowCanvas/result/sourceListViewState'

const props = defineProps<{ modelValue: boolean; sourceIds: string[] }>()
const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  /** 加入成功（带视图名），父级可据此提示 / 清掉勾选 */
  added: [viewName: string, count: number]
}>()
const NEW = '__new__'
const auth = useAuthStore()
const userId = computed(() => (auth.info?.id != null ? String(auth.info.id) : ''))
const views = ref<SourceView[]>([])
const target = ref('')
const newName = ref('')
const busy = ref(false)
const error = ref('')

watch(() => props.modelValue, async (open) => {
  if (!open) return
  error.value = ''
  newName.value = ''
  try {
    views.value = (await sourceViewApi.list(userId.value)).filter((v) => v.state.scopeIds)
  } catch (e) {
    views.value = []
    error.value = e instanceof Error ? e.message : String(e)
  }
  target.value = views.value[0]?.viewId ?? NEW
})

async function submit() {
  error.value = ''
  busy.value = true
  try {
    if (target.value === NEW) {
      const name = newName.value.trim()
      const created = await sourceViewApi.add(userId.value, { viewName: name, state: { ...emptyManualViewState(), scopeIds: [...new Set(props.sourceIds)] } })
      emit('added', created.viewName, props.sourceIds.length)
    } else {
      const view = views.value.find((v) => v.viewId === target.value)
      if (!view) throw new Error('视图不存在，请重新选择')
      const merged = [...new Set([...(view.state.scopeIds ?? []), ...props.sourceIds])]
      await sourceViewApi.update(userId.value, { viewId: view.viewId, revision: view.revision, state: { ...view.state, scopeIds: merged } })
      emit('added', view.viewName, merged.length - (view.state.scopeIds?.length ?? 0))
    }
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    if (!(e instanceof Error)) ElMessage.error(error.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="加入视图" width="420px" style="max-width: calc(100vw - 32px)" append-to-body data-testid="add-to-view-dialog" @update:model-value="emit('update:modelValue', $event)">
    <p class="atv-line">把选中的 {{ sourceIds.length }} 个源加入：</p>
    <el-select v-model="target" style="width: 100%" data-testid="add-to-view-target">
      <el-option v-for="v in views" :key="v.viewId" :value="v.viewId" :label="`${v.viewName}（${v.state.scopeIds?.length ?? 0} 个源）`" />
      <el-option :value="NEW" label="＋ 新建视图" />
    </el-select>
    <el-input v-if="target === NEW" v-model="newName" :maxlength="SOURCE_VIEW_NAME_MAX" placeholder="新视图名称，例如：广发 · 重点源" class="atv-name" data-testid="add-to-view-name" @keyup.enter="submit" />
    <p class="atv-hint">视图里已有的源会自动去重；视图只有你自己能看到。</p>
    <p v-if="error" class="atv-error" data-testid="add-to-view-error">{{ error }}</p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="busy" :disabled="!sourceIds.length" data-testid="add-to-view-submit" @click="submit">加入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.atv-line { margin: 0 0 8px; font-size: 13px; color: var(--rc-text-2); }
.atv-name { margin-top: 10px; }
.atv-hint { margin: 10px 0 0; font-size: 12px; color: var(--rc-faint); }
.atv-error { margin: 8px 0 0; font-size: 12px; color: var(--el-color-danger); }
</style>
