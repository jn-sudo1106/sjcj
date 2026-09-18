<script setup lang="ts">
// 采集资产卡片视图（0707 优化·Phase3；样式对齐 设计稿/原型设计/采集中心卡片样式.png）：
// 一张卡 = 一个采集网站，渐变图标瓦片 + 源 chips + 标签 + 底部统计。
// 源可能很多（0707 会后澄清）：chips 只显示前几个，其余收进「+N」浮层，浮层内可搜索。
import { onMounted, onUnmounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { siteApi, type Site, type Source } from '../../api'
import { siteIcon, siteTone } from '@/utils/visual/siteVisual'

/** 瓦片配色 → 内联 style；模板里别写两遍 siteTone(site) */
function tileStyle(site: { name: string }) {
  const tone = siteTone(site)
  return { background: tone.bg, color: tone.fg, boxShadow: tone.shadow }
}
import { visibleIssueTags } from '@/utils/sourceMark'

const props = defineProps<{ sites: Site[] }>()
// 编辑网站信息由父组件（SourceTab）统一挂 SiteEditorDialog —— 表格视图走的也是这个事件，
// 两个视图共用一份弹窗状态，不在卡片里再挂一个（0915-01）。
const emit = defineEmits<{ 'open-editor': [site: Site] }>()
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
const aggregating = new Set<string>()

async function ensurePreview(site: Site) {
  if (childrenCache[site.siteId]) return
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
  if (childrenComplete[siteId] || childrenLoading[siteId]) return
  childrenLoading[siteId] = true
  try {
    childrenCache[siteId] = await siteApi.siteSources(siteId)
    childrenComplete[siteId] = true
  } finally {
    childrenLoading[siteId] = false
  }
}
async function ensureDataCount(site: Site) {
  if (site.dataCount != null || childrenComplete[site.siteId] || aggregating.has(site.siteId)) return
  aggregating.add(site.siteId)
  try {
    // 当前环境的 sitePaged/siteDetail 都不返回 dataTotal，只能由源行 dataCnt 精确汇总。
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
    .filter((site) => site.dataCount == null && !childrenComplete[site.siteId])
    .sort((a, b) => a.sourceCount - b.sourceCount)
  for (const site of pending) {
    if (version !== queueVersion) return
    await ensureDataCount(site)
  }
}
/**
 * 首屏预览的并发上限（2026-09-18）。
 *
 * 每页从 10 改成 50 之后，原来的 `Promise.all(list.map(ensurePreview))` 会一次甩出 50 个
 * 请求。浏览器对同一 origin 本来就只开 6 条连接，多出来的只是在队列里排着，还会跟
 * 后面的数据量汇总抢连接；后端这边也有过"6 个网站同时拉完整源列表把它打满"的前科
 * （见 ensureDataCount 的注释）。分批发，首屏反而更快出来。
 */
const PREVIEW_CONCURRENCY = 8

async function ensureCards(list: Site[]) {
  // 所有卡片的小预览先返回，再启动逐站完整汇总，避免大响应与首屏预览争抢连接。
  for (let i = 0; i < list.length; i += PREVIEW_CONCURRENCY) {
    await Promise.all(list.slice(i, i + PREVIEW_CONCURRENCY).map(ensurePreview))
  }
  await queueDataCounts(list)
}
onMounted(() => { void ensureCards(props.sites) })
watch(() => props.sites, (list) => { void ensureCards(list) })

// 页签网站化（0710 会议 B3）：入口只推路由，页签注册统一收口在画布加载（index.vue）
function openSource(s: Source) {
  router.push({ path: '/canvas', query: { ...(s.siteId ? { siteId: s.siteId } : {}), sourceId: s.sourceId, view: 'flow' } })
}
// 卡片主体点击 → 进入网站统一流程模板（0707 优化·Phase4）
function openSite(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'source' } })
}
// 卡片底部直达入口：数据量进入当前网站首个源的数据视图。
function openSiteData(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })
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
  if (site.dataCount != null) return site.dataCount
  const children = childrenCache[site.siteId]
  if (childrenComplete[site.siteId] && children) return children.reduce((total, source) => total + (source.dataCount ?? 0), 0)
  return undefined
}

