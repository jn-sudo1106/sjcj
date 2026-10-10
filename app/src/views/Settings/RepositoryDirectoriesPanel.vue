<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type CodeRepositoryDirectoryInput } from '@/api/runnerManagement'

const props = defineProps<{ repo: CodeRepository; types: { code: string | undefined; name: string }[]; selectedId: string; canWrite: boolean }>()
const emit = defineEmits<{ select: [directory: CodeRepositoryDirectory | null] }>()
const rows = ref<CodeRepositoryDirectory[]>([]), loading = ref(false), saving = ref(false), error = ref(''), filter = ref('')
const editingId = ref<string | null>(null)
const form = reactive<CodeRepositoryDirectoryInput>({ name: '', configType: '', configTypeName: '', path: '' })
const selectableTypes = computed(() => props.types.filter(type => !props.repo.configType || type.code === props.repo.configType))
const visible = computed(() => rows.value.filter(row => !filter.value || row.configType === filter.value))
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
let request = 0
async function load() {
  const seq = ++request; loading.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.codeRepositoryDirectories(props.repo.repoId)
    if (seq !== request) return
    rows.value = result
    if (props.selectedId) emit('select', result.find(row => row.directoryId === props.selectedId) || null)
  } catch (e) { if (seq === request) error.value = problem(e) }
  finally { if (seq === request) loading.value = false }
}
watch(() => props.repo, () => { editingId.value = null; filter.value = ''; void load() }, { immediate: true })
function edit(row?: CodeRepositoryDirectory) {
  editingId.value = row?.directoryId || 'new'; error.value = ''
  Object.assign(form, row ? { name: row.name, configType: row.configType, configTypeName: row.configTypeName, path: row.path, status: row.status, revision: row.revision }
    : { name: '', configType: props.repo.configType, configTypeName: props.repo.configTypeName, path: '', status: 'ACTIVE', revision: undefined })
  if (!row && props.repo.configType) selectType(props.repo.configType)
}
function selectType(value: string) {
  const name = selectableTypes.value.find(type => type.code === value)?.name || value
  form.configTypeName = name
  if (editingId.value === 'new') { form.name = name ? `${name}代码` : '通用代码'; form.path = name || 'shared' }
}
async function save() {
  if (!props.canWrite || saving.value) return
  const repoId = props.repo.repoId; saving.value = true; error.value = ''
  try {
    const row = await runnerManagementApi.saveCodeRepositoryDirectory(repoId, { ...form, name: form.name.trim(), path: form.path.trim() }, editingId.value === 'new' ? undefined : editingId.value || undefined)
    if (repoId !== props.repo.repoId) return
    editingId.value = null; await load(); emit('select', row)
  } catch (e) { if (repoId === props.repo.repoId) error.value = problem(e) }
  finally { saving.value = false }
}
async function status(row: CodeRepositoryDirectory, enabled: boolean) {
  saving.value = true; error.value = ''
  try { await runnerManagementApi.saveCodeRepositoryDirectory(row.repoId, { ...row, status: enabled ? 'ACTIVE' : 'DISABLED' }, row.directoryId); await load() }
  catch (e) { error.value = problem(e) }
  finally { saving.value = false }
}
async function remove(row: CodeRepositoryDirectory) {
  try {
    await ElMessageBox.confirm(`移除“${row.name}”的目录配置？仓库文件会保留。已被代码引用的目录请使用停用。`, '移除目录配置', { confirmButtonText: '移除', cancelButtonText: '取消' })
    saving.value = true
    await runnerManagementApi.removeCodeRepositoryDirectory(row.repoId, row.directoryId, row.revision)
    if (props.selectedId === row.directoryId) emit('select', null)
    await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') error.value = problem(e) }
  finally { saving.value = false }
}
</script>

<template>
  <aside class="rd-panel" data-testid="repository-directories">
    <header><b>配置目录</b><el-button size="small" :disabled="loading || saving" aria-label="刷新配置目录" @click="load">刷新</el-button><el-button v-if="canWrite" size="small" type="primary" :disabled="loading || saving || repo.status !== 'ACTIVE'" data-testid="repo-directory-create" @click="edit()">新建</el-button></header>
    <el-select v-model="filter" placeholder="全部节点类型" aria-label="筛选目录节点类型"><el-option value="" label="全部节点类型" /><el-option v-for="type in selectableTypes" :key="type.code" :value="type.code" :label="`[${type.code}] ${type.name}`" /></el-select>
    <p v-if="error" role="alert" class="rd-error">{{ error }}</p>
    <div v-if="editingId" class="rd-editor" data-testid="repo-directory-editor">
      <label>节点类型<el-select v-model="form.configType" data-testid="repo-directory-type" @change="selectType"><el-option value="" label="通用" :disabled="!!repo.configType" /><el-option v-for="type in selectableTypes" :key="type.code" :value="type.code" :label="`[${type.code}] ${type.name}`" /></el-select></label>
      <label>配置名称<el-input v-model="form.name" placeholder="方便节点选择" data-testid="repo-directory-name" /></label>
      <label>仓库内目录<el-input v-model="form.path" :disabled="editingId !== 'new'" placeholder="例如 网页抓取 / 列表代码" data-testid="repo-directory-path" /></label>
      <footer><el-button size="small" :disabled="saving" @click="editingId = null">取消</el-button><el-button type="primary" size="small" :disabled="!form.name.trim() || !form.path.trim()" :loading="saving" data-testid="repo-directory-save" @click="save">保存目录</el-button></footer>
    </div>
    <button class="rd-all" :class="{ selected: !selectedId }" type="button" @click="emit('select', null)">全部仓库文件</button>
    <div class="rd-list" v-loading="loading">
      <div v-for="row in visible" :key="row.directoryId" class="rd-row" :class="{ selected: selectedId === row.directoryId }" :data-testid="`repo-directory-${row.directoryId}`">
        <button type="button" class="rd-title" @click="emit('select', row)"><b>{{ row.name }}</b><span :title="row.path">{{ row.path }}/</span><small>{{ row.configTypeName || '通用' }}{{ row.codeCount != null ? ` · ${row.codeCount} 项节点代码` : '' }}</small></button>
        <div v-if="!row.isDefault && canWrite" class="rd-actions"><el-switch size="small" :model-value="row.status === 'ACTIVE'" :disabled="saving || repo.status !== 'ACTIVE'" @change="(value: string | number | boolean) => status(row, Boolean(value))" /><span>{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</span><el-button link type="primary" :disabled="saving" @click="edit(row)">编辑</el-button><el-button link type="danger" :disabled="saving || !!row.codeCount" @click="remove(row)">移除</el-button></div>
        <small v-else-if="row.isDefault" class="rd-default">沿用仓库默认目录</small>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.rd-panel { width:260px; flex-shrink:0; padding:10px; border:1px solid var(--rc-border); border-radius:6px; background:var(--rc-card); overflow:auto; font-size:12px; }
header, .rd-actions, footer { display:flex; align-items:center; gap:7px; }header { margin-bottom:10px; }header b { flex:1; }header .el-button + .el-button { margin:0; }
.rd-row, .rd-all { margin-top:8px; border:1px solid var(--rc-border); border-radius:6px; }.selected { background:var(--rc-primary-bg); border-color:var(--el-color-primary-light-5); }
.rd-title, .rd-all { display:block; width:100%; padding:9px; color:var(--rc-text); background:none; text-align:left; cursor:pointer; font:inherit; }.rd-title { border:0; }.rd-title > * { display:block; margin-bottom:4px; }.rd-title span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.rd-title small,.rd-default { color:var(--rc-muted); }
.rd-actions { padding:0 9px 8px; }.rd-actions > span { flex:1; color:var(--rc-muted); }.rd-actions .el-button { font-size:12px; margin:0; }.rd-default { display:block; padding:0 9px 9px; }
.rd-editor { padding:8px; margin-top:8px; border:1px solid var(--rc-border); border-radius:6px; }.rd-editor label { display:grid; grid-template-columns:62px minmax(0,1fr); align-items:center; gap:4px; margin-bottom:7px; line-height:18px; font-size:11px; }.rd-editor .el-select { width:100%; }footer { justify-content:flex-end; }
.rd-error { color:var(--rc-error); overflow-wrap:anywhere; }
</style>
