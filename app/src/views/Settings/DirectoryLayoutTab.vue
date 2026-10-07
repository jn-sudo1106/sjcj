<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Document, Plus, Refresh, ArrowLeft, Link, Delete } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type CodeRepository, type DirectoryLayout, type DirectoryMappingNode, type RepositoryTree, type SiteCodeVersion } from '@/api/runnerManagement'
import { descendants, moveTarget, sourceTree, targetPath, targetTree, type SourceTreeNode } from './directoryLayout'

const route = useRoute(), auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const catalog = ref<SiteCodeVersion[]>([]), repositories = ref<CodeRepository[]>([])
const codeId = ref(''), repoId = ref(''), layout = ref<DirectoryLayout | null>(null)
const saved = ref(''), selectedId = ref(''), source = ref<SourceTreeNode | null>(null), repository = ref<RepositoryTree | null>(null)
const keyword = ref(''), loading = ref(false), treeLoading = ref(false), busy = ref(false), error = ref(''), treeError = ref('')
const targetTreeRef = ref<{ $el: HTMLElement }>()
const environment = ref<'test' | 'prd'>('test'), preview = ref(false), lastPublished = ref('')
let loadId = 0, treeId = 0
const codes = computed(() => [...new Map(catalog.value.map((row) => [row.codeId, row])).values()])
const dirty = computed(() => layout.value !== null && JSON.stringify(layout.value) !== saved.value)
const selected = computed(() => layout.value?.nodes.find((node) => node.id === selectedId.value))
const targetNodes = computed(() => targetTree(layout.value?.nodes || []))
const sourceNodes = computed(() => sourceTree(repository.value, keyword.value))
const folders = computed(() => layout.value?.nodes.filter((node) => node.kind === 'folder' && !descendants(layout.value!.nodes, selectedId.value).has(node.id)) || [])
const selectedPath = computed(() => layout.value && selected.value ? targetPath(layout.value.nodes, selected.value.id) : '')
const renderedRoot = computed(() => layout.value?.directoryTemplate.replaceAll('{configId}', layout.value.configId).replaceAll('{queue}', layout.value.queueName).replaceAll('{environment}', environment.value) || '')
const repoName = (id?: string) => repositories.value.find((repo) => repo.repoId === id)?.name || id || ''
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
watch([selectedId, targetNodes], async () => {
  await nextTick()
  const element = [...(targetTreeRef.value?.$el.querySelectorAll<HTMLElement>('.el-tree-node') || [])].find(item => item.dataset.key === selectedId.value)
  element?.querySelector<HTMLElement>('.el-tree-node__content')?.scrollIntoView?.({ block: 'nearest' })
})

