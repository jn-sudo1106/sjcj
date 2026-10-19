<script setup lang="ts">
// 「更多源...」选择弹窗 —— 迁移旧 data-view `src/page/base/detail/SourceListShow.vue`
// （它内嵌的是 `config/list/SourceList2.vue`，即源列表页的精简版）。
//
// 旧链路：`DSourceSelect.showMore()` → `SourceListShow.showModal()`（`a-modal` 宽 `clientWidth-100`，
// 内嵌 SourceList2 整页）→ 点确定读 `$refs.sourceList.selectedRows` → `$emit('selected', rows)`
// → 调用方 `handleSelected(rows)` 把选中的源灌回下拉的候选列表并选中第一个。
//
// 1014 补齐：上一版只做了「源ID / 名称 / 状态」三个筛选 + 一个自拟列表格，与旧 SourceList2 差得远。
// 现按旧版口径补回三块：
//   · **左侧分类树**（旧 `config/modules/CategoryTree.vue`）——点节点 = 单选下钻、勾选 = 多选，
//     emit 出分类 id 列表 → 请求参数 `categorys`（逗号拼接，空 = 全部）；
//   · **筛选区 8 项**：源ID（textarea，换行分隔 → `ids`）/ 名称 / 配置 + 「展开」后的
//     URL / 输出(表ID) / 状态 / 数据 / 数据时间，含「展开 · 收起」；
//   · **表格列对齐旧 `allColumns.SOURCE.SIMPLE` 八列**：源ID / 名称 / URL / 配置ID / 流程ID / 数据 / 表ID / 域。
// 接口：`sourceApi.sourcePaged`（旧 `sourcePaged`）。
//
// 有意偏差（都在字段/交互层面，不改调用方的接线口 —— 仍是 `emit('selected', rows)`）：
//   1. 弹窗宽度：旧版 `document.body.clientWidth - 100`，这里 `1500px` + `max-width: calc(100vw - 48px)`
//      （与 `Monitor/sourceCheck/SourceListDialog.vue` 同口径）。
//   2. 分类树复用 `views/Monitor/sourceCheck/SourceCategoryTree.vue`：它就是旧 CategoryTree 的
//      1:1 迁移件，且 `indicatorsList/index.vue` 用的也是同一个（Monitor 文件夹按迁移约束可引用）。
//      这里不重复实现一棵带分类增删改的树。
//   3. 「配置ID」「表ID」两列旧版**可点**（下划线 → 打开配置详情 / 表详情弹窗）。MetricCenter 里
//      这两个弹窗没有迁（`handleShowEntryType`、`handleShowConfig` 在 indicatorsResult/index.vue
//      文件头列为不迁项），所以这两列退化为纯文本。
//   4. 「确定」在没勾选时置灰。旧 `SourceListShow.handleSubmit` 没有守卫，空选会让上层
//      `rows[0].sourceId` 抛 TypeError；这里加守卫 + 一条 warning。
//   5. 「重置」照抄旧版语义：**只清条件（含树勾选）不触发查询**，要用户自己再点「查询」——
//      旧版就是 `@click="() => queryParam = {}"`。差别只在两处：① 旧版替换对象会把 `enable`
//      一起清空（= 不限），那是 `default-value` 只在首次生效的副作用，这里恢复成初始的「在用」；
//      ② 旧版只清 `queryParam.categorys` 而**不动树上的勾选**（界面与条件不一致），这里连树一起清。
//   6. 未沿用旧版 `created` 里那句 `if ($route.query.sourceId) queryParam.sourceId = …`：
//      那会让「更多源」弹窗被当前页面的源 ID 过滤掉（列表里永远只剩同一个源），
//      对一个「换一个源」的选择器来说是反向的。请求里也就不再带 `sourceId`。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CaretBottom, CaretTop } from '@element-plus/icons-vue'
import { sourceApi, type Source } from '@/api'
import SourceCategoryTree from '@/views/Monitor/sourceCheck/SourceCategoryTree.vue'

