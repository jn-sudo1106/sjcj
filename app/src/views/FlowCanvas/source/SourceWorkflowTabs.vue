<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, sourceApi, workflowBindingApi, type FlowRecord, type WorkflowBinding } from '@/api'
const localFlowTarget = import.meta.env.VITE_FLOW_PROXY_TARGET
import { useFlowStore } from '@/stores/flow'
import { copyWholeFlow } from '@/utils/flow/copiedConfigs'
import { reportDetachResult } from '@/utils/flow/applyTemplateToSource'
import { makeBlankTemplateDefinition } from '@/utils/flow/flowTemplates'
import ReplaceFlowDialog from '../shared/ReplaceFlowDialog.vue'
import { copyFlowErrorText } from '@/utils/flow/flowPublish'
import FlowVersionBar from '../canvas/FlowVersionBar.vue'

const props = defineProps<{ sourceId: string }>()
const route = useRoute()
const router = useRouter()
const flow = useFlowStore()

const rows = ref<WorkflowBinding[]>([])
const loading = ref(false)
const adding = ref(false)
const addMenuOpen = ref(false)
const copyOpen = ref(false)
const versionBusy = ref(false)
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

async function load() {
  loading.value = true
  try {
    const loaded = await workflowBindingApi.load(props.sourceId)
    rows.value = loaded.rows
    groupId.value = loaded.sourceGroupId ?? ''
  } catch (error) {
    ElMessage.error(`流程页签加载失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    loading.value = false
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
  await load()
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
  try {
    const result = await ElMessageBox.prompt('创建后会新增一个流程标签，可直接在画布和右侧配置区继续编辑。', '新建空白流程', {
      inputValue: `新流程-${new Date().toISOString().slice(0, 10)}`,
      inputPlaceholder: '流程名称',
      inputValidator: value => value.trim() ? true : '请输入流程名称',
      confirmButtonText: '创建并打开',
      cancelButtonText: '取消',
    })
    adding.value = true
    const created = await workflowBindingApi.createForSource({
      sourceId: props.sourceId,
      name: result.value.trim(),
      definition: makeBlankTemplateDefinition(),
      primary: !rows.value.some(row => !row.inherited || row.own),
    })
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
  try {
    const used = picked.sourceCnt ? `正被 ${picked.sourceCnt} 个源使用。` : ''
    await ElMessageBox.confirm(
      `「${picked.name}」${used}复用就是和它们共享同一条流程，修改会影响所有使用它的源；需要独立修改请用「复制现有流程或模板新建」。`,
      '复用现有流程',
      { type: 'warning', confirmButtonText: '复用并打开', cancelButtonText: '取消' },
    )
    adding.value = true
    await workflowBindingApi.bind({ sourceId: props.sourceId, workflowId: picked.id, primary: !rows.value.some(isOwn) })
    ElMessage.success(`已复用流程「${picked.name}」`)
    reuseOpen.value = false
    await finishCreate(picked.id)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`复用失败：${(error as Error)?.message ?? String(error)}`)
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

// 解绑：是主流程且还有别的就在同一个确认框里选新的主流程，一次提交；最后一条也允许，写明后果
const unbindDlg = reactive({ open: false, row: null as WorkflowBinding | null, next: '', busy: false })
const unbindOthers = computed(() => rows.value.filter(row => isOwn(row) && row.workflowId !== unbindDlg.row?.workflowId))
function askUnbind(row: WorkflowBinding) {
  closeMenu()
  unbindDlg.row = row
  unbindDlg.next = rows.value.find(item => isOwn(item) && item.workflowId !== row.workflowId)?.workflowId ?? ''
  unbindDlg.open = true
}
async function confirmUnbind() {
  const row = unbindDlg.row
  if (!row || unbindDlg.busy) return
  unbindDlg.busy = true
  const wasActive = row.workflowId === activeWorkflowId.value
  try {
    await workflowBindingApi.unbind(props.sourceId, row.workflowId, row.primary && unbindDlg.next ? unbindDlg.next : undefined)
    unbindDlg.open = false
    ElMessage.success(`已解绑「${row.workflowName}」，流程本身没有删除`)
    await load()
    if (wasActive) {
      const target = rows.value.find(item => item.primary) ?? rows.value[0]
      if (target) await openFlow(target.workflowId)
      else {
        const { workflowId: _w, flowId: _f, ...rest } = route.query
        await router.replace({ path: '/canvas', query: rest })
      }
    }
  } catch (error) {
    ElMessage.error(`解绑失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    unbindDlg.busy = false
  }
}

async function copyExisting(sourceFlow: FlowRecord) {
  if (adding.value) return
  try {
    const result = await ElMessageBox.prompt(
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
    adding.value = true
    const copied = await copyWholeFlow(sourceFlow.id, result.value.trim(), {
      sourceFlowRef: `流程「${sourceFlow.name}」#${sourceFlow.id}`,
    })
    try {
      await workflowBindingApi.bind({
        sourceId: props.sourceId,
        workflowId: copied.flowId,
        primary: !rows.value.some(row => !row.inherited || row.own),
      })
    } catch (error) {
      throw new Error(`已生成流程 #${copied.flowId}，但关联当前源失败：${(error as Error)?.message ?? String(error)}`)
    }
    reportDetachResult(copied.detach, `原流程「${sourceFlow.name}」`)
    ElMessage.success(`已从「${sourceFlow.name}」创建新流程`)
    copyOpen.value = false
    await finishCreate(copied.flowId)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(copyFlowErrorText((error as Error)?.message ?? String(error)))
  } finally {
    adding.value = false
  }
}

watch(() => props.sourceId, async () => {
  await load()
  const row = activeRow.value
  if (row?.versionManaged === true && !row.draftFlowId) await createDraft(row, { notify: false })
})
onMounted(async () => {
  await load()
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
        <button type="button" data-testid="workflow-create-blank" @click="createBlank">新建空白流程</button>
        <button type="button" data-testid="workflow-reuse-existing" @click="chooseReuse">复用现有流程…</button>
        <button type="button" data-testid="workflow-copy-existing" @click="chooseExisting">复制现有流程或模板新建…</button>
      </div>
    </div>

    <ReplaceFlowDialog
      v-if="copyOpen"
      v-model="copyOpen"
      purpose="copy"
      :current-flow-id="activeFlowId"
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
          <button type="button" role="menuitem" class="danger" data-testid="workflow-ctx-unbind" @click="askUnbind(ctxMenu.row)">解绑流程</button>
        </template>
        <template v-else>
          <div class="swt-ctx-note">来源组流程，请到来源组修改</div>
          <button type="button" role="menuitem" data-testid="workflow-ctx-group" @click="openGroup">查看来源组</button>
        </template>
      </div>
    </Teleport>

    <el-dialog v-model="unbindDlg.open" title="解绑流程" width="460px" append-to-body data-testid="workflow-unbind-dialog">
      <template v-if="unbindDlg.row">
        <p class="swt-dlg-p">解除当前源与「{{ unbindDlg.row.workflowName }}」#{{ unbindDlg.row.workflowId }} 的关联。流程本身不删除，其他使用它的源不受影响。</p>
        <template v-if="unbindDlg.row.primary && unbindOthers.length">
          <p class="swt-dlg-p">这是主流程，解绑后改用：</p>
          <label v-for="other in unbindOthers" :key="other.workflowId" class="swt-dlg-radio">
            <input v-model="unbindDlg.next" type="radio" :value="other.workflowId" data-testid="workflow-unbind-next">
            {{ other.workflowName }} <span class="swt-id">#{{ other.workflowId }}</span>
          </label>
        </template>
        <p v-if="!unbindOthers.length" class="swt-dlg-warn" data-testid="workflow-unbind-last">
          这是最后一条流程：解绑后这个源将没有任何流程，无法发起任务。
        </p>
      </template>
      <template #footer>
        <el-button @click="unbindDlg.open = false">取消</el-button>
        <el-button type="danger" :loading="unbindDlg.busy" data-testid="workflow-unbind-ok" @click="confirmUnbind">解绑</el-button>
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
.swt-compat { align-self: center; margin-left: 7px; color: #92400e; font-size: 10px; white-space: nowrap; }
.swt-seg { flex: none; align-self: center; margin: 0 6px 0 2px; padding: 2px 7px; border-radius: 10px; background: #e2e8f0; color: #475569; font-size: 10px; white-space: nowrap; cursor: help; }
.swt-seg.group { background: #ede9fe; color: #6d28d9; }
.swt-tab.group .swt-name { color: #6d28d9; }
.swt-tab.disabled .swt-name, .swt-tab.disabled .swt-id { color: var(--rc-faint); text-decoration: line-through; }
.swt-disabled { flex: none; padding: 1px 4px; border-radius: 4px; background: #f1f5f9; color: #64748b; font-size: 10px; }
.swt-ctx { position: fixed; z-index: 3000; min-width: 150px; padding: 5px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; box-shadow: 0 10px 24px rgb(15 23 42 / 14%); }
.swt-ctx button { display: block; width: 100%; padding: 7px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 13px; text-align: left; cursor: pointer; }
.swt-ctx button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.swt-ctx button.danger { color: var(--rc-error); }
.swt-ctx button.danger:hover { background: #fef2f2; }
.swt-ctx-note { padding: 6px 10px; color: var(--rc-faint); font-size: 12px; }
.swt-dlg-p { margin: 0 0 8px; color: var(--rc-text-2); font-size: 13px; line-height: 1.6; }
.swt-dlg-radio { display: flex; align-items: center; gap: 6px; margin: 4px 0 4px 4px; font-size: 13px; cursor: pointer; }
.swt-dlg-warn { margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; background: #fff7ed; color: #9a3412; font-size: 12px; }
</style>
