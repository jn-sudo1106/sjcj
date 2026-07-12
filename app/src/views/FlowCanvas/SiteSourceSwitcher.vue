<script setup lang="ts">
// 子源侧栏（0710 会议 B1，重构自 0707 Phase4 的横排 pill 切换器）：
// 页面级左侧固定栏，位于视图层之上——选中的编排对象（网站/子源）是页面级状态，流程/数据/任务视图共用。
// 结构：网站置顶项 → 搜索框 → 子源滚动列表（异常红点 + 行内 ⇔ 对比）→ 底部「＋添加子源 / ⇔ 对比」。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type Site, type Source } from '../../api'

const props = defineProps<{ siteId: string; activeKey: string }>() // activeKey：'site' 或某个子源 sourceId
const emit = defineEmits<{ pick: [target: 'site' | Source]; added: [Source]; compare: [rightId: string] }>()

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
// 行内 ⇔（0710 会议 B4）：与当前子源对比；停在网站模板上时没有"当前子源"，对比入口不可用
const canCompare = computed(() => props.activeKey !== 'site' && !!props.activeKey)

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
}
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))

// ---- ＋添加子源（0710 会议 B5：同步网站信息改为显式开关，默认开） ----
const addDlg = reactive({ show: false, name: '', url: '', inherit: true })
function openAdd(ev: MouseEvent) {
  ev.stopPropagation()
  addDlg.show = true
  addDlg.name = ''
  addDlg.url = ''
  addDlg.inherit = true
}
function closeAdd() {
  addDlg.show = false
}
async function submitAdd() {
  if (!addDlg.name.trim()) return
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  const res = await siteApi.sourceAdd(
    props.siteId,
    {
      sourceId, name: addDlg.name.trim(), url: addDlg.url.trim(), configId: '', mainTable: '', owner: site.value?.owner || 'admin', state: 'C',
    },
    addDlg.inherit,
  )
  if (!res.ok) return
  // toast 跟随开关（0710 会议 B5）：让"同步了没有"结果可感知
  ElMessage.success(
    addDlg.inherit
      ? `已添加子源「${addDlg.name.trim()}」，已同步网站统一流程与默认设置`
      : `已添加子源「${addDlg.name.trim()}」（未同步网站信息），流程为空白，请先编排`,
  )
  closeAdd()
  await load()
  const added = children.value.find((c) => c.sourceId === (res.sourceId || sourceId))
  if (added) emit('added', added)
}

function pickSource(s: Source) {
  emit('pick', s)
}
function pickSite() {
  emit('pick', 'site')
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
        <button class="ssw-site" :class="{ active: activeKey === 'site' }" type="button" title="网站统一流程模板" @click="pickSite">
          <span class="ssw-site-ico">🌐</span>
          <span class="ssw-site-name">{{ site?.name || '网站·统一流程' }}</span>
        </button>
        <button class="ssw-collapse" type="button" title="收起侧栏" @click="collapsed = true">«</button>
      </div>
      <input v-model="kw" class="ssw-search" placeholder="搜索子源" />
      <div class="ssw-list">
        <div v-for="c in filtered" :key="c.sourceId" class="ssw-row" :class="{ active: activeKey === c.sourceId }">
          <button class="ssw-row-main" type="button" :title="`${c.name} · ${c.sourceId}`" @click="pickSource(c)">
            <span class="ssw-dot" :class="{ err: isErr(c), muted: c.disabled }" />
            <span class="ssw-row-name">{{ c.name }}</span>
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

  <div v-if="addDlg.show" class="ssw-add-backdrop" @click.self="closeAdd">
    <div class="ssw-add-card" @click.stop>
      <div class="ssw-add-title">添加子源</div>
      <input v-model="addDlg.name" class="ssw-add-input" placeholder="子源名称，必填" />
      <input v-model="addDlg.url" class="ssw-add-input" placeholder="子源 URL，选填" />
      <label class="ssw-add-inherit">
        <input v-model="addDlg.inherit" type="checkbox" />
        <span>同步网站信息</span>
      </label>
      <div class="ssw-add-hint">
        {{ addDlg.inherit
          ? '自动套用网站统一流程和网站默认设置（分类 / 标签 / 代理 / 选用配置 / 登录 / 定时），创建后可在子源上单独调整。'
          : '仅创建名称和 URL，流程从空白画布开始，网站默认设置不套用。' }}
      </div>
      <div class="ssw-add-actions">
        <button class="rc-btn" type="button" @click="closeAdd">取消</button>
        <button class="rc-btn primary" type="button" @click="submitAdd">添加并进入编排</button>
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
      <div class="ssw-add-hint">导入的子源自动继承该网站统一流程，空行跳过</div>
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
.ssw-site:hover { border-color: #bfdbfe; color: var(--rc-primary-ink); }
.ssw-site.active { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
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
.ssw-row:hover .ssw-row-main { color: var(--rc-primary-ink); }
.ssw-row.active .ssw-row-main { color: #fff; font-weight: 700; }
.ssw-row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

.ssw-add-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); }
.ssw-add-card { width: min(340px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; padding: 16px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.ssw-add-title { font-size: 13px; font-weight: 800; color: var(--rc-text); margin-bottom: 10px; }
.ssw-add-input { width: 100%; height: 32px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 0 9px; outline: none; margin-bottom: 8px; }
.ssw-add-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
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
</style>
