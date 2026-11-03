<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { flowCenterApi, flowVersionApi, sourceApi, workflowBindingApi, type Source, type SourceGroup, type Step } from '@/api'

const props = defineProps<{ group: SourceGroup; defaultFlowLabel: string }>()
const emit = defineEmits<{ close: [] }>()
type Member = { source: Source; state: string }
type FlowGroup = { id: string; name: string; members: Member[] }
const groups = ref<FlowGroup[]>([])
const selectedId = ref('')
const loading = ref(true)
const progress = ref('读取组成员…')
const error = ref('')
const failed = ref(0)
const unavailable = ref(0)
const empty = ref(0)
const stepsOpen = ref(false)
const stepsLoading = ref(false)
const stepsError = ref('')
const steps = ref<Step[]>([])
const stepsVersion = ref('')
const selected = computed(() => groups.value.find(g => g.id === selectedId.value))
const memberPage = ref(1)
const visibleMembers = computed(() => selected.value?.members.slice((memberPage.value - 1) * 20, memberPage.value * 20) || [])
let sequence = 0
let stepSequence = 0
onBeforeUnmount(() => { sequence++; stepSequence++ })

async function load() {
  const request = ++sequence
  loading.value = true
  error.value = ''
  failed.value = 0
  unavailable.value = 0
  empty.value = 0
  groups.value = []
  selectedId.value = ''
  stepsOpen.value = false
  try {
    const members: Source[] = []
    let page = 1
    let total = 0
    do {
      progress.value = `读取组成员 · 第 ${page} 页`
      const result = await sourceApi.sourcePaged({ sourceGroupId: props.group.sourceGroupId, page, size: 100 })
      if (request !== sequence) return
      if (!result.list.length && members.length < result.total) throw new Error('成员列表未完整返回，请刷新重试')
      members.push(...result.list)
      total = result.total
      page++
    } while (members.length < total)
    const uniqueMembers = [...new Map(members.map(source => [source.sourceId, source])).values()]
    if (uniqueMembers.length < total) throw new Error('成员列表存在重复或发生变化，请刷新重试')
    const grouped = new Map<string, FlowGroup>()
    for (let start = 0; start < uniqueMembers.length; start += 5) {
      progress.value = `读取历史绑定 ${Math.min(start + 5, uniqueMembers.length)} / ${uniqueMembers.length}`
      const batch = uniqueMembers.slice(start, start + 5)
      const results = await Promise.allSettled(batch.map(source => workflowBindingApi.view(source.sourceId)))
      if (request !== sequence) return
      results.forEach((result, index) => {
        const source = batch[index]!
        if (result.status === 'rejected') { failed.value++; return }
        const view = result.value
        if (view.sourceGroupId !== props.group.sourceGroupId) { failed.value++; return }
        if (view.ownDataAvailable === false) { unavailable.value++; return }
        const bindings = new Map(view.ownBindings.filter(b => b.flowId).map(b => [b.flowId, b.state]))
        for (const id of view.ownFlowIds) if (id && !bindings.has(id)) bindings.set(id, 'ACTIVE')
        if (!bindings.size) { empty.value++; return }
        for (const [id, state] of bindings) {
          if (!grouped.has(id)) grouped.set(id, { id, name: '', members: [] })
          grouped.get(id)!.members.push({ source, state })
        }
      })
    }
    const list = [...grouped.values()].sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id))
    for (let start = 0; start < list.length; start += 50) {
      const batch = list.slice(start, start + 50)
      try {
        const result = await flowCenterApi.paged({ page: 1, size: batch.length, flowIds: batch.map(f => f.id) })
        if (request !== sequence) return
        const names = new Map(result.list.map(f => [f.id, f.name]))
        batch.forEach(f => { f.name = names.get(f.id) || '' })
      } catch { /* 不影响历史绑定统计，名称暂以 ID 显示 */ }
    }
    if (request !== sequence) return
    groups.value = list
    selectedId.value = list[0]?.id || ''
  } catch (e) {
    if (request === sequence) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (request === sequence) loading.value = false
  }
}
function selectFlow(id: string) {
  selectedId.value = id
  memberPage.value = 1
  stepSequence++
  stepsOpen.value = false
  stepsError.value = ''
  steps.value = []
  stepsVersion.value = ''
}
async function toggleSteps() {
  if (stepsOpen.value) { stepsOpen.value = false; stepSequence++; return }
  if (!selected.value) return
  const id = selected.value.id
  const request = ++stepSequence
  stepsOpen.value = true
  stepsLoading.value = true
  stepsError.value = ''
  steps.value = []
  stepsVersion.value = ''
  try {
    const overview = await flowVersionApi.overview(id)
    if (request !== stepSequence) return
    const versionId = overview.enabled ? overview.publishId || overview.draftId : null
    if (overview.enabled && !versionId) throw new Error('没有可查看的发布版本或草稿')
    stepsVersion.value = !overview.enabled ? '当前版本' : overview.publishId ? '已发布版本' : '草稿（尚未发布）'
    const result = await flowCenterApi.steps(id, { withConfigDetails: false, ...(versionId ? { versionId } : {}) })
    if (request === stepSequence) steps.value = result
  } catch (e) {
    if (request === stepSequence) stepsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (request === stepSequence) stepsLoading.value = false
  }
}
void load()
</script>

