<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { entryApi, type EntryType } from '../../api'
import EntryEditorDrawer from './EntryEditorDrawer.vue'

const list = ref<EntryType[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const keyword = ref('')
const selected = ref<string[]>([])
const drawer = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })
const editor = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })

async function load() {
  loading.value = true
  try {
    // 旧 EntryTypeList 检索是 entryTypeId/name 两个独立框；这里暂沿用单框数字猜测过渡，
    // 完整双框检索改造见表ID列表迁移方案 T2。
    const kw = keyword.value.trim()
    const r = await entryApi.entryPaged({
      entryTypeId: /^\d+$/.test(kw) ? kw : undefined,
      name: kw && !/^\d+$/.test(kw) ? kw : undefined,
      page: page.value,
      size: size.value,
    })
    list.value = r.list
    total.value = r.total
  } finally {
    loading.value = false
  }
}
let kw: ReturnType<typeof setTimeout> | undefined
watch(keyword, () => {
  clearTimeout(kw)
  kw = setTimeout(() => { page.value = 1; load() }, 300)
})
function onSize() { page.value = 1; load() }
onMounted(load)

function openDetail(e: EntryType) {
  drawer.entry = e
  drawer.visible = true
}
async function openEdit(e: EntryType) {
  editor.entry = await entryApi.entryDetail(e.tableId)
  editor.visible = true
}
function openCreate() {
  editor.entry = null
  editor.visible = true
}
async function confirmDanger(title: string, body: string, run: () => Promise<{ message?: string }>) {
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  const r = await run()
  ElMessage.success(r?.message || '操作已提交（演示）')
}
function onRebuildTable(e: EntryType) {
  confirmDanger('重建表（高危）', `重建「${e.tableName}」物理表？`, () => entryApi.rebuildTable(e.tableId))
}
function onRebuildIndex(e: EntryType) {
  confirmDanger('重建索引', `重建「${e.tableName}」索引？`, () => entryApi.rebuildIndex(e.tableId))
}
function toggleSelected(tableId: string, checked: boolean) {
  selected.value = checked
    ? Array.from(new Set([...selected.value, tableId]))
    : selected.value.filter((id) => id !== tableId)
}
function togglePage(checked: boolean) {
  const pageIds = list.value.map((entry) => entry.tableId)
  selected.value = checked
    ? Array.from(new Set([...selected.value, ...pageIds]))
    : selected.value.filter((id) => !pageIds.includes(id))
}
async function runBatch(action: 'clear' | 'rebuild' | 'delete') {
  if (!selected.value.length) {
    ElMessage.warning('请先选择实体表')
    return
  }
  const titles = { clear: '清除缓存', rebuild: '检查并重建物理表', delete: '删除实体表' }
  try {
    await ElMessageBox.confirm(`${titles[action]}，共 ${selected.value.length} 张表？`, titles[action], { type: 'warning' })
  } catch {
    return
  }
  const result = action === 'clear'
    ? await entryApi.clearCache(selected.value)
    : action === 'rebuild'
      ? await entryApi.rebuildTable(selected.value)
      : await entryApi.deleteEntries(selected.value)
  ElMessage.success(result?.message || '操作成功')
  selected.value = []
  await load()
}
async function onCopy(e: EntryType) {
  try {
    const result = await ElMessageBox.prompt('请输入新的物理表名', `复制“${e.name || e.tableName}”`, {
      inputValue: 'tb_',
      inputValidator: (value) => value.trim() !== 'tb_' && !!value.trim() || '请输入有效表名',
    })
    const ack = await entryApi.copyEntry(e.tableId, result.value.trim())
    ElMessage.success(ack?.message || '复制成功')
    await load()
  } catch {
    return
  }
}
async function onCheckTable(e: EntryType) {
  const sql = await entryApi.checkTable(e.tableId)
  if (!Array.isArray(sql) || !sql.length) {
    ElMessage.success('表配置字段与物理表一致')
    return
  }
  try {
    await ElMessageBox.confirm(sql.join('\n'), '发现物理表结构差异，是否同步？', { type: 'warning' })
  } catch {
    return
  }
  const result = await entryApi.syncTable(e.tableId)
  ElMessage.success(result?.message || '物理表结构已同步')
}
function onCalc(e: EntryType) {
  confirmDanger('计算数据量', `强制重新计算“${e.name || e.tableName}”的数据量？`, () => entryApi.calcEntrySum(e.tableId))
}
function onState(e: EntryType) {
  const next = e.state === 'AC' ? 'C' : 'AC'
  confirmDanger(next === 'AC' ? '设为正式表' : '设为测试表', `切换后状态为 ${next}，是否继续？`, () => entryApi.markEntryType(e.tableId, next))
}
</script>

