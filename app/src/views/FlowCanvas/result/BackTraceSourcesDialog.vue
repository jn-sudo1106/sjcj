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
  /**
   * 当前网站下的源 ID 全集，用来判断哪些命中源算"本网站的"。
   *
   * **为什么反查会跨网站**：数据列表之所以是站内的，是前端拿网站源清单**逐源查再归并**
   * （SiteDataView 的 candidateSourceIds），站内是枚举出来的；而 `entryDistinctSource`
   * 是**一次全表查询**，只带 tableId + SQL，不带 sourceId/siteId——SiteDataView 自己的注释
   * 早就写明「不按网站过滤，返回的是全平台写过这张表的源」。根子是表共用：
   * `sense_data.TB_CNEWS` 这种表别的网站的源也往里写。
   *
   * 用源 ID 全集判定而不是看每行回填的 `siteId`：前者调用方现成就有（`siteChildren`），
   * 不依赖 `sourcePaged` 一定回填 siteId，**而且超限不补详情时照样能判定**。
   */
  siteSourceIds?: string[]
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
/** 反查取源 ID 时的分页大小，见 load() 里的说明；与 SiteDataView 的收窄逻辑取同一个值 */
const DISTINCT_SIZE = 1000

const loading = ref(false)
const error = ref('')
const sourceIds = ref<string[]>([])
/**
 * 服务端是否把结果截断了。判据是"返回条数正好等于我们要的上限"——
 * `entryDistinctSource` 走的是分页参数（`buildLegacyRowQuery` 的 page/limit），
 * 顶到 limit 就说明后面还有，本网站的源可能有一部分根本没被返回。
 * 这属于后端需求 H6 的实证：2026-09-04 走查时用一个命中面很广的条件真的顶到了 1000。
 */
const truncated = ref(false)
const rows = ref<Source[]>([])
const selected = ref<string[]>([])

const hitCount = computed(() => sourceIds.value.length)
/**
 * 是否把**其它网站**的命中源也算进来。**默认不跨网站。**
 *
 * 反查本身一定是跨网站的：`entryDistinctSource` 的载荷里没有 siteId
 * （`buildLegacyRowQuery` 压根不映射它），它按表和 SQL 条件搜全库。做不到服务端按网站过滤，
 * 只能等 `sourcePaged` 把详情（含 siteId）补回来之后在前端筛。
 *
 * 默认关掉的理由：用户是在**某个网站的**数据视图里点的反查，他心里的范围就是这个网站；
 * 而且源视图锁死在当前网站内（0812 纠偏），跨网站的 ID 递过去只会查出一张空表
 * （实测踩到过：URL 上带着 20 个 ID，源视图显示"共 0 个源"）。
 */
const includeOtherSites = ref(false)
watch(includeOtherSites, () => { selected.value = [] })
const siteIdSet = computed(() => new Set(props.siteSourceIds ?? []))
/** 命中源里属于当前网站的（没给源清单时不做区分，全部视为本网站） */
const inSiteIds = computed(() => (props.siteSourceIds?.length
  ? sourceIds.value.filter((id) => siteIdSet.value.has(id))
  : sourceIds.value))
const inSiteRows = computed(() => (props.siteSourceIds?.length
  ? rows.value.filter((r) => siteIdSet.value.has(r.sourceId))
  : rows.value))
/** 超限时不补详情，但靠源 ID 全集照样能算出跨网站数量 */
const otherSiteCount = computed(() => hitCount.value - inSiteIds.value.length)
/** 表格与所有动作的实际范围 */
const visibleRows = computed(() => (includeOtherSites.value ? rows.value : inSiteRows.value))
const overLimit = computed(() => hitCount.value > BACKTRACE_MAX)
/** 未勾选 = 全部命中；勾了就只对勾选的动作。与源视图「发任务」同一套口径（0831 F06） */
const effectiveIds = computed(() => {
  if (selected.value.length) return selected.value
  // 超限时没有 rows（不补详情），退回用 ID 集合——范围口径与非超限时保持一致
  if (overLimit.value) return includeOtherSites.value ? sourceIds.value : inSiteIds.value
  return visibleRows.value.map((r) => r.sourceId)
})

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
  truncated.value = false
  rows.value = []
  selected.value = []
  try {
    // ⚠️ **必须显式传 size**，否则 `buildLegacyRowQuery` 会退回分页默认值 20，
    // 拿回来的只是全平台前 20 个源——共用表（TB_CNEWS 这种）全平台引用源远超 20，
    // 本网站的源常常不在前 20 里，于是"命中的源一个都不属于当前网站"。
    // 这是 2026-08-14 就在 SiteDataView 里踩过并写明的坑（那边同样显式传 1000），
    // 本弹窗第一版忘了带，走查时表现成"反查结果里没有本网站的源"。
    // 1000 是那次实测确认不截断的安全值；由本组件兜底，不指望每个调用方都记得。
    const ids = await dataApi.distinctSource({ ...query, size: DISTINCT_SIZE })
    if (reqId !== seq) return
    sourceIds.value = ids
    truncated.value = ids.length >= DISTINCT_SIZE
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
  selected.value = selected.value.length === visibleRows.value.length ? [] : visibleRows.value.map((r) => r.sourceId)
}

