<script setup lang="ts">
// 采集资产卡片视图（0707 优化·Phase3；样式对齐 设计稿/原型设计/采集中心卡片样式.png）：
// 一张卡 = 一个采集网站，渐变图标瓦片 + 源 chips + 标签 + 底部统计。
// 源可能很多（0707 会后澄清）：chips 只显示前几个，其余收进「+N」浮层，浮层内可搜索。
import { onMounted, onUnmounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { siteApi, sourceApi, type Site, type Source } from '../../api'
import { collectAllUnderQuery } from '@/views/FlowCanvas/result/useSourceLaunch'
import type { SiteCardSourceScope } from './siteCardQuery'
import { siteIcon, siteTone } from '@/utils/visual/siteVisual'

/** 瓦片配色 → 内联 style（全站统一，见 siteTone） */
function tileStyle() {
  const tone = siteTone()
  return { background: tone.bg, color: tone.fg, boxShadow: tone.shadow }
}
import { visibleIssueTags } from '@/utils/sourceMark'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { isFavoriteSite, toggleFavoriteSite } from '@/utils/siteFavorites'
import { recordSiteVisit } from '@/utils/siteRecents'
import { trackClick } from '@/utils/logEvents'

const props = withDefaults(defineProps<{
  sites: Site[]
  loading?: boolean
  /** 列表为空时的提示。收藏 / 最近打开 tab 一个都没有时要说清楚怎么才会有（0924-01） */
  emptyText?: string
  /** 目录/源筛选下的命中源，卡片外观与网站全量模式共用。 */
  sourceScope?: SiteCardSourceScope
}>(), {
  loading: false,
  emptyText: '没有匹配的网站',
})
// 编辑网站信息由父组件（SourceTab）统一挂 SiteEditorDialog —— 表格视图走的也是这个事件，
// 两个视图共用一份弹窗状态，不在卡片里再挂一个（0915-01）。
const emit = defineEmits<{ 'open-editor': [site: Site]; 'delete-site': [site: Site]; 'favorite-changed': [] }>()
const router = useRouter()

/**
 * 卡片上直接展示几个源。
 *
 * 5 而不是 4（2026-09-18）：chips 是两列网格，**5 个 + 那颗「+N」正好 6 格填满 3 行**。
 * 4 个的时候「+N」落单占半行、右边空着，用户原话"有点丑"。
 */
const CHIP_LIMIT = 5
const childrenCache = reactive<Record<string, Source[]>>({})
const childrenComplete = reactive<Record<string, boolean>>({})
const childrenLoading = reactive<Record<string, boolean>>({})
const overflowPage = reactive<Record<string, number>>({})
const overflowSources = reactive<Record<string, Source[]>>({})
const childrenErrors = reactive<Record<string, string>>({})
const aggregating = new Set<string>()

async function ensurePreview(site: Site) {
  if (childrenCache[site.siteId]) return
  const match = props.sourceScope?.matches[site.siteId]
  if (match) {
    childrenCache[site.siteId] = match.list
    childrenComplete[site.siteId] = match.total <= match.list.length
    return
  }
  try {
    childrenCache[site.siteId] = await siteApi.siteSourcePreview(site.siteId, CHIP_LIMIT)
  } catch {
    childrenCache[site.siteId] = []
    return
  }
  // 网站总源数没有超过预览上限时，这份预览就是完整列表，可继续沿用原有的前端数据量汇总。
  if (site.sourceCount <= CHIP_LIMIT) childrenComplete[site.siteId] = true
}
async function ensureAllChildren(siteId: string) {
  if (props.sourceScope?.serverPaged) {
    if (!overflowPage[siteId]) await loadMoreChildren(siteId)
    return
  }
  if (childrenComplete[siteId] || childrenLoading[siteId]) return
  childrenLoading[siteId] = true
  delete childrenErrors[siteId]
  try {
    childrenCache[siteId] = props.sourceScope
      ? await collectAllUnderQuery({ ...props.sourceScope.query, siteIds: siteId }, { fetchPage: sourceApi.sourcePaged, max: Infinity })
      : await siteApi.siteSources(siteId)
    childrenComplete[siteId] = true
  } catch (error) {
    childrenErrors[siteId] = `加载源失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    childrenLoading[siteId] = false
  }
}
async function loadMoreChildren(siteId: string) {
  if (childrenLoading[siteId] || childrenComplete[siteId]) return
  childrenLoading[siteId] = true
  delete childrenErrors[siteId]
  try {
    const page = (overflowPage[siteId] ?? 0) + 1
    const result = await sourceApi.sourcePaged({ ...props.sourceScope!.query, siteIds: siteId, page, size: 50, field: 'SOURCE_ID', sorted: -1, type: 'DESC' })
    if (result.total > 0 && !result.list.length) throw new Error('源分页不完整，请重试')
    const merged = new Map((overflowSources[siteId] ?? []).map(source => [source.sourceId, source]))
    result.list.forEach(source => merged.set(source.sourceId, source))
    overflowSources[siteId] = [...merged.values()]
    overflowPage[siteId] = page
    childrenComplete[siteId] = overflowSources[siteId].length >= result.total
  } catch (error) {
    childrenErrors[siteId] = `加载源失败：${error instanceof Error ? error.message : String(error)}`
  } finally { childrenLoading[siteId] = false }
}
async function onFavorite(siteId: string) {
  await toggleFavoriteSite(siteId)
  emit('favorite-changed')
}
/**
 * 列表接口的站级 dataTotal 能不能直接用。后端把源 dataCnt=null 也汇成 0，分不清"0 条"和
 * "没统计"（手动导入的数据不经抓取任务、不回写 dataCnt——站 124 有 43 行却是 0）。
 * 所以有源的站给 0 时不采信，回退到按源汇总。2026-09-29 实测 116 站里 28 个是 0、共 159 个源，回退代价很小。
 */
function trustedSiteDataCount(site: Site): number | undefined {
  if (!props.sourceScope?.serverPaged && site.dataCount === 0 && site.sourceCount > 0) return undefined
  return site.dataCount
}
async function ensureDataCount(site: Site) {
  if (props.sourceScope) return
  if (trustedSiteDataCount(site) != null || childrenComplete[site.siteId] || aggregating.has(site.siteId)) return
  aggregating.add(site.siteId)
  try {
    // 站级 dataTotal 缺失或不可信（见 trustedSiteDataCount）时，由源行 dataCnt 汇总。
    // 这里逐站串行调用（由 queueDataCounts 控制），避免原先 6 个网站同时下载完整源列表
    // 把后端打满；卡片和 4 个 chip 预览已经先渲染，不阻塞首屏。
    childrenCache[site.siteId] = await siteApi.siteSources(site.siteId)
    childrenComplete[site.siteId] = true
  } catch {
    // 单站统计失败不影响其他卡片，后续 props 刷新仍可重新尝试。
  } finally {
    aggregating.delete(site.siteId)
  }
}
let queueVersion = 0
async function queueDataCounts(list: Site[]) {
  const version = ++queueVersion
  // 小站先完成，页面上的数据量会更快逐步出现；大站最后单独处理。
  // 进队条件看 childrenComplete 而不是 sourceCount > CHIP_LIMIT：小站的预览失败
  // （catch 置了空列表但没置 complete）同样缺数据量、chips 也会误显「暂无源」，
  // 必须进队列补全；预览成功的小站在 ensurePreview 里已置 complete，不会重复进队。
  const pending = [...list]
    .filter((site) => trustedSiteDataCount(site) == null && !childrenComplete[site.siteId])
    .sort((a, b) => a.sourceCount - b.sourceCount)
  for (const site of pending) {
    if (version !== queueVersion) return
    await ensureDataCount(site)
    // 稍微出让微任务，避免连续占用浏览器网络通道
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
/**
 * 首屏预览的并发上限：保守设为 4，留出至少 2 个 TCP 连接给统计和交互操作
 */
const PREVIEW_CONCURRENCY = 4

async function ensureCards(list: Site[]) {
  // 所有卡片的小预览先返回，再启动逐站完整汇总，避免大响应与首屏预览争抢连接。
  for (let i = 0; i < list.length; i += PREVIEW_CONCURRENCY) {
    await Promise.all(list.slice(i, i + PREVIEW_CONCURRENCY).map(ensurePreview))
  }
  if (!props.sourceScope) await queueDataCounts(list)
}
onMounted(() => { void ensureCards(props.sites) })
watch(() => props.sites, (list) => { void ensureCards(list) })

// 页签网站化（0710 会议 B3）：入口只推路由，页签注册统一收口在画布加载（index.vue）
function openSource(s: Source) {
  // 点源 chip 进去也算打开了这个网站（0917-17）
  if (s.siteId) recordSiteVisit(s.siteId, s.siteName)
  // 源本身另记一条 CLICK（与网站 ENTER 是两个口径，不能只打一条）
  trackClick('SOURCE', s.sourceId, s.name, {
    eventCode: 'source_open',
    eventName: '打开源',
    firstModule: '采集资产',
    pageName: '网站卡片',
  })
  router.push({ path: '/canvas', query: { ...(s.siteId ? { siteId: s.siteId } : {}), sourceId: s.sourceId, view: 'overview', returnTo: router.currentRoute.value.fullPath } })
}
// 卡片主体点击 → 进入网站统一流程模板（0707 优化·Phase4）
function openSite(site: Site) {
  recordSiteVisit(site.siteId, site.name)
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'source', returnTo: router.currentRoute.value.fullPath } })
}
// 卡片底部直达入口：数据量进入当前网站首个源的数据视图。
function openSiteData(site: Site) {
  recordSiteVisit(site.siteId, site.name)
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data', returnTo: router.currentRoute.value.fullPath } })
}
/** 卡片上显示前 2 个标签 + 「+N」（0915-14），与源卡片同口径 */
function visibleTagsOf(site: Site) {
  return visibleIssueTags(site.tags)
}
function isErr(s: Source): boolean {
  return !s.disabled && s.state === 'E'
}

function siteDataCount(site: Site): number | undefined {
  // 列表接口给出的站级汇总优先，避免预览/完整源列表的加载时机让数字跳变。
  const trusted = trustedSiteDataCount(site)
  if (props.sourceScope) return trusted
  if (trusted != null) return trusted
  const children = childrenCache[site.siteId]
  if (!childrenComplete[site.siteId] || !children) return undefined
  // dataCnt 由抓取任务回写；手动导入的数据不经任务，源上是 null。全站都没有统计时显示「—」，
  // 当成 0 条会让人以为表里没数据（站 124：43 行数据、卡片却是「0 条」）。
  const counted = children.filter((source) => source.dataCount != null)
  if (children.length && !counted.length) return undefined
  return counted.reduce((total, source) => total + (source.dataCount ?? 0), 0)
}

function formatSiteDataCount(site: Site): string {
  const count = siteDataCount(site)
  return count == null ? '数据 —' : `数据 ${count.toLocaleString()} 条`
}
function visibleSourceCount(site: Site): number {
  return props.sourceScope?.matches[site.siteId]?.total ?? site.sourceCount
}

const overflowKw = reactive<Record<string, string>>({})

function filteredChildren(siteId: string) {
  const list = overflowSources[siteId] ?? childrenCache[siteId] ?? []
  const kw = (overflowKw[siteId] || '').trim().toLowerCase()
  return kw ? list.filter((s) => s.name.toLowerCase().includes(kw) || s.sourceId.toLowerCase().includes(kw)) : list
}

function pickOverflow(s: Source) {
  openSource(s)
}

// ---- 卡片操作菜单（0915-01）----
// 入口有两个、菜单只有一份：hover 浮出的「⋯」与右键卡片。右键是源侧栏既有的模式
// （SiteSourceSwitcher 的网站名/源行都是右键出菜单），「⋯」补可发现性——纯右键没人想得到去试，
// 触控设备也没有右键。
//
// 菜单挂在 .scg-grid 下而**不是卡片内部**：卡片 hover 时有 `transform: translateY(-2px)`，
// 而 transform 会让内部 position:fixed 的元素改以该卡片为包含块定位，菜单会飘到错误的位置。
const menu = reactive<{ show: boolean; x: number; y: number; site: Site | null }>({ show: false, x: 0, y: 0, site: null })
const MENU_W = 132
const MENU_H = 88

function openMenu(event: MouseEvent, site: Site) {
  const el = event.currentTarget as HTMLElement | null
  // 点「⋯」时贴着按钮弹出，右键时落在鼠标位置
  const fromButton = !!el?.classList.contains('scg-more')
  const rect = el?.getBoundingClientRect()
  const x = fromButton && rect ? rect.left : event.clientX
  const y = fromButton && rect ? rect.bottom + 4 : event.clientY
  // 夹在视口内，避免贴边的卡片把菜单顶出屏幕
  menu.x = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8))
  menu.y = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8))
  menu.site = site
  menu.show = true
}
function closeMenu() {
  menu.show = false
  menu.site = null
}
function onEditSite() {
  const site = menu.site
  closeMenu()
  if (site) emit('open-editor', site)
}
function onDeleteSite() {
  const site = menu.site
  closeMenu()
  if (site) emit('delete-site', site)
}
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}
onMounted(() => {
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('scroll', closeMenu, true)
})
onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  document.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('scroll', closeMenu, true)
})
</script>

<template>
  <div class="scg-grid">
    <div
      v-for="site in sites"
      :key="site.siteId"
      class="scg-card"
      title="进入网站源视图"
      @click="openSite(site)"
      @contextmenu.prevent.stop="openMenu($event, site)"
    >
      <span v-if="site.errorCount > 0" class="scg-dot" :title="`${site.errorCount} 个源出错`" />
      <!-- 右上角竖排：⋯ 在上、☆ 在下（2026-09-21 用户定：放左边看着别扭）。
           标题那行因此让出 24px 的竖带，见 .scg-title 的 padding-right。 -->
      <div class="scg-tools">
        <button
          class="scg-more"
          type="button"
          data-testid="site-card-more"
          title="更多操作"
          aria-label="更多操作"
          @click.stop="openMenu($event, site)"
        >⋯</button>
        <!-- 已收藏的**常显实心**：一眼看出哪些是自己标的；没收藏的跟 ⋯ 一样 hover 才出现 -->
        <button
          class="scg-fav"
          :class="{ on: isFavoriteSite(site.siteId) }"
          type="button"
          data-testid="site-card-fav"
          :title="isFavoriteSite(site.siteId) ? '取消收藏' : '收藏这个网站（收藏的排在最前）'"
          :aria-pressed="isFavoriteSite(site.siteId)"
          :aria-label="isFavoriteSite(site.siteId) ? '取消收藏' : '收藏'"
          @click.stop="onFavorite(site.siteId)"
        >
          <el-icon :size="13"><component :is="isFavoriteSite(site.siteId) ? StarFilled : Star" /></el-icon>
        </button>
      </div>
      <div class="scg-head">
        <span class="scg-icon" :style="tileStyle()">
          <el-icon :size="20"><component :is="siteIcon(site)" /></el-icon>
        </span>
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
        <el-popover
          v-if="visibleSourceCount(site) > (childrenCache[site.siteId]?.slice(0, CHIP_LIMIT).length ?? 0)"
          placement="bottom"
          trigger="click"
          width="240"
          :hide-after="0"
          @show="ensureAllChildren(site.siteId)"
        >
          <template #reference>
            <button type="button" class="scg-chip more" @click.stop>
              +{{ visibleSourceCount(site) - (childrenCache[site.siteId]?.slice(0, CHIP_LIMIT).length ?? 0) }}
            </button>
          </template>
          <div class="scg-popover-content">
            <input v-model="overflowKw[site.siteId]" class="scg-overflow-search"  :placeholder="sourceScope?.serverPaged ? '搜索已加载的源' : '搜索源'" />
            <div class="scg-overflow-list">
              <div v-if="childrenLoading[site.siteId]" class="scg-overflow-empty">正在加载源列表…</div>
              <div v-else-if="childrenErrors[site.siteId]" class="scg-overflow-empty" role="alert">{{ childrenErrors[site.siteId] }}<button type="button" @click.stop="sourceScope?.serverPaged ? loadMoreChildren(site.siteId) : ensureAllChildren(site.siteId)">重试</button></div>
              <button
                v-if="!sourceScope?.serverPaged && !childrenLoading[site.siteId] && !childrenErrors[site.siteId] && !overflowKw[site.siteId]"
                type="button"
                class="scg-overflow-item"
                @click="openSite(site)"
              >
                <span class="scg-overflow-dot all" />
                <div class="scg-overflow-text">
                  <div class="scg-overflow-name">全部</div>
                  <div class="scg-overflow-id">不根据源 ID 过滤</div>
                </div>
              </button>
              <button
                v-for="c in childrenLoading[site.siteId] || childrenErrors[site.siteId] ? [] : filteredChildren(site.siteId)"
                :key="c.sourceId"
                type="button"
                class="scg-overflow-item"
                @click="pickOverflow(c)"
              >
                <span class="scg-overflow-dot" :class="{ err: isErr(c) }" />
                <div class="scg-overflow-text">
                  <div class="scg-overflow-name">{{ c.name }}</div>
                  <div class="scg-overflow-id">{{ c.sourceId }}</div>
                </div>
              </button>
              <div v-if="!childrenLoading[site.siteId] && !childrenErrors[site.siteId] && !filteredChildren(site.siteId).length" class="scg-overflow-empty">没有匹配的源</div>
              <button v-if="sourceScope?.serverPaged && !childrenComplete[site.siteId] && !childrenLoading[site.siteId] && !childrenErrors[site.siteId]" class="scg-overflow-item" type="button" data-testid="site-sources-more" @click.stop="loadMoreChildren(site.siteId)">加载更多源</button>
            </div>
          </div>
        </el-popover>
        <span v-if="childrenCache[site.siteId] && !childrenCache[site.siteId].length" class="scg-empty">暂无源</span>
      </div>

      <!-- 0915-14：标签终于有数据了（后端 2026-09-16 给 cfg_site 加了 tags 列，在此之前这块恒为空）。
           只显示前两个 + 「+N」，与源卡片的 visibleIssueTags 同口径，标签多了不撑变形。 -->
      <div v-if="site.tags?.length" class="scg-tags" data-testid="site-card-tags">
        <span v-for="t in visibleTagsOf(site).shown" :key="t" class="scg-tag">{{ t }}</span>
        <span v-if="visibleTagsOf(site).extra" class="scg-tag more" :title="site.tags.join('、')">+{{ visibleTagsOf(site).extra }}</span>
      </div>

      <!-- 底部行：数据量点进数据视图。 -->
      <div class="scg-foot">
        <span class="scg-foot-count" :title="sourceScope ? '当前筛选命中源数 / 网站全部源数' : undefined"><template v-if="sourceScope">{{ visibleSourceCount(site) }} / </template>{{ site.sourceCount }} 个源</span>
        <span class="scg-foot-sep" />
        <button class="scg-foot-link" type="button" title="查看该网站数据视图" @click.stop="openSiteData(site)">
          {{ formatSiteDataCount(site) }}
        </button>
        <span class="scg-foot-sep" />
        <span v-if="site.updatedAt" class="scg-foot-date" :title="`编辑于 ${site.updatedAt}`">编辑于 {{ site.updatedAt.slice(0, 10) }}</span>
      </div>
    </div>

    <!-- 骨架屏：首屏加载时展示 8 张占位卡片，避免空态「没有匹配的网站」盖在转圈下的误导体验 -->
    <template v-if="loading && !sites.length">
      <div v-for="i in 8" :key="`sk-${i}`" class="scg-card scg-skeleton-card">
        <div class="scg-head">
          <div class="scg-skeleton-icon" />
          <div class="scg-skeleton-title">
            <div class="scg-skeleton-line title" />
            <div class="scg-skeleton-line cat" />
          </div>
        </div>
        <div class="scg-skeleton-chips">
          <div v-for="j in 4" :key="j" class="scg-skeleton-chip" />
        </div>
        <div class="scg-skeleton-foot">
          <div class="scg-skeleton-line foot" />
        </div>
      </div>
    </template>
    <div v-else-if="!sites.length" class="scg-empty-state">{{ emptyText }}</div>

    <!-- 编辑网站信息 + 删除网站（1014 按需求把删除加进右键菜单；删除是高危操作，父组件二次确认） -->
    <div
      v-if="menu.show"
      class="scg-card-menu"
      data-testid="site-card-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button type="button" data-testid="site-card-menu-edit" @click="onEditSite">编辑网站信息</button>
      <button type="button" class="scg-menu-danger" data-testid="site-card-menu-delete" @click="onDeleteSite">删除网站</button>
    </div>
  </div>


</template>

<style scoped>
.scg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.scg-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  min-width: 0;
  min-height: 148px;
  padding: 16px 16px 12px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,0.015);
  transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
}
.scg-card:hover { border-color: #bfdbfe; box-shadow: 0 8px 24px rgba(0,0,0,0.04); transform: translateY(-2px); }
.scg-dot { position: absolute; top: 14px; right: 14px; width: 8px; height: 8px; border-radius: 50%; background: var(--rc-error); transition: right 0.12s; }
/* 「⋯」占住右上角，出错红点在 hover 时让出位置（两者都在右上，不让位会叠在一起） */
.scg-card:hover .scg-dot { right: 34px; }
.scg-tools { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; flex-direction: column; gap: 2px; }
.scg-more {
  width: 22px; height: 22px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--rc-faint); font-size: 15px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity 0.12s, background 0.12s, color 0.12s, border-color 0.12s;
}
.scg-card:hover .scg-more, .scg-more:focus-visible { opacity: 1; }
.scg-more:hover { background: var(--rc-primary-bg); border-color: #93c5fd; color: var(--rc-primary-ink); }
.scg-fav {
  width: 22px; height: 22px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--rc-faint); line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity 0.12s, background 0.12s, color 0.12s, border-color 0.12s;
}
.scg-card:hover .scg-fav, .scg-fav:focus-visible { opacity: 1; }
/* 已收藏：常显，且不跟着 hover 变淡——这是这张卡片的状态，不是一个悬浮操作 */
.scg-fav.on { opacity: 1; color: #f59e0b; }
.scg-fav:hover { background: var(--rc-primary-bg); border-color: #93c5fd; color: var(--rc-primary-ink); }
.scg-fav.on:hover { color: #d97706; }
/* 视觉对齐源侧栏的右键菜单（.ssw-row-menu），两处是同一种交互 */
.scg-card-menu {
  position: fixed; z-index: 92; min-width: 112px; padding: 4px;
  background: #fff; border: 1px solid var(--rc-border); border-radius: 7px;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.38);
}
.scg-card-menu button {
  display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 5px;
  background: transparent; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer;
}
.scg-card-menu button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
/* 1014 删除网站：危险项红色，与「编辑」区分（对齐源侧栏 .ssw-row-menu 的删除项） */
.scg-card-menu button.scg-menu-danger { color: #dc2626; }
.scg-card-menu button.scg-menu-danger:hover { background: #fef2f2; color: #b91c1c; }

.scg-head { display: flex; align-items: center; gap: 11px; }
/* 平色块，不再是渐变 + 投影（2026-09-18）：30 张卡片各带一个投影堆在一起是视觉噪音，
   平色也跟工具栏、chips 那套风格一致。底色/前景色由 siteTone() 按网站名算，见 siteVisual.ts。 */
.scg-icon {
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 右上角那条竖带（⋯ / ☆）占 22px，标题不让位就会被压在底下 */
.scg-title { flex: 1; min-width: 0; padding-right: 24px; }
.scg-name { font-size: 14px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scg-cat { font-size: 11px; color: var(--rc-faint); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 固定两列（2026-09-18 用户提：「源默认一排两个，紧凑点」）。
   原来是 flex + wrap，chip 宽度随名字长短走——「证券日报网-金融机构…」这种长名字
   一个就占满一行，短的挤三个，一片参差。网格定死两列，长的自己省略，行数可预期。 */
.scg-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px; }
/* 「+N」不是一个源，是"还有多少没显示"的提示——别做成跟源一样的实体 chip（2026-09-18）。
   它原来带底色、跟源 chip 一样撑满整格，一个方块里就俩字符，空旷又抢戏。
   改成纯文字、宽度随内容（justify-self: start），点击行为不变。 */
.scg-chip.more {
  justify-self: start;
  padding: 0 4px;
  border-color: transparent;
  background: transparent;
  color: var(--rc-muted);
  font-weight: 600;
}
.scg-chip.more:hover {
  border-color: transparent;
  background: transparent;
  color: var(--rc-primary);
  text-decoration: underline;
}
.scg-chip {
  min-width: 0;
  height: 24px;
  padding: 0 9px;
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
.scg-empty { font-size: 11px; color: var(--rc-faint); }

.scg-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.scg-tag.more { background: transparent; color: var(--rc-faint); }
/* 琥珀色（2026-09-18 定稿）。中途改过中性灰、又改过与编辑弹窗一致的浅蓝，
   用户最后要求改回来——卡片上的标签本来就是分类信息，暖色跟蓝色的图标、红色的异常源
   三者各管一摊，反而分得清。 */
.scg-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #b45309; background: #fef3c7; border-radius: 5px; padding: 2px 7px; }
.scg-tag::before { content: ''; width: 6px; height: 6px; border-radius: 2px; background: #f59e0b; }

/* 底部行钉在卡片底边（margin-top:auto），各卡等高对齐；所有项禁止换行，日期可缩略 */
.scg-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--rc-border-soft); font-size: 11px; color: var(--rc-faint); min-width: 0; }
.scg-foot-count { flex: none; color: var(--rc-muted); font-weight: 600; white-space: nowrap; }
.scg-foot-sep { flex: none; width: 1px; height: 12px; background: var(--rc-border-soft); }
.scg-foot-link { flex: none; padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font-size: 11px; cursor: pointer; white-space: nowrap; }
.scg-foot-link:hover { text-decoration: underline; }
.scg-foot-date { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.scg-empty-state { grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--rc-faint); font-size: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; }

/* 骨架屏占位样式 */
.scg-skeleton-card {
  pointer-events: none;
  border-color: rgba(226, 232, 240, 0.7);
  background: rgba(255, 255, 255, 0.7);
}
.scg-skeleton-icon {
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: #f1f5f9;
  animation: scg-shimmer 1.5s infinite ease-in-out;
}
.scg-skeleton-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 24px;
}
.scg-skeleton-line {
  height: 12px;
  border-radius: 4px;
  background: #f1f5f9;
  animation: scg-shimmer 1.5s infinite ease-in-out;
}
.scg-skeleton-line.title { width: 65%; height: 15px; }
.scg-skeleton-line.cat { width: 35%; height: 10px; }
.scg-skeleton-line.foot { width: 45%; height: 11px; }
.scg-skeleton-chips {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 14px;
}
.scg-skeleton-chip {
  height: 24px;
  border-radius: 7px;
  background: #f8fafc;
  animation: scg-shimmer 1.5s infinite ease-in-out;
}
.scg-skeleton-foot {
  display: flex;
  align-items: center;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--rc-border-soft);
}
@keyframes scg-shimmer {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}

.scg-popover-content { display: flex; flex-direction: column; max-height: 280px; }
.scg-overflow-search { flex: none; height: 32px; margin-bottom: 8px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 7px; font-size: 12px; outline: none; background: #f8fafc; }
.scg-overflow-search:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px #dbeafe; }
.scg-overflow-list { flex: 1; overflow-y: auto; padding-right: 4px; }
.scg-overflow-item { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; border-radius: 7px; padding: 6px 8px; font-size: 12px; color: var(--rc-text-2); cursor: pointer; text-align: left; }
.scg-overflow-item:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.scg-overflow-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.scg-overflow-name { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
.scg-overflow-id { font-size: 10px; color: var(--rc-faint); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; margin-top: 1px; }
.scg-overflow-item:hover .scg-overflow-id { color: var(--rc-primary-ink); opacity: 0.85; }
.scg-overflow-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
.scg-overflow-dot.all { background: #3b82f6; }
.scg-overflow-dot.err { background: var(--rc-error); }
.scg-overflow-empty { padding: 16px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }

@media (max-width: 900px) {
  .scg-grid { grid-template-columns: 1fr; }
}
</style>
