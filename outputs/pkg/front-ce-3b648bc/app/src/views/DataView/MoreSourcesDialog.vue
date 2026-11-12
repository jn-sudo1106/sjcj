<script setup lang="ts">
// 数据中心「选择源」弹窗。1021-05（设计方案 §5.1、§5.2）起列和筛选对齐源管理源列表：
// 源 ID / 名称 / 业务目录 / 网站 / 来源组 / 启停 / 运行状态 + 左侧系统目录 / 业务目录（13.6 寸下不出横向滚动，主表 / 数据量列不再放）；查询参数见 sourcePickerQuery.ts，
// 同一筛选下与源管理总数一致。启停和运行状态分两列：以前按在用 / 停用筛完，列表里只有运行状态 C，看不出区别。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { siteApi, sourceApi, sourceGroupApi, type Source } from '../../api'
import { bizMembership, bizScopeSourceIds, dirNode } from '@/api/sourceDirs'
import SourceDirPanel, { type DirScope } from '@/views/CollectAssets/SourceDirPanel.vue'
import { sourceRunStateInfo } from '@/constants/runState'
import { withoutComposition } from '@/utils/enterKey'
import { blankPickerFilter, pickerSourceQuery, type PickerDirScope, type PickerFilter } from './sourcePickerQuery'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; picked: [Source] }>()

const filter = reactive<PickerFilter>(blankPickerFilter())
const advanced = ref(false)
const state = reactive<{ loading: boolean; page: number; size: number; total: number; list: Source[] }>({
  loading: false, page: 1, size: 20, total: 0, list: [],
})
// 以 13.6 寸屏幕为基准：弹层本身不再纵向滚动，表格承担右侧结果的主滚动。
const tableHeight = 'clamp(300px, calc(100vh - 360px), 460px)'
const UNBOUND_SITE = '-1'

// ---- 网站 / 来源组候选（同源管理：sourcePaged 列表只回 siteId / sourceGroupId，名称靠候选映射） ----
const siteOptions = ref<{ siteId: string; name: string }[]>([])
const groupOptions = ref<{ sourceGroupId: string; name: string; state: string }[]>([])
async function loadOptions() {
  const [sites, groups] = await Promise.allSettled([
    siteOptions.value.length ? Promise.resolve(null) : siteApi.sitePaged({ page: 1, size: 2000 }),
    groupOptions.value.length ? Promise.resolve(null) : sourceGroupApi.list(),
  ])
  // 候选只是筛选辅助，拉不到就只剩「全部」，不打断列表
  if (sites.status === 'fulfilled' && sites.value) siteOptions.value = sites.value.list.map((s) => ({ siteId: s.siteId, name: s.name }))
  if (groups.status === 'fulfilled' && groups.value) {
    groupOptions.value = groups.value.map((g) => ({ sourceGroupId: g.sourceGroupId, name: g.sourceGroupName, state: g.state }))
  }
}
const siteNameById = computed(() => new Map(siteOptions.value.map((s) => [s.siteId, s.name])))
const groupNameById = computed(() => new Map(groupOptions.value.map((g) => [g.sourceGroupId, g.name])))
function siteText(row: Source) {
  if (!row.siteId || row.siteId === '0') return ''
  return row.siteName || siteNameById.value.get(String(row.siteId)) || String(row.siteId)
}
function groupText(row: Source) {
  if (!row.sourceGroupId) return ''
  return groupNameById.value.get(row.sourceGroupId) ?? `组 #${row.sourceGroupId}`
}

// 「业务目录」列：同源管理（SourceTab.bizNames），没有反查接口，整棵业务目录树 listSources 一遍，会话内缓存
const bizOf = ref(new Map<string, string[]>())
async function loadBizMembership() {
  try { bizOf.value = await bizMembership() } catch { /* 列显示「—」，不打断列表 */ }
}
const bizNames = (sourceId: string) => (bizOf.value.get(sourceId) ?? []).map((id) => dirNode(id)?.name ?? `#${id}`)

