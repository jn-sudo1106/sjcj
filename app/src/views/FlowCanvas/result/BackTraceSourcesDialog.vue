<script setup lang="ts">
// 按数据条件反查源（0903 H12 / Y2）。
//
// 会上原话：「我把这些语言的任务全部发一遍，但是我不知道有哪些语言……你这个条件能带回去吗？」
// ——在全部源数据视图里按条件筛出脏数据之后，需要知道**这批数据来自哪些源**，然后整批重发。
//
// ⚠️ **这是数据条件与源条件之间唯一存在的桥，而且只有"数据 → 源"一个方向。**
// 两套筛选字段完全不同（源：ID/名称/状态/标签/备注；数据：表/SQL/状态/时间），
// 不要试图做双向同步——反过来"源条件 → 数据条件"没有任何接口支撑，硬做只能靠前端拼 SQL，
// 那等于把用户没写过的条件混进他的查询里。
//
// 地基是旧平台的「展示当前条件下所有的源」（entry/entryDistinctSource）。它只回一个 ID 数组，
// 名称/状态这些要再走 sourcePaged({ ids }) 补。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, sourceApi, type RowQuery, type Source } from '@/api'

const props = defineProps<{
  /** 打开即用它反查；为 null 表示关闭 */
  query: RowQuery | null
  /** 条件的人话描述，展示在弹窗头部，让用户确认反查的是不是他刚才筛的那批 */
  conditionLabel?: string
}>()
const emit = defineEmits<{
  close: []
  /** 在源视图中打开这批源 */
  openInSourceView: [sourceIds: string[]]
  /** 直接对这批源发任务 */
  launch: [sourceIds: string[]]
}>()

/**
 * 命中源上限。超过就不展开清单——`distinctSource` 只回 ID，补详情要按 200 一组打
 * `sourcePaged`，2000 个源就是 10 次请求；再多既慢也没人真去逐个看。
 * 超限时不是不让做，而是把"看清单"降级成"直接按条件全量发"，见模板里的超限分支。
 */
const BACKTRACE_MAX = 2000
/** 补详情的分组大小：ids 走 query string，太长会被网关截断 */
const DETAIL_CHUNK = 200

const loading = ref(false)
const error = ref('')
const sourceIds = ref<string[]>([])
const rows = ref<Source[]>([])
const selected = ref<string[]>([])

const hitCount = computed(() => sourceIds.value.length)
const overLimit = computed(() => hitCount.value > BACKTRACE_MAX)
/** 未勾选 = 全部命中；勾了就只对勾选的动作。与源视图「发任务」同一套口径（0831 F06） */
const effectiveIds = computed(() => (selected.value.length ? selected.value : sourceIds.value))

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function loadDetails(ids: string[]) {
  const found = new Map<string, Source>()
  for (const group of chunk(ids, DETAIL_CHUNK)) {
    // 详情补齐失败不阻断：清单退化成"只有 ID"仍然可用——用户要的是"哪些源"，
    // 名称是锦上添花。一组失败只影响那一组。
    try {
      const page = await sourceApi.sourcePaged({ ids: group.join(','), page: 1, size: group.length })
      for (const item of page.list) found.set(item.sourceId, item)
    } catch { /* 该组保持只有 ID */ }
  }
  rows.value = ids.map((id) => found.get(id) ?? ({ sourceId: id, name: '', url: '', configId: '', mainTable: '', owner: '', state: '' } as Source))
}

