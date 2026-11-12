<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Document, Plus, Refresh, ArrowLeft, Link, Delete } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { configApi } from '@/api'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryFileMetadata, type DirectoryBindingType, type DeploymentConfiguration, type DeploymentSourceNode, type DirectoryMappingNode, type RepositoryTree, type RuntimeConfiguration, type SiteCodeVersion } from '@/api/runnerManagement'
import DeploymentNodePicker from './DeploymentNodePicker.vue'
import DeploymentConfigurationList from './DeploymentConfigurationList.vue'
import DeploymentConfigDrawer from './DeploymentConfigDrawer.vue'
import { descendants, directoryBindingOptions, directoryTemplatePresets, queueDirectoryTemplatePresets, websiteDirectoryTemplatePresets, directoryTypeOf, moveTarget, sourceTree, targetPath, targetTree, withDirectoryType, type DirectoryType, type SourceTreeNode } from './directoryLayout'

const route = useRoute(), router = useRouter(), auth = useAuthStore()
const configDetails = ref<InstanceType<typeof DeploymentConfigDrawer>>()
const canWrite = computed(() => auth.role === 'admin')
const catalog = ref<SiteCodeVersion[]>([]), repositories = ref<CodeRepository[]>([]), configurations = ref<DeploymentConfiguration[]>([])
const repoId = ref(''), layout = ref<DeploymentConfiguration | null>(null)
const saved = ref(''), selectedId = ref(''), source = ref<SourceTreeNode | null>(null), repository = ref<RepositoryTree | null>(null)
const keyword = ref(''), loading = ref(false), treeLoading = ref(false), busy = ref(false), error = ref(''), treeError = ref('')
const fileMetadata = ref<CodeRepositoryFileMetadata | null>(null), fileMetadataLoading = ref(false), fileMetadataError = ref('')
const targetTreeRef = ref<{ $el: HTMLElement; setCurrentKey: (key: string | null) => void }>()
const environment = ref<'test' | 'prd'>('test'), preview = ref(false)
const nodePickerOpen = ref(false), nodePickerError = ref('')
const runtimes = ref<RuntimeConfiguration[] | null>(null), bindingError = ref(''), listFailed = ref(false)
const deletingId = ref('')
let loadId = 0, treeId = 0, fileMetadataId = 0, initialized = false
const codes = computed(() => [...new Map(catalog.value.map(row => [row.codeId, row])).values()])
const configs = computed(() => [...new Set(codes.value.map(row => row.configId))])
const queues = computed(() => [...new Set(codes.value.map(row => row.queueName))])
const websites = computed(() => [...new Set(codes.value.map(row => row.siteHost).filter(Boolean))])
const bindingType = computed(() => layout.value?.pathStyle || 'custom')
const templateHelp = '快捷格式帮助填写路径，最终以根目录格式为准。支持 {configId}、{queue}、{website}；这些是路径变量，与部署配置 ID 无关。'
const dirty = computed(() => layout.value !== null && JSON.stringify(layout.value) !== saved.value)
const needsSave = computed(() => layout.value !== null && (!layout.value.deploymentId || dirty.value))
const selected = computed(() => layout.value?.nodes.find(node => node.id === selectedId.value))
const targetNodes = computed(() => targetTree(layout.value?.nodes || []))
const sourceNodes = computed(() => sourceTree(repository.value, keyword.value))
const folders = computed(() => layout.value?.nodes.filter(node => node.kind === 'folder' && !descendants(layout.value!.nodes, selectedId.value).has(node.id)) || [])
const selectedPath = computed(() => layout.value && selected.value ? targetPath(layout.value.nodes, selected.value.id) : '')
const destinationPath = computed(() => {
  if (!layout.value || !selected.value) return ''
  const id = selected.value.kind === 'folder' ? selected.value.id : selected.value.parentId
  return id ? targetPath(layout.value.nodes, id) : ''
})
const mappingCount = computed(() => layout.value?.nodes.filter(node => node.repoId).length || 0)
const directoryType = computed<DirectoryType>({ get: () => directoryTypeOf(layout.value?.directoryTemplate || '', environment.value), set: type => {
  if (!layout.value) return
  layout.value.directoryTemplate = withDirectoryType(layout.value.directoryTemplate, type, bindingType.value, layout.value.directoryTemplate || 'default')
  if (type !== 'default') environment.value = type
} })
const suggestTemplates = (_query: string, callback: (items: { value: string }[]) => void) => callback(({
  config: directoryTemplatePresets, queue: queueDirectoryTemplatePresets, website: websiteDirectoryTemplatePresets,
  custom: ['default', 'shared/python', 'shared/python/prod', 'shared/python/test'],
}[bindingType.value]).map(value => ({ value })))
const renderedRoot = computed(() => layout.value?.directoryTemplate.replaceAll('{configId}', layout.value.configId).replaceAll('{queue}', layout.value.queueName).replaceAll('{website}', layout.value.siteHost).replaceAll('{environment}', environment.value) || '')
const repoName = (id?: string) => repositories.value.find(repo => repo.repoId === id)?.name || id || ''
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
const fileTime = (value?: string) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replaceAll('/', '-')
}
async function loadFileMetadata() {
  const requestId = ++fileMetadataId, node = source.value, repo = repository.value
  fileMetadata.value = null; fileMetadataError.value = ''; fileMetadataLoading.value = false
  if (!layout.value || !node?.selectable || node.kind !== 'file' || !repo) return
  fileMetadataLoading.value = true
  try {
    const result = await runnerManagementApi.codeRepositoryFileMetadata(repo.repoId, node.path, repo.gitCommit)
    if (requestId === fileMetadataId) fileMetadata.value = result
  } catch (e) { if (requestId === fileMetadataId) fileMetadataError.value = problem(e) }
  finally { if (requestId === fileMetadataId) fileMetadataLoading.value = false }
}
watch([() => source.value?.path, () => source.value?.kind, repoId, () => repository.value?.gitCommit, () => !!layout.value], () => { void loadFileMetadata() })
onBeforeUnmount(() => { ++fileMetadataId })
watch([selectedId, targetNodes], async () => {
  await nextTick()
  const element = [...(targetTreeRef.value?.$el.querySelectorAll<HTMLElement>('.el-tree-node') || [])].find(item => item.dataset.key === selectedId.value)
  element?.querySelector<HTMLElement>('.el-tree-node__content')?.scrollIntoView?.({ block: 'nearest' })
})
async function acceptSwitch() {
  if (!dirty.value) return true
  try { await ElMessageBox.confirm('当前配置尚未保存，切换会放弃这些修改。', '切换部署配置', { confirmButtonText: '放弃并切换', cancelButtonText: '继续编辑' }); return true }
  catch { return false }
}
async function chooseConfiguration(id: string) {
  if (busy.value || loading.value || id === layout.value?.deploymentId || !await acceptSwitch()) return
  const requestId = ++loadId
  loading.value = true; error.value = ''
  try {
    const [result] = await Promise.all([runnerManagementApi.deploymentConfiguration(id), loadEditorResources()])
    if (requestId !== loadId) return
    layout.value = result; saved.value = JSON.stringify(result); selectedId.value = ''; preview.value = false
  } catch (e) { if (requestId === loadId) error.value = problem(e) }
  finally { if (requestId === loadId) loading.value = false }
}
async function newConfiguration() {
  if (busy.value || loading.value || !await acceptSwitch()) return
  nodePickerError.value = ''; nodePickerOpen.value = true
}
async function backToList() {
  if (busy.value || loading.value || !await acceptSwitch()) return
  layout.value = null; saved.value = ''; error.value = ''; selectedId.value = ''; preview.value = false
  const query = { ...route.query }
  for (const key of ['deploymentId', 'configId', 'codeId', 'queue', 'website', 'directory']) delete query[key]
  await router.replace({ query })
}
async function deleteConfiguration(item: DeploymentConfiguration) {
  if (!canWrite.value || busy.value || loading.value) return
  busy.value = true; deletingId.value = item.deploymentId; error.value = ''
  try {
    try { await ElMessageBox.confirm(`删除部署配置「${item.name}」？仓库代码和机器上已下发的文件会保留。`, '删除部署配置', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) }
    catch { return }
    await runnerManagementApi.deleteDeploymentConfiguration(item.deploymentId, item.revision)
    configurations.value = configurations.value.filter(row => row.deploymentId !== item.deploymentId)
    ElMessage.success('部署配置已删除')
  } catch (e) { error.value = problem(e) }
  finally { busy.value = false; deletingId.value = '' }
}
async function loadEditorResources() {
  const [rows, repos] = await Promise.all([runnerManagementApi.siteCodeCatalog(), runnerManagementApi.codeRepositories()])
  catalog.value = rows; repositories.value = repos
  if (!repoId.value) repoId.value = repos.find(repo => repo.isDefault && repo.status === 'ACTIVE')?.repoId || repos.find(repo => repo.status === 'ACTIVE')?.repoId || ''
}
async function useSourceNode(node: DeploymentSourceNode) {
  if (busy.value) return
  busy.value = true; nodePickerError.value = ''
  try {
    const [config] = await Promise.all([
      configApi.configDetail(node.configId, { backendScope: 'flow' }),
      loadEditorResources(),
    ])
    if (!config || config.configId !== node.configId) throw new Error('节点配置不存在，请在流程中保存配置后重试')
    const relatedCodes = catalog.value.filter(row => row.configId === node.configId)
    const existing = relatedCodes.length ? await runnerManagementApi.directoryLayout(node.configId) : null
    const code = relatedCodes.find(row => row.codeId === existing?.codeId)
    const draft: DeploymentConfiguration = {
      deploymentId: '', name: config.name || node.nodeName, sourceNode: { ...node }, pathStyle: 'config',
      codeId: code && code.queueName === config.topic ? code.codeId : '', configId: node.configId,
      queueName: config.topic || '', siteHost: existing?.siteHost || '',
      directoryTemplate: existing?.directoryTemplate || '{configId}', entryPoint: existing?.entryPoint || '',
      nodes: existing?.nodes || [], revision: '',
    }
    layout.value = draft; saved.value = ''; selectedId.value = ''; preview.value = false; error.value = ''
    nodePickerOpen.value = false
    if (!existing) ElMessage.info('已带入节点配置，该节点尚无已保存代码，可从右侧仓库关联')
  } catch (e) { nodePickerError.value = problem(e) }
  finally { busy.value = false }
}
function chooseStyle(value: unknown) {
  if (!layout.value || typeof value !== 'string' || !directoryBindingOptions.some(item => item.value === value)) return
  layout.value.pathStyle = value as DirectoryBindingType
  const item = layout.value
  if (value === 'config') { if (!item.sourceNode) { item.configId ||= configs.value[0] || ''; item.queueName ||= queues.value[0] || '' }; item.directoryTemplate = '{configId}' }
  else if (value === 'queue') { if (!item.sourceNode) item.queueName ||= queues.value[0] || ''; item.directoryTemplate = '{queue}' }
  else if (value === 'website') { if (!item.sourceNode) item.siteHost ||= websites.value[0] || ''; item.directoryTemplate = '{website}' }
  else item.directoryTemplate = 'default'
}
async function loadRepository() {
  const requestId = ++treeId, id = repoId.value
  source.value = null; repository.value = null; treeError.value = ''
  if (!id) return
  treeLoading.value = true
  try { const result = await runnerManagementApi.codeRepositoryTree(id); if (requestId === treeId) repository.value = result }
  catch (e) { if (requestId === treeId) treeError.value = problem(e) }
  finally { if (requestId === treeId) treeLoading.value = false }
}
watch(repoId, () => { void loadRepository() })
function requestedConfiguration() {
  if (typeof route.query.deploymentId === 'string') return configurations.value.find(item => item.deploymentId === route.query.deploymentId)
  const kind = route.query.website ? 'website' : route.query.directory ? 'custom' : route.query.queue ? 'queue' : 'config'
  const owner = String(route.query.website || route.query.directory || route.query.queue || route.query.configId || '') || codes.value.find(row => row.codeId === route.query.codeId)?.configId
  return configurations.value.find(item => item.legacyType === kind && item.legacyOwner === owner || kind === 'config' && owner && item.configId === owner)
}
async function init(preferredId?: string) {
  const requestId = ++loadId
  loading.value = true; error.value = ''; bindingError.value = ''
  try {
    const [list, bindings] = await Promise.allSettled([runnerManagementApi.deploymentConfigurations(), runnerManagementApi.runtimeConfigurations()])
    if (requestId !== loadId) return
    if (bindings.status === 'fulfilled') runtimes.value = bindings.value
    else { runtimes.value = null; bindingError.value = '绑定机器数加载失败，请刷新列表重试' }
    listFailed.value = list.status === 'rejected'
    if (list.status === 'rejected') throw list.reason
    const items = list.value
    configurations.value = items
    if (preferredId || ['deploymentId', 'configId', 'codeId', 'queue', 'website', 'directory'].some(key => route.query[key])) await loadEditorResources()
    const item = items.find(value => value.deploymentId === preferredId) || requestedConfiguration()
    if (route.query.deploymentId && !item) error.value = '该部署配置不存在，请从列表重新选择'
    layout.value = item ? JSON.parse(JSON.stringify(item)) : null; saved.value = JSON.stringify(layout.value); selectedId.value = ''; preview.value = false
  } catch (e) { error.value = problem(e) }
  finally { loading.value = false; initialized = true }
}
async function refreshLayout() { if (await acceptSwitch()) await init(layout.value?.deploymentId) }
onMounted(() => { void init() })
function openRequestedOwner() { const item = requestedConfiguration(); if (initialized && item && route.query.tab === 'directory-layout') void chooseConfiguration(item.deploymentId) }
onActivated(() => { if (initialized && !loading.value && !layout.value) void init(); else openRequestedOwner() })
watch([() => route.query.deploymentId, () => route.query.configId, () => route.query.codeId, () => route.query.queue, () => route.query.website, () => route.query.directory], openRequestedOwner)