defineOptions({ name: 'MoreSourcesDialog' })

const emit = defineEmits<{ (e: 'selected', rows: Source[]): void }>()

const visible = ref(false)
const loading = ref(false)
const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const advanced = ref(false)
const selected = ref<Source[]>([])
const tableRef = ref()
const categoryTreeRef = ref<InstanceType<typeof SourceCategoryTree> | null>(null)

/** 状态下拉的 UI 哨兵：el-select 里 `hasModelValue = !isEmptyValue(modelValue)`，空串会被判成
 *  「没选」、选中「全部」后输入框里看不到「全部」二字。到 `load()` 里由 `toApiEnable()` 还原成
 *  ''（旧口径：不带 enable 条件）。 */
const ENABLE_ALL = '-1'
const toApiEnable = (value: string): string => (value === ENABLE_ALL ? '' : value)

/**
 * 旧 SourceList2 的 `queryParam`：输入框直接 v-model 绑在它上面，点「查询」/ 回车时拿它发请求
 * （STable 的老用法 —— 边输边改条件，不点查询不发请求）。
 */
const query = reactive({
  /** 旧 `idsStr`：textarea，按换行分隔，请求前拆开再 `join(',')` 成 `ids` */
  idsStr: '',
  name: '',
  configId: '',
  /* ---- 以下 5 项在旧版是「展开」后才出现的 ---- */
  sourceUrl: '',
  entryTypeId: '',
  /** 旧默认「在用」（`queryParam.enable` 初值 '0'） */
  enable: '0',
  count: '',
  dataDate: '',
  /* ---- 分类树勾选 ---- */
  categorys: '',
})

