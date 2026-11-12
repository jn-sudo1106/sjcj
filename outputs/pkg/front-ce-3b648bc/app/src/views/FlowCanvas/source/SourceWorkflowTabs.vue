<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, sourceApi, workflowBindingApi, type FlowRecord, type WorkflowBinding } from '@/api'
const localFlowTarget = import.meta.env.VITE_FLOW_PROXY_TARGET
import { useFlowStore } from '@/stores/flow'
import { copyWholeFlow } from '@/utils/flow/copiedConfigs'
import { reportDetachResult } from '@/utils/flow/applyTemplateToSource'
import { pickFlowTemplate } from '@/utils/flow/createFromTemplate'
import ReplaceFlowDialog from '../shared/ReplaceFlowDialog.vue'
import { copiedPublishWarning, copyFlowErrorText } from '@/utils/flow/flowPublish'
import FlowVersionBar from '../canvas/FlowVersionBar.vue'
import { useFlowAutosave } from '../canvas/useFlowAutosave'
import { useFlowVersionStore } from '@/stores/flowVersion'
import { confirmedSharedFlows, registerSharedFlowGuard, type CarryConfigs, type SharedFlowAction } from '@/utils/flow/sharedFlowGuard'

const props = defineProps<{ sourceId: string }>()
const emit = defineEmits<{ status: [status: 'loading' | 'ready' | 'empty' | 'error'] }>()
const route = useRoute()
const router = useRouter()
const flow = useFlowStore()

const rows = ref<WorkflowBinding[]>([])
const loading = ref(false)
const adding = ref(false)
const addMenuOpen = ref(false)
const copyOpen = ref(false)
const versionBusy = ref(false)
let loadRequest = 0
let disposed = false
let unbindFollowupSourceId = ''
// 入组的源只走来源组的流程（1021-02）：只列组流程、只读，不给「＋」；要单独配置先退出来源组。
// 组还没绑流程时 rows 是空的，所以组 ID 单独记（workflowBindingApi.load 带回）
const groupId = ref('')
const inGroup = computed(() => !!groupId.value)
const groupRows = computed(() => rows.value.filter(row => row.inherited))
const ownRows = computed(() => rows.value.filter(row => !row.inherited))
/** 本源自己关联的（含「来源组和本源都关联了」）：能设主、解绑 */
const isOwn = (row: WorkflowBinding) => !row.inherited || !!row.own

const activeFlowId = computed(() => String(route.query.flowId || flow.sourceCtx?.flowId || ''))
const activeWorkflowId = computed(() => {
  const explicit = String(route.query.workflowId || flow.sourceCtx?.activeWorkflowId || '')
  if (explicit) return explicit
  const current = activeFlowId.value
  return rows.value.find(row => [row.workflowId, row.draftFlowId, row.publishedFlowId].includes(current))?.workflowId ?? current
})
const activeRow = computed(() => rows.value.find(row => row.workflowId === activeWorkflowId.value))

async function load(): Promise<boolean> {
  if (disposed) return false
  const request = ++loadRequest
  loading.value = true
  emit('status', 'loading')
  const sourceId = props.sourceId
  try {
    const loaded = await workflowBindingApi.load(sourceId)
    if (disposed || request !== loadRequest || sourceId !== props.sourceId) return false
    rows.value = loaded.rows
    groupId.value = loaded.sourceGroupId ?? ''
    emit('status', loaded.rows.length ? 'ready' : 'empty')
    if (flow.sourceCtx?.sourceId === sourceId) {
      flow.patchSourceCtx({ primaryFlowId: loaded.rows.find(row => row.primary)?.workflowId })
    }
    void loadUserCounts()
    return true
  } catch (error) {
    if (!disposed && request === loadRequest && sourceId === props.sourceId) {
      emit('status', 'error')
      ElMessage.error(`流程页签加载失败：${(error as Error)?.message ?? String(error)}`)
    }
    return false
  } finally {
    if (!disposed && request === loadRequest) loading.value = false
  }
}

async function openFlow(workflowId: string) {
  const row = rows.value.find(item => item.workflowId === workflowId)
  // 正式版本模式下，流程图就是编辑工作区。第一次打开已发布流程时直接进入隔离草稿，
  // 避免用户点下拉框或“＋”后才发现整块画布被只读样式拦住。
  if (row?.versionManaged === true && !row.draftFlowId) {
    await createDraft(row, { notify: false })
    return
  }
  const targetFlowId = row?.draftFlowId ?? row?.publishedFlowId ?? row?.workflowId ?? workflowId
  if (!workflowId || (workflowId === activeWorkflowId.value && targetFlowId === activeFlowId.value)) return
  await router.replace({
    path: '/canvas',
    query: { ...route.query, view: 'flow', flowMode: 'canvas', workflowId, flowId: targetFlowId },
  })
}

async function finishCreate(workflowId: string) {
  unbindFollowupSourceId = ''
  if (!await load()) return
  await openFlow(workflowId)
}

function versionLabel(row: WorkflowBinding): string {
  if (row.draftVersionNo) return `草稿 v${row.draftVersionNo}`
  if (row.publishedVersionNo) return `已发布 v${row.publishedVersionNo}`
  return row.versionStatus === 'DRAFT' ? '草稿' : '未发布'
}

