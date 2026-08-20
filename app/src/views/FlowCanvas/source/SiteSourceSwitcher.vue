<script setup lang="ts">
// 源侧栏：页面级左侧固定栏，流程、数据、文件和任务视图共用。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { siteApi, sourceApi, type Site, type Source } from '@/api'
import type { ParamGroupRef } from '@/utils/flow/urlParams'
import ParamSourceEditor, { type ParamSourceModel } from './ParamSourceEditor.vue'
import { withoutComposition } from '@/utils/enterKey'

const props = defineProps<{ siteId: string; activeKey: string }>()
const emit = defineEmits<{ pick: [target: Source]; added: [Source]; compare: [rightId: string]; pickSite: [] }>()

const site = ref<Site | null>(null)
const children = ref<Source[]>([])
async function load() {
  ;[site.value, children.value] = await Promise.all([siteApi.siteDetail(props.siteId), siteApi.siteSources(props.siteId)])
}
onMounted(load)
watch(() => props.siteId, load)
defineExpose({ reload: load })

const collapsed = ref(false)
const listExpanded = ref(true)
const detailExpanded = ref(true)
const kw = ref('')
const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return children.value
  return children.value.filter((s) => s.name.toLowerCase().includes(q) || s.sourceId.toLowerCase().includes(q))
})
const activeSource = computed(() => children.value.find((s) => s.sourceId === props.activeKey) || null)

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    ElMessage.success('已复制源 ID 到剪贴板')
  } catch {
    ElMessage.info(`源 ID: ${id}`)
  }
}

function isErr(s: Source): boolean {
  return !s.disabled && s.state === 'E'
}
const canCompare = computed(() => !!props.activeKey)

// ---- 全局对比选择器（B4：跨站场景，按 sourceId 直接分屏加载，不依赖页签） ----
const cmp = reactive({ show: false, kw: '', results: [] as Source[], loading: false })
function openComparePicker() {
  cmp.show = true
  cmp.kw = ''
  cmp.results = children.value.filter((c) => c.sourceId !== props.activeKey)
}
function closeComparePicker() {
  cmp.show = false
}
let cmpTimer: ReturnType<typeof setTimeout> | undefined
function onCompareKwInput() {
  clearTimeout(cmpTimer)
  cmpTimer = setTimeout(async () => {
    const q = cmp.kw.trim()
    if (!q) {
      cmp.results = children.value.filter((c) => c.sourceId !== props.activeKey)
      return
    }
    cmp.loading = true
    try {
      // 全局搜索（含跨站）：复用源分页契约的 keyword 匹配，排除当前源
      const res = await sourceApi.sourcePaged({ keyword: q, size: 50 })
      cmp.results = res.list.filter((s) => s.sourceId !== props.activeKey)
    } finally {
      cmp.loading = false
    }
  }, 250)
}
function pickCompare(s: Source) {
  closeComparePicker()
  emit('compare', s.sourceId)
}
function onWindowClick() {
  if (cmp.show) closeComparePicker()
  closeRowMenu()
  paramEditorRef.value?.closePicker()
}
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
  if (cmpTimer) clearTimeout(cmpTimer)
})

