<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, type ElTree } from 'element-plus'
import { Document, Folder, Refresh } from '@element-plus/icons-vue'
import { runnerManagementApi, type DirectoryDelivery, type DirectoryDeliveryItem, type DirectoryDeliveryPreview, type DirectoryRunnerBinding } from '@/api/runnerManagement'

const props = defineProps<{ binding: DirectoryRunnerBinding; runnerName: string }>()
const emit = defineEmits<{ close: []; delivered: [delivery: DirectoryDelivery] }>()
const preview = ref<DirectoryDeliveryPreview | null>(null), loading = ref(false), submitting = ref(false), error = ref('')
const mode = ref<'changes' | 'selected' | 'all'>('changes')
const tree = ref<InstanceType<typeof ElTree>>(), checked = ref<string[]>([])
let request = 0, active = true
const input = () => ({ bindingType: props.binding.bindingType, ownerId: props.binding.ownerId, runnerId: props.binding.runnerId })
interface TreeItem extends DirectoryDeliveryItem { label: string; children: TreeItem[] }
const nodes = computed(() => {
  const entries = new Map<string, TreeItem>((preview.value?.items || []).map(item => [item.path, { ...item, label: item.path.split('/').at(-1) || item.path, children: [] }]))
  const roots: TreeItem[] = []
  for (const item of entries.values()) {
    const parent = entries.get(item.path.slice(0, item.path.lastIndexOf('/')))
    if (parent && parent !== item) parent.children.push(item)
    else roots.push(item)
  }
  const sort = (list: TreeItem[]) => { list.sort((a, b) => a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'folder' ? -1 : 1); list.forEach(item => sort(item.children)) }
  sort(roots)
  if (mode.value !== 'changes') return roots
  const changedOnly = (list: TreeItem[]): TreeItem[] => list.flatMap(item => {
    const children = changedOnly(item.children)
    // Preserve ancestor folders for navigation, but omit unchanged branches.
    return item.status !== 'unchanged' || children.length ? [{ ...item, children }] : []
  })
  return changedOnly(roots)
})
const leaves = computed(() => (preview.value?.items || []).filter(item => item.kind === 'file'
  || !preview.value?.items.some(child => child.path.startsWith(item.path + '/'))))
const changes = computed(() => leaves.value.filter(item => item.status !== 'unchanged').map(item => item.path))
const chosenFiles = computed(() => (preview.value?.items || []).filter(item => item.kind === 'file' && checked.value.includes(item.path)))
const transferFiles = computed(() => chosenFiles.value.filter(item => item.status !== 'unchanged'))
const sizeLabel = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
const statusLabel = (status: DirectoryDeliveryItem['status']) => ({ added: '新增', modified: '已修改', unchanged: '未变化' })[status]
async function setSelection(value: typeof mode.value) {
  const previous = checked.value
  mode.value = value
  await nextTick()
  const keys = value === 'all' ? leaves.value.map(item => item.path) : value === 'changes' ? changes.value : previous
  tree.value?.setCheckedKeys(keys)
  readChecked(keys)
}
function changeMode(value: unknown) {
  if (value === 'changes' || value === 'selected' || value === 'all') void setSelection(value)
}
function onCheck() {
  if (mode.value === 'all') mode.value = 'selected'
  readChecked()
}
function readChecked(fallback: string[] = []) {
  const keys = tree.value?.getCheckedKeys(false).map(String).sort() || fallback
  checked.value = mode.value === 'changes' ? keys.filter(key => changes.value.includes(key)) : keys
}
async function load() {
  const seq = ++request
  loading.value = true; error.value = ''; checked.value = []; preview.value = null
  try {
    const data = await runnerManagementApi.directoryDeliveryPreview(input())
    if (!active || seq !== request) return
    preview.value = data
    await setSelection('changes')
  } catch (e) { if (active && seq === request) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (active && seq === request) loading.value = false }
}
async function submit() {
  if (loading.value || submitting.value || error.value || !preview.value || !checked.value.length) return
  submitting.value = true; error.value = ''
  const data = preview.value
  try {
    const delivery = await runnerManagementApi.deliverDirectoryBinding({ ...input(), revision: data.revision,
      scope: mode.value === 'all' ? 'all' : 'selected', paths: mode.value === 'all' ? undefined : checked.value,
      baselineDigest: data.baselineDigest })
    if (active) {
      emit('delivered', delivery)
      if (delivery.unchanged) ElMessage.info('文件 hash 未变化，无需下发')
      else ElMessage.success(`下发任务已提交${delivery.transferredFileCount === undefined ? '' : `，传输 ${delivery.transferredFileCount} 个变更文件`}，等待 Runner 完成`)
    }
  } catch (e) { if (active) error.value = e instanceof Error ? e.message : String(e) }
  finally { submitting.value = false }
}
onMounted(() => { void load() })
onUnmounted(() => { active = false; ++request })
</script>

