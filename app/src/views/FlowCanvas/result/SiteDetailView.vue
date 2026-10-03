<script setup lang="ts">
// 网站详情页（0812 计划 M1-2/M1-4 纠偏）：网站汇总态只读聚合源/数据/文件/任务/监控视图，
// 没有流程视图（网站本身没有可编辑的单一流程）。
//
// ⚠️ 任务视图（0915-05，2026-09-16）**推翻了 0812「网站汇总态没有任务页签」的结论**：
// 当时定的是"任务只在具体源和一级任务中心查看"，0915 会上产品指出这条走不通——
// 发完任务不知道跑在哪个源上，而任务中心又不区分网站。所以这里聚合看本站全部源的任务。
// 不再悄悄加载"代表源"：网站下可能有多张表、多个流程，拿第一个源的节点/表结构
// 冒充整个网站会得到错误结果（0812 会议结论）。数据/文件视图按 siteId 查询的真实实现见
// M2/M3；在那之前网站汇总态的数据/文件页签展示"开发中"占位，不渲染依赖 flow.sourceCtx
// 的旧 ResultView/FileView，避免用一个空的/串味的 flow.sourceCtx 发出错误查询。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { siteApi, type Site, type Source } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useWorkspaceStore } from '@/stores/workspace'
import { normalizeSiteMonitorTab, normalizeSiteView, type SiteMonitorTab, type SiteWorkspaceView } from '@/utils/url/workspaceRoute'
import SourceOverviewView from './SourceOverviewView.vue'
import SiteDataView from './SiteDataView.vue'
import SiteTablesOverview from './SiteTablesOverview.vue'
import SiteFileView from './SiteFileView.vue'
import SiteMonitorView from './SiteMonitorView.vue'
import TaskView from './TaskView.vue'

const props = defineProps<{ siteId: string }>()
const ws = useWorkspaceStore()
const route = useRoute()
const router = useRouter()

// 数据视图「按条件查源」跳过来时 URL 上带的那批源 ID（0903 Y2-4）。
//
// ⚠️ **必须 watch，不能只在 setup 里读一次**：从本页的数据视图点「在源视图中打开」时，
// 路由只是 query 变了（view=data → view=source + sourceIds），本组件**没有重新挂载**，
// setup 不会再跑一遍。只读一次的话 URL 上带着 ID、界面上却一个都没填——
// 更坑的是网站源数恰好等于命中数时看起来"像是生效了"（实测踩到：都是 20）。
//
// 读到就从 URL 上抹掉：留着的话用户在源视图改了别的条件再刷新，又会被这批旧 ID 拉回去。
/**
 * 单源数据视图「按条件查源 →」带过来的数据条件（0903 Y2-7）。
 * 与 initialSourceIds 同一套做法：在这里解析路由、读完抹掉 URL，子组件只收 prop
 * （SiteDataView 的测试是裸挂载，没装 router）。
 */
const initialCondition = ref<{ tableId: string; sql?: string; state?: string; dataId?: string; parentId?: string } | null>(null)
watch(() => route.query.condTable, (raw) => {
  const tableId = String(raw ?? '').trim()
  if (!tableId) return
  const q = route.query
  initialCondition.value = {
    tableId,
    sql: q.condSql ? String(q.condSql) : undefined,
    state: q.condState ? String(q.condState) : undefined,
    dataId: q.condDataId ? String(q.condDataId) : undefined,
    parentId: q.condParentId ? String(q.condParentId) : undefined,
  }
  const next: Record<string, unknown> = { ...q }
  for (const k of ['condTable', 'condSql', 'condState', 'condDataId', 'condParentId']) delete next[k]
  // 数据表模式（默认）下表由地址栏 tableId 决定，没带就落到「全部」汇总、数据视图不挂载，
  // 带过来的条件就丢了——所以把这张表也写进 tableId，左栏跟着选中它
  next.tableId = tableId
  void router.replace({ path: route.path, query: next as Record<string, string> })
}, { immediate: true })

const initialSourceIds = ref('')
watch(() => route.query.sourceIds, (raw) => {
  const ids = String(raw ?? '').trim()
  if (!ids) return
  initialSourceIds.value = ids
  const next = { ...route.query }
  delete next.sourceIds
  void router.replace({ path: route.path, query: next })
}, { immediate: true })
/** 流程中心「查看全部关联源」带过来的流程 ID（0904 I16 / Z7-2）。与 sourceIds 同一套做法：
 *  在这里解析、读完抹掉 URL，子组件只收 prop。 */
const initialFlowId = ref('')
watch(() => route.query.flowId, (raw) => {
  const id = String(raw ?? '').trim()
  if (!id) return
  initialFlowId.value = id
  const next = { ...route.query }
  delete next.flowId
  void router.replace({ path: route.path, query: next })
}, { immediate: true })