async function load() {
  loading.value = true
  try {
    // 旧 `if (this.queryParam.idsStr) { ids = idsStr.split('\n').join(',') }`；
    // 旧版没 trim、也不丢空行，这里顺手清掉（'\r' 是 Windows 换行残留）
    const ids = query.idsStr.split('\n').map((id) => id.trim()).filter(Boolean).join(',')
    const res = await sourceApi.sourcePaged({
      page: page.value,
      size: size.value,
      ids: ids || undefined,
      name: query.name.trim() || undefined,
      configId: query.configId.trim() || undefined,
      sourceUrl: query.sourceUrl.trim() || undefined,
      entryTypeId: query.entryTypeId.trim() || undefined,
      enable: toApiEnable(query.enable),
      count: query.count.trim() || undefined,
      dataDate: query.dataDate || undefined,
      categorys: query.categorys || undefined,
    })
    rows.value = res.list ?? []
    total.value = Number(res.total ?? 0)
  } catch (err) {
    ElMessage.error(`加载源列表失败: ${err instanceof Error ? err.message : String(err)}`)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 旧 `handleRefresh()`：回车 / 点「查询」都走这里。新平台惯例回第 1 页（旧 STable 会保持当前页） */
function runQuery() {
  page.value = 1
  void load()
}

function onReset() {
  query.idsStr = ''
  query.name = ''
  query.configId = ''
  query.sourceUrl = ''
  query.entryTypeId = ''
  query.enable = '0'
  query.count = ''
  query.dataDate = ''
  query.categorys = ''
  page.value = 1
  selected.value = []
  tableRef.value?.clearSelection?.()
  categoryTreeRef.value?.clearSelection()
  // 旧版重置只清条件、不重查（见文件头偏差第 5 条）
}

/** 旧 `treeClick` / `treeCheck`：把树的筛选并进 queryParam 后重查 */
function onTreeFilter(ids: string[]) {
  query.categorys = ids.join(',')
  page.value = 1
  void load()
}

function onSelectionChange(val: Source[]) {
  selected.value = val
}

function open() {
  query.idsStr = ''
  query.name = ''
  query.configId = ''
  query.sourceUrl = ''
  query.entryTypeId = ''
  query.enable = '0'
  query.count = ''
  query.dataDate = ''
  query.categorys = ''
  advanced.value = false
  page.value = 1
  selected.value = []
  visible.value = true
  void load()
}

function onSubmit() {
  if (!selected.value.length) {
    ElMessage.warning('请选择一条源')
    return
  }
  emit('selected', [...selected.value])
  visible.value = false
}

function formatCount(value?: number) {
  return value == null ? '—' : value
}

// 每次打开都重新加载（旧 `a-modal :destroyOnClose` + 重新 mount 的等价物）——open() 里做
defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    class="msd-dialog"
    title="源列表选择"
    width="1500px"
    append-to-body
    destroy-on-close
  >
    <div class="msd-layout">
      <!-- 分类树：点 = 单选下钻、勾选 = 多选，emit 分类 id 列表（旧 CategoryTree） -->
      <aside class="msd-categories">
        <SourceCategoryTree ref="categoryTreeRef" @filter="onTreeFilter" />
      </aside>

      <main class="msd-main">
        <el-form :inline="true" class="msd-filters">
          <el-row :gutter="8">
            <el-col :md="6" :sm="24">
              <el-form-item label="源ID">
                <el-input
                  v-model="query.idsStr"
                  type="textarea"
                  :rows="1"
                  resize="none"
                  class="msd-ids-input"
                  placeholder="可多个，换行分隔"
                  @keyup.enter="runQuery"
                />
              </el-form-item>
            </el-col>
            <el-col :md="6" :sm="24">
              <el-form-item label="名称">
                <el-input v-model="query.name" clearable placeholder="源名称" @keyup.enter="runQuery" />
              </el-form-item>
            </el-col>
            <el-col :md="6" :sm="24">
              <el-form-item label="配置">
                <el-input v-model="query.configId" clearable placeholder="配置ID" @keyup.enter="runQuery" />
              </el-form-item>
            </el-col>
            <template v-if="advanced">
              <el-col :md="6" :sm="24">
                <el-form-item label="URL">
                  <el-input v-model="query.sourceUrl" clearable placeholder="URL片断" @keyup.enter="runQuery" />
                </el-form-item>
              </el-col>
              <el-col :md="6" :sm="24">
                <el-form-item label="输出">
                  <el-input v-model="query.entryTypeId" clearable placeholder="表ID" @keyup.enter="runQuery" />
                </el-form-item>
              </el-col>
              <el-col :md="6" :sm="24">
                <el-form-item label="状态" style="width: 83%">
                  <el-select v-model="query.enable" placeholder="请选择" class="msd-enable-select" @change="runQuery">
                    <el-option label="在用" value="0" />
                    <el-option label="停用" value="1" />
                    <el-option label="全部" :value="ENABLE_ALL" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :md="6" :sm="24">
                <el-form-item label="数据">
                  <el-input v-model="query.count" clearable placeholder="数据量" @keyup.enter="runQuery" />
                </el-form-item>
              </el-col>
              <el-col :md="6" :sm="24">
                <el-form-item label="数据时间">
                  <el-date-picker
                    v-model="query.dataDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    class="msd-date"
                  />
                </el-form-item>
              </el-col>
            </template>
            <el-col :md="advanced ? 24 : 6" :sm="24">
              <div class="msd-actions">
                <el-button type="primary" @click="runQuery">查询</el-button>
                <el-button @click="onReset">重置</el-button>
                <el-button link type="primary" @click="advanced = !advanced">
                  {{ advanced ? '收起' : '展开' }}
                  <el-icon class="msd-caret">
                    <CaretTop v-if="advanced" />
                    <CaretBottom v-else />
                  </el-icon>
                </el-button>
              </div>
            </el-col>
          </el-row>
        </el-form>

        <div class="msd-table-wrap">
          <el-table
            ref="tableRef"
            v-loading="loading"
            :data="rows"
            border
            size="small"
            row-key="sourceId"
            height="100%"
            @selection-change="onSelectionChange"
          >
            <el-table-column type="selection" width="42" />
            <!-- 旧 SOURCE.SIMPLE：源ID(150) / 名称 / URL / 配置ID / 流程ID / 数据 / 表ID / 域 -->
            <el-table-column prop="sourceId" label="源ID" width="150" />
            <el-table-column prop="name" label="名称" min-width="160" sortable show-overflow-tooltip />
            <el-table-column label="URL" min-width="230">
              <!-- 旧 urlSlot：`<a :href="text" target="_blank" :title="text">` + 限宽省略号 -->
              <template #default="{ row }">
                <a
                  v-if="row.url"
                  class="msd-ellipsis msd-url"
                  :href="row.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="row.url"
                >
                  {{ row.url }}
                </a>
                <span v-else class="msd-ellipsis">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="configId" label="配置ID" width="90" sortable />
            <el-table-column prop="flowId" label="流程ID" width="90" sortable />
            <el-table-column label="数据" width="80" sortable>
              <template #default="{ row }">{{ formatCount(row.dataCount) }}</template>
            </el-table-column>
            <el-table-column prop="mainTable" label="表ID" width="90" sortable />
            <el-table-column prop="domain" label="域" min-width="100" />
          </el-table>
        </div>

        <div class="msd-pager">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="[20, 40, 100, 200]"
            layout="total, sizes, prev, pager, next, jumper"
            background
            small
            @current-change="() => void load()"
            @size-change="() => { page = 1; void load() }"
          />
        </div>
      </main>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!selected.length" @click="onSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.msd-dialog :deep(.el-dialog) {
  max-width: calc(100vw - 48px);
  margin: 4vh auto;
}
.msd-dialog :deep(.el-dialog__body) {
  max-height: calc(100vh - 170px);
  overflow: hidden;
}
.msd-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  height: min(560px, calc(100vh - 210px));
}
.msd-categories {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-right: 12px;
  border-right: 1px solid var(--rc-border-soft, #e2e8f0);
}
.msd-enable-select {
  width: 180px;
}
.msd-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.msd-filters {
  flex: none;
  margin-bottom: 0;
}
.msd-filters :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
}
.msd-filters :deep(.el-form-item__label) {
  font-size: 13px;
}
/* 旧版筛选控件一行 3~4 个、等宽；这里让输入/下拉吃满所在 el-col */
.msd-filters :deep(.el-input),
.msd-filters :deep(.el-select),
.msd-filters :deep(.el-date-editor) {
  width: 100%;
}
/* 源ID 是单行 textarea，压到输入框同高 */
.msd-filters :deep(.msd-ids-input .el-textarea__inner) {
  min-height: 32px !important;
  padding: 6px 11px;
}
.msd-actions {
  display: flex;
  align-items: center;
  padding-bottom: 8px;
}
.msd-caret {
  margin-left: 2px;
  font-size: 12px;
}
.msd-table-wrap {
  flex: 1;
  min-height: 0;
  margin-top: 4px;
}
.msd-ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msd-url {
  color: var(--rc-primary-ink, #1d4ed8);
  text-decoration: none;
}
.msd-url:hover {
  text-decoration: underline;
}
.msd-pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
  flex: none;
}
@media (max-width: 900px) {
  .msd-dialog :deep(.el-dialog__body) {
    overflow: auto;
  }
  .msd-layout {
    grid-template-columns: 1fr;
    height: auto;
  }
  .msd-categories {
    max-height: 180px;
    padding-right: 0;
    padding-bottom: 8px;
    border-right: 0;
    border-bottom: 1px solid var(--rc-border-soft, #e2e8f0);
  }
  .msd-main {
    overflow: visible;
  }
  .msd-table-wrap {
    flex: none;
  }
  .msd-table-wrap :deep(.el-table) {
    height: auto;
  }
}
</style>