<template>
  <div class="rc-card et-main">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索表 ID / 表名" style="width: 260px" />
      <span class="et-spacer" />
      <span class="muted">共 {{ total }} 张实体表</span>
      <button class="rc-btn" type="button" :disabled="!selected.length" @click="runBatch('clear')">清除缓存</button>
      <button class="rc-btn" type="button" :disabled="!selected.length" @click="runBatch('rebuild')">重建物理表</button>
      <button class="rc-btn danger" type="button" :disabled="!selected.length" @click="runBatch('delete')">批量删除</button>
      <button class="rc-btn primary" type="button" @click="openCreate">新建实体</button>
    </div>

    <div v-loading="loading" class="rc-table-scroll et-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th style="width: 42px"><input type="checkbox" :checked="!!list.length && list.every((e) => selected.includes(e.tableId))" aria-label="选择本页" @change="togglePage(($event.target as HTMLInputElement).checked)" /></th>
            <th style="width: 90px">表 ID</th>
            <th>表名</th>
            <th style="width: 90px">行数</th>
            <th style="width: 70px">字段</th>
            <th style="width: 100px">责任人</th>
            <th style="width: 150px">更新时间</th>
            <th style="width: 200px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in list" :key="e.tableId">
            <td><input type="checkbox" :checked="selected.includes(e.tableId)" :aria-label="`选择表 ${e.tableId}`" @change="toggleSelected(e.tableId, ($event.target as HTMLInputElement).checked)" /></td>
            <td>{{ e.tableId }}</td>
            <td><button class="et-name" type="button" @click="openDetail(e)">{{ e.tableName }}</button></td>
            <td>{{ (e.rowCount ?? 0).toLocaleString() }}</td>
            <td>{{ e.fields.length }}</td>
            <td>{{ e.owner || '—' }}</td>
            <td>{{ e.updatedAt || '—' }}</td>
            <td>
              <el-button link type="primary" size="small" @click="openDetail(e)">详情</el-button>
              <el-button link type="primary" size="small" @click="openEdit(e)">编辑</el-button>
              <el-dropdown trigger="click">
                <el-button link type="primary" size="small">更多</el-button>
                <template #dropdown><el-dropdown-menu>
                  <el-dropdown-item @click="onCopy(e)">复制新表</el-dropdown-item>
                  <el-dropdown-item @click="onCheckTable(e)">物理表同步</el-dropdown-item>
                  <el-dropdown-item @click="onCalc(e)">计算数据量</el-dropdown-item>
                  <el-dropdown-item @click="onRebuildIndex(e)">重建去重索引</el-dropdown-item>
                  <el-dropdown-item @click="onState(e)">{{ e.state === 'AC' ? '设为测试表' : '设为正式表' }}</el-dropdown-item>
                  <el-dropdown-item divided @click="onRebuildTable(e)">重建物理表</el-dropdown-item>
                </el-dropdown-menu></template>
              </el-dropdown>
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
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="load"
        @size-change="onSize"
      />
    </div>

  <el-drawer v-model="drawer.visible" :with-header="false" size="560px" append-to-body>
    <div v-if="drawer.entry" class="et-d">
      <div class="et-d-title">实体编辑器</div>
      <div class="et-d-sub muted">{{ drawer.entry.tableName }} · 表 ID {{ drawer.entry.tableId }} · {{ (drawer.entry.rowCount ?? 0).toLocaleString() }} 行</div>
      <dl class="rc-kv">
        <dt>显示名</dt><dd>{{ drawer.entry.name || '—' }}</dd>
        <dt>去重字段</dt><dd>{{ drawer.entry.keyField || '—' }}</dd>
        <dt>状态</dt><dd>{{ drawer.entry.state || '—' }}</dd>
        <dt>备注</dt><dd>{{ drawer.entry.remark || '—' }}</dd>
      </dl>
      <div class="et-section">字段（去重列 / 预处理函数 / 列宽）</div>
      <table class="rc-data-table">
        <thead>
          <tr>
            <th>属性</th><th>中文</th><th style="width: 78px">类型</th><th style="width: 50px">必填</th>
            <th style="width: 50px">去重</th><th style="width: 96px">预处理</th><th style="width: 56px">列宽</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in drawer.entry.fields" :key="f.prop">
            <td>{{ f.prop }}</td>
            <td>{{ f.desc }}</td>
            <td>{{ f.type }}</td>
            <td>{{ f.required ? '是' : '—' }}</td>
            <td>{{ f.dedup ? '✓' : '—' }}</td>
            <td>{{ f.preprocess || '—' }}</td>
            <td>{{ f.width || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="rc-mini-card et-note">字段类型 / 去重列 / 预处理清洗函数 / 列宽均可编辑（mock）；保存与重建表为高危写操作，走二次确认。</div>
      <div class="et-foot">
        <button class="rc-btn primary" type="button" @click="openEdit(drawer.entry)">编辑</button>
        <button class="rc-btn" type="button" @click="onRebuildIndex(drawer.entry)">重建索引</button>
        <button class="rc-btn danger" type="button" @click="onRebuildTable(drawer.entry)">重建表</button>
      </div>
    </div>
  </el-drawer>
  <EntryEditorDrawer v-model="editor.visible" :entry="editor.entry" @saved="load" />
  </div>
</template>

<style scoped>
.et-main { display: flex; flex-direction: column; height: calc(100vh - 215px); min-height: 520px; }
.et-spacer { flex: 1; }
.et-table { flex: 1; }
.et-name { padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.et-name:hover { text-decoration: underline; }
.et-empty { padding: 48px; text-align: center; }
.et-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.et-d { display: flex; flex-direction: column; gap: 4px; }
.et-d-title { font-size: 15px; font-weight: 700; color: var(--rc-text); }
.et-d-sub { font-size: 12px; margin-bottom: 10px; }
.et-section { margin: 8px 0; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.et-note { margin-top: 12px; }
.et-foot { display: flex; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
</style>