async function createDraft(row: WorkflowBinding, options: { notify?: boolean } = {}) {
  if (versionBusy.value) return
  versionBusy.value = true
  try {
    const state = await workflowBindingApi.ensureDraft(row.workflowId)
    await load()
    await router.replace({
      path: '/canvas',
      query: { ...route.query, view: 'flow', flowMode: 'canvas', workflowId: row.workflowId, flowId: state.draftFlowId },
    })
    if (options.notify !== false) {
      ElMessage.success(`已创建草稿 v${state.draftVersionNo ?? ''}，后续修改不会影响当前发布版`)
    }
  } catch (error) {
    ElMessage.error(`创建草稿失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    versionBusy.value = false
  }
}

async function publishDraft(row: WorkflowBinding) {
  if (versionBusy.value || !row.draftVersionNo) return
  try {
    await ElMessageBox.confirm(
      `发布 v${row.draftVersionNo} 后，新发起的任务将使用这一版本；已经启动的任务继续使用原版本。`,
      '发布流程版本',
      { type: 'warning', confirmButtonText: '发布', cancelButtonText: '取消' },
    )
    versionBusy.value = true
    const state = await workflowBindingApi.publish(row.workflowId)
    await load()
    await router.replace({
      path: '/canvas',
      query: { ...route.query, view: 'flow', flowMode: 'list', workflowId: row.workflowId, flowId: state.publishedFlowId },
    })
    ElMessage.success(`流程 v${state.publishedVersionNo ?? row.draftVersionNo} 已发布`)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`发布失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    versionBusy.value = false
  }
}

async function createBlank() {
  addMenuOpen.value = false
  if (adding.value) return
  const sourceId = props.sourceId
  try {
    const result = await ElMessageBox.prompt('创建后会新增一个流程标签，可直接在画布和右侧配置区继续编辑。', '新建流程', {
      inputValue: `新流程-${new Date().toISOString().slice(0, 10)}`,
      inputPlaceholder: '流程名称',
      inputValidator: value => value.trim() ? true : '请输入流程名称',
      confirmButtonText: '创建并打开',
      cancelButtonText: '取消',
    })
    if (disposed || sourceId !== props.sourceId) return
    adding.value = true
    const templateId = await pickFlowTemplate()
    if (disposed || sourceId !== props.sourceId) return
    const created = await workflowBindingApi.createForSource({
      templateId,
      sourceId,
      name: result.value.trim(),
      primary: unbindFollowupSourceId === props.sourceId || !rows.value.some(row => !row.inherited || row.own),
    })
    if (disposed || sourceId !== props.sourceId) return
    ElMessage.success(`流程「${created.workflowName}」已创建`)
    await finishCreate(created.workflowId)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`新建流程失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    adding.value = false
  }
}

function chooseExisting() {
  addMenuOpen.value = false
  copyOpen.value = true
}

// 复用现有流程（10-21）：直接关联、不复制，和其他源共享同一条流程
const reuseOpen = ref(false)
const ownFlowIds = computed(() => rows.value.filter(isOwn).map(row => row.workflowId))
function chooseReuse() {
  addMenuOpen.value = false
  reuseOpen.value = true
}
async function reuseExisting(picked: FlowRecord) {
  if (adding.value) return
  const sourceId = props.sourceId
  // 10-29：选中即关联并打开，不再弹「复用并打开」确认
  try {
    adding.value = true
    await workflowBindingApi.bind({ sourceId, workflowId: picked.id, primary: unbindFollowupSourceId === sourceId || !rows.value.some(isOwn) })
    if (disposed || sourceId !== props.sourceId) return
    ElMessage.success(`已关联流程「${picked.name}」`)
    reuseOpen.value = false
    unbindDlg.open = false
    await finishCreate(picked.id)
  } catch (error) {
    ElMessage.error(`关联失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    adding.value = false
  }
}

// 右键流程标签（10-21）：本源流程「设为主流程」「解绑流程」；来源组流程只读，指去来源组
const ctxMenu = ref<{ row: WorkflowBinding; x: number; y: number } | null>(null)
function openMenu(event: MouseEvent, row: WorkflowBinding) {
  addMenuOpen.value = false
  ctxMenu.value = { row, x: Math.min(event.clientX, window.innerWidth - 200), y: event.clientY }
}
function closeMenu() {
  ctxMenu.value = null
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}
onMounted(() => {
  window.addEventListener('click', closeMenu)
  window.addEventListener('scroll', closeMenu, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  disposed = true
  loadRequest++
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
  window.removeEventListener('keydown', onKey)
})
function openGroup() {
  closeMenu()
  void router.push({ path: '/collect', query: { tab: 'personal', group: groupId.value } })
}

async function setPrimary(row: WorkflowBinding) {
  closeMenu()
  try {
    await workflowBindingApi.setPrimary(props.sourceId, row.workflowId)
    ElMessage.success(`已把「${row.workflowName}」设为主流程，新发起的任务默认用它`)
    await load()
  } catch (error) {
    ElMessage.error(`设置主流程失败：${(error as Error)?.message ?? String(error)}`)
  }
}

// 禁用 / 启用流程（10-22）：flow/changeFlowEnable，改的是流程本身（cs_flow.IS_DELETE），不是这个源的关联。
// 流程是多个源共用的，禁用前说清有几个源在用；禁用后手动抓取、指定流程运行、定时都不再按它跑（后端 10-22 修）。
const isDisabled = (row: WorkflowBinding) => row.workflowStatus === 'DISABLED'
async function toggleFlowEnable(row: WorkflowBinding) {
  closeMenu()
  const disabling = !isDisabled(row)
  if (disabling) {
    const users = await sourceApi.sourcePaged({ flowId: row.workflowId, page: 1, size: 1 }).then((r) => r.total).catch(() => null)
    const scope = users === null ? '使用这条流程的源' : `使用这条流程的 ${users} 个源`
    try {
      await ElMessageBox.confirm(
        `禁用流程「${row.workflowName}」#${row.workflowId}？禁用后，${scope}都不会再按它运行（手动抓取、指定流程运行、定时都会被拦下）。`
        + (row.primary ? '\n这是当前源的主流程，禁用后当前源将无法发起任务。' : '')
        + '\n流程本身和关联关系不变，可以随时启用。',
        '禁用流程',
        { type: 'warning', confirmButtonText: '禁用', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  try {
    const ack = await flowCenterApi.changeFlowEnable([row.workflowId], disabling ? 1 : 0)
    if (!ack.ok) throw new Error(ack.message || '未知原因')
    ElMessage.success(disabling ? `已禁用流程「${row.workflowName}」` : `已启用流程「${row.workflowName}」`)
    await load()
  } catch (error) {
    ElMessage.error(`${disabling ? '禁用' : '启用'}流程失败：${(error as Error)?.message ?? String(error)}`)
  }
}

// 右键直接解绑；没有可用流程时才打开接续选择。
const followupAction = ref<'choose' | 'new' | 'copy' | 'bind' | 'copy-name'>('choose')
const followupName = ref('')
const followupTemplates = ref<FlowRecord[]>([])
const followupTemplateId = ref('')
const followupLoading = ref(false)
const followupError = ref('')
const followupPicked = ref<FlowRecord | null>(null)
const unbindDlg = reactive({ open: false, row: null as WorkflowBinding | null, busy: false, sourceId: '', done: false, refreshError: false, wasActive: false })
async function refreshAfterUnbind() {
  if (!await load()) {
    if (!disposed && unbindDlg.sourceId === props.sourceId) {
      unbindDlg.refreshError = true
      unbindDlg.open = true
    }
    return
  }
  if (disposed || unbindDlg.sourceId !== props.sourceId) return
  unbindDlg.refreshError = false
  const available = rows.value.filter(row => row.workflowStatus !== 'DISABLED')
  const target = available.find(row => row.primary) ?? available[0]
  if (unbindDlg.wasActive || !target) {
    if (target) await openFlow(target.workflowId)
    else {
      const { workflowId: _w, flowId: _f, ...rest } = route.query
      await router.replace({ path: '/canvas', query: rest })
    }
  }
  unbindDlg.open = !target && !inGroup.value
}
async function unbindFlow(row: WorkflowBinding) {
  if (unbindDlg.busy) return
  closeMenu()
  unbindFollowupSourceId = ''
  unbindDlg.open = false
  unbindDlg.row = row
  followupAction.value = 'choose'
  followupError.value = ''
  unbindDlg.done = false
  unbindDlg.refreshError = false
  unbindDlg.sourceId = props.sourceId
  unbindDlg.wasActive = row.workflowId === activeWorkflowId.value
  unbindDlg.busy = true
  const sourceId = props.sourceId
  const others = rows.value.filter(item => isOwn(item) && item.workflowId !== row.workflowId)
  const next = others.find(item => item.workflowStatus !== 'DISABLED') ?? others[0]
  try {
    await workflowBindingApi.unbind(sourceId, row.workflowId, row.primary ? next?.workflowId : undefined)
    if (disposed || sourceId !== props.sourceId) return
    unbindDlg.done = true
    ElMessage.success(`已解绑「${row.workflowName}」，流程本身没有删除`)
    await refreshAfterUnbind()
  } catch (error) {
    if (disposed || sourceId !== props.sourceId) return
    if (unbindDlg.done) {
      unbindDlg.refreshError = true
      unbindDlg.open = true
    }
    ElMessage.error(`${unbindDlg.done ? '流程已解绑，刷新失败' : '解绑失败'}：${(error as Error)?.message ?? String(error)}`)
  } finally {
    unbindDlg.busy = false
  }
}
async function retryUnbindRefresh() {
  if (unbindDlg.busy) return
  unbindDlg.busy = true
  try {
    await refreshAfterUnbind()
  } catch (error) {
    unbindDlg.refreshError = true
    ElMessage.error(`流程已解绑，刷新失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    unbindDlg.busy = false
  }
}
async function continueAfterUnbind(action: 'new' | 'copy' | 'bind') {
  if (unbindDlg.busy || adding.value || followupLoading.value || unbindDlg.sourceId !== props.sourceId) return
  unbindFollowupSourceId = props.sourceId
  followupAction.value = action
  followupError.value = ''
  if (action !== 'new') return
  followupName.value = `新流程-${new Date().toISOString().slice(0, 10)}`
  followupTemplateId.value = ''
  followupTemplates.value = []
  followupLoading.value = true
  const sourceId = props.sourceId
  try {
    const templates = await flowCenterApi.templates()
    if (disposed || sourceId !== props.sourceId) return
    followupTemplates.value = templates
    followupTemplateId.value = templates[0]?.id ?? ''
    if (!templates.length) followupError.value = '暂无流程模板，请先到流程中心新建模板'
  } catch (error) {
    followupError.value = `模板加载失败：${(error as Error)?.message ?? String(error)}`
  } finally {
    followupLoading.value = false
  }
}
function pickFollowupCopy(picked: FlowRecord) {
  followupPicked.value = picked
  followupName.value = `${picked.name}_副本`
  followupAction.value = 'copy-name'
}
async function submitFollowup() {
  if (adding.value || followupLoading.value || !followupName.value.trim() || unbindDlg.sourceId !== props.sourceId) return
  if (followupAction.value === 'copy-name' && followupPicked.value) {
    await copyExisting(followupPicked.value, followupName.value.trim())
    return
  }
  if (!followupTemplateId.value) return
  const sourceId = props.sourceId
  adding.value = true
  try {
    const created = await workflowBindingApi.createForSource({ sourceId, name: followupName.value.trim(), templateId: followupTemplateId.value, primary: true })
    if (disposed || sourceId !== props.sourceId) return
    ElMessage.success(`流程「${created.workflowName}」已创建`)
    unbindDlg.open = false
    await finishCreate(created.workflowId)
  } catch (error) {
    ElMessage.error(`新建流程失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    adding.value = false
  }
}
watch(() => unbindDlg.open, (open) => {
  if (!open) unbindFollowupSourceId = ''
})

async function copyExisting(sourceFlow: FlowRecord, name?: string) {
  if (adding.value) return
  const sourceId = props.sourceId
  try {
    const result = name ? { value: name } : await ElMessageBox.prompt(
      `将复制「${sourceFlow.name}」的流程结构和节点配置，生成一条互不影响的新流程。`,
      '从流程或模板新建',
      {
        inputValue: `${sourceFlow.name}_副本`,
        inputPlaceholder: '新流程名称',
        inputValidator: value => value.trim() ? true : '请输入流程名称',
        confirmButtonText: '复制并打开',
        cancelButtonText: '取消',
      },
    )
    if (disposed || sourceId !== props.sourceId) return
    adding.value = true
    const primary = unbindFollowupSourceId === sourceId || !rows.value.some(row => !row.inherited || row.own)
    const copied = await copyWholeFlow(sourceFlow.id, result.value.trim(), {
      sourceFlowRef: `流程「${sourceFlow.name}」#${sourceFlow.id}`,
    })
    try {
      await workflowBindingApi.bind({
        sourceId,
        workflowId: copied.flowId,
        primary,
      })
    } catch (error) {
      throw new Error(`已生成流程 #${copied.flowId}，但关联当前源失败：${(error as Error)?.message ?? String(error)}`)
    }
    if (disposed || sourceId !== props.sourceId) return
    reportDetachResult(copied.detach, `原流程「${sourceFlow.name}」`)
    if (copied.publishError) ElMessage.warning(copiedPublishWarning(copied.flowId, copied.publishError))
    ElMessage.success(`已从「${sourceFlow.name}」创建新流程`)
    copyOpen.value = false
    unbindDlg.open = false
    await finishCreate(copied.flowId)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(copyFlowErrorText((error as Error)?.message ?? String(error)))
  } finally {
    adding.value = false
  }
}

// ---- 共用流程保存提示（10-29，设计稿/设计方案/1029-共用流程保存提示_开发设计方案）----
// 本源自己的流程查一下有几个源在用：标签上标「N 源共用」，保存节点配置 / 发布前据此决定要不要问。
// 来源组的流程只读，不查。null = 没查到（查询中或失败），按共用处理：宁可多问一次。
const userCounts = ref<Record<string, number | null>>({})
async function loadUserCounts() {
  const ids = rows.value.filter(row => !row.inherited).map(row => row.workflowId)
  await Promise.all(ids.map(async (id) => {
    const total = await sourceApi.sourcePaged({ flowId: id, page: 1, size: 1 }).then(r => r.total).catch(() => null)
    userCounts.value = { ...userCounts.value, [id]: total }
  }))
}
const sharedCount = (row: WorkflowBinding) => {
  const n = userCounts.value[row.workflowId]
  return typeof n === 'number' && n > 1 ? n : 0
}
const sharedKey = (row: WorkflowBinding) => `${props.sourceId}:${row.workflowId}`
function sharedPending(): boolean {
  const row = activeRow.value
  if (!row || row.inherited || flow.flowIdMode || confirmedSharedFlows.has(sharedKey(row))) return false
  const n = userCounts.value[row.workflowId]
  return n === undefined || n === null || n > 1
}

const version = useFlowVersionStore()
const { flush } = useFlowAutosave()
const sharedDlg = reactive({
  open: false,
  action: 'save' as SharedFlowAction,
  row: null as WorkflowBinding | null,
  users: null as number | null,
  resolve: null as ((choice: 'cancel' | 'copy' | 'save') => void) | null,
})
const sharedDraftNo = computed(() => version.draft?.flowVer)
function closeShared(choice: 'cancel' | 'copy' | 'save') {
  const resolve = sharedDlg.resolve
  sharedDlg.resolve = null
  sharedDlg.open = false
  resolve?.(choice)
}

async function askShared(action: SharedFlowAction, carry?: CarryConfigs): Promise<boolean> {
  const row = activeRow.value
  if (!row) return true
  // 页签刚加载时可能还没查到源数：先补查一次，独占的流程不弹窗
  if (userCounts.value[row.workflowId] == null) await loadUserCounts()
  const users = userCounts.value[row.workflowId] ?? null
  if (users !== null && users <= 1) return true
  if (sharedDlg.resolve) return false
  sharedDlg.action = action
  sharedDlg.row = row
  sharedDlg.users = users
  sharedDlg.open = true
  const choice = await new Promise<'cancel' | 'copy' | 'save'>((resolve) => { sharedDlg.resolve = resolve })
  if (choice === 'save') {
    confirmedSharedFlows.add(sharedKey(row))
    return true
  }
  if (choice === 'copy') await copyForThisSource(row, action, carry)
  return false
}

/**
 * 复制为本源专用：整条复制（每个节点一份独立配置，复制品自动发布）→ 关联到当前源（主流程身份跟过去）
 * → 解绑原流程 → 带上没保存的节点配置 → 打开新流程。其他源照旧用原流程。
 * 复制前先把画布结构落进草稿，再带 useDraft=1 复制当前草稿（10-30 后端已支持），结构改动随新流程走；
 * 发布时选复制，原流程的草稿随即放弃，免得别人把只想改本源的改动发布出去。
 */
async function copyForThisSource(row: WorkflowBinding, action: SharedFlowAction, carry?: CarryConfigs) {
  if (adding.value) return
  adding.value = true
  try {
    await flush()
    const copied = await copyWholeFlow(row.workflowId, `${row.workflowName}_副本`, {
      sourceFlowRef: `流程「${row.workflowName}」#${row.workflowId}`,
      useDraft: true,
    })
    try {
      await workflowBindingApi.bind({ sourceId: props.sourceId, workflowId: copied.flowId, primary: row.primary })
    } catch (error) {
      throw new Error(`已生成流程 #${copied.flowId}，但关联当前源失败：${(error as Error)?.message ?? String(error)}`)
    }
    try {
      await workflowBindingApi.unbind(props.sourceId, row.workflowId)
    } catch (error) {
      ElMessage.warning(`新流程已关联，但原流程「${row.workflowName}」解绑失败：${(error as Error)?.message ?? String(error)}。可右键原流程标签手动解绑`)
    }
    if (carry && copied.detach?.configMap) {
      try {
        await carry(copied.detach.configMap)
      } catch (error) {
        ElMessage.warning(`没保存的节点配置未能带到新流程：${(error as Error)?.message ?? String(error)}，请在新流程上重新修改`)
      }
    }
    let lostDraft = ''
    if (action === 'publish' && version.draft) {
      const draftNo = version.draft.flowVer
      try {
        await version.abandon()
        lostDraft = `原流程的草稿 v${draftNo} 已放弃，草稿里的修改已带到新流程`
      } catch (error) {
        ElMessage.warning(`原流程的草稿 v${draftNo} 放弃失败：${(error as Error)?.message ?? String(error)}。请回原流程手动放弃，避免被别人发布`)
      }
    }
    reportDetachResult(copied.detach, `原流程「${row.workflowName}」`)
    if (copied.publishError) ElMessage.warning(copiedPublishWarning(copied.flowId, copied.publishError))
    ElMessage.success(`已复制为本源专用流程「${row.workflowName}_副本」#${copied.flowId}，其他源照旧使用原流程${lostDraft ? `；${lostDraft}` : ''}`)
    await finishCreate(copied.flowId)
  } catch (error) {
    ElMessage.error(copyFlowErrorText((error as Error)?.message ?? String(error)))
  } finally {
    adding.value = false
  }
}

const unregisterShared = registerSharedFlowGuard({ pending: sharedPending, ask: askShared })
onBeforeUnmount(() => {
  unregisterShared()
  if (sharedDlg.resolve) closeShared('cancel')
})

watch(() => props.sourceId, async () => {
  unbindFollowupSourceId = ''
  unbindDlg.open = false
  copyOpen.value = false
  reuseOpen.value = false
  if (!await load()) return
  const row = activeRow.value
  if (row?.versionManaged === true && !row.draftFlowId) await createDraft(row, { notify: false })
})
onMounted(async () => {
  if (!await load()) return
  const row = activeRow.value
  if (row?.versionManaged === true && !row.draftFlowId) await createDraft(row, { notify: false })
})
</script>

<template>
  <!-- 右键只出流程菜单，不冒泡到画布（否则弹的是画布的「添加节点」） -->
  <div class="swt" data-testid="source-workflow-tabs" @contextmenu.prevent.stop>
    <span v-if="localFlowTarget" class="swt-compat" :title="localFlowTarget">流程：本地</span>
    <div class="swt-scroll" role="tablist" aria-label="当前源的流程">
      <template v-for="segment in (inGroup ? [{ key: 'group', list: groupRows }] : [{ key: 'own', list: ownRows }])" :key="segment.key">
        <template v-if="segment.list.length || inGroup">
          <span
            v-if="inGroup"
            class="swt-seg"
            :class="segment.key"
            :data-testid="`workflow-seg-${segment.key}`"
            title="组内源统一使用来源组的流程，这里只能查看；要改请到来源组里配置，要单独配置请先退出来源组"
          >来源组 #{{ groupId }}</span>
          <span v-if="inGroup && !groupRows.length" class="swt-empty" data-testid="workflow-group-empty">来源组还没有配置流程</span>
          <button
            v-for="row in segment.list"
            :key="row.workflowId"
            class="swt-tab"
            :class="{ active: row.workflowId === activeWorkflowId, group: row.inherited, disabled: isDisabled(row) }"
            type="button"
            role="tab"
            :aria-selected="row.workflowId === activeWorkflowId"
            :title="`${row.workflowName}（#${row.workflowId}）${row.inherited ? '：来源组流程' : ''}${isDisabled(row) ? '：已禁用，不会运行' : ''} · 右键更多操作`"
            :data-testid="`workflow-tab-${row.workflowId}`"
            @click="openFlow(row.workflowId)"
            @contextmenu.prevent.stop="openMenu($event, row)"
          >
            <span class="swt-name">{{ row.workflowName }}</span>
            <span class="swt-id">#{{ row.workflowId }}</span>
            <span v-if="row.versionManaged" class="swt-version" :class="{ draft: !!row.draftVersionNo }">{{ versionLabel(row) }}</span>
            <span v-if="isDisabled(row)" class="swt-disabled" data-testid="workflow-disabled-tag">已禁用</span>
            <span
              v-if="!row.inherited && sharedCount(row)"
              class="swt-shared"
              :title="`${sharedCount(row)} 个源在用这条流程：保存节点配置、发布会影响全部这些源`"
              data-testid="workflow-shared-tag"
            >{{ sharedCount(row) }} 源共用</span>
            <span v-if="row.primary" class="swt-primary">主</span>
            <span v-else-if="row.role === 'BACKFILL'" class="swt-role">补</span>
          </button>
        </template>
      </template>
      <span v-if="loading && !rows.length" class="swt-loading">加载流程…</span>
      <span v-else-if="!loading && !rows.length && !inGroup" class="swt-empty">暂无流程</span>
    </div>

    <div v-if="activeRow?.versionManaged === true && !activeRow.inherited" class="swt-version-actions">
      <button
        v-if="!activeRow.draftVersionId"
        class="swt-version-btn"
        type="button"
        :disabled="versionBusy"
        @click="createDraft(activeRow)"
      >编辑新版本</button>
      <button
        v-else
        class="swt-version-btn publish"
        type="button"
        :disabled="versionBusy"
        @click="publishDraft(activeRow)"
      >发布 v{{ activeRow.draftVersionNo }}</button>
    </div>

    <!-- 217 流程版本（2026-10-11）：已发布 vN / 草稿 vN + 放弃 / 发布，紧凑徽标放在这一行，不再单独占一行 -->
    <FlowVersionBar />

    <div v-if="!inGroup" class="swt-add-wrap">
      <button
        class="swt-add"
        type="button"
        data-testid="workflow-add"
        :disabled="adding"
        aria-label="新增流程标签"
        title="新增流程"
        @click.stop="addMenuOpen = !addMenuOpen"
      >{{ adding ? '…' : '＋' }}</button>
      <div v-if="addMenuOpen" class="swt-add-menu" data-testid="workflow-add-menu">
        <button type="button" data-testid="workflow-create-blank" @click="createBlank">新建流程</button>
        <button type="button" data-testid="workflow-reuse-existing" @click="chooseReuse">关联已有流程</button>
        <button type="button" data-testid="workflow-copy-existing" @click="chooseExisting">复制流程或模板</button>
      </div>
    </div>

    <ReplaceFlowDialog
      v-if="copyOpen"
      v-model="copyOpen"
      purpose="copy"
      @pick="copyExisting"
    />
    <ReplaceFlowDialog
      v-if="reuseOpen"
      v-model="reuseOpen"
      purpose="bind"
      :exclude-flow-ids="ownFlowIds"
      @pick="reuseExisting"
    />

    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="swt-ctx"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        role="menu"
        data-testid="workflow-ctx-menu"
        @click.stop
        @contextmenu.prevent
      >
        <template v-if="isOwn(ctxMenu.row)">
          <button v-if="!ctxMenu.row.primary" type="button" role="menuitem" data-testid="workflow-ctx-primary" @click="setPrimary(ctxMenu.row)">设为主流程</button>
          <button type="button" role="menuitem" :data-testid="isDisabled(ctxMenu.row) ? 'workflow-ctx-enable' : 'workflow-ctx-disable'" @click="toggleFlowEnable(ctxMenu.row)">{{ isDisabled(ctxMenu.row) ? '启用流程' : '禁用流程' }}</button>
          <button type="button" role="menuitem" class="danger" data-testid="workflow-ctx-unbind" :disabled="unbindDlg.busy" @click="unbindFlow(ctxMenu.row)">解绑流程</button>
        </template>
        <template v-else>
          <div class="swt-ctx-note">来源组流程，请到来源组修改</div>
          <button type="button" role="menuitem" data-testid="workflow-ctx-group" @click="openGroup">查看来源组</button>
        </template>
      </div>
    </Teleport>

    <el-dialog
      :model-value="sharedDlg.open"
      :title="sharedDlg.users ? `这个流程有 ${sharedDlg.users} 个源在用` : '这个流程可能有多个源在用'"
      width="480px"
      append-to-body
      data-testid="shared-flow-dialog"
      @update:model-value="(v: boolean) => { if (!v) closeShared('cancel') }"
    >
      <template v-if="sharedDlg.row">
        <p class="swt-dlg-p">
          流程「{{ sharedDlg.row.workflowName }}」#{{ sharedDlg.row.workflowId }}
          {{ sharedDlg.users ? `被 ${sharedDlg.users} 个源共用` : '在用的源数没查到，可能被多个源共用' }}，这次{{ sharedDlg.action === 'publish' ? '发布' : '保存' }}要影响哪些源？只问这一次。
        </p>
        <div class="swt-dlg-opt">
          <b>{{ sharedDlg.action === 'publish' ? '发布' : '保存' }}到共用流程</b>：{{ sharedDlg.users ? `${sharedDlg.users} 个源` : '所有用这条流程的源' }}都按修改后的流程运行
        </div>
        <div class="swt-dlg-opt">
          <b>复制为本源专用</b>：复制一份新流程给当前源，其他源不受影响。
          <template v-if="sharedDlg.action === 'publish'">草稿{{ sharedDraftNo ? ` v${sharedDraftNo} ` : '' }}里的修改会带到新流程，原流程的草稿会放弃。</template>
          <template v-else>画布上的改动和没保存的节点配置都会带过去。</template>
        </div>
      </template>
      <template #footer>
        <el-button @click="closeShared('cancel')">取消</el-button>
        <el-button data-testid="shared-flow-copy" @click="closeShared('copy')">复制为本源专用</el-button>
        <el-button type="primary" data-testid="shared-flow-save" @click="closeShared('save')">{{ sharedDlg.action === 'publish' ? '发布' : '保存' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="unbindDlg.open" :class="{ 'rfd-dialog': followupAction === 'copy' || followupAction === 'bind' }" :title="followupAction === 'new' ? '新建流程' : followupAction === 'copy' || followupAction === 'copy-name' ? '复制流程' : followupAction === 'bind' ? '关联已有流程' : '流程已解绑'" :width="followupAction === 'copy' || followupAction === 'bind' ? 'min(1440px, calc(100vw - 32px))' : '460px'" append-to-body :show-close="!unbindDlg.busy && !adding" :close-on-click-modal="false" :close-on-press-escape="!unbindDlg.busy && !adding" data-testid="workflow-unbind-dialog">
      <div v-if="followupAction === 'choose' || unbindDlg.refreshError" data-testid="workflow-after-unbind">
        <p class="swt-dlg-p">已解绑「{{ unbindDlg.row?.workflowName }}」，流程本身没有删除。</p>
        <p v-if="unbindDlg.busy" class="swt-dlg-p">正在核对当前流程…</p>
        <p v-else-if="unbindDlg.refreshError" class="swt-dlg-warn" data-testid="workflow-after-refresh-error">暂时无法读取最新流程列表，请重新加载后再选择下一步操作。</p>
        <template v-else>
          <p class="swt-dlg-p">当前源暂无可用流程，接下来：</p>
          <div class="swt-followup-actions">
            <el-button data-testid="workflow-after-create" @click="continueAfterUnbind('new')">新建流程</el-button>
            <el-button data-testid="workflow-after-copy" @click="continueAfterUnbind('copy')">复制流程</el-button>
            <el-button type="primary" data-testid="workflow-after-bind" @click="continueAfterUnbind('bind')">关联已有流程</el-button>
          </div>
        </template>
      </div>
      <ReplaceFlowDialog
        v-else-if="followupAction === 'copy' || followupAction === 'bind'"
        :key="followupAction"
        embedded
        :model-value="true"
        :purpose="followupAction"
        :busy="adding"
        :exclude-flow-ids="followupAction === 'bind' ? ownFlowIds : []"
        @update:model-value="followupAction = 'choose'"
        @pick="followupAction === 'copy' ? pickFollowupCopy($event) : reuseExisting($event)"
      />
      <form v-else class="swt-followup-form" data-testid="workflow-followup-form" @submit.prevent="submitFollowup">
        <label>流程名称<input v-model="followupName" class="rc-input" data-testid="workflow-followup-name" :disabled="adding" /></label>
        <label v-if="followupAction === 'new'">所属流程模板
          <select v-model="followupTemplateId" class="rc-input" data-testid="workflow-followup-template" :disabled="adding || followupLoading">
            <option v-for="item in followupTemplates" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <p v-else class="swt-dlg-p">复制「{{ followupPicked?.name }}」的结构和配置，新流程可独立编辑。</p>
        <p v-if="followupLoading" class="swt-dlg-p">正在加载模板…</p>
        <p v-if="followupError" class="swt-dlg-warn">{{ followupError }}</p>
      </form>
      <template v-if="followupAction !== 'copy' && followupAction !== 'bind'" #footer>
        <template v-if="followupAction === 'choose' || unbindDlg.refreshError">
          <el-button :disabled="unbindDlg.busy" data-testid="workflow-after-later" @click="unbindDlg.open = false">稍后处理</el-button>
          <el-button v-if="unbindDlg.refreshError" type="primary" :loading="unbindDlg.busy" data-testid="workflow-after-reload" @click="retryUnbindRefresh">重新加载</el-button>
        </template>
        <template v-else-if="followupAction === 'new' || followupAction === 'copy-name'">
          <el-button :disabled="adding" data-testid="workflow-followup-back" @click="followupAction = followupAction === 'copy-name' ? 'copy' : 'choose'">返回</el-button>
          <el-button type="primary" :loading="adding" :disabled="!followupName.trim() || followupLoading || (followupAction === 'new' && !followupTemplateId)" data-testid="workflow-followup-submit" @click="submitFollowup">{{ followupAction === 'new' ? '创建并打开' : '复制并打开' }}</el-button>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.swt { position: relative; z-index: 18; display: flex; align-items: stretch; min-height: 38px; padding: 0 10px; border-bottom: 1px solid var(--rc-border); background: #f8fafc; }
.swt-scroll { display: flex; flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.swt-tab { display: inline-flex; align-items: center; gap: 5px; max-width: 240px; min-width: 110px; padding: 0 12px; border: 0; border-right: 1px solid var(--rc-border-soft); border-bottom: 2px solid transparent; background: transparent; color: var(--rc-text-2); cursor: pointer; }
.swt-tab:hover { background: #fff; color: var(--rc-primary-ink); }
.swt-tab.active { border-bottom-color: var(--rc-primary); background: #fff; color: var(--rc-primary-ink); }
.swt-name { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.swt-id { flex: none; color: var(--rc-faint); font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.swt-primary, .swt-role { flex: none; padding: 1px 4px; border-radius: 4px; background: #dcfce7; color: #166534; font-size: 10px; }
.swt-role { background: #fef3c7; color: #92400e; }
.swt-version { flex: none; padding: 1px 4px; border-radius: 4px; background: #e2e8f0; color: #475569; font-size: 10px; }
.swt-version.draft { background: #fef3c7; color: #92400e; }
.swt-version-actions { display: flex; align-items: center; margin-left: 7px; }
.swt-version-btn { height: 28px; padding: 0 9px; border: 1px solid #93c5fd; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 11px; cursor: pointer; white-space: nowrap; }
.swt-version-btn.publish { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.swt-version-btn:disabled { opacity: .55; cursor: not-allowed; }
.swt-loading, .swt-empty { align-self: center; padding: 0 12px; color: var(--rc-faint); font-size: 12px; }
.swt-add-wrap { position: relative; display: flex; align-items: center; margin-left: 6px; }
.swt-add { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-primary); font-size: 18px; cursor: pointer; }
.swt-add:hover { border-color: #93c5fd; background: var(--rc-primary-bg); }
.swt-add:disabled { opacity: .55; cursor: wait; }
.swt-add-menu { position: absolute; top: 32px; right: 0; z-index: 40; width: 190px; padding: 5px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; box-shadow: 0 10px 24px rgb(15 23 42 / 14%); }
.swt-add-menu button { display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--rc-text-2); text-align: left; cursor: pointer; }
.swt-add-menu button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.swt-followup-form { display: grid; gap: 16px; }
.swt-followup-form label { display: grid; gap: 8px; font-size: 13px; }
.swt-followup-form .rc-input { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 13px; outline: none; }
.swt-followup-form .rc-input:focus { border-color: var(--rc-primary); }
.swt-followup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.swt-followup-actions :deep(.el-button + .el-button) { margin-left: 0; }
.swt-compat { align-self: center; margin-left: 7px; color: #92400e; font-size: 10px; white-space: nowrap; }
.swt-seg { flex: none; align-self: center; margin: 0 6px 0 2px; padding: 2px 7px; border-radius: 10px; background: #e2e8f0; color: #475569; font-size: 10px; white-space: nowrap; cursor: help; }
.swt-seg.group { background: #ede9fe; color: #6d28d9; }
.swt-tab.group .swt-name { color: #6d28d9; }
.swt-tab.disabled .swt-name, .swt-tab.disabled .swt-id { color: var(--rc-faint); text-decoration: line-through; }
.swt-shared { flex: none; padding: 1px 4px; border-radius: 4px; background: #fef3c7; color: #92400e; font-size: 10px; }
.swt-dlg-opt { margin: 0 0 8px; padding: 8px 10px; border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-size: 13px; line-height: 1.6; }
.swt-disabled { flex: none; padding: 1px 4px; border-radius: 4px; background: #f1f5f9; color: #64748b; font-size: 10px; }
.swt-ctx { position: fixed; z-index: 3000; min-width: 150px; padding: 5px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; box-shadow: 0 10px 24px rgb(15 23 42 / 14%); }
.swt-ctx button { display: block; width: 100%; padding: 7px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 13px; text-align: left; cursor: pointer; }
.swt-ctx button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.swt-ctx button.danger { color: var(--rc-error); }
.swt-ctx button.danger:hover { background: #fef2f2; }
.swt-ctx-note { padding: 6px 10px; color: var(--rc-faint); font-size: 12px; }
.swt-dlg-p { margin: 0 0 8px; color: var(--rc-text-2); font-size: 13px; line-height: 1.6; }
.swt-dlg-warn { margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; background: #fff7ed; color: #9a3412; font-size: 12px; }
</style>
