<script setup lang="ts">
// 流程「使用源数」下钻：列出挂在该流程下的源，操作对齐旧平台「流程源列表」。
// 2026-10-21 起也是「关联到源」弹窗的「已关联」页签（embedded）：解绑、更换都在这里做，删除流程不再处理源
// （方案 设计稿/设计方案/1021-流程中心_使用源数排序与关联源管理_设计方案_2026-10-21.md）。
// - 来源组带来的关联（源有 sourceGroupId）标「来源组」、不可勾选：单个源上解不掉，要去「我的分组」改；
// - 更换沿用 changeFlowBatch 口径：flowId=目标、currentFlowId=本流程，只换本流程这一条关联；
// - 全部解绑 / 更换按当前搜索范围分批提交，任一批失败即停、已成功的不回滚。
//
// 走 sourcePaged 的 flowId 过滤——2026-09-02 生产实测确认后端认这个条件（无条件 16929 条，
// flowId=1400330 得 46 条且与该流程 sourceCnt 一致，传不存在的 flowId 得 0 条），不是静默忽略。
// 服务端分页：单个流程下最多见过 5439 个源（流程 1400976），不能赌 size 上限。
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElDialog, ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, sourceApi, workflowBindingApi, type FlowRecord, type Source } from '@/api'
import { useSourceGroupNames } from './sourceGroupNames'

const props = defineProps<{
  flow: FlowRecord | null
  /** 上层关联完源后 +1，触发本弹窗重查 */
  refreshTick?: number
  /** 嵌在「关联到源」弹窗的「已关联」页签里：不渲染自己的弹窗外壳，也不放「关联源」按钮（另一个页签就是） */
  embedded?: boolean
}>()
const emit = defineEmits<{
  close: []
  apply: []
  changed: []
  /** 源都解绑 / 更换走了，用户点「删除流程」 */
  delete: []
  /** 每次加载完报一下当前（搜索范围内的）关联源数，外壳页签上显示 */
  count: [number]
}>()

const BATCH = 500
const COLLECT_PAGE = 1000

const router = useRouter()
const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const error = ref('')
const unbinding = ref('')

// ---- 勾选 / 批量 ----
const selected = ref(new Set<string>())
/** 来源组带来的关联：源在来源组里，统一用组的流程，单个源上解绑 / 更换不掉 */
const isGroupRow = (s: Source) => !!s.sourceGroupId
// 1021-04：「所属来源组」单独一列，组名可点跳我的分组
const { loadGroupNames, groupNameOf, openSourceGroup } = useSourceGroupNames()
void loadGroupNames()
const pickableRows = computed(() => rows.value.filter((r) => !isGroupRow(r)))
const pageAllPicked = computed(() => pickableRows.value.length > 0 && pickableRows.value.every((r) => selected.value.has(r.sourceId)))
function togglePick(id: string, on: boolean) {
  const next = new Set(selected.value)
  if (on) next.add(id)
  else next.delete(id)
  selected.value = next
}
function togglePage(on: boolean) {
  const next = new Set(selected.value)
  pickableRows.value.forEach((r) => (on ? next.add(r.sourceId) : next.delete(r.sourceId)))
  selected.value = next
}
const busy = ref(false)
const progress = ref('')
/** 解绑完 / 换走完、列表空了且没在搜索：可以去删流程了 */
const emptiedNow = ref(false)

const keyword = ref('')
const appliedKeyword = ref('')