async function loadLayout(next: string) {
  const requestId = ++loadId
  loading.value = true; error.value = ''; lastPublished.value = ''
  try {
    const result = await runnerManagementApi.directoryLayout(next)
    if (requestId !== loadId) return
    layout.value = result; saved.value = JSON.stringify(result); codeId.value = next
    selectedId.value = ''; preview.value = false
  } catch (e) { if (requestId === loadId) { layout.value = null; error.value = problem(e) } }
  finally { if (requestId === loadId) loading.value = false }
}
async function chooseCode(next: string) {
  if (next === codeId.value) return
  if (dirty.value) {
    try { await ElMessageBox.confirm('当前目录尚未保存，切换节点会放弃这些修改。', '切换节点', { confirmButtonText: '放弃并切换', cancelButtonText: '继续编辑' }) }
    catch { return }
  }
  await loadLayout(next)
}
async function refreshLayout() {
  if (dirty.value) {
    try { await ElMessageBox.confirm('重新加载会放弃未保存的目录修改。', '重新加载', { confirmButtonText: '重新加载', cancelButtonText: '继续编辑' }) }
    catch { return }
  }
  if (codeId.value) await loadLayout(codeId.value)
  else await init()
}
async function loadRepository() {
  const requestId = ++treeId, id = repoId.value
  source.value = null; repository.value = null; treeError.value = ''
  if (!id) return
  treeLoading.value = true
  try {
    const result = await runnerManagementApi.codeRepositoryTree(id)
    if (requestId === treeId) repository.value = result
  } catch (e) { if (requestId === treeId) treeError.value = problem(e) }
  finally { if (requestId === treeId) treeLoading.value = false }
}
watch(repoId, () => { void loadRepository() })
async function init() {
  loading.value = true; error.value = ''
  try {
    const [rows, repos] = await Promise.all([runnerManagementApi.siteCodeCatalog(), runnerManagementApi.codeRepositories()])
    catalog.value = rows; repositories.value = repos
    if (!repoId.value) repoId.value = repos.find((repo) => repo.isDefault && repo.status === 'ACTIVE')?.repoId || repos.find((repo) => repo.status === 'ACTIVE')?.repoId || ''
    const requested = String(route.query.codeId || '')
    const next = codes.value.find((row) => row.codeId === requested)?.codeId || codes.value[0]?.codeId
    if (next) await loadLayout(next)
  } catch (e) { error.value = problem(e) }
  finally { loading.value = false }
}
onMounted(() => { void init() })
onActivated(() => {
  const requested = String(route.query.codeId || '')
  if (requested && codeId.value && requested !== codeId.value) void chooseCode(requested)
})
watch(() => route.query.codeId, (id) => { if (id && codes.value.some((row) => row.codeId === id)) void chooseCode(String(id)) })

function addFolder() {
  if (!layout.value) return
  const parentId = selected.value?.kind === 'folder' ? selectedId.value : selected.value?.parentId || ''
  let name = '新建文件夹', index = 1
  while (layout.value.nodes.some((node) => node.parentId === parentId && node.name === name)) name = `新建文件夹${index++}`
  const node: DirectoryMappingNode = { id: crypto.randomUUID(), parentId, name, kind: 'folder' }
  layout.value.nodes.push(node); selectedId.value = node.id
}
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
  try { await ElMessageBox.confirm(`移除“${selected.value.name}”及其下级映射？仓库中的代码会保留。`, '移除目标', { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }) }
  catch { return }
  layout.value.nodes = layout.value.nodes.filter((node) => !ids.has(node.id)); selectedId.value = ''
}
async function save() {
  if (!layout.value) return false
  busy.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.saveDirectoryLayout(layout.value)
    layout.value = result; saved.value = JSON.stringify(result)
    ElMessage.success('目录草稿已保存'); return true
  } catch (e) { error.value = problem(e); return false }
  finally { busy.value = false }
}
async function publish() {
  if (!layout.value || busy.value) return
  if (dirty.value && !await save()) return
  busy.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.publishDirectoryLayout(codeId.value, layout.value.revision, environment.value)
    lastPublished.value = result.scriptDigest
    ElMessage.success(`目录与代码已发布到${environment.value === 'test' ? '测试' : '生产'}`)
  } catch (e) { error.value = problem(e) }
  finally { busy.value = false }
}
const mappings = computed(() => layout.value?.nodes.filter((node) => node.repoId).map((node) => ({ ...node, target: targetPath(layout.value!.nodes, node.id) })) || [])
</script>

