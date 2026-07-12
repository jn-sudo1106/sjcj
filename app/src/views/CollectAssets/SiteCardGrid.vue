<script setup lang="ts">
// 采集资产卡片视图（0707 优化·Phase3；样式对齐 设计稿/原型设计/采集中心卡片样式.png）：
// 一张卡 = 一个采集网站，渐变图标瓦片 + 子源 chips + 标签 + 底部统计。
// 子源可能很多（0707 会后澄清）：chips 只显示前几个，其余收进「+N」浮层，浮层内可搜索。
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { siteApi, type Site, type Source } from '../../api'
import { siteIcon } from './siteVisual'

const props = defineProps<{ sites: Site[] }>()
const router = useRouter()

const CHIP_LIMIT = 4
const childrenCache = reactive<Record<string, Source[]>>({})

async function ensureChildren(siteId: string) {
  if (childrenCache[siteId]) return
  childrenCache[siteId] = await siteApi.siteSources(siteId)
}
onMounted(() => props.sites.forEach((s) => ensureChildren(s.siteId)))
watch(() => props.sites, (list) => list.forEach((s) => ensureChildren(s.siteId)))

// 页签网站化（0710 会议 B3）：入口只推路由，页签注册统一收口在画布加载（index.vue）
function openSource(s: Source) {
  router.push({ path: '/canvas', query: { sourceId: s.sourceId } })
}
// 卡片主体点击 → 进入网站统一流程模板（0707 优化·Phase4）
function openSite(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId } })
}
// 卡片底部直达入口（0710 会议 A4）：数据量→数据视图，任务→任务视图（任务视图只挂网站层）
function openSiteData(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })
}
function openSiteTask(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'task' } })
}
function isErr(s: Source): boolean {
  return !s.disabled && s.state === 'E'
}

// 「+N」浮层：锚定弹出 + 搜索（子源可能几十个，一律"前几个 + 溢出收纳 + 搜索"）
const overflow = reactive<{ show: boolean; siteId: string; x: number; y: number; kw: string }>({
  show: false, siteId: '', x: 0, y: 0, kw: '',
})
function openOverflow(siteId: string, ev: MouseEvent) {
  overflow.show = true
  overflow.siteId = siteId
  overflow.x = Math.min(ev.clientX, window.innerWidth - 260)
  overflow.y = Math.min(ev.clientY, window.innerHeight - 340)
  overflow.kw = ''
}
function closeOverflow() {
  overflow.show = false
}
const overflowChildren = computed(() => {
  const list = childrenCache[overflow.siteId] ?? []
  const kw = overflow.kw.trim().toLowerCase()
  return kw ? list.filter((s) => s.name.toLowerCase().includes(kw) || s.sourceId.toLowerCase().includes(kw)) : list
})
function pickOverflow(s: Source) {
  closeOverflow()
  openSource(s)
}
function onWindowClick() {
  if (overflow.show) closeOverflow()
}
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))
</script>