<template>
  <el-drawer :model-value="true" title="查看流程差异" size="min(760px, 94vw)" append-to-body @close="emit('close')">
    <div class="sfd">
      <p class="sfd-sub">{{ group.sourceGroupName }} · 来源组 #{{ group.sourceGroupId }}</p>
      <section class="sfd-current">
        <span>当前组默认流程</span>
        <strong>{{ defaultFlowLabel || '未设置' }}</strong>
        <p>组内源当前按来源组流程运行。以下是成员入组前保留的自有流程，仅供排查；退组后可能重新生效。</p>
      </section>
      <div class="sfd-heading"><h3>历史自有流程</h3><span>多流程不代表分组一定有误</span></div>
      <p v-if="loading" class="sfd-message" data-testid="sfd-progress">{{ progress }}</p>
      <div v-else-if="error" class="sfd-message sfd-error">读取失败：{{ error }} <el-button link type="primary" @click="load">重试</el-button></div>
      <template v-else>
        <el-alert v-if="failed || unavailable" type="warning" :closable="false" show-icon :title="`${failed ? `${failed} 个源读取失败或已不在该组。` : ''}${unavailable ? `${unavailable} 个源的历史绑定未由后端返回。` : ''} 统计不完整，请刷新重试或检查后端接口。`" />
        <p v-if="empty" class="sfd-message">{{ empty }} 个源没有保留历史自有流程。</p>
        <div v-if="groups.length" class="sfd-flows">
          <button v-for="flow in groups" :key="flow.id" type="button" class="sfd-flow" :class="{ active: selectedId === flow.id }" data-testid="sfd-flow" @click="selectFlow(flow.id)">
            <span><strong>{{ flow.name || `流程 ${flow.id}` }}</strong><small>流程 ID {{ flow.id }}</small></span>
            <span class="sfd-spacer" /><span>{{ flow.members.length }} 个源保留</span><span class="sfd-link">{{ selectedId === flow.id ? '已查看' : '查看源' }}</span>
          </button>
        </div>
        <p v-else class="sfd-message">没有可展示的历史自有流程。</p>
        <template v-if="selected">
          <div class="sfd-heading"><h3>涉及的源 · {{ selected.name || `流程 ${selected.id}` }} <small>{{ selected.members.length }} 个源</small></h3><el-button link type="primary" data-testid="sfd-steps-toggle" @click="toggleSteps">{{ stepsOpen ? '收起节点配置' : '查看节点配置' }}</el-button></div>
          <div class="sfd-table-wrap"><table class="sfd-table"><thead><tr><th>源名称</th><th>源 ID</th><th>历史绑定状态</th></tr></thead><tbody><tr v-for="member in visibleMembers" :key="member.source.sourceId"><td>{{ member.source.name }}</td><td>{{ member.source.sourceId }}</td><td>{{ member.state === 'DISABLED' ? '已停用' : '启用' }}</td></tr></tbody></table></div>
          <el-pagination v-if="selected.members.length > 20" v-model:current-page="memberPage" :page-size="20" :total="selected.members.length" layout="total, prev, pager, next" small />
          <section v-if="stepsOpen" class="sfd-steps" data-testid="sfd-steps">
            <strong>{{ selected.name || `流程 ${selected.id}` }} · #{{ selected.id }}</strong>
            <p class="sfd-message">历史流程的节点信息 · {{ stepsVersion }} · 只读</p>
            <p v-if="stepsLoading" class="sfd-message">加载节点配置…</p>
            <p v-else-if="stepsError" class="sfd-error">读取失败：{{ stepsError }}</p>
            <p v-else-if="!steps.length" class="sfd-message">该流程没有步骤。</p>
            <div v-for="step in steps" :key="step.stepId" class="sfd-step"><strong>{{ step.name || `步骤 ${step.stepId}` }}</strong><span>配置 ID：{{ step.configId || '—' }}</span><span>输出表 ID：{{ step.outputTable || '—' }}</span></div>
          </section>
        </template>
      </template>
      <p class="sfd-foot">历史流程用于辅助人工判断；本页面不会调整来源组或修改流程。</p>
    </div>
  </el-drawer>