// ---- 左侧目录（复用源管理的 SourceDirPanel：系统目录按 categorys，业务目录先取目录里的源再按源 ID 范围） ----
const dirCollapsed = ref(false)
const dirScope = ref<DirScope>({ kind: 'biz', dirIds: [], labels: [] })
const dirSourceIds = ref<string[]>()
const dirError = ref('')
let dirSeq = 0
async function onDirScope(scope: DirScope) {
  const seq = ++dirSeq
  const active = (s: DirScope) => !!(s.all || s.dirIds.length)
  // 目录面板挂载 / 切系统 ↔ 业务时也会报一次范围；前后都是「不按目录筛」就不必重查
  const changed = active(scope) || active(dirScope.value)
  dirScope.value = scope
  dirError.value = ''
  dirSourceIds.value = undefined
  if (scope.kind === 'biz' && (scope.all || scope.dirIds.length)) {
    try {
      const ids = await bizScopeSourceIds(scope.dirIds)
      if (seq !== dirSeq) return
      dirSourceIds.value = ids
    } catch (error) {
      if (seq !== dirSeq) return
      dirSourceIds.value = []
      dirError.value = `读取业务目录里的源失败：${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (changed && props.modelValue) onSearch()
}
function currentDir(): PickerDirScope {
  const scope = dirScope.value
  if (!(scope.all || scope.dirIds.length)) return {}
  return scope.kind === 'sys' ? { categoryIds: scope.dirIds } : { sourceIds: dirSourceIds.value ?? [] }
}

let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  const query = pickerSourceQuery(filter, currentDir())
  // 目录范围和源 ID 对不上：同源管理，直接空列表，不发请求（否则空串会被当成不限）
  if (query.sourceIds === '') {
    state.list = []
    state.total = 0
    return
  }
  state.loading = true
  try {
    const r = await sourceApi.sourcePaged({ ...query, page: state.page, size: state.size })
    if (seq !== loadSeq) return
    state.list = r.list
    state.total = r.total
  } catch (error) {
    if (seq !== loadSeq) return
    ElMessage.error(`加载源列表失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (seq === loadSeq) state.loading = false
  }
}

function onSearch() { state.page = 1; void load() }
function onReset() {
  Object.assign(filter, blankPickerFilter())
  onSearch()
}
function onPageChange() { void load() }
function onSizeChange() { state.page = 1; void load() }

watch(() => props.modelValue, (v) => {
  if (!v) return
  // 默认条件同源管理（全部状态），不再默认只看在用——测试拿两边对数时这是最大的差异来源
  Object.assign(filter, blankPickerFilter())
  advanced.value = false
  state.page = 1
  void loadOptions()
  void loadBizMembership()
  void load()
})

function pick(row: Source) {
  emit('picked', row)
  emit('update:modelValue', false)
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterSearch = withoutComposition(() => onSearch())
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="dv-picker-dialog"
    title="源列表选择"
    width="980px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="dv-source-layout" :class="{ 'dir-collapsed': dirCollapsed }">
      <SourceDirPanel v-model:collapsed="dirCollapsed" class="dv-source-dirs" @change="onDirScope" />

      <main class="dv-source-main">
        <div class="dv-picker-toolbar">
          <el-input v-model="filter.sourceIds" clearable placeholder="源 ID（可输入多个）" style="width: 170px" data-testid="picker-source-ids" @keyup.enter="onEnterSearch" />
          <el-input v-model="filter.name" clearable placeholder="源名称" style="width: 150px" data-testid="picker-name" @keyup.enter="onEnterSearch" />
          <el-select v-model="filter.site" filterable placeholder="网站" style="width: 140px" data-testid="picker-site" @change="onSearch">
            <el-option label="全部网站" value="" />
            <el-option label="未关联网站" :value="UNBOUND_SITE" />
            <el-option v-for="s in siteOptions" :key="s.siteId" :label="s.name" :value="s.siteId" />
          </el-select>
          <el-select v-model="filter.sourceGroup" filterable placeholder="来源组" style="width: 140px" data-testid="picker-group" @change="onSearch">
            <el-option label="全部来源组" value="" />
            <el-option v-for="g in groupOptions" :key="g.sourceGroupId" :label="g.name" :value="g.sourceGroupId" :disabled="g.state !== 'ACTIVE'" />
          </el-select>
          <el-select v-model="filter.status" style="width: 130px" data-testid="picker-status" @change="onSearch">
            <el-option label="全部状态" value="all" />
            <el-option-group label="启停">
              <el-option label="在用" value="enabled" />
              <el-option label="停用" value="disabled" />
            </el-option-group>
            <el-option-group label="运行状态（在用的源）">
              <el-option label="正常" value="C" />
              <el-option label="运行中" value="L" />
              <el-option label="异常" value="E" />
            </el-option-group>
          </el-select>
          <el-button type="primary" @click="onSearch">查询</el-button>
          <el-button @click="onReset">重置</el-button>
          <button class="dv-advanced-link" type="button" @click="advanced = !advanced">
            {{ advanced ? '收起' : '展开' }}
            <span>{{ advanced ? '⌃' : '⌄' }}</span>
          </button>
          <span class="dv-picker-spacer" />
          <button class="dv-picker-refresh" type="button" title="刷新" aria-label="刷新" @click="load">
            <el-icon><Refresh /></el-icon>
          </button>
        </div>

        <div v-if="advanced" class="dv-source-advanced">
          <el-input v-model="filter.sourceUrl" clearable placeholder="URL 片断" @keyup.enter="onEnterSearch" />
          <el-input v-model="filter.countMax" clearable placeholder="数据量 ≤" @keyup.enter="onEnterSearch" />
        </div>
        <div v-if="dirError" class="dv-dir-error">{{ dirError }}</div>

        <el-table v-loading="state.loading" :data="state.list" border :height="tableHeight" show-overflow-tooltip @row-click="pick">
          <el-table-column prop="sourceId" label="源 ID" width="108" />
          <el-table-column prop="name" label="源名称" min-width="130" />
          <el-table-column label="业务目录" min-width="100">
            <template #default="{ row }">
              <span data-testid="picker-biz">{{ bizNames(row.sourceId).join('、') || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="网站" min-width="90">
            <template #default="{ row }">
              <span v-if="siteText(row)">{{ siteText(row) }}</span>
              <span v-else class="dv-muted">未关联</span>
            </template>
          </el-table-column>
          <el-table-column label="来源组" min-width="90">
            <template #default="{ row }">{{ groupText(row) || '—' }}</template>
          </el-table-column>
          <el-table-column label="启停" width="100">
            <template #default="{ row }">
              <span class="dv-enable" data-testid="picker-enable" :aria-label="row.disabled ? '停用' : '在用'">
                <el-switch :model-value="!row.disabled" size="small" class="dv-enable-switch" tabindex="-1" aria-readonly="true" />
                <span :class="row.disabled ? 'dv-enable-off' : 'dv-enable-on'">{{ row.disabled ? '停用' : '在用' }}</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="运行状态" width="88">
            <template #default="{ row }">
              <span
                data-testid="picker-run-state"
                :title="sourceRunStateInfo(row.state).hint"
                :class="{ 'dv-unknown': !sourceRunStateInfo(row.state).known }"
              >{{ sourceRunStateInfo(row.state).label }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="dv-picker-pagination">
          <el-pagination
            v-model:current-page="state.page"
            v-model:page-size="state.size"
            :total="state.total"
            :page-sizes="[20, 40, 100, 200]"
            layout="total, sizes, prev, pager, next"
            background
            size="small"
            @current-change="onPageChange"
            @size-change="onSizeChange"
          />
        </div>
      </main>
    </div>
  </el-dialog>
</template>

<style scoped>
.dv-picker-dialog :deep(.el-dialog) { max-width: calc(100vw - 48px); margin: 5vh auto; }
.dv-picker-dialog :deep(.el-dialog__body) { max-height: calc(100vh - 150px); overflow: hidden; }
.dv-source-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px; height: min(620px, calc(100vh - 190px)); }
.dv-source-layout.dir-collapsed { grid-template-columns: 36px minmax(0, 1fr); }
.dv-source-dirs { min-height: 0; }
.dv-source-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.dv-picker-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.dv-advanced-link { padding: 8px 4px; border: 0; background: transparent; color: var(--rc-primary-ink); cursor: pointer; font-size: 13px; }
.dv-picker-spacer { flex: 1; }
.dv-picker-refresh { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.dv-picker-refresh:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dv-source-advanced { display: grid; grid-template-columns: repeat(2, minmax(140px, 220px)); gap: 8px; margin-bottom: 10px; }
.dv-dir-error { margin-bottom: 8px; color: var(--rc-error); font-size: 12px; }
.dv-picker-pagination { display: flex; justify-content: flex-end; margin-top: 12px; }
.dv-muted { color: var(--rc-faint); }
.dv-unknown { color: var(--rc-muted); text-decoration: underline dotted; }
/* 启停：项目现有轻量滑动开关，只读展示（不可点，点行就是选中这个源），旁边写明状态文字 */
.dv-enable { display: inline-flex; align-items: center; gap: 6px; }
.dv-enable-switch { pointer-events: none; }
.dv-enable-on { color: var(--rc-primary-ink); }
.dv-enable-off { color: var(--rc-muted); }
@media (max-width: 900px) {
  .dv-picker-dialog :deep(.el-dialog__body) { overflow: auto; }
  .dv-source-layout { grid-template-columns: 1fr; height: auto; }
  .dv-source-dirs { max-height: 220px; }
}
</style>