<template>
  <div class="dl-page" data-testid="settings-directory-layout">
    <div class="dl-toolbar">
      <el-select :model-value="codeId" :disabled="loading || busy" filterable placeholder="选择节点代码" class="dl-code-select" data-testid="layout-code-select" @update:model-value="chooseCode">
        <el-option v-for="row in codes" :key="row.codeId" :value="row.codeId" :label="`${row.queueName} · #${row.configId}${row.siteHost ? ' · ' + row.siteHost : ''}`" />
      </el-select>
      <el-button :icon="Refresh" circle :disabled="loading || busy" aria-label="重新加载目录" @click="refreshLayout" />
      <span class="dl-status">{{ dirty ? '有未保存修改' : '目录草稿' }}</span>
      <div class="dl-spacer" />
      <el-button :disabled="!layout || busy" @click="preview = !preview">{{ preview ? '返回编辑' : '预览映射' }}</el-button>
      <el-button v-if="canWrite" :disabled="!layout || !dirty || busy" @click="save">保存草稿</el-button>
      <el-select v-model="environment" :disabled="busy" class="dl-environment" aria-label="发布环境"><el-option label="测试" value="test" /><el-option label="生产" value="prd" /></el-select>
      <el-button v-if="canWrite" type="primary" :loading="busy" :disabled="!layout || loading" data-testid="layout-publish" @click="publish">发布目录</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div v-if="!loading && !codes.length && !error" class="dl-empty">暂无节点代码，请先在流程节点中生成或关联代码。</div>
    <div v-if="layout" v-loading="loading" class="dl-workspace" :class="{ 'is-preview': preview }">
      <section class="dl-panel dl-target">
        <header><div><strong>目标目录</strong><span>相对于当前 Runner 安装目录</span></div><el-button v-if="canWrite && !preview" :icon="Plus" size="small" :disabled="busy" data-testid="layout-add-folder" @click="addFolder">文件夹</el-button></header>
        <div class="dl-root">
          <label>下发根目录 <el-tooltip content="可使用 {configId}、{queue}、{environment}。代码直接放在此目录下，当前与历史版本由 version.json 维护。"><span class="dl-help">?</span></el-tooltip></label>
          <el-input v-model="layout.directoryTemplate" :readonly="!canWrite || preview" :disabled="busy" data-testid="layout-root" />
          <small>Runner / {{ renderedRoot }}</small>
        </div>
        <div class="dl-tree-scroll">
          <div class="dl-system-file" title="由 Runner 自动维护当前版本、历史记录和仓库提交，不能关联或移动"><el-icon><Document /></el-icon><span>version.json</span><small>版本记录 · 系统维护</small></div>
          <el-tree ref="targetTreeRef" :data="targetNodes" node-key="id" :props="{ label: 'name', children: 'children' }" default-expand-all highlight-current :current-node-key="selectedId" :draggable="canWrite && !preview && !busy" :allow-drop="allowDrop" :expand-on-click-node="false" empty-text="从右侧添加代码，或新建文件夹" @node-click="(node: DirectoryMappingNode) => selectedId = node.id" @node-drop="drop">
            <template #default="{ data }"><span class="dl-tree-row" :title="targetPath(layout.nodes, data.id)"><el-icon :class="data.kind === 'folder' ? 'folder-icon' : ''"><Folder v-if="data.kind === 'folder'" /><Document v-else /></el-icon><span class="dl-tree-name">{{ data.name }}</span><el-icon v-if="data.repoId" class="dl-linked"><Link /></el-icon><small v-if="data.sourceType === 'directory'">整目录</small><span v-if="layout.entryPoint === targetPath(layout.nodes, data.id)" class="dl-entry">入口</span></span></template>
          </el-tree>
        </div>
        <div v-if="selected && !preview" class="dl-selected">
          <div class="dl-selection-title"><strong>{{ selected.kind === 'folder' ? '文件夹' : '文件' }}设置</strong><el-button v-if="canWrite" link type="danger" :icon="Delete" :disabled="busy" @click="remove">移除</el-button></div>
          <div class="dl-fields"><label>名称<el-input :model-value="selected.name" :readonly="!canWrite" :disabled="busy" data-testid="layout-node-name" @update:model-value="rename" /></label><label>上级目录<el-select :model-value="selected.parentId" placeholder="下发根目录" :disabled="!canWrite || busy" @update:model-value="move"><el-option label="下发根目录" value="" /><el-option v-for="folder in folders" :key="folder.id" :label="targetPath(layout.nodes, folder.id)" :value="folder.id" /></el-select></label></div>
          <p v-if="selected.repoId" class="dl-source-ref" :title="selected.sourcePath">{{ repoName(selected.repoId) }} / {{ selected.sourcePath }} <code>{{ selected.gitCommit?.slice(0, 12) }}</code></p>
          <p v-else class="dl-source-ref">空文件夹，可添加仓库代码或作为上级目录。</p>
          <el-button v-if="canWrite && selected.kind === 'file' && selected.name.endsWith('.py')" link type="primary" @click="layout.entryPoint = selectedPath">设为执行入口</el-button>
          <el-button v-if="canWrite && selected.sourceType === 'directory'" link type="primary" :disabled="busy" data-testid="layout-expand-mapping" @click="expandMapping">展开为独立文件，逐个调整目录</el-button>
        </div>
        <footer><label>执行入口</label><el-input v-model="layout.entryPoint" :readonly="!canWrite || preview" :disabled="busy" placeholder="如 news_list/main.py" data-testid="layout-entry" /><small>入口提供 scrape(url)，公共模块随代码包一起下发。</small></footer>
      </section>
      <section v-if="!preview" class="dl-panel dl-source">
        <header><div><strong>仓库代码</strong><span>选择文件或整个文件夹</span></div><el-button :icon="Refresh" circle size="small" :disabled="treeLoading || busy || !repoId" aria-label="刷新仓库代码" @click="loadRepository" /></header>
        <div class="dl-repository"><el-select v-model="repoId" filterable :disabled="busy" placeholder="选择仓库" data-testid="layout-repo-select"><el-option v-for="repo in repositories.filter(r => r.status === 'ACTIVE')" :key="repo.repoId" :label="repo.name" :value="repo.repoId" /></el-select><el-input v-model="keyword" clearable placeholder="查找目录或代码文件" /><small>当前提交 <code>{{ repository?.gitCommit.slice(0, 12) || '—' }}</code></small></div>
        <el-alert v-if="treeError" :title="treeError" type="error" :closable="false" />
        <div v-loading="treeLoading" class="dl-tree-scroll">
          <el-tree :key="`${repoId}-${keyword}`" :data="sourceNodes" node-key="id" :props="{ label: 'name', children: 'children' }" :default-expand-all="!!keyword" highlight-current :expand-on-click-node="false" empty-text="当前仓库暂无可选代码" @node-click="(node: SourceTreeNode) => source = node">
            <template #default="{ data }"><span class="dl-tree-row" :title="data.path"><el-icon :class="data.kind === 'directory' ? 'folder-icon' : ''"><Folder v-if="data.kind === 'directory'" /><Document v-else /></el-icon><span class="dl-tree-name">{{ data.name }}</span><small v-if="!data.selectable">不可下发</small></span></template>
          </el-tree>
        </div>
        <footer class="dl-add"><div><strong>{{ source?.name || '选择右侧代码' }}</strong><small>{{ source ? source.path : '文件夹会包含该提交下的全部文件' }}</small></div><el-button v-if="canWrite" :icon="ArrowLeft" type="primary" :disabled="!source?.selectable || busy" data-testid="layout-add-source" @click="addSource">添加到左侧</el-button><el-button v-if="canWrite && selected" :disabled="!source?.selectable || busy" @click="replaceSource">替换关联</el-button></footer>
      </section>
      <section v-else class="dl-panel dl-preview"><header><div><strong>下发映射预览</strong><span>各仓库的 Git 提交随发布版本固定</span></div></header><div class="dl-tree-scroll"><div class="dl-mapping"><strong>version.json</strong><p>系统维护当前版本、历史版本和各仓库提交</p></div><div v-for="item in mappings" :key="item.id" class="dl-mapping"><strong>{{ item.target }}{{ item.sourceType === 'directory' ? '/' : '' }}</strong><p>{{ repoName(item.repoId) }} / {{ item.sourcePath }}</p><code>{{ item.gitCommit }}</code></div><div v-if="!mappings.length" class="dl-empty">尚未关联仓库代码</div></div><footer><small>实际路径：Runner / {{ renderedRoot }} / 目标路径。版本信息记录在 version.json；执行中的任务使用临时副本。</small></footer></section>
    </div>
    <p v-if="lastPublished" class="dl-published" role="status">已发布版本：{{ lastPublished.slice(0, 24) }} · 对应环境的队列处理程序已同步更新，Runner 会自动切换。</p>
  </div>