function addFolder() {
  if (!layout.value) return
  const parentId = selected.value?.kind === 'folder' ? selectedId.value : selected.value?.parentId || ''
  let name = '新建文件夹', index = 1
  while (layout.value.nodes.some((node) => node.parentId === parentId && node.name === name)) name = `新建文件夹${index++}`
  const node: DirectoryMappingNode = { id: crypto.randomUUID(), parentId, name, kind: 'folder' }
  layout.value.nodes.push(node); selectedId.value = node.id
}
function selectRoot() { selectedId.value = ''; targetTreeRef.value?.setCurrentKey(null) }
function rename(value: string) {
  if (!layout.value || !selected.value) return
  const oldPath = selectedPath.value
  selected.value.name = value
  const nextPath = selectedPath.value
  if (layout.value.entryPoint === oldPath || layout.value.entryPoint.startsWith(oldPath + '/')) layout.value.entryPoint = nextPath + layout.value.entryPoint.slice(oldPath.length)
}
function move(parentId: string) {
  if (layout.value && !moveTarget(layout.value, selectedId.value, parentId)) ElMessage.warning('无法移入该目录，请检查重名或上下级关系')
}
function drop(dragged: { data: DirectoryMappingNode }, target: { data: DirectoryMappingNode }) {
  if (!layout.value) return
  moveTarget(layout.value, dragged.data.id, target.data.id)
}
function allowDrop(dragged: { data: DirectoryMappingNode }, target: { data: DirectoryMappingNode }, type: string) {
  return type === 'inner' && target.data.kind === 'folder' && !descendants(layout.value!.nodes, dragged.data.id).has(target.data.id)
    && !layout.value!.nodes.some((node) => node.id !== dragged.data.id && node.parentId === target.data.id && node.name.toLowerCase() === dragged.data.name.toLowerCase())
}
function addSource() {
  if (!layout.value || !source.value || !repository.value || !source.value.selectable) return
  const parentId = selected.value?.kind === 'folder' ? selectedId.value : selected.value?.parentId || ''
  if (layout.value.nodes.some((node) => node.parentId === parentId && node.name.toLowerCase() === source.value!.name.toLowerCase())) { ElMessage.warning('目标目录下已有同名项，请先重命名或选择其他目录'); return }
  const node: DirectoryMappingNode = {
    id: crypto.randomUUID(), parentId, name: source.value.name, kind: source.value.kind === 'directory' ? 'folder' : 'file',
    repoId: repoId.value, sourcePath: source.value.path, sourceType: source.value.kind, gitCommit: repository.value.gitCommit,
  }
  layout.value.nodes.push(node); selectedId.value = node.id
}
function replaceSource() {
  if (!selected.value || !source.value || !repository.value) return
  if ((selected.value.kind === 'folder') !== (source.value.kind === 'directory')) { ElMessage.warning('请选择同类型的文件或文件夹'); return }
  Object.assign(selected.value, { repoId: repoId.value, sourcePath: source.value.path, sourceType: source.value.kind, gitCommit: repository.value.gitCommit })
}
async function expandMapping() {
  const node = selected.value, currentLayout = layout.value
  if (!node?.repoId || node.sourceType !== 'directory' || !currentLayout || busy.value) return
  busy.value = true; error.value = ''
  try {
    const tree = await runnerManagementApi.codeRepositoryTree(node.repoId, node.gitCommit)
    const entries = tree.items.filter(item => item.path.startsWith(node.sourcePath + '/'))
    if (currentLayout.nodes.length + entries.length > 200) throw new Error('展开后超过 200 个配置项，请保留整个文件夹映射')
    if (!entries.length || entries.some(item => !item.selectable)) throw new Error('该目录不存在或包含不能下发的文件')
    const indexed = new Map<string, string>([['', node.id]])
    const additions: DirectoryMappingNode[] = []
    for (const item of entries) {
      const relative = item.path.slice(node.sourcePath!.length + 1)
      const parentPath = relative.split('/').slice(0, -1).join('/')
      const parentId = indexed.get(parentPath)
      if (!parentId) throw new Error('仓库目录层级不完整，请刷新仓库后重试')
      const name = relative.split('/').at(-1)!
      if (currentLayout.nodes.some(n => n.parentId === parentId && n.name.toLowerCase() === name.toLowerCase())) throw new Error('此目录已有同名目标，请先调整名称')
      const next: DirectoryMappingNode = { id: crypto.randomUUID(), parentId, name, kind: item.kind === 'directory' ? 'folder' : 'file' }
      if (next.kind === 'file') Object.assign(next, { repoId: node.repoId, sourcePath: item.path, sourceType: 'file', gitCommit: node.gitCommit })
      indexed.set(relative, next.id); additions.push(next)
    }
    currentLayout.nodes.push(...additions)
    delete node.repoId; delete node.sourcePath; delete node.sourceType; delete node.gitCommit
    ElMessage.success('已展开，可分别调整每个文件的名称与目录')
  } catch (e) { error.value = problem(e) }
  finally { busy.value = false }
}
async function remove() {
  if (!layout.value || !selected.value) return
  const ids = descendants(layout.value.nodes, selectedId.value)
  const removedPath = selectedPath.value
  try { await ElMessageBox.confirm(`移除“${selected.value.name}”及其下级映射？仓库中的代码会保留。`, '移除目标', { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }) }
  catch { return }
  if (layout.value.entryPoint === removedPath || layout.value.entryPoint.startsWith(removedPath + '/')) layout.value.entryPoint = ''
  layout.value.nodes = layout.value.nodes.filter((node) => !ids.has(node.id)); selectedId.value = ''
}
async function save() {
  if (!layout.value || busy.value || loading.value || !needsSave.value) return
  if (!layout.value.name.trim()) { ElMessage.warning('请填写配置名称'); return }
  busy.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.saveDeploymentConfiguration(layout.value)
    layout.value = result; saved.value = JSON.stringify(result)
    configurations.value = [...configurations.value.filter(item => item.deploymentId !== result.deploymentId), result]
    ElMessage.success('部署配置已保存，可在机器配置中选择绑定')
  } catch (e) { error.value = problem(e) }
  finally { busy.value = false }
}
const mappings = computed(() => layout.value?.nodes.filter(node => node.repoId).map(node => ({ ...node, target: targetPath(layout.value!.nodes, node.id) })) || [])
</script>

