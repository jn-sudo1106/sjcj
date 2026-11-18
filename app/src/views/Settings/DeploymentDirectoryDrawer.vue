<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { runnerManagementApi as api, type CodeRepository, type DeploymentConfiguration, type RemoteCodeFile, type RunnerInstance, type RuntimeConfiguration } from '@/api/runnerManagement'
import RunnerFilesDrawer from './RunnerFilesDrawer.vue'
import { targetPath } from './directoryLayout'
import { isProgramEntry } from '@/utils/programEntry'

const props = defineProps<{ layout: DeploymentConfiguration; runner: RunnerInstance; directory: string; repositories: CodeRepository[]; runtime?: RuntimeConfiguration; canSetEntry?: boolean }>()
const emit = defineEmits<{ close: []; entrySaved: [configurations: DeploymentConfiguration[]] }>()
const entrySaving = ref(''), entryError = ref('')
const allowEntry = computed(() => !!props.canSetEntry)
const mappings = computed(() => props.layout.nodes.filter(node => node.repoId && node.sourcePath && node.gitCommit)
  .map(node => ({ ...node, sourcePath: node.sourcePath!, target: targetPath(props.layout.nodes, node.id) })))
function mappedEntry(path: string) {
  return isProgramEntry(path) && mappings.value.some(node => node.sourceType === 'directory' ? path.startsWith(node.target + '/') : node.target === path)
}
function entryTargets(path: string) {
  const selected = source.value
  if (!selected) return []
  return [...new Set(mappings.value.filter(node => node.repoId === selected.repoId && node.gitCommit === selected.commit
    && (node.sourceType === 'directory' ? path.startsWith(node.sourcePath + '/') : path === node.sourcePath))
    .map(node => node.target + (node.sourceType === 'directory' ? path.slice(node.sourcePath.length) : '')).filter(isProgramEntry))]
}
let entrySequence = 0
async function saveEntry(path: string) {
  if (!allowEntry.value || entrySaving.value || !mappedEntry(path)) return
  const request = ++entrySequence
  entrySaving.value = path; entryError.value = ''
  try {
    const result = await api.saveDeploymentEntry(props.layout.deploymentId, { entryPoint: path, revision: props.layout.revision })
    if (request === entrySequence) emit('entrySaved', result.items)
  } catch (e) { if (request === entrySequence) entryError.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === entrySequence) entrySaving.value = '' }
}
const sources = computed(() => {
  const groups = new Map<string, { key: string; repoId: string; commit: string; name: string; address: string; roots: string[][] }>()
  for (const node of props.layout.nodes) {
    if (!node.repoId || !node.sourcePath || !node.gitCommit) continue
    const key = `${node.repoId}:${node.gitCommit}`
    let source = groups.get(key)
    if (!source) {
      const repo = props.repositories.find(item => item.repoId === node.repoId)
      source = { key, repoId: node.repoId, commit: node.gitCommit, name: repo?.name || node.repoId, address: repo?.remoteUrl || repo?.path || '', roots: [] }
      groups.set(key, source)
    }
    const parts = node.sourcePath.split('/')
    if (node.sourceType !== 'directory') parts.pop()
    source.roots.push(parts)
  }
  return [...groups.values()].map(source => {
    const root = [...source.roots[0]!]
    for (const parts of source.roots) while (root.some((part, index) => parts[index] !== part)) root.pop()
    return { ...source, root: root.join('/') }
  })
})
const sourceKey = ref(''), path = ref(''), files = ref<Omit<RemoteCodeFile, 'modifiedAt'>[]>([]), content = ref<string | null>(null)
const loading = ref(false), error = ref(''), truncated = ref(false), previewPath = ref('')
const source = computed(() => sources.value.find(item => item.key === sourceKey.value))
const crumbs = computed(() => path.value.slice(source.value?.root.length || 0).split('/').filter(Boolean))
let sequence = 0
async function browse(target: string, action: 'list' | 'read' = 'list') {
  const item = source.value, request = ++sequence
  files.value = []; content.value = null; error.value = ''; loading.value = false
  if (!item) return
  loading.value = true
  try {
    const response = await api.browseCodeRepository(item.repoId, item.commit, target, action)
    if (request !== sequence) return
    if (!response || response.path !== target || response.gitCommit !== item.commit
        || (action === 'list' ? !Array.isArray(response.items) : typeof response.content !== 'string')) throw new Error('Git 目录响应不完整，请确认管理服务已更新后刷新')
    if (action === 'read') { content.value = response.content ?? ''; previewPath.value = response.path }
    else { path.value = response.path; files.value = response.items || []; truncated.value = !!response.truncated }
  } catch (e) { if (request === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === sequence) loading.value = false }
}
watch(() => sources.value.map(item => item.key + ':' + item.root).join('|'), () => { if (!sources.value.some(item => item.key === sourceKey.value)) sourceKey.value = sources.value[0]?.key || '' }, { immediate: true })
watch(() => source.value?.key + ':' + source.value?.root, () => { path.value = source.value?.root || ''; void browse(path.value) }, { immediate: true })
onBeforeUnmount(() => { sequence++; entrySequence++ })
</script>