</template>

<style scoped>
.dl-page { display:flex; flex-direction:column; gap:12px; flex:1; min-height:0; }
.dl-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.dl-code-select { width:310px; }.dl-environment { width:90px; }.dl-spacer { flex:1; }.dl-status { font-size:12px; color:var(--text-secondary,#64748b); }
.dl-workspace { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; flex:1; min-height:0; }
.dl-panel { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--surface,#fff); border:1px solid var(--border-color,#e2e8f0); border-radius:12px; overflow:hidden; }
.dl-panel header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--border-color,#e2e8f0); }
.dl-panel header strong { font-size:14px; }.dl-panel header span { display:block; font-size:12px; color:#64748b; margin-top:4px; }
.dl-root,.dl-repository { padding:12px 16px; display:flex; flex-direction:column; gap:8px; }.dl-root label,.dl-panel footer>label { font-size:12px; color:#475569; }.dl-help { display:inline-block; border:1px solid #cbd5e1; border-radius:50%; width:14px; text-align:center; margin-left:4px; cursor:help; }
.dl-panel small { display:block; font-size:11px; color:#64748b; line-height:1.6; overflow-wrap:anywhere; }.dl-root small { color:#2563eb; }
.dl-tree-scroll { flex:1; min-height:100px; overflow:auto; padding:8px 12px; }.dl-tree-row { display:flex; align-items:center; gap:7px; width:100%; min-width:0; padding-right:8px; font-size:13px; }.dl-tree-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.folder-icon { color:#d5a12b; }.dl-linked { color:#64748b; }.dl-entry { margin-left:auto; padding:1px 6px; font-size:10px; color:#2563eb; background:#eff6ff; border-radius:4px; }
.dl-system-file { display:flex; align-items:center; gap:7px; padding:8px 4px; color:#64748b; font-size:13px; }.dl-system-file small { margin-left:auto; }
.dl-selected { padding:10px 16px; border-top:1px solid #e2e8f0; background:#f8fafc; }.dl-selection-title { display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:8px; }.dl-fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }.dl-fields label { font-size:11px; color:#64748b; display:flex; flex-direction:column; gap:5px; }.dl-source-ref { font-size:11px; color:#64748b; margin:8px 0 0; overflow-wrap:anywhere; }.dl-source-ref code { display:block; }
.dl-panel footer { border-top:1px solid #e2e8f0; padding:12px 16px; display:flex; flex-direction:column; gap:6px; }.dl-panel footer.dl-add { flex-direction:row; flex-wrap:wrap; align-items:center; gap:8px; }.dl-add>div { flex:1; min-width:100px; }.dl-add strong { font-size:12px; overflow-wrap:anywhere; }.dl-add small { max-height:36px; overflow:hidden; }.dl-panel :deep(.el-tree-node__content) { height:32px; }.dl-panel :deep(.el-tree) { background:transparent; }
.dl-empty { text-align:center; padding:40px 12px; font-size:13px; color:#64748b; }.dl-mapping { padding:14px 4px; border-bottom:1px solid #e2e8f0; overflow-wrap:anywhere; }.dl-mapping strong { font-size:13px; }.dl-mapping p { font-size:12px; color:#64748b; margin:6px 0; }.dl-mapping code { font-size:11px; color:#64748b; }.dl-published { margin:0; font-size:12px; color:#15803d; }
@media(max-width:800px) { .dl-workspace { grid-template-columns:1fr; overflow:auto; }.dl-panel { min-height:400px; }.dl-code-select { width:240px; } }
</style>