<template>
  <div class="dl-page" data-testid="settings-directory-layout">
    <div v-if="layout" class="dl-toolbar">
      <el-button :icon="ArrowLeft" :disabled="loading || busy" data-testid="deployment-back" @click="backToList">返回列表</el-button>
      <strong class="dl-editor-title">{{ layout.deploymentId ? layout.name : '新建部署' }}</strong>
      <el-button v-if="layout.deploymentId" :icon="Refresh" circle :disabled="loading || busy" aria-label="刷新当前部署配置" @click="refreshLayout" />
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="bindingError && !layout" :title="bindingError" type="warning" :closable="false" show-icon />
    <DeploymentConfigDrawer ref="configDetails" />
    <DeploymentConfigurationList v-show="!layout" :items="configurations" :runtimes="runtimes" :loading="loading || busy" :can-write="canWrite" :failed="listFailed" :deleting-id="deletingId" @open="chooseConfiguration" @create="newConfiguration" @refresh="refreshLayout" @open-config="item => configDetails?.open(item)" @remove="deleteConfiguration" />
    <section v-if="layout" class="dl-configuration" aria-label="部署配置设置" data-testid="layout-settings">
      <div class="dl-identity-fields">
        <label>配置名称<el-input v-model="layout.name" :readonly="!canWrite || preview" :disabled="busy || loading" placeholder="如：新闻列表抓取生产配置" aria-label="配置名称" data-testid="deployment-name" /></label>
        <div class="dl-config-id"><span>部署配置 ID</span><code>{{ layout.deploymentId || '保存后生成' }}</code></div>
      </div>
      <div v-if="layout.sourceNode" class="dl-origin" data-testid="deployment-origin"><span>来源节点</span><strong>{{ layout.sourceNode.flowName }} / {{ layout.sourceNode.nodeName }}</strong><el-button link type="primary" data-testid="deployment-editor-config" @click="configDetails?.open(layout)">configId: {{ layout.sourceNode.configId }}</el-button><span>任务队列：{{ layout.queueName || '未设置' }}</span></div>
      <div v-else-if="layout.configId" class="dl-origin"><span>节点配置</span><el-button link type="primary" data-testid="deployment-editor-config" @click="configDetails?.open(layout)">{{ layout.configId }} · 查看配置与关联源</el-button></div>
      <div class="dl-path-fields">
        <div class="dl-preset-field"><span>快捷格式</span><el-radio-group :model-value="layout.pathStyle" :disabled="!canWrite || preview || busy || loading" class="dl-preset-tags" aria-label="路径快捷格式" data-testid="deployment-style" @update:model-value="chooseStyle"><el-radio-button v-for="item in directoryBindingOptions" :key="item.value" :value="item.value">{{ item.value === 'config' ? '按配置' : item.value === 'queue' ? '按队列' : item.value === 'website' ? '按网站' : '自定义' }}</el-radio-button></el-radio-group></div>
        <label class="dl-type-field">目录类型<el-select v-model="directoryType" :disabled="!canWrite || preview || busy || loading" aria-label="目录类型" data-testid="layout-environment"><el-option label="默认" value="default" /><el-option label="生产" value="prd" /><el-option label="测试" value="test" /></el-select></label>
        <label class="dl-template-field"><span>根目录格式 <el-tooltip :content="templateHelp"><span class="dl-help">?</span></el-tooltip></span><el-autocomplete v-model="layout.directoryTemplate" :fetch-suggestions="suggestTemplates" :debounce="0" :trigger-on-focus="canWrite && !preview" :readonly="!canWrite || preview" :disabled="busy || loading" placeholder="如 {configId}/{queue}/prod 或 shared/python" aria-label="根目录格式" data-testid="layout-root" /></label>
        <label v-if="bindingType === 'config' || layout.directoryTemplate.includes('{configId}')" class="dl-variable-field">节点配置 ID<el-input v-if="layout.sourceNode" :model-value="layout.configId" readonly aria-label="来源节点配置 ID" /><el-select v-else v-model="layout.configId" filterable allow-create :disabled="!canWrite || preview || busy || loading" aria-label="路径节点配置 ID"><el-option v-for="id in configs" :key="id" :value="id" :label="id" /></el-select></label>
        <label v-if="bindingType === 'queue' || layout.directoryTemplate.includes('{queue}')" class="dl-variable-field">队列名称<el-input v-if="layout.sourceNode" :model-value="layout.queueName" readonly placeholder="节点任务未设置队列" aria-label="来源节点任务队列" /><el-select v-else v-model="layout.queueName" filterable allow-create :disabled="!canWrite || preview || busy || loading" aria-label="路径队列名称"><el-option v-for="name in queues" :key="name" :value="name" :label="name" /></el-select></label>
        <label v-if="bindingType === 'website' || layout.directoryTemplate.includes('{website}')" class="dl-variable-field dl-website-field">网站域名<el-select v-model="layout.siteHost" filterable allow-create :disabled="!canWrite || preview || busy || loading" aria-label="路径网站域名"><el-option v-for="name in websites" :key="name" :value="name" :label="name" /></el-select></label>
      </div>
      <div class="dl-path-preview"><el-icon class="folder-icon"><Folder /></el-icon><span>实际目录</span><code data-testid="layout-resolved-root">Runner / {{ renderedRoot || '—' }}</code><small>快捷格式和目录类型用于填写根目录</small></div>
    </section>
    <DeploymentNodePicker v-model="nodePickerOpen" :busy="busy" :error="nodePickerError" @select="useSourceNode" />
    <div v-if="layout" v-loading="loading" class="dl-workspace" :class="{ 'is-preview': preview }">
      <section class="dl-panel dl-target">
        <header><div><strong>目标目录</strong><span>{{ mappingCount }} 项仓库映射 · 选择目录后添加代码</span></div><el-button v-if="canWrite && !preview" :icon="Plus" size="small" :disabled="busy" data-testid="layout-add-folder" @click="addFolder">新建文件夹</el-button></header>
        <div class="dl-tree-scroll" data-testid="layout-target-tree">
          <button type="button" class="dl-tree-root" :class="{ 'is-selected': !selected }" :title="renderedRoot" data-testid="layout-select-root" @click="selectRoot"><el-icon class="folder-icon"><Folder /></el-icon><strong>{{ renderedRoot || '根目录' }}</strong><small>根目录</small></button>
          <div class="dl-root-children">
          <div class="dl-system-file" title="由 Runner 自动维护当前版本、历史记录和仓库提交，不能关联或移动"><el-icon><Document /></el-icon><span>version.json</span><small>版本记录 · 系统维护</small></div>
          <el-tree ref="targetTreeRef" :data="targetNodes" node-key="id" :props="{ label: 'name', children: 'children' }" default-expand-all highlight-current :current-node-key="selectedId" :draggable="canWrite && !preview && !busy" :allow-drop="allowDrop" :expand-on-click-node="false" empty-text="从右侧添加代码，或新建文件夹" @node-click="(node: DirectoryMappingNode) => selectedId = node.id" @node-drop="drop">
            <template #default="{ data }"><span class="dl-tree-row" :title="targetPath(layout.nodes, data.id)"><el-icon :class="data.kind === 'folder' ? 'folder-icon' : ''"><Folder v-if="data.kind === 'folder'" /><Document v-else /></el-icon><span class="dl-tree-name">{{ data.name }}</span><el-icon v-if="data.repoId" class="dl-linked"><Link /></el-icon><small v-if="data.sourceType === 'directory'">整目录</small><span v-if="layout.entryPoint === targetPath(layout.nodes, data.id)" class="dl-entry">入口</span></span></template>
          </el-tree>
          </div>
        </div>
        <div v-if="selected && !preview" class="dl-selected" data-testid="layout-node-settings">
          <div class="dl-selection-title"><strong :title="selectedPath">{{ selectedPath }}</strong><span v-if="layout.entryPoint === selectedPath" class="dl-entry">执行入口</span><el-button v-if="canWrite" link type="danger" :icon="Delete" :disabled="busy" @click="remove">移除映射</el-button></div>
          <div class="dl-fields"><label>名称<el-input :model-value="selected.name" :readonly="!canWrite" :disabled="busy" data-testid="layout-node-name" @update:model-value="rename" /></label><label>移动到<el-select :model-value="selected.parentId" placeholder="选择目标目录" :disabled="!canWrite || busy" @update:model-value="move"><el-option label="根目录" value="" /><el-option v-for="folder in folders" :key="folder.id" :label="targetPath(layout.nodes, folder.id)" :value="folder.id" /></el-select></label></div>
          <div v-if="selected.repoId" class="dl-source-ref"><el-icon><Link /></el-icon><span :title="`${repoName(selected.repoId)} / ${selected.sourcePath}`">{{ repoName(selected.repoId) }} / {{ selected.sourcePath }}</span><code :title="selected.gitCommit">{{ selected.gitCommit?.slice(0, 12) }}</code></div>
          <p v-else class="dl-source-ref">空文件夹，可添加仓库代码，或将文件移入此目录。</p>
          <div class="dl-node-actions"><el-button v-if="canWrite && selected.kind === 'file' && selected.name.endsWith('.py') && layout.entryPoint !== selectedPath" link type="primary" :disabled="busy" @click="layout.entryPoint = selectedPath">设为执行入口</el-button><el-button v-if="canWrite && selected.sourceType === 'directory'" link type="primary" :disabled="busy" data-testid="layout-expand-mapping" @click="expandMapping">展开为独立文件</el-button></div>
        </div>
        <footer class="dl-target-actions">
          <div class="dl-save-state"><span class="dl-status">{{ dirty ? '有未保存修改' : layout.deploymentId ? '已保存' : '新部署配置' }}</span><span class="dl-current-entry" :title="layout.entryPoint || '未设置启动文件'" data-testid="layout-current-entry">启动文件：{{ layout.entryPoint || '未设置' }}</span></div>
          <div class="dl-action-buttons">
            <el-button :disabled="busy || loading" @click="preview = !preview">{{ preview ? '返回编辑' : '预览映射' }}</el-button>
            <el-button v-if="canWrite" type="primary" :loading="busy" :disabled="!needsSave || loading || busy" data-testid="layout-save" @click="save">保存配置</el-button>
          </div>
        </footer>
      </section>
      <section v-if="!preview" class="dl-panel dl-source">
        <header><div><strong>仓库代码</strong><span>选择文件或整个文件夹</span></div><el-button :icon="Refresh" circle size="small" :disabled="treeLoading || busy || !repoId" aria-label="刷新仓库代码" @click="loadRepository" /></header>
        <div class="dl-repository"><div class="dl-repository-controls"><el-select v-model="repoId" filterable :disabled="busy" placeholder="选择仓库" aria-label="代码仓库" data-testid="layout-repo-select"><el-option v-for="repo in repositories.filter(r => r.status === 'ACTIVE')" :key="repo.repoId" :label="repo.name" :value="repo.repoId" /></el-select><el-input v-model="keyword" clearable placeholder="查找目录或代码文件" aria-label="查找仓库代码" /></div><small>当前提交 <code>{{ repository?.gitCommit.slice(0, 12) || '—' }}</code></small></div>
        <el-alert v-if="treeError" :title="treeError" type="error" :closable="false" />
        <div v-loading="treeLoading" class="dl-tree-scroll">
          <el-tree :key="`${repoId}-${keyword}`" :data="sourceNodes" node-key="id" :props="{ label: 'name', children: 'children' }" :default-expand-all="!!keyword" highlight-current :expand-on-click-node="false" empty-text="当前仓库暂无可选代码" @node-click="(node: SourceTreeNode) => source = node">
            <template #default="{ data }"><span class="dl-tree-row" :title="data.path"><el-icon :class="data.kind === 'directory' ? 'folder-icon' : ''"><Folder v-if="data.kind === 'directory'" /><Document v-else /></el-icon><span class="dl-tree-name">{{ data.name }}</span><small v-if="!data.selectable">不可下发</small></span></template>
          </el-tree>
        </div>
        <div v-if="source?.kind === 'file' && source.selectable" class="dl-file-metadata" aria-live="polite" data-testid="layout-file-metadata">
          <span v-if="fileMetadataLoading">正在读取文件版本…</span>
          <template v-else-if="fileMetadataError"><span class="dl-file-metadata-error" role="alert">文件信息加载失败：{{ fileMetadataError }}</span><el-button link type="primary" size="small" data-testid="layout-file-metadata-retry" @click="loadFileMetadata">重试</el-button></template>
          <template v-else-if="fileMetadata"><span title="文件首次提交到 Git 的时间">创建时间 <time :datetime="fileMetadata.createdAt" data-testid="layout-file-created-at">{{ fileTime(fileMetadata.createdAt) }}</time></span><span>版本 <code :title="`该文件最近一次变更的 Git 提交：${fileMetadata.fileCommit}`" data-testid="layout-file-version">{{ fileMetadata.fileCommit.slice(0, 12) }}</code></span></template>
        </div>
        <footer class="dl-add"><div class="dl-add-context"><strong :title="source?.path">{{ source?.name || '选择仓库文件或文件夹' }}</strong><small :title="destinationPath" data-testid="layout-add-destination">添加到：{{ destinationPath || '根目录' }}</small></div><div class="dl-add-actions"><el-button v-if="canWrite" :icon="ArrowLeft" type="primary" :disabled="!source?.selectable || busy" data-testid="layout-add-source" @click="addSource">关联到目录</el-button><el-button v-if="canWrite && selected" link type="primary" :disabled="!source?.selectable || busy" @click="replaceSource">替换关联</el-button></div></footer>
      </section>
      <section v-else class="dl-panel dl-preview"><header><div><strong>下发映射预览</strong><span>已关联各仓库的固定 Git 提交</span></div></header><div class="dl-tree-scroll"><div class="dl-mapping"><strong>version.json</strong><p>系统维护当前版本、历史版本和各仓库提交</p></div><div v-for="item in mappings" :key="item.id" class="dl-mapping"><strong>{{ item.target }}{{ item.sourceType === 'directory' ? '/' : '' }}</strong><p>{{ repoName(item.repoId) }} / {{ item.sourcePath }}</p><code>{{ item.gitCommit }}</code></div><div v-if="!mappings.length" class="dl-empty">尚未关联仓库代码</div></div><footer><small>实际路径：Runner / {{ renderedRoot }} / 目标路径。版本信息记录在 version.json；执行中的任务使用临时副本。</small></footer></section>
    </div>
  </div>
