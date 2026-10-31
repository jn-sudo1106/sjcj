<script setup lang="ts">
/**
 * 关联流程选择器（1030 会议议题 3、4）。替换源流程配置抽屉里原来的多选下拉：
 * 列表列口径与流程中心一致（名称 / ID / 节点数 / 使用源数），服务端分页 + 名称 / ID 搜索；
 * 「只看本网站在用」按同网站各源的默认流程筛，并显示本网站有几个源在用；点「预览」在行下展开只读的节点列表
 *（FlowDetailDrawer 是可编辑工作区，选流程时打开容易误改，这里不用）。
 * 只负责挑选，确定后把勾选结果回给抽屉，保存仍在抽屉里做。
 */
import { computed, ref, watch } from 'vue'
import { flowCenterApi, type FlowRecord, type Step } from '@/api'
import { parseIdList } from '@/utils/flow/flowSearch'
import { nodeCountText, nodeCountTitle, useFlowNodeCounts } from '@/utils/flow/flowNodeCounts'

const props = defineProps<{
  selected: string[]
  /** 同网站其他源在用的流程：flowId → 源数 */
  siteFlowCounts: Record<string, number>
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
const previewId = ref('')
const previewSteps = ref<Step[] | null>(null)
const previewError = ref('')
async function togglePreview(flow: FlowRecord) {
  if (previewId.value === flow.id) {
    previewId.value = ''
    return
  }
  previewId.value = flow.id
  previewSteps.value = null
  previewError.value = ''
  try {
    const steps = await flowCenterApi.steps(flow.id, { withConfigDetails: false })
    if (previewId.value === flow.id) previewSteps.value = steps
  } catch (error) {
    if (previewId.value === flow.id) previewError.value = `节点读取失败：${error instanceof Error ? error.message : String(error)}`
  }
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
    width="min(1000px, calc(100vw - 32px))"
    append-to-body
    data-testid="flow-picker"
    @close="emit('close')"
  >
    <div class="fp-toolbar">
      <input v-model="keyword" class="fp-input" placeholder="流程 ID / 名称" aria-label="搜索流程" data-testid="flow-picker-search" @keyup.enter="search" />
      <button class="rc-btn primary" type="button" data-testid="flow-picker-query" @click="search">查询</button>
      <el-checkbox v-model="onlySite" :disabled="!siteFlowIds.length" data-testid="flow-picker-only-site">
        只看本网站在用（{{ siteFlowIds.length }}）
      </el-checkbox>
      <span class="fp-spacer" />
      <span class="fp-muted">已选 {{ picked.size }} 个</span>
    </div>
    <div class="fp-table-wrap" v-loading="loading">
      <table class="fp-table">
        <thead>
          <tr>
            <th style="width: 40px" />
            <th>流程名称 / ID</th>
            <th style="width: 70px">节点数</th>
            <th style="width: 90px">使用源数</th>
            <th style="width: 110px">本网站在用</th>
            <th style="width: 70px">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="f in rows" :key="f.id">
          <tr :class="{ disabled: f.disabled }" data-testid="flow-picker-row" @click="!f.disabled && toggle(f)">
            <td><el-checkbox :model-value="picked.has(f.id)" :disabled="f.disabled" @click.stop @change="toggle(f)" /></td>
            <td>
              <b>{{ f.name }}</b>
              <span v-if="f.disabled" class="fp-badge">已禁用</span>
              <small class="fp-muted">{{ f.id }}</small>
            </td>
            <td :title="nodeCountTitle(nodeCounts, f.id)">{{ nodeCountText(nodeCounts, f.id) }}</td>
            <td>{{ f.sourceCnt ?? '—' }}</td>
            <td>{{ siteFlowCounts[f.id] ? `${siteFlowCounts[f.id]} 个源` : '—' }}</td>
            <td><el-button link type="primary" size="small" data-testid="flow-picker-preview" @click.stop="togglePreview(f)">{{ previewId === f.id ? '收起' : '预览' }}</el-button></td>
          </tr>
          <tr v-if="previewId === f.id" class="fp-preview-row">
            <td />
            <td colspan="5" data-testid="flow-picker-steps">
              <span v-if="previewError" class="fp-error">{{ previewError }}</span>
              <span v-else-if="!previewSteps" class="fp-muted">读取节点中…</span>
              <span v-else-if="!previewSteps.length" class="fp-muted">这个流程还没有节点</span>
              <ol v-else class="fp-steps">
                <li v-for="step in previewSteps" :key="step.stepId">
                  <b>{{ step.name || '未命名节点' }}</b>
                  <span class="fp-muted">{{ [step.configId ? `配置 ${step.configId}` : '', step.outputTable ? `输出表 ${step.outputTable}` : ''].filter(Boolean).join(' · ') }}</span>
                </li>
              </ol>
            </td>
          </tr>
          </template>
          <tr v-if="!rows.length && !loading">
            <td colspan="6" class="fp-empty" data-testid="flow-picker-empty">{{ emptyText }}</td>
          </tr>
        </tbody>
      </table>
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
.fp-input { height: 28px; width: 260px; max-width: 100%; padding: 0 8px; border: 1px solid var(--rc-line); border-radius: 6px; font-size: 12px; }
.fp-spacer { flex: 1; }
.fp-muted { color: var(--rc-text-2); font-size: 12px; }
.fp-table-wrap { max-height: calc(100vh - 320px); overflow: auto; }
.fp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fp-table th, .fp-table td { padding: 8px; border-bottom: 1px solid var(--rc-line); text-align: left; }
.fp-table th { color: var(--rc-text-2); font-weight: 600; position: sticky; top: 0; background: var(--rc-panel, #fff); }
.fp-table tbody tr { cursor: pointer; }
.fp-table tbody tr.disabled { cursor: not-allowed; opacity: 0.55; }
.fp-table td small { display: block; margin-top: 2px; }
.fp-badge { margin-left: 6px; padding: 0 6px; border-radius: 4px; font-size: 11px; color: #b45309; background: #fef3c7; }
.fp-empty { padding: 32px; text-align: center; color: var(--rc-faint); }
.fp-preview-row td { background: var(--rc-bg-soft, #f8fafc); cursor: default; }
.fp-steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.fp-steps b { margin-right: 6px; font-weight: 600; }
.fp-error { color: #dc2626; }
.fp-footer { display: flex; align-items: center; gap: 8px; }
</style>
