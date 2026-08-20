<script setup lang="ts">
// 网站数据视图（0812 计划 M2-4/M2-5A + M2-3 交互纠偏，2026-08-14 第三次修正）。
// 方案 §5.2/§6.5：全部源＝按表筛选，具体源＝按节点筛选，"页面任何时刻只展示表筛选或
// 节点筛选中的一种"——但用户明确要求两种状态必须是"同一套"查询视图，只是可编辑字段
// （选表 vs 选节点、是否有执行按钮）不同，不能做成切换时跳到另一个看起来不一样的组件
// （之前 SourceNodeDataView.vue 独立组件的做法太割裂，已合并回本文件）。
//
// 分页也统一成一套：全部源本来就是前端按源逐个查、拼在一起做"加载更多"（旧接口
// entry/entryDataPaged 的 sourceId 是 Long 单值，不支持一次查整个网站，见方案 §6.2.1 R1，
// 未来后端补齐网站维度查询接口后页面表现不应该变——所以现在就不能让具体源用另一套
// "总数+上一页/下一页"）；具体源退化成 candidateSourceIds 只有一个元素的归并，天然复用同一套
// initMergeState/mergeLoadMore，不再维护单独的 total/page。
//
// 具体源下的"节点"来自本组件本地状态（不碰全局 useFlowStore() 单例，那是主画布正在编辑的
// 对象）：并行拉 sourceDetail/sourceSteps/flowLoad，口径跟 sourceStore.loadFromSource 一致
// （有已保存 FlowDef 优先用它，否则用纯函数 buildSourceSeed 按步骤拼默认骨架）。节点选择用
// 跟"选表"一样的纯下拉（不复用流程画布的节点链路图/ProcessNodeRail，那是流程编排视角，这里
// 只是顺手看一眼具体源的数据）。
//
// 这里是纯查看功能（2026-08-14 第四次修正）：不提供节点手动执行（发起抓取/发后续任务）、
// 不展示输入/输出表切换和进入条件——那一整套属于流程编排/执行语境，跟"网站数据视图快速看
// 一眼"的定位不符，真要执行任务走 ResultView.vue（具体源的流程结果视图）。列表的"所属源"列
// 在具体源下每行都是同一个源，容易让人以为是跨源归并，改叫"所属节点"并去掉操作列，
// 避免跟具体源自己的数据视图（ResultView.vue）混淆。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { dataApi, flowApi, siteApi, sourceApi, type DataTableMeta, type DataRow, type Source, type EntryDetail } from '@/api'
import {
  buildHorizontalLayout, buildSourceSeed, effectiveInputTable, nodeOutputTable, isDecision, isParallel,
  type NodeConfig, type BranchSeed, type FlowBranchGroup,
} from '@/views/FlowCanvas/canvas/flowModel'
import DataGrid from './DataGrid.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'
import SiteTableSelect from './components/SiteTableSelect.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import { initMergeState, mergeLoadMore, type MergeLoadMoreResult, type MergeSourceState } from './siteDataMerge'

const props = defineProps<{ siteId: string }>()

const PAGE_SIZE = 20
const MAX_PARALLEL_REQUESTS = 4

// 全屏（参考 ResultView.vue 的具体源数据视图）：整个面板 position:fixed 铺满视口，不复制
// 模板、不引入弹层。轨道在全屏下不做任何自动折叠——它是唯一的节点选择器，藏起来就没法
// 切节点了（0819 N1-2，ResultView 那边也已按同一口径去掉了自动收起）。
const fullscreen = ref(false)
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

const tableId = ref('')
const selectedSourceId = ref('')
const meta = ref<DataTableMeta | null>(null)
const metaError = ref('')
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })

