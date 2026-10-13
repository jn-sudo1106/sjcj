<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useWorkspaceStore, type OrderedTab, type WorkspaceTabRef } from '@/stores/workspace'
import { useFlowStore } from '@/stores/flow'

// 源详情工作区页签条（优化 0701 问题三 · 方案 B）：多个源并存为可关闭页签,视觉对齐原系统使用习惯。
// 首位是不可关闭的「源列表」固定页签：回列表后仍能看到已打开的源并可点回（0702 追加优化）。
//
// 0915-02：源页签之前再排一组「全部 · 网站名」。会上原话「全部没有放在 tab 上」——
// 在此之前网站聚合态不在页签条里，从"全部"点进某个源后要回去只能先回网站列表再点一次网站。
//
// 2026-09-16 两处修正：
//  ① **可以有多个**：源页签本来就允许跨网站，只留一个「全部」会在点了别的网站的源之后
//     把上一个网站的入口和快照一起弄丢；
//  ② **占额度、可关闭**：与源页签共用 8 个总额度（"多了也不好拉"——页签条横向滚动找页签
//     比重新打开还慢），既然占额度，就得能关。
//
// 2026-09-17 走查两处：
//  ③ **两类页签混排**（ws.orderedTabs）：原来网站页签固定占左边一段、且新项落在组尾，
//     而源页签新项落在组首——同一条页签条上两套排法。现在统一成"后打开的在左"；
//  ④ **关掉页签落到右邻**，不再甩回网站列表。原来只有源页签这么做，网站页签一关就跳
//     /collect，"明明旁边还开着好几个页签，怎么把我踢出去了"。
const ws = useWorkspaceStore()
const flow = useFlowStore()
const router = useRouter()
const route = useRoute()

// 当前是否停在源列表页（页签条只挂在 /collect 与 /canvas 源详情两处）
const onList = computed(() => !route.path.startsWith('/canvas'))
// 网站聚合态 = 某个「全部」页签被激活：在 /canvas 上有 siteId、没有 sourceId
const onSiteAll = computed(() => !onList.value && !!route.query.siteId && !route.query.sourceId)
function isSiteActive(siteId: string) {
  return onSiteAll.value && String(route.query.siteId) === siteId
}

/** 点「全部」：回到该网站的聚合视图，并恢复上次停留的视图（默认源视图）。 */
function goSiteAll(siteId: string) {
  if (isSiteActive(siteId)) return
  const view = ws.siteSnapshotOf(siteId)?.view || 'source'
  ws.deactivate() // 让出源页签的激活态，否则页签条上会同时有两个高亮
  void router.push({ path: '/canvas', query: { siteId, view } })
}

/** 关掉页签后落到接任的那个；一个都不剩才回网站列表。 */
function goNext(next: WorkspaceTabRef | null) {
  if (!next) {
    router.push('/collect')
    return
  }
  if (next.kind === 'site') goSiteAll(next.id)
  else {
    ws.activate(next.id)
    navTo(next.id)
  }
}

/** 关掉某个网站页签。名下的源页签不动——它们各自记着 siteId，照常能切。 */
function onCloseSite(siteId: string) {
  const wasActive = isSiteActive(siteId)
  const next = ws.closeSiteTab(siteId)
  if (!wasActive || onList.value) return
  goNext(next)
}

function navTo(key: string) {
  const snap = ws.snapshotOf(key)
  // 每个视图都必须显式带上 view=。否则 index.vue 会先补全 URL，
  // 但 sourceId 未变化，路由监听不会再次触发实际的 source 加载。
  // 没有快照时进入概览；已经打开的源保留原工作视图。
  const view = snap?.view === 'overview' || snap?.view === 'data' || snap?.view === 'task' || snap?.view === 'file' || snap?.view === 'flow' || snap?.view === 'monitor-config'
    ? snap.view
    : 'overview'
  // 必须带上 siteId，否则切到别的网站下的源时左侧源列表会空：
  // 侧栏取的是 `flow.sourceCtx?.siteId || route.query.siteId`，而 sourceDetail 实测返回 siteId: null，
  // URL 再不带就两头落空（2026-08-28 修）。
  const siteId = snap?.siteId
  router.push({ path: '/canvas', query: { ...(siteId ? { siteId } : {}), sourceId: key, view } })
}