<template>
  <div class="scg-grid">
    <div v-for="site in sites" :key="site.siteId" class="scg-card" title="进入网站统一流程" @click="openSite(site)">
      <span v-if="site.errorCount > 0" class="scg-dot" :title="`${site.errorCount} 个子源出错`" />
      <div class="scg-head">
        <span class="scg-icon"><el-icon :size="20"><component :is="siteIcon(site)" /></el-icon></span>
        <div class="scg-title">
          <div class="scg-name">{{ site.name }}</div>
          <div class="scg-cat">{{ site.categoryPath?.replace(/^\//, '').replaceAll('/', ' / ') || site.category }}</div>
        </div>
      </div>

      <div class="scg-chips">
        <button
          v-for="c in (childrenCache[site.siteId] ?? []).slice(0, CHIP_LIMIT)"
          :key="c.sourceId"
          type="button"
          class="scg-chip"
          :class="{ err: isErr(c) }"
          :title="c.name"
          @click.stop="openSource(c)"
        >{{ c.name }}</button>
        <button
          v-if="(childrenCache[site.siteId]?.length ?? 0) > CHIP_LIMIT"
          type="button"
          class="scg-chip more"
          @click.stop="openOverflow(site.siteId, $event)"
        >+{{ (childrenCache[site.siteId]?.length ?? 0) - CHIP_LIMIT }}</button>
        <span v-if="childrenCache[site.siteId] && !childrenCache[site.siteId].length" class="scg-empty">暂无子源</span>
      </div>

      <div v-if="site.tags?.length" class="scg-tags">
        <span v-for="t in site.tags" :key="t" class="scg-tag">{{ t }}</span>
      </div>

      <!-- 底部行（0710 会议 A4）：数据量点进数据视图 + 任务视图直达入口（会议：任务视图只挂网站层） -->
      <div class="scg-foot">
        <span class="scg-foot-count">{{ site.sourceCount }} 个源</span>
        <span class="scg-foot-sep" />
        <button class="scg-foot-link" type="button" title="查看该网站数据视图" @click.stop="openSiteData(site)">
          数据 {{ (site.dataCount ?? 0).toLocaleString() }} 条
        </button>
        <span class="scg-foot-sep" />
        <span v-if="site.updatedAt" class="scg-foot-date" :title="`编辑于 ${site.updatedAt}`">编辑于 {{ site.updatedAt.slice(0, 10) }}</span>
        <button class="scg-foot-task" type="button" title="查看该网站任务视图" @click.stop="openSiteTask(site)">任务</button>
      </div>
    </div>

    <div v-if="!sites.length" class="scg-empty-state">没有匹配的网站</div>
  </div>

  <div v-if="overflow.show" class="scg-overflow" :style="{ left: overflow.x + 'px', top: overflow.y + 'px' }" @click.stop>
    <input v-model="overflow.kw" class="scg-overflow-search" placeholder="搜索子源" autofocus />
    <div class="scg-overflow-list">
      <button
        v-for="c in overflowChildren"
        :key="c.sourceId"
        type="button"
        class="scg-overflow-item"
        @click="pickOverflow(c)"
      >
        <span class="scg-overflow-dot" :class="{ err: isErr(c) }" />
        {{ c.name }}
      </button>
      <div v-if="!overflowChildren.length" class="scg-overflow-empty">没有匹配的子源</div>
    </div>
  </div>
</template>

<style scoped>
.scg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.scg-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rc-border);
  border-radius: 12px;
  background: #fff;
  padding: 16px 16px 12px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.scg-card:hover { border-color: #bfdbfe; box-shadow: 0 10px 26px -16px rgba(37, 99, 235, 0.45); transform: translateY(-1px); }
.scg-dot { position: absolute; top: 14px; right: 14px; width: 8px; height: 8px; border-radius: 50%; background: var(--rc-error); }

.scg-head { display: flex; align-items: center; gap: 11px; }
.scg-icon {
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 5px 12px -6px rgba(37, 99, 235, 0.55);
}
.scg-title { flex: 1; min-width: 0; }
.scg-name { font-size: 14px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scg-cat { font-size: 11px; color: var(--rc-faint); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.scg-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
.scg-chip {
  max-width: 140px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #fff;
  color: var(--rc-text-2);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.scg-chip:hover { border-color: #93c5fd; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.scg-chip.err { border-color: #fecaca; background: #fef2f2; color: var(--rc-error); }
.scg-chip.more { background: #f8fafc; color: var(--rc-muted); font-weight: 700; }
.scg-empty { font-size: 11px; color: var(--rc-faint); }

.scg-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.scg-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #b45309; background: #fef3c7; border-radius: 5px; padding: 2px 7px; }
.scg-tag::before { content: ''; width: 6px; height: 6px; border-radius: 2px; background: #f59e0b; }

/* 底部行钉在卡片底边（margin-top:auto），各卡等高对齐；所有项禁止换行，日期可缩略 */
.scg-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--rc-border-soft); font-size: 11px; color: var(--rc-faint); min-width: 0; }
.scg-foot-count { flex: none; color: var(--rc-muted); font-weight: 600; white-space: nowrap; }
.scg-foot-sep { flex: none; width: 1px; height: 12px; background: var(--rc-border-soft); }
.scg-foot-link { flex: none; padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font-size: 11px; cursor: pointer; white-space: nowrap; }
.scg-foot-link:hover { text-decoration: underline; }
.scg-foot-date { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scg-foot-task {
  flex: none;
  margin-left: auto;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-text-2);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.scg-foot-task:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.scg-empty-state { grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--rc-faint); font-size: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; }

.scg-overflow { position: fixed; z-index: 90; width: 240px; max-height: 320px; display: flex; flex-direction: column; background: #fff; border: 1px solid var(--rc-border); border-radius: 10px; box-shadow: 0 20px 48px -18px rgba(15, 23, 42, 0.4); overflow: hidden; }
.scg-overflow-search { flex: none; height: 32px; margin: 8px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 7px; font-size: 12px; outline: none; background: #f8fafc; }
.scg-overflow-search:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px #dbeafe; }
.scg-overflow-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; }
.scg-overflow-item { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; border-radius: 7px; padding: 6px 8px; font-size: 12px; color: var(--rc-text-2); cursor: pointer; text-align: left; }
.scg-overflow-item:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.scg-overflow-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
.scg-overflow-dot.err { background: var(--rc-error); }
.scg-overflow-empty { padding: 16px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }
</style>
