<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, CopyDocument, Delete, Download, Key, Odometer, RefreshRight, SwitchButton } from '@element-plus/icons-vue'
import { entryApi, type EntryType } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { getEffectiveWidth } from '../../constants/entry'
import { exportFieldsAsCsv } from '@/utils/format/csvExport'
import EntryEditorDrawer from './EntryEditorDrawer.vue'
import { withoutComposition } from '@/utils/enterKey'
import { copyToClipboard } from '@/utils/clipboard'

// 迁移方案 §1.6/§5-2：read 角色隐藏全部写入口（含旧只读页遗留的「新建」按钮，判为旧遗漏，不迁）。
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

const route = useRoute()

const list = ref<EntryType[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
// §1.3-1：ID/名称两个独立框；enable 初始 '0'，重置后不带，不新增状态筛选下拉。
const entryTypeIdFilter = ref('')
const nameFilter = ref('')
const enableFilter = ref<string | undefined>('0')
const selected = ref<string[]>([])
const drawer = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })
const editor = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })
const extractDialog = reactive<{ visible: boolean; text: string; count: number }>({ visible: false, text: '', count: 0 })

async function load() {
  loading.value = true
  try {
    const r = await entryApi.entryPaged({
      entryTypeId: entryTypeIdFilter.value.trim() || undefined,
      name: nameFilter.value.trim() || undefined,
      enable: enableFilter.value,
      page: page.value,
      size: size.value,
    })
    list.value = r.list
    total.value = r.total
  } catch (error) {
    ElMessage.error(`加载实体表失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    loading.value = false
  }
}
function onSearch() { page.value = 1; void load() }
// §1.3-1：重置把查询条件清成 {}，之后查询不再携带 enable。
function onReset() {
  entryTypeIdFilter.value = ''
  nameFilter.value = ''
  enableFilter.value = undefined
  page.value = 1
  void load()
}
function onSize() { page.value = 1; void load() }

// §1.3-7：深链接 ?entryTypeId= 进入自动带入检索，并 watch 路由参数变化即时刷新。
watch(() => route.query.entryTypeId, (id) => {
  const value = typeof id === 'string' ? id : ''
  if (value) {
    entryTypeIdFilter.value = value
    page.value = 1
    void load()
  }
}, { immediate: true })

onMounted(() => { if (!route.query.entryTypeId) void load() })

// 显示后端返回的更新时间。统一走字符串截断（`yyyy-MM-dd HH:mm`）——
// 旧 `new Date(value.replace(/-/g, '/'))` 解析无时区后缀的字符串会跨时区漂移，
// 字符串截断避免此坑，且与 ParamTab / ConfigTab 口径一致。
// 详见 REVIEW-2026-07-24.md #3。
function formatDateTime(value?: string) {
  if (!value) return '—'
  return value.slice(0, 16)
}

async function openDetail(e: EntryType) {
  try {
    drawer.entry = await entryApi.entryDetail(e.tableId)
    drawer.visible = true
  } catch (error) {
    ElMessage.error(`加载实体表详情失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
async function openEdit(e: EntryType) {
  try {
    editor.entry = await entryApi.entryDetail(e.tableId)
    editor.visible = true
  } catch (error) {
    ElMessage.error(`加载实体表详情失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
function openCreate() {
  editor.entry = null
  editor.visible = true
}
async function onEntrySaved() {
  await load()
}

async function confirmDanger(
  title: string,
  body: string,
  run: () => Promise<{ message?: string }>,
  opts: { successFallback?: string } = {},
) {
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    const r = await run()
    ElMessage.success(r?.message || opts.successFallback || '操作成功')
    await load()
  } catch (error) {
    ElMessage.error(`操作失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// §1.3-8：复制新表
async function onCopy(e: EntryType) {
  let tableName = ''
  try {
    const result = await ElMessageBox.prompt('请输入新的表名:', '复制新表', {
      inputValue: 'tb_',
      inputPlaceholder: '一般以tb_entry_开头',
      inputValidator: (value) => {
        const v = value?.trim()
        return (!!v && v !== 'tb_') || '请输入新的表名'
      },
    })
    tableName = result.value.trim()
  } catch {
    return
  }
  try {
    const ack = await entryApi.copyEntry(e.tableId, tableName)
    ElMessage.success(`复制成功:${ack?.message ?? ''}`)
    await load()
  } catch (error) {
    ElMessage.error(`复制失败,返回值:${error instanceof Error ? error.message : String(error)}`)
  }
}

// §1.3-8：物理表同步
async function onCheckTable(e: EntryType) {
  let sql: string[]
  try {
    sql = await entryApi.checkTable(e.tableId)
  } catch (error) {
    ElMessage.error(`检查表结构失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!Array.isArray(sql) || !sql.length) {
    ElMessage.success('表配置配置的字段与物理表一致')
    return
  }
  try {
    await ElMessageBox.confirm(
      `${sql.join('\n')}\n\n物理表结构与配置中的结构不一致，点击确定执行更新`,
      '结构差异',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await entryApi.syncTable(e.tableId)
    ElMessage.success('物理表结构已更新')
    await load()
  } catch (error) {
    ElMessage.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function onCalc(e: EntryType) {
  confirmDanger(
    '是否要强制计算数据表对应的源数据量',
    `如有手动删除表数据等操作，本次计算将强制修正源上数据量不一致的问题: ${e.tableId}`,
    () => entryApi.calcEntrySum(e.tableId),
  )
}
function onRebuildIndex(e: EntryType) {
  confirmDanger(
    '重建去重索引(谨慎使用!!）',
    `如变更去重字段后，本次将重新计算历史数据的去重索引: ${e.tableId}`,
    () => entryApi.rebuildIndex(e.tableId),
  )
}
function onState(e: EntryType) {
  const toAc = e.state !== 'AC'
  confirmDanger(
    toAc ? '正式态确认' : '改为测试态',
    toAc ? '【无法删数据】设置为正式态' : '【注意:可从页面中删除】,改为测试态',
    () => entryApi.markEntryType(e.tableId, toAc ? 'AC' : 'C'),
    { successFallback: '设置成功' },
  )
}
async function onExtractFields(e: EntryType) {
  try {
    const detail = await entryApi.entryDetail(e.tableId)
    extractDialog.count = detail.fields.length
    extractDialog.text = detail.fields
      .map((f) => `${f.prop}:${f.desc}:${getEffectiveWidth(f.width)}`)
      .join('\n')
    extractDialog.visible = true
  } catch (error) {
    ElMessage.error(`加载字段失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
// 同 SiteSourceSwitcher：原先自造的 navigator.clipboard 在 http 部署站上必然失败
// （非安全上下文不暴露这个 API），且没有 execCommand 兜底。统一走 utils/clipboard。
function copyExtractText() {
  void copyToClipboard(extractDialog.text)
}

function toggleSelected(tableId: string, checked: boolean) {
  selected.value = checked
    ? Array.from(new Set([...selected.value, tableId]))
    : selected.value.filter((id) => id !== tableId)
}
const allChecked = computed(() => !!list.value.length && list.value.every((e) => selected.value.includes(e.tableId)))
const pageIndeterminate = computed(() => !allChecked.value && list.value.some((e) => selected.value.includes(e.tableId)))
function togglePage(checked: boolean) {
  const pageIds = list.value.map((e) => e.tableId)
  selected.value = checked
    ? Array.from(new Set([...selected.value, ...pageIds]))
    : selected.value.filter((id) => !pageIds.includes(id))
}

// §1.3-8：批量重建
async function onBatchRebuild() {
  if (!selected.value.length) return
  const ids = selected.value.join(',')
  try {
    await ElMessageBox.confirm(
      `是否确定检查并重建物理表，数量:${selected.value.length}?, ids:${ids}`,
      '检查表结构提示',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const result = await entryApi.rebuildTable(selected.value)
    ElMessage.success(`处理成功:${result?.message ?? ''}`)
    selected.value = []
    await load()
  } catch (error) {
    ElMessage.error(`处理失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
// §1.3-8：批量删除
async function onBatchDelete() {
  if (!selected.value.length) return
  const ids = selected.value.join(',')
  try {
    await ElMessageBox.confirm(
      `是否确认要删除数据表，数量:${selected.value.length}?, ids:${ids}`,
      '提示',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await entryApi.deleteEntries(selected.value)
    ElMessage.success(`删除成功，本次删除:${ids}`)
    selected.value = []
    await load()
  } catch (error) {
    ElMessage.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// §1.5：导出字段 CSV（首轮以同列结构导出 CSV，不引入 xlsx 依赖）
function exportFields(e: EntryType) {
  exportFieldsAsCsv(e)
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterSearch = withoutComposition(() => onSearch())
</script>

<template>
  <div class="rc-card et-main">
    <div class="rc-toolbar wrap">
      <el-input v-model="entryTypeIdFilter" clearable placeholder="表 ID" style="width: 150px" @keyup.enter="onEnterSearch" />
      <el-input v-model="nameFilter" clearable placeholder="表名称" style="width: 190px" @keyup.enter="onEnterSearch" />
      <button class="rc-btn" type="button" @click="onSearch">查询</button>
      <button class="rc-btn" type="button" @click="onReset">重置</button>
      <span class="et-spacer" />
      <span class="muted">共 {{ total }} 张实体表</span>
      <template v-if="canWrite">
        <el-dropdown v-if="selected.length" trigger="click">
          <button class="rc-btn" type="button">更多<el-icon class="et-caret"><ArrowDown /></el-icon></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :icon="RefreshRight" @click="onBatchRebuild">检查并重建物理表<span style="margin-left: 4px; color: var(--rc-muted); font-size: 12px">（表不存在时自动新建）</span></el-dropdown-item>
              <el-dropdown-item :icon="Delete" divided style="color: #dc2626" @click="onBatchDelete">批量删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="rc-btn primary" type="button" @click="openCreate">新建</button>
      </template>
    </div>

    <div v-loading="loading" class="rc-table-scroll et-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th v-if="canWrite" style="width: 42px">
              <el-checkbox :model-value="allChecked" :indeterminate="pageIndeterminate" aria-label="选择本页" @change="togglePage" />
            </th>
            <th style="width: 90px">表ID</th>
            <th>表名称</th>
            <th>物理表名</th>
            <th style="width: 120px">去重字段</th>
            <th style="width: 70px">状态</th>
            <th>备注</th>
            <th style="width: 110px">更新时间</th>
            <th style="width: 170px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in list" :key="e.tableId">
            <td v-if="canWrite">
              <el-checkbox :model-value="selected.includes(e.tableId)" :aria-label="`选择表 ${e.tableId}`" @change="toggleSelected(e.tableId, $event)" />
            </td>
            <td>{{ e.tableId }}</td>
            <td>{{ e.name || '—' }}</td>
            <td>{{ e.tableName }}</td>
            <td>{{ e.keyField || '—' }}</td>
            <td>{{ e.state || '—' }}</td>
            <td>{{ e.remark || '—' }}</td>
            <td :title="e.updatedAt || ''">{{ formatDateTime(e.updatedAt) }}</td>
            <td>
              <el-button link type="primary" size="small" @click="openDetail(e)">详情</el-button>
              <template v-if="canWrite">
                <el-button link type="primary" size="small" @click="openEdit(e)">编辑</el-button>
                <el-dropdown trigger="click">
                  <el-button link type="primary" size="small">更多<el-icon class="et-caret"><ArrowDown /></el-icon></el-button>
                  <template #dropdown><el-dropdown-menu>
                    <el-dropdown-item :icon="CopyDocument" @click="onCopy(e)">复制新表</el-dropdown-item>
                    <el-dropdown-item :icon="Download" @click="onExtractFields(e)">提取表字段</el-dropdown-item>
                    <el-dropdown-item :icon="RefreshRight" divided @click="onCheckTable(e)">同步物理表结构</el-dropdown-item>
                    <el-dropdown-item :icon="Odometer" @click="onCalc(e)">重新计算数据量</el-dropdown-item>
                    <el-dropdown-item :icon="Key" @click="onRebuildIndex(e)">重建去重索引</el-dropdown-item>
                    <el-dropdown-item v-if="e.state === 'C'" :icon="SwitchButton" divided style="color: #dc2626" @click="onState(e)">置为正式表</el-dropdown-item>
                    <el-dropdown-item v-else-if="e.state === 'AC'" :icon="SwitchButton" divided @click="onState(e)">设为测试表</el-dropdown-item>
                  </el-dropdown-menu></template>
                </el-dropdown>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !list.length" class="et-empty muted">没有匹配的实体表</div>
    </div>

    <div class="et-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 30, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="load"
        @size-change="onSize"
      />
    </div>

  <el-drawer v-model="drawer.visible" :with-header="false" size="560px" append-to-body>
    <div v-if="drawer.entry" class="et-d">
      <div class="et-d-title">{{ drawer.entry.name || drawer.entry.tableName }}</div>
      <div class="et-d-sub muted">表 ID {{ drawer.entry.tableId }} · {{ (drawer.entry.rowCount ?? 0).toLocaleString() }} 行</div>
      <dl class="rc-kv">
        <dt>表ID</dt><dd>{{ drawer.entry.tableId }}</dd>
        <dt>表名称</dt><dd>{{ drawer.entry.name || '—' }}</dd>
        <dt>物理表名</dt><dd>{{ drawer.entry.tableName }}</dd>
        <dt>去重字段</dt><dd>{{ drawer.entry.keyField || '—' }}</dd>
        <dt>去重方式</dt><dd>{{ drawer.entry.dedupMode === 'table' ? '表内去重' : '源内去重' }}</dd>
        <dt>状态</dt><dd>{{ drawer.entry.state || '—' }}</dd>
        <dt>备注</dt><dd>{{ drawer.entry.remark || '—' }}</dd>
        <dt>更新时间</dt><dd :title="drawer.entry.updatedAt || ''">{{ formatDateTime(drawer.entry.updatedAt) }}</dd>
        <dt>记录变更</dt><dd>{{ drawer.entry.recFlag ?? '—' }}</dd>
        <dt>校验标识</dt><dd>{{ drawer.entry.checkFlag ?? '—' }}</dd>
        <dt>校验规则</dt><dd>{{ drawer.entry.checkRule || '—' }}</dd>
        <dt>核心参数</dt><dd>{{ drawer.entry.coreParam || '—' }}</dd>
      </dl>
      <div class="et-section">
        字段
        <button class="rc-btn" type="button" style="float: right" @click="exportFields(drawer.entry)">导出字段</button>
      </div>
      <table class="rc-data-table">
        <thead>
          <tr>
            <th style="width: 40px">排序</th><th style="width: 60px">ID</th><th>编码</th><th>展示名</th>
            <th>数据库列</th><th style="width: 78px">类型</th><th>校验</th><th style="width: 56px">列宽</th><th>预处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in drawer.entry.fields" :key="f.itemId || f.prop">
            <td>{{ f.seq ?? '—' }}</td>
            <td>{{ f.itemId ?? '—' }}</td>
            <td>{{ f.prop }}</td>
            <td>{{ f.desc }}</td>
            <td>{{ f.columnName || '—' }}</td>
            <td>{{ f.type }}</td>
            <td>{{ f.checkRule || '—' }}</td>
            <td>{{ f.width || '—' }}</td>
            <td>{{ f.preprocess || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="canWrite" class="et-foot">
        <button class="rc-btn primary" type="button" @click="openEdit(drawer.entry)">编辑</button>
        <button class="rc-btn" type="button" @click="onRebuildIndex(drawer.entry)">重建去重索引</button>
      </div>
    </div>
  </el-drawer>

  <el-dialog v-model="extractDialog.visible" title="提取表字段" width="600px" append-to-body>
    <div class="et-extract-head">
      <span class="muted">格式：<code>字段编码:展示名:列宽</code> · 共 <b class="et-extract-count">{{ extractDialog.count }}</b> 个字段</span>
      <button class="rc-btn sm" type="button" @click="copyExtractText"><el-icon><CopyDocument /></el-icon>复制</button>
    </div>
    <textarea class="et-extract-textarea" :value="extractDialog.text" rows="14" readonly />
  </el-dialog>

  <EntryEditorDrawer v-model="editor.visible" :entry="editor.entry" @saved="onEntrySaved" />
  </div>
</template>

<style scoped>
.et-main { display: flex; flex-direction: column; height: calc(100vh - 215px); min-height: 520px; }
.et-spacer { flex: 1; }
.et-table { flex: 1; }
.et-empty { padding: 48px; text-align: center; }
.et-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.et-d { display: flex; flex-direction: column; gap: 4px; }
.et-d-title { font-size: 15px; font-weight: 700; color: var(--rc-text); }
.et-d-sub { font-size: 12px; margin-bottom: 10px; }
.et-section { margin: 14px 0 8px; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.et-foot { display: flex; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
.et-caret { margin-left: 4px; font-size: 12px; }
.et-extract-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.et-extract-head code { background: var(--rc-bg, #f8fafc); border: 1px solid var(--rc-border-soft); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
.et-extract-count { color: var(--rc-warn, #d97706); }
.et-extract-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid #dbe3ee;
  border-radius: 7px;
  background: var(--rc-bg, #f8fafc);
  color: var(--rc-text);
  font-family: "SF Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  padding: 10px 12px;
  outline: none;
}
.et-extract-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
