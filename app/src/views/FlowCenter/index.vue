<script setup lang="ts">
// 流程中心（0828 W6）：流程列表 + 可编辑流程工作区。
// “配置中心/流程模板”不再作为用户概念；节点自身承载配置，内部 configId 只作技术标识。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowApi, flowCenterApi, sourceApi, type FlowRecord } from '@/api'
import { useUiStore } from '@/stores/ui'
import { composeTemplateFlow, makeBlankTemplateDefinition, sanitizeTemplateDefinition } from '@/utils/flow/flowTemplates'
import GlobalSourceSelect from '@/views/FlowCanvas/result/components/GlobalSourceSelect.vue'
import FlowDetailDrawer from './FlowDetailDrawer.vue'

const ui = useUiStore()

const flows = ref<FlowRecord[]>([])
const loading = ref(false)
const loadError = ref('')
const query = ref('')
const sortBy = ref<'recent' | 'nodes'>('recent')
const activeId = ref('')
const applyFlow = ref<FlowRecord | null>(null)
const applySourceId = ref('')
const applying = ref(false)

/** 节点数：definition.main 去掉 start/end 两个终端 */
function nodeCount(t: FlowRecord): number {
  return (t.definition?.main ?? []).filter((id) => id !== 'start' && id !== 'end').length
}
/** 流程内各节点引用的 configId，供「按配置搜索」用（0828 §2.11 规则④）*/
function configIdsOf(t: FlowRecord): string[] {
  return Object.values(t.definition?.configs ?? {}).map((c) => c.configId).filter(Boolean) as string[]
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    flows.value = await flowCenterApi.list()
  } catch (e) {
    loadError.value = `流程列表加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  void load()
  ui.registerAction('新建流程', () => { void createFlow() })
})
onUnmounted(() => ui.clearActions())

// 搜索接受流程 ID / 名称 / 节点名 / 配置 ID —— 但**命中结果仍然是流程列表**（§2.11 规则②）：
// 配置只能作为查询的输入，不作为结果集，否则就等于把「配置中心」又做回来了。
const filtered = computed(() => {
  const kw = query.value.trim().toLowerCase()
  const rows = kw
    ? flows.value.filter((t) =>
      t.id.toLowerCase().includes(kw)
        || t.name.toLowerCase().includes(kw)
        || configIdsOf(t).some((id) => id.includes(kw))
        || Object.values(t.definition?.configs ?? {}).some((c) => (c.title ?? '').toLowerCase().includes(kw)))
    : [...flows.value]
  return sortBy.value === 'nodes'
    ? rows.sort((a, b) => nodeCount(b) - nodeCount(a))
    : rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
})

/** 按配置 ID 搜时的结果说明；搜到 0 条要说清"配置存在但没有流程引用它"（§2.11 规则⑤）*/
const searchIsConfigId = computed(() => /^\d{5,}$/.test(query.value.trim()))
const searchNote = computed(() => {
  if (!searchIsConfigId.value) return ''
  const n = filtered.value.length
  return n
    ? `按配置 #${query.value.trim()} 反查，命中 ${n} 条流程`
    : `配置 #${query.value.trim()} 没有被任何流程引用（它本身可能是存在的）`
})

const totals = computed(() => ({
  flows: flows.value.length,
  nodes: flows.value.reduce((sum, t) => sum + nodeCount(t), 0),
}))

const activeFlow = computed(() => flows.value.find((t) => t.id === activeId.value) ?? null)
function openFlow(t: FlowRecord) {
  activeId.value = t.id
}

function replaceFlow(saved: FlowRecord) {
  flows.value = [saved, ...flows.value.filter((item) => item.id !== saved.id)]
  activeId.value = saved.id
}

async function createFlow() {
  try {
    const { value } = await ElMessageBox.prompt('新流程会从空白画布开始，可在工作区直接添加节点并修改节点配置。', '新建流程', {
      inputValue: '未命名流程', inputPattern: /\S+/, inputErrorMessage: '请输入流程名称',
      confirmButtonText: '新建', cancelButtonText: '取消',
    })
    const created = await flowCenterApi.save({ name: value.trim(), definition: makeBlankTemplateDefinition() })
    replaceFlow(created)
    ElMessage.success('流程已新建')
  } catch {
    // 用户取消不提示。
  }
}

async function copyFlow(flow: FlowRecord) {
  try {
    const { value } = await ElMessageBox.prompt('复制会创建一条独立流程，后续修改互不影响。', '复制流程', {
      inputValue: `${flow.name} - 副本`, inputPattern: /\S+/, inputErrorMessage: '请输入流程名称',
      confirmButtonText: '复制', cancelButtonText: '取消',
    })
    const copied = await flowCenterApi.save({ name: value.trim(), definition: sanitizeTemplateDefinition(flow.definition) })
    replaceFlow(copied)
    ElMessage.success('流程已复制')
  } catch {
    // 用户取消不提示。
  }
}

function openApply(flow: FlowRecord) {
  applyFlow.value = flow
  applySourceId.value = ''
}

