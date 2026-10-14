<script setup lang="ts">
// 源列表勾选源后「加入视图目录」（2026-10-13 目录版）：选视图 → 选目录，把选中的源加进去。
// 10-14 起没有根目录：视图还没有目录、或者想放进新目录时，当场新建一个一级目录；新建视图时同样要给目录起名。视图只有自己能看到。
import { computed, ref, watch } from 'vue'
import { SOURCE_VIEW_NAME_MAX, sourceViewApi, type SourceView } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { VIEW_DIR_NAME_MAX, addDir, addSources, emptyTree, pathText, type ViewTree } from './viewDirs'

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
const tree = ref<ViewTree>(emptyTree())
const treeLoading = ref(false)
const dirId = ref(NEW)
const newName = ref('')
const newDirName = ref('')
const busy = ref(false)
const error = ref('')

const view = computed(() => views.value.find((v) => v.viewId === viewId.value))
const dirOptions = computed(() => tree.value.dirs
  .map((d) => ({ id: d.id, label: pathText(tree.value, d.id) }))
  .sort((a, b) => a.label.localeCompare(b.label, 'zh')))

watch(() => props.modelValue, async (open) => {
  if (!open) return
  viewId.value = '' // 重开时也重读目录
  error.value = ''
  newName.value = ''
  newDirName.value = ''
  try {
    views.value = await sourceViewApi.list(userId.value)
  } catch (e) {
    views.value = []
    error.value = e instanceof Error ? e.message : String(e)
  }
  viewId.value = views.value.find((v) => v.isDefault)?.viewId ?? views.value[0]?.viewId ?? NEW
})
watch(viewId, async (id) => {
  tree.value = emptyTree()
  dirId.value = NEW
  const v = view.value
  if (!v) return
  treeLoading.value = true
  try {
    const loaded = await sourceViewApi.loadTree(userId.value, v)
    if (viewId.value !== id) return
    tree.value = loaded
    dirId.value = dirOptions.value[0]?.id ?? NEW
  } catch (e) {
    if (viewId.value === id) error.value = `目录加载失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    if (viewId.value === id) treeLoading.value = false
  }
})

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const creatingDir = viewId.value === NEW || dirId.value === NEW
    const base = viewId.value === NEW ? emptyTree() : tree.value
    let target = dirId.value
    let next = base
    if (creatingDir) {
      const r = addDir(base, null, newDirName.value)
      next = r.tree
      target = r.id
    }
    const before = new Set(next.dirs.find((d) => d.id === target)?.sources ?? [])
    next = addSources(next, target, props.sourceIds)
    const place = pathText(next, target)
    const count = props.sourceIds.filter((id) => !before.has(id)).length
    if (viewId.value === NEW) {
      const created = await sourceViewApi.add(userId.value, { viewName: newName.value, tree: next })
      emit('added', created.viewName, place, count)
    } else {
      const v = view.value
      if (!v) throw new Error('视图不存在，请重新选择')
      await sourceViewApi.saveTree(userId.value, v, tree.value, next)
      emit('added', v.viewName, place, count)
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
    <div v-if="viewId !== NEW" class="atv-row">
      <span class="atv-label">目录</span>
      <el-select v-model="dirId" filterable :loading="treeLoading" style="flex: 1" data-testid="add-to-view-dir">
        <el-option v-for="d in dirOptions" :key="d.id" :value="d.id" :label="d.label" />
        <el-option :value="NEW" label="＋ 新建目录" />
      </el-select>
    </div>
    <div v-if="viewId === NEW || dirId === NEW" class="atv-row">
      <span class="atv-label">{{ viewId === NEW ? '目录' : '' }}</span>
      <el-input v-model="newDirName" :maxlength="VIEW_DIR_NAME_MAX" placeholder="新目录名称（一级目录）" data-testid="add-to-view-dir-name" @keyup.enter="submit" />
    </div>
    <p class="atv-hint">已在这个目录里的源会自动去重；视图只有你自己能看到。</p>
    <p v-if="error" class="atv-error" data-testid="add-to-view-error">{{ error }}</p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="busy" :disabled="!sourceIds.length || treeLoading" data-testid="add-to-view-submit" @click="submit">加入</el-button>
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
