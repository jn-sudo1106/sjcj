<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { entryApi, type EntryType } from '../../api'

const list = ref<EntryType[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const keyword = ref('')
const drawer = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })

async function load() {
  loading.value = true
  try {
    const r = await entryApi.entryPaged({ keyword: keyword.value, page: page.value, size: size.value })
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
</script>

<template>
  <div class="rc-card et-main">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索表 ID / 表名" style="width: 260px" />
      <span class="et-spacer" />
      <span class="muted">共 {{ total }} 张实体表</span>
      <button class="rc-btn primary" type="button" @click="ElMessage.info('新建实体：演示环境占位')">新建实体</button>
    </div>

    <div v-loading="loading" class="rc-table-scroll et-table">
      <table class="rc-data-table">
        <thead>
          <tr>
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
            <td>{{ e.tableId }}</td>
            <td><button class="et-name" type="button" @click="openDetail(e)">{{ e.tableName }}</button></td>
            <td>{{ (e.rowCount ?? 0).toLocaleString() }}</td>
            <td>{{ e.fields.length }}</td>
            <td>{{ e.owner || '—' }}</td>
            <td>{{ e.updatedAt || '—' }}</td>
            <td>
              <el-button link type="primary" size="small" @click="openDetail(e)">实体编辑器</el-button>
              <el-button link type="primary" size="small" @click="onRebuildIndex(e)">重建索引</el-button>
              <el-button link type="danger" size="small" @click="onRebuildTable(e)">重建表</el-button>
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
        <button class="rc-btn" type="button" @click="onRebuildIndex(drawer.entry)">重建索引</button>
        <button class="rc-btn danger" type="button" @click="onRebuildTable(drawer.entry)">重建表</button>
      </div>
    </div>
  </el-drawer>
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