function onOpenInSourceView() {
  // 无论当前是不是"跨网站"视图，递给源视图的只能是本网站的：它查不到别的网站的源
  const ids = effectiveIds.value.filter((id) => inSiteIds.value.includes(id))
  if (!ids.length) return
  emit('openInSourceView', ids)
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
        命中 <b>{{ visibleRows.length }}</b> 个源<span v-if="selected.length">，已选 {{ selected.length }} 个</span>
        <!-- 跨网站是常态不是异常：反查按表和条件搜全库，本来就会捞到别的网站的源。
             默认只看当前网站——用户是在这个网站的数据视图里点的反查，心里的范围就是它。 -->
        <label v-if="otherSiteCount > 0 || includeOtherSites" class="bt-cross" data-testid="backtrace-cross-site">
          <input v-model="includeOtherSites" type="checkbox" />
          包含其它网站的源（另有 {{ otherSiteCount }} 个）
        </label>
      </div>
    </div>

    <!-- 截断是"结果不完整"，跟"命中太多"不是一回事：后者能看清单只是不便，
         前者意味着本网站可能还有源没被返回，必须说出来，否则用户会以为反查全了。 -->
    <div v-if="truncated && !loading && !error" class="bt-over" data-testid="backtrace-truncated">
      服务端只返回了前 {{ DISTINCT_SIZE }} 个源（已达上限），结果可能不完整——
      本网站可能还有命中的源没被返回。请收窄数据条件后再反查。
    </div>

    <!-- 超限：不展开清单，但不堵死——「看清单」降级成「按条件直接发」 -->
    <div v-if="overLimit" class="bt-over" data-testid="backtrace-over-limit">
      命中源过多（{{ hitCount }} 个），已超过展示上限 {{ BACKTRACE_MAX }}。
      建议收窄数据条件后再反查；确实要全部处理的话，可以直接对这
      {{ includeOtherSites ? hitCount : inSiteIds.length }} 个源发任务。
    </div>

    <div v-else-if="!loading && !error && !hitCount" class="bt-empty" data-testid="backtrace-empty">
      当前条件没有命中任何源。
    </div>

    <div v-else-if="!loading && !error && !visibleRows.length" class="bt-empty" data-testid="backtrace-none-in-site">
      命中的 {{ hitCount }} 个源都不在当前网站。勾选上面的「包含其它网站的源」可以查看并对它们发任务。
    </div>

    <div v-else-if="!loading && !error" class="bt-table-wrap">
      <table class="bt-table">
        <thead>
          <tr>
            <th class="bt-check">
              <input type="checkbox" :checked="selected.length === visibleRows.length && !!visibleRows.length" @change="toggleAll" />
            </th>
            <th>源 ID</th>
            <th>源名称</th>
            <th>状态</th>
            <th>数据量</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="row.sourceId" data-testid="backtrace-row">
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
      <span class="bt-foot-hint">未勾选 = 对当前范围内全部 {{ visibleRows.length }} 个源生效</span>
      <button class="rc-btn" type="button" @click="emit('close')">取消</button>
      <button
        class="rc-btn"
        type="button"
        data-testid="backtrace-open-source-view"
        :disabled="!hitCount || overLimit || !inSiteIds.length"
        :title="inSiteIds.length ? '到源视图查看这批源，可以继续按源的条件筛选（源视图只能看本网站，跨网站的不带过去）' : '命中的源都不在当前网站，源视图只能查看本网站的源'"
        @click="onOpenInSourceView"
      >在源视图中打开{{ includeOtherSites && otherSiteCount ? `（仅本网站 ${inSiteIds.length} 个）` : '' }}</button>
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
.bt-cross { display: inline-flex; align-items: center; gap: 5px; color: #92400e; cursor: pointer; }
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
