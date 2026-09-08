<script setup lang="ts">
// 流程中心「关联流程到源」的选源弹窗（0903 §2.6 H05 的加强版，对齐旧平台）：
// 表格勾选 + 按「源名称 / ID」和「所属流程」服务端筛 + ID 批量检索 + 全选本页。
// 提交动作仍在 FlowCenter 的 confirmApply（分批 + 作业条 + 二次确认文案），这里只负责选。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { flowCenterApi, sourceApi, type FlowRecord, type Source } from '@/api'

const props = defineProps<{
  /** 目标流程；非 null 时弹窗打开 */
  flow: FlowRecord | null
  /** 已选源 ID（v-model） */
  modelValue: string[]
  submitting?: boolean
  progress?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [string[]]
  confirm: []
  close: []
}>()

const PAGE_SIZE = 20

const keyword = ref('')
const flowFilter = ref('')
const flowOptions = ref<{ id: string; name: string }[]>([])
const flowOptLoading = ref(false)
const onlyUnbound = ref(false)

const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')

const idImport = reactive({ open: false, text: '', loading: false })

// 「全选全部」一次把当前筛选下的所有源都选中（翻页选不完）。数量上限兜底：
// changeFlowBatch 单次 5000、前端按 500 分批，2 万以内都能收拾；再多先让用户收窄条件。
const SELECT_ALL_PAGE = 1000
const SELECT_ALL_MAX = 20_000
const selectingAll = ref(false)

// 选中态：modelValue 直接透传，另存名字缓存好在标签上显示
const CHIP_LIMIT = 15
const selectedSet = computed(() => new Set(props.modelValue))
const nameCache = ref(new Map<string, string>())
const selectedChips = computed(() =>
  props.modelValue.slice(0, CHIP_LIMIT).map((id) => ({ id, name: nameCache.value.get(id) || '' })),
)
const chipsMore = computed(() => Math.max(0, props.modelValue.length - CHIP_LIMIT))
function setSelected(ids: string[]) {
  emit('update:modelValue', [...new Set(ids)])
}
function toggle(source: Source) {
  nameCache.value.set(source.sourceId, source.name)
  const next = selectedSet.value.has(source.sourceId)
    ? props.modelValue.filter((id) => id !== source.sourceId)
    : [...props.modelValue, source.sourceId]
  setSelected(next)
}
function pickPage() {
  visibleRows.value.forEach((s) => nameCache.value.set(s.sourceId, s.name))
  setSelected([...props.modelValue, ...visibleRows.value.map((s) => s.sourceId)])
}
function clearSelected() {
  setSelected([])
  chipsExpanded.value = false
}

// 当前筛选（源名称 + 所属流程；「仅看未关联」是本页过滤，这里按 flowId 一并排除）下全选。
async function pickAllMatching() {
  if (selectingAll.value) return
  if (total.value > SELECT_ALL_MAX) {
    ElMessage.warning(`匹配 ${total.value} 个，太多了——请先用「源名称」或「所属流程」收窄`)
    return
  }
  selectingAll.value = true
  try {
    const collected: Source[] = []
    for (let p = 1; collected.length < total.value; p++) {
      const res = await sourceApi.sourcePaged({
        keyword: keyword.value.trim() || undefined,
        flowId: flowFilter.value || undefined,
        page: p,
        size: SELECT_ALL_PAGE,
      })
      if (!res.list.length) break
      collected.push(...res.list)
      if (res.list.length < SELECT_ALL_PAGE) break
    }
    const picked = onlyUnbound.value && props.flow
      ? collected.filter((s) => String(s.flowId ?? '') !== String(props.flow!.id))
      : collected
    picked.forEach((s) => nameCache.value.set(s.sourceId, s.name))
    setSelected([...props.modelValue, ...picked.map((s) => s.sourceId)])
    ElMessage.success(`已选中全部 ${picked.length} 个源`)
  } catch (e) {
    ElMessage.error(`全选失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    selectingAll.value = false
  }
}

// 「仅看未关联到本流程」是本页客户端过滤：翻页只对当前页生效，够用（是"别重复挑已绑的"，
// 不是全量审计）。真要按「无流程归属」筛得等后端支持 flowId is null。
const visibleRows = computed(() =>
  onlyUnbound.value && props.flow
    ? rows.value.filter((r) => String(r.flowId ?? '') !== String(props.flow!.id))
    : rows.value,
)

function flowTag(source: Source): { text: string; cls: string } {
  const fid = String(source.flowId ?? '')
  if (!fid) return { text: '无流程', cls: 'none' }
  if (props.flow && fid === String(props.flow.id)) return { text: `流程: ${fid}`, cls: 'self' }
  return { text: `流程: ${fid}`, cls: 'other' }
}
function stateText(source: Source): string {
  if (source.disabled) return '停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}

let reqId = 0
async function load() {
  const id = ++reqId
  loading.value = true
  error.value = ''
  try {
    const res = await sourceApi.sourcePaged({
      keyword: keyword.value.trim() || undefined,
      flowId: flowFilter.value || undefined,
      page: page.value,
      size: PAGE_SIZE,
    })
    if (id !== reqId) return
    rows.value = res.list
    total.value = res.total
  } catch (e) {
    if (id !== reqId) return
    rows.value = []
    total.value = 0
    error.value = `加载源列表失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    if (id === reqId) loading.value = false
  }
}

let kwTimer: ReturnType<typeof setTimeout> | undefined
function onKeyword() {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => { page.value = 1; void load() }, 300)
}
function onFlowFilter() {
  page.value = 1
  void load()
}