let seq = 0
async function load(query: RowQuery) {
  const reqId = ++seq
  loading.value = true
  error.value = ''
  sourceIds.value = []
  rows.value = []
  selected.value = []
  try {
    const ids = await dataApi.distinctSource(query)
    if (reqId !== seq) return
    sourceIds.value = ids
    if (!ids.length || ids.length > BACKTRACE_MAX) return
    await loadDetails(ids)
  } catch (e) {
    if (reqId !== seq) return
    error.value = `反查源失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    if (reqId === seq) loading.value = false
  }
}

watch(() => props.query, (q) => { if (q) void load(q) }, { immediate: true })

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
}
function toggleAll() {
  selected.value = selected.value.length === rows.value.length ? [] : rows.value.map((r) => r.sourceId)
}

function onOpenInSourceView() {
  if (!effectiveIds.value.length) return
  emit('openInSourceView', [...effectiveIds.value])
}
function onLaunch() {
  if (!effectiveIds.value.length) {
    ElMessage.warning('没有可发任务的源')
    return
  }
  emit('launch', [...effectiveIds.value])
}

function stateText(source: Source) {
  if (!source.name) return '—'
  if (source.disabled) return '已停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}
</script>

<template>
  <el-dialog :model-value="!!query" title="按此条件反查源" width="820px" destroy-on-close @close="emit('close')">
    <div class="bt-head">
      <div v-if="conditionLabel" class="bt-cond" data-testid="backtrace-condition">
        条件：<code>{{ conditionLabel }}</code>
      </div>
      <div v-if="loading" class="bt-state">反查中…</div>
      <div v-else-if="error" class="bt-state err" role="alert" data-testid="backtrace-error">{{ error }}</div>
      <div v-else class="bt-state" data-testid="backtrace-hit">
        命中 <b>{{ hitCount }}</b> 个源<span v-if="selected.length">，已选 {{ selected.length }} 个</span>
      </div>
    </div>

    <!-- 超限：不展开清单，但不堵死——「看清单」降级成「按条件直接发」 -->
    <div v-if="overLimit" class="bt-over" data-testid="backtrace-over-limit">
      命中源过多（{{ hitCount }} 个），已超过展示上限 {{ BACKTRACE_MAX }}。
      建议收窄数据条件后再反查；确实要全部处理的话，可以直接对这 {{ hitCount }} 个源发任务。
    </div>

    <div v-else-if="!loading && !error && !hitCount" class="bt-empty" data-testid="backtrace-empty">
      当前条件没有命中任何源。
    </div>

    <div v-else-if="!loading && !error" class="bt-table-wrap">
      <table class="bt-table">
        <thead>
          <tr>
            <th class="bt-check">
              <input type="checkbox" :checked="selected.length === rows.length && !!rows.length" @change="toggleAll" />
            </th>
            <th>源 ID</th>
            <th>源名称</th>
            <th>状态</th>
            <th>数据量</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.sourceId" data-testid="backtrace-row">
            <td class="bt-check">
              <input type="checkbox" :checked="selected.includes(row.sourceId)" @change="toggle(row.sourceId)" />
            </td>
            <td class="bt-mono">{{ row.sourceId }}</td>
            <!-- 详情补齐失败时名称为空，用一行灰字说明，不要显示成空白让人以为源坏了 -->
            <td>{{ row.name || '（未取到名称）' }}</td>
            <td>{{ stateText(row) }}</td>
            <td>{{ row.dataCount ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <span class="bt-foot-hint">未勾选 = 对全部 {{ hitCount }} 个源生效</span>
      <button class="rc-btn" type="button" @click="emit('close')">取消</button>
      <button
        class="rc-btn"
        type="button"
        data-testid="backtrace-open-source-view"
        :disabled="!hitCount || overLimit"
        title="到源视图查看这批源，可以继续按源的条件筛选"
        @click="onOpenInSourceView"
      >在源视图中打开</button>
      <button
        class="rc-btn primary"
        type="button"
        data-testid="backtrace-launch"
        :disabled="!hitCount"
        @click="onLaunch"
      >对这 {{ effectiveIds.length }} 个源发任务</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.bt-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.bt-cond { font-size: 12px; color: var(--rc-text-2); }
.bt-cond code { padding: 1px 5px; border-radius: 4px; background: #f1f5f9; font-family: var(--rc-mono, monospace); }
.bt-state { font-size: 12px; color: var(--rc-text-2); }
.bt-state.err { color: #b91c1c; }
.bt-over { padding: 12px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; color: #92400e; font-size: 12.5px; line-height: 1.7; }
.bt-empty { padding: 24px; text-align: center; color: var(--rc-faint); font-size: 12.5px; }
.bt-table-wrap { max-height: 46vh; overflow: auto; border: 1px solid var(--rc-border); border-radius: 8px; }
.bt-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.bt-table th, .bt-table td { padding: 7px 10px; border-bottom: 1px solid var(--rc-border-soft); text-align: left; }
.bt-table th { position: sticky; top: 0; background: #f8fafc; color: var(--rc-text-2); font-weight: 600; }
.bt-check { width: 36px; }
.bt-mono { font-family: var(--rc-mono, monospace); }
.bt-foot-hint { margin-right: auto; color: var(--rc-faint); font-size: 11.5px; }
</style>