// ---- 源操作：名称点击切换；右键菜单提供重命名/发起抓取 ----
const rename = reactive({ sourceId: '', name: '' })
function startRename(s: Source) {
  rename.sourceId = s.sourceId
  rename.name = s.name
  closeRowMenu()
}
function cancelRename() {
  rename.sourceId = ''
  rename.name = ''
}
async function saveRename(s: Source) {
  const name = rename.name.trim()
  if (!name || rename.sourceId !== s.sourceId) {
    cancelRename()
    return
  }
  if (name === s.name) {
    cancelRename()
    return
  }
  const updated = { ...s, name }
  try {
    const res = await sourceApi.sourceUpdate(updated)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '重命名失败，请重试')
      return
    }
    s.name = name
    cancelRename()
    ElMessage.success(res?.message || '源已重命名')
    emit('added', updated)
  } catch (error) {
    ElMessage.error(`重命名失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const rowMenu = reactive({ show: false, x: 0, y: 0, source: null as Source | null })
function openRowMenu(event: MouseEvent, s: Source) {
  rowMenu.show = true
  rowMenu.x = event.clientX
  rowMenu.y = event.clientY
  rowMenu.source = s
}
function closeRowMenu() {
  rowMenu.show = false
  rowMenu.source = null
}
async function launchFromMenu() {
  const s = rowMenu.source
  if (!s || s.disabled) return
  closeRowMenu()
  await launchSource(s)
}

// ---- ＋添加源（0812 会议纠偏：删除"绑定已有源/仅展示未关联"模式，只保留新建；
// 按源 ID/名称导入现有源的能力放到 M4 的"导入源"，接旧平台真实批量归属契约） ----
type TemplateMode = 'default' | 'search' | 'blank'
type SourceKind = 'normal' | 'param'
const addDlg = reactive({
  show: false,
  name: '',
  url: '',
  templateMode: 'blank' as TemplateMode,
  templateSourceId: '',
  kind: 'normal' as SourceKind,
})
const templateSearch = reactive({ keyword: '', results: [] as Source[], loading: false, open: false })
const defaultTemplate = computed(() => children.value[0] ?? null)
const selectedTemplate = computed(() => {
  if (addDlg.templateMode === 'default') return defaultTemplate.value
  if (addDlg.templateMode === 'search') return templateSearch.results.find((source) => source.sourceId === addDlg.templateSourceId) ?? null
  return null
})
function onTemplateModeChange() {
  addDlg.templateSourceId = ''
  templateSearch.keyword = ''
  templateSearch.results = []
  templateSearch.open = false
}
async function searchTemplateSources() {
  const keyword = templateSearch.keyword.trim()
  addDlg.templateSourceId = ''
  templateSearch.results = []
  templateSearch.open = !!keyword
  if (!keyword) return
  templateSearch.loading = true
  try {
    templateSearch.results = (await sourceApi.sourcePaged({ keyword, size: 50 })).list
  } finally {
    templateSearch.loading = false
  }
}
function selectTemplateSource(source: Source) {
  addDlg.templateSourceId = source.sourceId
  templateSearch.keyword = `${source.name}（${source.sourceId}）`
  templateSearch.open = false
}
function openAdd(ev: MouseEvent) {
  ev.stopPropagation()
  addDlg.show = true
  addDlg.name = ''
  addDlg.url = ''
  addDlg.kind = 'normal'
  addDlg.templateMode = defaultTemplate.value ? 'default' : 'blank'
  addDlg.templateSourceId = ''
  templateSearch.keyword = ''
  templateSearch.results = []
  templateSearch.open = false
  resetParamSource()
}
function closeAdd() {
  addDlg.show = false
}

// ---- 参数源（0721 会议）：加源弹窗内新增分支，与上面的普通源字段/流程互不干扰 ----
// 面板本体抽成 ParamSourceEditor（NodeInspector 只读摘要 / 编辑参数源弹窗共用），这里只留创建态需要的胶水。
const paramSrc = ref<ParamSourceModel>({ baseUrl: '', refs: [] as ParamGroupRef[], urlTemplate: '' })
const paramEditorRef = ref<InstanceType<typeof ParamSourceEditor> | null>(null)

function resetParamSource() {
  paramSrc.value = { baseUrl: '', refs: [], urlTemplate: '' }
}
function switchKind(kind: SourceKind) {
  addDlg.kind = kind
}

async function submitParamSource() {
  const name = addDlg.name.trim()
  if (!name) {
    ElMessage.warning('请填写源名称')
    return
  }
  if (!paramSrc.value.baseUrl.trim()) {
    ElMessage.warning('请填写基础 url')
    return
  }
  if (!paramSrc.value.refs.length) {
    ElMessage.warning('请至少添加一个参数')
    return
  }
  if (paramEditorRef.value?.mismatchWarnings.length) {
    ElMessage.warning('存在同组值数不一致的分组，请先调整')
    return
  }
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  const res = await siteApi.sourceAdd(
    props.siteId,
    {
      sourceId,
      name,
      url: '',
      configId: '',
      mainTable: '',
      owner: site.value?.owner || 'admin',
      state: 'C',
      kind: 'param',
      baseUrl: paramSrc.value.baseUrl.trim(),
      urlTemplate: paramSrc.value.urlTemplate,
      paramRefs: paramSrc.value.refs.map((ref) => ({ ...ref })),
    },
    false,
  )
  if (!res.ok) {
    ElMessage.warning(res.message || '添加失败，请重试')
    return
  }
  const addedId = res.sourceId || sourceId
  ElMessage.success(`已添加参数源「${name}」：源列表只存 1 条记录，发任务时将展开为 ${(paramEditorRef.value?.totalCount ?? 0).toLocaleString('en-US')} 个 URL`)
  closeAdd()
  await load()
  const added = children.value.find((c) => c.sourceId === addedId)
  if (added) emit('added', added)
}

async function submitAdd() {
  if (addDlg.kind === 'param') {
    await submitParamSource()
    return
  }
  if (!addDlg.name.trim()) {
    ElMessage.warning('请填写源名称')
    return
  }
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  const target = { name: addDlg.name.trim(), url: addDlg.url.trim() }
  let addedId = sourceId
  if (addDlg.templateMode === 'search' && !selectedTemplate.value) {
    ElMessage.warning('请先选择模板源，或切换为空白模板')
    return
  }
  if (selectedTemplate.value) {
    const res = await siteApi.cloneSource({
      templateSourceId: selectedTemplate.value.sourceId,
      targetSiteId: props.siteId,
      target,
    })
    if (!res?.source) return
    addedId = res.source.sourceId
    ElMessage.success(`已复制源「${target.name}」的流程、相关配置和表结构（不复制数据）`)
  } else {
    const res = await siteApi.sourceAdd(
      props.siteId,
      { sourceId, ...target, configId: '', mainTable: '', owner: site.value?.owner || 'admin', state: 'C' },
      false,
    )
    if (!res.ok) return
    addedId = res.sourceId || sourceId
    ElMessage.success(`已添加源「${target.name}」（空白流程，请先编排）`)
  }
  closeAdd()
  await load()
  const added = children.value.find((c) => c.sourceId === addedId)
  if (added) emit('added', added)
}

function pickSource(s: Source) {
  emit('pick', s)
}
async function launchSource(s: Source) {
  if (s.disabled) return
  try {
    const res = await sourceApi.sendSnatch([s.sourceId])
    ElMessage.success(res?.message || `已发起「${s.name}」抓取`)
  } catch (error) {
    ElMessage.error(`发起抓取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---- 批量导入（0812 会议反馈：关联已有源不该另起一个入口，跟"批量导入新源"都是"批量往这个
// 网站加源"，只是加的对象一个是新建一个是已存在，合成一个按钮、弹窗里用 tab 分）----
type BatchTab = 'new' | 'existing'
const batchTab = ref<BatchTab>('new')
function openBatch() {
  importDlg.show = true
  batchTab.value = 'new'
  importDlg.lines = ''
  resetBindState()
}
function closeBatch() {
  importDlg.show = false
}
function switchBatchTab(tab: BatchTab) {
  batchTab.value = tab
  if (tab === 'existing' && !bindDlg.results.length) void loadBindCandidates()
}

// ---- 导入已有源（0812 计划 M4-5，1:1 迁移旧平台 SiteList.vue 的关联源弹窗）：
// 按名称搜索、表格勾选后一次性 changeSite(ids, siteId)；按源 ID 批量导入见下面的 idImport（粘贴
// 即提交，不用先勾选）。跟"新增源" tab 是两回事——那边建的是新源，这里导入的是已经存在、
// 可能属于别的网站甚至没有归属的源。 ----
const bindDlg = reactive({
  keyword: '',
  results: [] as Source[],
  selected: new Set<string>(),
  hideBound: true,
  page: 1,
  total: 0,
  loading: false,
  submitting: false,
})
const BIND_PAGE_SIZE = 20
// 1:1 对齐旧平台 SiteList.vue 的 hideBound：只看 siteId 是否为空，连"已属本站"的也一起过滤掉——
// 已经在本站的源不需要再关联一次。
const bindVisibleResults = computed(() =>
  bindDlg.hideBound ? bindDlg.results.filter((s) => !s.siteId) : bindDlg.results,
)
async function loadBindCandidates() {
  bindDlg.loading = true
  try {
    const res = await sourceApi.sourcePaged({ keyword: bindDlg.keyword.trim() || undefined, page: bindDlg.page, size: BIND_PAGE_SIZE })
    bindDlg.results = res.list
    bindDlg.total = res.total
  } finally {
    bindDlg.loading = false
  }
}
function resetBindState() {
  bindDlg.keyword = ''
  bindDlg.results = []
  bindDlg.selected = new Set()
  bindDlg.hideBound = true
  bindDlg.page = 1
  bindDlg.total = 0
  idImport.open = false
  idImport.text = ''
}
function bindSearch() {
  bindDlg.page = 1
  void loadBindCandidates()
}
function bindPrevPage() {
  if (bindDlg.page <= 1) return
  bindDlg.page -= 1
  void loadBindCandidates()
}
function bindNextPage() {
  if (bindDlg.page * BIND_PAGE_SIZE >= bindDlg.total) return
  bindDlg.page += 1
  void loadBindCandidates()
}
function toggleBindRow(sourceId: string) {
  const next = new Set(bindDlg.selected)
  if (next.has(sourceId)) next.delete(sourceId)
  else next.add(sourceId)
  bindDlg.selected = next
}
// 已属其他网站的源需要二次确认才能提交（0812 计划 M4-6：显著标记 + 二次确认，不硬拦——按旧平台
// 行为，勾选后依然能提交，只是要让用户明确知道这会把源从原网站挪走）。已属本站/未关联的不用额外确认，
// 不给"每次都要点一下确认"的无意义摩擦。名称搜索/源ID 两条路径共用这一个确认逻辑。
async function confirmCrossSiteIfNeeded(candidates: Source[]): Promise<boolean> {
  const crossSite = candidates.filter((s) => s.siteId && s.siteId !== props.siteId)
  if (!crossSite.length) return true
  const names = crossSite.map((s) => `「${s.name}」（当前属于${s.siteName || s.siteId}）`).join('、')
  try {
    await ElMessageBox.confirm(
      `其中 ${crossSite.length} 个源已属于其他网站：${names}，导入后会改为属于「${site.value?.name ?? '当前网站'}」，是否继续？`,
      '确认导入',
      { type: 'warning', confirmButtonText: '确认导入', cancelButtonText: '取消' },
    )
    return true
  } catch {
    return false
  }
}
async function submitBind() {
  if (!bindDlg.selected.size) return
  const selected = bindDlg.results.filter((s) => bindDlg.selected.has(s.sourceId))
  if (!(await confirmCrossSiteIfNeeded(selected))) return
  bindDlg.submitting = true
  try {
    const res = await sourceApi.changeSite([...bindDlg.selected], props.siteId)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '导入失败，请重试')
      return
    }
    ElMessage.success(res.message || `已导入 ${bindDlg.selected.size} 个源到「${site.value?.name ?? '当前网站'}」`)
    closeBatch()
    await load()
  } finally {
    bindDlg.submitting = false
  }
}

