<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { runnerManagementApi as api, type CodeRepository, type GenerationReferenceFile, type RepositoryTree } from '@/api/runnerManagement'

const props = defineProps<{ modelValue: GenerationReferenceFile[]; repositories: CodeRepository[]; defaultRepositoryId?: string; disabled?: boolean; inputLocations?: { id: string; label: string; directory: string }[]; locationHint?: string }>()
const emit = defineEmits<{ 'update:modelValue': [files: GenerationReferenceFile[]] }>()
const open = ref(false), repoId = ref(''), loading = ref(false), error = ref(''), keyword = ref('')
const files = ref<RepositoryTree['items']>([]), draft = ref<GenerationReferenceFile[]>([])
let request = 0
type TreeNode = { path: string; label: string; disabled: boolean; children: TreeNode[] }
const nodes = computed(() => {
  const roots: TreeNode[] = [], index = new Map<string, TreeNode>()
  for (const file of files.value) {
    const parts = file.path.split('/')
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('/')
      if (index.has(path)) continue
      const directory = depth !== parts.length || file.kind === 'directory'
      const node: TreeNode = { path, label: `${directory ? '📁' : '📄'} ${parts[depth - 1]}`, disabled: directory || !file.selectable, children: [] }
      index.set(path, node)
      const parent = index.get(parts.slice(0, depth - 1).join('/'))
      if (parent) parent.children.push(node); else roots.push(node)
    }
  }
  const filter = (items: TreeNode[]): TreeNode[] => items.flatMap(item => {
    const children = filter(item.children)
    return !keyword.value || item.path.toLowerCase().includes(keyword.value.toLowerCase()) || children.length ? [{ ...item, children }] : []
  })
  return filter(roots)
})
async function load() {
  const current = ++request
  loading.value = true; error.value = ''; files.value = []
  try { const result = await api.codeRepositoryTree(repoId.value); if (current === request) files.value = result.items }
  catch (e) { if (current === request) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (current === request) loading.value = false }
}
function show() {
  draft.value = props.modelValue.map(item => ({ repositoryId: item.repositoryId, path: item.path }))
  repoId.value = props.defaultRepositoryId || props.repositories[0]?.repoId || ''
  keyword.value = ''; open.value = true
  if (repoId.value) void load()
}
function check(node: TreeNode, state: { checkedKeys: (string | number)[] }) {
  if (node.disabled) return
  error.value = ''
  const checked = state.checkedKeys.includes(node.path)
  draft.value = draft.value.filter(item => item.repositoryId !== repoId.value || item.path !== node.path)
  if (checked) draft.value.push({ repositoryId: repoId.value, path: node.path })
}
function save() {
  if (draft.value.length > 20) { error.value = '最多选择 20 个参考文件'; return }
  if (new Set(draft.value.map(item => item.path.split('/').at(-1)!.toLowerCase())).size !== draft.value.length) { error.value = '输入目录不能包含同名参考文件，请修改文件名后选择'; return }
  emit('update:modelValue', draft.value); open.value = false
}
function targetPath(directory: string, path: string) {
  return directory + (directory.includes('\\') || /^[A-Za-z]:/.test(directory) ? '\\' : '/') + path.split('/').at(-1)
}
onBeforeUnmount(() => { request++ })
</script>

<template>
  <section class="reference-files" aria-label="输入参考文件">
    <div><b>输入参考文件</b><el-button link type="primary" :disabled="disabled || !repositories.length" data-testid="select-generation-references" @click="show">选择 Git 文件</el-button></div>
    <small v-pre>执行前自动同步到智能体的输入目录，提示词可用 {{input_file_dir}}/demo.py 引用。</small>
    <div v-for="(file, index) in modelValue" :key="file.repositoryId + ':' + file.path" class="reference-file"><div class="reference-file-paths"><span>{{ repositories.find(repo => repo.repoId === file.repositoryId)?.name || file.repositoryId }} / {{ file.path }}</span><small v-if="locationHint">{{ locationHint }}</small><small v-for="location in inputLocations" :key="location.id" class="reference-target" data-testid="reference-input-location"><span>{{ location.label }} · 同步位置：</span><code>{{ targetPath(location.directory, file.path) }}</code></small></div><el-button link :disabled="disabled" :aria-label="`移除参考文件 ${file.path}`" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">移除</el-button></div>
    <el-dialog v-model="open" title="选择输入参考文件" width="min(850px, 94vw)" append-to-body destroy-on-close>
      <div class="reference-toolbar"><el-select v-model="repoId" aria-label="参考文件仓库" :disabled="loading" @change="load"><el-option v-for="repo in repositories" :key="repo.repoId" :value="repo.repoId" :label="repo.name" /></el-select><el-input v-model="keyword" placeholder="搜索文件路径" aria-label="搜索参考文件" clearable /><el-button :disabled="loading || !repoId" @click="load">刷新</el-button></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <div v-loading="loading" class="reference-tree"><el-tree :key="repoId + ':' + request" :data="nodes" node-key="path" show-checkbox check-strictly :default-checked-keys="draft.filter(file => file.repositoryId === repoId).map(file => file.path)" @check="check" /></div>
      <p>已选择 {{ draft.length }} 个文件。提交任务时记录 Git 版本；文件按原文件名放入 input 目录。</p>
      <template #footer><el-button @click="open = false">取消</el-button><el-button type="primary" :disabled="loading || !!error" data-testid="confirm-generation-references" @click="save">确定</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.reference-files { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.reference-files b { font-size: 12px; margin-right: 12px; }
.reference-files small { color: var(--el-text-color-secondary); font-size: 12px; }
.reference-file { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.reference-file-paths { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
.reference-target code { font-size: 11px; color: var(--el-text-color-primary); }
.reference-toolbar { display: flex; gap: 8px; }
.reference-tree { height: min(360px, 45vh); overflow: auto; margin-top: 12px; }
</style>