async function confirmApply() {
  const target = applyFlow.value
  if (!target || applying.value) return
  if (!applySourceId.value) {
    ElMessage.warning('请先选择要应用的源')
    return
  }
  applying.value = true
  try {
    const source = await sourceApi.sourceDetail(applySourceId.value)
    if (!source) {
      ElMessage.error('没有找到该源，请重新选择')
      return
    }
    await ElMessageBox.confirm(
      `应用「${target.name}」会全量替换源「${source.name || source.sourceId}」当前的流程节点，是否继续？`,
      '应用流程到源',
      { type: 'warning', confirmButtonText: '全量替换', cancelButtonText: '取消' },
    )
    const boundSource = {
      ...source,
      templateId: target.id,
      templateVersion: target.version,
      nodeBindings: {},
    }
    const definition = composeTemplateFlow(target, boundSource, {})
    const [sourceAck, flowAck] = await Promise.all([
      sourceApi.sourceUpdate(boundSource),
      flowApi.flowSave(definition),
    ])
    if (!sourceAck.ok || !flowAck.ok) throw new Error(sourceAck.message || flowAck.message || '保存失败')
    applyFlow.value = null
    applySourceId.value = ''
    ElMessage.success(`已将「${target.name}」应用到源「${source.name || source.sourceId}」`)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`应用失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <section class="fc-shell">
    <div class="fc-toolbar">
      <input
        v-model="query"
        class="fc-search"
        placeholder="搜索流程、节点或配置 ID"
        data-testid="flow-center-search"
      />
      <select v-model="sortBy" class="fc-select" aria-label="排序">
        <option value="recent">最近修改</option>
        <option value="nodes">节点数最多</option>
      </select>
      <div class="fc-metrics">
        <span>流程 <b>{{ totals.flows }}</b></span>
        <span>节点 <b>{{ totals.nodes }}</b></span>
      </div>
      <button class="fc-btn" type="button" title="刷新" :disabled="loading" @click="load">↻</button>
    </div>

    <div v-if="searchNote" class="fc-search-note" data-testid="flow-center-search-note">{{ searchNote }}</div>

    <div class="fc-table-wrap" v-loading="loading">
      <table class="fc-table">
        <thead>
          <tr>
            <th>流程 ID / 名称</th>
            <th style="width: 88px">节点数</th>
            <th style="width: 110px">使用源数</th>
            <th style="width: 150px">更新时间</th>
            <th style="width: 210px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in filtered"
            :key="t.id"
            :class="{ active: t.id === activeId }"
            data-testid="flow-center-row"
            @click="openFlow(t)"
          >
            <td>
              <div class="fc-name">
                <b>{{ t.name }}</b>
                <small>{{ t.id }} · v{{ t.version }}</small>
              </div>
            </td>
            <td>{{ nodeCount(t) }} 个</td>
            <!-- 使用源数：后端没有「按流程反查源」的接口（§4-⑦），不编造数字 -->
            <td class="fc-muted" title="需后端提供按流程反查源的接口后才能统计">—</td>
            <td class="fc-muted">{{ t.updatedAt || '—' }}</td>
            <td>
              <div class="fc-actions">
                <button class="fc-link" type="button" @click.stop="openFlow(t)">编辑</button>
                <button class="fc-link" type="button" @click.stop="copyFlow(t)">复制</button>
                <button class="fc-link" type="button" @click.stop="openApply(t)">应用到源</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !filtered.length">
            <td colspan="5" class="fc-empty">
              {{ loadError || (query ? '没有找到匹配的流程' : '暂无流程') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <FlowDetailDrawer
      :flow="activeFlow"
      @close="activeId = ''"
      @saved="replaceFlow"
      @apply="openApply"
    />

    <el-dialog
      :model-value="!!applyFlow"
      title="应用流程到源"
      width="520px"
      destroy-on-close
      @close="applyFlow = null"
    >
      <p class="fc-apply-note">选择目标源。确认后会使用当前流程的节点和配置全量替换目标源原流程。</p>
      <GlobalSourceSelect v-model="applySourceId" />
      <template #footer>
        <button class="fc-dialog-btn" type="button" @click="applyFlow = null">取消</button>
        <button class="fc-dialog-btn primary" type="button" :disabled="applying" data-testid="flow-apply-confirm" @click="confirmApply">{{ applying ? '应用中…' : '确认应用' }}</button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.fc-shell { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.fc-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fc-search { flex: 0 1 300px; height: 30px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 6px; font-size: 12px; outline: none; }
.fc-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.fc-select { height: 30px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; font-size: 12px; background: #fff; }
.fc-metrics { margin-left: auto; display: flex; gap: 14px; color: var(--rc-muted); font-size: 12px; }
.fc-metrics b { color: var(--rc-text); }
.fc-btn { height: 30px; min-width: 30px; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.fc-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.fc-search-note { padding: 7px 10px; border: 1px dashed #bfdbfe; border-radius: 7px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 12px; }
.fc-table-wrap { border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; overflow: auto; }
.fc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fc-table th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rc-border); }
.fc-table td { padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.fc-table tbody tr { cursor: pointer; }
.fc-table tbody tr:hover { background: var(--rc-primary-bg); }
.fc-table tbody tr.active { background: var(--rc-primary-bg); box-shadow: inset 2px 0 0 var(--rc-primary); }
.fc-name b { display: block; color: var(--rc-text); font-size: 13px; }
.fc-name small { color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fc-muted { color: var(--rc-faint); }
.fc-link { border: 0; background: transparent; color: var(--rc-primary); font-size: 12px; cursor: pointer; padding: 0; }
.fc-actions { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
.fc-apply-note { margin: 0 0 12px; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.fc-dialog-btn { height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.fc-dialog-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fc-dialog-btn:disabled { opacity: .55; cursor: not-allowed; }
.fc-empty { padding: 44px; text-align: center; color: var(--rc-faint); }
</style>