// 按源ID批量导入（0812 会议反馈：不是"检索后手动勾选再点确认"，是粘贴一批源 ID 直接提交——
// ID 本身就是选择，不需要再在表格里勾一遍）。仍然过一遍跨网站二次确认，只是不需要先进表格预览。
const idImport = reactive({ open: false, text: '', loading: false })
function toggleIdImport() {
  idImport.open = !idImport.open
}
async function submitByIds() {
  const ids = [...new Set(idImport.text.split(/[,，\n\s]+/).map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) {
    ElMessage.warning('请输入源 ID')
    return
  }
  idImport.loading = true
  try {
    const res = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
    const found = res.list
    const missing = ids.filter((id) => !found.some((s) => s.sourceId === id))
    if (!found.length) {
      ElMessage.warning(`未找到匹配的源：${missing.join('、')}`)
      return
    }
    if (!(await confirmCrossSiteIfNeeded(found))) return
    const submitRes = await sourceApi.changeSite(found.map((s) => s.sourceId), props.siteId)
    if (!submitRes?.ok) {
      ElMessage.warning(submitRes?.message || '导入失败，请重试')
      return
    }
    let msg = submitRes.message || `已导入 ${found.length} 个源到「${site.value?.name ?? '当前网站'}」`
    if (missing.length) msg += `；${missing.length} 个源 ID 未找到：${missing.join('、')}`
    ElMessage.success(msg)
    idImport.text = ''
    idImport.open = false
    closeBatch()
    await load()
  } finally {
    idImport.loading = false
  }
}

// ---- 批量导入·新增源 tab（0711 R12：从采集资产页顶部迁入，siteId 已定，无需目标网站下拉） ----
const importDlg = reactive({ show: false, lines: '' })
async function submitImport() {
  if (!importDlg.lines.trim()) {
    ElMessage.warning('请填写源清单，一行一条「名称;URL」')
    return
  }
  const res = await siteApi.siteImportSources(props.siteId, importDlg.lines)
  if (!res?.ok) {
    ElMessage.warning(res?.message || '导入失败，请检查行格式')
    return
  }
  ElMessage.success(res?.message || '批量导入已提交（演示）')
  closeBatch()
  await load()
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterBindSearch = withoutComposition(() => bindSearch())
</script>

<template>
  <aside class="ssw-side" :class="{ collapsed }">
    <template v-if="!collapsed">
      <div class="ssw-head">
        <button
          class="ssw-site"
          :class="{ active: !activeKey }"
          type="button"
          title="网站详情：源/数据/文件汇总（全部源）"
          @click="emit('pickSite')"
        >
          <span class="ssw-site-ico">🌐</span>
          <span class="ssw-site-name">{{ site?.name || '网站详情' }}</span>
        </button>
        <button class="ssw-collapse" type="button" title="收起侧栏" @click="collapsed = true">«</button>
      </div>
      <div class="ssw-section-toggle" @click="listExpanded = !listExpanded">
        <span class="ssw-section-title">源列表 ({{ children.length }})</span>
        <span class="ssw-section-icon">{{ listExpanded ? '▼' : '▶' }}</span>
      </div>
      <template v-if="listExpanded">
        <input v-model="kw" class="ssw-search" placeholder="搜索源" />
        <div class="ssw-list">
          <div v-if="!kw" class="ssw-row" :class="{ active: !activeKey }">
            <button
              class="ssw-row-all-btn"
              type="button"
              title="全部（不根据源 ID 过滤）"
              @click="emit('pickSite')"
            >
              <span class="ssw-dot all" />
              <div class="ssw-row-text">
                <div class="ssw-row-head">
                  <span class="ssw-row-name">全部</span>
                </div>
                <div class="ssw-row-id">不根据源 ID 过滤</div>
              </div>
            </button>
          </div>
          <div v-for="c in filtered" :key="c.sourceId" class="ssw-row" :class="{ active: activeKey === c.sourceId }">
            <template v-if="rename.sourceId === c.sourceId">
              <input
                v-model="rename.name"
                class="ssw-rename-input"
                data-testid="source-rename-input"
                autofocus
                @click.stop
                @keydown.enter.prevent="saveRename(c)"
                @keydown.esc.prevent="cancelRename"
                @blur="saveRename(c)"
              />
            </template>
            <button
              v-else
              class="ssw-row-main"
              type="button"
              :title="`${c.name} · ${c.sourceId}`"
              @click="pickSource(c)"
              @dblclick.stop="startRename(c)"
              @contextmenu.prevent.stop="openRowMenu($event, c)"
            >
              <span class="ssw-dot" :class="{ err: isErr(c), muted: c.disabled }" />
              <div class="ssw-row-text">
                <div class="ssw-row-head">
                  <span class="ssw-row-name">{{ c.name }}</span>
                  <span v-if="c.kind === 'param'" class="ssw-kind-tag" title="参数源：发任务时展开为多个 URL">参数源</span>
                </div>
                <div class="ssw-row-id">{{ c.sourceId }}</div>
              </div>
            </button>
            <button
              v-if="canCompare && c.sourceId !== activeKey"
              class="ssw-row-cmp"
              type="button"
              title="与当前源并排对比"
              @click.stop="emit('compare', c.sourceId)"
            >⇔</button>
          </div>
          <div v-if="!filtered.length" class="ssw-empty">{{ kw ? '没有匹配的源' : '该网站暂无源' }}</div>
        </div>
      </template>

      <!-- 选中源详情分割栏：点击源后完整展示源名称和源 ID -->
      <div v-if="activeSource" class="ssw-section-toggle ssw-detail-header" @click="detailExpanded = !detailExpanded">
        <span class="ssw-section-title">源详情</span>
        <span class="ssw-section-icon">{{ detailExpanded ? '▼' : '▶' }}</span>
      </div>
      <div v-if="activeSource && detailExpanded" class="ssw-active-detail" data-testid="active-source-detail">
        <div class="ssw-detail-field">
          <span class="ssw-detail-label">源名称</span>
          <div class="ssw-detail-val name" data-testid="active-source-full-name">{{ activeSource.name }}</div>
        </div>
        <div class="ssw-detail-field">
          <span class="ssw-detail-label">源 ID</span>
          <div class="ssw-detail-val id">
            <code data-testid="active-source-full-id">{{ activeSource.sourceId }}</code>
            <button class="ssw-copy-btn" type="button" title="复制源 ID" @click="copyId(activeSource.sourceId)">复制</button>
          </div>
        </div>
        <div v-if="activeSource.url" class="ssw-detail-field">
          <span class="ssw-detail-label">URL</span>
          <div class="ssw-detail-val url" :title="activeSource.url">{{ activeSource.url }}</div>
        </div>
      </div>
      <div class="ssw-foot">
        <button class="ssw-foot-btn" type="button" title="添加源" @click="openAdd">＋ 添加源</button>
        <button
          class="ssw-foot-btn"
          type="button"
          :disabled="!canCompare"
          :title="canCompare ? '选择任意网站的源并排对比' : '请先切到具体源再对比'"
          @click.stop="openComparePicker"
        >⇔ 对比</button>
      </div>
      <div class="ssw-foot">
        <button class="ssw-foot-btn" type="button" title="批量新增源，或把已存在的源关联到这个网站" data-testid="open-batch" @click.stop="openBatch">批量导入</button>
      </div>
    </template>
    <button v-else class="ssw-expand" type="button" title="展开源侧栏" @click="collapsed = false">»</button>
  </aside>

  <!-- 全局对比选择器（B4）：默认列本站其他源，输入即全局搜索（含跨站） -->
  <div v-if="cmp.show" class="ssw-cmp-pop" @click.stop>
    <div class="ssw-cmp-title">选择对比对象（与当前源并排）</div>
    <input v-model="cmp.kw" class="ssw-search" placeholder="搜索全部网站的源" autofocus @input="onCompareKwInput" />
    <div class="ssw-cmp-list">
      <div v-if="cmp.loading" class="ssw-empty">搜索中…</div>
      <template v-else>
        <button v-for="s in cmp.results" :key="s.sourceId" type="button" class="ssw-cmp-item" @click="pickCompare(s)">
          <span class="ssw-dot" :class="{ err: isErr(s) }" />
          <span class="ssw-cmp-name">{{ s.name }}</span>
          <span class="ssw-cmp-id">{{ s.sourceId }}</span>
        </button>
        <div v-if="!cmp.results.length" class="ssw-empty">没有匹配的源</div>
      </template>
    </div>
  </div>

  <div
    v-if="rowMenu.show && rowMenu.source"
    class="ssw-row-menu"
    :style="{ left: `${rowMenu.x}px`, top: `${rowMenu.y}px` }"
    @click.stop
  >
    <button type="button" @click="startRename(rowMenu.source!)">重命名</button>
    <button
      type="button"
      data-testid="source-menu-launch"
      :disabled="rowMenu.source.disabled"
      @click="launchFromMenu"
    >发起抓取</button>
  </div>

  <div v-if="addDlg.show" class="ssw-add-backdrop" @click.self="closeAdd">
    <div class="ssw-add-card" :class="{ wide: addDlg.kind === 'param' }" @click.stop="paramEditorRef?.closePicker()">
      <div class="ssw-add-header">
        <div class="ssw-add-title">添加源</div>
      </div>

      <div class="ssw-field-label">源类型</div>
      <div class="ssw-kind-seg" data-testid="source-kind-seg">
        <button type="button" :class="{ active: addDlg.kind === 'normal' }" @click="switchKind('normal')">
          <strong>普通源</strong><small>手工填写名称 + URL</small>
        </button>
        <button type="button" :class="{ active: addDlg.kind === 'param' }" data-testid="source-kind-param" @click="switchKind('param')">
          <strong>参数源</strong><small>URL 模板 + 参数，按规律生成</small>
        </button>
      </div>

      <template v-if="addDlg.kind === 'normal'">
        <label class="ssw-field-label">源名称 <em>*</em></label>
        <input v-model="addDlg.name" class="ssw-add-input" placeholder="请输入源名称" />
        <label class="ssw-field-label">源 URL <span>（可选）</span></label>
        <input v-model="addDlg.url" class="ssw-add-input" placeholder="请输入源 URL" />
        <label class="ssw-field-label">复制配置来源</label>
        <select v-model="addDlg.templateMode" class="ssw-add-input" data-testid="source-template-mode" @change="onTemplateModeChange">
          <option v-if="defaultTemplate" value="default">默认：本网站第一个源（{{ defaultTemplate.name }}）</option>
          <option value="search">搜索并选择全部源</option>
          <option value="blank">空白模板</option>
        </select>
        <div v-if="addDlg.templateMode === 'search'" class="ssw-template-combobox" @click.stop>
          <input
            v-model="templateSearch.keyword"
            class="ssw-add-input"
            data-testid="source-template-search"
            placeholder="搜索并选择全部源（名称或 ID）"
            @focus="templateSearch.open = !!templateSearch.keyword.trim()"
            @input="searchTemplateSources"
          />
          <div v-if="templateSearch.open" class="ssw-template-options">
            <span v-if="templateSearch.loading" class="ssw-template-empty">搜索源中…</span>
            <span v-else-if="!templateSearch.results.length" class="ssw-template-empty">未找到匹配源</span>
            <button
              v-for="source in templateSearch.results"
              v-else
              :key="source.sourceId"
              type="button"
              data-testid="source-template-option"
              @click="selectTemplateSource(source)"
            >
              <div class="ssw-template-text">
                <span class="ssw-template-label">{{ source.name }}</span>
                <span class="ssw-template-id">{{ source.sourceId }}</span>
              </div>
            </button>
          </div>
        </div>
        <div class="ssw-add-hint">
          {{ selectedTemplate ? `将复制「${selectedTemplate.name}」的流程节点、相关配置和表结构，不复制数据与运行记录。` : '仅创建名称和 URL，流程从空白画布开始。' }}
        </div>
      </template>

      <template v-else>
        <label class="ssw-field-label">源名称 <em>*</em></label>
        <input v-model="addDlg.name" class="ssw-add-input" placeholder="请输入源名称" />
        <ParamSourceEditor ref="paramEditorRef" v-model="paramSrc" />
      </template>

      <div class="ssw-add-actions">
        <button class="rc-btn" type="button" @click="closeAdd">取消</button>
        <button class="rc-btn primary" type="button" data-testid="add-source-submit" @click="submitAdd">添加并进入编排</button>
      </div>
    </div>
  </div>

  <!-- 批量导入弹窗（0812 会议反馈：新增源和关联已有源都是"批量往这个网站加源"，只是加的对象
       一个是新建一个是已存在，合成一个入口、弹窗里用 tab 分，不再是两个独立按钮） -->
  <div v-if="importDlg.show" class="ssw-add-backdrop" @click.self="closeBatch">
    <div class="ssw-add-card" :class="{ bind: batchTab === 'existing' }" @click.stop>
      <div class="ssw-add-header">
        <div class="ssw-add-title">批量导入 · {{ site?.name || '当前网站' }}</div>
      </div>
      <div class="ssw-bind-toolbar batch-tabs">
        <button type="button" class="ssw-batch-tab" :class="{ active: batchTab === 'new' }" data-testid="batch-tab-new" @click="switchBatchTab('new')">新增源</button>
        <button type="button" class="ssw-batch-tab" :class="{ active: batchTab === 'existing' }" data-testid="batch-tab-existing" @click="switchBatchTab('existing')">导入已有源</button>
      </div>

      <template v-if="batchTab === 'new'">
        <textarea
          v-model="importDlg.lines"
          class="ssw-import-textarea"
          rows="6"
          placeholder="一行一条，格式：源名称;URL（URL 可省略）&#10;波兰语公告;https://example.com/notice?lang=pl&#10;瑞典语公告;https://example.com/notice?lang=sv"
        />
        <div class="ssw-add-hint">导入的源均从空白流程开始，空行跳过</div>
        <div class="ssw-add-actions">
          <button class="rc-btn" type="button" @click="closeBatch">取消</button>
          <button class="rc-btn primary" type="button" data-testid="batch-import-submit" @click="submitImport">导入</button>
        </div>
      </template>

      <!-- 导入已有源（0812 计划 M4-5，1:1 迁移旧平台 SiteList.vue 的关联源）：跟"新增源" tab 是两回事——
           那边建的是新源，这里导入的是已经存在的源，可能属于别的网站（要显著提示），也可能压根没归属过。
           两条路径：按名称搜索+表格勾选（下面这块），或者按源ID批量导入（粘贴即提交，不用先勾选）。 -->
      <template v-else>
        <div class="ssw-bind-toolbar">
          <input
            v-model="bindDlg.keyword"
            class="ssw-add-input bind-kw"
            placeholder="按源名称搜索"
            data-testid="bind-source-search"
            @keyup.enter="onEnterBindSearch"
          />
          <button class="rc-btn" type="button" @click="bindSearch">搜索</button>
          <button class="rc-btn" type="button" data-testid="id-import-toggle" @click="toggleIdImport">
            {{ idImport.open ? '收起按源ID批量导入' : '按源ID批量导入' }}
          </button>
          <label class="ssw-bind-hide">
            <input v-model="bindDlg.hideBound" type="checkbox" />
            仅展示未关联
          </label>
          <span class="ssw-bind-selected">已选 {{ bindDlg.selected.size }}</span>
        </div>

        <!-- 按源ID批量导入：粘贴一批源 ID 直接提交，ID 本身就是选择，不用先在下面表格里勾一遍
             （0812 会议反馈：不是"检索后手动勾选"）。仍会先查一遍归属，跨网站的照样弹二次确认。 -->
        <div v-if="idImport.open" class="ssw-bind-batch">
          <textarea
            v-model="idImport.text"
            class="ssw-import-textarea"
            rows="3"
            placeholder="输入源 ID，逗号或换行分隔，提交后直接导入到当前网站"
            data-testid="id-import-textarea"
          />
          <button class="rc-btn primary" type="button" :disabled="idImport.loading" data-testid="id-import-submit" @click="submitByIds">
            {{ idImport.loading ? '导入中…' : '批量导入' }}
          </button>
        </div>

        <div class="ssw-bind-table-wrap" v-loading="bindDlg.loading">
          <table class="rc-data-table ssw-bind-table" data-testid="bind-source-table">
            <thead><tr><th style="width:32px"></th><th>源ID</th><th>源名称</th><th>当前归属</th></tr></thead>
            <tbody>
              <tr v-for="s in bindVisibleResults" :key="s.sourceId" @click="toggleBindRow(s.sourceId)">
                <td @click.stop><input type="checkbox" :checked="bindDlg.selected.has(s.sourceId)" @change="toggleBindRow(s.sourceId)" /></td>
                <td class="mono">{{ s.sourceId }}</td>
                <td>{{ s.name }}</td>
                <td>
                  <span v-if="!s.siteId" class="ssw-bind-unbound">未关联</span>
                  <span v-else-if="s.siteId === props.siteId" class="ssw-bind-current">已属本站</span>
                  <span v-else class="ssw-bind-other" :title="'已关联到其它网站，勾选并提交会改为关联到 ' + (site?.name || '当前网站')">已属其他网站{{ s.siteName ? `「${s.siteName}」` : '' }}</span>
                </td>
              </tr>
              <tr v-if="!bindDlg.loading && !bindVisibleResults.length"><td colspan="4" class="ssw-empty">没有匹配的源</td></tr>
            </tbody>
          </table>
        </div>
        <div class="ssw-bind-pager">
          <button class="rc-btn" type="button" :disabled="bindDlg.page <= 1" @click="bindPrevPage">上一页</button>
          <span class="ssw-bind-muted">第 {{ bindDlg.page }} 页 · 共 {{ bindDlg.total }} 条</span>
          <button class="rc-btn" type="button" :disabled="bindDlg.page * BIND_PAGE_SIZE >= bindDlg.total" @click="bindNextPage">下一页</button>
        </div>

        <div class="ssw-add-hint">勾选源后点击"确认导入"即可批量导入到当前网站。</div>
        <div class="ssw-add-actions">
          <button class="rc-btn" type="button" @click="closeBatch">取消</button>
          <button
            class="rc-btn primary"
            type="button"
            data-testid="bind-source-submit"
            :disabled="!bindDlg.selected.size || bindDlg.submitting"
            @click="submitBind"
          >{{ bindDlg.submitting ? '提交中…' : '确认导入' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ssw-side {
  flex: none;
  width: 200px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fbfdff;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  overflow: hidden;
}
.ssw-side.collapsed { width: 30px; align-items: center; justify-content: flex-start; padding-top: 8px; background: #fff; }
.ssw-expand { border: 0; background: transparent; color: var(--rc-muted); font-size: 14px; cursor: pointer; width: 24px; height: 24px; border-radius: 5px; }
.ssw-expand:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.ssw-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 0; }
.ssw-site {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #fff;
  color: var(--rc-text-2);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ssw-site:hover { border-color: #93c5fd; color: var(--rc-primary-ink); }
.ssw-site.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-site-ico { flex: none; }
.ssw-site-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-collapse { flex: none; border: 0; background: transparent; color: var(--rc-faint); font-size: 13px; cursor: pointer; width: 20px; height: 24px; border-radius: 5px; }
.ssw-collapse:hover { background: #f1f5f9; color: var(--rc-text); }

.ssw-search {
  flex: none;
  height: 28px;
  margin: 8px 8px 6px;
  padding: 0 9px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  font-size: 12px;
  outline: none;
  background: #fff;
}
.ssw-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }

.ssw-list { flex: 1; overflow-y: auto; padding: 0 6px 6px; scrollbar-width: thin; }
.ssw-row { display: flex; align-items: center; border-radius: 7px; }
.ssw-row:hover { background: var(--rc-primary-bg); }
.ssw-row.active { background: var(--rc-primary); }
.ssw-row-main,
.ssw-row-all-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  text-align: left;
}
.ssw-rename-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  margin: 2px 4px;
  padding: 0 7px;
  border: 1px solid #60a5fa;
  border-radius: 5px;
  outline: none;
  font-size: 12px;
  color: var(--rc-text);
}
.ssw-row:hover .ssw-row-main,
.ssw-row:hover .ssw-row-all-btn { color: var(--rc-primary-ink); }
.ssw-row.active .ssw-row-main,
.ssw-row.active .ssw-row-all-btn { color: #fff; font-weight: 700; }
.ssw-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ssw-row-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ssw-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
.ssw-row-id { font-size: 10px; opacity: 0.6; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; margin-top: 1px; }
.ssw-row.active .ssw-row-id { opacity: 0.85; }
.ssw-kind-tag { flex: none; font-size: 9px; font-weight: 700; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border: 1px solid #bfdbfe; border-radius: 3px; padding: 0 4px; line-height: 14px; }
.ssw-row.active .ssw-kind-tag { color: #fff; background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); }
.ssw-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
.ssw-dot.all { background: #3b82f6; }
.ssw-dot.err { background: var(--rc-error); }
.ssw-dot.muted { background: var(--rc-faint); }
.ssw-row-cmp {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--rc-muted);
  font-size: 12px;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  border-radius: 5px;
  cursor: pointer;
  visibility: hidden;
}
.ssw-row:hover .ssw-row-cmp { visibility: visible; }
.ssw-row-cmp:hover { background: #fff; color: var(--rc-primary); }
.ssw-empty { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }

.ssw-foot { flex: none; display: flex; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid var(--rc-border-soft); }
.ssw-foot-btn {
  flex: 1;
  height: 26px;
  border: 1px dashed var(--rc-border);
  border-radius: 7px;
  background: transparent;
  color: var(--rc-muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.ssw-foot-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.ssw-foot-btn:disabled { cursor: not-allowed; opacity: 0.55; }

.ssw-cmp-pop {
  position: fixed;
  left: 220px;
  bottom: 80px;
  z-index: 90;
  width: 280px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 10px;
  box-shadow: 0 20px 48px -18px rgba(15, 23, 42, 0.4);
  overflow: hidden;
  padding-bottom: 6px;
}
.ssw-cmp-title { flex: none; font-size: 12px; font-weight: 700; color: var(--rc-text); padding: 10px 10px 0; }
.ssw-cmp-list { flex: 1; overflow-y: auto; padding: 0 6px; }
.ssw-cmp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  text-align: left;
}
.ssw-cmp-item:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-cmp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-cmp-id { flex: none; margin-left: auto; font-size: 10px; color: var(--rc-faint); }

.ssw-row-menu {
  position: fixed;
  z-index: 92;
  min-width: 112px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.38);
}
.ssw-row-menu button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.ssw-row-menu button:hover:not(:disabled) { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-row-menu button:disabled { color: var(--rc-faint); cursor: not-allowed; }

.ssw-add-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.34); }
.ssw-add-card { box-sizing: border-box; width: min(720px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 32px)); overflow-y: auto; background: #fff; border: 1px solid #dbe5f1; border-radius: 18px; padding: 24px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.ssw-add-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.ssw-add-title { font-size: 22px; font-weight: 800; color: var(--rc-text); letter-spacing: -0.02em; }
.ssw-field-label { display: block; margin: 0 0 8px; color: var(--rc-text); font-size: 14px; font-weight: 700; }
.ssw-field-label em { color: #ef4444; font-style: normal; margin-left: 2px; }
.ssw-field-label span { color: var(--rc-muted); font-weight: 500; }
.ssw-add-input { box-sizing: border-box; width: 100%; height: 44px; border: 1px solid #cbd8e8; border-radius: 9px; background: #fff; color: var(--rc-text); font-size: 14px; padding: 0 13px; outline: none; margin-bottom: 18px; }
.ssw-add-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-template-combobox { position: relative; }
.ssw-template-options { position: absolute; z-index: 2; top: 32px; right: 0; left: 0; max-height: 160px; overflow: auto; border: 1px solid #bfdbfe; border-radius: 7px; background: #fff; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14); }
.ssw-template-options button { display: flex; width: 100%; align-items: center; border: 0; background: #fff; color: var(--rc-text); padding: 6px 9px; font-size: 12px; text-align: left; cursor: pointer; }
.ssw-template-options button:hover { background: #eff6ff; }
.ssw-template-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ssw-template-label { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-template-id { font-size: 10px; color: var(--rc-faint); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.ssw-template-empty { display: block; padding: 8px 9px; color: var(--rc-muted); font-size: 12px; }
.ssw-add-inherit { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--rc-text); cursor: pointer; margin: 2px 0 4px; }
.ssw-add-hint { font-size: 12px; color: var(--rc-muted); line-height: 1.6; margin: -4px 0 6px; }
.ssw-add-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--rc-border-soft); }
.ssw-import-textarea {
  width: 100%;
  border: 1px solid #dbe3ee;
  border-radius: 7px;
  background: #fff;
  color: var(--rc-text);
  font-size: 12px;
  padding: 8px 9px;
  outline: none;
  margin-bottom: 8px;
  resize: vertical;
  font-family: inherit;
}
.ssw-import-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }

/* 参数源（0721 会议）：加源弹窗内新增分支；面板本体样式随 ParamSourceEditor.vue 迁走 */
.ssw-add-card.wide { width: min(780px, calc(100vw - 32px)); transition: width 0.18s ease; }
.ssw-kind-seg { display: flex; gap: 16px; margin: 0 0 24px; }
.ssw-kind-seg button { flex: 1; min-height: 82px; padding: 14px 18px; border: 1px solid #d5e2f2; border-radius: 12px; background: #fff; color: var(--rc-text-2); font-size: 16px; font-weight: 700; cursor: pointer; text-align: left; font-family: inherit; }
.ssw-kind-seg button.active { border-color: var(--rc-primary); background: #eff6ff; color: var(--rc-primary-ink); box-shadow: inset 0 0 0 1px var(--rc-primary); }
.ssw-kind-seg button strong { display: block; }
.ssw-kind-seg button small { display: block; font-size: 13px; font-weight: 500; color: var(--rc-muted); margin-top: 7px; }

@media (max-width: 720px) {
  .ssw-add-card, .ssw-add-card.wide { width: calc(100vw - 24px); padding: 18px; border-radius: 14px; }
  .ssw-add-header { align-items: flex-start; flex-direction: column; gap: 12px; margin-bottom: 18px; }
  .ssw-kind-seg { gap: 8px; }
  .ssw-kind-seg button { min-height: 72px; padding: 10px; font-size: 14px; }
  .ssw-kind-seg button small { font-size: 11px; }
}

/* 折叠分割栏 & 选中源详情 */
.ssw-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 9px;
  margin: 6px 6px 0;
  border-radius: 6px;
  background: #f1f5f9;
  color: var(--rc-text-2);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  border: 1px solid var(--rc-border-soft);
  transition: background 0.12s, color 0.12s;
}
.ssw-section-toggle:hover {
  background: #e2e8f0;
  color: var(--rc-text);
}
.ssw-section-icon {
  font-size: 9px;
  color: var(--rc-muted);
}
.ssw-active-detail {
  flex: none;
  margin: 0 6px 6px;
  padding: 8px 9px;
  background: #fff;
  border: 1px solid var(--rc-border-soft);
  border-top: none;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  font-size: 11px;
}
.ssw-detail-field {
  margin-bottom: 6px;
}
.ssw-detail-field:last-child {
  margin-bottom: 0;
}
.ssw-detail-label {
  display: block;
  font-size: 10px;
  color: var(--rc-muted);
  font-weight: 600;
  margin-bottom: 2px;
}
.ssw-detail-val.name {
  color: var(--rc-text);
  font-weight: 600;
  word-break: break-all;
  line-height: 1.35;
}
.ssw-detail-val.id {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.ssw-detail-val.id code {
  font-family: monospace;
  font-size: 10px;
  color: #2563eb;
  background: #eff6ff;
  padding: 2px 5px;
  border-radius: 4px;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}
.ssw-copy-btn {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--rc-border);
  border-radius: 4px;
  background: #f8fafc;
  color: var(--rc-text-2);
  font-size: 10px;
  cursor: pointer;
}
.ssw-copy-btn:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  color: var(--rc-primary-ink);
}
.ssw-detail-val.url {
  color: var(--rc-faint);
  font-size: 10px;
  word-break: break-all;
}

/* 批量导入弹窗（新增源 / 关联已有源共用一个入口，靠 tab 分） */
.ssw-add-card.bind { width: min(760px, calc(100vw - 32px)); }
.batch-tabs { margin-bottom: 16px; }
.ssw-batch-tab { height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ssw-batch-tab:hover { border-color: #93c5fd; color: var(--rc-primary-ink); }
.ssw-batch-tab.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-bind-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.ssw-add-input.bind-kw { width: 220px; height: 34px; margin-bottom: 0; }
.ssw-bind-toolbar .rc-btn { height: 34px; padding: 0 12px; font-size: 12px; }
.ssw-bind-hide { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--rc-text-2); cursor: pointer; user-select: none; }
.ssw-bind-selected { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--rc-primary-ink); }
.ssw-bind-batch { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.ssw-bind-batch .ssw-import-textarea { flex: 1; margin-bottom: 0; }
.ssw-bind-batch .rc-btn { flex: none; height: 34px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.ssw-bind-table-wrap { max-height: 320px; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; }
.ssw-bind-table { width: 100%; }
.ssw-bind-table tbody tr { cursor: pointer; }
.ssw-bind-table tbody tr:hover { background: var(--rc-primary-bg); }
.ssw-bind-table .mono { font-family: monospace; font-size: 11px; }
.ssw-bind-unbound { color: var(--rc-faint); font-size: 12px; }
.ssw-bind-current { color: var(--rc-ok); font-size: 12px; font-weight: 600; }
.ssw-bind-other { color: #d97706; font-size: 12px; font-weight: 600; }
.ssw-bind-pager { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 10px 0 4px; }
.ssw-bind-muted { font-size: 12px; color: var(--rc-muted); }
</style>
