<script setup lang="ts">
// 选源和勾选目标业务目录在同一弹窗完成；父目录只代表自身，不连带写入子级。
import { computed, ref } from 'vue'
import { ElMessage, ElTree, type LoadFunction } from 'element-plus'
import GroupSourcePicker from './GroupSourcePicker.vue'
import { addSourcesToBizDir, dirNode, dirPath, loadDirChildren } from '@/api/sourceDirs'

const props = withDefaults(defineProps<{
  initialSourceIds?: string[]
  initialDirectoryIds?: string[]
}>(), { initialSourceIds: () => [], initialDirectoryIds: () => [] })
const emit = defineEmits<{ close: []; saved: [] }>()
const visible = ref(true)
const treeRef = ref<InstanceType<typeof ElTree>>()
const checkedDirectoryIds = ref([...new Set(props.initialDirectoryIds)])
const loadError = ref('')
const saveError = ref('')
const saving = ref(false)
const expandedKeys = computed(() => {
  const ids = new Set<string>()
  for (const id of props.initialDirectoryIds) {
    for (let parent = dirNode(id)?.parentId; parent; parent = dirNode(parent)?.parentId) ids.add(parent)
  }
  return [...ids]
})
const directoryNames = computed(() => checkedDirectoryIds.value.map((id) => dirPath(id).join(' / ') || id))

const load: LoadFunction = async (node, resolve) => {
  try {
    const list = await loadDirChildren('biz', node.level === 0 ? '' : String(node.data.id))
    loadError.value = ''
    resolve(list)
  } catch (error) {
    loadError.value = `业务目录加载失败：${(error as Error)?.message ?? String(error)}`
    resolve([])
  }
}
function onCheck() {
  checkedDirectoryIds.value = (treeRef.value?.getCheckedKeys() ?? []).map(String)
}
function onVisibleChange(value: boolean) {
  visible.value = value
  if (!value) emit('close')
}
async function save(sourceIds: string[]) {
  if (saving.value || !sourceIds.length || !checkedDirectoryIds.value.length) return
  saving.value = true
  saveError.value = ''
  const ids = [...sourceIds]
  const targets = [...checkedDirectoryIds.value]
  let completed = 0
  try {
    for (const categoryId of targets) {
      await addSourcesToBizDir(categoryId, ids)
      completed++
    }
    ElMessage.success(`已将 ${ids.length} 个源加入 ${targets.length} 个业务目录，已存在的关系自动跳过`)
    emit('saved')
    onVisibleChange(false)
  } catch (error) {
    saveError.value = `${completed ? `已完成 ${completed} 个目录，其余` : ''}加入失败：${(error as Error)?.message ?? String(error)}。可重试，已有关系会自动跳过。`
    if (completed) emit('saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <GroupSourcePicker
    :model-value="visible"
    group-id=""
    pick-mode
    title="添加源到业务目录"
    :initial-source-ids="initialSourceIds"
    :busy="saving"
    @update:model-value="onVisibleChange"
  >
    <template #aside>
      <div class="bdp-heading">目标业务目录 <span>可多选</span></div>
      <div class="bdp-tree" data-testid="biz-dir-picker-tree">
        <el-tree
          ref="treeRef"
          lazy
          show-checkbox
          check-strictly
          check-on-click-node
          :load="load"
          node-key="id"
          :props="{ label: 'name', isLeaf: () => false }"
          :default-checked-keys="initialDirectoryIds"
          :default-expanded-keys="expandedKeys"
          :expand-on-click-node="false"
          @check="onCheck"
        />
      </div>
      <div v-if="loadError" class="bdp-err">{{ loadError }}</div>
      <div class="bdp-hint" data-testid="biz-dir-picker-targets">{{ directoryNames.length ? `已选 ${directoryNames.length} 个目录：${directoryNames.join('、')}` : '请勾选目标业务目录' }}</div>
      <div class="bdp-hint">勾选父目录只加入该目录；一个源可加入多个目录，已有关系自动跳过。</div>
      <div v-if="saveError" class="bdp-err" role="alert" data-testid="biz-dir-picker-error">{{ saveError }}</div>
    </template>
    <template #submit="{ ids }">
      <el-button type="primary" :loading="saving" :disabled="saving || !ids.length || !checkedDirectoryIds.length" data-testid="biz-dir-picker-ok" @click="save(ids)">加入 {{ checkedDirectoryIds.length }} 个目录</el-button>
    </template>
  </GroupSourcePicker>
</template>

<style scoped>
.bdp-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; color: var(--rc-text); font-weight: 600; }
.bdp-heading span { color: var(--rc-muted); font-size: 12px; font-weight: 400; }
.bdp-tree { max-height: calc(100vh - 340px); overflow: auto; }
.bdp-err { margin-top: 8px; color: var(--rc-error); font-size: 12px; overflow-wrap: anywhere; }
.bdp-hint { margin-top: 10px; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
@media (max-width: 760px) { .bdp-tree { max-height: 140px; } }
</style>