</template>

<style scoped>
.sfd { display:flex; flex-direction:column; gap:12px; min-width:0; }
.sfd-sub,.sfd-message { margin:0; color:var(--rc-text-2); font-size:12px; }
.sfd-current,.sfd-steps { padding:14px 16px; border:1px solid var(--rc-border); border-radius:7px; }
.sfd-current { background:var(--rc-bg); display:flex; flex-direction:column; gap:6px; }
.sfd-current span,.sfd-current p { font-size:12px; color:var(--rc-text-2); margin:0; }
.sfd-heading { display:flex; align-items:center; gap:8px; justify-content:space-between; margin-top:8px; }
.sfd-heading h3 { margin:0; min-width:0; overflow-wrap:anywhere; font-size:14px; }
.sfd-heading :deep(.el-button) { flex-shrink:0; }
.sfd-heading span,.sfd-heading small { color:var(--rc-text-2); font-size:12px; font-weight:400; }
.sfd-flows,.sfd-table-wrap { border:1px solid var(--rc-border); border-radius:7px; overflow:hidden; }
.sfd-flow { display:flex; width:100%; align-items:center; gap:12px; border:0; border-bottom:1px solid var(--rc-border-soft); padding:12px 14px; background:#fff; color:var(--rc-text); text-align:left; cursor:pointer; font-size:12px; }
.sfd-flow:last-child { border-bottom:0; }.sfd-flow.active { background:var(--rc-primary-bg); }
.sfd-flow strong,.sfd-flow small { display:block; overflow-wrap:anywhere; }.sfd-flow small { color:var(--rc-text-2); margin-top:3px; }
.sfd-spacer { flex:1; }.sfd-link { color:var(--rc-primary); white-space:nowrap; }
.sfd-table { width:100%; border-collapse:collapse; font-size:12px; text-align:left; table-layout:fixed; }.sfd-table th,.sfd-table td { padding:10px 12px; border-bottom:1px solid var(--rc-border-soft); overflow-wrap:anywhere; }.sfd-table th { background:var(--rc-bg); color:var(--rc-text-2); font-weight:500; }
.sfd-step { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:10px 0; border-top:1px solid var(--rc-border-soft); font-size:12px; overflow-wrap:anywhere; }.sfd-steps .sfd-message { margin:8px 0; }.sfd-error { color:var(--el-color-danger); font-size:12px; }.sfd-foot { color:var(--rc-text-2); font-size:12px; }
@media (max-width:600px) { .sfd-step { grid-template-columns:1fr; } }
</style>