<template>
  <el-dialog :model-value="true" title="选择下发范围" width="900px" top="7vh" class="delivery-dialog" :close-on-click-modal="false" :close-on-press-escape="!submitting" :show-close="!submitting" @close="emit('close')">
    <div class="dd-target"><span>运行机器</span><strong :title="runnerName">{{ runnerName }}</strong><span>目标目录</span><code>{{ preview?.targetPath || binding.directoryTemplate }}</code></div>
    <div class="dd-toolbar">
      <el-radio-group :model-value="mode" :disabled="loading || submitting || !preview" aria-label="下发范围" data-testid="delivery-scope" @update:model-value="changeMode">
        <el-radio-button value="changes">变更文件</el-radio-button><el-radio-button value="selected">指定范围</el-radio-button><el-radio-button value="all">全部代码</el-radio-button>
      </el-radio-group>
      <el-button :icon="Refresh" circle :disabled="loading || submitting" aria-label="刷新下发范围" @click="load" />
    </div>
    <p class="dd-help">按文件 SHA-256 比较，未变化的文件自动跳过。{{ mode === 'all' ? '同步整个目录，并清理此配置原来托管、现在已移除的文件。' : '勾选文件夹可选择其中全部文件；未选中的文件和文件夹会保留。' }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon data-testid="delivery-error" />
    <div v-loading="loading" class="dd-tree" data-testid="delivery-tree">
      <el-tree v-if="nodes.length" ref="tree" :data="nodes" node-key="path" show-checkbox :props="{ label: 'label', children: 'children', disabled: () => submitting }" :expand-on-click-node="false" @check="onCheck">
        <template #default="{ data }"><div class="dd-node" :data-path="data.path"><el-icon><Folder v-if="data.kind === 'folder'" /><Document v-else /></el-icon><span class="dd-name" :title="data.path">{{ data.label }}</span><code v-if="data.kind === 'file'" class="dd-hash" :title="data.sha256 ? `SHA-256：${data.sha256}${data.previousSha256 ? `\n上次：${data.previousSha256}` : ''}` : '暂无文件摘要'" data-testid="delivery-file-hash">{{ data.sha256?.slice(0, 12) || '—' }}</code><el-tag v-if="mode !== 'changes' || data.status !== 'unchanged'" size="small" :type="data.status === 'added' ? 'success' : data.status === 'modified' ? 'warning' : 'info'">{{ statusLabel(data.status) }}</el-tag><span class="dd-size">{{ data.kind === 'file' ? sizeLabel(data.size) : '文件夹' }}</span></div></template>
      </el-tree>
      <el-empty v-else-if="!loading && !error && preview?.items.length && mode === 'changes'" description="暂无变更文件，无需下发" :image-size="64" />
      <el-empty v-else-if="!loading && !error" description="部署配置尚未关联代码，请先配置文件或文件夹" :image-size="64" />
    </div>
    <template #footer><div class="dd-footer"><span v-if="preview" data-testid="delivery-count">需传 {{ transferFiles.length }} 个文件 · {{ sizeLabel(transferFiles.reduce((size, item) => size + item.size, 0)) }} · 跳过 {{ chosenFiles.length - transferFiles.length }} 个未变文件<small v-if="!changes.length && mode === 'changes'">文件 hash 未变化，无需下发</small></span><span class="dd-spacer" /><el-button :disabled="submitting" data-testid="delivery-cancel" @click="emit('close')">取消</el-button><el-button type="primary" :loading="submitting" :disabled="loading || !!error || !checked.length" data-testid="delivery-submit" @click="submit">{{ mode === 'all' ? '同步整个目录' : '下发所选' }}</el-button></div></template>
  </el-dialog>
</template>

<style scoped>
.dd-hash { width:104px; flex:none; font-size:11px; color:var(--rc-muted); }
.dd-target { display:grid; grid-template-columns:70px minmax(0,1fr); gap:6px 10px; margin-bottom:16px; font-size:13px; }.dd-target>span { color:var(--rc-muted); }.dd-target strong { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.dd-target code { overflow-wrap:anywhere; }
.dd-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }.dd-help { margin:12px 0; font-size:12px; color:var(--rc-muted); }.dd-tree { height:clamp(150px,36vh,360px); overflow:auto; margin-top:12px; border:1px solid var(--el-border-color-light); border-radius:6px; padding:8px; }.dd-tree :deep(.el-tree-node__content) { height:34px; }.dd-node { display:flex; align-items:center; gap:8px; width:100%; min-width:0; padding-right:12px; font-size:13px; }.dd-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.dd-size { width:80px; text-align:right; font-size:12px; color:var(--rc-muted); }.dd-footer { display:flex; align-items:center; gap:10px; text-align:left; }.dd-footer>span:first-child { font-size:13px; }.dd-footer small { display:block; margin-top:4px; color:var(--rc-muted); }.dd-spacer { flex:1; }
</style>
<style>
.delivery-dialog { max-width:calc(100vw - 32px); }.delivery-dialog .el-dialog__body { padding-top:10px; }
</style>