// 所属流程下拉：远程按名字搜流程
async function searchFlows(q: string) {
  flowOptLoading.value = true
  try {
    const res = await flowCenterApi.paged({ keywords: q.trim() || undefined, page: 1, size: 30 })
    flowOptions.value = res.list.map((f) => ({ id: f.id, name: f.name }))
  } catch {
    flowOptions.value = []
  } finally {
    flowOptLoading.value = false
  }
}

async function submitByIds() {
  const ids = [...new Set(idImport.text.split(/[,，\n\s]+/).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) { ElMessage.warning('请输入源 ID'); return }
  idImport.loading = true
  try {
    const res = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
    const found = res.list
    const missing = ids.filter((x) => !found.some((s) => s.sourceId === x))
    if (!found.length) { ElMessage.warning(`未找到匹配的源：${missing.join('、')}`); return }
    found.forEach((s) => nameCache.value.set(s.sourceId, s.name))
    setSelected([...props.modelValue, ...found.map((s) => s.sourceId)])
    let msg = `已选中 ${found.length} 个源`
    if (missing.length) msg += `；${missing.length} 个未找到：${missing.join('、')}`
    ElMessage.success(msg)
    idImport.text = ''
    idImport.open = false
  } catch (e) {
    ElMessage.error(`检索失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    idImport.loading = false
  }
}

// 选中多了就把标签墙收起来，只留一行汇总，点「展开」再看
const chipsExpanded = ref(false)
const showChips = computed(() => props.modelValue.length > 0 && (props.modelValue.length <= CHIP_LIMIT || chipsExpanded.value))

watch(() => props.flow?.id, (id) => {
  if (!id) return
  keyword.value = ''
  flowFilter.value = ''
  onlyUnbound.value = false
  chipsExpanded.value = false
  page.value = 1
  idImport.open = false
  idImport.text = ''
  void load()
  void searchFlows('')
}, { immediate: true })
</script>

<template>
  <el-dialog
    :model-value="!!flow"
    :title="flow ? `关联流程到源 · ${flow.name}` : '关联流程到源'"
    width="920px"
    top="6vh"
    destroy-on-close
    @close="emit('close')"
  >
    <p class="fsp-note">
      勾选要关联的源，可多选。关联后这些源将<b>共用本流程的配置并按它运行</b>；此后修改这个流程的配置会同时影响它们。
    </p>

    <div class="fsp-filters">
      <input
        v-model="keyword"
        class="fsp-input"
        data-testid="fsp-keyword"
        placeholder="按源名称 / ID 搜索"
        @input="onKeyword"
      >
      <el-select
        v-model="flowFilter"
        class="fsp-flow"
        data-testid="fsp-flow-filter"
        filterable
        remote
        clearable
        placeholder="所属流程（全部）"
        :remote-method="searchFlows"
        :loading="flowOptLoading"
        @change="onFlowFilter"
      >
        <el-option v-for="o in flowOptions" :key="o.id" :label="`${o.name}（${o.id}）`" :value="o.id" />
      </el-select>
      <label class="fsp-check">
        <input v-model="onlyUnbound" type="checkbox" data-testid="fsp-only-unbound"> 仅看未关联到本流程
      </label>
      <button class="fsp-btn" type="button" @click="idImport.open = !idImport.open">
        {{ idImport.open ? '收起 ID 批量检索' : 'ID 批量检索' }}
      </button>
    </div>

    <div v-if="idImport.open" class="fsp-idimport">
      <textarea v-model="idImport.text" class="fsp-idbox" placeholder="粘贴源 ID，逗号或换行分隔" rows="2" />
      <button class="fsp-btn primary" type="button" :disabled="idImport.loading" @click="submitByIds">
        {{ idImport.loading ? '检索中…' : '加入选择' }}
      </button>
    </div>

    <div class="fsp-selbar">
      <button type="button" class="fsp-linkbtn" data-testid="fsp-pick-page" @click="pickPage">全选本页</button>
      <button
        v-if="total > visibleRows.length"
        type="button"
        class="fsp-linkbtn"
        data-testid="fsp-pick-all"
        :disabled="selectingAll"
        @click="pickAllMatching"
      >{{ selectingAll ? '取全部中…' : `全选全部（共 ${total} 条）` }}</button>
      <span class="fsp-selbar-gap" />
      <span class="fsp-selected" data-testid="fsp-selected-count">已选 {{ modelValue.length }}</span>
      <button v-if="modelValue.length > CHIP_LIMIT" type="button" class="fsp-linkbtn" @click="chipsExpanded = !chipsExpanded">
        {{ chipsExpanded ? '收起' : '展开' }}
      </button>
      <button v-if="modelValue.length" type="button" class="fsp-linkbtn" @click="clearSelected">清空</button>
    </div>

    <div v-if="showChips" class="fsp-chips" data-testid="fsp-chips">
      <span v-for="c in selectedChips" :key="c.id" class="fsp-chip">
        {{ c.name || c.id }}
        <button type="button" class="fsp-chip-x" @click="toggle({ sourceId: c.id } as Source)">✕</button>
      </span>
      <span v-if="chipsMore" class="fsp-chip-more">…等 {{ chipsMore }} 个</span>
    </div>

    <div class="fsp-table-wrap" v-loading="loading">
      <table class="fsp-table">
        <thead>
          <tr>
            <th class="fsp-check-col" />
            <th>源 ID</th><th>源名称</th><th>网站</th><th>状态</th><th>当前流程</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in visibleRows"
            :key="s.sourceId"
            :class="{ picked: selectedSet.has(s.sourceId) }"
            @click="toggle(s)"
          >
            <td class="fsp-check-col"><input type="checkbox" :checked="selectedSet.has(s.sourceId)" @click.stop="toggle(s)"></td>
            <td class="fsp-mono">{{ s.sourceId }}</td>
            <td>{{ s.name }}</td>
            <td>{{ s.siteName || s.siteId || '—' }}</td>
            <td>{{ stateText(s) }}</td>
            <td><span class="fsp-flowtag" :class="flowTag(s).cls">{{ flowTag(s).text }}</span></td>
          </tr>
          <tr v-if="!visibleRows.length && !loading">
            <td colspan="6" class="fsp-empty">{{ error || (onlyUnbound ? '本页没有未关联到本流程的源' : '没有匹配的源') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="fsp-pager">
      <el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="PAGE_SIZE"
        layout="total, prev, pager, next, jumper"
        background
        small
        @current-change="load"
      />
    </div>

    <p v-if="progress" class="fsp-note" data-testid="flow-apply-progress">{{ progress }}</p>

    <template #footer>
      <button class="fsp-btn" type="button" @click="emit('close')">取消</button>
      <button
        class="fsp-btn primary"
        type="button"
        data-testid="flow-apply-confirm"
        :disabled="submitting || !modelValue.length"
        @click="emit('confirm')"
      >{{ submitting ? '关联中…' : `确认关联（${modelValue.length} 个）` }}</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fsp-note { margin: 0 0 10px; color: var(--rc-text-2); font-size: 12px; line-height: 1.6; }
.fsp-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.fsp-input { height: 28px; width: 220px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; }
.fsp-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.fsp-flow { width: 220px; }
.fsp-flow :deep(.el-select__wrapper) { min-height: 28px; font-size: 12px; }
.fsp-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--rc-text-2); }
.fsp-selbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; padding: 6px 10px; border: 1px solid var(--rc-border-soft); border-radius: 7px; background: #f8fafc; font-size: 12px; }
.fsp-selbar-gap { flex: 1; }
.fsp-selected { color: var(--rc-primary); font-weight: 600; }
.fsp-btn { height: 28px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.fsp-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.fsp-btn.primary { background: var(--rc-primary); border-color: var(--rc-primary); color: #fff; }
.fsp-btn:disabled { opacity: .5; cursor: not-allowed; }
.fsp-idimport { display: flex; gap: 8px; margin-bottom: 8px; }
.fsp-idbox { flex: 1; padding: 6px 8px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; resize: vertical; }
.fsp-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; max-height: 88px; overflow-y: auto; }
.fsp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 10px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 11px; }
.fsp-chip-x { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 10px; padding: 0; }
.fsp-chip-more { align-self: center; color: var(--rc-faint); font-size: 11px; }
.fsp-table-wrap { max-height: 44vh; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; }
.fsp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fsp-table th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rc-border); }
.fsp-table td { padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.fsp-table tbody tr { cursor: pointer; }
.fsp-table tbody tr:hover { background: var(--rc-primary-bg); }
.fsp-table tbody tr.picked { background: var(--rc-primary-bg); }
.fsp-check-col { width: 60px; text-align: center; }
.fsp-mono { font-family: var(--rc-mono, monospace); color: var(--rc-faint); }
.fsp-empty { padding: 24px 12px; text-align: center; color: var(--rc-faint); }
.fsp-linkbtn { border: 0; background: transparent; color: var(--rc-primary); font-size: 12px; cursor: pointer; padding: 0; }
.fsp-linkbtn:hover:not(:disabled) { text-decoration: underline; }
.fsp-linkbtn:disabled { color: var(--rc-faint); cursor: not-allowed; }
.fsp-flowtag { padding: 1px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap; }
.fsp-flowtag.self { background: var(--rc-ok-bg, #ecfdf5); color: var(--rc-ok, #059669); border: 1px solid currentColor; }
.fsp-flowtag.other { background: #fffbeb; color: #b45309; border: 1px solid #fcd34d; }
.fsp-flowtag.none { background: #f1f5f9; color: var(--rc-faint); border: 1px solid var(--rc-border); }
.fsp-pager { display: flex; justify-content: flex-end; margin-top: 8px; }
</style>