function formatSiteDataCount(site: Site): string {
  const count = siteDataCount(site)
  return count == null ? '数据 —' : `数据 ${count.toLocaleString()} 条`
}

const overflowKw = reactive<Record<string, string>>({})

function filteredChildren(siteId: string) {
  const list = childrenCache[siteId] ?? []
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
const MENU_H = 44

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
      <button
        class="scg-more"
        type="button"
        data-testid="site-card-more"
        title="更多操作"
        aria-label="更多操作"
        @click.stop="openMenu($event, site)"
      >⋯</button>
      <div class="scg-head">
        <span class="scg-icon" :style="tileStyle(site)">
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
          v-if="site.sourceCount > CHIP_LIMIT"
          placement="bottom"
          trigger="click"
          width="240"
          :hide-after="0"
          @show="ensureAllChildren(site.siteId)"
        >
          <template #reference>
            <button type="button" class="scg-chip more" @click.stop>
              +{{ site.sourceCount - CHIP_LIMIT }}
            </button>
          </template>
          <div class="scg-popover-content">
            <input v-model="overflowKw[site.siteId]" class="scg-overflow-search" placeholder="搜索源" />
            <div class="scg-overflow-list">
              <div v-if="childrenLoading[site.siteId]" class="scg-overflow-empty">正在加载源列表…</div>
              <button
                v-if="!childrenLoading[site.siteId] && !overflowKw[site.siteId]"
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
                v-for="c in childrenLoading[site.siteId] ? [] : filteredChildren(site.siteId)"
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
              <div v-if="!childrenLoading[site.siteId] && !filteredChildren(site.siteId).length" class="scg-overflow-empty">没有匹配的源</div>
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
        <span class="scg-foot-count">{{ site.sourceCount }} 个源</span>
        <span class="scg-foot-sep" />
        <button class="scg-foot-link" type="button" title="查看该网站数据视图" @click.stop="openSiteData(site)">
          {{ formatSiteDataCount(site) }}
        </button>
        <span class="scg-foot-sep" />
        <span v-if="site.updatedAt" class="scg-foot-date" :title="`编辑于 ${site.updatedAt}`">编辑于 {{ site.updatedAt.slice(0, 10) }}</span>
      </div>
    </div>

    <div v-if="!sites.length" class="scg-empty-state">没有匹配的网站</div>

    <!-- 只有「编辑网站信息」一项：进入网站左击卡片即可，删除是高危操作不与改名同菜单（0915-01） -->
    <div
      v-if="menu.show"
      class="scg-card-menu"
      data-testid="site-card-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button type="button" data-testid="site-card-menu-edit" @click="onEditSite">编辑网站信息</button>
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
.scg-more {
  position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--rc-faint); font-size: 15px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity 0.12s, background 0.12s, color 0.12s, border-color 0.12s;
}
.scg-card:hover .scg-more, .scg-more:focus-visible { opacity: 1; }
.scg-more:hover { background: var(--rc-primary-bg); border-color: #93c5fd; color: var(--rc-primary-ink); }
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
.scg-title { flex: 1; min-width: 0; }
.scg-name { font-size: 14px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scg-cat { font-size: 11px; color: var(--rc-faint); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 固定两列（2026-09-18 用户提：「源默认一排两个，紧凑点」）。
   原来是 flex + wrap，chip 宽度随名字长短走——「证券日报网-金融机构…」这种长名字
   一个就占满一行，短的挤三个，一片参差。网格定死两列，长的自己省略，行数可预期。 */
.scg-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px; }
/* 「+N」落单时铺满整行：CHIP_LIMIT=5 之后多数卡片是 6 格填满，但源数正好是偶数
   （比如 6 个源全展示）时它还是会落单，半行空着不好看。铺满反倒像个"展开"按钮。 */
.scg-chip.more:last-child:nth-child(odd) { grid-column: 1 / -1; }
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
.scg-chip.more { background: #f8fafc; color: var(--rc-muted); font-weight: 700; }
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
