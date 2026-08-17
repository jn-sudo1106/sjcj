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
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { dataApi, flowApi, siteApi, sourceApi, type DataTableMeta, type DataRow, type Source } from '@/api'
import {
  buildHorizontalLayout, buildSourceSeed, effectiveInputTable, nodeOutputTable, isDecision, isParallel,
  type NodeConfig, type BranchSeed, type FlowBranchGroup,
} from '@/views/FlowCanvas/canvas/flowModel'
import DataGrid from './DataGrid.vue'
import SiteTableSelect from './components/SiteTableSelect.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import { initMergeState, mergeLoadMore, type MergeSourceState } from './siteDataMerge'

const props = defineProps<{ siteId: string }>()
const router = useRouter()

const PAGE_SIZE = 20

const tableId = ref('')
const selectedSourceId = ref('')
const meta = ref<DataTableMeta | null>(null)
const metaError = ref('')
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })

const rows = ref<DataRow[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const dataError = ref('')
const failedSourceIds = ref<string[]>([])
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
// 节点选择用跟"选表"一样的纯下拉（不复用流程画布的节点链路图/ProcessNodeRail）。
const nodeKeyword = ref('')
const nodeSelectOpen = ref(false)

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

const filteredNodes = computed(() => {
  const q = nodeKeyword.value.trim().toLowerCase()
  if (!q) return allNodes.value
  return allNodes.value.filter((n) => (n.cfg.title || '').toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
})
function pickNode(id: string) {
  onSelectNode(id)
  nodeKeyword.value = ''
  nodeSelectOpen.value = false
}
function onNodeSelectFocus() {
  nodeSelectOpen.value = true
}
function onNodeSelectBlur() {
  // 留一点时间给点击选项的 mousedown 先触发，不然 blur 先关掉下拉，点击就落空了。
  window.setTimeout(() => { nodeSelectOpen.value = false }, 150)
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
    // 排序参数是否真的被后端接受未经实测（旧参考页面从未真正用过，见计划 §3.2 Q9
    // 追加项）；就算不生效，归并算法本身对每批数据有客户端二次排序兜底，见 siteDataMerge.ts。
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
    const result = await mergeLoadMore(mergeStates, PAGE_SIZE, PAGE_SIZE, fetchPage)
    if (id !== requestId) return
    rows.value = [...rows.value, ...result.rows]
    failedSourceIds.value = result.failedSourceIds
    allExhausted.value = result.allExhausted
    if (!meta.value && rows.value.length) meta.value = inferTableMeta(effectiveTableId.value, rows.value)
    if (result.rows.length === 0 && result.failedSourceIds.length && !result.allExhausted) {
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
  failedSourceIds.value = []
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

const detail = reactive<{ visible: boolean; row: DataRow | null }>({ visible: false, row: null })
function onRowClick(row: DataRow) {
  detail.row = row
  detail.visible = true
}
function onRowAction(row: DataRow, cmd: string) {
  if (cmd === 'detail') {
    detail.row = row
    detail.visible = true
  } else if (cmd === 'tasks') {
    router.push({ path: '/runs', query: { dataId: row.dataId } })
  }
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
  <main class="sdv2-shell">
    <div class="sdv2-toolbar">
      <SiteSourceSelect v-model="selectedSourceId" :site-id="siteId" />
      <SiteTableSelect v-if="!selectedSourceId" v-model="tableId" :site-id="siteId" />
      <div v-else-if="processLayout" class="sns-field">
        <input
          v-model="nodeKeyword"
          class="sns-input"
          data-testid="source-node-select-input"
          :placeholder="selectedCfg ? (selectedCfg.title || selectedNodeId) : '选择节点（按节点名称搜索）'"
          @focus="onNodeSelectFocus"
          @mousedown="onNodeSelectFocus"
          @blur="onNodeSelectBlur"
        />
        <div v-if="nodeSelectOpen" class="sns-options" data-testid="source-node-select-options">
          <div v-if="!filteredNodes.length" class="sns-empty">{{ nodeKeyword ? '没有匹配的节点' : '该源没有可查看数据的节点' }}</div>
          <button
            v-for="node in filteredNodes"
            :key="node.id"
            type="button"
            class="sns-option"
            data-testid="source-node-select-option"
            :data-node-id="node.id"
            :class="{ active: node.id === selectedNodeId }"
            @mousedown.prevent="pickNode(node.id)"
          >
            <span class="sns-option-name">{{ node.cfg.title || node.id }}</span>
            <span v-if="nodeOutputTable(node.cfg)" class="sns-option-hint">输出 {{ nodeOutputTable(node.cfg) }}</span>
          </button>
        </div>
      </div>
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
      <div v-if="failedSourceIds.length" class="sdv2-notice warn" data-testid="site-data-partial-fail">
        {{ failedSourceIds.length }} 个源本次查询失败，结果可能不完整
      </div>

      <div class="sdv2-tablehead">
        <span class="sdv2-tablename">{{ meta?.tableName || effectiveTableId }}</span>
        <span class="sdv2-count">已加载 {{ rows.length }} 条</span>
      </div>

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
      />

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
          </div>
          <button class="rc-btn ghost" type="button" @click="detail.visible = false">关闭</button>
        </div>
        <dl class="rc-kv">
          <template v-for="f in detailFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
      </div>
    </el-drawer>
  </main>
</template>

<style scoped>
.sdv2-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.sdv2-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; position: relative; }
.sdv2-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.sdv2-input.flex { flex: 1; min-width: 200px; font-family: var(--rc-mono, monospace); }
.sdv2-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sdv2-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.sdv2-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; padding: 40px 12px; text-align: center; }
.sdv2-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.sdv2-notice.error { border-bottom-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.sdv2-notice.warn { border-bottom-color: #fde68a; background: #fffbeb; color: #92400e; }
.sdv2-tablehead { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.sdv2-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); }
.sdv2-count { font-size: 12px; color: var(--rc-faint); }
.sdv2-grid { flex: 1; min-height: 0; }
.sdv2-foot { display: flex; justify-content: center; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.sdv2-foot .rc-btn { height: 28px; padding: 0 16px; font-size: 12px; }
.muted { color: var(--rc-faint); font-size: 12px; }
.sdv2-detail { padding: 18px; }
.sdv2-d-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.sdv2-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); }
.sdv2-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 3px; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }

.sns-field { position: relative; display: flex; align-items: center; gap: 6px; min-width: 220px; }
.sns-input { flex: 1; height: 28px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; background: #fff; }
.sns-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sns-options { position: absolute; z-index: 5; top: 32px; left: 0; right: 0; min-width: 260px; max-height: 260px; overflow-y: auto; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.3); }
.sns-empty { padding: 10px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.sns-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.sns-option:last-child { border-bottom: 0; }
.sns-option:hover, .sns-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.sns-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.sns-option-hint { flex: none; font-family: var(--rc-mono, monospace); font-size: 10px; color: var(--rc-faint); }
</style>