async function load() {
  const flow = props.flow
  if (!flow) return
  loading.value = true
  error.value = ''
  try {
    const query = appliedKeyword.value.trim()
    const result = await sourceApi.sourcePaged({
      flowId: flow.id,
      page: page.value,
      size: size.value,
      // 旧平台的「源名称或ID搜索」：纯数字当源 ID 查，其余按名称查，两个条件同时传后端按「并且」算
      ...(query ? (/^\d+$/.test(query) ? { sourceId: query } : { name: query }) : {}),
    })
    rows.value = result.list
    total.value = result.total
    if (!appliedKeyword.value.trim()) emit('count', result.total)
  } catch (e) {
    rows.value = []
    total.value = 0
    error.value = `关联源加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}

function applySearch() {
  appliedKeyword.value = keyword.value
  page.value = 1
  void load()
}

let lastFlowId = ''

watch(
  () => [props.flow?.id, props.refreshTick] as const,
  ([id]) => {
    if (!id) return
    if (id !== lastFlowId) {
      keyword.value = ''
      appliedKeyword.value = ''
      lastFlowId = id
    }
    page.value = 1
    rows.value = []
    selected.value = new Set()
    emptiedNow.value = false
    void load()
  },
  { immediate: true },
)

function onSizeChange() {
  page.value = 1
  void load()
}

function openSource(source: Source) {
  emit('close')
  void router.push({
    path: '/canvas',
    query: { ...(source.siteId ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view: 'data' },
  })
}

/**
 * 解绑后会一条流程都不剩的源（1021-08：允许解绑到没有流程，但要写明后果）。
 * 逐个读 sourceFlows，只看源自己的流程正好只剩本流程；超过 ORPHAN_CHECK_MAX 个不查（返回 null），确认框给通用提示。
 */
const ORPHAN_CHECK_MAX = 200
async function orphanedBy(ids: string[], flowId: string): Promise<string[] | null> {
  if (ids.length > ORPHAN_CHECK_MAX) return null
  const orphaned = new Set<string>()
  let next = 0
  try {
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++]
        const view = await workflowBindingApi.view(id)
        if (view.ownFlowIds.length === 1 && view.ownFlowIds[0] === flowId) orphaned.add(id)
      }
    }))
  } catch {
    return null
  }
  return ids.filter((id) => orphaned.has(id))
}
const NO_FLOW_NOTE = '只关联了本流程的源解绑后将没有任何流程，无法发起任务。'
function orphanNote(orphaned: string[] | null): string {
  if (orphaned === null) return `\n${NO_FLOW_NOTE}`
  if (!orphaned.length) return ''
  const head = orphaned.slice(0, 10).join('、')
  return `\n其中 ${orphaned.length} 个源只关联了本流程，解绑后将没有任何流程，无法发起任务：${head}${orphaned.length > 10 ? ' 等' : ''}`
}

async function unbind(source: Source) {
  const flow = props.flow
  if (!flow) return
  const label = source.name || source.sourceId
  const orphaned = await orphanedBy([source.sourceId], flow.id)
  try {
    await ElMessageBox.confirm(
      `将把源「${label}」（${source.sourceId}）从流程「${flow.name}」上解绑。`
      + (orphaned?.length
        ? '这是它唯一的流程：解绑后这个源将没有任何流程，无法发起任务。继续？'
        : `解绑后这个源不再按该流程的配置运行；${orphaned ? '它关联的其它流程不受影响' : '如果它只关联了本流程，解绑后将没有任何流程'}。继续？`),
      '解绑关联',
      { type: 'warning', confirmButtonText: '确认解绑', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  unbinding.value = source.sourceId
  try {
    // flowId 不传（=0）+ currentFlowId 传本流程：只断这一条关联，源关联的其它流程不受影响
    const ack = await flowCenterApi.bindSources([source.sourceId], undefined, flow.id)
    if (!ack.ok) throw new Error(ack.message || '未知原因')
    ElMessage.success(`已把源「${label}」从流程「${flow.name}」上解绑`)
    emit('changed')
    await load()
  } catch (e) {
    ElMessage.error(`解绑失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    unbinding.value = ''
  }
}

/**
 * 「在源视图中查看全部」（0904 I16 / Z7-2）。走查原话：
 * 「如果有 7 个怎么办？你要一个一个点过来嘛，还是点查看全部……你的详情里面点查看全部
 *  就把全部带过来，然后你点一个，他如果一个就可以点」。
 *
 * **两个边界**：
 * 1. 源视图锁死在单网站内（0812 纠偏），而一个流程的关联源理论上可跨网站
 *    （`cs_flow.siteId` 只是流程自己的登记值，不是源的归属）。跨网站时不做聚合视图——
 *    那违反源视图的边界——降级成提示，让用户在这个清单里逐个进。
 * 2. **不把源 ID 拼进 URL**：一个流程最多见过 5439 个源（流程 1400976）。改传 flowId，
 *    源视图那边按服务端条件筛（sourcePaged 认这个条件，见文件头注释）。
 */
function openAllInSourceView() {
  const flow = props.flow
  if (!flow) return
  const sites = [...new Set(rows.value.map((r) => r.siteId).filter(Boolean))] as string[]
  if (!sites.length) {
    ElMessage.warning('这批源没有回填所属网站，无法定位到源视图，请在下面的清单里逐个进入')
    return
  }
  if (sites.length > 1) {
    ElMessage.warning(`该流程的源跨 ${sites.length} 个网站，源视图一次只能看一个网站，请在下面的清单里逐个进入`)
    return
  }
  emit('close')
  void router.push({ path: '/canvas', query: { siteId: sites[0], view: 'source', flowId: flow.id } })
}

