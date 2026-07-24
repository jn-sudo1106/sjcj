<script setup lang="ts">
// 子源侧栏：页面级左侧固定栏，流程、数据、文件和任务视图共用。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type Site, type Source } from '../../api'
import type { ParamGroupRef } from '@/utils/flow/urlParams'
import ParamSourceEditor, { type ParamSourceModel } from './ParamSourceEditor.vue'

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
const kw = ref('')
const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return children.value
  return children.value.filter((s) => s.name.toLowerCase().includes(q) || s.sourceId.toLowerCase().includes(q))
})
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
      // 全局搜索（含跨站）：复用源分页契约的 keyword 匹配，排除当前子源
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

// ---- 子源操作：名称点击切换；右键菜单提供重命名/发起抓取 ----
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
    ElMessage.success(res?.message || '子源已重命名')
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

// ---- ＋添加子源：默认复制当前网站首个子源，也可搜索全部子源或选择空白模板 ----
type TemplateMode = 'default' | 'search' | 'blank'
type SourceKind = 'normal' | 'param'
const addDlg = reactive({ show: false, name: '', url: '', templateMode: 'blank' as TemplateMode, templateSourceId: '', kind: 'normal' as SourceKind })
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

// ---- 参数源（0721 会议）：加源弹窗内新增分支，与上面的普通子源字段/流程互不干扰 ----
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
    ElMessage.warning('请填写子源名称')
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
  ElMessage.success(`已添加参数子源「${name}」：源列表只存 1 条记录，发任务时将展开为 ${(paramEditorRef.value?.totalCount ?? 0).toLocaleString('en-US')} 个 URL`)
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
    ElMessage.warning('请填写子源名称')
    return
  }
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  const target = { name: addDlg.name.trim(), url: addDlg.url.trim() }
  let addedId = sourceId
  if (addDlg.templateMode === 'search' && !selectedTemplate.value) {
    ElMessage.warning('请先选择模板子源，或切换为空白模板')
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
    ElMessage.success(`已复制子源「${target.name}」的流程、相关配置和表结构（不复制数据）`)
  } else {
    const res = await siteApi.sourceAdd(
      props.siteId,
      { sourceId, ...target, configId: '', mainTable: '', owner: site.value?.owner || 'admin', state: 'C' },
      false,
    )
    if (!res.ok) return
    addedId = res.sourceId || sourceId
    ElMessage.success(`已添加子源「${target.name}」（空白流程，请先编排）`)
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

// ---- 批量导入子源（0711 R12：从采集资产页顶部迁入，siteId 已定，无需目标网站下拉） ----
const importDlg = reactive({ show: false, lines: '' })
function openImport() {
  importDlg.show = true
  importDlg.lines = ''
}
function closeImport() {
  importDlg.show = false
}
async function submitImport() {
  if (!importDlg.lines.trim()) {
    ElMessage.warning('请填写子源清单，一行一条「名称;URL」')
    return
  }
  const res = await siteApi.siteImportSources(props.siteId, importDlg.lines)
  if (!res?.ok) {
    ElMessage.warning(res?.message || '导入失败，请检查行格式')
    return
  }
  ElMessage.success(res?.message || '批量导入已提交（演示）')
  closeImport()
  await load()
}
</script>

<template>
  <aside class="ssw-side" :class="{ collapsed }">
    <template v-if="!collapsed">
      <div class="ssw-head">
        <button
          class="ssw-site"
          :class="{ active: !activeKey }"
          type="button"
          title="网站详情：数据/文件/任务汇总（全部子源）"
          @click="emit('pickSite')"
        >
          <span class="ssw-site-ico">🌐</span>
          <span class="ssw-site-name">{{ site?.name || '网站详情' }}</span>
        </button>
        <button class="ssw-collapse" type="button" title="收起侧栏" @click="collapsed = true">«</button>
      </div>
      <input v-model="kw" class="ssw-search" placeholder="搜索子源" />
      <div class="ssw-list">
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
            <span class="ssw-row-name">{{ c.name }}</span>
            <span v-if="c.kind === 'param'" class="ssw-kind-tag" title="参数子源：发任务时展开为多个 URL">参数子源</span>
          </button>
          <button
            v-if="canCompare && c.sourceId !== activeKey"
            class="ssw-row-cmp"
            type="button"
            title="与当前子源并排对比"
            @click.stop="emit('compare', c.sourceId)"
          >⇔</button>
        </div>
        <div v-if="!filtered.length" class="ssw-empty">{{ kw ? '没有匹配的子源' : '该网站暂无子源' }}</div>
      </div>
      <div class="ssw-foot">
        <button class="ssw-foot-btn" type="button" title="添加子源" @click="openAdd">＋ 添加子源</button>
        <button
          class="ssw-foot-btn"
          type="button"
          :disabled="!canCompare"
          :title="canCompare ? '选择任意网站的子源并排对比' : '请先切到具体子源再对比'"
          @click.stop="openComparePicker"
        >⇔ 对比</button>
      </div>
      <div class="ssw-foot">
        <button class="ssw-foot-btn" type="button" title="批量导入子源" @click.stop="openImport">批量导入</button>
      </div>
    </template>
    <button v-else class="ssw-expand" type="button" title="展开子源侧栏" @click="collapsed = false">»</button>
  </aside>

  <!-- 全局对比选择器（B4）：默认列本站其他子源，输入即全局搜索（含跨站） -->
  <div v-if="cmp.show" class="ssw-cmp-pop" @click.stop>
    <div class="ssw-cmp-title">选择对比对象（与当前子源并排）</div>
    <input v-model="cmp.kw" class="ssw-search" placeholder="搜索全部网站的子源" autofocus @input="onCompareKwInput" />
    <div class="ssw-cmp-list">
      <div v-if="cmp.loading" class="ssw-empty">搜索中…</div>
      <template v-else>
        <button v-for="s in cmp.results" :key="s.sourceId" type="button" class="ssw-cmp-item" @click="pickCompare(s)">
          <span class="ssw-dot" :class="{ err: isErr(s) }" />
          <span class="ssw-cmp-name">{{ s.name }}</span>
          <span class="ssw-cmp-id">{{ s.sourceId }}</span>
        </button>
        <div v-if="!cmp.results.length" class="ssw-empty">没有匹配的子源</div>
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
      <div class="ssw-add-title">添加子源</div>

      <div class="ssw-kind-seg" data-testid="source-kind-seg">
        <button type="button" :class="{ active: addDlg.kind === 'normal' }" @click="switchKind('normal')">
          普通子源<small>手工填名称 + URL</small>
        </button>
        <button type="button" :class="{ active: addDlg.kind === 'param' }" data-testid="source-kind-param" @click="switchKind('param')">
          参数子源<small>URL 模板 + 参数，按规律生成</small>
        </button>
      </div>

      <template v-if="addDlg.kind === 'normal'">
        <input v-model="addDlg.name" class="ssw-add-input" placeholder="子源名称，必填" />
        <input v-model="addDlg.url" class="ssw-add-input" placeholder="子源 URL，选填" />
        <select v-model="addDlg.templateMode" class="ssw-add-input" data-testid="source-template-mode" @change="onTemplateModeChange">
          <option v-if="defaultTemplate" value="default">默认：本网站第一个子源（{{ defaultTemplate.name }}）</option>
          <option value="search">搜索并选择全部子源</option>
          <option value="blank">空白模板</option>
        </select>
        <div v-if="addDlg.templateMode === 'search'" class="ssw-template-combobox" @click.stop>
          <input
            v-model="templateSearch.keyword"
            class="ssw-add-input"
            data-testid="source-template-search"
            placeholder="搜索并选择全部子源（名称或 ID）"
            @focus="templateSearch.open = !!templateSearch.keyword.trim()"
            @input="searchTemplateSources"
          />
          <div v-if="templateSearch.open" class="ssw-template-options">
            <span v-if="templateSearch.loading" class="ssw-template-empty">搜索子源中…</span>
            <span v-else-if="!templateSearch.results.length" class="ssw-template-empty">未找到匹配子源</span>
            <button
              v-for="source in templateSearch.results"
              v-else
              :key="source.sourceId"
              type="button"
              data-testid="source-template-option"
              @click="selectTemplateSource(source)"
            >
              <span>{{ source.name }}</span>
              <small>{{ source.sourceId }}</small>
            </button>
          </div>
        </div>
        <div class="ssw-add-hint">
          {{ selectedTemplate ? `将复制「${selectedTemplate.name}」的流程节点、相关配置和表结构，不复制数据与运行记录。` : '仅创建名称和 URL，流程从空白画布开始。' }}
        </div>
      </template>

      <template v-else>
        <input v-model="addDlg.name" class="ssw-add-input" placeholder="子源名称，必填" />
        <ParamSourceEditor ref="paramEditorRef" v-model="paramSrc" />
      </template>

      <div class="ssw-add-actions">
        <button class="rc-btn" type="button" @click="closeAdd">取消</button>
        <button class="rc-btn primary" type="button" data-testid="add-source-submit" @click="submitAdd">添加并进入编排</button>
      </div>
    </div>
  </div>

  <!-- 批量导入子源弹窗（0711 R12：从采集资产页迁入，siteId 已定，无目标网站选择） -->
  <div v-if="importDlg.show" class="ssw-add-backdrop" @click.self="closeImport">
    <div class="ssw-add-card" @click.stop>
      <div class="ssw-add-title">批量导入子源</div>
      <textarea
        v-model="importDlg.lines"
        class="ssw-import-textarea"
        rows="6"
        placeholder="一行一条，格式：子源名称;URL（URL 可省略）&#10;波兰语公告;https://example.com/notice?lang=pl&#10;瑞典语公告;https://example.com/notice?lang=sv"
      />
      <div class="ssw-add-hint">导入的子源均从空白流程开始，空行跳过</div>
      <div class="ssw-add-actions">
        <button class="rc-btn" type="button" @click="closeImport">取消</button>
        <button class="rc-btn primary" type="button" @click="submitImport">导入</button>
      </div>
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
.ssw-row-main {
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
.ssw-row:hover .ssw-row-main { color: var(--rc-primary-ink); }
.ssw-row.active .ssw-row-main { color: #fff; font-weight: 700; }
.ssw-row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-kind-tag { flex: none; font-size: 9px; font-weight: 700; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border: 1px solid #bfdbfe; border-radius: 3px; padding: 0 4px; line-height: 14px; }
.ssw-row.active .ssw-kind-tag { color: #fff; background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); }
.ssw-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
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

.ssw-add-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); }
.ssw-add-card { width: min(340px, calc(100vw - 48px)); max-height: calc(100vh - 60px); overflow-y: auto; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; padding: 16px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.ssw-add-title { font-size: 13px; font-weight: 800; color: var(--rc-text); margin-bottom: 10px; }
.ssw-add-input { box-sizing: border-box; width: 100%; height: 32px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 0 9px; outline: none; margin-bottom: 8px; }
.ssw-add-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-template-combobox { position: relative; }
.ssw-template-options { position: absolute; z-index: 2; top: 32px; right: 0; left: 0; max-height: 160px; overflow: auto; border: 1px solid #bfdbfe; border-radius: 7px; background: #fff; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14); }
.ssw-template-options button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; border: 0; background: #fff; color: var(--rc-text); padding: 8px 9px; font-size: 12px; text-align: left; cursor: pointer; }
.ssw-template-options button:hover { background: #eff6ff; }
.ssw-template-options small { color: var(--rc-muted); font-size: 11px; }
.ssw-template-empty { display: block; padding: 8px 9px; color: var(--rc-muted); font-size: 12px; }
.ssw-add-inherit { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--rc-text); cursor: pointer; margin: 2px 0 4px; }
.ssw-add-hint { font-size: 11px; color: var(--rc-muted); line-height: 1.6; margin-bottom: 6px; }
.ssw-add-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
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
.ssw-add-card.wide { width: min(640px, calc(100vw - 48px)); transition: width 0.18s ease; }
.ssw-kind-seg { display: flex; gap: 6px; margin-bottom: 10px; }
.ssw-kind-seg button { flex: 1; height: 38px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.ssw-kind-seg button.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); box-shadow: inset 0 0 0 1px var(--rc-primary); }
.ssw-kind-seg button small { display: block; font-size: 10px; font-weight: 400; color: var(--rc-muted); margin-top: 1px; }
</style>
