<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { paramApi, type Param, type ParamKind } from '../../api'
import { useAuthStore } from '../../stores/auth'
import ParamEditorDrawer from '@/components/param/ParamEditorDrawer.vue'
import { findParamConfigUsage, type ParamUsageResult } from './paramUsage'

// D3（0717 参数方案）：read 角色隐藏写操作，仅消费既有 auth store 的 role getter，不改动登录相关代码
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

const list = ref<Param[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const paramIdFilter = ref('')
const paramNameFilter = ref('')
const kindFilter = ref<ParamKind | ''>('')
const selected = ref<string[]>([])
const drawer = reactive<{ visible: boolean; param: Param | null; preview: string[]; previewing: boolean }>({
  visible: false,
  param: null,
  preview: [],
  previewing: false,
})
const editor = reactive<{ visible: boolean; param: Param | null }>({ visible: false, param: null })
const usage = reactive<{ visible: boolean; param: Param | null; loading: boolean; result: ParamUsageResult | null; error: string }>({
  visible: false, param: null, loading: false, result: null, error: '',
})
const usageProgress = ref({ checked: 0, total: 0 })
let usageRequest = 0
watch(() => usage.visible, (visible) => { if (!visible) usageRequest++ })

async function openUsage(param: Param) {
  const request = ++usageRequest
  usage.visible = true
  usage.param = param
  usage.result = null
  usage.error = ''
  usage.loading = true
  usageProgress.value = { checked: 0, total: 0 }
  try {
    const result = await findParamConfigUsage(param.paramId, (checked, total) => {
      if (request === usageRequest) usageProgress.value = { checked, total }
    }, () => request === usageRequest)
    if (request === usageRequest) usage.result = result
  } catch (error) {
    if (request === usageRequest) usage.error = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === usageRequest) usage.loading = false
  }
}

