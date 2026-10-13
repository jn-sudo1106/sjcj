<script setup lang="ts">
// 源列表勾选源后「加入视图目录」（2026-10-13 目录版）：选视图 → 选目录（含根目录），把选中的源加进去；
// 也可以当场新建一个视图（加在它的根目录）。视图只有自己能看到。
import { computed, ref, watch } from 'vue'
import { SOURCE_VIEW_NAME_MAX, sourceViewApi, type SourceView } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { ROOT_ID, addSources, emptyTree, pathText } from './viewDirs'

const props = defineProps<{ modelValue: boolean; sourceIds: string[] }>()
const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  /** 加入成功（视图名 / 目录路径 / 新加入个数），父级提示 */
  added: [viewName: string, place: string, count: number]
}>()
const NEW = '__new__'
const auth = useAuthStore()
const userId = computed(() => (auth.info?.id != null ? String(auth.info.id) : ''))
const views = ref<SourceView[]>([])
const viewId = ref('')
const dirId = ref(ROOT_ID)
const newName = ref('')
const busy = ref(false)
const error = ref('')

const view = computed(() => views.value.find((v) => v.viewId === viewId.value))
const dirOptions = computed(() => {
  const t = view.value?.tree
  if (!t) return [{ id: ROOT_ID, label: '根目录' }]
  return [{ id: ROOT_ID, label: '根目录' }, ...t.dirs.map((d) => ({ id: d.id, label: pathText(t, d.id) })).sort((a, b) => a.label.localeCompare(b.label, 'zh'))]
})

watch(() => props.modelValue, async (open) => {
  if (!open) return
  error.value = ''
  newName.value = ''
  dirId.value = ROOT_ID
  try {
    views.value = await sourceViewApi.list(userId.value)
  } catch (e) {
    views.value = []
    error.value = e instanceof Error ? e.message : String(e)
  }
  viewId.value = views.value.find((v) => v.isDefault)?.viewId ?? views.value[0]?.viewId ?? NEW
})
watch(viewId, () => { dirId.value = ROOT_ID })

async function submit() {
  error.value = ''
  busy.value = true
  try {
    if (viewId.value === NEW) {
      const created = await sourceViewApi.add(userId.value, { viewName: newName.value, tree: addSources(emptyTree(), ROOT_ID, props.sourceIds) })
      emit('added', created.viewName, '根目录', new Set(props.sourceIds).size)
    } else {
      const v = view.value
      if (!v) throw new Error('视图不存在，请重新选择')
      const before = new Set(v.tree.dirs.find((d) => d.id === dirId.value)?.sources ?? (dirId.value === ROOT_ID ? v.tree.root.sources : []))
      const tree = addSources(v.tree, dirId.value, props.sourceIds)
      await sourceViewApi.update(userId.value, { viewId: v.viewId, revision: v.revision, tree })
      emit('added', v.viewName, pathText(v.tree, dirId.value), props.sourceIds.filter((id) => !before.has(id)).length)
    }
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="加入视图目录" width="440px" style="max-width: calc(100vw - 32px)" append-to-body data-testid="add-to-view-dialog" @update:model-value="emit('update:modelValue', $event)">
    <p class="atv-line">把选中的 {{ sourceIds.length }} 个源加入：</p>
    <div class="atv-row">
      <span class="atv-label">视图</span>
      <el-select v-model="viewId" style="flex: 1" data-testid="add-to-view-target">
        <el-option v-for="v in views" :key="v.viewId" :value="v.viewId" :label="v.viewName" />
        <el-option :value="NEW" label="＋ 新建视图" />
      </el-select>
    </div>
    <div v-if="viewId === NEW" class="atv-row">
      <span class="atv-label">名称</span>
      <el-input v-model="newName" :maxlength="SOURCE_VIEW_NAME_MAX" placeholder="新视图名称，例如：广发" data-testid="add-to-view-name" @keyup.enter="submit" />
    </div>
    <div v-else class="atv-row">
      <span class="atv-label">目录</span>
      <el-select v-model="dirId" filterable style="flex: 1" data-testid="add-to-view-dir">
        <el-option v-for="d in dirOptions" :key="d.id" :value="d.id" :label="d.label" />
      </el-select>
    </div>
    <p class="atv-hint">已在这个目录里的源会自动去重；视图只有你自己能看到。新建视图时源放在它的根目录，之后可以再建目录整理。</p>
    <p v-if="error" class="atv-error" data-testid="add-to-view-error">{{ error }}</p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="busy" :disabled="!sourceIds.length" data-testid="add-to-view-submit" @click="submit">加入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.atv-line { margin: 0 0 10px; font-size: 13px; color: var(--rc-text-2); }
.atv-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.atv-label { width: 32px; flex: none; color: var(--rc-text-2); font-size: 13px; }
.atv-hint { margin: 4px 0 0; font-size: 12px; color: var(--rc-faint); line-height: 1.6; }
.atv-error { margin: 8px 0 0; font-size: 12px; color: var(--el-color-danger); }
</style>