/** 当前搜索范围内、可操作（非来源组）的全部源 ID：分页取完，单个流程见过 5439 个源 */
async function collectScopeIds(): Promise<{ ids: string[]; groupSkipped: number }> {
  const flow = props.flow!
  const query = appliedKeyword.value.trim()
  const ids: string[] = []
  let groupSkipped = 0
  for (let p = 1; ; p++) {
    const res = await sourceApi.sourcePaged({
      flowId: flow.id, page: p, size: COLLECT_PAGE,
      ...(query ? (/^\d+$/.test(query) ? { sourceId: query } : { name: query }) : {}),
    })
    res.list.forEach((s) => (isGroupRow(s) ? groupSkipped++ : ids.push(s.sourceId)))
    if (res.list.length < COLLECT_PAGE || p * COLLECT_PAGE >= res.total) break
  }
  return { ids: [...new Set(ids)], groupSkipped }
}

/** 分批调 changeFlowBatch。任一批失败就停下，已成功的不回滚；返回成功条数 */
async function runBatches(ids: string[], targetFlowId: string | undefined): Promise<number> {
  const flow = props.flow!
  let done = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    if (ids.length > BATCH) progress.value = `已处理 ${done} / ${ids.length}`
    const ack = await flowCenterApi.bindSources(chunk, targetFlowId, flow.id)
    if (!ack.ok) {
      throw Object.assign(new Error(ack.message || '未知原因'), { done })
    }
    done += chunk.length
  }
  return done
}

const flowName = computed(() => props.flow?.name ?? '')
async function afterBatch() {
  selected.value = new Set()
  progress.value = ''
  emit('changed')
  page.value = 1
  await load()
  emptiedNow.value = !appliedKeyword.value.trim() && total.value === 0
}