function onActivate(sourceId: string) {
  if (!onList.value && !onSiteAll.value && sourceId === ws.activeSourceId) return
  ws.activate(sourceId)
  navTo(sourceId)
}

/** 页签条上点任意一项：按类型分发。 */
function onTabClick(t: OrderedTab) {
  if (t.kind === 'site') goSiteAll(t.id)
  else onActivate(t.id)
}
function onTabClose(t: OrderedTab) {
  if (t.kind === 'site') onCloseSite(t.id)
  else void onClose(t)
}
function isActive(t: OrderedTab) {
  return t.kind === 'site' ? isSiteActive(t.id) : !onList.value && !onSiteAll.value && t.id === ws.activeSourceId
}

function goList() {
  if (onList.value) return
  ws.exitCompare() // 离开源详情工作区时退出临时的对比视图，回列表看到的是正常单栏页签
  router.push('/collect')
}

async function onClose(t: OrderedTab) {
  // 关闭活动页签且画布有未保存改动 → 先确认（其余页签的状态只是快照，无未保存概念）
  if (t.id === ws.activeSourceId && flow.dirty) {
    try {
      await ElMessageBox.confirm(`「${t.name}」画布有未保存的改动，关闭页签将丢弃，是否继续？`, '关闭页签', {
        type: 'warning',
        confirmButtonText: '关闭',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  const wasActive = t.id === ws.activeSourceId
  const next = ws.close(t.id)
  // 在源列表页关闭页签只更新页签条，不跳转；在源详情页关闭活动页签才切换到相邻页签/回列表
  if (!wasActive || onList.value) return
  goNext(next)
}

// 清空全部页签（0707 采集资产样式优化，对齐原型稿「6/8 清空」）：正在画布且有未保存改动时先确认
async function onCloseAll() {
  if (!onList.value && flow.dirty) {
    try {
      await ElMessageBox.confirm('当前画布有未保存的改动，清空页签将丢弃，是否继续？', '清空页签', {
        type: 'warning',
        confirmButtonText: '清空',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  ws.exitCompare()
  ;[...ws.tabs].forEach((t) => ws.close(t.sourceId))
  ws.clearSiteTabs()
  if (!onList.value) router.push('/collect')
}

// ---- 右键菜单（2026-09-18）：对齐浏览器页签的三项 ----
// 用户原话「跟浏览器页签一样，支持关闭、关闭其他、关闭右侧」。**照 Chrome 的三项做，
// 不自造第四项**——Chrome 本身也没有「关闭左侧」，多一项就得多解释一次。
//
// 「关闭」这一项与页签上的 × 重复，但仍然保留：右键菜单的肌肉记忆是整套的，
// 少一项反而会让人以为菜单没生效。
//
// 左右按 `ws.orderedTabs` 的**当前顺序**算，不是打开顺序——页签可拖，
// 用户眼里的"右侧"就是屏幕上的右侧。「网站列表」是固定入口，不在这套顺序里，永远不受影响。
const tabMenu = reactive({ show: false, x: 0, y: 0, tab: null as OrderedTab | null })

const TAB_MENU_WIDTH = 136
function openTabMenu(event: MouseEvent, t: OrderedTab) {
  tabMenu.show = true
  // 页签条能横向滚动、最多 8 个，最右那个的右键点位可能贴着窗口右缘——
  // 菜单是 fixed 定位，不收一下就会被裁掉一半。
  tabMenu.x = Math.min(event.clientX, Math.max(8, window.innerWidth - TAB_MENU_WIDTH - 8))
  tabMenu.y = event.clientY
  tabMenu.tab = t
}
function closeTabMenu() {
  tabMenu.show = false
  tabMenu.tab = null
}
onMounted(() => window.addEventListener('click', closeTabMenu))
onBeforeUnmount(() => window.removeEventListener('click', closeTabMenu))

/** 菜单里「关闭右侧」在没有右邻时要灰掉，否则点了什么都不发生。 */
const menuRightCount = computed(() => {
  if (!tabMenu.tab) return 0
  const list = ws.orderedTabs
  const idx = list.findIndex((t) => t.kind === tabMenu.tab!.kind && t.id === tabMenu.tab!.id)
  return idx < 0 ? 0 : list.length - idx - 1
})
const menuOtherCount = computed(() => (tabMenu.tab ? ws.orderedTabs.length - 1 : 0))

/**
 * 批量关闭前的脏画布确认：**只弹一次**，不是每个页签弹一次。
 * 只有当前正在编辑的那个页签也在关闭范围里时才需要问。
 */
async function confirmIfDropsDirty(targets: OrderedTab[]): Promise<boolean> {
  const hitsActive = targets.some((t) => t.kind === 'source' && t.id === ws.activeSourceId)
  if (!hitsActive || !flow.dirty) return true
  try {
    await ElMessageBox.confirm('当前画布有未保存的改动，关闭这些页签将丢弃，是否继续？', '关闭页签', {
      type: 'warning',
      confirmButtonText: '关闭',
      cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}

/** 关完之后要不要跳：只有被关掉的里面包含"当前正看着的那个"才跳。 */
function isCurrent(t: OrderedTab) {
  return t.kind === 'site' ? isSiteActive(t.id) : (!onList.value && !onSiteAll.value && t.id === ws.activeSourceId)
}

/**
 * 菜单里的「关闭」= 页签上那个 × 的等价动作，复用同一条路径（含脏画布确认、
 * 关完落到右邻、最后一个关掉回网站列表）。
 *
 * ⚠️ **必须先把 tab 取出来再关菜单**：`closeTabMenu()` 会把 `tabMenu.tab` 置为 null，
 * 在模板里写成 `closeTabMenu(); onTabClose(tabMenu.tab!)` 的话传过去的就是 null，
 * 点了没有任何反应（2026-09-18 实测到的 bug）。
 */
function closeCurrentTab() {
  const target = tabMenu.tab
  if (!target) return
  closeTabMenu()
  onTabClose(target)
}

async function closeTabsAround(mode: 'other' | 'right') {
  const anchorTab = tabMenu.tab
  if (!anchorTab) return
  closeTabMenu()
  const list = ws.orderedTabs
  const idx = list.findIndex((t) => t.kind === anchorTab.kind && t.id === anchorTab.id)
  if (idx < 0) return
  const targets = mode === 'other'
    ? list.filter((t) => !(t.kind === anchorTab.kind && t.id === anchorTab.id))
    : list.slice(idx + 1)
  if (!targets.length) return
  if (!await confirmIfDropsDirty(targets)) return
  const wasCurrentClosed = targets.some(isCurrent)
  const next = ws.closeMany(
    targets.map((t) => ({ kind: t.kind, id: t.id })),
    { kind: anchorTab.kind, id: anchorTab.id },
  )
  if (!wasCurrentClosed || onList.value) return
  goNext(next)
}

// ---- 拖动排序（2026-09-17 走查要求）----
// 「网站列表」是固定入口，不参与排序；其余（含「全部 · xxx」）都可拖——
// 两类页签既然已经混排在一条序列里，只让一类能拖就成了另一种说不清的区别对待。
// 下标是 ws.orderedTabs 里的，store 落位后重写整条 seq。
const dragFrom = ref<number | null>(null)
const dropTo = ref<number | null>(null)

function onDragStart(index: number, e: DragEvent) {
  dragFrom.value = index
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  // Firefox 不设 data 就不触发后续的 drag 事件
  e.dataTransfer.setData('text/plain', String(index))
}

function onDrop(index: number) {
  if (dragFrom.value !== null) ws.moveTab(dragFrom.value, index)
  onDragEnd()
}

function onDragEnd() {
  dragFrom.value = null
  dropTo.value = null
}
</script>

<template>
  <div v-if="ws.tabs.length || ws.siteTabs.length" class="rc-src-tabs">
    <!-- 只有页签这一段横向滚动；「n/8 清空」在下面的固定区里（2026-09-16 走查：
         之前整条一起滚，页签一多「清空」就被挤到屏幕外，满 8 个想清理反而得先滚过去找按钮） -->
    <div class="rc-src-tabs-scroll" role="tablist">
    <button
      class="rc-src-tab list-tab"
      :class="{ on: onList }"
      type="button"
      role="tab"
      :aria-selected="onList"
      title="返回网站列表"
      @click="goList"
    >
      <span class="rc-src-tab-name">网站列表</span>
    </button>
    <button
      v-for="(t, i) in ws.orderedTabs"
      :key="`${t.kind}:${t.id}`"
      class="rc-src-tab"
      :class="{
        'site-tab': t.kind === 'site',
        on: isActive(t),
        dragging: dragFrom === i,
        'drop-before': dropTo === i && dragFrom !== null && dragFrom > i,
        'drop-after': dropTo === i && dragFrom !== null && dragFrom < i,
      }"
      type="button"
      role="tab"
      draggable="true"
      :data-testid="t.kind === 'site' ? 'site-all-tab' : undefined"
      :aria-selected="isActive(t)"
      :title="t.kind === 'site' ? `${t.name} · 全部源` : `${t.name} · ${t.id}`"
      @click="onTabClick(t)"
      @contextmenu.prevent.stop="openTabMenu($event, t)"
      @dragstart="onDragStart(i, $event)"
      @dragover.prevent="dropTo = i"
      @dragleave="dropTo === i && (dropTo = null)"
      @drop.prevent="onDrop(i)"
      @dragend="onDragEnd"
    >
      <span class="rc-src-tab-name">{{ t.kind === 'site' ? `全部 · ${t.name}` : t.name }}</span>
      <i
        class="rc-src-tab-x"
        aria-label="关闭页签"
        title="关闭页签"
        :data-testid="t.kind === 'site' ? 'site-all-tab-close' : undefined"
        @click.stop="onTabClose(t)"
      >×</i>
    </button>
    </div>
    <div class="rc-src-tabs-actions">
      <span v-if="ws.compareSourceId" class="rc-src-compare-on">
        对比中 · <button type="button" class="rc-src-compare-exit" @click="ws.exitCompare()">退出</button>
      </span>
      <span class="rc-src-tabs-hint" :class="{ full: ws.tabs.length + ws.siteTabs.length >= 8 }">{{ ws.tabs.length + ws.siteTabs.length }}/8</span>
      <button class="rc-src-clear" type="button" title="关闭全部页签" @click="onCloseAll">清空</button>
    </div>

    <!-- 右键菜单：fixed 定位跟随鼠标，样式与源侧栏的行菜单（ssw-row-menu）一致 -->
    <div
      v-if="tabMenu.show && tabMenu.tab"
      class="rc-src-tab-menu"
      data-testid="tab-context-menu"
      :style="{ left: `${tabMenu.x}px`, top: `${tabMenu.y}px` }"
      @click.stop
    >
      <button type="button" data-testid="tab-menu-close" @click="closeCurrentTab">关闭</button>
      <button
        type="button"
        data-testid="tab-menu-close-others"
        :disabled="menuOtherCount === 0"
        @click="closeTabsAround('other')"
      >关闭其他标签页</button>
      <button
        type="button"
        data-testid="tab-menu-close-right"
        :disabled="menuRightCount === 0"
        @click="closeTabsAround('right')"
      >关闭右侧标签页</button>
    </div>
  </div>
</template>

<style scoped>
/* 0707 采集资产样式优化：对齐原型稿（采集中心卡片样式.png 第二行）——旧"浏览器标签"形态（方顶圆角+底边线）
   改为圆角胶囊 chips；「源列表」与激活页签用浅蓝底+蓝描边胶囊，其余白底胶囊，尾部「n/8 清空」 */
.rc-src-tabs { display: flex; align-items: center; gap: 10px; padding: 0 0 10px; }
/* 页签区：可滚动、可收缩（min-width:0 是关键，否则 flex 子项按内容宽度撑开，右侧操作区会被挤出屏幕） */
.rc-src-tabs-scroll { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; overflow-x: auto; scrollbar-width: thin; }
/* 操作区：钉在右端，不随页签滚动，满额时也一眼可点。
   ⚠️ 高度锁成页签的 30px 且顶部对齐，别改回单纯的 align-items:center——
   页签排满时 .rc-src-tabs-scroll 会冒出横向滚动条（约 11px），把它从 30px 撑到 41px，
   父级的 align-items:center 于是按「含滚动条」的高度给本区居中，视觉上「n/8 清空」
   比页签低半个滚动条（2026-09-17 实测 5.5px）。页签没排满时没有滚动条、看不出来，
   所以这个错位只在满额状态复现。 */
.rc-src-tabs-actions { flex: none; display: flex; align-items: center; gap: 8px; align-self: flex-start; height: 30px; }
.rc-src-tab {
  display: inline-flex; align-items: center; gap: 6px; max-width: 220px; flex: none; height: 30px;
  padding: 0 8px 0 12px; border: 1px solid var(--rc-border); border-radius: 8px;
  background: #fff; color: var(--rc-text-2); font-size: 12px; cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.rc-src-tab:hover { border-color: #93c5fd; color: var(--rc-primary-ink); }
/* 拖动排序：被拖的那个淡出，目标位置用一条竖线指示落点在它的哪一侧。
   用 box-shadow 画线而不是 border，避免改变盒宽让整排页签跟着抖。 */
.rc-src-tab[draggable='true'] { cursor: grab; }
.rc-src-tab.dragging { opacity: 0.4; cursor: grabbing; }
.rc-src-tab.drop-before { box-shadow: -3px 0 0 0 var(--rc-primary); }
.rc-src-tab.drop-after { box-shadow: 3px 0 0 0 var(--rc-primary); }
.rc-src-tab.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }
.rc-src-tab.list-tab { padding-right: 12px; font-weight: 700; }
/* 「全部」排在源页签之前，字重与「网站列表」一致，和普通源页签区分开 */
.rc-src-tab.site-tab { font-weight: 700; }
.rc-src-tab-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 关闭 ×：可见圆钮 18px，但用 ::after 把可点区域撑到约 26×30（贴满页签高度），不用精确瞄准。
   cursor 必须单独设成 pointer——页签本身 draggable 是 grab，× 继承过来鼠标放上去不像能点。
   ::after 向左只伸 4px，不压到页签名字；向右 4px 落在页签右内边距里，不会点到相邻页签。 */
.rc-src-tab-x { position: relative; flex: none; font-style: normal; font-size: 15px; line-height: 1; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--rc-muted); cursor: pointer; }
.rc-src-tab-x::after { content: ''; position: absolute; inset: -6px -4px; }
.rc-src-tab-x:hover { background: var(--rc-error-bg, #fee2e2); color: var(--rc-error, #dc2626); }
.rc-src-tabs-hint { flex: none; color: var(--rc-faint); font-size: 11px; }
/* 满额时把计数标红：新开页签会被拒，得先关几个 */
.rc-src-tabs-hint.full { color: var(--rc-error); font-weight: 700; }
.rc-src-clear { flex: none; border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 5px; }
.rc-src-clear:hover { color: var(--rc-error); background: var(--rc-error-bg, #fee2e2); }
.rc-src-tab-menu {
  position: fixed;
  z-index: 92;
  min-width: 132px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.38);
}
.rc-src-tab-menu button {
  display: block; width: 100%; height: 28px; padding: 0 8px;
  border: 0; border-radius: 4px; background: transparent;
  color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer;
}
.rc-src-tab-menu button:hover:not(:disabled) { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-src-tab-menu button:disabled { color: var(--rc-faint); cursor: not-allowed; }
.rc-src-compare-on { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--rc-primary-ink); }
.rc-src-compare-exit { border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; font-weight: 700; cursor: pointer; padding: 0; text-decoration: underline; }
</style>
