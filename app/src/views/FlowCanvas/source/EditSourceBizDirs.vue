<script setup lang="ts">
import { ref, watch } from 'vue'
import { addSourcesToBizDir, bizMembership, loadDirChildren, removeSourcesFromBizDirs } from '@/api/sourceDirs'

const props = defineProps<{ sourceId: string; disabled?: boolean }>()
const loading = ref(false)
const error = ref('')
const original = ref<string[]>([])
const selected = ref<string[]>([])
interface TreeOption { id: string; name: string; children?: TreeOption[] }
const options = ref<TreeOption[]>([])

async function loadTree(parentId = ''): Promise<TreeOption[]> {
  const children = await loadDirChildren('biz', parentId)
  return Promise.all(children.map(async (node) => {
    const nested = await loadTree(node.id)
    return { id: node.id, name: node.name, ...(nested.length ? { children: nested } : {}) }
  }))
}
async function initialize() {
  loading.value = true
  error.value = ''
  try {
    const [membership, tree] = await Promise.all([bizMembership(), loadTree()])
    original.value = [...(membership.get(props.sourceId) ?? [])]
    selected.value = [...original.value]
    options.value = tree
  } catch (e) {
    error.value = `业务目录读取失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loading.value = false
  }
}
watch(() => props.sourceId, () => { void initialize() }, { immediate: true })

async function save() {
  if (loading.value || error.value) return false
  const added = selected.value.filter((id) => !original.value.includes(id))
  const removed = original.value.filter((id) => !selected.value.includes(id))
  if (!added.length && !removed.length) return false
  try {
    for (const id of added) await addSourcesToBizDir(id, [props.sourceId])
    if (removed.length) await removeSourcesFromBizDirs(removed, [props.sourceId])
    original.value = [...selected.value]
    return true
  } catch (e) {
    throw new Error(`业务目录调整可能部分生效：${e instanceof Error ? e.message : String(e)}`)
  }
}
defineExpose({ save })
</script>

<template>
  <el-tree-select v-model="selected" :data="options" :props="{ label: 'name', value: 'id', children: 'children' }"
    multiple show-checkbox check-strictly filterable collapse-tags collapse-tags-tooltip node-key="id"
    :loading="loading" :disabled="disabled || loading || !!error" placeholder="选择业务目录，可多选"
    aria-label="业务目录" data-testid="edit-source-biz-select" style="width: 100%" />
  <div v-if="error" class="biz-error" role="alert">{{ error }}，本次保存不修改目录。 <button type="button" class="rc-btn" @click="initialize">重试</button></div>
</template>

<style scoped>
.biz-error { margin-top: 6px; color: var(--rc-error); font-size: 12px; }
</style>
