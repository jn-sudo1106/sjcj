<script setup lang="ts">
// 监控视图「监控配置」Tab（0916 起是配置编辑页；**2026-09-18 改版**）：
//   · 页面主体改成 ck_source 的**分页列表**（样式与「监控结果」Tab 的列表一致：
//     smv-toolbar / smv-summary / rc-data-table / el-pagination 同一套）；
//   · 「新增配置」打开居中弹窗，弹窗内容就是改版前这个 Tab 的整页编辑器
//     （MonitorConfigEditor.vue：按源选数据监控节点 + 编排/告警配置）；
//   · 行上「编辑」用该行的 sourceId 打开同一个弹窗，保存后回到列表并刷新。
//
// 列表数据走 ck_source 分页接口（/api/source/page，2026-09-18 后端新增，
// /api/source/list 的分页版）；监控结果那张列表是 sourceCheck 的旧监控表，别混。
//
// 2026-10-16 新增「＋ 新增监控」入口：迁移旧平台 data-view 的「加监控」——
// 旧 `page/config/SourceList.vue` 的铃铛 → `MonitorModal.vue`（监控列表弹窗，内嵌 MonitorList）
// → 弹窗里点「加监控」→ `MonitorList.handleAdd()` 用它拿到的 sourceId 预填 → `CheckAdd.vue`
// → `POST /v1/source/check/add`。
// 这套在新平台早已迁好：`api/monitor.ts` + `Monitor/sourceCheck/CheckEditDialog.vue`
// （1:1 迁 CheckAdd.vue）+ `Monitor/sourceCheck/index.vue`（1:1 迁 MonitorList）。
// 唯独缺 MonitorModal 那层壳——列表要用它带进来的 sourceId 过滤、并作为「加监控」的数据源；
// 少了它「数据源」就没值可提交。壳已补在 `Monitor/sourceCheck/SourceMonitorDialog.vue`，这里直接调它。
import { onMounted, reactive, ref, watch } from 'vue'
import { ckSourceApi, type CkSourceRecord } from '@/api'
import MonitorConfigEditor from './MonitorConfigEditor.vue'
import SourceMonitorDialog from '@/views/Monitor/sourceCheck/SourceMonitorDialog.vue'

// siteId 只在模板里传给弹窗里的编辑器（编辑器要按它列源候选），脚本侧用不到。
// sourceId 是可选过滤：网站视图（全部）不传、翻整表；画布「监控视图」按当前源进来说，
// 传当前 sourceId，列表就只显示这一个源的配置。
const props = defineProps<{ siteId: string; sourceId?: string }>()

const filters = reactive({ name: '' })
const rows = ref<CkSourceRecord[]>([])
const total = ref(0)
const page = ref(1)
const PAGE_SIZE = 10
const loading = ref(false)
const error = ref('')