<template>
  <el-drawer :model-value="true" title="目录详情" size="min(1280px, 96vw)" :show-close="!entrySaving" :close-on-click-modal="!entrySaving" :close-on-press-escape="!entrySaving" @close="emit('close')">
    <p class="directory-note">左侧为部署配置固定的 Git 版本，右侧为目标机器实时返回的文件内容。</p>
    <p v-if="canSetEntry" class="directory-note">配置入口：{{ layout.entryPoint || '未设置' }}。在 Git 源目录选择一次，多台机器的部署任务共用；正在运行的程序保持当前入口，下次启动采用新入口。</p>
    <el-alert v-if="entryError" :title="entryError" type="error" :closable="false" />
    <p v-if="entrySaving" class="directory-note" role="status">正在校验并保存入口程序：{{ entrySaving }}…</p>
    <div class="directory-columns">
      <section class="directory-pane" data-testid="git-directory-pane">
        <h3>Git 源目录</h3>
        <template v-if="source">
          <header><el-select v-model="sourceKey" aria-label="Git 来源" :disabled="loading" filterable><el-option v-for="item in sources" :key="item.key" :value="item.key" :label="`${item.name} · ${item.commit.slice(0,12)} · ${item.root || '/'}`" /></el-select><el-button :icon="Refresh" :loading="loading" aria-label="刷新 Git 目录" @click="browse(path)" /></header>
          <code class="directory-path">{{ source.address }}</code><small>固定版本：{{ source.commit }}</small>
          <el-breadcrumb separator="/"><el-breadcrumb-item><a @click="browse(source.root)">{{ source.root || '仓库目录' }}</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part,index) in crumbs" :key="index"><a @click="browse([source.root, ...crumbs.slice(0,index+1)].filter(Boolean).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
          <code class="directory-path">{{ path || '/' }}</code>
          <el-alert v-if="error" :title="error" type="error" :closable="false" />
          <p v-if="loading" role="status">正在读取 Git 目录…</p>
          <el-alert v-if="truncated" title="当前目录较大，仅展示前 500 项" type="info" :closable="false" />
          <template v-if="content !== null"><header><b>{{ previewPath }}</b><el-button v-for="entry in allowEntry ? entryTargets(previewPath) : []" :key="entry" link type="primary" :disabled="!!entrySaving || layout.entryPoint === entry" :title="entry" @click="saveEntry(entry)">{{ layout.entryPoint === entry ? '当前入口' : '设为入口' }}</el-button><el-button link @click="browse(path)">返回文件列表</el-button></header><pre data-testid="git-file-content">{{ content }}</pre></template>
          <el-table v-else :data="files" row-key="path" empty-text="该 Git 目录没有文件">
            <el-table-column label="文件 / 目录" min-width="180"><template #default="{ row }"><el-button link type="primary" :disabled="loading || row.accessError" @click="browse(row.path, row.isDirectory ? 'list' : 'read')">{{ row.isDirectory ? '📁' : '📄' }} {{ row.name }}</el-button></template></el-table-column>
            <el-table-column label="大小" width="90"><template #default="{ row }">{{ row.size == null ? '—' : `${(row.size/1024).toFixed(1)} KB` }}</template></el-table-column>
            <el-table-column v-if="allowEntry" label="入口程序" width="110"><template #default="{ row }"><template v-if="!row.isDirectory && !row.accessError"><el-button v-for="entry in entryTargets(row.path)" :key="entry" link type="primary" :title="entry" :disabled="!!entrySaving || layout.entryPoint === entry" data-testid="git-set-entry" @click.stop="saveEntry(entry)">{{ layout.entryPoint === entry ? '当前入口' : '设为入口' }}</el-button></template></template></el-table-column>
          </el-table>
        </template>
        <el-empty v-else description="此配置没有记录固定的 Git 来源" />
      </section>
      <section class="directory-pane" data-testid="machine-directory-pane"><h3>目标机器实际目录</h3><RunnerFilesDrawer :runner="runner" :directory="directory" embedded /></section>
    </div>
  </el-drawer>
</template>

<style scoped>
.directory-note { margin:0 0 14px; color:var(--el-text-color-secondary); font-size:12px; }
.directory-columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
.directory-pane { min-width:0; padding:14px; border:1px solid var(--el-border-color-lighter); border-radius:8px; }
.directory-pane h3 { margin:0 0 14px; font-size:14px; }
.directory-pane header { display:flex; gap:10px; align-items:center; justify-content:space-between; }
.directory-pane header .el-select { flex:1; min-width:0; }
.directory-pane small,.directory-path { display:block; margin:10px 0; overflow-wrap:anywhere; font-size:12px; }
.directory-pane small { color:var(--el-text-color-secondary); }
.directory-pane a { color:var(--el-color-primary); cursor:pointer; }
.directory-pane pre { margin:10px 0 0; padding:12px; background:var(--el-fill-color-light); white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; }
@media (max-width:760px) { .directory-columns { grid-template-columns:minmax(0,1fr); } }
</style>