const flow = useFlowStore()

const site = ref<Site | null>(null)
const loadError = ref('')
/**
 * site/detail **请求失败**（超时、5xx）——跟上面「返回空＝网站不存在」分开处理（2026-09-23）。
 *
 * 原来 siteDetail 一抛异常 load 就直接冒泡，标题停在「网站详情」、没有提示也不能重试
 * （用户在站 89 撞到过）。这时**不**把整块换成错误态：下面五个视图各有各的接口，
 * 不依赖网站详情，那次右侧源视图就照常列出了 1368 个源。只在标题旁给个重试。
 */
const detailFailed = ref(false)
/**
 * 标题：自己的详情拿不到时，退而用页签上的网站名——左侧源栏也会取一次详情并补页签名，
 * 那边重试成功，这里跟着就有名字了，不用两处各点一次。页签名还是裸 siteId 时不算数。
 */
const title = computed(() => {
  if (site.value?.name) return site.value.name
  const tabName = ws.siteTabs.find((t) => t.siteId === props.siteId)?.name
  return tabName && tabName !== props.siteId ? tabName : '网站详情'
})

// 过期请求保护：快速切换网站时，先发出的旧请求若比后发出的新请求更晚 resolve，
// 不能用旧网站的数据覆盖新网站已经展示的标题/上下文。
let loadSeq = 0
async function load() {
  const requestId = ++loadSeq
  loadError.value = ''
  detailFailed.value = false
  let siteDetail: Site | null
  try {
    siteDetail = await siteApi.siteDetail(props.siteId)
  } catch {
    if (requestId !== loadSeq) return
    // 别留着上一个网站的名字和分类
    site.value = null
    detailFailed.value = true
    return
  }
  if (requestId !== loadSeq) return
  // 0915-02：页签先用 siteId 占位，详情回来后换成网站名。
  // 必须放在过期守卫**之后**：快速切网站时旧请求后到，会用旧网站的名字盖掉新页签。
  if (siteDetail?.name) ws.ensureSiteTab(props.siteId, siteDetail.name)
  // 网站态不再注入任何代表源；只有用户点进具体源（openSource）才加载该源的流程。
  flow.clearSourceCtx()
  flow.setSiteDisplayCtx(siteDetail ?? null)
  site.value = siteDetail
  if (!siteDetail) loadError.value = '网站不存在或加载失败，请重试'
}
onMounted(load)
watch(() => props.siteId, load)
// 从网站详情切到源时，旧页面的异步加载不能再回写状态，避免覆盖新路由对应的源。
onUnmounted(() => {
  loadSeq += 1
})

const ui = useUiStore()
const view = computed(() => normalizeSiteView(route.query.view))
/** 左栏数据表模式选中的表（0924-10）：模式在 ui store，表在地址栏 tableId */
const lockedTableId = computed(() => (ui.siteDataSideMode === 'table' ? String(route.query.tableId ?? '') : ''))
/** 数据表模式选的是「全部」（地址栏没带表）：中间显示各表汇总，不挂数据视图 */
const showTablesOverview = computed(() => ui.siteDataSideMode === 'table' && !lockedTableId.value)
function openTableFromOverview(tableId: string) {
  void router.replace({ path: '/canvas', query: { ...route.query, siteId: props.siteId, view: 'data', tableId } })
}
// 0915-02：记住停在哪个视图——点源页签走开再点回「全部」，回到的是原来那个视图而不是默认源视图。
//
// ⚠️ 必须跳过"已经切到具体源"的那一拍：点源时路由先变成 `sourceId=…&view=data`，本组件
// 卸载前 watch 还会响应一次，而 `normalizeSiteView('flow')` 落到默认值 'source'——
// 快照会被这一拍覆盖成 source，点回「全部」就回不到原来的数据视图了（2026-09-16 实机踩到）。
watch(
  [() => props.siteId, view, () => route.query.sourceId],
  ([id, v, sourceId]) => {
    if (sourceId) return
    // 只在 props 与 URL 指向同一个网站时才写。切换网站的那一拍两者会短暂错位
    // （URL 已是新网站，props.siteId 还是旧的），此时写入会把**上一个网站**的快照
    // 改成新网站的视图——表现为"从 A 切到 B 再点回 A，A 停在哪个视图记不住了"
    // （2026-09-16 实机：11 的 data 被切到 4 时写成了 source）。
    if (String(route.query.siteId ?? '') !== String(id)) return
    // 先确保页签存在再写快照：本组件的 immediate watch 可能比 index.vue 的 enterFromRoute
    // 更早跑，那时 siteTab 还是 null，saveSiteSnapshot 的归属守卫会把这次写入整个丢掉，
    // 于是首次进来停留的视图永远记不住（2026-09-16 实机踩到）。名字仍由 site/detail 回来补。
    ws.ensureSiteTab(String(id))
    ws.saveSiteSnapshot(String(id), { view: String(v) })
  },
  { immediate: true },
)
function switchView(target: SiteWorkspaceView) {
  if (view.value === target) return
  // 换视图整包换 query：监控视图的子 Tab（monitorTab）跟着一起清掉，下次进来回到「监控结果」。
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, view: target } })
}
/** 监控视图的子 Tab（0916）：URL 是唯一真相，刷新/深链/前进后退都停在同一档。 */
const monitorTab = computed<SiteMonitorTab>(() => normalizeSiteMonitorTab(route.query.monitorTab))
function switchMonitorTab(tab: SiteMonitorTab) {
  const query = { ...route.query }
  if (tab === 'result') delete query.monitorTab
  else query.monitorTab = tab
  void router.replace({ path: route.path, query })
}
function openSource(source: Source) {
  // 保留网站上下文，进入具体源后左侧仍需加载同网站的源树。
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, sourceId: source.sourceId, view: 'overview' } })
}
/** 点源列表的「数据量」数字（0903 Y1-15）：直接落到数据视图，不用先进流程再切一次 */
function openSourceData(source: Source) {
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, sourceId: source.sourceId, view: 'data' } })
}
</script>