/** 新增/编辑弹窗：open 控制显隐，sourceId 为 '' 是「新增」（全部源起步），有值是编辑那一行的源 */
const dialog = reactive({ open: false, sourceId: '' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await ckSourceApi.page({
      pageNum: page.value,
      pageSize: PAGE_SIZE,
      ...(props.sourceId ? { sourceId: props.sourceId } : {}),
      ...(filters.name.trim() ? { name: filters.name.trim() } : {}),
    })
    rows.value = result.list
    total.value = result.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '监控配置列表加载失败'
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  page.value = 1
  void load()
}
function clearFilters() {
  filters.name = ''
  runQuery()
}

function openAdd() {
  dialog.sourceId = ''
  dialog.open = true
}
function openEdit(row: CkSourceRecord) {
  dialog.sourceId = String(row.sourceId)
  dialog.open = true
}
/** 编辑器里保存成功后：关掉弹窗并刷新列表，让新写进去的那条立刻可见 */
function onSaved() {
  dialog.open = false
  void load()
}

// ---- 「＋ 新增监控」（sourceCheck，与上面的 ck_source 配置弹窗是两码事） ----
// 对齐旧 `SourceList.vue:523` 的铃铛：`showMonitorModal(scope.row)` → `monitorModal.showModal(row)`
// → `MonitorModal` 把 `row.sourceId` 交给 MonitorList。这里把当前源的 sourceId 交给弹窗，
// 弹窗内列表按它过滤，列表里的「加监控」再拿它预填表单的「数据源」——这才是「数据源」值的来源。
// 没带源时不拦：列表会不带过滤地全量展示，用户在弹窗里选好源再点「加监控」即可。
const monitorDialogRef = ref<InstanceType<typeof SourceMonitorDialog>>()
function openAddMonitor() {
  monitorDialogRef.value?.showModal(props.sourceId)
}

onMounted(() => {
  void load()
})

// 画布换源（同一监控视图组件实例不重挂）时回到第一页按新源重查。
watch(() => props.sourceId, () => {
  page.value = 1
  void load()
})
</script>

<template>
  <div class="smc-shell">
    <div class="smv-toolbar">
      <div class="smv-action-wrap">
        <input v-model="filters.name" class="smv-input" placeholder="名称" aria-label="名称" />
        <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
        <button class="rc-btn" type="button" @click="clearFilters">清空</button>
      </div>
      <div class="smv-action-wrap">
        <button class="rc-btn primary smc-add" type="button" data-testid="site-monitor-config-add" @click="openAdd">＋ 新增配置</button>
        <!-- 「＋ 新增监控」= 旧平台 SourceList 铃铛那条链路（sourceCheck 告警），与左侧的 ck_source 配置不同源。
             testid 不能也叫 site-monitor-config-add：测试里那个名字指的是「＋ 新增配置」，
             两个同名会让 wrapper.get() 直接抛 "found multiple elements"。 -->
        <button class="rc-btn primary smc-add" type="button" data-testid="site-monitor-check-add" @click="openAddMonitor">＋ 新增监控</button>
      </div>
    </div>

    <div v-if="error" class="smv-empty">{{ error }}</div>
    <template v-else>
      <div class="smv-summary">
        <span class="smv-count">共 {{ total.toLocaleString() }} 条监控配置</span>
      </div>

      <div class="smv-table-wrap">
        <table class="rc-data-table smv-table" v-loading="loading">
          <thead>
            <tr>
              <th style="width:180px">名称</th>
              <th style="width:110px">源 ID</th>
              <th style="min-width:220px">执行结果</th>
              <th style="width:180px">表</th>
              <th style="width:150px">定时</th>
              <th style="width:120px">上次</th>
              <th style="width:90px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td :title="row.name">{{ row.name }}</td>
              <td :title="String(row.sourceId)">{{ row.sourceId }}</td>
              <td class="smv-msg" :title="row.lastMsg">{{ row.lastMsg || '—' }}</td>
              <td :title="row.tableName">{{ row.tableName || '—' }}</td>
              <td :title="`cron ${row.schedule || '—'}｜下次 ${row.nextRun || '—'}`">{{ row.schedule || '—' }}</td>
              <td>{{ row.lastRun || '—' }}</td>
              <td class="smv-ops">
                <button type="button" class="smv-link" data-testid="site-monitor-config-edit" @click="openEdit(row)">编辑</button>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading">
              <td colspan="7" class="smv-empty-cell">暂无监控配置，点右上角「＋ 新增配置」开始配置</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="smv-pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          layout="total, prev, pager, next, jumper"
          background
          small
          :disabled="loading"
          @current-change="load"
        />
      </div>
    </template>

    <!-- 新增/编辑配置弹窗：内容 = 改版前这个 Tab 的整页编辑器。
         key 带 sourceId：新增（''）与编辑不同行时整块重挂，编辑器内部的节点/编排状态回到初值；
         destroy-on-close 保证关掉弹窗后不残留上一份编辑状态。 -->
    <el-dialog
      v-model="dialog.open"
      class="smc-dialog"
      data-testid="site-monitor-config-dialog"
      :title="dialog.sourceId ? `编辑监控配置（源 ${dialog.sourceId}）` : '新增监控配置'"
      width="min(1080px, 94vw)"
      top="5vh"
      append-to-body
      destroy-on-close
    >
      <div class="smc-dialog-body">
        <MonitorConfigEditor
          :key="dialog.sourceId || 'new'"
          :site-id="siteId"
          :source-id="dialog.sourceId || undefined"
          @saved="onSaved"
        />
      </div>
    </el-dialog>

    <!-- 新增监控弹窗：复刻旧平台 `MonitorModal.vue`（监控列表弹窗，内嵌 MonitorList）。
         入口只把当前源的 sourceId 交给它，弹窗内的列表按该源过滤，
         列表里的「加监控」再拿这个 sourceId 去预填表单的「数据源」——数据源字段就是这么来的。 -->
    <SourceMonitorDialog ref="monitorDialogRef" />
  </div>
</template>

<style scoped>
.smc-shell { display: flex; flex-direction: column; min-height: 0; flex: 1; background: #fff; }
/* 列表骨架沿用「监控结果」Tab 的同一套样式语义（smv-toolbar/smv-summary/smv-table/smv-pager） */
.smv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; justify-content: space-between; }
.smv-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.smv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.smv-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
/* 右侧操作区整体靠右。这行必须在 wrap 上、不能落在每个 .smc-add 按钮上：
   两个按钮各带一个 margin-left:auto 时，Flex 会把剩余空间平分给两个 auto，
   两个按钮之间被凭空撑开一段。 */
.smv-toolbar .smv-action-wrap:last-child { margin-left: auto; }
.smv-action-wrap {
  display: flex;
  gap: 10px;
}

.smv-summary { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; font-size: 12px; }
.smv-count { color: var(--rc-text-2); font-weight: 700; }

.smv-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.smv-table td { font-size: 12px; }
.smv-msg { max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text-2); }
/* 操作列钉在右边（同监控结果列表）：窄屏横向滚动时「编辑」不会滚出视野 */
.smv-table th:last-child,
.smv-table td:last-child { position: sticky; right: 0; background: #fff; box-shadow: -8px 0 8px -8px rgba(15, 23, 42, 0.18); }
.smv-table thead th:last-child { background: #f8fafc; }
.smv-ops { white-space: nowrap; }
.smv-link { border: 0; background: none; padding: 0 6px 0 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.smv-link:hover { text-decoration: underline; }
.smv-empty { padding: 40px 24px; text-align: center; color: var(--rc-faint); font-size: 13px; }
.smv-empty-cell { padding: 32px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.smv-pager { display: flex; justify-content: flex-end; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); }

/* 弹窗：编辑器是整屏式布局，撑满弹窗主体高度；外层滚动交给编辑器自己的 .smc-body */
.smc-dialog-body { display: flex; flex-direction: column; height: 72vh; min-height: 420px; }
.smc-dialog-body > :deep(.smc-shell) { border: 1px solid var(--rc-border-soft); border-radius: 8px; overflow: hidden; }
</style>
