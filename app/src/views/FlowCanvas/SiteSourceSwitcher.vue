<script setup lang="ts">
// 编排对象切换器（0707 优化·Phase4）：网站统一流程模板 + 子源 pill 列表，默认停在网站，可切子源；
// 子源可能很多——超出的收进「+N」浮层（锚定 + 搜索，手法同 SiteCardGrid 的「+N」）。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { siteApi, type Site, type Source } from '../../api'

const props = defineProps<{ siteId: string; activeKey: string }>() // activeKey：'site' 或某个子源 sourceId
const emit = defineEmits<{ pick: [target: 'site' | Source]; added: [Source] }>()

const site = ref<Site | null>(null)
const children = ref<Source[]>([])
async function load() {
  ;[site.value, children.value] = await Promise.all([siteApi.siteDetail(props.siteId), siteApi.siteSources(props.siteId)])
}
onMounted(load)
watch(() => props.siteId, load)
defineExpose({ reload: load })

const PILL_LIMIT = 5
const visiblePills = computed(() => children.value.slice(0, PILL_LIMIT))
const overflowPills = computed(() => children.value.slice(PILL_LIMIT))
function isErr(s: Source): boolean {
  return !s.disabled && s.state === 'E'
}

// 「+N」溢出浮层
const overflow = reactive({ show: false, x: 0, y: 0, kw: '' })
function openOverflow(ev: MouseEvent) {
  overflow.show = true
  overflow.x = Math.min(ev.clientX, window.innerWidth - 240)
  overflow.y = Math.min(ev.clientY, window.innerHeight - 320)
  overflow.kw = ''
}
function closeOverflow() {
  overflow.show = false
}
const overflowFiltered = computed(() => {
  const kw = overflow.kw.trim().toLowerCase()
  return kw ? overflowPills.value.filter((s) => s.name.toLowerCase().includes(kw)) : overflowPills.value
})
function pickSource(s: Source) {
  closeOverflow()
  emit('pick', s)
}
function pickSite() {
  emit('pick', 'site')
}
function onWindowClick() {
  if (overflow.show) closeOverflow()
}
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))

// ＋添加子源：默认继承网站统一流程（由 mock 的 site/addSource 内部完成）
const addDlg = reactive({ show: false, name: '', url: '' })
function openAdd(ev: MouseEvent) {
  ev.stopPropagation()
  addDlg.show = true
  addDlg.name = ''
  addDlg.url = ''
}
function closeAdd() {
  addDlg.show = false
}
async function submitAdd() {
  if (!addDlg.name.trim()) return
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  const res = await siteApi.sourceAdd(props.siteId, {
    sourceId, name: addDlg.name.trim(), url: addDlg.url.trim(), configId: '', mainTable: '', owner: site.value?.owner || 'admin', state: 'C',
  })
  if (!res.ok) return
  closeAdd()
  await load()
  const added = children.value.find((c) => c.sourceId === (res.sourceId || sourceId))
  if (added) emit('added', added)
}
</script>

<template>
  <div class="ssw-bar">
    <button class="ssw-pill site" :class="{ active: activeKey === 'site' }" type="button" @click="pickSite">
      <span class="ssw-pill-ico">🌐</span>{{ site?.name || '网站·统一流程' }}
    </button>
    <button
      v-for="c in visiblePills"
      :key="c.sourceId"
      class="ssw-pill"
      :class="{ active: activeKey === c.sourceId, err: isErr(c) }"
      type="button"
      :title="c.name"
      @click="pickSource(c)"
    >{{ c.name }}</button>
    <button v-if="overflowPills.length" class="ssw-pill more" type="button" @click.stop="openOverflow($event)">+{{ overflowPills.length }}</button>
    <button class="ssw-add" type="button" title="添加子源，默认继承网站统一流程" @click="openAdd">＋ 添加子源</button>
  </div>

  <div v-if="overflow.show" class="ssw-overflow" :style="{ left: overflow.x + 'px', top: overflow.y + 'px' }" @click.stop>
    <input v-model="overflow.kw" class="ssw-overflow-search" placeholder="搜索子源" autofocus />
    <div class="ssw-overflow-list">
      <button
        v-for="c in overflowFiltered"
        :key="c.sourceId"
        type="button"
        class="ssw-overflow-item"
        :class="{ active: activeKey === c.sourceId }"
        @click="pickSource(c)"
      >
        <span class="ssw-overflow-dot" :class="{ err: isErr(c) }" />{{ c.name }}
      </button>
      <div v-if="!overflowFiltered.length" class="ssw-overflow-empty">没有匹配的子源</div>
    </div>
  </div>

  <div v-if="addDlg.show" class="ssw-add-backdrop" @click.self="closeAdd">
    <div class="ssw-add-card" @click.stop>
      <div class="ssw-add-title">添加子源</div>
      <input v-model="addDlg.name" class="ssw-add-input" placeholder="子源名称，必填" />
      <input v-model="addDlg.url" class="ssw-add-input" placeholder="子源 URL，选填" />
      <div class="ssw-add-actions">
        <button class="rc-btn" type="button" @click="closeAdd">取消</button>
        <button class="rc-btn primary" type="button" @click="submitAdd">添加并进入编排</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ssw-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fbfdff; }
.ssw-pill { height: 26px; padding: 0 11px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ssw-pill:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-pill.active { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; font-weight: 700; }
.ssw-pill.err:not(.active) { border-color: #fecaca; color: var(--rc-error); }
.ssw-pill.site { font-weight: 700; }
.ssw-pill-ico { margin-right: 4px; }
.ssw-pill.more { color: var(--rc-muted); font-weight: 700; }
.ssw-add { height: 26px; padding: 0 11px; border: 1px dashed var(--rc-border); border-radius: 999px; background: transparent; color: var(--rc-muted); font-size: 11px; cursor: pointer; margin-left: auto; }
.ssw-add:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); }

.ssw-overflow { position: fixed; z-index: 90; width: 220px; max-height: 300px; display: flex; flex-direction: column; background: #fff; border: 1px solid var(--rc-border); border-radius: 10px; box-shadow: 0 20px 48px -18px rgba(15, 23, 42, 0.4); overflow: hidden; }
.ssw-overflow-search { flex: none; height: 30px; margin: 8px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 7px; font-size: 12px; outline: none; background: #f8fafc; }
.ssw-overflow-search:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-overflow-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; }
.ssw-overflow-item { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; border-radius: 7px; padding: 6px 8px; font-size: 12px; color: var(--rc-text-2); cursor: pointer; text-align: left; }
.ssw-overflow-item:hover, .ssw-overflow-item.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-overflow-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
.ssw-overflow-dot.err { background: var(--rc-error); }
.ssw-overflow-empty { padding: 16px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }

.ssw-add-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); }
.ssw-add-card { width: min(340px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; padding: 16px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.ssw-add-title { font-size: 13px; font-weight: 800; color: var(--rc-text); margin-bottom: 10px; }
.ssw-add-input { width: 100%; height: 32px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 0 9px; outline: none; margin-bottom: 8px; }
.ssw-add-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-add-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