<template>
  <main class="sdv-shell">
    <div class="sdv-head">
      <div class="sdv-titlewrap">
        <div class="sdv-title">
          {{ title }}<span class="rc-status muted">网站汇总</span>
          <span v-if="detailFailed" class="sdv-detail-failed" data-testid="site-detail-failed">
            网站信息加载失败<button type="button" class="sdv-retry" data-testid="site-detail-retry" @click="load">重试</button>
          </span>
        </div>
        <div class="sdv-sub">{{ site?.categoryPath || site?.category || '' }}</div>
      </div>
      <div class="sdv-switcher">
        <button class="sdv-seg" :class="{ on: view === 'source' }" type="button" data-testid="site-source-view" @click="switchView('source')">源</button>
        <button class="sdv-seg" :class="{ on: view === 'data' }" type="button" data-testid="site-data-view" @click="switchView('data')">数据</button>
        <button class="sdv-seg" :class="{ on: view === 'file' }" type="button" data-testid="site-file-view" @click="switchView('file')">文件</button>
        <button class="sdv-seg" :class="{ on: view === 'task' }" type="button" data-testid="site-task-view" @click="switchView('task')">任务</button>
        <button class="sdv-seg" :class="{ on: view === 'monitor' }" type="button" data-testid="site-monitor-view" @click="switchView('monitor')">监控</button>
      </div>
    </div>
    <div v-if="loadError" class="sdv-empty">{{ loadError }}</div>
    <template v-else>
      <SourceOverviewView v-if="view === 'source'" :current-site-id="siteId" :initial-source-ids="initialSourceIds" :initial-flow-id="initialFlowId" class="sdv-body" @open-source="openSource" @open-source-data="openSourceData" />
      <SiteTablesOverview v-else-if="view === 'data' && showTablesOverview" :site-id="siteId" class="sdv-body" @pick="openTableFromOverview" />
      <SiteDataView v-else-if="view === 'data'" :site-id="siteId" :initial-condition="initialCondition" :locked-table-id="lockedTableId" class="sdv-body" />
      <SiteFileView v-else-if="view === 'file'" :site-id="siteId" class="sdv-body" />
      <TaskView v-else-if="view === 'task'" site-wide :site-id="siteId" class="sdv-body" />
      <SiteMonitorView v-else-if="view === 'monitor'" :site-id="siteId" :tab="monitorTab" class="sdv-body" @update:tab="switchMonitorTab" />
    </template>
  </main>
</template>

<style scoped>
.sdv-shell { display: flex; flex-direction: column; height: 100%; }
.sdv-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.sdv-titlewrap { min-width: 0; }
.sdv-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.sdv-detail-failed { font-weight: 400; font-size: 11px; color: var(--rc-danger, #dc2626); }
.sdv-retry { margin-left: 6px; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; cursor: pointer; }
.sdv-retry:hover { text-decoration: underline; }
.sdv-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.sdv-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; margin-left: auto; }
.sdv-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.sdv-seg.on { background: var(--rc-primary); color: #fff; }
.sdv-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.sdv-body { flex: 1; min-height: 0; }
.sdv-empty { padding: 40px 12px; text-align: center; color: var(--rc-faint); font-size: 12px; }
</style>