/** 解绑 / 更换。scope='selected' 用勾选；'all' 用当前搜索范围的全部（跳过来源组） */
async function apply(action: 'unbind' | 'replace', scope: 'selected' | 'all', target?: { id: string; name: string }) {
  if (!props.flow || busy.value) return
  busy.value = true
  try {
    let ids = [...selected.value]
    let groupSkipped = 0
    if (scope === 'all') {
      progress.value = '正在读取关联源…'
      ;({ ids, groupSkipped } = await collectScopeIds())
      progress.value = ''
    }
    if (!ids.length) {
      ElMessage.warning(groupSkipped ? `范围里的 ${groupSkipped} 个源都是随来源组关联的，请到「我的分组」里处理` : '没有可处理的源')
      return
    }
    const what = action === 'unbind'
      ? `从流程「${flowName.value}」解绑 ${ids.length} 个源。解绑后这些源不再按本流程运行；它们关联的其它流程不受影响。`
      : `把 ${ids.length} 个源从流程「${flowName.value}」更换到流程「${target!.name}」（#${target!.id}）。`
    if (action === 'unbind') progress.value = '正在检查解绑后有没有源会没有流程…'
    const orphaned = action === 'unbind' ? await orphanedBy(ids, props.flow.id) : []
    progress.value = ''
    const extra = (action === 'unbind' ? orphanNote(orphaned) : '')
      + (groupSkipped ? `\n另有 ${groupSkipped} 个随来源组关联的源会跳过。` : '')
      + (ids.length > BATCH ? `\n将分 ${Math.ceil(ids.length / BATCH)} 批提交，中途失败会停下，已完成的不撤销。` : '')
    try {
      await ElMessageBox.confirm(what + extra, action === 'unbind' ? '解绑关联' : '更换流程', { type: 'warning', confirmButtonText: action === 'unbind' ? '确认解绑' : '确认更换', cancelButtonText: '取消' })
    } catch {
      return
    }
    try {
      const done = await runBatches(ids, action === 'replace' ? target!.id : undefined)
      ElMessage.success(action === 'unbind' ? `已解绑 ${done} 个源` : `已把 ${done} 个源更换到流程「${target!.name}」`)
    } catch (e) {
      const done = (e as { done?: number }).done ?? 0
      ElMessage.error(`${action === 'unbind' ? '解绑' : '更换'}失败：${(e as Error).message}${done ? `（前 ${done} 个已完成，不会撤销）` : ''}`)
    }
    await afterBatch()
  } catch (e) {
    progress.value = ''
    ElMessage.error(`读取关联源失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    busy.value = false
  }
}

// 更换目标：选一条别的流程（远程搜索，排除本流程）
const replaceDlg = reactive({ open: false, scope: 'selected' as 'selected' | 'all', targetId: '', loading: false, options: [] as { id: string; name: string }[] })
async function searchTargets(q: string) {
  replaceDlg.loading = true
  try {
    const res = await flowCenterApi.paged({ page: 1, size: 30, ...(/^\d+$/.test(q.trim()) ? { flowIds: [q.trim()] } : { keywords: q.trim() || undefined }) })
    replaceDlg.options = res.list.filter((f) => f.id !== props.flow?.id).map((f) => ({ id: f.id, name: f.name }))
  } catch {
    replaceDlg.options = []
  } finally {
    replaceDlg.loading = false
  }
}
function openReplace(scope: 'selected' | 'all') {
  replaceDlg.scope = scope
  replaceDlg.targetId = ''
  replaceDlg.open = true
  void searchTargets('')
}
async function confirmReplace() {
  const target = replaceDlg.options.find((o) => o.id === replaceDlg.targetId)
  if (!target) { ElMessage.warning('请选择要更换到的流程'); return }
  replaceDlg.open = false
  await apply('replace', replaceDlg.scope, target)
}

/**
 * 「状态」列只读源自己的 `state`：只有 `E` 是出错，其余（C/L/空/停用）一律「正常」
 * （老平台同口径——源名只在 `state === 'E'` 时标红，L 不单列一态）。
 * 停用由旁边的「启停」列单独表达，不再用 `disabled` 顶掉 `state`（2026-10-16 用户确认）。
 * 启停只读展示、不在这里切换（1016 评审）：这里切的是整个源，源挂的其它流程也会一起停，
 * 在「某流程的关联源」里点容易误解成只停本流程；启停统一回源管理列表做。
 */
function stateText(source: Source) {
  return source.state === 'E' ? '出错' : '正常'
}

function textOf(value: unknown) {
  return value == null || value === '' ? '—' : String(value)
}

const emptyText = computed(() => (appliedKeyword.value.trim() ? '没有匹配的源' : '该流程下没有关联的源'))
</script>

<template>
  <component
    :is="embedded ? 'div' : ElDialog"
    v-bind="embedded ? { class: 'fs-embedded' } : { modelValue: !!flow, title: flow ? `流程「${flow.name}」的关联源` : '', width: '980px', style: 'max-width: calc(100vw - 32px)', destroyOnClose: true }"
    @close="emit('close')"
  >
    <div class="fs-toolbar">
      <input
        v-model="keyword"
        class="fs-input"
        data-testid="flow-sources-keyword"
        placeholder="源名称或ID搜索"
        aria-label="源名称或ID搜索"
        @keyup.enter="applySearch"
      >
      <button class="rc-btn" type="button" data-testid="flow-sources-search" @click="applySearch">查询</button>
      <span class="fs-batch" data-testid="flow-sources-batch">
        <template v-if="selected.size">
          <span class="fs-picked">已选 {{ selected.size }}</span>
          <button class="rc-btn" type="button" :disabled="busy" data-testid="flow-sources-unbind-selected" @click="apply('unbind', 'selected')">解绑</button>
          <button class="rc-btn" type="button" :disabled="busy" data-testid="flow-sources-replace-selected" @click="openReplace('selected')">更换到其他流程</button>
          <button class="fs-op" type="button" @click="selected = new Set()">取消勾选</button>
        </template>
        <template v-else-if="total">
          <button class="rc-btn" type="button" :disabled="busy" data-testid="flow-sources-unbind-all" :title="appliedKeyword.trim() ? '按当前搜索范围' : '本流程的全部关联源'" @click="apply('unbind', 'all')">全部解绑</button>
          <button class="rc-btn" type="button" :disabled="busy" data-testid="flow-sources-replace-all" :title="appliedKeyword.trim() ? '按当前搜索范围' : '本流程的全部关联源'" @click="openReplace('all')">全部更换</button>
        </template>
        <span v-if="progress" class="fs-progress" data-testid="flow-sources-progress">{{ progress }}</span>
      </span>
      <button v-if="!embedded" class="rc-btn primary" type="button" data-testid="flow-sources-apply" @click="emit('apply')">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
        关联源
      </button>
    </div>
    <div v-if="error || total > 1" class="fs-head">
      <span v-if="error" class="fs-error">{{ error }}</span>
      <button
        v-if="!error && total > 1"
        class="fs-viewall"
        type="button"
        data-testid="flow-sources-view-all"
        @click="openAllInSourceView"
      >在源视图中查看全部 →</button>
    </div>
    <div class="fs-table-wrap" v-loading="loading">
      <table class="fs-table">
        <thead>
          <tr>
            <th style="width: 36px"><input type="checkbox" :checked="pageAllPicked" :disabled="!pickableRows.length" aria-label="全选本页" data-testid="flow-sources-pick-page" @change="togglePage(($event.target as HTMLInputElement).checked)"></th>
            <th>源 ID / 名称</th>
            <th style="width: 120px">所属来源组</th>
            <th style="width: 64px">状态</th>
            <th style="width: 64px">启停</th>
            <th style="width: 60px">告警</th>
            <th style="width: 88px">数据量</th>
            <th style="width: 150px">最近抓取 / 成功</th>
            <th style="width: 64px">步骤数</th>
            <th style="width: 64px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in rows" :key="s.sourceId" data-testid="flow-source-row" :class="{ picked: selected.has(s.sourceId) }">
            <td>
              <input
                type="checkbox"
                :checked="selected.has(s.sourceId)"
                :disabled="isGroupRow(s)"
                :title="isGroupRow(s) ? '随来源组关联，请到「我的分组」里处理' : ''"
                :aria-label="`勾选 ${s.name || s.sourceId}`"
                data-testid="flow-source-pick"
                @change="togglePick(s.sourceId, ($event.target as HTMLInputElement).checked)"
              >
            </td>
            <td>
              <button class="fs-name" type="button" :title="s.name || s.sourceId" @click="openSource(s)">
                <b>{{ s.name || s.sourceId }}</b>
                <small>{{ s.sourceId }}</small>
              </button>
            </td>
            <td class="fs-group-cell">
              <button v-if="s.sourceGroupId" class="fs-group-link" type="button" :title="`随来源组关联，到「我的分组」查看 ${groupNameOf(s.sourceGroupId)}`" data-testid="flow-source-group-name" @click="openSourceGroup(s.sourceGroupId)">{{ groupNameOf(s.sourceGroupId) }}</button>
              <span v-else class="fs-muted">—</span>
            </td>
            <td data-testid="flow-source-state" :class="{ 'fs-state-err': s.state === 'E' }">{{ stateText(s) }}</td>
            <td>
              <span class="fs-enable" :class="{ off: s.disabled }" data-testid="flow-source-enable-tag">{{ s.disabled ? '已停用' : '启用' }}</span>
            </td>
            <td>
              <span v-if="s.alarm" class="fs-alarm" data-testid="flow-source-alarm">告警</span>
              <span v-else class="fs-muted">—</span>
            </td>
            <td class="fs-muted">{{ s.dataCount == null ? '—' : s.dataCount.toLocaleString() }}</td>
            <td class="fs-muted fs-times">
              <span :title="`最近抓取：${textOf(s.lastTaskAt)}`">{{ textOf(s.lastTaskAt) }}</span>
              <span :title="`最近成功：${textOf(s.lastSuccessAt)}`">{{ textOf(s.lastSuccessAt) }}</span>
            </td>
            <td class="fs-muted">{{ s.stepCount == null ? '—' : s.stepCount }}</td>
            <td>
              <span v-if="isGroupRow(s)" class="fs-muted" title="随来源组关联，请到「我的分组」里处理">—</span>
              <button
                v-else
                class="fs-op danger"
                type="button"
                data-testid="flow-source-unbind"
                :disabled="unbinding === s.sourceId || busy"
                @click="unbind(s)"
              >解绑</button>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td colspan="10" class="fs-empty">
              {{ error || emptyText }}
              <div v-if="emptiedNow" class="fs-emptied" data-testid="flow-sources-emptied">
                已经没有关联源，可以删除流程了
                <button class="rc-btn" type="button" data-testid="flow-sources-delete-flow" @click="emit('delete')">删除流程</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="fs-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="load"
        @size-change="onSizeChange"
      />
    </div>
    <el-dialog v-model="replaceDlg.open" :title="replaceDlg.scope === 'all' ? '全部更换到其他流程' : `把 ${selected.size} 个源更换到其他流程`" width="460px" append-to-body data-testid="flow-sources-replace-dialog">
      <el-select
        v-model="replaceDlg.targetId"
        filterable
        remote
        :remote-method="searchTargets"
        :loading="replaceDlg.loading"
        placeholder="搜索流程名称或 ID"
        style="width: 100%"
        data-testid="flow-sources-replace-target"
      >
        <el-option v-for="o in replaceDlg.options" :key="o.id" :label="`${o.name}（#${o.id}）`" :value="o.id" />
      </el-select>
      <p class="fs-hint">只换本流程这一条关联（沿用 changeFlowBatch 口径），源关联的其它流程不受影响。</p>
      <template #footer>
        <el-button @click="replaceDlg.open = false">取消</el-button>
        <el-button type="primary" :disabled="!replaceDlg.targetId" data-testid="flow-sources-replace-ok" @click="confirmReplace">更换</el-button>
      </template>
    </el-dialog>
  </component>
</template>

<style scoped>
.fs-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.fs-input { width: 240px; height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; }
.fs-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.fs-toolbar .rc-btn { height: 28px; padding: 0 12px; font-size: 12px; }
.fs-viewall { margin-left: auto; border: 0; background: transparent; color: var(--rc-primary, #2563eb); font-size: 12px; cursor: pointer; }
.fs-viewall:hover { text-decoration: underline; }
.fs-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; color: var(--rc-muted); font-size: 12px; }
.fs-error { color: var(--rc-error, #dc2626); }
.fs-table-wrap { max-height: 420px; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; }
/* fixed 布局是源名称截断生效的前提：auto 布局下该列会被长名字撑开，text-overflow 也不生效 */
.fs-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
.fs-table th { position: sticky; top: 0; z-index: 1; padding: 9px 12px; background: var(--rc-bg, #f8fafc); color: var(--rc-muted); font-weight: 700; text-align: left; border-bottom: 1px solid var(--rc-border); white-space: nowrap; }
.fs-table td { padding: 9px 12px; border-bottom: 1px solid var(--rc-border-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-table tbody tr:hover { background: var(--rc-primary-bg); }
.fs-name { display: block; width: 100%; padding: 0; border: 0; background: none; overflow: hidden; text-align: left; cursor: pointer; }
.fs-name b { display: block; overflow: hidden; color: var(--rc-primary); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.fs-name small { display: block; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fs-alarm { padding: 2px 8px; border-radius: 999px; background: var(--rc-error-bg, #fef2f2); color: var(--rc-error, #dc2626); font-size: 11px; font-weight: 600; }
/* 启停只读展示：启用走主色、停用走中性灰（AGENTS.md 控件视觉约定），不用彩色胶囊 */
.fs-enable { color: var(--rc-primary); }
.fs-enable.off { color: var(--rc-faint); }
.fs-state-err { color: var(--rc-error); }
.fs-times span { display: block; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; }
.fs-muted { color: var(--rc-faint); white-space: nowrap; }
.fs-op { padding: 0; border: 0; background: none; color: var(--rc-primary, #2563eb); font-size: 12px; cursor: pointer; }
/* 操作列纯文字按钮：hover 不再加下划线（老平台这颗也是纯文字），保持只有手型光标 */
.fs-op:disabled { color: var(--rc-faint); cursor: default; }
/* 解绑：危险色走 --rc-error 令牌。
   font-weight 必须显式归位——class 里的 danger 会命中全局 tokens.css:452 的 `.danger { font-weight: 700 }`，
   那是给状态文字用的，套在操作按钮上会变粗体 */
.fs-op.danger { color: var(--rc-error); font-weight: 400; }
.fs-empty { padding: 36px; text-align: center; color: var(--rc-faint); }
.fs-emptied { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; color: var(--rc-text-2); }
.fs-batch { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.fs-batch .rc-btn { height: 28px; padding: 0 12px; font-size: 12px; }
.fs-picked { color: var(--rc-primary); font-size: 12px; font-weight: 600; }
.fs-progress { color: var(--rc-muted); font-size: 12px; }
.fs-group-cell { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-group-link { max-width: 100%; padding: 0; overflow: hidden; border: 0; background: none; color: var(--rc-primary-ink); cursor: pointer; text-overflow: ellipsis; white-space: nowrap; }
.fs-group-link:hover { text-decoration: underline; }
.fs-table tbody tr.picked { background: var(--rc-primary-bg); }
.fs-hint { margin: 8px 0 0; color: var(--rc-faint); font-size: 12px; }
.fs-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 0 0; }
</style>
