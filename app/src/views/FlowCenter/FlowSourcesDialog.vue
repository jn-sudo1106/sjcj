<script setup lang="ts">
// 流程「使用源数」下钻：列出挂在该流程下的源，操作对齐旧平台「流程源列表」。
//
// 走 sourcePaged 的 flowId 过滤——2026-09-02 生产实测确认后端认这个条件（无条件 16929 条，
// flowId=1400330 得 46 条且与该流程 sourceCnt 一致，传不存在的 flowId 得 0 条），不是静默忽略。
// 服务端分页：单个流程下最多见过 5439 个源（流程 1400976），不能赌 size 上限。
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, sourceApi, type FlowRecord, type Source } from '@/api'

const props = defineProps<{
  flow: FlowRecord | null
  /** 上层关联完源后 +1，触发本弹窗重查 */
  refreshTick?: number
}>()
const emit = defineEmits<{
  close: []
  apply: []
  changed: []
}>()

const router = useRouter()
const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const error = ref('')
const unbinding = ref('')

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

async function unbind(source: Source) {
  const flow = props.flow
  if (!flow) return
  const label = source.name || source.sourceId
  try {
    await ElMessageBox.confirm(
      `将把源「${label}」（${source.sourceId}）从流程「${flow.name}」上解绑。`
      + '解绑后这个源不再按该流程的配置运行；如果它还关联着别的流程，那些流程不受影响。继续？',
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
  <el-dialog
    :model-value="!!flow"
    :title="flow ? `流程「${flow.name}」的关联源` : ''"
    width="980px"
    style="max-width: calc(100vw - 32px)"
    destroy-on-close
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
      <button class="rc-btn primary" type="button" data-testid="flow-sources-apply" @click="emit('apply')">
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
            <th>源 ID / 名称</th>
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
          <tr v-for="s in rows" :key="s.sourceId" data-testid="flow-source-row">
            <td>
              <button class="fs-name" type="button" :title="s.name || s.sourceId" @click="openSource(s)">
                <b>{{ s.name || s.sourceId }}</b>
                <small>{{ s.sourceId }}</small>
              </button>
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
              <button
                class="fs-op danger"
                type="button"
                data-testid="flow-source-unbind"
                :disabled="unbinding === s.sourceId"
                @click="unbind(s)"
              >解绑</button>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td colspan="8" class="fs-empty">{{ error || emptyText }}</td>
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
  </el-dialog>
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
.fs-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 0 0; }
</style>
