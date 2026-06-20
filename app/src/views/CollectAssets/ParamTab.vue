<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { paramApi, type Param } from '../../api'

const list = ref<Param[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const keyword = ref('')
const kindFilter = ref('all')
const drawer = reactive<{ visible: boolean; param: Param | null; preview: string[]; previewing: boolean }>({
  visible: false,
  param: null,
  preview: [],
  previewing: false,
})

async function load() {
  loading.value = true
  try {
    const r = await paramApi.paramPaged({ keyword: keyword.value, kind: kindFilter.value, page: page.value, size: size.value })
    list.value = r.list
    total.value = r.total
  } finally {
    loading.value = false
  }
}
function resetAndLoad() { page.value = 1; load() }
watch(kindFilter, resetAndLoad)
let kw: ReturnType<typeof setTimeout> | undefined
watch(keyword, () => { clearTimeout(kw); kw = setTimeout(resetAndLoad, 300) })
function onSize() { page.value = 1; load() }
onMounted(load)

function kindMeta(k: string) {
  if (k === 'list') return { cls: 'ok', text: '列表' }
  if (k === 'date') return { cls: 'run', text: '动态日期' }
  return { cls: 'warn', text: '序列' }
}

async function openDetail(p: Param) {
  drawer.param = p
  drawer.preview = []
  drawer.visible = true
}
async function genPreview() {
  if (!drawer.param) return
  drawer.previewing = true
  try {
    drawer.preview = await paramApi.genValues(drawer.param.paramId)
  } finally {
    drawer.previewing = false
  }
}
async function onAddValues() {
  if (!drawer.param) return
  try {
    await ElMessageBox.confirm('新增参数值为写操作，是否继续？', '新增参数值', { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  const r = await paramApi.addParamValues(drawer.param.paramId)
  ElMessage.success(r?.message || '操作已提交（演示）')
}
</script>

<template>
  <div class="rc-card pt-main">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索参数 ID / 名称" style="width: 240px" />
      <el-select v-model="kindFilter" style="width: 130px">
        <el-option label="全部类型" value="all" />
        <el-option label="列表" value="list" />
        <el-option label="动态日期" value="date" />
        <el-option label="序列" value="sequence" />
      </el-select>
      <span class="pt-spacer" />
      <span class="muted">共 {{ total }} 个参数</span>
      <button class="rc-btn primary" type="button" @click="ElMessage.info('新建参数：演示环境占位')">新建参数</button>
    </div>

    <div v-loading="loading" class="rc-table-scroll pt-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th style="width: 120px">参数 ID</th>
            <th>名称</th>
            <th style="width: 96px">类型</th>
            <th>预览</th>
            <th style="width: 70px">引用</th>
            <th style="width: 100px">责任人</th>
            <th style="width: 120px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.paramId">
            <td>{{ p.paramId }}</td>
            <td><button class="pt-name" type="button" @click="openDetail(p)">{{ p.name }}</button></td>
            <td><span class="rc-status" :class="kindMeta(p.kind).cls">{{ kindMeta(p.kind).text }}</span></td>
            <td class="muted pt-prev">
              {{ p.kind === 'list' ? (p.values || []).join('、') : p.kind === 'date' ? p.dateExpr : p.seq ? `${p.seq.start}~${p.seq.end} / ${p.seq.step}` : '—' }}
            </td>
            <td>{{ p.usedBy ?? 0 }}</td>
            <td>{{ p.owner || '—' }}</td>
            <td>
              <el-button link type="primary" size="small" @click="openDetail(p)">详情</el-button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !list.length" class="pt-empty muted">没有匹配的参数</div>
    </div>

    <div class="pt-pager">
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
  </div>

  <el-drawer v-model="drawer.visible" :with-header="false" size="440px">
    <div v-if="drawer.param" class="pt-d">
      <div class="pt-d-title">{{ drawer.param.name }}</div>
      <div class="pt-d-sub muted">
        参数 ID {{ drawer.param.paramId }} ·
        <span class="rc-status" :class="kindMeta(drawer.param.kind).cls">{{ kindMeta(drawer.param.kind).text }}</span>
      </div>

      <dl class="rc-kv">
        <dt>被引用</dt><dd>{{ drawer.param.usedBy ?? 0 }} 个配置</dd>
        <dt>责任人</dt><dd>{{ drawer.param.owner || '—' }}</dd>
        <dt>更新时间</dt><dd>{{ drawer.param.updatedAt || '—' }}</dd>
      </dl>

      <div class="pt-section">定义</div>
      <div v-if="drawer.param.kind === 'list'" class="pt-tags">
        <el-tag v-for="v in drawer.param.values || []" :key="v" size="small" effect="plain">{{ v }}</el-tag>
      </div>
      <div v-else-if="drawer.param.kind === 'date'" class="rc-code-box">{{ drawer.param.dateExpr }}</div>
      <div v-else-if="drawer.param.seq" class="rc-code-box">start={{ drawer.param.seq.start }} end={{ drawer.param.seq.end }} step={{ drawer.param.seq.step }}</div>

      <div class="pt-section">生成值预览</div>
      <button class="rc-btn" type="button" @click="genPreview">{{ drawer.previewing ? '生成中…' : '生成值预览' }}</button>
      <div v-if="drawer.preview.length" class="pt-prev-box">
        <el-tag v-for="(v, i) in drawer.preview" :key="i" size="small" type="info">{{ v }}</el-tag>
      </div>

      <div class="pt-foot">
        <button class="rc-btn danger" type="button" @click="onAddValues">新增参数值</button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.pt-main { display: flex; flex-direction: column; height: calc(100vh - 215px); min-height: 520px; }
.pt-spacer { flex: 1; }
.pt-table { flex: 1; }
.pt-name { padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.pt-name:hover { text-decoration: underline; }
.pt-prev { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-empty { padding: 48px; text-align: center; }
.pt-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.pt-d { display: flex; flex-direction: column; gap: 4px; }
.pt-d-title { font-size: 15px; font-weight: 700; color: var(--rc-text); }
.pt-d-sub { font-size: 12px; margin-bottom: 8px; }
.pt-section { margin: 14px 0 8px; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.pt-tags, .pt-prev-box { display: flex; flex-wrap: wrap; gap: 6px; }
.pt-prev-box { margin-top: 10px; }
.pt-foot { display: flex; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
</style>