async function load() {
  loading.value = true
  try {
    const r = await paramApi.paramPaged({
      paramId: paramIdFilter.value,
      paramName: paramNameFilter.value,
      kind: kindFilter.value || undefined,
      page: page.value,
      size: size.value,
    })
    list.value = r.list
    total.value = r.total
  } catch (error) {
    ElMessage.error(`加载参数失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    loading.value = false
  }
}
function resetAndLoad() { page.value = 1; void load() }
let kw: ReturnType<typeof setTimeout> | undefined
watch([paramIdFilter, paramNameFilter], () => { clearTimeout(kw); kw = setTimeout(resetAndLoad, 300) })
watch(kindFilter, resetAndLoad)
function onSize() { page.value = 1; void load() }
onMounted(() => { void load() })
onUnmounted(() => { if (kw) clearTimeout(kw) })

function kindMeta(k: string) {
  if (k === 'list') return { cls: 'ok', text: '列表' }
  if (k === 'date') return { cls: 'run', text: '日期' }
  if (k === 'sequence') return { cls: 'warn', text: '序列' }
  if (k === 'date_sequence') return { cls: 'run', text: '日期序列' }
  return { cls: 'warn', text: '数据库' }
}

function openCreate() { editor.param = null; editor.visible = true }
async function openEdit(param: Param) {
  try {
    const detail = await paramApi.paramDetail(param.paramId)
    if (!detail) {
      ElMessage.warning('参数不存在或已被删除')
      return
    }
    editor.param = detail
    editor.visible = true
  } catch (error) {
    ElMessage.error(`加载参数详情失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
async function onParamSaved() { await load() }

async function openDetail(p: Param) {
  try {
    drawer.param = await paramApi.paramDetail(p.paramId) ?? p
    drawer.preview = []
    drawer.visible = true
  } catch (error) {
    ElMessage.error(`加载参数详情失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
// 旧平台"参数值"列的"查看值"链接语义=直接调 genValues 看运行时生成值（ParamList.vue showValues），
// 不是查看原始存储的值列表；复用详情抽屉展示，打开后自动触发一次生成。
async function onViewValues(p: Param) {
  await openDetail(p)
  await genPreview()
}
async function genPreview() {
  if (!drawer.param) return
  drawer.previewing = true
  try {
    drawer.preview = await paramApi.genValues(drawer.param.paramId)
  } catch (error) {
    ElMessage.error(`生成参数值失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    drawer.previewing = false
  }
}
async function onAddValues() {
  if (!drawer.param || drawer.param.kind !== 'list') return
  let values = ''
  try {
    const result = await ElMessageBox.prompt('多个值可用逗号或换行分隔。', '新增参数值', {
      inputType: 'textarea',
      inputPlaceholder: '例如：上海\n深圳',
      inputValidator: (value) => !!value.trim() || '请输入参数值',
      confirmButtonText: '确认新增',
      cancelButtonText: '取消',
    })
    values = result.value
  } catch {
    return
  }
  try {
    const r = await paramApi.addParamValues(drawer.param.paramId, values)
    ElMessage.success(r?.message || '操作已提交（演示）')
    drawer.param = await paramApi.paramDetail(drawer.param.paramId) ?? drawer.param
    await load()
  } catch (error) {
    ElMessage.error(`新增参数值失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function onDeleteValue(valueId: string) {
  try {
    await ElMessageBox.confirm('删除后不可恢复，是否继续？', '删除参数值', { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    const result = await paramApi.deleteParamValue(valueId)
    ElMessage.success(result?.message || '参数值已删除')
    if (drawer.param) {
      drawer.param = await paramApi.paramDetail(drawer.param.paramId) ?? drawer.param
    }
    await load()
  } catch (error) {
    ElMessage.error(`删除参数值失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function onCopy(param: Param) {
  try {
    // 按钮文案对齐旧 ParamList.vue 的 a-popconfirm（okText="复制" cancelText="不处理"）
    await ElMessageBox.confirm(`复制参数“${param.name}”并生成新 ID？`, '制作副本', { type: 'warning', confirmButtonText: '复制', cancelButtonText: '不处理' })
  } catch {
    return
  }
  try {
    const result = await paramApi.paramCopy(param.paramId)
    ElMessage.success(result?.message || '复制成功，请查询最新 ID')
    await load()
  } catch (error) {
    ElMessage.error(`复制参数失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const allChecked = computed(() => !!list.value.length && list.value.every((p) => selected.value.includes(p.paramId)))
const pageIndeterminate = computed(() => !allChecked.value && list.value.some((p) => selected.value.includes(p.paramId)))

function toggleSelected(paramId: string, checked: boolean) {
  selected.value = checked
    ? Array.from(new Set([...selected.value, paramId]))
    : selected.value.filter((id) => id !== paramId)
}

function togglePage(checked: boolean) {
  const pageIds = list.value.map((param) => param.paramId)
  selected.value = checked
    ? Array.from(new Set([...selected.value, ...pageIds]))
    : selected.value.filter((id) => !pageIds.includes(id))
}

async function batchDelete() {
  if (!selected.value.length) {
    ElMessage.warning('请先选择参数')
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除选中的 ${selected.value.length} 个参数？`,
      '批量删除参数',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const result = await paramApi.deleteParams(selected.value)
    ElMessage.success(result?.message || '删除成功')
    selected.value = []
    await load()
  } catch (error) {
    ElMessage.error(`删除参数失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
</script>

<template>
  <div class="rc-card pt-main">
    <div class="pt-intro">统一管理源导入和任务配置引用的参数。参数源与任务中的“选择已有参数”均从这里读取；修改参数定义后，可回到对应源或任务查看最新值。</div>
    <div class="rc-toolbar wrap">
      <el-input v-model="paramIdFilter" :prefix-icon="Search" clearable placeholder="参数 ID" style="width: 150px" />
      <el-input v-model="paramNameFilter" clearable placeholder="参数名称" style="width: 190px" />
      <select v-model="kindFilter" class="pt-kind-filter" aria-label="按参数类型筛选">
        <option value="">全部类型</option>
        <option value="list">列表</option>
        <option value="date">日期</option>
        <option value="sequence">序列</option>
        <option value="date_sequence">日期序列</option>
        <option value="database">数据库</option>
      </select>
      <span class="pt-spacer" />
      <span class="muted">共 {{ total }} 个参数</span>
      <button class="rc-btn" type="button" :disabled="loading" aria-label="刷新参数列表" @click="load">刷新</button>
      <template v-if="canWrite">
        <button class="rc-btn danger" type="button" :disabled="!selected.length" @click="batchDelete">批量删除</button>
        <button class="rc-btn primary" type="button" @click="openCreate">新建参数</button>
      </template>
    </div>

    <div v-loading="loading" class="rc-table-scroll pt-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th v-if="canWrite" style="width: 42px">
              <el-checkbox :model-value="allChecked" :indeterminate="pageIndeterminate" aria-label="选择本页" @change="togglePage" />
            </th>
            <th style="width: 120px">参数 ID</th>
            <th>名称</th>
            <th style="width: 90px">分组</th>
            <th style="width: 96px">类型</th>
            <th>值定义</th>
            <th style="width: 80px">参数值</th>
            <th style="width: 110px">默认值</th>
            <th style="width: 140px">绑定参数源</th>
            <th style="width: 120px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.paramId">
            <td v-if="canWrite">
              <el-checkbox :model-value="selected.includes(p.paramId)" :aria-label="`选择参数 ${p.paramId}`" @change="toggleSelected(p.paramId, $event)" />
            </td>
            <td>{{ p.paramId }}</td>
            <td><button class="pt-name" type="button" @click="openDetail(p)">{{ p.name }}</button></td>
            <td>{{ p.group || '—' }}</td>
            <td><span class="rc-status" :class="kindMeta(p.kind).cls">{{ kindMeta(p.kind).text }}</span></td>
            <td class="muted pt-prev">{{ p.valueDef || '—' }}</td>
            <td><button class="pt-name" type="button" @click="onViewValues(p)">查看值</button></td>
            <td>{{ p.defaultValue || '—' }}</td>
            <td>
              <template v-if="p.paramSourceRefs?.length">
                <el-tag
                  v-for="ref in p.paramSourceRefs"
                  :key="ref.sourceId"
                  size="small"
                  effect="plain"
                  class="pt-source-tag"
                >{{ ref.sourceName }}</el-tag>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <el-button link type="primary" size="small" @click="openUsage(p)">使用位置</el-button>
              <el-button link type="primary" size="small" @click="openDetail(p)">详情</el-button>
              <template v-if="canWrite">
                <el-button link type="primary" size="small" @click="openEdit(p)">编辑</el-button>
                <el-button link type="primary" size="small" @click="onCopy(p)">复制</el-button>
              </template>
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
        :page-sizes="[10, 30, 100, 200]"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="load"
        @size-change="onSize"
      />
    </div>

  <el-drawer v-model="drawer.visible" :with-header="false" size="440px" append-to-body>
    <div v-if="drawer.param" class="pt-d">
      <div class="pt-d-title">{{ drawer.param.name }}</div>
      <div class="pt-d-sub muted">
        参数 ID {{ drawer.param.paramId }} ·
        <span class="rc-status" :class="kindMeta(drawer.param.kind).cls">{{ kindMeta(drawer.param.kind).text }}</span>
      </div>

      <dl class="rc-kv">
        <dt>分组</dt><dd>{{ drawer.param.group || '—' }}</dd>
        <dt>默认值</dt><dd>{{ drawer.param.defaultValue || '—' }}</dd>
        <dt>创建时间</dt><dd>{{ drawer.param.createdAt || '—' }}</dd>
        <dt>更新时间</dt><dd>{{ drawer.param.updatedAt || '—' }}</dd>
      </dl>

      <div class="pt-section">定义</div>
      <div v-if="drawer.param.kind === 'list'" class="pt-tags">
        <el-tag v-for="v in drawer.param.values || []" :key="v" size="small" effect="plain">{{ v }}</el-tag>
      </div>
      <div v-else-if="drawer.param.kind === 'database'" class="rc-code-box">{{ drawer.param.databaseQuery }}</div>
      <div v-else-if="drawer.param.kind === 'date'" class="rc-code-box">{{ drawer.param.dateExpr }}</div>
      <div v-else-if="drawer.param.kind === 'date_sequence'" class="rc-code-box">{{ drawer.param.dateExpr }} · {{ drawer.param.seq?.start }}~{{ drawer.param.seq?.end }} / {{ drawer.param.seq?.step }}</div>
      <div v-else-if="drawer.param.seq" class="rc-code-box">start={{ drawer.param.seq.start }} end={{ drawer.param.seq.end }} step={{ drawer.param.seq.step }}</div>

      <div class="pt-section">生成值预览</div>
      <button class="rc-btn" type="button" @click="genPreview">{{ drawer.previewing ? '生成中…' : '生成值预览' }}</button>
      <div v-if="drawer.preview.length" class="pt-prev-box">
        <div class="muted" style="margin-bottom: 4px">参数运行时生成的值列表，共 <span class="pt-prev-count">{{ drawer.preview.length }}</span> 个</div>
        <textarea class="rc-input pt-prev-textarea" :value="drawer.preview.join('\n')" rows="10" readonly />
      </div>

      <template v-if="drawer.param.kind === 'list' && drawer.param.valueItems?.length">
        <div class="pt-section">值列表</div>
        <table class="rc-data-table">
          <thead><tr><th style="width: 70px">值 ID</th><th style="width: 60px">序号</th><th>值</th><th v-if="canWrite" style="width: 70px">操作</th></tr></thead>
          <tbody>
            <tr v-for="item in drawer.param.valueItems" :key="item.valueId">
              <td>{{ item.valueId }}</td>
              <td>{{ item.seq }}</td>
              <td>{{ item.value }}</td>
              <td v-if="canWrite"><el-button link type="danger" size="small" @click="onDeleteValue(item.valueId)">删除</el-button></td>
            </tr>
          </tbody>
        </table>
      </template>

      <div v-if="canWrite && drawer.param.kind === 'list'" class="pt-foot">
        <button class="rc-btn danger" type="button" @click="onAddValues">新增参数值</button>
      </div>
    </div>
  </el-drawer>
  <el-drawer v-model="usage.visible" :title="`使用位置 · ${usage.param?.name ?? ''}`" size="520px" append-to-body>
    <template v-if="usage.param">
      <div class="pt-usage-id muted">参数 ID {{ usage.param.paramId }}</div>
      <div class="pt-section">参数源</div>
      <div v-if="usage.param.paramSourceRefs?.length" class="pt-usage-list">
        <router-link v-for="ref in usage.param.paramSourceRefs" :key="ref.sourceId" :to="{ path: '/canvas', query: { sourceId: ref.sourceId, view: 'overview' } }" class="pt-usage-link">{{ ref.sourceName }} · {{ ref.sourceId }}</router-link>
      </div>
      <div v-else class="muted">暂无可用的参数源绑定记录</div>
      <div class="pt-section">节点配置 / 任务参数</div>
      <div v-if="usage.loading" class="muted">正在核对配置绑定：{{ usageProgress.checked }} / {{ usageProgress.total || '…' }}</div>
      <div v-else-if="usage.error" class="pt-usage-error">查询失败：{{ usage.error }}</div>
      <template v-else-if="usage.result">
        <div v-if="usage.result.failed" class="pt-usage-error">{{ usage.result.failed }} 个配置查询失败，以下结果可能不完整。</div>
        <div v-if="usage.result.configs.length" class="pt-usage-list">
          <div v-for="config in usage.result.configs" :key="config.configId" class="pt-usage-item">{{ config.name }} <span class="muted">· {{ config.configId }}</span></div>
        </div>
        <div v-else-if="!usage.result.failed" class="muted">暂无配置绑定</div>
      </template>
    </template>
  </el-drawer>
  <ParamEditorDrawer v-model="editor.visible" :param="editor.param" @saved="onParamSaved" />
  </div>
</template>

<style scoped>
.pt-main { display: flex; flex-direction: column; height: calc(100vh - 215px); min-height: 520px; }
.pt-intro { padding: 12px 16px 0; color: var(--rc-muted); font-size: 12px; line-height: 1.5; }
.pt-usage-id { font-size: 12px; }
.pt-usage-list { display: flex; flex-direction: column; gap: 8px; }
.pt-usage-link { color: var(--rc-primary-ink); font-size: 12px; text-decoration: none; }
.pt-usage-link:hover { text-decoration: underline; }
.pt-usage-item { font-size: 12px; color: var(--rc-text); }
.pt-usage-error { margin: 8px 0; color: #b91c1c; font-size: 12px; }
.pt-kind-filter { height: 32px; min-width: 128px; padding: 0 8px; border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; }
.pt-spacer { flex: 1; }
.pt-table { flex: 1; }
.pt-name { padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.pt-name:hover { text-decoration: underline; }
.pt-source-tag + .pt-source-tag { margin-left: 4px; }
.pt-prev { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-empty { padding: 48px; text-align: center; }
.pt-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.pt-d { display: flex; flex-direction: column; gap: 4px; }
.pt-d-title { font-size: 15px; font-weight: 700; color: var(--rc-text); }
.pt-d-sub { font-size: 12px; margin-bottom: 8px; }
.pt-section { margin: 14px 0 8px; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.pt-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.pt-prev-box { margin-top: 10px; }
.pt-prev-count { color: #d93025; font-weight: 700; }
.pt-prev-textarea { width: 100%; resize: vertical; font-family: inherit; box-sizing: border-box; }
.pt-foot { display: flex; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
</style>