const rows = ref<DataRow[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const dataError = ref('')
const failedSources = ref<MergeLoadMoreResult<DataRow>['failedSources']>([])
const allExhausted = ref(false)
const noCandidateSources = ref(false)

const siteChildren = ref<Source[]>([])
const sourceNames = computed<Record<string, string>>(() => Object.fromEntries(siteChildren.value.map((s) => [s.sourceId, s.name])))
// 具体源下 DataGrid「所属源」列改叫「所属节点」：每行本来就是同一个已选源，展示节点名字
// 而不是源名字，才不会看着像跨源归并。
const gridSourceNames = computed<Record<string, string>>(() => (selectedSourceId.value
  ? { [selectedSourceId.value]: selectedCfg.value?.title || selectedNodeId.value }
  : sourceNames.value))

let mergeStates: MergeSourceState[] = []
let candidateSourceIds: string[] = []
let requestId = 0

// ---------- 具体源：本地流程数据 + 节点选择（不碰全局 useFlowStore()） ----------
interface LocalFlowData { main: string[]; branches: BranchSeed[]; configs: Record<string, NodeConfig>; branchGroups: FlowBranchGroup[] }
const flowData = ref<LocalFlowData | null>(null)
const flowLoading = ref(false)
const flowLoadError = ref('')

async function loadFlowData(sourceId: string) {
  flowLoading.value = true
  flowLoadError.value = ''
  flowData.value = null
  try {
    const [source, steps, persistedDef] = await Promise.all([
      sourceApi.sourceDetail(sourceId),
      sourceApi.sourceSteps(sourceId),
      flowApi.flowLoad(sourceId),
    ])
    if (sourceId !== selectedSourceId.value) return
    if (!source) {
      flowLoadError.value = '源不存在或加载失败'
      return
    }
    flowData.value = persistedDef
      ? { main: persistedDef.main, branches: persistedDef.branches, configs: persistedDef.configs, branchGroups: persistedDef.branchGroups ?? [] }
      : { ...buildSourceSeed(source, steps ?? []), branchGroups: [] }
  } catch {
    if (sourceId !== selectedSourceId.value) return
    flowLoadError.value = '流程加载失败，请重试'
  } finally {
    if (sourceId === selectedSourceId.value) flowLoading.value = false
  }
}

const allNodes = computed(() => (flowData.value
  ? buildHorizontalLayout(flowData.value.main, flowData.value.branches, flowData.value.configs, flowData.value.branchGroups, { includeTerminals: false }).nodes
  : []))
const processLayout = computed(() => (flowData.value
  ? buildHorizontalLayout(flowData.value.main, flowData.value.branches, flowData.value.configs, flowData.value.branchGroups, { includeTerminals: false })
  : null))

const selectedNodeId = ref('')
// 节点选择复用流程图 ProcessNodeRail，与具体源结果视图（ResultView.vue）完全同构
// ——0819 会议 04:33"这个页面不是应该搞成跟单个源一样的效果"、04:47"给我加个流程图"。
// 本文件此前的"用跟选表一样的纯下拉、不复用 ProcessNodeRail"的决定已被该次会议推翻。
const railOpen = ref(true)

const selectedCfg = computed<NodeConfig | undefined>(() => allNodes.value.find((n) => n.id === selectedNodeId.value)?.cfg)
const outputTableId = computed(() => (selectedCfg.value ? nodeOutputTable(selectedCfg.value) : ''))
const inputTableId = computed(() => {
  if (!selectedNodeId.value || !flowData.value) return ''
  return effectiveInputTable(flowData.value.main, flowData.value.branches, flowData.value.configs, selectedNodeId.value, flowData.value.branchGroups)
})
const isStructuralNode = computed(() => !!selectedCfg.value && (isDecision(selectedCfg.value) || isParallel(selectedCfg.value)))
const hasAnyTable = computed(() => !isStructuralNode.value && (!!outputTableId.value || !!inputTableId.value))
// 纯查看，没有输入/输出切换：优先看输出表（节点产出的结果），没有输出表的节点看输入表。
const nodeTableId = computed(() => outputTableId.value || inputTableId.value)
// 两种状态查的是同一套 rows/meta/分页，只是"当前要查哪张表"的来源不同：全部源来自选表，
// 具体源来自选中节点的输出/输入表。
const effectiveTableId = computed(() => (selectedSourceId.value ? nodeTableId.value : tableId.value))

// 流程加载完成后选中末端节点（跟 ResultView 一致的默认值）；不做页签快照恢复——
// 这里是网站数据视图里"顺手看一眼"的轻量入口，不是持久化的编辑页签。
watch(allNodes, (nodes) => {
  if (!nodes.some((n) => n.id === selectedNodeId.value)) {
    selectedNodeId.value = nodes.at(-1)?.id || ''
  }
})

function onSelectNode(id: string) {
  if (!id || id === selectedNodeId.value) return
  selectedNodeId.value = id
}

// ---------- 全部源 / 具体源共用的查询 + 归并分页 ----------
function inferTableMeta(tableId2: string, dataRows: DataRow[]): DataTableMeta {
  const samples = new Map<string, unknown>()
  dataRows.forEach((row) => {
    Object.entries(row.values ?? {}).forEach(([prop, value]) => {
      if (!samples.has(prop)) samples.set(prop, value)
    })
  })
  return {
    tableId: tableId2,
    tableName: tableId2,
    rowCount: dataRows.length,
    fields: [...samples.entries()].map(([prop, sample]) => ({
      prop,
      type: sample !== null && typeof sample === 'object' ? 'json' : typeof sample === 'number' ? 'number' : 'string',
      desc: prop,
      sample: sample == null ? undefined : String(sample),
    })),
  }
}

async function fetchPage(sourceId: string, page: number, size: number): Promise<DataRow[]> {
  const result = await dataApi.rowQueryPaged({
    tableId: effectiveTableId.value,
    sourceId,
    dataId: filters.dataId || undefined,
    parentId: filters.parentId || undefined,
    state: filters.state || undefined,
    sql: filters.sql || undefined,
    page,
    size,
    // 排序参数已实测确认真实生效（2026-08-15，测试环境，见计划 §3.2 Q9）：不传/ascend/descend
    // 三次真实调用返回了方向相反的不同批次数据，不是静默忽略。客户端二次排序兜底仍保留
    // （siteDataMerge.ts），但已不再是"建立在未验证假设上"，是多源归并后的防御性再排序。
    sortField: 'ENTRY_ID',
    sortOrder: 'descend',
  })
  return result.list
}

async function loadMore() {
  const id = requestId
  if (!candidateSourceIds.length || allExhausted.value) return
  loadingMore.value = true
  dataError.value = ''
  try {
    const result = await mergeLoadMore(mergeStates, PAGE_SIZE, PAGE_SIZE, fetchPage, MAX_PARALLEL_REQUESTS)
    if (id !== requestId) return
    rows.value = [...rows.value, ...result.rows]
    failedSources.value = result.failedSources
    allExhausted.value = result.allExhausted
    if (!meta.value && rows.value.length) meta.value = inferTableMeta(effectiveTableId.value, rows.value)
    if (result.rows.length === 0 && result.failedSources.length && !result.allExhausted) {
      dataError.value = '本次未能取到新数据，可能是相关源暂时查询失败，请点击“加载更多”重试'
    }
  } catch {
    if (id !== requestId) return
    dataError.value = '数据加载失败，请重试'
  } finally {
    if (id === requestId) loadingMore.value = false
  }
}

async function resetAndLoad() {
  const id = ++requestId
  rows.value = []
  meta.value = null
  metaError.value = ''
  dataError.value = ''
  failedSources.value = []
  allExhausted.value = false
  noCandidateSources.value = false
  mergeStates = []
  candidateSourceIds = []
  const tid = effectiveTableId.value
  if (!tid) return
  loading.value = true
  try {
    if (selectedSourceId.value) {
      // 具体源：候选源集合永远只有它自己，退化成单源归并，复用同一套分页逻辑。
      candidateSourceIds = [selectedSourceId.value]
    } else {
      // 全部源：先收窄源集合（方案 §6.2.2）：问这张表实际有哪些源的数据，跟当前网站源集合取交集。
      // 收窄本身失败不阻断整体查询，退回用网站全部源（请求量更大，但结果仍然正确）。
      siteChildren.value = await siteApi.siteSources(props.siteId)
      if (id !== requestId) return
      // ⚠️ entryDistinctSource 不按网站过滤，返回的是全平台写过这张表的源；不传 size 会退回
      // buildLegacyRowQuery 的分页默认值 20（真实 bug，2026-08-14 生产环境实测发现：某些共用表
      // 全平台引用源数超过 20，本网站的源恰好不在前 20 个里，交集算出来是空的，页面误报"没有可
      // 查询的源"）。size 传大值取全量，1000 是 Q10 已实测确认不截断的安全值。
      let distinctIds: string[] | null = null
      try {
        distinctIds = await dataApi.distinctSource({ tableId: tid, size: 1000 })
      } catch {
        distinctIds = null
      }
      if (id !== requestId) return
      const siteSourceIds = new Set(siteChildren.value.map((s) => s.sourceId))
      const scopedDistinctIds = distinctIds?.filter((sid) => siteSourceIds.has(sid)) ?? []
      // entryDistinctSource 只是优化候选源的接口，不是“没有数据”的最终判定。
      // 旧接口可能因分页、数据口径或表级记录异常返回空集合；空集合时回退到网站全部源，
      // 让 entryDataPaged 进行真实查询，避免把 TB_CNEWS 这类有效表提前判成不可查。
      candidateSourceIds = scopedDistinctIds.length ? scopedDistinctIds : [...siteSourceIds]
    }
    mergeStates = initMergeState(candidateSourceIds)
    if (!candidateSourceIds.length) {
      noCandidateSources.value = true
      return
    }
    try {
      meta.value = await dataApi.tableMeta(tid)
    } catch {
      meta.value = null
    }
    if (id !== requestId) return
    if (!meta.value) metaError.value = '表结构暂不可用，已根据当前数据生成列'
    await loadMore()
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch(effectiveTableId, resetAndLoad)
// 全部源 ⇔ 具体源切换（方案 §6.5 规则 1/3）：两种状态各自的筛选维度不同（表 vs 节点），
// 不带着上一个状态选好的表/节点过去，强制在新状态里重新选；具体源的流程数据只在选中
// 具体源时才加载。
watch(selectedSourceId, (id) => {
  tableId.value = ''
  selectedNodeId.value = ''
  if (id) {
    void loadFlowData(id)
  } else {
    flowData.value = null
    flowLoadError.value = ''
  }
})
watch(() => props.siteId, () => {
  tableId.value = ''
  selectedSourceId.value = ''
})

function runQuery() {
  void resetAndLoad()
}
function clearFilters() {
  filters.dataId = ''
  filters.parentId = ''
  filters.state = ''
  filters.sql = ''
  runQuery()
}
function failedSourceText({ sourceId, error }: MergeLoadMoreResult<DataRow>['failedSources'][number]): string {
  const name = sourceNames.value[sourceId] || sourceId
  const reason = error.replaceAll(/\s+/g, ' ').slice(0, 120)
  return `${name}（${sourceId}）：${reason}`
}

const detail = reactive<{ visible: boolean; row: DataRow | null }>({ visible: false, row: null })
const taskInst = reactive<{ visible: boolean; sourceId: string; parentId: string | null }>({ visible: false, sourceId: '', parentId: null })
function onRowClick(row: DataRow) {
  detail.row = row
  detail.visible = true
  closeParentDetail()
}
function onRowAction(row: DataRow, cmd: string) {
  if (cmd === 'detail') {
    detail.row = row
    detail.visible = true
    closeParentDetail()
  } else if (cmd === 'tasks') {
    taskInst.sourceId = row.sourceId
    taskInst.parentId = row.dataId
    taskInst.visible = true
  }
}

// 上游数据下钻（M3-0H）：ResultView.vue 已有的 M3-0B 只落在具体源流程页，网站数据视图
// 这边一直没补——筛选行有「父 ID」输入框能按父 ID 筛，但点不开任何一行的父数据，
// 同一页面内口径不一致。categoryId/parentId 同样早就在 DataRow 里，只是没渲染入口。
const parentDetail = ref<EntryDetail | null>(null)
const parentLoading = ref(false)
const parentError = ref('')
const canDrillParent = computed(() => !!detail.row?.categoryId && !!detail.row?.parentId && detail.row.parentId !== '0')
async function openParentDetail() {
  if (!detail.row?.categoryId || !detail.row?.parentId) return
  parentLoading.value = true
  parentError.value = ''
  try {
    const res = await dataApi.rowDetail(detail.row.categoryId, detail.row.parentId)
    parentDetail.value = res
    if (!res) parentError.value = '未找到上游数据'
  } catch (error) {
    parentError.value = error instanceof Error ? error.message : '获取上游数据失败'
  } finally {
    parentLoading.value = false
  }
}
function closeParentDetail() {
  parentDetail.value = null
  parentError.value = ''
}
function parentItemText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
// row.values 的键是旧平台物理列名（K1/K2...），不是 f.prop 这个逻辑字段名（如 "title"）——
// 两者只在 f.columnName 上能对上，直接拿 f.prop 去 row.values 里取永远是 undefined。真实
// bug，2026-08-14 生产环境实测发现：详情弹层每个字段都显示"—"，不是接口没数据，是取错了 key。
const detailFields = computed(() => {
  if (!detail.row || !meta.value) return [] as { label: string; prop: string; value: string }[]
  return meta.value.fields.map((f) => ({
    label: `${f.desc}（${f.prop}）`,
    prop: f.prop,
    value: String(detail.row?.values?.[f.columnName ?? f.prop] ?? '—'),
  }))
})
</script>

<template>
  <main class="sdv2-shell" :class="{ 'is-fullscreen': fullscreen }">
    <div class="sdv2-toolbar">
      <SiteSourceSelect v-model="selectedSourceId" :site-id="siteId" />
      <SiteTableSelect v-if="!selectedSourceId" v-model="tableId" :site-id="siteId" />
      <template v-if="effectiveTableId">
        <input v-model="filters.dataId" class="sdv2-input" placeholder="数据 ID" @keyup.enter="runQuery" />
        <input v-model="filters.parentId" class="sdv2-input" placeholder="父 ID" @keyup.enter="runQuery" />
        <select v-model="filters.state" class="sdv2-input">
          <option value="">状态（全部）</option>
          <option value="C">C 成功</option>
          <option value="E">E 出错</option>
          <option value="L">L 处理中</option>
        </select>
        <input v-model="filters.sql" class="sdv2-input flex" placeholder="SQL 条件 / 关键词（如 CREATE_DT > curdate()）" @keyup.enter="runQuery" />
        <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
        <button class="rc-btn" type="button" @click="clearFilters">清空</button>
      </template>
    </div>

    <!-- 具体源：节点选择走流程图，与 ResultView.vue 同构（0819 N1-3/N1-4）。放在工具行之后、
         数据之前——先定范围（选源）、再定节点、最后看数据；"全部源"态没有唯一流程，
         不渲染轨道（沿用 0812 §1.1-5，那时是选表）。 -->
    <div v-if="selectedSourceId && processLayout" class="sdv2-railbox">
      <div v-if="railOpen" class="sdv2-bar" data-testid="site-data-process-rail">
        <ProcessNodeRail :model-value="selectedNodeId" :layout="processLayout" @update:model-value="onSelectNode" />
        <div v-if="!allNodes.length" class="sdv2-bar-empty">该源没有可查看数据的节点</div>
      </div>
      <div class="sdv2-rail-ctl">
        <button
          type="button"
          class="sdv2-rail-toggle"
          :class="{ open: railOpen }"
          data-testid="site-data-rail-toggle"
          :title="railOpen ? '收起流程节点轨道' : '展开流程节点轨道'"
          @click="railOpen = !railOpen"
        >{{ railOpen ? '收起流程' : '展开流程' }} <span class="arrow">▾</span></button>
      </div>
    </div>

    <template v-if="selectedSourceId && flowLoadError">
      <div class="sdv2-empty">{{ flowLoadError }}</div>
    </template>
    <template v-else-if="selectedSourceId && flowLoading && !processLayout">
      <div class="sdv2-empty">加载中…</div>
    </template>
    <template v-else-if="selectedSourceId && selectedNodeId && !hasAnyTable">
      <div class="sdv2-empty" data-testid="source-node-empty">该节点不产生可查看的数据</div>
    </template>
    <template v-else-if="!selectedSourceId && !tableId">
      <div class="sdv2-empty">请先选择一张表，查看该网站下所有源在这张表里的数据</div>
    </template>
    <template v-else-if="!selectedSourceId && noCandidateSources">
      <div class="sdv2-empty">当前筛选条件下，这张表在本网站没有可查询的源</div>
    </template>
    <template v-else-if="effectiveTableId">
      <div v-if="metaError" class="sdv2-notice" role="status">{{ metaError }}</div>
      <div v-if="dataError" class="sdv2-notice error" role="alert">{{ dataError }}</div>
      <div v-if="failedSources.length" class="sdv2-notice warn" data-testid="site-data-partial-fail">
        {{ failedSources.length }} 个源本次查询失败，结果可能不完整：{{ failedSources.map(failedSourceText).join('；') }}
      </div>

      <!-- 表头内容走 DataGrid 的 #head 插槽，跟「列 ▾」共用同一条横条——参考 ResultView.vue
           的具体源数据视图（2026-08-15 第十二次纠偏）；这里此前是独立的 .sdv2-tablehead
           单占一行，跟 DataGrid 自己的「列 ▾」行分开，同一类信息在两个数据视图里长得不一样。 -->
      <DataGrid
        class="sdv2-grid"
        :meta="meta"
        :rows="rows"
        :loading="loading"
        :selected-id="detail.row?.dataId"
        :source-names="gridSourceNames"
        :source-col-label="selectedSourceId ? '所属节点' : undefined"
        :hide-actions="!!selectedSourceId"
        @row-click="onRowClick"
        @row-action="onRowAction"
      >
        <template #head>
          <span class="sdv2-tablename">{{ meta?.tableName || effectiveTableId }}</span>
          <span class="sdv2-count">已加载 {{ rows.length }} 条</span>
          <button
            class="rc-btn tiny sdv2-fs-btn"
            type="button"
            data-testid="site-data-fullscreen-toggle"
            :title="fullscreen ? '退出全屏（Esc）' : '全屏查看数据'"
            @click="fullscreen = !fullscreen"
          >{{ fullscreen ? '⤡ 退出全屏' : '⤢ 全屏' }}</button>
        </template>
      </DataGrid>

      <div class="sdv2-foot">
        <span v-if="allExhausted" class="muted">已加载全部数据</span>
        <button
          v-else
          class="rc-btn"
          type="button"
          data-testid="site-data-load-more"
          :disabled="loadingMore"
          @click="loadMore"
        >{{ loadingMore ? '加载中…' : '加载更多' }}</button>
      </div>
    </template>

    <el-drawer v-model="detail.visible" :with-header="false" size="480px">
      <div v-if="detail.row" class="sdv2-detail">
        <div class="sdv2-d-head">
          <div>
            <div class="sdv2-d-title">{{ detail.row.title }}</div>
            <div class="sdv2-d-sub">
              数据 ID {{ detail.row.dataId }}<template v-if="!selectedSourceId"> · 所属源 {{ sourceNames[detail.row.sourceId] || detail.row.sourceId }}</template>
            </div>
            <button
              v-if="canDrillParent"
              type="button"
              class="sdv2-parent-link"
              data-testid="site-data-parent-drill"
              :disabled="parentLoading"
              @click="openParentDetail"
            >父 ID {{ detail.row.parentId }} <span aria-hidden="true">↗</span></button>
          </div>
          <button class="rc-btn ghost" type="button" @click="detail.visible = false">关闭</button>
        </div>
        <div v-if="parentError" class="sdv2-notice error">{{ parentError }}</div>
        <div v-if="parentDetail" class="sdv2-parent-panel" data-testid="site-data-parent-panel">
          <div class="sdv2-parent-panel-head">
            <span>上游数据 · {{ parentDetail.row.dataId }}</span>
            <button class="rc-btn ghost" type="button" @click="closeParentDetail">收起</button>
          </div>
          <dl class="rc-kv">
            <template v-for="item in parentDetail.showItems" :key="item.columnName">
              <dt>{{ item.itemName || item.columnName }}</dt>
              <dd>{{ parentItemText(item.value) }}</dd>
            </template>
          </dl>
        </div>
        <dl class="rc-kv">
          <template v-for="f in detailFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
      </div>
    </el-drawer>
    <TaskInstDialog
      v-model="taskInst.visible"
      :source-id="taskInst.sourceId"
      :parent-id="taskInst.parentId"
      :can-write="false"
    />
  </main>
</template>

<style scoped>
.sdv2-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
/* 全屏（参考 ResultView.vue）：fixed 铺满视口逃逸到父级布局之外，父级（SiteDetailView.vue
   的网站标题/页签）不需要跟着让位——position:fixed 本来就会跳出正常文档流。 */
.sdv2-shell.is-fullscreen { position: fixed; inset: 0; z-index: 60; height: 100vh; border: 0; border-radius: 0; }
.sdv2-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; position: relative; }
.sdv2-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.sdv2-input.flex { flex: 1; min-width: 200px; font-family: var(--rc-mono, monospace); }
.sdv2-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sdv2-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.sdv2-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; padding: 40px 12px; text-align: center; }
.sdv2-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.sdv2-notice.error { border-bottom-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.sdv2-notice.warn { border-bottom-color: #fde68a; background: #fffbeb; color: #92400e; }
.sdv2-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); }
.sdv2-count { font-size: 12px; color: var(--rc-faint); }
.sdv2-fs-btn { margin-left: auto; }
.rc-btn.tiny { height: 24px; padding: 0 10px; font-size: 11.5px; }
.sdv2-grid { flex: 1; min-height: 0; }
.sdv2-foot { display: flex; justify-content: center; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.sdv2-foot .rc-btn { height: 28px; padding: 0 16px; font-size: 12px; }
.muted { color: var(--rc-faint); font-size: 12px; }
.sdv2-detail { padding: 18px; }
.sdv2-d-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.sdv2-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); }
.sdv2-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 3px; }
.sdv2-parent-link { margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; padding: 0; font-size: 11px; color: var(--rc-primary); cursor: pointer; }
.sdv2-parent-link:hover { text-decoration: underline; }
.sdv2-parent-link:disabled { opacity: .6; cursor: default; text-decoration: none; }
.sdv2-parent-panel { margin-bottom: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; padding: 10px 12px; }
.sdv2-parent-panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--rc-text-2); margin-bottom: 8px; }
.sdv2-parent-panel .rc-kv { margin: 0; }
.sdv2-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.sdv2-notice.error { border-bottom-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }

/* 节点轨道：与 ResultView.vue 的 .rv-railbox 一套取值，两个数据视图的流程图观感必须一致
   （0819 N1-4）。折叠开关长在轨道自己身上——控件应该长在它所控制的东西上。 */
.sdv2-railbox { position: relative; min-height: 32px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }
.sdv2-bar { position: relative; padding: 8px 0; background: #f8fafc; overflow: auto; }
.sdv2-bar-empty { color: var(--rc-faint); font-size: 12px; padding: 16px; text-align: center; }
.sdv2-rail-ctl { position: absolute; top: 4px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 6px; }
.sdv2-rail-toggle { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11.5px; cursor: pointer; }
.sdv2-rail-toggle:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.sdv2-rail-toggle .arrow { display: inline-block; transition: transform .18s ease; }
.sdv2-rail-toggle.open .arrow { transform: rotate(180deg); }
</style>
