<script setup lang="ts">
/**
 * 关联流程选择器（1030 会议议题 3、4）。替换源流程配置抽屉里原来的多选下拉：
 * 列表列口径与流程中心一致（名称 / ID / 节点数 / 使用源数），服务端分页 + 名称 / ID 搜索；
 * 「只看本网站在用」按同网站各源的默认流程筛，并显示本网站有几个源在用。
 * 10-31 用户：预览要像流程工作区那样看到具体流程——左边列表、右边只读画布（FlowReadonlyCanvas，样式同工作区），
 * 点行预览、勾选框才是选择；点画布节点在右侧看节点配置（FlowNodeReadonlyPanel，对照工作区配置区，只读）。FlowDetailDrawer 是可编辑工作区且读写全局 flow store，这里不用。
 * 只负责挑选，确定后把勾选结果回给抽屉，保存仍在抽屉里做。
 */
import { computed, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { configApi, flowCenterApi, type FlowRecord, type Source, type Step } from '@/api'
import { parseIdList } from '@/utils/flow/flowSearch'
import { nodeCountText, nodeCountTitle, useFlowNodeCounts } from '@/utils/flow/flowNodeCounts'
import { buildSourceSeed, effectiveInputTable, rootStepForSource } from '@/views/FlowCanvas/canvas/flowModel'
import FlowReadonlyCanvas, { type ReadonlyFlowDef } from '@/views/FlowCanvas/canvas/FlowReadonlyCanvas.vue'
import FlowNodeReadonlyPanel from '@/views/FlowCanvas/canvas/FlowNodeReadonlyPanel.vue'

const props = defineProps<{
  selected: string[]
  /** 同网站其他源在用的流程：flowId → 源数 */
  siteFlowCounts: Record<string, number>
  /** 不是从源打开（如来源组流程配置）：不显示「本网站在用」筛选和列 */
  hideSiteUsage?: boolean
}>()
const emit = defineEmits<{ close: []; confirm: [flows: FlowRecord[]] }>()

const PAGE_SIZE = 10
const keyword = ref('')
/** 点查询 / 回车时才生效的搜索词：只改输入框不查询时，翻页仍按上次的条件 */
const appliedKeyword = ref('')
const onlySite = ref(Object.keys(props.siteFlowCounts).length > 0)
const page = ref(1)
const total = ref(0)
const rows = ref<FlowRecord[]>([])
const loading = ref(false)
const loadError = ref('')
const picked = ref<Map<string, FlowRecord | null>>(new Map(props.selected.map((id) => [id, null])))
// ---- 右侧预览：按流程工作区同一条还原路径（步骤 → 画布定义，见 FlowDetailDrawer.deriveFromFlowConfig）----
const previewFlow = ref<FlowRecord | null>(null)
const previewDef = ref<ReadonlyFlowDef | null>(null)
const previewSteps = ref<Step[]>([])
const previewLoading = ref(false)
const previewError = ref('')
const previewNodeId = ref('')
async function preview(flow: FlowRecord) {
  if (previewFlow.value?.id === flow.id && (previewDef.value || previewLoading.value)) return
  previewFlow.value = flow
  previewDef.value = null
  previewSteps.value = []
  previewNodeId.value = ''
  previewError.value = ''
  previewLoading.value = true
  try {
    const steps = await flowCenterApi.steps(flow.id)
    // 后端没给真实根行（旧数据）时按流程自己的配置合成起点，同工作区
    const hasRoot = steps.some((step) => step.isRoot)
    const config = hasRoot ? null : await configApi.configDetail(flow.id).catch(() => null)
    const stub: Source = {
      sourceId: '', name: config?.name || flow.name, url: config?.url || '', configId: flow.id,
      mainTable: config?.entryTypeId || '', owner: '', state: 'C',
    }
    const root = hasRoot ? null : rootStepForSource(stub)
    const seed = buildSourceSeed(stub, root ? [root, ...steps] : steps)
    if (previewFlow.value?.id !== flow.id) return
    previewSteps.value = steps
    previewDef.value = { main: seed.main, branches: seed.branches, configs: seed.configs, branchGroups: seed.branchGroups }
    // 同工作区：打开流程默认选中第一个真实节点，右侧配置区直接有内容
    previewNodeId.value = seed.main.find((id) => id !== 'start' && id !== 'end' && seed.configs[id]) ?? ''
  } catch (error) {
    if (previewFlow.value?.id === flow.id) previewError.value = `流程读取失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (previewFlow.value?.id === flow.id) previewLoading.value = false
  }
}
const previewEmpty = computed(() => !!previewDef.value && !previewDef.value.main.some((id) => id !== 'start' && id !== 'end'))
/** 画布上选中的节点：右侧只读配置区的数据（配置、步骤行、继承后的输入表） */
const previewNode = computed(() => {
  const def = previewDef.value
  const id = previewNodeId.value
  const cfg = id ? def?.configs[id] : undefined
  if (!def || !cfg) return null
  return {
    id,
    cfg,
    step: previewSteps.value.find((s) => s.stepId === id),
    inputTable: effectiveInputTable(def.main, def.branches, def.configs, id, def.branchGroups),
  }
})
/** 在流程中心按 ID 搜出这条流程（新标签页，完整工作区在那里打开） */
function flowCenterHref(id: string): string {
  return `${window.location.pathname}${window.location.search}#/flows?q=${encodeURIComponent(id)}`
}
const { counts: nodeCounts, load: loadNodeCounts } = useFlowNodeCounts()
const siteFlowIds = computed(() => Object.keys(props.siteFlowCounts))
let seq = 0

async function load() {
  const reqId = ++seq
  loading.value = true
  loadError.value = ''
  try {
    const raw = appliedKeyword.value
    // 搜索框纯数字按流程 ID 查，否则按名称等关键字查（与流程中心同口径）
    const rawIds = raw ? parseIdList(raw) : null
    const ids = onlySite.value
      ? (rawIds ? rawIds.filter((id) => siteFlowIds.value.includes(id)) : siteFlowIds.value)
      : rawIds
    if (ids && !ids.length) {
      rows.value = []
      total.value = 0
      return
    }
    const result = await flowCenterApi.paged({
      page: page.value,
      size: PAGE_SIZE,
      flowIds: ids ?? undefined,
      keywords: rawIds ? undefined : raw || undefined,
      field: onlySite.value ? 'sourceCnt' : 'updateDt',
      order: 'desc',
    })
    if (reqId !== seq) return
    rows.value = result.list
    total.value = result.total
    void loadNodeCounts(result.list)
    // 打开时默认预览第一条，不用先点一下才看到画布
    if (!previewFlow.value && result.list.length) void preview(result.list[0]!)
  } catch (error) {
    if (reqId !== seq) return
    // 清掉上一页的行，错误才会出现在空表行里；不然分页器已跳到新页、表里还是旧页的流程
    rows.value = []
    loadError.value = `流程列表加载失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (reqId === seq) loading.value = false
  }
}
/** 空表说明：区分「本网站没有在用的流程」和「搜索没命中」 */
const emptyText = computed(() => {
  if (loadError.value) return loadError.value
  const kw = appliedKeyword.value
  if (onlySite.value) return kw ? `本网站在用的流程里没有匹配「${kw}」的，可取消「只看本网站在用」再搜` : '本网站其他源没有在用的流程'
  return kw ? `没有找到匹配「${kw}」的流程` : '没有找到流程'
})
function search() {
  appliedKeyword.value = keyword.value.trim()
  page.value = 1
  void load()
}
watch(onlySite, search)

function toggle(flow: FlowRecord) {
  const next = new Map(picked.value)
  if (next.has(flow.id)) next.delete(flow.id)
  else next.set(flow.id, flow)
  picked.value = next
}
function confirm() {
  // 打开前已选、这次没翻到的流程只有 ID，抽屉按 ID 自己补名称
  emit('confirm', [...picked.value].map(([id, flow]) => flow ?? ({ id, name: '' } as FlowRecord)))
}

void load()
</script>

<template>
  <el-dialog
    :model-value="true"
    title="选择关联流程"
    width="min(1440px, calc(100vw - 32px))"
    class="fp-dialog"
    append-to-body
    data-testid="flow-picker"
    @close="emit('close')"
  >
    <div class="fp-toolbar">
      <input v-model="keyword" class="fp-input" placeholder="流程 ID / 名称" aria-label="搜索流程" data-testid="flow-picker-search" @keyup.enter="search" />
      <button class="rc-btn primary" type="button" data-testid="flow-picker-query" @click="search">查询</button>
      <el-checkbox v-if="!hideSiteUsage" v-model="onlySite" :disabled="!siteFlowIds.length" data-testid="flow-picker-only-site">
        只看本网站在用（{{ siteFlowIds.length }}）
      </el-checkbox>
      <span class="fp-spacer" />
      <span class="fp-muted">已选 {{ picked.size }} 个</span>
      <!-- 按当前已提交的条件、当前页重查（AGENTS.md 选择弹窗约定：刷新放操作区右侧，紧凑图标按钮） -->
      <button class="fp-refresh" type="button" title="刷新" aria-label="刷新" data-testid="flow-picker-refresh" :disabled="loading" @click="load"><el-icon><Refresh /></el-icon></button>
    </div>
    <div class="fp-body">
    <!-- 左：流程列表。点行 = 预览，勾选框 = 选择 -->
    <div class="fp-table-wrap" v-loading="loading">
      <table class="fp-table">
        <thead>
          <tr>
            <th style="width: 32px" />
            <th>流程名称 / ID</th>
            <th style="width: 44px" title="节点数">节点</th>
            <th style="width: 52px" title="使用源数">使用源</th>
            <th v-if="!hideSiteUsage" style="width: 56px" title="本网站有几个源在用">本网站</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="f in rows"
            :key="f.id"
            :class="{ disabled: f.disabled, previewing: previewFlow?.id === f.id }"
            data-testid="flow-picker-row"
            @click="preview(f)"
          >
            <td><el-checkbox :model-value="picked.has(f.id)" :disabled="f.disabled" :aria-label="`选择 ${f.name}`" data-testid="flow-picker-check" @click.stop @change="toggle(f)" /></td>
            <td class="fp-name">
              <b :title="f.name">{{ f.name }}</b>
              <span v-if="f.disabled" class="fp-badge">已禁用</span>
              <small class="fp-muted">{{ f.id }}</small>
            </td>
            <td :title="nodeCountTitle(nodeCounts, f.id)">{{ nodeCountText(nodeCounts, f.id) }}</td>
            <td>{{ f.sourceCnt ?? '—' }}</td>
            <td v-if="!hideSiteUsage" :title="siteFlowCounts[f.id] ? `本网站 ${siteFlowCounts[f.id]} 个源在用` : ''">{{ siteFlowCounts[f.id] ?? '—' }}</td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td :colspan="hideSiteUsage ? 4 : 5" class="fp-empty" data-testid="flow-picker-empty">{{ emptyText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 右：只读流程画布（样式同流程工作区）+ 右侧选中节点的只读配置区 -->
    <section class="fp-preview" data-testid="flow-picker-preview">
      <template v-if="previewFlow">
        <div class="fp-preview-head">
          <b :title="previewFlow.name">{{ previewFlow.name }}</b>
          <span class="fp-muted">{{ previewFlow.id }} · {{ nodeCountText(nodeCounts, previewFlow.id) }} 个节点 · {{ previewFlow.sourceCnt ?? 0 }} 个源在用</span>
          <span class="fp-spacer" />
          <el-checkbox
            :model-value="picked.has(previewFlow.id)"
            :disabled="previewFlow.disabled"
            data-testid="flow-picker-preview-check"
            @change="toggle(previewFlow)"
          >选择这个流程</el-checkbox>
          <a class="fp-link" :href="flowCenterHref(previewFlow.id)" target="_blank" rel="noopener" title="新标签页打开流程中心，在那里进入完整的流程工作区">在流程中心查看 ↗</a>
        </div>
        <div class="fp-work">
          <div class="fp-canvas" v-loading="previewLoading">
            <p v-if="previewError" class="fp-state fp-error">{{ previewError }}</p>
            <p v-else-if="previewEmpty" class="fp-state">这个流程还没有节点</p>
            <FlowReadonlyCanvas v-else-if="previewDef" :def="previewDef" :selected="previewNodeId" @select="previewNodeId = $event" />
          </div>
          <FlowNodeReadonlyPanel
            v-if="previewNode"
            class="fp-node"
            :node-id="previewNode.id"
            :cfg="previewNode.cfg"
            :step="previewNode.step"
            :input-table="previewNode.inputTable"
          />
          <p v-else-if="previewDef && !previewEmpty" class="fp-node fp-node-hint">点画布上的节点，查看它的配置</p>
        </div>
      </template>
      <p v-else class="fp-state">点左侧流程，在这里预览流程图</p>
    </section>
    </div>
    <template #footer>
      <div class="fp-footer">
        <el-pagination v-model:current-page="page" :page-size="PAGE_SIZE" :total="total" layout="total, prev, pager, next" small @current-change="load" />
        <span class="fp-spacer" />
        <el-button @click="emit('close')">取消</el-button>
        <el-button type="primary" data-testid="flow-picker-confirm" @click="confirm">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.fp-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
/* 原来用的 --rc-line 项目里没有定义，边框整个丢了（10-31 截图里搜索框看不出是输入框）；改成与目录搜索框同一套边框 */
.fp-input { box-sizing: border-box; height: 30px; width: 300px; max-width: 100%; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; font-size: 13px; outline: none; }
.fp-input:focus { border-color: var(--rc-primary); }
.fp-spacer { flex: 1; }
.fp-refresh { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.fp-refresh:hover:not(:disabled) { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.fp-refresh:disabled { opacity: .5; cursor: not-allowed; }
.fp-muted { color: var(--rc-text-2); font-size: 12px; }
/* 左右两栏，按 13.6 寸屏留边：高度随视口，列表和画布各自滚动 */
.fp-body { display: grid; grid-template-columns: minmax(320px, 360px) minmax(0, 1fr); gap: 12px; height: min(640px, calc(100vh - 280px)); min-height: 360px; }
.fp-table-wrap { min-height: 0; overflow: auto; border: 1px solid var(--rc-border); border-radius: 8px; }
.fp-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
.fp-table th, .fp-table td { padding: 8px 6px; border-bottom: 1px solid var(--rc-border-soft); text-align: left; }
.fp-table th { color: var(--rc-text-2); font-weight: 600; position: sticky; top: 0; z-index: 1; background: #f8fafc; }
.fp-table tbody tr { cursor: pointer; }
.fp-table tbody tr:hover { background: #f8fafc; }
.fp-table tbody tr.previewing { background: var(--rc-primary-bg); box-shadow: inset 3px 0 0 var(--rc-primary); }
.fp-table tbody tr.disabled { opacity: 0.55; }
.fp-name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.fp-table td small { display: block; margin-top: 2px; }
.fp-badge { margin-left: 6px; padding: 0 6px; border-radius: 4px; font-size: 11px; color: #b45309; background: #fef3c7; }
.fp-empty { padding: 32px; text-align: center; color: var(--rc-faint); }
.fp-preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--rc-border); border-radius: 8px; overflow: hidden; }
.fp-preview-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); font-size: 13px; }
.fp-preview-head > b { min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-link { flex: none; color: var(--rc-primary); font-size: 12px; text-decoration: none; }
.fp-link:hover { text-decoration: underline; }
.fp-work { flex: 1; min-height: 0; display: flex; }
.fp-canvas { position: relative; flex: 1; min-width: 0; min-height: 0; }
.fp-state { margin: 0; padding: 48px 16px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.fp-node { flex: none; width: 300px; }
.fp-node-hint { margin: 0; padding: 48px 16px; border-left: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 12px; text-align: center; }
.fp-error { color: #dc2626; }
.fp-footer { display: flex; align-items: center; gap: 8px; }
</style>