</template>

<style scoped>
.dl-page { display:flex; flex-direction:column; gap:12px; flex:1; min-height:0; color:var(--rc-text,#334155); }
.dl-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; flex-shrink:0; }
.dl-editor-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }
.dl-config-select { width:340px; }.dl-config-option { float:right; margin-left:20px; font-size:11px; color:var(--rc-muted,#64748b); }.dl-status { font-size:12px; color:var(--rc-muted,#64748b); }
.dl-save-state { display:flex; flex-direction:column; gap:4px; min-width:0; }.dl-current-entry { font-size:12px; color:var(--el-text-color-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dl-configuration { padding:12px 16px 10px; border:1px solid var(--border-color,#e2e8f0); background:var(--surface,#fff); border-radius:12px; flex-shrink:0; }
.dl-identity-fields { display:grid; grid-template-columns:minmax(200px,420px) minmax(0,1fr); align-items:end; gap:16px; }
.dl-origin { display:flex; align-items:center; gap:12px; min-width:0; padding:8px 10px; border-radius:6px; background:var(--el-fill-color-light); font-size:12px; color:var(--el-text-color-secondary); }
.dl-origin strong { color:var(--el-text-color-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
.dl-origin code, .dl-origin > span { flex-shrink:0; }
.dl-configuration label { display:flex; flex-direction:column; gap:5px; min-width:0; font-size:12px; color:var(--rc-text,#475569); }
.dl-configuration label small { font-size:11px; color:var(--rc-muted,#64748b); margin-left:6px; }.dl-config-id { display:flex; flex-direction:column; gap:7px; align-self:center; min-width:0; color:var(--rc-muted,#64748b); font-size:11px; }.dl-config-id code { font-size:10px; overflow-wrap:anywhere; }
.dl-path-fields { display:flex; flex-wrap:wrap; gap:10px 12px; margin-top:10px; align-items:end; }.dl-preset-field { flex:0 0 auto; display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--rc-text,#475569); }.dl-type-field { flex:0 0 90px; }.dl-template-field { flex:1 1 240px; }.dl-variable-field { flex:0 0 136px; }.dl-website-field { flex-basis:190px; }.dl-configuration :deep(.el-autocomplete),.dl-configuration :deep(.el-select) { width:100%; }
.dl-preset-tags { gap:6px; flex-wrap:nowrap; min-height:32px; }.dl-preset-tags :deep(.el-radio-button) { --el-radio-button-checked-bg-color:var(--el-color-primary-light-9); --el-radio-button-checked-text-color:var(--el-color-primary); --el-radio-button-checked-border-color:var(--el-color-primary); }.dl-preset-tags :deep(.el-radio-button .el-radio-button__inner) { border-radius:6px; padding:8px 12px; font-size:12px; }.dl-preset-tags :deep(.el-radio-button.is-active .el-radio-button__original-radio:not(:disabled) + .el-radio-button__inner) { box-shadow:none; outline-color:var(--el-color-primary); }
.dl-help { display:inline-block; border:1px solid var(--border-color,#cbd5e1); border-radius:50%; width:14px; text-align:center; cursor:help; color:var(--rc-muted,#64748b); }
.dl-path-preview { display:flex; align-items:center; gap:7px; min-width:0; margin-top:9px; font-size:11px; }.dl-path-preview>span { color:var(--rc-muted,#64748b); flex-shrink:0; }.dl-path-preview code { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--el-color-primary); }.dl-path-preview small { margin-left:auto; color:var(--rc-muted,#64748b); font-size:11px; flex-shrink:0; }
.dl-workspace { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:16px; flex:1; min-height:0; }
.dl-panel { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--surface,#fff); border:1px solid var(--border-color,#e2e8f0); border-radius:12px; overflow:hidden; }
.dl-panel header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px; border-bottom:1px solid var(--border-color,#e2e8f0); flex-shrink:0; }.dl-panel header strong { font-size:14px; }.dl-panel header span { display:block; font-size:11px; color:var(--rc-muted,#64748b); margin-top:4px; }
.dl-panel small { display:block; font-size:11px; color:var(--rc-muted,#64748b); line-height:1.6; }
.dl-tree-scroll { flex:1; min-height:0; overflow:auto; padding:8px 12px; }.dl-tree-root { display:flex; align-items:center; gap:8px; width:100%; min-width:0; padding:8px; text-align:left; border:0; border-radius:6px; background:transparent; cursor:pointer; font:inherit; color:var(--rc-text,#334155); }.dl-tree-root:hover,.dl-tree-root.is-selected { background:var(--el-color-primary-light-9); }.dl-tree-root:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:-2px; }.dl-tree-root strong { font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.dl-tree-root small { margin-left:auto; flex-shrink:0; }.dl-root-children { padding-left:16px; }
.dl-tree-row { display:flex; align-items:center; gap:7px; width:100%; min-width:0; padding-right:8px; font-size:13px; }.dl-tree-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.folder-icon { color:var(--el-color-warning); }.dl-linked { color:var(--rc-muted,#64748b); }.dl-entry { margin-left:auto; padding:1px 6px; font-size:10px; color:var(--el-color-primary); background:var(--el-color-primary-light-9); border-radius:4px; }
.dl-system-file { display:flex; align-items:center; gap:7px; padding:8px 4px; color:var(--rc-muted,#64748b); font-size:12px; }.dl-system-file small { margin-left:auto; }
.dl-selected { padding:10px 16px; border-top:1px solid var(--border-color,#e2e8f0); background:var(--el-fill-color-lighter,#f8fafc); flex-shrink:0; }.dl-selection-title { display:flex; gap:12px; align-items:center; font-size:12px; margin-bottom:8px; }.dl-selection-title strong { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }.dl-selection-title .el-button { flex-shrink:0; height:auto; padding:0; }.dl-selection-title .dl-entry { flex-shrink:0; }.dl-fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }.dl-fields label { font-size:11px; color:var(--rc-muted,#64748b); display:flex; flex-direction:column; gap:5px; min-width:0; }
.dl-source-ref { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--rc-muted,#64748b); margin:8px 0 0; min-width:0; }.dl-source-ref>span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.dl-source-ref code { margin-left:auto; font-size:10px; flex-shrink:0; }.dl-node-actions { display:flex; gap:10px; margin-top:5px; }.dl-node-actions:empty { display:none; }
.dl-repository { padding:10px 16px; display:flex; flex-direction:column; gap:6px; flex-shrink:0; }.dl-repository-controls { display:grid; grid-template-columns:minmax(120px,0.9fr) minmax(0,1fr); gap:8px; }
.dl-file-metadata { display:flex; align-items:center; flex-wrap:wrap; gap:6px 16px; padding:8px 16px; border-top:1px solid var(--border-color,#e2e8f0); background:var(--el-fill-color-lighter,#f8fafc); flex-shrink:0; color:var(--rc-muted,#64748b); font-size:11px; }
.dl-file-metadata > span { display:flex; align-items:center; gap:6px; }.dl-file-metadata time,.dl-file-metadata code { color:var(--rc-text,#334155); white-space:nowrap; }.dl-file-metadata-error { min-width:0; overflow-wrap:anywhere; color:var(--el-color-danger); }
.dl-panel footer { border-top:1px solid var(--border-color,#e2e8f0); padding:10px 16px; flex-shrink:0; }.dl-add { display:flex; align-items:center; gap:10px; min-height:70px; }.dl-add-context { flex:1; min-width:0; }.dl-add-context strong { display:block; font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.dl-add-context small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.dl-add-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-shrink:0; }.dl-add-actions .el-button { margin:0; }
.dl-target-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; }.dl-action-buttons { display:flex; align-items:center; gap:8px; flex-shrink:0; }.dl-action-buttons .el-button { margin:0; }
.dl-panel :deep(.el-tree-node__content) { height:32px; }.dl-panel :deep(.el-tree) { background:transparent; }.dl-panel :deep(.el-tree-node__content.is-current) { background:var(--el-color-primary-light-9); }
.dl-empty { text-align:center; padding:40px 12px; font-size:13px; color:var(--rc-muted,#64748b); }.dl-mapping { padding:14px 4px; border-bottom:1px solid var(--border-color,#e2e8f0); overflow-wrap:anywhere; }.dl-mapping strong { font-size:13px; }.dl-mapping p { font-size:12px; color:var(--rc-muted,#64748b); margin:6px 0; }.dl-mapping code { font-size:11px; color:var(--rc-muted,#64748b); }
@media(max-width:1100px) { .dl-variable-field { flex-basis:116px; }.dl-website-field { flex-basis:160px; }.dl-path-preview small { display:none; } }
@media(max-width:800px) { .dl-page { overflow:auto; }.dl-workspace { grid-template-columns:1fr; flex:none; min-height:auto; }.dl-panel { height:460px; }.dl-config-select { width:220px; }.dl-identity-fields { grid-template-columns:1fr; gap:10px; }.dl-path-fields { gap:10px; }.dl-template-field { flex-basis:100%; order:1; }.dl-configuration { padding:12px; }.dl-config-id { grid-column:auto; } }
</style>
